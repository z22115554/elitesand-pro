'use strict';

// 核心回歸測試（i18n）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  failed,
  test,
  eq,
  ok,
} = require('./core-harness');

console.log('\n🌐 17. M6.1 介面語系層');
{
  const i18n = require('../public/js/i18n');
  const i18nSource = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  const catalogs = i18n.catalogs;
  const baselineKeys = Object.keys(catalogs['zh-TW']).sort();

  test('五個支援語系都有完整且非空的相同字串鍵', () => {
    eq(i18n.LOCALES.join('|'), 'zh-TW|en|ja|ko|zh-CN');
    i18n.LOCALES.forEach((locale) => {
      eq(Object.keys(catalogs[locale]).sort().join('|'), baselineKeys.join('|'), `${locale} 字串鍵：`);
      baselineKeys.forEach((key) => ok(String(catalogs[locale][key] || '').trim(), `${locale}.${key} 不得為空：`));
    });
  });

  test('瀏覽器語系別名會正規化到支援的五種語系', () => {
    eq(i18n.normalizeLocale('zh-Hant-HK'), 'zh-TW');
    eq(i18n.normalizeLocale('zh_Hans_CN'), 'zh-CN');
    eq(i18n.normalizeLocale('en-US'), 'en');
    eq(i18n.normalizeLocale('ja-JP'), 'ja');
    eq(i18n.normalizeLocale('ko-KR'), 'ko');
    eq(i18n.normalizeLocale('fr-FR'), null);
  });

  test('翻譯插值與 OBS lang 網址不改變既有路由', () => {
    i18n.setLocale('ja', { persist: false, updateQuery: false });
    eq(i18n.t('controller.lyricsLoaded', { count: 12 }), '歌詞を読み込みました（12 行）');
    const localized = new URL(i18n.localizeUrl('http://localhost:3000/display?preview=1'));
    eq(localized.pathname, '/display');
    eq(localized.searchParams.get('preview'), '1');
    eq(localized.searchParams.get('lang'), 'ja');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
    eq(new URL(i18n.localizeUrl(localized.href)).searchParams.get('lang'), null);
  });

  test('HTML 與動態 UI 引用的翻譯鍵都存在', () => {
    const htmlFiles = ['index.html', 'controller.html', 'display.html', 'setlist.html', 'prompter.html'];
    const jsFiles = ['theme.js', 'nav.js', 'app-style-sync.js', 'app-setlist-panel.js', 'app-toast-utils.js', 'app-playlist.js', 'app-twitch.js', 'app-youtube-import.js', 'app-diagnostics.js', 'error-handler.js', 'eula-gate.js', 'danger-confirm.js', 'controller.js', 'pin-auth.js', 'setlist.js', 'prompter.js', 'lyric-extras.js', 'app-playback.js', 'app.js'];
    const referenced = new Set();
    htmlFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
      ok(source.includes('/js/i18n.js'), `${file} 必須載入語系層：`);
      for (const match of source.matchAll(/data-i18n(?:-title|-aria-label|-placeholder|-alt|-label)?="([^"]+)"/g)) referenced.add(match[1]);
    });
    jsFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8');
      for (const match of source.matchAll(/(?:I18n\.t|workspaceText|(?:^|[^\w])t)\(\s*['"]([^'"]+)['"]/gm)) referenced.add(match[1]);
    });
    referenced.forEach((key) => ok(baselineKeys.includes(key), `缺少翻譯鍵 ${key}：`));
  });

  test('播放狀態重繪不繞過 i18n', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    const playbackSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
    ok(appSource.includes("t('prompter.noLyrics')"), '歌詞預覽空狀態必須使用語系鍵：');
    ok(playbackSource.includes("t('player.noTrack')"), '停止播放後的播放器空狀態必須使用語系鍵：');
    ok(playbackSource.includes("t(tr ? 'home.lyricNow.noTimeline' : 'home.lyricNow.empty')"), '目前歌詞重繪不得寫死繁中：');
  });

  test('EULA 與桌面操作視窗維持 dialog 語意與鍵盤焦點管理', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const eula = fs.readFileSync(path.join(__dirname, '../public/js/eula-gate.js'), 'utf8');
    const modalFocus = fs.readFileSync(path.join(__dirname, '../public/js/modal-focus.js'), 'utf8');
    const labels = {
      'lyrics-paste-modal': 'lyrics-paste-title',
      'track-edit-modal': 'track-edit-title-heading',
      'lyrics-timeline-modal': 'lyrics-timeline-title',
      'help-modal': 'help-modal-title',
      'playlist-export-modal': 'playlist-export-title',
      'playlist-import-modal': 'playlist-import-title',
      'lyric-preset-name-modal': 'lyric-preset-name-title',
      'pin-required-modal': 'pin-required-title',
      'pin-manage-modal': 'pin-manage-title',
    };
    // 2026-09-26 改版：歌詞選擇器改成內嵌在直播頁「準備區」的區塊，不再是 modal；
    // 改為檢查它有群組語意與可存取名稱，且不會被誤標成 aria-modal。
    {
      const start = html.indexOf('id="lyrics-picker-modal"');
      const section = html.slice(start, start + 600);
      ok(start >= 0 && section.includes('data-inline-picker'), '歌詞選擇器應內嵌在準備區：');
      ok(section.includes('role="group"') && section.includes('aria-labelledby="lyrics-picker-title"') && !section.includes('aria-modal'), '內嵌歌詞選擇器要有群組語意、可存取名稱且不是 modal：');
    }
    Object.entries(labels).forEach(([modalId, labelId]) => {
      const start = html.indexOf(`id="${modalId}"`);
      const section = html.slice(start, start + 600);
      ok(start >= 0, `找不到 ${modalId}: `);
      ok(section.includes('role="dialog" aria-modal="true"'), `${modalId} 必須有 dialog 語意: `);
      ok(section.includes(`aria-labelledby="${labelId}"`), `${modalId} 必須有可存取名稱: `);
    });
    ['previousFocus', 'trapFocus', 'stopImmediatePropagation', "textBox.focus()", "document.removeEventListener('keydown', trapFocus, true)"]
      .forEach((fragment) => ok(eula.includes(fragment), `EULA 閘門必須管理焦點（缺少 ${fragment}）: `));
    ['FOCUSABLE_SELECTOR', 'previousFocus', 'data-modal-initial-focus', "event.key !== 'Tab'", 'target.focus()']
      .forEach((fragment) => ok(modalFocus.includes(fragment), `桌面 modal 必須限制焦點並在關閉後還原（缺少 ${fragment}）: `));
  });

  test('非正常關閉回報與日文播放提示維持中性且正確的語意', () => {
    const autoRows = require('../public/js/i18n-auto');
    eq(autoRows['播放後，'][2], '再生後、', '日文播放提示不可誤寫成玩遊戲後：');
    const actual = catalogs.en['crash.prefillActual'];
    ok(!/without me doing anything/i.test(actual), '非正常關閉回報不可預設歸咎為使用者未操作：');
    ok(/shut down cleanly/i.test(actual) && /closed manually/i.test(actual), '回報預填必須如實涵蓋手動關閉：');
  });

  test('示範歌詞兩句只翻譯繁中前綴，後面英文原樣保留', () => {
    const displaySource = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8');
    ok(displaySource.includes("t('preview.sampleLine1')"), '示範歌詞第一句必須走具名 i18n key: ');
    ok(displaySource.includes("t('preview.sampleLine2')"), '示範歌詞第二句必須走具名 i18n key: ');
    ['en', 'ja', 'ko', 'zh-CN'].forEach((locale) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      ok(i18n.t('preview.sampleLine1').endsWith('This is an example lyric.'), `${locale} 第一句後面英文不可改：`);
      ok(i18n.t('preview.sampleLine2').endsWith('Font preview sample.'), `${locale} 第二句後面英文不可改：`);
    });
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.translate('這是一句示範用的歌詞 This is an example lyric.'), i18n.t('preview.sampleLine1'), '第一句長尾與具名譯文必須一致：');
    eq(i18n.translate('字體效果測試 Font preview sample.'), i18n.t('preview.sampleLine2'), '第二句長尾與具名譯文必須一致：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('手機配對狀態與撤銷對話框不殘留繁中', () => {
    const styleSync = fs.readFileSync(path.join(__dirname, '../public/js/app-style-sync.js'), 'utf8');
    ok(styleSync.includes("t('system.pairingCreated'"), '建立 QR 狀態必須走具名 i18n key: ');
    ok(styleSync.includes("t('system.pairingRevoked'"), '撤銷狀態必須走具名 i18n key: ');
    ok(styleSync.includes("t('system.pairingRevokeSummary')"), '撤銷確認摘要必須走具名 i18n key: ');
    ok(styleSync.includes("addEventListener('i18n:change', renderPairingStatus)"), '切換語言時必須重繪配對狀態: ');
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.t('system.pairingCreated', { minutes: 5 }), 'QR code created. Scan it within 5 minutes; each code pairs with only one phone.', '英文 QR 建立狀態：');
    eq(i18n.t('system.pairingRevoked', { count: 0 }), 'Revoked 0 phone(s). Generate a new QR code to pair again.', '英文撤銷狀態：');
    eq(i18n.t('system.pairingRevokeSummary'), 'This immediately invalidates every paired phone.', '英文撤銷摘要：');
    eq(i18n.t('system.pairingRevokeImpact'), 'You will need to scan a QR code again before you can control playback.', '英文撤銷影響：');
    eq(i18n.t('system.pairingRevokeConfirm'), 'Revoke', '英文撤銷按鈕：');
    eq(
      i18n.translate('QR Code 已建立，請在 5 分鐘內掃描；每張只能配對一台手機。'),
      i18n.t('system.pairingCreated', { minutes: 5 }),
      '長尾樣板與具名變數譯文必須一致：'
    );
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('Twitch 授權更新失敗原因會先翻譯再插入重連狀態', () => {
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const expected = {
      en: 'Twitch authorization cannot be refreshed right now.',
      ja: 'Twitch の認証情報を現在更新できません。',
      ko: '현재 Twitch 인증을 갱신할 수 없습니다.',
      'zh-CN': '暂时无法更新 Twitch 授权。',
    };
    Object.entries(expected).forEach(([locale, value]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      eq(i18n.t('twitch.runtime.authorizationRefreshUnavailable'), value, `${locale} Twitch 授權更新錯誤：`);
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
    ok(twitchSource.includes("'Twitch 授權暫時無法更新': 'twitch.runtime.authorizationRefreshUnavailable'"));
    ok(twitchSource.includes('const localizedError = localizeRuntimeError(data.lastConnectionError);'));
    ok(twitchSource.includes("t('twitch.runtime.subscriptionFailed', { reason: localizeRuntimeError(data.lastConnectionError)"));
  });

  test('本場直播與設定工作台的動態狀態不混入繁中', () => {
    const samples = {
      en: 'OBS streaming · 42:16 · 8 tracks performed',
      ja: 'OBS 配信中 · 42:16 · 歌唱済み 8 曲',
      ko: 'OBS 송출 중 · 42:16 · 부른 곡 8개',
      'zh-CN': 'OBS 推流中 · 42:16 · 已唱 8 首',
    };
    Object.entries(samples).forEach(([locale, expected]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      const source = i18n.t('home.session.sourceObs');
      eq(i18n.t('home.session.statusLive', { source, duration: '42:16', count: '8' }), expected, `${locale} 直播狀態：`);
      ok(i18n.t('settings.openDetails') !== catalogs['zh-TW']['settings.openDetails'], `${locale} 詳細設定入口不得沿用繁中：`);
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('本場直播與設定工作台的五語字串完整且變數一致', () => {
    const reviewedKeys = baselineKeys.filter((key) => (
      key.startsWith('home.session.')
      || key.startsWith('settings.workspace.')
      || key.startsWith('settings.preview.')
      || key.startsWith('settings.lyrics.')
      || key.startsWith('settings.setlist.')
      || key === 'settings.openDetails'
    ));
    ok(reviewedKeys.length >= 65, '本次設定與直播區塊應有完整的人工審查字串集合：');
    const placeholders = (value) => [...String(value).matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort().join('|');
    reviewedKeys.forEach((key) => {
      const expectedPlaceholders = placeholders(catalogs['zh-TW'][key]);
      i18n.LOCALES.forEach((locale) => {
        const value = catalogs[locale][key];
        ok(typeof value === 'string' && value.trim(), `${locale} 缺少 ${key}：`);
        eq(placeholders(value), expectedPlaceholders, `${locale} ${key} 的變數不一致：`);
      });
    });
    eq(catalogs.en['home.session.copySuccess'], '✓ Chapters copied', '複製多個章節時英文不得使用單數：');
    eq(catalogs.ko['settings.workspace.appearance'], '외관', '韓文 Appearance 應使用軟體介面的「외관」：');
    eq(catalogs.ko['settings.workspace.searchHint'], '현재 템플릿에서 사용할 수 있는 설정만 표시됩니다.', '韓文模板範圍助詞必須自然：');
    eq(catalogs.ko['home.session.confirmSummary'], '이번 방송에서 부른 곡과 YouTube 챕터가 삭제됩니다.', '韓文清除提示語序必須自然：');
    ok(catalogs['zh-CN']['home.session.confirmImpact'].includes('OBS 布局设置'), '簡中 OBS layout 不得沿用「版型」：');
  });

  test('新增簡中介面不混入台灣用語或繁體字', () => {
    const reviewedKeys = baselineKeys.filter((key) => key.startsWith('home.session.') || key.startsWith('settings.'));
    const taiwanOnly = /版型|載入|儲存|紀錄|連線|貼上|音檔|目前|開台|收台|瀏覽器來源|「|」/;
    const traditionalOnly = /儲|載|錄|檔|網|體|開|關|過|這|裡|與|為|後|覽/;
    const offenders = reviewedKeys.filter((key) => taiwanOnly.test(catalogs['zh-CN'][key]) || traditionalOnly.test(catalogs['zh-CN'][key]));
    eq(offenders.length, 0, `新增簡中仍含台灣用語或繁體字（${offenders[0] || ''}）：`);
  });

  test('示範資料功能在五語中使用同一組 sample 術語', () => {
    const autoRows = require('../public/js/i18n-auto');
    const related = Object.entries(autoRows).filter(([source]) => source.includes('示範資料'));
    ok(related.length >= 5, '示範資料相關操作、提示與教學必須一起受守衛：');
    related.forEach(([source, values]) => {
      ok(!/\bdemo\b/i.test(values[1]), `英文「${source}」不得混用 Demo data：`);
      ok(!/デモ/.test(values[2]), `日文「${source}」不得混用デモデータ：`);
      ok(!/데모/.test(values[3]), `韓文「${source}」不得混用데모 데이터：`);
      ok(!/示范/.test(values[4]), `簡中「${source}」應統一使用示例数据：`);
    });
  });

  test('本次新增具名變數與長尾數字變數使用同一譯法', () => {
    const autoRows = require('../public/js/i18n-auto');
    const canonical = (value) => String(value).replace(/\{[^{}]+\}/g, '{}');
    const autoBySource = new Map(Object.entries(autoRows).map(([source, values]) => [canonical(source), values]));
    const reviewedKeys = baselineKeys.filter((key) => key.startsWith('home.session.') || key.startsWith('settings.'));
    reviewedKeys.forEach((key) => {
      const source = catalogs['zh-TW'][key];
      if (!/\{[^{}]+\}/.test(source)) return;
      const autoValues = autoBySource.get(canonical(source));
      if (!autoValues) return;
      i18n.LOCALES.forEach((locale, index) => {
        eq(canonical(catalogs[locale][key]), canonical(autoValues[index]), `${locale} ${key} 與長尾變數模板譯法不一致：`);
      });
    });
  });

  test('桌面首頁與 Twitch 第二批字串不是繁中佔位值', () => {
    const secondBatchKeys = baselineKeys.filter((key) => (
      key.startsWith('home.')
      || key.startsWith('playlist.')
      || key.startsWith('source.')
      || key.startsWith('preview.')
      || key.startsWith('twitch.')
      || key.startsWith('system.')
    ));
    ok(secondBatchKeys.length >= 70, '第二批應有至少 70 個受守衛字串：');
    ['en', 'ja', 'ko'].forEach((locale) => {
      const translatedCount = secondBatchKeys.filter((key) => catalogs[locale][key] !== catalogs['zh-TW'][key]).length;
      ok(translatedCount / secondBatchKeys.length >= 0.95, `${locale} 第二批不得大量沿用繁中：`);
    });
  });

  test('M6.1 長尾字串表涵蓋完整控制面板且五語非空', () => {
    const autoRows = require('../public/js/i18n-auto');
    const entries = Object.entries(autoRows);
    ok(entries.length >= 1800, '完整控制面板長尾至少應有 1,800 個來源片段：');
    entries.forEach(([source, values]) => {
      ok(source.trim(), '長尾來源不得為空：');
      eq(values.length, 5, `${source} 必須同時提供五語：`);
      values.forEach((value, index) => ok(String(value || '').trim(), `${source} 第 ${index + 1} 語不得為空：`));
    });
    ['en', 'ja', 'ko'].forEach((locale, localeOffset) => {
      const translated = entries.filter(([source, values]) => values[localeOffset + 1] !== source).length;
      ok(translated / entries.length >= 0.95, `${locale} 長尾不得大量沿用繁中：`);
    });
  });

  test('長尾表只收人類看得到的文字，不收程式碼與 console log', () => {
    const autoRows = require('../public/js/i18n-auto');
    const entries = Object.entries(autoRows);
    // 抽取腳本曾經把 JS 樣板字面值與 HTML 整串收進表裡：那些 key 永遠比對不到文字節點，
    // 卻會讓每次比對多掃一輪，而且 class/id 被翻譯過會變成無聲的髒資料。
    const fragments = entries.filter(([source]) => /[<>]|\$\{|=>|class=|id="/.test(source));
    eq(fragments.length, 0, `長尾 key 不得含 HTML 或 JS 片段（例如「${fragments[0] ? fragments[0][0].slice(0, 40) : ''}」）：`);
    const fragmentValues = entries.filter(([, values]) => values.some((value) => /<\/?[a-z]+[\s>]|\$\{|=>/.test(String(value))));
    eq(fragmentValues.length, 0, `長尾譯文不得含 HTML 或 JS 片段（例如「${fragmentValues[0] ? fragmentValues[0][0].slice(0, 40) : ''}」）：`);
    const consoleRows = entries.filter(([source]) => /^\[[A-Za-z]/.test(source));
    eq(consoleRows.length, 0, `console log 不進翻譯表（例如「${consoleRows[0] ? consoleRows[0][0].slice(0, 40) : ''}」）：`);
    eq(entries.length, new Set(entries.map(([source]) => source)).size, '長尾表不得有重複 key：');
  });

  test('長尾比對失敗時不掃全表（MutationObserver hot path）', () => {
    // 每個不在表內的文字節點（歌名、時間、數字）都會走一次 miss；
    // 之前的 defensive fallback 會在每次 miss 掃完 2,000 筆做 matchAll。
    ok(
      /if \(autoPatternRows\.length\) return null;[\s\S]{0,200}Object\.entries\(AUTO_ROWS\)/.test(i18nSource),
      'resolveAutoRow 的全表 fallback 必須只在 autoPatternRows 為空時才跑：'
    );
    i18n.setLocale('en', { persist: false, updateQuery: false });
    const started = process.hrtime.bigint();
    for (let index = 0; index < 500; index += 1) i18n.translate(`Unmatched Song Title ${index}`);
    const perCall = Number(process.hrtime.bigint() - started) / 1e6 / 500;
    ok(perCall < 0.2, `比對失敗的單次成本必須遠低於 1ms（實測 ${perCall.toFixed(3)}ms）：`);
    eq(i18n.translate('字級'), 'Font size', 'fallback 收斂後既有比對必須不變：');
    eq(i18n.translate('冷卻 30 秒'), 'Cooldown 30 seconds', 'fallback 收斂後樣板比對必須不變：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾樣板由最具體列匹配，且全部 placeholder 組合都得到對應譯文', () => {
    const autoRows = require('../public/js/i18n-auto');
    const templated = Object.entries(autoRows).filter(([source]) => /\{\d+\}/.test(source));
    ok(templated.length >= 170, '應覆蓋完整動態長尾樣板：');
    i18n.LOCALES.forEach((locale, localeIndex) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      templated.forEach(([source, values]) => {
        const sample = source.replace(/\{(\d+)\}/g, (_, index) => `CAP${index}`);
        const expected = values[localeIndex].replace(/\{(\d+)\}/g, (_, index) => `CAP${index}`);
        eq(i18n.translate(sample), expected, `${locale} 不可被較泛用樣板截走（${source}）：`);
      });
    });
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('已連接 Twitch：正在監聽 !點歌。'),
      'Connected Twitch: Listening for !點歌.',
      '相鄰 placeholder 其中一段為空時仍須保留動態指令：'
    );
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾譯文不得含不可見控制字元', () => {
    const autoRows = require('../public/js/i18n-auto');
    const invisible = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/;
    const offenders = Object.entries(autoRows)
      .filter(([, values]) => values.some((value) => invisible.test(String(value))));
    eq(offenders.length, 0, `長尾譯文仍有零寬或方向控制字元（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
  });

  test('長尾狀態文字保留使用者可理解的語意', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.translate('直播中…等待第一首歌'), 'Live — waiting for the first song', '英文直播等待狀態必須清楚說明目前正在等待第一首歌：');
    eq(i18n.translate('已選歌詞'), 'Lyrics selected', '英文歌詞狀態不得誤解為精選歌詞：');
    i18n.setLocale('ja', { persist: false, updateQuery: false });
    eq(i18n.translate('時長吻合'), '再生時間が一致', '日文時長狀態必須指向播放時間：');
    eq(i18n.translate('正在從各來源搜尋歌詞'), '各ソースから歌詞を検索中', '日文搜尋狀態必須使用進行式：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('人工審查過的高風險長尾不再語意反轉或跨語混入', () => {
    const autoRows = require('../public/js/i18n-auto');
    [
      '星座（暫停提供）',
      '時間軸（暫停提供）',
      '斜線舞台（暫停提供）',
    ].forEach((source) => {
      ok(/temporarily unavailable/i.test(autoRows[source][1]), `英文「${source}」不可把 unavailable 翻成 available：`);
    });
    const throttle = Object.keys(autoRows).find((source) => source.includes('操作太快了，請再等'));
    eq(autoRows[throttle][1], 'You are doing that too quickly. Please wait {seconds} seconds.', '英文限流訊息不可混入簡中：');
    const bulkPlaying = Object.keys(autoRows).find((source) => source.includes('正在播放的歌曲不能批次選取'));
    ok(!/[\u3400-\u9FFF]/.test(autoRows[bulkPlaying][1]), '英文批次操作警告不可混入中文：');
    const floating = Object.keys(autoRows).find((source) => source.startsWith('漂浮：緩慢淡入'));
    ok(/フェードイン/.test(autoRows[floating][2]) && !/フェードアウト/.test(autoRows[floating][2]), '日文漂浮效果不可把淡入寫成淡出：');
    eq(autoRows['OBS 推流中'][3], 'OBS 송출 중', '韓文 OBS 推流狀態須簡潔且可自然組合進狀態列：');
  });

  test('長尾字串表發行阻擋級操作與狀態文案已人工鎖定', () => {
    const autoRows = require('../public/js/i18n-auto');
    const expected = {
      '收到系統匣': [
        'Minimize to system tray',
        'システムトレイに最小化',
        '시스템 트레이로 최소화',
      ],
      '送出 Twitch 公開測試？': [
        'Send public Twitch test?',
        'Twitch の公開テストを送信しますか？',
        'Twitch 공개 테스트를 전송하시겠습니까?',
      ],
      '數字越大越清楚。開著保護時已唱至少 52%、未唱至少 70%。': [
        'Higher values are more visible. With protection on, performed tracks stay at least 52% opaque and upcoming tracks at least 70% opaque.',
        '数値が大きいほど鮮明になります。保護をオンにすると、歌唱済みは最低 52%、未唱は最低 70% になります。',
        '값이 클수록 더 선명합니다. 보호 기능을 켜면 부른 곡의 불투명도는 최소 52%, 예정 곡은 최소 70%로 유지됩니다.',
      ],
      '獎勵已建立；EventSub 正在等待忠誠點數兌換訂閱。': [
        'Rewards created; EventSub is waiting to subscribe to Channel Points redemption events.',
        '報酬を作成しました。EventSub のチャンネルポイント報酬引き換えイベントの購読を待機しています。',
        '보상이 생성되었습니다. EventSub가 채널 포인트 보상 교환 이벤트 구독을 기다리는 중입니다.',
      ],
      '✓ 播放清單匯入完成：{0} 首{1}': [
        '✓ Playlist import complete: {0} tracks{1}',
        '✓ プレイリストのインポートが完了しました：{0} 曲{1}',
        '✓ 재생목록 가져오기가 완료되었습니다: {0}곡{1}',
      ],
      '切歌': [
        'Switch tracks',
        '曲を切り替える',
        '곡 전환',
      ],
      '待確認編號': [
        'Pending-request ID',
        '確認待ち番号',
        '확인 대기 번호',
      ],
      '點歌歷史': [
        'Song request history',
        '曲リクエスト履歴',
        '신청곡 내역',
      ],
      '關閉可減輕負載／更乾淨': [
        'Turning this off reduces load and gives a cleaner look.',
        'オフにすると負荷が軽減され、表示がすっきりします',
        '끄면 부하가 줄고 화면이 더 깔끔해집니다',
      ],
      '完整歌詞畫面，適合需要看見歷史行、拼音或諧音的演出。': [
        'A full lyrics display for performances that need previous lines, romanization, or a phonetic guide.',
        '過去の歌詞行、ローマ字、または発音ガイドを見たい場合に適した完全な歌詞画面です。',
        '전체 가사 화면으로, 이전 가사 줄이나 로마자 또는 발음 가이드를 확인해야 하는 공연에 적합합니다.',
      ],
    };
    Object.entries(expected).forEach(([source, translations]) => {
      eq(autoRows[source].slice(1, 4).join('\u0001'), translations.join('\u0001'), `高風險翻譯不可回歸：「${source}」：`);
    });
    eq(autoRows['暫停兌換'][1], 'Pause redemptions', '英文忠誠點數狀態不可誤譯成 exchange：');
    eq(autoRows['仍然匯入'][1], 'Import anyway', '英文匯入風險按鈕名稱必須與說明一致：');
    ok(autoRows['程式會先看影片類型和時長，避免把直播精華、教學或過長影片誤塞進歌單。確定要唱就按「仍然匯入」；不適合就按「略過這支影片」。勾選「不要再顯示」後，之後所有匯入風險警告都會直接繼續匯入，請只在你確定接受這個風險時使用。'][1].includes('"Import anyway"'), '英文匯入風險說明必須引用正確按鈕名稱：');
  });

  test('第二輪深度審查的截斷、反轉與在地化問題已鎖定', () => {
    const autoRows = require('../public/js/i18n-auto');
    const i18n = require('../public/js/i18n');
    const expected = {
      '不會馬上消失。待確認點歌在逾時前會保留到你選擇拒絕，下載失敗的可重試請求也會留著；重開程式後，尚未處理的請求仍會回到「點歌」頁。': {
        ko: '바로 사라지지 않습니다. 확인 대기 중인 신청곡은 시간이 초과되거나 직접 거절할 때까지 유지되며, 다운로드에 실패해 다시 시도할 수 있는 요청도 남아 있습니다. 프로그램을 다시 실행해도 처리하지 않은 요청은 ‘신청곡’ 페이지에 다시 표시됩니다.',
      },
      '目前授權缺少忠誠點數管理權限，請重新連接 Twitch 一次。': {
        ko: '현재 인증에 채널 포인트 관리 권한이 없습니다. Twitch에 다시 연결해 주세요.',
      },
      '尚無記錄，播放任一首歌後會自動加入。': {
        ko: '아직 기록이 없습니다. 아무 곡이나 재생하면 자동으로 추가됩니다.',
      },
      '要。OBS 是即時去讀這個網址的畫面，如果把程式關掉，OBS 那邊的歌詞畫面也會跟著消失。': {
        ko: '네, 필요합니다. OBS가 이 URL의 화면을 실시간으로 읽어 오기 때문에 프로그램을 종료하면 OBS의 가사 화면도 함께 사라집니다.',
      },
      '星座（暫停提供）': { ja: 'コンステレーション（一時提供停止）' },
      '時間軸（暫停提供）': { ja: 'タイムライン（一時提供停止）' },
      '斜線舞台（暫停提供）': { ja: 'スラッシュステージ（一時提供停止）' },
      '每張縮圖的「字」會用該風格的高亮動態跑一次；滑鼠停在上面可看文字說明。': {
        ja: '各サムネイルの「文字」が、そのスタイルのハイライト演出で 1 回再生されます。マウスを重ねると説明を確認できます。',
      },
      '依 Twitch 實際開台狀態判斷；重連後會向 Twitch 再確認一次。': {
        ja: 'Twitch の実際の配信状態で判定し、再接続後に Twitch へもう一度確認します。',
      },
      '基礎配色與可讀性和其他清單型模板共用；卡片清單會立即反映每一個可見控制項。': {
        ja: '基本の配色と読みやすさは他のリスト型テンプレートと共通で、カードリストには表示中の各操作項目がすぐに反映されます。',
      },
      '00:00 開台': { en: '00:00 Stream started' },
      '所有內建指令的名稱、別名、資格與冷卻會回到預設值。': {
        en: 'The name, aliases, permissions, and cooldown for every built-in command will be reset to their defaults.',
      },
      '直式 600×1080': { 'zh-CN': '竖屏 600×1080' },
      '歌單即時預覽': { 'zh-CN': '歌单实时预览' },
      'OBS 連動（一鍵建立來源）': { 'zh-CN': 'OBS 联动（一键创建来源）' },
    };
    Object.entries(expected).forEach(([source, locales]) => {
      Object.entries(locales).forEach(([locale, value]) => {
        const index = i18n.LOCALES.indexOf(locale);
        eq(autoRows[source][index], value, `${locale} 深度審查字串不可回歸：「${source}」：`);
      });
    });
    ok(!/^[，：]/.test(i18n.catalogs.en['setlist.bgOpacityHintTail']), '英文接續片段不得混入全形中文標點：');
    ok(!/^[，：]/.test(autoRows['：每首歌旁邊會寫「逐字」「逐句」或「無歌詞」。看到「無歌詞」不是壞掉，只是這次自動搜尋沒找到而已。'][1]), '英文說明片段不得混入全形中文冒號：');
  });

  test('動態無障礙標籤與 OBS 執行狀態跟隨介面語言', () => {
    const controllerHtml = fs.readFileSync(path.join(__dirname, '../public/controller.html'), 'utf8');
    const electronChrome = fs.readFileSync(path.join(__dirname, '../public/js/electron-shell-chrome.js'), 'utf8');
    const toastUtils = fs.readFileSync(path.join(__dirname, '../public/js/app-toast-utils.js'), 'utf8');
    const errorHandler = fs.readFileSync(path.join(__dirname, '../public/js/error-handler.js'), 'utf8');
    ok(controllerHtml.includes('data-i18n-aria-label="controller.lyricPresetLabel"'), '遙控器預設選單的 aria-label 必須走語系層：');
    ok(electronChrome.includes("translate('window.restore'") && electronChrome.includes("translate('window.maximize'"), 'Electron 最大化／還原 aria-label 必須走語系鍵：');
    ok(electronChrome.includes("window.addEventListener('i18n:change'"), '切換語言後須重繪 Electron 動態視窗標籤：');
    ['status.lyricsStale', 'status.lyricsStaleAria', 'status.lyricsStaleWarning', 'status.lyricsPending', 'status.lyricsPendingAria'].forEach((key) => {
      ok(toastUtils.includes(`t('${key}')`), `OBS 動態狀態必須使用 ${key}：`);
    });
    ok(errorHandler.includes("window.I18n.t('common.close')"), 'toast 關閉按鈕的 title／aria-label 必須走語系層：');
    ok(!errorHandler.includes('title="關閉" aria-label="關閉"'), 'toast 不得保留寫死的繁中無障礙標籤：');
  });

  test('具名變數只翻譯模板原文，不改寫已展開的 Twitch 對外回覆', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('會套入聊天室回覆的 {reason}；留空會使用安全預設文字。'),
      '{reason} will be included in the chat room reply; leaving blank will use the safe default text.',
      '介面中的具名變數說明仍須翻譯：'
    );
    eq(
      i18n.translate('已取消待確認點歌：Sample Track'),
      '已取消待確認點歌：Sample Track',
      '已展開的聊天室回覆屬使用者對外內容，不可被 UI 自動翻譯：'
    );
    ok(i18nSource.includes("'textarea',"), 'Twitch 回覆文字框必須維持在自動翻譯排除範圍：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('動態數量與錯誤前綴必須走可命中的翻譯路徑', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(
      i18n.translate('目前 3 個自訂指令都會移除。'),
      'All 3 custom commands will be removed.',
      '動態數量不可只留下無法命中的句尾片段：'
    );
    eq(
      i18n.translate(`目前模板：${i18n.t('template.classic')}`),
      'Current template: Classic Overlay',
      '動態模板狀態的前綴與模板名稱都必須翻譯：'
    );
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const timelineSource = fs.readFileSync(path.join(__dirname, '../public/js/app-lyrics-timeline.js'), 'utf8');
    const youtubeSource = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    const sharedSource = fs.readFileSync(path.join(__dirname, '../public/js/shared-utils.js'), 'utf8');
    const lyricExtrasSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
    ok(twitchSource.includes('summary: tr(`目前 ${count} 個自訂指令都會移除。`)'), '清除自訂指令確認必須先翻譯完整動態句：');
    ok(twitchSource.includes("t('twitch.simulation.failed', { message: error })"), 'Twitch 模擬錯誤前綴必須由 curated 模板翻譯，錯誤內容另行處理：');
    ok(timelineSource.includes("`${tr('歌詞上傳失敗:')} ${err.message}`"), '歌詞上傳錯誤前綴必須翻譯：');
    ok(youtubeSource.includes("t('import.error.importFailed', { message: err.message })"), 'YouTube 匯入錯誤前綴必須由 curated 模板翻譯：');
    ok(sharedSource.includes("`${tr('音訊播放失敗:')} ${error.message || tr('未知錯誤')}`"), '共用音訊錯誤前綴必須翻譯：');
    ok(lyricExtrasSource.includes("window.I18n?.t(`template.${settings.template}`)"), '動態模板名稱必須先經過 curated 翻譯：');
    ok(lyricExtrasSource.includes("window.addEventListener('i18n:change', syncTemplateButtons)"), '切換語言後必須重新渲染動態模板名稱：');
    ok(youtubeSource.includes("window.addEventListener('i18n:change'"), '匯入工作中心切換語言後必須重新渲染：');
    ok(youtubeSource.includes('progressStatus(job.progressStage'), '匯入中 Socket 階段必須在顯示時依目前語系格式化：');
    ok(youtubeSource.includes('setYtProgressStage(stage, data.percent, error'), '匯入進度不可先拼成繁中快照再顯示：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('匯入工作中心的動態訊息以 curated key 重繪且保留外部資料', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    ['import.playlist.confirmTitle', 'import.job.queued', 'import.progress.status', 'import.job.completed', 'import.error.importFailed'].forEach((key) => {
      ok(baselineKeys.includes(key), `匯入動態介面缺少 ${key}：`);
    });
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.t('import.job.queued', { position: '3' }), 'Waiting · queue position 3', '工作中心佇列位置必須使用英文模板：');
    eq(i18n.t('import.error.importFailed', { message: 'SERVER_MESSAGE' }), 'YouTube import failed: SERVER_MESSAGE', '外部錯誤僅作為插值，不可被改寫：');
    ok(source.includes('const stageKeys = Object.freeze'), '伺服器進度階段必須以顯示層映射，不可改 Socket payload：');
    ok(source.includes('source: options.source || \'YouTube\''), '匯入來源值必須保留為工作資料：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('語系切換會用快取資料重繪 Twitch runtime 與匯入中的動態 UI', () => {
    const twitchSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    const youtubeSource = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
    const errorHandlerSource = fs.readFileSync(path.join(__dirname, '../public/js/error-handler.js'), 'utf8');
    ['import.job.redownloadSource', 'import.job.twitchSource'].forEach((key) => {
      ok(baselineKeys.includes(key), `動態匯入來源缺少 ${key}：`);
    });
    ok(twitchSource.includes('function renderRuntimeStatus(data)'), 'Twitch runtime 必須可由快取狀態重繪：');
    ok(twitchSource.includes('if (lastRuntimeStatus) renderRuntimeStatus(lastRuntimeStatus);'), '切換語言後必須立即重繪 Twitch runtime：');
    ok(youtubeSource.includes('function displayJobSource(job)'), '工作中心來源必須在顯示時才翻譯：');
    ok(youtubeSource.includes('sourceKey: options.sourceKey'), '工作中心需保留來源資料與語系鍵：');
    ok(youtubeSource.includes('setYtProgressPlaylistResult(imported, skipped, failed, true)'), '播放清單完成進度不可快照舊語言的片段：');
    ok(youtubeSource.includes('if (activeRiskAssessment) renderRiskAssessment(activeRiskAssessment);'), '開啟中的風險確認視窗必須隨語系重繪：');
    ok(youtubeSource.includes('const fallbackCatalog = Object.freeze'), '匯入 UI 在語系層短暫不可用時不得露出內部 key：');
    ok(errorHandlerSource.includes('const fallbackCatalog = Object.freeze'), '錯誤 UI 在語系層短暫不可用時不得露出內部 key：');
    i18n.setLocale('zh-CN', { persist: false, updateQuery: false });
    eq(
      i18n.t('twitch.runtime.reconnecting', { delay: i18n.t('twitch.runtime.retryIn', { seconds: '61' }), attempt: '6', error: '' }),
      'Twitch 连接中断，61 秒后自动重连（第 6 次）',
      '简中重连倒数的「后」只能由 delay 模板提供一次：'
    );
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  // 長尾表是機器產生的，結構檢查擋不住語意錯誤；下面四條是實機踩過的錯譯類型的回歸守衛。
  test('長尾字串表沿用 curated 術語，不得各自表述', () => {
    const autoRows = require('../public/js/i18n-auto');
    const prefer = {
      播放清單: 'nav.playlist',
      複製: 'common.copy',
      'OBS 來源網址': 'top.obsSources',
      正在播放: 'home.nowPlaying',
      已唱: 'setlist.done',
      貼上歌詞: 'preview.pasteLyrics',
      尚無歌曲: 'setlist.noTracks',
    };
    const curatedByZh = new Map();
    Object.keys(catalogs['zh-TW']).forEach((key) => {
      const zh = catalogs['zh-TW'][key];
      if (curatedByZh.has(zh) && prefer[zh] !== key) return;
      curatedByZh.set(zh, i18n.LOCALES.map((locale) => catalogs[locale][key]));
    });
    let shared = 0;
    Object.entries(autoRows).forEach(([source, values]) => {
      const curated = curatedByZh.get(source);
      if (!curated) return;
      shared += 1;
      eq(values.join(''), curated.join(''), `「${source}」在長尾表與 curated 表必須完全一致：`);
    });
    ok(shared >= 150, '兩張表應有大量共用來源可比對：');
  });

  test('長尾字串表不得留下已知的機器誤譯術語', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 每一條都是 M6.1 初版實際出現過的錯譯：場→game、忠誠點數→loyalty、
    // 字級→font level、諧音→homophone、直書→straight book、控制台→console。
    const banned = {
      en: /per game|loyalty point|font level|\bhomophon|straight book|direct book|refractive ladder|star sand streamer|classic layering|\bconsole\b|\bverbatim\b|\bunsung\b|account number|jiugong|bidiange|zhazhishu|back panel|backplane|backing plate|readab\w* substrate|singing station|join tail|received station|still importing|song sheet page|analog singer|\bpen\b/i,
      ja: /冷却|ロイヤルティ|ロイヤリティ|フォントレベル|同音異義語|コンソール|ゲームあたり|ゲームごと|試合|逐語|ピンイン|口座番号|ダイレクトブック|Jiugong|BiDianGe|バックパネル|バックプレーン|バッキング|基板|Neon Singing|Classic Layer|テールに参加/,
      ko: /냉방|냉각|로열티|글꼴 수준|동음|콘솔|게임당|세션당|축어|병음|계좌번호|직접 도서|Jiugong|Bidiange|후면 패널|백플레인|뒷판|기판|Neon Singing|Classic Layer|테일 가입|제어판로|크기과/i,
    };
    Object.entries(banned).forEach(([locale, pattern]) => {
      const offset = i18n.LOCALES.indexOf(locale);
      const offenders = Object.entries(autoRows).filter(([, values]) => pattern.test(String(values[offset])));
      eq(offenders.length, 0, `${locale} 仍有機器誤譯術語（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
    });
  });

  test('長尾譯文不得出現機翻疊詞', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 「星座 星座」「リストリスト」「목록 목록」「列表列表」這類疊詞是取代式修譯的
    // 典型副作用：某語言被修好了，另一語言把新詞疊在舊詞上。之前只有英文抓得到。
    const keywordList = (source) => source.split(/\s+/).length >= 4 && !/[，。、：；]/.test(source);
    const cjkDup = /([぀-ヿ㐀-鿿가-힯]{2,8})\s?\1/;
    const enDup = /\b(\w{3,})\s+\1\b/i;
    // 疊詞本來就合法的詞（韓文的 하나하나＝一個一個、日文的 一つ一つ 等）
    const allowed = new Set(['하나', '하나하나', '탱글', '탱글탱글', '各々', '様々', '色々', '一つ', '一つ一つ', '人人']);
    const offenders = [];
    Object.entries(autoRows).forEach(([source, values]) => {
      if (keywordList(source)) return; // 空白分隔的搜尋關鍵字列表本來就會重複詞根
      [1, 2, 3, 4].forEach((index) => {
        const match = cjkDup.exec(String(values[index]));
        if (match && !allowed.has(match[1])) offenders.push(`${source.slice(0, 26)} [${index}] ${match[0]}`);
      });
      if (enDup.test(String(values[1]))) offenders.push(`${source.slice(0, 26)} [en]`);
    });
    eq(offenders.length, 0, `譯文出現疊詞（例如「${offenders[0] || ''}」）：`);
  });

  test('简中長尾使用簡中用語，不是繁中字轉簡', () => {
    const autoRows = require('../public/js/i18n-auto');
    // 字形轉換不等於在地化：伺服器／匯入／檔案／程式 在简中要換詞而不是換字。
    const taiwanOnly = /伺服器|汇入|汇出|档案|视窗|资料夹|介面|程式|解析度|快取|登入|滑鼠|连线|网路|搜寻|讯息|储存|回覆|载入|连结|音档|资讯|纪录|字元|套用|使用者|装置|内建|帐号|自订|实况主|程序码|下载档|命令列|回传值|伫列|可携版|套入|线上更新|系统匣|权杖|透过|顺位|开台|收台|「|」|时间戳记|终端机|本机|变数|选配|相容|遗失|复原|存取|线上|全域|送出|贴上|建立|身分|联络|录影|存档/;
    const offenders = Object.entries(autoRows)
      .filter(([source]) => !source.startsWith('!'))
      .filter(([, values]) => taiwanOnly.test(String(values[4])));
    eq(offenders.length, 0, `简中仍有台灣用語或引號（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
    const classifierOffenders = Object.entries(autoRows)
      .filter(([source, values]) => !source.includes('素筆') && String(values[4]).includes('笔'));
    eq(classifierOffenders.length, 0, `简中數量詞仍誤用「笔」（例如「${classifierOffenders[0] ? classifierOffenders[0][0] : ''}」）：`);
  });

  test('英文長尾以大寫開頭，技術名詞除外', () => {
    const autoRows = require('../public/js/i18n-auto');
    const lowerAllowed = /^(yt-dlp|ffmpeg|npm|localhost|px|ms|http|www)/;
    // 這些片段是被 <code> 切開的句子後半段，英文必須小寫接續前半句。
    const sentenceTails = new Set(['手動查詢 IPv4 位址。']);
    const offenders = Object.entries(autoRows).filter(([source, values]) => (
      /^[㐀-鿿]/.test(source)
      && !sentenceTails.has(source)
      && /^[a-z]/.test(String(values[1]))
      && !lowerAllowed.test(String(values[1]))
    ));
    eq(offenders.length, 0, `英文句首大小寫不一致（例如「${offenders[0] ? offenders[0][0] : ''}」）：`);
  });

  test('Twitch 設定搜尋在非中文介面也搜得到', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
    ok(source.includes('function searchHaystack'), '搜尋必須同時比對中文索引與翻譯後文字：');
    ok(/searchEntries\.filter\(\(entry\) => searchHaystack\(entry\)/.test(source), '搜尋過濾必須走 searchHaystack：');
    ok(source.includes("t('twitch.settings.jump',"), '跳轉提示必須由具名變數的 curated 模板處理：');
    const entries = [...source.matchAll(/\{ label: '([^']+)', category: '([^']+)', terms: '([^']+)'/g)]
      .map(([, label, category, terms]) => [label, category, terms]);
    ok(entries.length >= 10, '應取得設定搜尋索引：');
    const haystack = (entry) => entry.concat(entry.map((value) => i18n.translate(value))).join(' ').toLocaleLowerCase();
    const probes = { en: ['refund', 'blacklist', 'cooldown'], ja: ['返金', 'ブラックリスト'], ko: ['환불', '차단'] };
    Object.entries(probes).forEach(([locale, words]) => {
      i18n.setLocale(locale, { persist: false, updateQuery: false });
      words.forEach((word) => {
        const hits = entries.filter((entry) => haystack(entry).includes(word.toLocaleLowerCase()));
        ok(hits.length > 0, `${locale} 介面搜尋「${word}」必須有結果：`);
      });
    });
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  test('長尾翻譯保留動態內容與外部歌曲／公告欄位', () => {
    i18n.setLocale('en', { persist: false, updateQuery: false });
    eq(i18n.translate('最近同步：首頁'), 'Recent synchronization: 首頁', '動態插值不得把外部內容再次翻譯：');
    [
      '.pi-title',
      '.pi-artist',
      '.lib-title',
      '.announcement-item-title',
      '.twitch-req-title',
      '.twitch-req-author',
      '.twitch-req-url',
      '#youtube-risk-title',
      '#youtube-risk-author',
    ].forEach((selector) => ok(i18nSource.includes(`'${selector}'`), `${selector} 必須排除自動翻譯：`));
    const playlistSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
    const setlistPanelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
    const lyricExtrasSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
    ok(playlistSource.includes('<span data-i18n-skip>${escapeHtml(f.name)}</span>'), '匯入紀錄名稱必須保留使用者文字：');
    ok(setlistPanelSource.includes("b.dataset.i18nSkip = '1'"), '自訂歌單風格名稱必須排除自動翻譯：');
    ok(lyricExtrasSource.includes('<option data-i18n-skip value="'), '自訂歌詞預設名稱必須排除自動翻譯：');
    i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
  });

  // 2026-09-26 改版：側欄改為頂部分頁（docs/UIUX-REDESIGN.md §3）。原意不變：
  // 導覽標籤要可讀，長語言不能被截斷或省略號吃掉；窄螢幕靠整列橫向捲動而不是縮字。
  test('頂部導覽標籤維持可讀字級且長語言不被截斷', () => {
    const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
    const navLabelRule = panelCss.match(/\.nav-item \.nav-label\s*\{([\s\S]*?)\}/)?.[1] || '';
    const fontSize = Number(navLabelRule.match(/font-size:\s*([\d.]+)px/)?.[1]);
    ok(fontSize >= 13, '頂部分頁標籤至少 13px：');
    ok(!/text-overflow:\s*ellipsis/.test(navLabelRule) && !/line-clamp/.test(navLabelRule), '頂部分頁標籤不可截斷：');
    ok(/\.nav-group--primary\s*\{[^}]*overflow-x:\s*auto/.test(panelCss), '窄螢幕時頂部分頁整列要能橫向捲動：');
  });

  test('深色模式所有原生下拉選項都有不透明底色與可讀文字', () => {
    const baseCss = fs.readFileSync(path.join(__dirname, '../public/css/base.css'), 'utf8');
    ok(/--select-popup-bg:\s*#[0-9a-f]{6};/i.test(baseCss), '深色下拉清單必須有不透明底色：');
    ok(/select option,\s*select optgroup\s*\{[\s\S]*?background-color:\s*var\(--select-popup-bg\);[\s\S]*?color:\s*var\(--text\);/.test(baseCss), '語系與一般下拉都必須套用主題化選項樣式：');
    ok(/select option:checked\s*\{[\s\S]*?background:\s*var\(--accent\);[\s\S]*?color:\s*var\(--accent-text\);/.test(baseCss), '選中項目必須維持強調色對比：');
  });

  test('語系模組沒有網路、Socket 或伺服器狀態寫入行為', () => {
    ok(!/\bfetch\s*\(/.test(i18nSource), '語系層不得發出 HTTP 請求：');
    ok(!/\bSocketClient\s*[.(]/.test(i18nSource), '語系層不得讀寫 Socket：');
    eq(i18n.STORAGE_KEY, 'elitesand-ui-locale', '只使用獨立的裝置語系偏好鍵：');
  });
}
