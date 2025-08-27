const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateReports } = require('./report-generator.js');

const app = express();
const port = 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

app.get(('/'), (req, res) => {
  res.render('pages/root');
});

// Route for /report
app.get('/report', (req, res) => {
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

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});