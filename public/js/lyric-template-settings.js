/**
 * Elitesand Pro 排版模板設定橋接器 (Template Settings Bridge)
 *
 * 過去每個模板的專屬設定都在 display.js 的 applyLyricSettings() 裡手工接線：
 *   if (s.template === 'lightboard') { dataset.x = ...; dataset.y = ...; }
 *   else { delete dataset.x; delete dataset.y; }
 * 每加一個模板就要改那一大段中央程式，而且很容易忘記寫 else 的 delete ——
 * 忘了就會發生「切模板後上一個模板的 dataset 殘留」這類難查的畫面 bug。
 *
 * 這個橋接器把「有哪些旋鈕、預設、範圍、寫去 DOM 哪裡」變成宣告：每個模板在
 * LyricTemplates.register({ ..., settings: [...] }) 裡自己帶一份 schema，切模板時
 * 本橋接器：
 *   1. 依 settings schema 把 active 模板的旋鈕寫進 body.dataset / body.style / body.classList
 *   2. 把「所有其他模板宣告過、但這次沒用到」的同類 key 一律清掉（統一的 else-delete）
 *
 * 只負責「純設定 → DOM 狀態」這一層；不碰時鐘、不碰 onFrame、不碰 setTemplate。
 * display.js 仍負責在呼叫 setTemplate() 之前先呼叫本橋接器（dataset 要先就位，模板
 * mount 時才讀得到正確值）。
 *
 * ── 欄位型別（field.type）────────────────────────────────────────────────
 *   enum    { key, target, values:[...], default }         values 內才收，否則 default
 *   int     { key, target, min, max, default }             Math.round → clamp；非數字 → default
 *   bool01  { key, target, default:true|false }            寫 '1' / '0'
 *                                                          default:true  → 只有明確 === false 才 '0'
 *                                                          default:false → 只有 truthy 才 '1'
 *   text    { key, target }                                非空字串 → trim 後寫入；空 → 移除該屬性
 *   flag    { key, className }                             classList.toggle(className, !!value)
 *
 * ── target 語法 ────────────────────────────────────────────────────────
 *   'data:<datasetKey>'    寫 document.body.dataset[datasetKey]
 *   'cssvar:<--name>'      寫 document.body.style 的自訂屬性
 *   （flag 型別不看 target，改看 className）
 *   一個欄位可用 targets:['data:foo','cssvar:--foo'] 同時寫多個目標（同一個計算值）。
 */
