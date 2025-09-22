const DEFAULT_THRESHOLDS = {
  danger: 10,
  warn: 5,
  good: 0
};

const HIGHLIGHT_KINDS = ['danger', 'warn', 'good'];

function normalizeThreshold(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveThresholds(configThresholds = {}) {
  return {
    danger: normalizeThreshold(configThresholds.danger_threshold, DEFAULT_THRESHOLDS.danger),
    warn: normalizeThreshold(configThresholds.warn_threshold, DEFAULT_THRESHOLDS.warn),
    good: normalizeThreshold(configThresholds.good_threshold, DEFAULT_THRESHOLDS.good)
  };
}

function determineTone(rate, thresholds) {
  if (rate >= thresholds.danger) return 'danger';
  if (rate >= thresholds.warn) return 'warn';
  if (rate <= thresholds.good) return 'good';
  return '';
}

function fallbackText(text) {
  if (typeof text === 'string' && text.trim().length > 0) {
    return text;
  }
  return '本文未設定';
}

function resolveHighlightMeta(kind, meta = {}) {
  return {
    kind,
    badge: meta.badge || ''
  };
}

function fallbackTitle(title) {
  if (typeof title === 'string' && title.trim().length > 0) {
    return title;
  }
  return 'タイトル未設定';
}

function buildHighlight(kind, meta, entry) {
  const base = resolveHighlightMeta(kind, meta);
  return {
    kind: base.kind,
    badge: base.badge,
    title: fallbackTitle(entry?.title),
    text: fallbackText(entry?.body)
  };
}

function generateReports(driversData, config) {
  const thresholds = resolveThresholds(config ? config.thresholds : undefined);
  const limits = config && config.detailPageLimits ? {
    first: Number(config.detailPageLimits.first_page) || 13,
    other: Number(config.detailPageLimits.other_pages) || 16
  } : { first: 13, other: 16 };
  const computedStats = driversData.map(driverData => {
    let violationsSum = 0;
    let totalSum = 0;
    (driverData.events || []).forEach(event => {
      const violations = Number(event.violations) || 0;
      const total = Number(event.total) || 0;
      violationsSum += violations;
      totalSum += total;
    });
    const rate = totalSum > 0 ? Math.round((violationsSum / totalSum) * 1000) / 10 : 0;
    return {
      driverId: driverData.driverId,
      rate,
      violationsSum,
      totalSum
    };
  });

  const sortedByRate = [...computedStats].sort((a, b) => a.rate - b.rate);
  let currentRank = 0;
  let lastRate = null;
  const rankMap = new Map();
  sortedByRate.forEach((item, index) => {
    if (lastRate === null || item.rate !== lastRate) {
      currentRank = index + 1;
      lastRate = item.rate;
    }
    rankMap.set(item.driverId, currentRank);
  });
  const totalDrivers = driversData.length;

  const reports = driversData.map(driverData => {
    const stats = computedStats.find(s => s.driverId === driverData.driverId) || { rate: 0 };
    const eventMap = driverData.events.reduce((map, event) => {
      map[event.id] = event;
      return map;
    }, {});

    const finalReportData = {
      driverId: driverData.driverId,
      pageTitle: config.pageTitle,
      officeName: driverData.officeName,
      driverName: driverData.driverName,
      avgViolationRatePct: stats.rate,
      rank: {
        total: totalDrivers,
        position: rankMap.get(driverData.driverId) || totalDrivers
      },
      highlights_gaiyou: [],
      highlights_sasetumae: [], // この行を追加
      highlights_sasetuchuu: [],
      sections: [],
      // シーンページ
      sasetumaePages: [],
      sasetuchuuPages: []
    };

    // Generate Highlights(概要)
    const overviewTexts = (driverData.stats && driverData.stats.overviewHighlights) || {};
    const overviewConfig = config.highlights_gaiyou || {};
    HIGHLIGHT_KINDS.forEach(kind => {
      const meta = overviewConfig[kind] || {};
      const entry = {
        title: overviewTexts[`${kind}_title`],
        body: overviewTexts[`${kind}_body`]
      };
      finalReportData.highlights_gaiyou.push(buildHighlight(kind, meta, entry));
    });

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
        const tone = determineTone(rate, thresholds);

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
        const FIRST_PAGE_LIMIT = limits.first;
        const OTHER_PAGE_LIMIT = limits.other;
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
        const sectionHighlightMeta = (sec.highlightsKey && config[sec.highlightsKey]) ? config[sec.highlightsKey] : {};
        const highlightTexts = (ev && ev.highlightTexts) ? ev.highlightTexts : {};
        HIGHLIGHT_KINDS.forEach(kind => {
          const meta = sectionHighlightMeta[kind] || {};
          const entry = {
            title: highlightTexts[`${kind}_title`],
            body: highlightTexts[`${kind}_body`]
          };
          if (!entry.title && entry.title !== '') {
            entry.title = undefined;
          }
          if (!entry.body && entry.body !== '') {
            entry.body = undefined;
          }
          if (entry.body === undefined && Object.prototype.hasOwnProperty.call(highlightTexts, kind)) {
            entry.body = highlightTexts[kind];
          }
          highlights.push(buildHighlight(kind, meta, entry));
        });

        details.push({ key: sec.key, title: sec.title, pages, highlights, eventId: sec.eventId });
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
      // 概要テーブル向け: 各イベントIDの開始ページ番号を計算
      const startPageByEventId = {};
      let pageCounter = 1; // 概要が1ページ
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
