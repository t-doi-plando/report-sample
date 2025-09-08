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

    // Generate Highlights(詳細)
    // 左折前安全確認
    for (const kind in config.highlights_sasetumae) {
      const highlightInfo = config.highlights_sasetumae[kind];
      const eventData = eventMap[highlightInfo.id];
      if (eventData) {
        const rate = Math.round((eventData.violations / eventData.total) * 100);
        let text = highlightInfo.text_template
          .replace('%TOTAL%', eventData.total)
          .replace('%VIOLATIONS%', eventData.violations)
          .replace('%RATE%', rate);
        
        finalReportData.highlights_sasetumae.push({
          kind: kind,
          badge: highlightInfo.badge,
          title: config.itemMap[eventData.id].name,
          text: text,
          risk: eventData.risk,
          rate: rate,
          violations: eventData.violations, // この行を追加
          total: eventData.total // この行を追加
        });
      }
    }

    // 左折中安全確認（configにあれば）
    if (config.highlights_sasetuchuu) {
      for (const kind in config.highlights_sasetuchuu) {
        const highlightInfo = config.highlights_sasetuchuu[kind];
        const eventData = eventMap[highlightInfo.id];
        if (eventData) {
          const rate = Math.round((eventData.violations / eventData.total) * 100);
          let text = highlightInfo.text_template
            .replace('%TOTAL%', eventData.total)
            .replace('%VIOLATIONS%', eventData.violations)
            .replace('%RATE%', rate);

          finalReportData.highlights_sasetuchuu.push({
            kind: kind,
            badge: highlightInfo.badge,
            title: config.itemMap[eventData.id].name,
            text: text,
            risk: eventData.risk,
            rate: rate,
            violations: eventData.violations,
            total: eventData.total
          });
        }
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

    // Build scenes pages for 「左折前安全確認」(id=1 固定想定)
    try {
      const targetEventId = 1;
      const targetEvent = driverData.events.find(e => e.id === targetEventId);
      const scenes = (targetEvent && Array.isArray(targetEvent.scenes)) ? targetEvent.scenes.slice() : [];
      // 並びを新→旧
      scenes.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

      // 年→月日でグルーピング
      const groups = [];
      const byYear = new Map();
      // JSTで年/月日を計算
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
      // Map -> 配列（保持順は scenes の降順に準拠）
      for (const [year, mdMap] of byYear.entries()) {
        const dates = [];
        for (const [md, list] of mdMap.entries()) {
          dates.push({ dateLabel: md, scenes: list });
        }
        groups.push({ year, dates });
      }

      // ページ分割（固定上限、日付グループ単位）
      const FIRST_PAGE_LIMIT = 14; // データ行の上限
      const OTHER_PAGE_LIMIT = 22;
      const pages = [];
      let current = { groups: [], rowCount: 0, limit: FIRST_PAGE_LIMIT };

      const pushGroup = (year, dateObj) => {
        // current.groups 内に同一yearが最後にあればマージ、なければ新規追加
        const last = current.groups[current.groups.length - 1];
        if (last && last.year === year) {
          last.dates.push(dateObj);
        } else {
          current.groups.push({ year, dates: [dateObj] });
        }
        current.rowCount += dateObj.scenes.length;
      };

      const closePage = () => {
        if (current.rowCount > 0) {
          pages.push({ groups: current.groups });
        }
        current = { groups: [], rowCount: 0, limit: OTHER_PAGE_LIMIT };
      };

      for (const g of groups) {
        for (const d of g.dates) {
          const need = d.scenes.length;
          if (current.rowCount + need > current.limit && current.rowCount > 0) {
            closePage();
          }
          pushGroup(g.year, d);
        }
      }
      closePage();
      finalReportData.sasetumaePages = pages;
    } catch (e) {
      // 失敗しても他の出力に影響しないように無視
      finalReportData.sasetumaePages = [];
    }
    
    // Build scenes pages for 「左折中安全確認」(id=2 固定想定)
    try {
      const targetEventId = 2;
      const targetEvent = driverData.events.find(e => e.id === targetEventId);
      const scenes = (targetEvent && Array.isArray(targetEvent.scenes)) ? targetEvent.scenes.slice() : [];
      // 並びを新→旧
      scenes.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

      // 年→月日でグルーピング（JST）
      const groups = [];
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
      for (const [year, mdMap] of byYear.entries()) {
        const dates = [];
        for (const [md, list] of mdMap.entries()) {
          dates.push({ dateLabel: md, scenes: list });
        }
        groups.push({ year, dates });
      }

      // ページ分割（固定上限、日付グループ単位）
      const FIRST_PAGE_LIMIT = 14; // データ行の上限
      const OTHER_PAGE_LIMIT = 22;
      const pages = [];
      let current = { groups: [], rowCount: 0, limit: FIRST_PAGE_LIMIT };

      const pushGroup = (year, dateObj) => {
        const last = current.groups[current.groups.length - 1];
        if (last && last.year === year) {
          last.dates.push(dateObj);
        } else {
          current.groups.push({ year, dates: [dateObj] });
        }
        current.rowCount += dateObj.scenes.length;
      };

      const closePage = () => {
        if (current.rowCount > 0) {
          pages.push({ groups: current.groups });
        }
        current = { groups: [], rowCount: 0, limit: OTHER_PAGE_LIMIT };
      };

      for (const g of groups) {
        for (const d of g.dates) {
          const need = d.scenes.length;
          if (current.rowCount + need > current.limit && current.rowCount > 0) {
            closePage();
          }
          pushGroup(g.year, d);
        }
      }
      closePage();
      finalReportData.sasetuchuuPages = pages;
    } catch (e) {
      finalReportData.sasetuchuuPages = [];
    }
    // 汎用セクション（config.detailSections 定義順）
    try {
      const details = [];
      const list = Array.isArray(config.detailSections) ? config.detailSections : [];
      list.forEach(sec => {
        let pages = [];
        let highlights = [];
        if (sec.key === 'sasetumae') {
          pages = finalReportData.sasetumaePages;
          highlights = finalReportData.highlights_sasetumae;
        } else if (sec.key === 'sasetuchuu') {
          pages = finalReportData.sasetuchuuPages;
          highlights = finalReportData.highlights_sasetuchuu;
        } else {
          // 将来のセクション: eventIdから簡易生成
          const ev = driverData.events.find(e => e.id === sec.eventId);
          const scenes = (ev && Array.isArray(ev.scenes)) ? ev.scenes.slice() : [];
          scenes.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
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
          pages = pagesTmp;

          if (sec.highlightsKey && config[sec.highlightsKey] && ev) {
            for (const kind in config[sec.highlightsKey]) {
              const hl = config[sec.highlightsKey][kind];
              const rate = Math.round((ev.violations / ev.total) * 100);
              const text = hl.text_template.replace('%TOTAL%', ev.total).replace('%VIOLATIONS%', ev.violations).replace('%RATE%', rate);
              highlights.push({ kind, badge: hl.badge, title: config.itemMap[ev.id].name, text, risk: ev.risk, rate, violations: ev.violations, total: ev.total });
            }
          }
        }
        details.push({ key: sec.key, title: sec.title, pages, highlights });
      });
      finalReportData.detailSections = details;
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