(function (global) {
  'use strict';

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // 一個欄位可能寫多個 target
  function fieldTargets(field) {
    if (Array.isArray(field.targets)) return field.targets;
    if (field.target) return [field.target];
    return [];
  }

  // 計算 enum/int/bool01/text 欄位這次要寫的字串值；回傳 null 代表「移除該屬性」
  function computeValue(field, raw) {
    switch (field.type) {
      case 'enum': {
        const values = field.values || [];
        return values.indexOf(raw) >= 0 ? raw : field.default;
      }
      case 'int': {
        const n = Math.round(Number(raw));
        const v = Number.isFinite(n) ? clamp(n, field.min, field.max) : field.default;
        return String(v);
      }
      case 'bool01': {
        if (field.default === true) return raw === false ? '0' : '1';
        return raw ? '1' : '0';
      }
      case 'text': {
        return (typeof raw === 'string' && raw.trim()) ? raw.trim() : null;
      }
      default:
        return null;
    }
  }

  function writeTarget(doc, target, value) {
    const body = doc.body;
    if (!body) return;
    const colon = target.indexOf(':');
    const kind = target.slice(0, colon);
    const name = target.slice(colon + 1);
    if (kind === 'data') {
      if (value === null) delete body.dataset[name];
      else body.dataset[name] = value;
    } else if (kind === 'cssvar') {
      if (value === null) body.style.removeProperty(name);
      else body.style.setProperty(name, value);
    }
  }

  function clearTarget(doc, target) {
    writeTarget(doc, target, null);
  }

  // 套用單一模板的 settings schema（active 模板才會走到這裡）
  function applyFields(doc, fields, settings) {
    for (const field of fields) {
      if (field.type === 'flag') {
        if (doc.body) doc.body.classList.toggle(field.className, !!settings[field.key]);
        continue;
      }
      const value = computeValue(field, settings[field.key]);
      for (const t of fieldTargets(field)) writeTarget(doc, t, value);
    }
  }

  // 蒐集一份 schema 佔用的所有 target 字串與 class 名（用來讓非 active 模板不去清掉
  // active 模板正在用的共用 key，例如 STAGE_SAFE 同時掛在 pulse/facet/paperstrip… 上）。
  function collectOwned(fields, targets, classes) {
    for (const field of fields || []) {
      if (field.type === 'flag') { classes.add(field.className); continue; }
      for (const t of fieldTargets(field)) targets.add(t);
    }
  }

  // 清掉某個模板 schema 宣告過的 target / class，但跳過 active 模板也在用的（keepT / keepC）。
  function clearFields(doc, fields, keepT, keepC) {
    for (const field of fields) {
      if (field.type === 'flag') {
        if (doc.body && !keepC.has(field.className)) doc.body.classList.remove(field.className);
        continue;
      }
      for (const t of fieldTargets(field)) {
        if (!keepT.has(t)) clearTarget(doc, t);
      }
    }
  }

  // ── 多個模板共用的 schema 片段 ─────────────────────────────────────────
  // 舞台系（Pulse / Facet / Drift / Aura）與 paperstrip / mirror 共用同一套
  // 「中央安全距離」：dataset 給 JS 佈局讀、CSS var 給 .pos-left/.pos-right 邊界讀，
  // 兩個目標同一個值。
  const STAGE_SAFE = Object.freeze([
    Object.freeze({
      key: 'stageSafeMargin', type: 'int', min: 2, max: 25, default: 2,
      targets: ['data:stageSafeMargin', 'cssvar:--stage-safe-margin'],
    }),
    Object.freeze({ key: 'stageShowSafeZoneOnObs', type: 'flag', className: 'stage-show-safe-zone' }),
  ]);

  /**
   * 依目前設定套用 active 模板的專屬設定，並清掉其他模板殘留的同類狀態。
   * @param {object} settings  lyric-settings（至少要有 settings.template）
   * @param {Document} [doc=document]
   */
  function apply(settings, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body || !settings || typeof settings !== 'object') return;
    const activeId = typeof settings.template === 'string' ? settings.template : '';

    const registry = global.LyricTemplates;
    const templates = (registry && typeof registry.list === 'function')
      ? registry.list().map((t) => registry.get(t.id)).filter(Boolean)
      : [];

    // active 模板佔用的 target / class：非 active 模板清理時要跳過這些，
    // 否則共用片段（STAGE_SAFE）會被其他也宣告它的模板清掉。
    const keepT = new Set();
    const keepC = new Set();
    const activeTpl = templates.find((t) => t.id === activeId);
    if (activeTpl && Array.isArray(activeTpl.settings)) collectOwned(activeTpl.settings, keepT, keepC);

    // 先套用 active 模板，再清其他模板殘留
    if (activeTpl && Array.isArray(activeTpl.settings) && activeTpl.settings.length) {
      applyFields(doc, activeTpl.settings, settings);
    }
    for (const tpl of templates) {
      if (tpl.id === activeId) continue;
      const fields = Array.isArray(tpl.settings) ? tpl.settings : null;
      if (!fields || fields.length === 0) continue;
      clearFields(doc, fields, keepT, keepC);
    }
  }

  const LyricTemplateSettings = { apply, STAGE_SAFE, _computeValue: computeValue };

  if (typeof module !== 'undefined' && module.exports) module.exports = LyricTemplateSettings;
  global.LyricTemplateSettings = LyricTemplateSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
