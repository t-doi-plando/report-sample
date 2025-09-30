const HIGHLIGHT_KINDS = ['danger', 'warn', 'good'];
const TONE_PRIORITY = { danger: 3, warn: 2, good: 1 };

function sortTonesByPriority(tones = []) {
  return tones.slice().sort((a, b) => (TONE_PRIORITY[b] || 0) - (TONE_PRIORITY[a] || 0));
}

function normalizeEventId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : null;
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
  const highlight = {
    kind: base.kind,
    badge: base.badge,
    title: fallbackTitle(entry?.title),
    text: fallbackText(entry?.body)
  };
  if (entry && entry.metric) {
    highlight.metric = entry.metric;
  }
  return highlight;
}

function lookupEventTitle(config, eventIdStr) {
  if (!config || !eventIdStr) return null;
  const itemInfo = config.itemMap && config.itemMap[eventIdStr];
  if (itemInfo && typeof itemInfo.name === 'string' && itemInfo.name.trim().length > 0) {
    return itemInfo.name;
  }
  const detailList = Array.isArray(config.detailSections) ? config.detailSections : [];
  const detail = detailList.find(sec => normalizeEventId(sec.eventId) === eventIdStr);
  if (detail && typeof detail.title === 'string' && detail.title.trim().length > 0) {
    return detail.title;
  }
  return null;
}

function generateReports(driversData, config) {
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
    const highlightToneOverrides = new Map();
    const overviewConfig = config.highlights_gaiyou || {};
    HIGHLIGHT_KINDS.forEach(kind => {
      const meta = overviewConfig[kind] || {};
      const eventIdRaw = overviewTexts[`${kind}_eventId`];
      const normalizedEventId = normalizeEventId(eventIdRaw);
      if (normalizedEventId) {
        if (!highlightToneOverrides.has(normalizedEventId)) {
          highlightToneOverrides.set(normalizedEventId, new Set());
        }
        highlightToneOverrides.get(normalizedEventId).add(kind);
      }
      const titleRaw = overviewTexts[`${kind}_title`];
      let resolvedTitle = titleRaw;
      if ((!resolvedTitle || resolvedTitle.trim().length === 0) && normalizedEventId) {
        const fallbackTitleValue = lookupEventTitle(config, normalizedEventId);
        if (fallbackTitleValue) {
          resolvedTitle = fallbackTitleValue;
        }
      }
      const entry = {
        title: resolvedTitle,
        body: overviewTexts[`${kind}_body`],
        eventId: normalizedEventId ? Number(normalizedEventId) : undefined
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
        const eventIdKey = normalizeEventId(event.id);
        const toneSet = eventIdKey ? highlightToneOverrides.get(eventIdKey) : undefined;
        const toneList = toneSet ? sortTonesByPriority(Array.from(toneSet)) : [];
        const tone = toneList[0] || '';

        const tags = toneList;

        sectionsMap[itemInfo.maneuver].rows.push({
          no: event.id,
          name: itemInfo.name,
          tag: '',
          tags,
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
        const pushDateChunk = (year, dateLabel, scenesChunk) => {
          const last = current.groups[current.groups.length - 1];
          if (last && last.year === year) {
            last.dates.push({ dateLabel, scenes: scenesChunk });
          } else {
            current.groups.push({ year, dates: [{ dateLabel, scenes: scenesChunk }] });
          }
          current.rowCount += scenesChunk.length;
        };
        const closePage = () => {
          if (current.rowCount > 0) {
            pagesTmp.push({ groups: current.groups });
          }
          current = { groups: [], rowCount: 0, limit: OTHER_PAGE_LIMIT };
        };
        for (const g of groups) {
          for (const d of g.dates) {
            let remaining = Array.isArray(d.scenes) ? d.scenes.slice() : [];
            while (remaining.length > 0) {
              if (current.rowCount >= current.limit && current.rowCount > 0) {
                closePage();
              }
              const available = Math.max(current.limit - current.rowCount, 0);
              const chunkSize = Math.min(remaining.length, available > 0 ? available : current.limit);
              const chunk = remaining.splice(0, chunkSize);
              pushDateChunk(g.year, d.dateLabel, chunk);
            }
          }
        }
        closePage();
        const pages = pagesTmp;

        // ハイライト生成
        const highlights = [];
        const sectionHighlightMeta = (sec.highlightsKey && config[sec.highlightsKey]) ? config[sec.highlightsKey] : {};
        const highlightTexts = (ev && ev.highlightTexts) ? ev.highlightTexts : {};
        const violationsVal = Number(ev && ev.violations !== undefined ? ev.violations : 0);
        const totalVal = Number(ev && ev.total !== undefined ? ev.total : 0);
        const riskVal = Number(ev && ev.risk !== undefined ? ev.risk : 0);
        HIGHLIGHT_KINDS.forEach(kind => {
          const meta = sectionHighlightMeta[kind] || {};
          const entry = {
            title: highlightTexts[`${kind}_title`],
            body: highlightTexts[`${kind}_body`]
          };
          if (kind === 'danger') {
            entry.metric = { risk: riskVal };
          }
          if (kind === 'warn') {
            const rate = totalVal > 0 ? Math.round((violationsVal / totalVal) * 1000) / 10 : 0;
            entry.metric = {
              rate,
              detail: totalVal > 0 ? `(${violationsVal}回/${totalVal}回)` : ''
            };
          }
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
