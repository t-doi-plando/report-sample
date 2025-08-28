require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateReports } = require('./report-generator.js');
const { generatePdfFromUrl } = require('./pdf-generator.js');

const app = express();
const port = process.env.PORT || 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoints ---

// Root: Dashboard page
app.get('/', (req, res) => {
  const dataPath = path.join(__dirname, 'driver-data.json');
  fs.readFile(dataPath, 'utf8', (err, dataRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading driver data');
    }
    const driversData = JSON.parse(dataRaw);
    res.render('pages/report-links', {
      reportTitle: '運転診断レポート一覧',
      drivers: driversData
    });
  });
});

// HTML Preview: All drivers
app.get('/reports/all', (req, res) => {
  const dataPath = path.join(__dirname, 'driver-data.json');
  const configPath = path.join(__dirname, 'report-config.json');

  fs.readFile(dataPath, 'utf8', (err, dataRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading driver data');
    }
    fs.readFile(configPath, 'utf8', (err, configRaw) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Error reading report config');
      }
      const driversData = JSON.parse(dataRaw);
      const config = JSON.parse(configRaw);
      const reports = generateReports(driversData, config);
      res.render('pages/report', { reports: reports });
    });
  });
});

// HTML Preview: Single driver
app.get('/reports/:driverId', (req, res) => {
  const driverId = req.params.driverId;
  const dataPath = path.join(__dirname, 'driver-data.json');
  const configPath = path.join(__dirname, 'report-config.json');

  fs.readFile(dataPath, 'utf8', (err, dataRaw) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading driver data');
    }
    fs.readFile(configPath, 'utf8', (err, configRaw) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Error reading report config');
      }
      const driversData = JSON.parse(dataRaw);
      const config = JSON.parse(configRaw);
      
      const singleDriverData = driversData.find(d => d.driverId === driverId);
      if (!singleDriverData) {
        return res.status(404).send('Driver not found');
      }

      const reports = generateReports([singleDriverData], config);
      res.render('pages/report', { reports: reports });
    });
  });
});

// PDF Download: All drivers
app.get('/download/all', async (req, res) => {
  try {
    const domain = process.env.APP_DOMAIN || 'localhost';
    const port = process.env.APP_PORT || 3000;
    const url = `${req.protocol}://${domain}:${port}/reports/all`;
    
    const pdfBuffer = await generatePdfFromUrl(url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report-all-drivers.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).send('Failed to generate PDF.');
  }
});

// PDF Download: Single driver
app.get('/download/:driverId', async (req, res) => {
  const driverId = req.params.driverId;
  try {
    const domain = process.env.APP_DOMAIN || 'localhost';
    const port = process.env.APP_PORT || 3000;
    const url = `${req.protocol}://${domain}:${port}/reports/${driverId}`;

    const pdfBuffer = await generatePdfFromUrl(url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${driverId}.pdf"`);
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