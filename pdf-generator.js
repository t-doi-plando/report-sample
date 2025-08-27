const puppeteer = require('puppeteer');

async function generatePdfFromUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Important for running in many environments
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