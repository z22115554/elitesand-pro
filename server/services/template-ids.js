/**
 * 內建（免費）歌詞模板 ID 清單，同時被 template-delivery.js 與
 * template-package-install.js 使用——抽出來是為了避免這兩支互相 require 形成循環依賴。
 * classic 是 karaoke.js 內建的免費預設，不在這個清單裡（它不走加密遞送）。
 */
'use strict';

const BUILTIN_TEMPLATE_IDS = new Set(['pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow']);

module.exports = { BUILTIN_TEMPLATE_IDS };
