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
    const highRiskGuidanceType = rec.high_risk_guidance_type || rec.highRiskGuidanceType || '';
    const events = Array.isArray(rec.events) ? rec.events : [];
    const scenes = Array.isArray(rec.scenes) ? rec.scenes : [];
    return {
      driverId,
      driverName,
      officeName,
      companyName,
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

function formatMinutesToHm(totalMinutes) {
  const m = Number(totalMinutes);
  if (!Number.isFinite(m)) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}時間${rem}分`;
}

function buildMockReports(drivers, config) {
  const itemMap = (config && config.itemMap) || {};
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
    const highRiskGuidanceLabel = itemMap[d.highRiskGuidanceType] || '文言未設定';
    const scenes = Array.isArray(d.scenes) ? d.scenes : [];
    const violationCount = scenes.length;
    const dangerCount = scenes.filter((s) => {
      const risk = s && (s.risk_type ?? s.riskType);
      return risk !== null && risk !== undefined && risk !== '';
    }).length;
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
      dangerCount,
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
    const reports = buildMockReports(driversDataToUse, config);
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
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
    const reports = buildMockReports(driversDataToUse, config);
    const targetReport = reports.find(r => r.driverId === driverId);
    if (!targetReport) {
      return res.status(404).send('Driver not found');
    }
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
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
