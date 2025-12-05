require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { generateReports } = require('./report-generator.js');
const { generatePdfFromUrl } = require('./pdf-generator.js');

const app = express();
const port = process.env.PORT || 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // JSONボディをパースするためのミドルウェア

let uploadedDriversData = null; // アップロードされたドライバーデータを一時的に保持する変数（フォールバック用）

// URLトークン方式: トークン -> データ をインメモリ保持
const tokenStore = new Map(); // token -> { data, lastAccess }
const TOKEN_TTL_MS = (parseInt(process.env.TOKEN_TTL_HOURS || '8', 10) || 8) * 60 * 60 * 1000; // 8時間
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分

function saveTokenData(token, data) {
  tokenStore.set(token, { data, lastAccess: Date.now() });
}

function getTokenData(token) {
  const entry = tokenStore.get(token);
  if (!entry) return null;
  if (Date.now() - entry.lastAccess > TOKEN_TTL_MS) {
    tokenStore.delete(token);
    return null;
  }
  entry.lastAccess = Date.now();
  return entry.data;
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [t, entry] of tokenStore.entries()) {
    if (now - entry.lastAccess > TOKEN_TTL_MS) tokenStore.delete(t);
  }
}
setInterval(cleanupExpiredTokens, CLEANUP_INTERVAL_MS).unref?.();

function normalizeDriversData(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw.map((rec) => {
    const driverId = rec.driver_id || rec.driverId || '';
    const driverName = rec.driver_name || rec.driverName || '';
    const officeName = rec.branch_name || rec.officeName || '';
    const companyName = rec.company_name || rec.companyName || '';
    const highRiskOperationType = rec.high_risk_operation_type || rec.highRiskOperationType || '';
    const highRiskGuidanceType = rec.high_risk_guidance_type || rec.highRiskGuidanceType || '';
    const events = Array.isArray(rec.events) ? rec.events : [];
    const scenes = Array.isArray(rec.scenes) ? rec.scenes : [];
    return {
      driverId,
      driverName,
      officeName,
      companyName,
      highRiskOperationType,
      highRiskGuidanceType,
      period: rec.period || null,
      events,
      scenes,
      stats: rec.stats || {}
    };
  });
}

function resolveDriversData(req) {
  const t = req.query && req.query.t ? String(req.query.t) : null;
  if (t) {
    const data = getTokenData(t);
    if (data) return { token: t, data: normalizeDriversData(data) };
  }
  // トークンが無い/失効時は既定データを返す（共有フォールバックは使用しない）
  const pocPath = path.join(__dirname, 'driver-data-poc1.json');
  const legacyPath = path.join(__dirname, 'driver-data.json');
  try {
    const raw = fs.readFileSync(pocPath, 'utf8');
    return { token: null, data: normalizeDriversData(JSON.parse(raw)) };
  } catch (e) {
    try {
      const rawLegacy = fs.readFileSync(legacyPath, 'utf8');
      return { token: null, data: normalizeDriversData(JSON.parse(rawLegacy)) };
    } catch (e2) {
      console.error(e2);
      return { token: null, data: [] };
    }
  }
}

