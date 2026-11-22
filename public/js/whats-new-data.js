/**
 * 「這版更新了什麼」的內容（隨程式發版，不連網）。
 *
 * 發版時：把 UNRELEASED 的項目搬進新版本號的 RELEASES 項目（package.json 版本必須有對應項目，測試會擋）。
 * 每一項：
 *   feature  — 對應 new-badges.js 的功能代號；面板找得到 [data-new-feature=代號] 時出現「帶我去看」
 *   title／desc — 五語：[繁中, English, 日本語, 한국어, 简中]
 * 只寫使用者看得到、用得到的重點；修 bug 寫成一句「修正」即可，不列內部細節。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhatsNewData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RELEASES = [
    {
      version: '1.3.0',
      date: '2026-11-13',
      items: [
        {
          feature: 'alert-show',
          title: ['訂閱與贈訂演出', 'Sub and gift-sub shows', 'サブスク・ギフトの演出', '구독·선물 구독 연출', '订阅与赠订演出'],
          desc: ['觀眾訂閱、贈訂或揪團達標時，在 OBS 播一段全畫面演出；門檻與要播哪段都能設定。', 'When viewers subscribe, gift subs, or a group goal is reached, a full-screen show plays in OBS. Thresholds and shows are configurable.', '視聴者のサブスク・ギフト・グループ目標達成時に、OBS で全画面の演出を再生します。しきい値と演出は設定できます。', '시청자가 구독·선물 구독하거나 단체 목표를 달성하면 OBS에서 전체 화면 연출을 재생합니다. 기준과 연출은 설정할 수 있습니다.', '观众订阅、赠订或拼团达标时，在 OBS 播放一段全屏演出；门槛与播放内容都能设置。'],
        },
        {
          feature: 'precise-sync',
          title: ['精準對時', 'Precise sync', '精密タイミング合わせ', '정밀 싱크', '精准对时'],
          desc: ['中文歌可以逐句校正歌詞時間，不只整首平移。', 'Chinese songs can now be corrected line by line, not just shifted as a whole.', '中国語の曲は、曲全体のずらしだけでなく一行ずつ歌詞のタイミングを補正できます。', '중국어 노래는 곡 전체 이동뿐 아니라 한 줄씩 가사 타이밍을 보정할 수 있습니다.', '中文歌可以逐句校正歌词时间，不只整首平移。'],
        },
        {
          feature: 'quick-templates',
          title: ['快捷歌詞模板', 'Quick lyric templates', 'クイック歌詞テンプレート', '빠른 가사 템플릿', '快捷歌词模板'],
          desc: ['直播中一鍵切換歌詞模板，也能記住每首歌各用哪個模板。', 'Switch lyric templates in one click while live, and remember which template each song uses.', '配信中にワンクリックで歌詞テンプレートを切り替え、曲ごとに使うテンプレートも記憶できます。', '방송 중 클릭 한 번으로 가사 템플릿을 바꾸고, 곡마다 쓸 템플릿도 기억합니다.', '直播中一键切换歌词模板，也能记住每首歌各用哪个模板。'],
        },
        {
          feature: 'per-song-volume',
          title: ['記住每首歌的音量', 'Per-song volume', '曲ごとの音量を記憶', '곡별 볼륨 기억', '记住每首歌的音量'],
          desc: ['調過音量的歌，下次播放會自動用同樣的音量。', 'Songs you adjusted play at the same volume next time.', '音量を調整した曲は、次回も同じ音量で再生されます。', '볼륨을 조절한 곡은 다음에도 같은 볼륨으로 재생됩니다.', '调过音量的歌，下次播放会自动用同样的音量。'],
        },
        {
          feature: 'library-word-upgrade',
          title: ['逐句歌詞批次升級成逐字', 'Batch-upgrade lyrics to word timing', '行単位の歌詞を一括で単語単位に', '줄 단위 가사를 단어 단위로 일괄 업그레이드', '逐句歌词批量升级成逐字'],
          desc: ['歌曲庫可以篩出只有逐句時間的歌，一次換成逐字版本。', 'The library can filter songs with line-only timing and swap them for word-timed lyrics in one go.', '曲ライブラリで行単位のタイミングしかない曲を絞り込み、まとめて単語単位の歌詞に置き換えられます。', '곡 라이브러리에서 줄 단위 타이밍만 있는 곡을 골라 단어 단위 가사로 한 번에 바꿀 수 있습니다.', '歌曲库可以筛出只有逐句时间的歌，一次换成逐字版本。'],
        },
      ],
    },
  ];

  // 下一版要發布的內容：發版時搬進 RELEASES（帶上版本號與日期）
  const UNRELEASED = [
    {
      feature: 'outro-pause-finish',
      title: ['尾奏暫停自動收尾', 'Auto-finish on outro pause', 'アウトロ停止で自動終了', '아웃트로 정지 시 자동 종료', '尾奏暂停自动收尾'],
      desc: ['最後一句唱完後按暫停，停滿設定的秒數就當作唱完：OBS 歌詞清除、歌單不再顯示正在播放。秒數在播放清單的 ⋯ 選單調整。', 'Pause after the last lyric line and the song counts as finished after the set time: OBS lyrics clear and the setlist stops showing it as playing. Adjust it in the playlist ⋯ menu.', '最後の歌詞のあとで一時停止し、設定秒数が経つと歌い終えたとみなし、OBS の歌詞とセットリストの再生中表示を消します。秒数はプレイリストの ⋯ メニューで調整します。', '마지막 가사 이후 일시정지한 채 설정한 시간이 지나면 다 부른 것으로 보고 OBS 가사와 세트리스트의 재생 중 표시를 지웁니다. 시간은 재생 목록의 ⋯ 메뉴에서 조절합니다.', '最后一句唱完后按暂停，停满设定的秒数就当作唱完：OBS 歌词清除、歌单不再显示正在播放。秒数在播放列表的 ⋯ 菜单调整。'],
    },
    {
      feature: 'setlist-now-playing',
      title: ['單曲看板歌單', 'Now-playing setlist', '単曲ボードのセットリスト', '단일 곡 보드 세트리스트', '单曲看板歌单'],
      desc: ['OBS 歌單新版型：只顯示正在唱的歌，沒在唱時顯示自訂的待機文字，有多種外觀可選。', 'A new OBS setlist layout that shows only the current song, with your own idle text and several looks.', 'OBS セットリストの新レイアウト：歌唱中の曲だけを表示し、待機中は自分で決めた文字を表示します。外観は複数から選べます。', '새 OBS 세트리스트 레이아웃: 지금 부르는 곡만 보여 주고, 대기 중에는 직접 정한 문구를 표시합니다. 여러 외형 중에서 고를 수 있습니다.', 'OBS 歌单新版式：只显示正在唱的歌，没在唱时显示自定义的待机文字，有多种外观可选。'],
    },
  ];

  const LANG_INDEX = { 'zh-TW': 0, en: 1, ja: 2, ko: 3, 'zh-CN': 4 };

  function parse(version) {
    return String(version || '').replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  }
  function compareVersions(a, b) {
    const x = parse(a); const y = parse(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /**
   * 該跳哪幾版的內容（新到舊）。lastSeen 為 null＝老使用者第一次遇到這功能：只給目前這版。
   * 已經看過目前版本（或更新）就回空陣列。
   */
  function releasesToShow(lastSeenVersion, appVersion) {
    if (!appVersion) return [];
    if (lastSeenVersion && compareVersions(lastSeenVersion, appVersion) >= 0) return [];
    return RELEASES
      .filter((r) => compareVersions(r.version, appVersion) <= 0
        && (lastSeenVersion ? compareVersions(r.version, lastSeenVersion) > 0 : compareVersions(r.version, appVersion) === 0))
      .sort((a, b) => compareVersions(b.version, a.version));
  }

  function text(field, locale) {
    if (!Array.isArray(field)) return String(field || '');
    const index = LANG_INDEX[locale];
    return field[index === undefined ? 1 : index] || field[0] || '';
  }

  return { RELEASES, UNRELEASED, compareVersions, releasesToShow, text, LANG_INDEX };
}));
