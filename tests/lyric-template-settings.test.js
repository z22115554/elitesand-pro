'use strict';

/**
 * LyricTemplateSettings 橋接器行為測試。
 *
 * 驗證「模板宣告 settings schema → 橋接器統一寫 body.dataset / class / cssvar，
 * 並清掉切走的模板殘留」這條契約，重點在幾個歷史上真的踩過的坑：
 *  - 忘了 else-delete 造成切模板後上一個模板的 dataset 殘留
 *  - 多個模板共用同一段 schema（STAGE_SAFE）時，非 active 模板不可清掉 active 正在用的 key
 *  - bool01 兩種預設語義（=== false vs truthy）
 *  - text 型別空字串要移除屬性
 */

const path = require('path');

// 純模組，直接 require（同時支援 module.exports 與 global 掛載）
const LyricTemplateSettings = require(path.join(__dirname, '..', 'public', 'js', 'lyric-template-settings.js'));

// ── 極簡 DOM stub：只實作 body.dataset / body.classList / body.style ──
function makeDoc() {
  const dataset = {};
  const classes = new Set();
  const styleMap = new Map();
  return {
    body: {
      dataset,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
        contains: (c) => classes.has(c),
      },
      style: {
        setProperty: (k, v) => styleMap.set(k, String(v)),
        removeProperty: (k) => styleMap.delete(k),
        getPropertyValue: (k) => styleMap.get(k) || '',
      },
    },
    _dataset: dataset,
    _classes: classes,
    _style: styleMap,
  };
}

// 造一個假的 LyricTemplates 註冊表，塞進測試用的模板 schema
function withRegistry(templates, run) {
  const prev = global.LyricTemplates;
  global.LyricTemplates = {
    list: () => templates.map((t) => ({ id: t.id, label: t.id })),
    get: (id) => templates.find((t) => t.id === id) || null,
  };
  try { run(); } finally { global.LyricTemplates = prev; }
}

