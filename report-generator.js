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
      highlights_gaiyou: [],
      highlights_sasetumae: [], // この行を追加
      highlights_sasetuchuu: [],
      sections: [],
      // シーンページ
      sasetumaePages: [],
      sasetuchuuPages: []
    };

    // Generate Highlights(概要)
    // 仮置きのため、ロジックが決まり次第差し替えが必要
    // 現状はreport-config.jsonのidとdriver-data.jsonのidを紐づけてテンプレートにpushしている
    for (const kind in config.highlights_gaiyou) {
      const highlightInfo = config.highlights_gaiyou[kind];
      const eventData = eventMap[highlightInfo.id];
      if (eventData) {
        const rate = Math.round((eventData.violations / eventData.total) * 100);
        let text = highlightInfo.text_template
          .replace('%TOTAL%', eventData.total)
          .replace('%VIOLATIONS%', eventData.violations)
          .replace('%RATE%', rate);
        
        finalReportData.highlights_gaiyou.push({
          kind: kind,
          badge: highlightInfo.badge,
          title: config.itemMap[eventData.id].name,
          text: text
        });
      }
    }

    // 詳細ハイライトは detailSections 生成時に一括で作成します


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
        if (rate >= 10) tone = 'danger';
        else if (rate >= 5) tone = 'warn';
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
          risk: event.risk,
          page: itemInfo.page
        });
      }
    });
    finalReportData.sections = Object.values(sectionsMap);

    // 既存の左折前ページ生成ロジックは廃止（detailSectionsで一括生成）
    
    // 既存の左折中ページ生成ロジックは廃止（detailSectionsで一括生成）
    // 汎用セクション（config.detailSections 定義順）
    try {
      const details = [];
      const list = Array.isArray(config.detailSections) ? config.detailSections : [];
      list.forEach(sec => {
        const ev = driverData.events.find(e => e.id === sec.eventId);
        const scenes = (ev && Array.isArray(ev.scenes)) ? ev.scenes.slice() : [];
        scenes.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
        // JSTで年/月日グループ化
        const byYear = new Map();
        const ymdFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });
        scenes.forEach(s => {
          const dt = new Date(s.capturedAt);
          const parts = ymdFmt.formatToParts(dt);
          const year = Number(parts.find(p => p.type === 'year')?.value || '1970');
          const month = Number(parts.find(p => p.type === 'month')?.value || '1');
          const day = Number(parts.find(p => p.type === 'day')?.value || '1');
          const md = `${month}/${day}`;
          if (!byYear.has(year)) byYear.set(year, new Map());
          const mapMd = byYear.get(year);
          if (!mapMd.has(md)) mapMd.set(md, []);
          mapMd.get(md).push(s);
        });
        const groups = [];
        for (const [year, mdMap] of byYear.entries()) {
          const dates = [];
          for (const [md, list] of mdMap.entries()) {
            dates.push({ dateLabel: md, scenes: list });
          }
          groups.push({ year, dates });
        }
        // ページ分割
        const FIRST_PAGE_LIMIT = 14, OTHER_PAGE_LIMIT = 22;
        const pagesTmp = [];
        let current = { groups: [], rowCount: 0, limit: FIRST_PAGE_LIMIT };
        const pushGroup = (year, dateObj) => {
          const last = current.groups[current.groups.length - 1];
          if (last && last.year === year) last.dates.push(dateObj); else current.groups.push({ year, dates: [dateObj] });
          current.rowCount += dateObj.scenes.length;
        };
        const closePage = () => { if (current.rowCount > 0) pagesTmp.push({ groups: current.groups }); current = { groups: [], rowCount: 0, limit: OTHER_PAGE_LIMIT }; };
        for (const g of groups) { for (const d of g.dates) { const need = d.scenes.length; if (current.rowCount + need > current.limit && current.rowCount > 0) closePage(); pushGroup(g.year, d); } }
        closePage();
        const pages = pagesTmp;

        // ハイライト生成
        const highlights = [];
        if (sec.highlightsKey && config[sec.highlightsKey] && ev) {
          for (const kind in config[sec.highlightsKey]) {
            const hl = config[sec.highlightsKey][kind];
            const rate = Math.round((ev.violations / ev.total) * 100);
            const text = hl.text_template.replace('%TOTAL%', ev.total).replace('%VIOLATIONS%', ev.violations).replace('%RATE%', rate);
            highlights.push({ kind, badge: hl.badge, title: config.itemMap[ev.id].name, text, risk: ev.risk, rate, violations: ev.violations, total: ev.total });
          }
        }

        details.push({ key: sec.key, title: sec.title, pages, highlights });
      });
      finalReportData.detailSections = details;
      // 後方互換フィールドへ反映
      const mae = details.find(d => d.key === 'sasetumae');
      if (mae) {
        finalReportData.sasetumaePages = mae.pages;
        finalReportData.highlights_sasetumae = mae.highlights;
      }
      const chuu = details.find(d => d.key === 'sasetuchuu');
      if (chuu) {
        finalReportData.sasetuchuuPages = chuu.pages;
        finalReportData.highlights_sasetuchuu = chuu.highlights;
      }
    } catch (e) {
      finalReportData.detailSections = [];
    }

    return finalReportData;
  });

  return reports;
}

module.exports = {
  generateReports
};
