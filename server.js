const express = require('express');
const path = require('path');
const fs = require('fs');

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
  fs.readFile(path.join(__dirname, 'driver-safety-report-data.json'), 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error reading report data');
    }
    const reportData = JSON.parse(data);
    res.render('pages/report', reportData);
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});