function register({ test, eq, ok }) {
  const SAFE = LyricTemplateSettings.STAGE_SAFE;

  const templates = [
    {
      id: 'lightboard',
      settings: [
        { key: 'lightboardFont', type: 'enum', values: ['cubic11', 'boutique9x9'], default: 'cubic11', target: 'data:lightboardFont' },
        { key: 'lightboardPan', type: 'bool01', default: true, target: 'data:lightboardPan' },
        { key: 'lightboardIdleMarquee', type: 'bool01', default: true, target: 'data:lightboardIdle' },
        { key: 'lightboardSlideIn', type: 'bool01', default: false, target: 'data:lightboardSlide' },
      ],
    },
    {
      id: 'columnflow',
      settings: [
        { key: 'columnflowMaxLines', type: 'int', min: 1, max: 6, default: 4, target: 'data:columnflowMaxLines' },
        { key: 'columnflowShowSafeZoneOnObs', type: 'flag', className: 'cf-show-safe-zone' },
      ],
    },
    {
      id: 'ktv',
      settings: [
        { key: 'ktvInterludeText', type: 'text', target: 'data:ktvInterludeText' },
      ],
    },
    { id: 'pulse', settings: [...SAFE] },
    { id: 'paperstrip', settings: [
      { key: 'paperstripOrient', type: 'enum', values: ['horizontal', 'vertical'], default: 'horizontal', target: 'data:paperstripOrient' },
      ...SAFE,
    ] },
  ];

  test('LyricTemplateSettings：active 模板的旋鈕寫進 body.dataset（enum/int 夾範圍）', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      LyricTemplateSettings.apply({ template: 'lightboard', lightboardFont: 'boutique9x9', lightboardPan: true }, doc);
      eq(doc._dataset.lightboardFont, 'boutique9x9', 'enum 命中值要寫入：');
      eq(doc._dataset.lightboardPan, '1', 'bool01 default:true 非 false → 1：');

      const doc2 = makeDoc();
      LyricTemplateSettings.apply({ template: 'columnflow', columnflowMaxLines: 99 }, doc2);
      eq(doc2._dataset.columnflowMaxLines, '6', 'int 超過上限要夾到 max：');
      const doc3 = makeDoc();
      LyricTemplateSettings.apply({ template: 'columnflow', columnflowMaxLines: 'x' }, doc3);
      eq(doc3._dataset.columnflowMaxLines, '4', 'int 非數字要退回 default：');
    });
  });

  test('LyricTemplateSettings：bool01 兩種預設語義', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      LyricTemplateSettings.apply({ template: 'lightboard', lightboardPan: false, lightboardIdleMarquee: undefined, lightboardSlideIn: true }, doc);
      eq(doc._dataset.lightboardPan, '0', 'default:true 明確 false → 0：');
      eq(doc._dataset.lightboardIdle, '1', 'default:true undefined → 1：');
      eq(doc._dataset.lightboardSlide, '1', 'default:false truthy → 1：');
      const doc2 = makeDoc();
      LyricTemplateSettings.apply({ template: 'lightboard' }, doc2);
      eq(doc2._dataset.lightboardSlide, '0', 'default:false 未提供 → 0：');
    });
  });

  test('LyricTemplateSettings：text 型別空字串移除該 dataset 屬性', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      doc._dataset.ktvInterludeText = '舊值';
      LyricTemplateSettings.apply({ template: 'ktv', ktvInterludeText: '  ' }, doc);
      ok(!('ktvInterludeText' in doc._dataset), '空白字串必須刪掉屬性而非寫空字串：');
      const doc2 = makeDoc();
      LyricTemplateSettings.apply({ template: 'ktv', ktvInterludeText: '  副歌  ' }, doc2);
      eq(doc2._dataset.ktvInterludeText, '副歌', '非空字串要 trim 後寫入：');
    });
  });

  test('LyricTemplateSettings：切走的模板殘留 dataset / class 一律清掉', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      // 先在 lightboard
      LyricTemplateSettings.apply({ template: 'lightboard', lightboardFont: 'cubic11' }, doc);
      ok('lightboardFont' in doc._dataset, '先確定 lightboard 的 key 有寫入：');
      // 切到 columnflow：lightboard 的 key 必須被清掉
      LyricTemplateSettings.apply({ template: 'columnflow', columnflowMaxLines: 3, columnflowShowSafeZoneOnObs: true }, doc);
      ok(!('lightboardFont' in doc._dataset), '切模板後上一個模板的 dataset 不可殘留：');
      ok(!('lightboardPan' in doc._dataset), '切模板後上一個模板的 dataset 不可殘留（2）：');
      eq(doc._dataset.columnflowMaxLines, '3', '新模板的 key 要寫入：');
      ok(doc._classes.has('cf-show-safe-zone'), 'flag 型別 true → class 加上：');
      // 再切到 ktv：columnflow 的 class 也要移除
      LyricTemplateSettings.apply({ template: 'ktv' }, doc);
      ok(!doc._classes.has('cf-show-safe-zone'), '切模板後 flag class 不可殘留：');
    });
  });

  test('LyricTemplateSettings：共用 STAGE_SAFE — 非 active 模板不可清掉 active 正在用的 key', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      // pulse 與 paperstrip 都宣告了 STAGE_SAFE；active = pulse 時 paperstrip 的 clearFields
      // 不可把 pulse 剛寫的 stageSafeMargin / --stage-safe-margin 清掉
      LyricTemplateSettings.apply({ template: 'pulse', stageSafeMargin: 15, stageShowSafeZoneOnObs: true }, doc);
      eq(doc._dataset.stageSafeMargin, '15', 'active 模板的共用 key 要保留（dataset）：');
      eq(doc._style.get('--stage-safe-margin'), '15', 'active 模板的共用 key 要保留（cssvar）：');
      ok(doc._classes.has('stage-show-safe-zone'), 'active 模板的共用 flag 要保留：');
    });
  });

  test('LyricTemplateSettings：切到不含 STAGE_SAFE 的模板時，共用 key 被清掉', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      LyricTemplateSettings.apply({ template: 'paperstrip', paperstripOrient: 'vertical', stageSafeMargin: 20 }, doc);
      eq(doc._dataset.stageSafeMargin, '20', '先確定 paperstrip 有寫共用 key：');
      LyricTemplateSettings.apply({ template: 'lightboard' }, doc);
      ok(!('stageSafeMargin' in doc._dataset), '切到 lightboard（無 STAGE_SAFE）→ 共用 dataset key 清掉：');
      ok(!('paperstripOrient' in doc._dataset), '切到 lightboard → paperstrip 專屬 key 也清掉：');
      eq(doc._style.get('--stage-safe-margin'), undefined, '切到 lightboard → 共用 cssvar 清掉：');
    });
  });

  test('LyricTemplateSettings：沒有 settings 的模板（如 classic / wordscape）不寫任何東西、也清掉全部', () => {
    withRegistry(templates, () => {
      const doc = makeDoc();
      LyricTemplateSettings.apply({ template: 'pulse', stageSafeMargin: 12 }, doc);
      ok('stageSafeMargin' in doc._dataset, '先確定有殘留可清：');
      LyricTemplateSettings.apply({ template: 'classic' }, doc); // classic 不在 registry
      ok(!('stageSafeMargin' in doc._dataset), 'active 模板無 schema 時，其他模板殘留仍要被清：');
    });
  });

  test('LyricTemplateSettings：settings 非物件或缺 body 時安全 no-op', () => {
    withRegistry(templates, () => {
      LyricTemplateSettings.apply(null, makeDoc());
      LyricTemplateSettings.apply({ template: 'lightboard' }, { body: null });
      LyricTemplateSettings.apply({}, makeDoc()); // 無 template 欄位
      // 沒有丟例外即通過
      ok(true, '不丟例外：');
    });
  });
}

module.exports = { register };
