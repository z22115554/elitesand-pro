/**
 * 中秋募資活動：data/moon-event.json
 *
 * 月亮進度條＋燈籠名牌疊加層（/moon）的資料來源。邏輯都在 seasonal-event.js 的共用核心，
 * 這裡只是中秋這一檔的設定；明年要再開，改截止時間就好。
 */
const { createSeasonalEvent } = require('./seasonal-event');

// 由便宜到貴排列；自動模式取「門檻 ≤ 金額」裡門檻最高的那一種。
const LANTERN_STYLES = Object.freeze(['paper', 'red', 'pomelo', 'palace', 'rabbit']);

const moonEvent = createSeasonalEvent({
  fileName: 'moon-event.json',
  label: '中秋活動',
  logTag: 'MoonEvent',
  endsAt: '2026-10-01T00:00:00+08:00',
  styles: LANTERN_STYLES,
  defaultTiers: { paper: 1, red: 100, pomelo: 300, palace: 500, rabbit: 1000 },
  defaults: { title: '中秋團圓夜', doneText: '月圓了，謝謝大家！', goal: 5000, base: 0 },
  scaleKeys: ['lanternScale', 'moonScale'],
});

module.exports = { ...moonEvent, LANTERN_STYLES };
