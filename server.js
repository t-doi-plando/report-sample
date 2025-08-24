const http = require('http');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
// const archiver = require('archiver'); // REMOVED: archiver import

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer(async (req, res) => {
  // Static file serving
  if (req.url.startsWith('/css/')) {
    const filePath = path.join(__dirname, 'public', req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(data);
      }
    });
    return;
  }

  // HTML version of the full report (all stores)
  if (req.url === '/report-html') {
    try {
      const reportPath = './views/pages/report.ejs';
      const template = fs.readFileSync(reportPath, 'utf8');
      const salesData = JSON.parse(fs.readFileSync('./sales-data.json', 'utf8'));
      const html = ejs.render(template, { ...salesData, filename: reportPath });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal Server Error\n');
    }
    return;
  }

  // Page with individual report links
  if (req.url === '/report-links') {
    try {
      const salesData = JSON.parse(fs.readFileSync('./sales-data.json', 'utf8'));
      const linksPath = './views/pages/report-links.ejs';
      const template = fs.readFileSync(linksPath, 'utf8');
      const html = ejs.render(template, { salesData: salesData, filename: linksPath });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal Server Error\n');
    }
    return;
  }

  // HTML version for a single store
  if (req.url.startsWith('/report-store/')) {
    const storeIndex = parseInt(req.url.split('/')[2], 10);
    try {
      const salesData = JSON.parse(fs.readFileSync('./sales-data.json', 'utf8'));
      if (isNaN(storeIndex) || storeIndex < 0 || storeIndex >= salesData.stores.length) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Store not found.');
        return;
      }
      const store = salesData.stores[storeIndex];
      const reportPath = './views/pages/report.ejs'; // Use the main report.ejs
      const template = fs.readFileSync(reportPath, 'utf8');
      // Pass only the current store in an array to the template
      const html = ejs.render(template, { ...salesData, stores: [store], filename: reportPath });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal Server Error\n');
    }
    return;
  }

  // Endpoint to download a single PDF for a specific store using Puppeteer
  if (req.url.startsWith('/download-pdf-puppeteer/')) {
    const storeIndex = parseInt(req.url.split('/')[2], 10);
    let browser;
    try {
      const salesData = JSON.parse(fs.readFileSync('./sales-data.json', 'utf8'));
      if (isNaN(storeIndex) || storeIndex < 0 || storeIndex >= salesData.stores.length) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Store not found.');
        return;
      }
      const store = salesData.stores[storeIndex];

      // Read the main report EJS template once
      const mainReportTemplate = fs.readFileSync('./views/pages/report.ejs', 'utf8');
      // Read the CSS content once
      const cssContent = fs.readFileSync('./public/css/style.css', 'utf8');

      // Dynamically render HTML for only this store using the main report.ejs template
      const singleStoreHtml = ejs.render(mainReportTemplate, {
          reportTitle: salesData.reportTitle,
          reportDate: salesData.reportDate,
          stores: [store], 
          filename: './views/pages/report.ejs' 
      });

      browser = await puppeteer.launch();
      const page = await browser.newPage();
      
      await page.setContent(singleStoreHtml, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.addStyleTag({ content: cssContent });
      
      await page.emulateMediaType('print'); // Use print media type for PDF

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${storeIndex}-sales-report.pdf`); // MODIFIED: Filename is storeIndex
      res.end(pdf);

    } catch (error) {
      console.error('Single PDF Generation Error:', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Failed to generate single PDF.\n');
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }
    return;
  }

  // PDF generation route (generates a single PDF of all stores)
  if (req.url === '/report') {
    console.log('[/report] Request received. Starting single PDF generation process.');
    let browser;
    try {
      const salesData = JSON.parse(fs.readFileSync('./sales-data.json', 'utf8'));
      console.log('[/report] sales-data.json loaded.');

      // Read the main report EJS template once
      const mainReportTemplate = fs.readFileSync('./views/pages/report.ejs', 'utf8');
      // Read the CSS content once
      const cssContent = fs.readFileSync('./public/css/style.css', 'utf8');
      console.log('[/report] Main report template and CSS loaded for dynamic rendering.');

      // Dynamically render HTML for all stores using the main report.ejs template
      const fullReportHtml = ejs.render(mainReportTemplate, {
          reportTitle: salesData.reportTitle,
          reportDate: salesData.reportDate,
          stores: salesData.stores, // Pass all stores
          filename: './views/pages/report.ejs' // Important for EJS includes
      });

      browser = await puppeteer.launch();
      const page = await browser.newPage();
      
      await page.setContent(fullReportHtml, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.addStyleTag({ content: cssContent });
      
      await page.emulateMediaType('print'); // Use print media type for PDF

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });
      console.log('[/report] Single PDF generated.');

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=all-sales-report.pdf`); // MODIFIED: Filename is 'all'
      res.end(pdf);
      console.log('[/report] Single PDF sent.');

    } catch (error) {
      console.error('[/report] Single PDF Generation Error (caught):', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Failed to generate single PDF.\n');
      }
    } finally {
      if (browser) {
        console.log('[/report] Closing Puppeteer browser.');
        await browser.close();
      }
    }
    return;
  }

  // Default route
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello World\n');
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
