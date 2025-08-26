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

      const data = JSON.parse(dataRaw);
      const config = JSON.parse(configRaw);
      
      const eventMap = data.events.reduce((map, event) => {
        map[event.id] = event;
        return map;
      }, {});

      const finalReportData = {
        pageTitle: config.pageTitle,
        officeName: data.officeName,
        driverName: data.driverName,
        avgViolationRatePct: data.stats.avgViolationRatePct,
        rank: data.stats.rank,
        highlights: [],
        sections: []
      };
      
      // Generate Highlights
      for (const kind in config.highlights) {
        const highlightInfo = config.highlights[kind];
        const eventData = eventMap[highlightInfo.id];
        if (eventData) {
          const rate = Math.round((eventData.violations / eventData.total) * 100);
          let text = highlightInfo.text_template
            .replace('%TOTAL%', eventData.total)
            .replace('%VIOLATIONS%', eventData.violations)
            .replace('%RATE%', rate);
          
          finalReportData.highlights.push({
            kind: kind,
            badge: highlightInfo.badge,
            title: config.itemMap[eventData.id].name,
            text: text
          });
        }
      }

      // Generate Sections
      const sectionsMap = {};
      data.events.forEach(event => {
        const itemInfo = config.itemMap[event.id];
        if (itemInfo) {
          if (!sectionsMap[itemInfo.maneuver]) {
            sectionsMap[itemInfo.maneuver] = {
              title: itemInfo.maneuver,
              rows: []
            };
          }
          
          const rate = Math.round((event.violations / event.total) * 100);
          let tone = '';
          if (rate >= 25) tone = 'danger';
          else if (rate > 0) tone = 'warn';
          else if (rate === 0) tone = 'good';

          let tag = '';
          if (tone === 'danger' || tone === 'warn') tag = '!';
          if (tone === 'good') tag = 'good';


          sectionsMap[itemInfo.maneuver].rows.push({
            no: event.id,
            name: itemInfo.name,
            tag: tag,
            tone: tone,
            rate: rate,
            detail: `(${event.violations}回/${event.total}回)`,
            count: event.violations,
            page: itemInfo.page
          });
        }
      });
      finalReportData.sections = Object.values(sectionsMap);

      res.render('pages/report', finalReportData);
    });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});