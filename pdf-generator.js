const puppeteer = require('puppeteer'); // puppeteer に戻す

async function generatePdfFromUrl(url) {
  let browser;
  try {
    // 環境変数 CHROMIUM_PATH が設定されていればそれを使用し、なければ Puppeteer に任せる
    const executablePath = process.env.CHROMIUM_PATH || undefined;

    browser = await puppeteer.launch({
      executablePath: executablePath,
      headless: true, // Render環境では 'new' または 'true' が推奨される場合がある
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Renderのようなコンテナ環境でメモリ不足を防ぐ
        '--disable-gpu', // GPUアクセラレーションを無効化
        '--no-zygote', // プロセス起動を高速化
        '--single-process' // シングルプロセスモードで実行
      ],
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();
    
    // Navigate to the page and wait for it to be fully loaded
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Generate the PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, // Ensure CSS backgrounds are printed
      margin: { // Match CSS @page margins
        top: '15mm',
        right: '12mm',
        bottom: '15mm',
        left: '12mm'
      }
    });
    
    return pdfBuffer;
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Could not generate PDF.');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  generatePdfFromUrl
};