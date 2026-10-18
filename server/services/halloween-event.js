/**
 * 萬聖節募資活動：data/halloween-event.json
 *
 * 南瓜燈進度條＋萬聖節名牌疊加層（/halloween）的資料來源，邏輯在 seasonal-event.js 共用核心。
 * 活動到 2026-11-07 整天結束（台灣時間 11-08 00:00 截止）；跨過截止時間程式開著照常運作，
 * 下次啟動才關閉，斗內紀錄檔保留。
 */
const { createSeasonalEvent } = require('./seasonal-event');

// 材料是投票選擇；名牌是金額等級，兩者獨立。
const INGREDIENTS = Object.freeze(['candy', 'ghost', 'bat', 'pumpkin', 'witch']);
// 保留清水樣式供舊網址與素材相容；金額分級使用其餘五種。
const TREAT_STYLES = Object.freeze(['water', ...INGREDIENTS]);

const halloweenEvent = createSeasonalEvent({
  fileName: 'halloween-event.json',
  label: '萬聖節活動',
  logTag: 'HalloweenEvent',
  endsAt: '2026-11-08T00:00:00+08:00',
  styles: TREAT_STYLES,
  defaultTiers: { water: 1, candy: 1, ghost: 100, bat: 300, pumpkin: 500, witch: 1000 },
  styleByAmount: true,
  defaults: { title: '魔女的大鍋', doneText: '大鍋滿了，謝謝大家！', goal: 5000, base: 0 },
  scaleKeys: ['treatScale', 'pumpkinScale'],
  ingredients: INGREDIENTS,
  plainStyle: 'water',
});

module.exports = { ...halloweenEvent, TREAT_STYLES, INGREDIENTS };
