function generateReports(driversData, config) {
  const reports = driversData.map(driverData => {
    const eventMap = driverData.events.reduce((map, event) => {
      map[event.id] = event;
      return map;
    }, {});

    const finalReportData = {
      pageTitle: config.pageTitle,
      officeName: driverData.officeName,
      driverName: driverData.driverName,
      avgViolationRatePct: driverData.stats.avgViolationRatePct,
      rank: driverData.stats.rank,
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
    driverData.events.forEach(event => {
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
        if (rate > 5) tone = 'danger';
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
    return finalReportData;
  });

  return reports;
}

module.exports = {
  generateReports
};