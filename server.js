const http = require('http');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

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

  // HTML version of the report
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

  // PDF generation route
  if (req.url === '/report') {
    let browser;
    try {
      browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.goto(`http://${hostname}:${port}/report-html`, { waitUntil: 'networkidle0' });
      
      // Emulate screen media type to apply screen styles
      await page.emulateMediaType('print');

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');
      res.end(pdf);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Failed to generate PDF.\n');
    } finally {
      if (browser) {
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
