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

function resolveDriversData(req) {
  const t = req.query && req.query.t ? String(req.query.t) : null;
  if (t) {
    const data = getTokenData(t);
    if (data) return { token: t, data };
  }
  // トークンが無い/失効時は既定データを返す（共有フォールバックは使用しない）
  const dataPath = path.join(__dirname, 'driver-data.json');
  try {
    const dataRaw = fs.readFileSync(dataPath, 'utf8');
    return { token: null, data: JSON.parse(dataRaw) };
  } catch (e) {
    console.error(e);
    return { token: null, data: [] };
  }
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
  const configPath = path.join(__dirname, 'report-config.json');

  fs.readFile(configPath, 'utf8', (err, configRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading report config');
    }
    const config = JSON.parse(configRaw);

    const { token, data: driversDataToUse } = resolveDriversData(req);
    const reports = generateReports(driversDataToUse, config);
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
    res.render('pages/report', { reports: reports, staticMapKey, token });
  });
});

// HTML Preview: Single driver
app.get('/reports/:driverId', (req, res) => {
  const driverId = req.params.driverId;
  const configPath = path.join(__dirname, 'report-config.json');

  fs.readFile(configPath, 'utf8', (err, configRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading report config');
    }
    const config = JSON.parse(configRaw);

    const { token, data: driversDataToUse } = resolveDriversData(req);
    
    const singleDriverData = driversDataToUse.find(d => d.driverId === driverId);
    if (!singleDriverData) {
      return res.status(404).send('Driver not found');
    }

    const reports = generateReports([singleDriverData], config);
    const staticMapKey = process.env.GOOGLE_STATIC_MAPS_KEY || '';
    res.render('pages/report', { reports: reports, staticMapKey, token });
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