function formatDateLabel(val) {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

function formatDateTimeLabel(val) {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function formatMinutesToHm(totalMinutes) {
  const m = Number(totalMinutes);
  if (!Number.isFinite(m)) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}時間${rem}分`;
}

function formatNumberHuman(n) {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

function countAccelDecel(scene, allScenes) {
  if (!scene) return 0;
  const timing = getSceneValue(scene, 'left_turn_timing_type');
  const kind = getSceneValue(scene, 'left_turn_accel_decel_type');
  if (!timing || !kind) return 0;
  return allScenes.filter((s) => (
    getSceneValue(s, 'left_turn_timing_type') === timing &&
    getSceneValue(s, 'left_turn_accel_decel_type') === kind
  )).length;
}

function getSceneValue(scene, key) {
  if (!scene) return null;
  if (key in scene) return scene[key];
  // snake_case <-> camelCase 両対応
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in scene) return scene[camel];
  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  if (snake in scene) return scene[snake];
  return null;
}

function getValueFromSources(sources, key) {
  for (const src of sources) {
    const val = getSceneValue(src, key);
    if (val !== null && val !== undefined) return val;
  }
  return null;
}

function applyTemplatePlaceholders(text, sources = [], labelMaps = {}) {
  const sourceList = Array.isArray(sources) ? sources : [sources];
  if (!text || typeof text !== 'string') return '詳細文言が未設定です';
  const replaceCalc = (exprRaw) => {
    const expr = exprRaw.trim();
    const sanitized = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
      const v = getValueFromSources(sourceList, name);
      const num = Number(v);
      return Number.isFinite(num) ? String(num) : '0';
    });
    // 許可: 数字, 演算子, 括弧, 小数点, 空白
    if (/[^0-9+\-*/().\s]/.test(sanitized)) return '計算不可';
    try {
      const val = Function(`"use strict"; return (${sanitized});`)();
      return Number.isFinite(val) ? formatNumberHuman(val) : '計算不可';
    } catch (e) {
      return '計算不可';
    }
  };

  return text.replace(/\{([^{}]+)\}/g, (_, token) => {
    const trimmed = token.trim();
    if (trimmed.startsWith('calc:')) {
      const expr = trimmed.slice(5);
      return replaceCalc(expr);
    }
    const val = getValueFromSources(sourceList, trimmed);
    if (val === null || val === undefined || val === '') return '未定義';
    const labelMap = labelMaps[trimmed];
    if (labelMap && val in labelMap) return String(labelMap[val]);
    return String(val);
  });
}

// txt master (POC) をキャッシュ読み込み
let txtMasterCache = null;
function loadTxtMaster() {
  if (txtMasterCache) return txtMasterCache;
  const txtMasterPath = path.join(__dirname, 'txt-master-poc1.json');
  try {
    const raw = fs.readFileSync(txtMasterPath, 'utf8');
    txtMasterCache = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load txt-master-poc1.json', err);
    txtMasterCache = {};
  }
  return txtMasterCache;
}

function extractLatLngFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const q = parsed.searchParams.get('q') || parsed.searchParams.get('query');
    if (q) {
      const match = q.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      if (match) {
        return { lat: match[1], lng: match[2] };
      }
    }
    // fallback: raw url scan
    const rawMatch = url.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (rawMatch) {
      return { lat: rawMatch[1], lng: rawMatch[2] };
    }
  } catch (e) {
    return null;
  }
  return null;
}

function buildStaticMapUrl(mapUrl, staticMapKey) {
  const key = staticMapKey || process.env.GOOGLE_STATIC_MAPS_KEY || '';
  if (!key) return '';
  const coords = extractLatLngFromUrl(mapUrl);
  if (!coords) return '';
  const { lat, lng } = coords;
  const base = 'https://maps.googleapis.com/maps/api/staticmap';
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '15',
    size: '640x320',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key
  });
  return `${base}?${params.toString()}`;
}

function buildMockReports(drivers, config, staticMapKey = '') {
  const itemMap = (config && config.itemMap) || {};
  const riskTypeLabelMap = (config && config.risk_type_label) || {};
  const labelMaps = {
    left_turn_timing_type: (config && config.left_turn_timing_type_label) || {},
    left_turn_accel_decel_type: (config && config.left_turn_accel_decel_type_label) || {}
  };
  const txtMaster = loadTxtMaster();
  const mockDetailPages = [{
    pageNumber: 2,
    page: {},
    section: { title: '詳細' },
    index: 0,
    totalPages: 1
  }];
  const baseHighlights = [
    { kind: 'danger', badge: '危険疑い回数が多い項目', title: '左折前安全確認', text: 'バックを開始する前に完全停止できていませんでした。' },
    { kind: 'warn', badge: '違反疑い割合が高い項目', title: '左折中安全確認', text: '左後方の安全確認が不足しています。' },
    { kind: 'good', badge: '高評価ポイント', title: 'バック中安全確認', text: '後方確認がしっかりできています。' }
  ];
  const baseSections = [
    {
      title: '左折',
      rows: [
        { no: 1, name: '左折前安全確認', tags: ['danger'], rate: 25, detail: '(1/4)', risk: 3, pageNumber: null },
        { no: 2, name: '左折中安全確認', tags: ['warn'], rate: 15, detail: '(2/13)', risk: 2, pageNumber: null }
      ]
    },
    {
      title: 'バック',
      rows: [
        { no: 4, name: 'バック前安全確認', tags: ['good'], rate: 5, detail: '(0/10)', risk: 0, pageNumber: null }
      ]
    }
  ];
  return drivers.map((d, idx) => {
    // ドライバー単位で必要な統計・最新シーンを計算（表示はモック固定）
    const highRiskGuidanceLabel = itemMap[d.highRiskGuidanceType] || '文言未設定';
    const scenes = Array.isArray(d.scenes) ? d.scenes : [];
    const violationCount = scenes.length;
    const violationHits = scenes.filter((s) => {
      const v = s && (s.violation_type ?? s.violationType);
      return v !== null && v !== undefined && v !== '';
    }).length;
    const dangerCount = scenes.filter((s) => {
      const risk = s && (s.risk_type ?? s.riskType);
      return risk !== null && risk !== undefined && risk !== '';
    }).length;
    const dangerHits = dangerCount;
    const violationCountsByType = scenes.reduce((acc, s) => {
      const vtype = s && (s.violation_type ?? s.violationType);
      if (vtype) acc[vtype] = (acc[vtype] || 0) + 1;
      return acc;
    }, {});
    const dangerCountsByType = scenes.reduce((acc, s) => {
      const risk = s && (s.risk_type ?? s.riskType);
      const vtype = s && (s.violation_type ?? s.violationType);
      if (risk && vtype) acc[vtype] = (acc[vtype] || 0) + 1;
      return acc;
    }, {});
    const toTimestamp = (val) => {
      const dt = new Date(val);
      const t = dt.getTime();
      return Number.isNaN(t) ? null : t;
    };
    const latestViolationScene = scenes.reduce((acc, s) => {
      const latestFlg = s && (s.latest_violation_flg ?? s.latestViolationFlg);
      if (!latestFlg) return acc;
      const ts = toTimestamp(s && s.datetime);
      if (ts === null) return acc;
      if (!acc || ts > acc.ts) return { ts, scene: s };
      return acc;
    }, null);
    const pickedScene = latestViolationScene ? latestViolationScene.scene : null;
    const highlightTargetViolationType = (() => {
      if (!pickedScene) return null;
      const op = d.highRiskOperationType || d.high_risk_operation_type || '';
      const guide = d.highRiskGuidanceType || '';
      const vtype = pickedScene.violation_type ?? pickedScene.violationType ?? '';
      // 同一 op/guidance の項目のみハイライト対象
      if (!op || !guide || !vtype) return null;
      if (op !== d.highRiskOperationType && op !== d.high_risk_operation_type) return null;
      if (guide !== d.highRiskGuidanceType && guide !== d.high_risk_guidance_type) return null;
      return vtype;
    })();
    const latestScenesByViolationType = scenes.reduce((acc, s) => {
      const vtype = s && (s.violation_type ?? s.violationType);
      if (!vtype) return acc;
      const ts = toTimestamp(s && s.datetime);
      if (ts === null) return acc;
      if (!acc[vtype] || ts > acc[vtype].ts) acc[vtype] = { ts, scene: s };
      return acc;
    }, {});
    const accelDecelCount = countAccelDecel(pickedScene, scenes);

    const latestScene = (() => {
      if (!pickedScene) return null;
      const opType = d.highRiskOperationType || d.high_risk_operation_type || '';
      const guideType = d.highRiskGuidanceType || '';
      const violationType = pickedScene.violation_type ?? pickedScene.violationType ?? '';
      const section = txtMaster && txtMaster[opType] && txtMaster[opType][guideType];
      const violationEntry = section && section[violationType];
      const violationDetail = (() => {
        const base = violationEntry && violationEntry.check_detail ? violationEntry.check_detail : '詳細文言が未設定です';
        const thresholds = (config && config.thresholds) || {};
        const derived = { accel_or_decel_count: accelDecelCount };
        return applyTemplatePlaceholders(base, [pickedScene, thresholds, derived], labelMaps);
      })();
      const riskRaw = pickedScene.risk_type ?? pickedScene.riskType ?? '';
      const riskLabel = (() => {
        if (!riskRaw) return '';
        if (riskTypeLabelMap && riskTypeLabelMap[riskRaw]) return riskTypeLabelMap[riskRaw];
        return String(riskRaw);
      })();
      return {
        dateLabel: pickedScene.datetime ? formatDateTimeLabel(pickedScene.datetime) : '',
        violationLabel: violationDetail || '詳細文言が未設定です',
        riskLabel,
        movieUrl: pickedScene.movie_url || pickedScene.movieUrl || '',
        mapUrl: pickedScene.map_url || pickedScene.mapUrl || '',
      mapImageUrl: buildStaticMapUrl(pickedScene.map_url || pickedScene.mapUrl || '', staticMapKey)
      };
    })();
    const opTypeForFlag = d.highRiskOperationType || d.high_risk_operation_type || '';
    const guideTypeForFlag = d.highRiskGuidanceType || '';
    const sectionForFlag = txtMaster && txtMaster[opTypeForFlag] && txtMaster[opTypeForFlag][guideTypeForFlag];
    const checkListCompleted = (() => {
      if (!sectionForFlag) return true;
      return Object.keys(sectionForFlag).every((key) => !violationCountsByType[key]);
    })();
    const checkListItems = (() => {
      const section = sectionForFlag;
      const thresholds = (config && config.thresholds) || {};
      const derivedFallback = { accel_or_decel_count: accelDecelCount };
      if (!section) {
        const label = applyTemplatePlaceholders('バックに入る前に、完全に停止できているか', [pickedScene, thresholds, derivedFallback], labelMaps);
        return [{ label, completed: true }];
      }
      const keys = Object.keys(section);
      return keys.map((k) => {
        const entry = section[k];
        const base = entry && entry.check_list ? entry.check_list : '';
        const sampleScene = (latestScenesByViolationType[k] && latestScenesByViolationType[k].scene)
          || scenes.find((s) => (s.violation_type ?? s.violationType) === k)
          || pickedScene;
        const derivedForItem = { accel_or_decel_count: countAccelDecel(sampleScene, scenes) };
        const label = applyTemplatePlaceholders(base, [sampleScene, thresholds, derivedForItem], labelMaps);
        const detailBase = entry && entry.check_detail ? entry.check_detail : '詳細文言が未設定です';
        const detail = applyTemplatePlaceholders(detailBase, [sampleScene, thresholds, derivedForItem], labelMaps);
        const adviceBase = (() => {
          const timingKey = getSceneValue(sampleScene, 'left_turn_timing_type');
          const accelKey = getSceneValue(sampleScene, 'left_turn_accel_decel_type');
          const byTiming = entry && entry.advice_comment_by_timing && timingKey ? entry.advice_comment_by_timing[timingKey] : null;
          const timingAdvice = byTiming && accelKey ? byTiming[accelKey] : '';
          if (timingAdvice) return timingAdvice;
          return entry && entry.advice_comment ? entry.advice_comment : '';
        })();
        const advice = adviceBase ? applyTemplatePlaceholders(adviceBase, [sampleScene, thresholds, derivedForItem], labelMaps) : '';
        const completed = !violationCountsByType[k];
        const vHits = violationCountsByType[k] || 0;
        const dHits = dangerCountsByType[k] || 0;
        const extraNote = (() => {
          if (k !== 'sudden_accel_or_decel') return '';
          const x = vHits || 0;
          const y = Math.max(x - 1, 0);
          return `違反疑い${x}件のうち上記を除く他${y}件は、別の要因で測定されました。詳細は「動画一覧」ページをご確認ください。`;
        })();
        const isHighlighted = highlightTargetViolationType === k;
        const alwaysWarnBg = k === 'sudden_accel_or_decel';
        return { label, detail, advice, completed, violationHits: vHits, dangerHits: dHits, extraNote, isHighlighted, alwaysWarnBg };
      }).filter((v) => v.label && v.label.trim().length > 0);
    })();
    return {
      driverId: d.driverId || `mock-${idx}`,
      driverName: d.driverName || '氏名未設定',
      officeName: d.officeName || d.branch_name || '事業所未設定',
      companyName: d.companyName || d.company_name || '会社未設定',
      periodLabel: (() => {
        const start = d.period && d.period.start_date ? formatDateLabel(d.period.start_date) : '';
        const end = d.period && d.period.end_date ? formatDateLabel(d.period.end_date) : '';
        if (start && end) return `${start}〜${end}`;
        return '';
      })(),
      daysCountLabel: (() => {
        const days = d.period && Number.isFinite(Number(d.period.days_count)) ? Number(d.period.days_count) : null;
        return days !== null ? `(${days}日間)` : '';
      })(),
      drivingTimeLabel: (() => {
        const minutes = d.period ? d.period.total_minutes : null;
        const label = formatMinutesToHm(minutes);
        return label || '';
      })(),
      pageTitle: '運転診断結果レポート｜概要',
      avgViolationRatePct: 10.9,
      rank: { total: drivers.length, position: idx + 1 },
      highlights_gaiyou: baseHighlights,
      highRiskGuidanceLabel,
      violationCount,
      violationHits,
      dangerCount,
      dangerHits,
      latestScene,
      checkListCompleted,
      checkListItems,
      sections: baseSections,
      detailPages: mockDetailPages
    };
  });
}

// --- Endpoints ---

// JSONデータアップロード用エンドポイント
app.post('/upload-json-data', (req, res) => {
  try {
    const incoming = req.body;
    const token = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    saveTokenData(token, incoming);
    // 共有フォールバックは使用しない（URLトークン経由のみ参照）
    console.log('Uploaded driver data (tokenized):', token, Array.isArray(incoming) ? incoming.length : 'n/a', 'drivers');
    res.status(200).json({ message: 'JSONデータが正常にアップロードされました。', token });
  } catch (error) {
    console.error('Error processing uploaded JSON data:', error);
    res.status(400).json({ message: '無効なJSONデータです。' });
  }
});

// JSONデータをリセット用エンドポイント
app.post('/reset-json-data', (req, res) => {
  uploadedDriversData = null;
  console.log('Uploaded driver data has been reset.');
  res.status(200).json({ message: '表示をリセットしました。' });
});

// Root: Dashboard page
app.get('/', (req, res) => {
  const { token, data } = resolveDriversData(req);
  try {
    res.render('pages/report-links', {
      reportTitle: '運転診断レポート一覧',
      drivers: data,
      token
    });
  } catch (readErr) {
    console.error(readErr);
    return res.status(500).send('Error rendering dashboard');
  }
});

// HTML Preview: All drivers
app.get('/reports/all', (req, res) => {
  const configPath = path.join(__dirname, 'report-config-poc1.json');

  fs.readFile(configPath, 'utf8', (err, configRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading report config');
    }
    const config = JSON.parse(configRaw);

    const { token, data: driversDataToUse } = resolveDriversData(req);
    // モック表示：gaiyou固定
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
    const reports = buildMockReports(driversDataToUse, config, staticMapKey);
    res.render('pages/report', { reports: reports, staticMapKey, token });
  });
});

// HTML Preview: Single driver
app.get('/reports/:driverId', (req, res) => {
  const driverId = req.params.driverId;
  const configPath = path.join(__dirname, 'report-config-poc1.json');

  fs.readFile(configPath, 'utf8', (err, configRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading report config');
    }
    const config = JSON.parse(configRaw);

    const { token, data: driversDataToUse } = resolveDriversData(req);
    
    // モック表示：gaiyou固定
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
    const reports = buildMockReports(driversDataToUse, config, staticMapKey);
    const targetReport = reports.find(r => r.driverId === driverId);
    if (!targetReport) {
      return res.status(404).send('Driver not found');
    }
    res.render('pages/report', { reports: [targetReport], staticMapKey, token });
  });
});

// PDF Download: All drivers
app.get('/download/all', async (req, res) => {
  try {
    // ポート、ドメインの設定
    const PORT = process.env.PORT || 3000;
    const DOMAIN = process.env.DOMAIN || `127.0.0.1:${PORT}`;

    // プロトコルは req.protocol を使用（トークンをURL伝搬）
    const t = req.query && req.query.t ? String(req.query.t) : null;
    const query = t ? `?t=${encodeURIComponent(t)}` : '';
    const url = `${req.protocol}://${DOMAIN}/reports/all${query}`;
    
    // タイムスタンプ付きファイル名（report-all-drivers-YYYYMMDD-hhmmss.pdf）
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const timestamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
    const filename = `report-all-drivers-${timestamp}.pdf`;

    const encodeRFC5987 = (str) => encodeURIComponent(str)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');

    const pdfBuffer = await generatePdfFromUrl(url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeRFC5987(filename)}`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).send('Failed to generate PDF.');
  }
});

// PDF Download: Single driver
app.get('/download/:driverId', async (req, res) => {
  const driverId = req.params.driverId;
  try {
    // ポート、ドメインの設定
    const PORT = process.env.PORT || 3000;
    const DOMAIN = process.env.DOMAIN || `127.0.0.1:${PORT}`;

    // URLの設定（driverIdはURLエンコード＋トークン伝搬）
    const t = req.query && req.query.t ? String(req.query.t) : null;
    const query = t ? `?t=${encodeURIComponent(t)}` : '';
    const url = `${req.protocol}://${DOMAIN}/reports/${encodeURIComponent(driverId)}${query}`;

    // ダウンロード用ファイル名の生成（ドライバーID-事業所名-ドライバー名-YYYYMMDD-hhmmss.pdf）
    // URLトークンがあればそのデータ、なければフォールバック
    const { data: driversDataToUse } = resolveDriversData(req);

    const driver = Array.isArray(driversDataToUse)
      ? driversDataToUse.find((d) => d.driverId === driverId)
      : null;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const timestamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;

    // Windows等で使用不可の文字を排除
    const sanitize = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
    let baseName;
    if (driver) {
      const officeName = sanitize(driver.officeName || '');
      const driverName = sanitize(driver.driverName || '');
      baseName = `${driverId}-${officeName}-${driverName}-${timestamp}`;
    } else {
      baseName = `report-${driverId}-${timestamp}`; // フォールバック
    }
    // 日本語等を含むフル名（filename* に使用）
    const fullFilename = `${baseName}.pdf`;
    // ASCII のみの安全なファイル名（filename に使用）
    const toAscii = (s) => String(s).replace(/[^\x00-\x7F]/g, '_');
    const safeId = toAscii(sanitize(driverId));
    const safeFilename = `report-${safeId}-${timestamp}.pdf`;

    // RFC 5987 準拠の filename* も併記（日本語対応強化）
    const encodeRFC5987 = (str) => encodeURIComponent(str)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');

    const pdfBuffer = await generatePdfFromUrl(url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeRFC5987(fullFilename)}`
    );
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).send('Failed to generate PDF.');
  }
});


// --- Deprecated Routes ---
// Redirect old /report to the new /reports/all
app.get('/report', (req, res) => {
  res.redirect('/reports/all');
});


// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
