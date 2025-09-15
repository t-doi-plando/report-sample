// Extract lat/lng from known map URL formats and return normalized values
function extractLatLng(mapViewUrl, streetViewUrl) {
  let lat = null, lon = null, mapUrl = null;
  // Try MapViewUrl: https://www.google.com/maps/search/?api=1&query=lat,lng
  if (mapViewUrl) {
    try {
      const u = new URL(mapViewUrl);
      const q = u.searchParams.get('query');
      if (q) {
        const parts = q.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const lt = parseFloat(parts[0]);
          const lg = parseFloat(parts[1]);
          if (Number.isFinite(lt) && Number.isFinite(lg)) {
            lat = lt; lon = lg;
            mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
          }
        }
      }
    } catch (_) {}
  }
  // Fallback: Street View URL with viewpoint=lat,lng
  if ((lat === null || lon === null) && streetViewUrl) {
    try {
      let vp = null;
      try {
        const u = new URL(streetViewUrl);
        vp = u.searchParams.get('viewpoint');
      } catch (_) {}
      if (!vp && streetViewUrl.includes('viewpoint=')) {
        vp = streetViewUrl.split('viewpoint=')[1].split(/[&#]/)[0];
      }
      if (vp) {
        const parts = vp.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const lt = parseFloat(parts[0]);
          const lg = parseFloat(parts[1]);
          if (Number.isFinite(lt) && Number.isFinite(lg)) {
            lat = (lat === null) ? lt : lat;
            lon = (lon === null) ? lg : lon;
            if (!mapUrl) {
              mapUrl = `https://www.google.com/maps/search/?api=1&query=${lt},${lg}`;
            }
          }
        }
      }
    } catch (_) {}
  }
  if (!mapUrl) {
    mapUrl = mapViewUrl || streetViewUrl || null;
  }
  return { lat, lon, mapUrl };
}

function generateReports(driversData, config) {
  const reports = driversData.map(driverData => {
    const eventMap = driverData.events.reduce((map, event) => {
      map[event.id] = event;
      return map;
    }, {});

    const finalReportData = {
      driverId: driverData.driverId,
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
      sasetuchuuPages: [],
      // 地図用ポイント（lat/lon）
      mapPoints: []
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

    // 地図用ポイントを収集（全イベントのシーンから）
    try {
      const pts = [];
      (driverData.events || []).forEach(ev => {
        (ev.scenes || []).forEach(s => {
          const { lat, lon } = extractLatLng(s.MapViewUrl, s.streetViewUrl);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            pts.push({ lat, lon });
          }
        });
      });
      finalReportData.mapPoints = pts;
    } catch (_) {}

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
          // 動的ページ番号は後段で pageNumber に付与。静的pageは使用しない
        });
      }
    });
    finalReportData.sections = Object.values(sectionsMap);

    // 既存の左折前ページ生成ロジックは廃止（detailSectionsで一括生成）
    
    // 既存の左折中ページ生成ロジックは廃止（detailSectionsで一括生成）
    // 汎用セクション（config.detailSections 定義順）
  try {
      console.log(`[report] driver=${driverData.driverId} starting detailSections build`);
      const details = [];
      const list = Array.isArray(config.detailSections) ? config.detailSections : [];
      list.forEach(sec => {
        const ev = driverData.events.find(e => e.id === sec.eventId);
        const rawScenesCount = ev && Array.isArray(ev.scenes) ? ev.scenes.length : 0;
        console.log(`[report] driver=${driverData.driverId} sec=${sec.key} evId=${sec.eventId} rawScenes=${rawScenesCount}`);
        const scenes = (ev && Array.isArray(ev.scenes)) ? ev.scenes.map(s => {
          const { lat, lon, mapUrl } = extractLatLng(s.MapViewUrl, s.streetViewUrl);
          return { ...s, lat, lon, mapUrl };
        }) : [];
        console.log(`[report] driver=${driverData.driverId} sec=${sec.key} parsedScenes=${scenes.length}`);
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
        console.log(`[report] driver=${driverData.driverId} sec=${sec.key} groupedYears=${byYear.size}`);
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
        console.log(`[report] driver=${driverData.driverId} sec=${sec.key} pages=${pages.length}`);

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
        console.log(`[report] driver=${driverData.driverId} sec=${sec.key} highlights=${highlights.length}`);

        details.push({ key: sec.key, title: sec.title, pages, highlights, eventId: sec.eventId });
        console.log(`[report] driver=${driverData.driverId} detailsSoFar=${details.length}`);
      });
      finalReportData.detailSections = details;
      console.log(`[report] driver=${driverData.driverId} detailSections total=${details.length}`);
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
      // 概要テーブル向け: 各イベントIDの開始ページ番号を計算
      const startPageByEventId = {};
      let pageCounter = 1; // 概要が1ページ
      console.log(`[report] driver=${driverData.driverId} assignPageNumbers start`);
      details.forEach(sec => {
        const effectivePages = Math.max(1, (sec.pages || []).length);
        const startPage = pageCounter + 1; // 次ページからセクション開始
        if (sec.eventId != null) {
          startPageByEventId[sec.eventId] = startPage;
        }
        pageCounter += effectivePages;
      });
      // 既に生成済みの概要 rows へ動的ページ番号を反映
      (finalReportData.sections || []).forEach(group => {
        (group.rows || []).forEach(row => {
          if (row && typeof row.no === 'number' && startPageByEventId[row.no]) {
            row.pageNumber = startPageByEventId[row.no];
          }
        });
      });
      console.log(`[report] driver=${driverData.driverId} assignPageNumbers done`);
    } catch (e) {
      console.error('[report] detailSections generation error for', driverData.driverId, e);
      finalReportData.detailSections = [];
    }

    return finalReportData;
  });

  return reports;
}

module.exports = {
  generateReports
};
