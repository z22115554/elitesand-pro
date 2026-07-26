/**
 * Elitesand Pro UI internationalization.
 *
 * This layer is presentation-only:
 * - it never reads or writes app state, Socket payloads, template IDs, or settings keys;
 * - the saved locale is a device-local UI preference, not a server setting;
 * - OBS pages can pin a locale with ?lang= without changing their existing route.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.I18n = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'elitesand-ui-locale';
  const DEFAULT_LOCALE = 'zh-TW';
  const LOCALES = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
  const INDEX = Object.fromEntries(LOCALES.map((locale, index) => [locale, index]));

  // Each row is [繁中, English, 日本語, 한국어, 简中].
  // Keeping all five values together makes missing translations mechanically testable.
  const ROWS = {
    'app.panelTitle': ['Elitesand Pro 控制面板', 'Elitesand Pro Control Panel', 'Elitesand Pro コントロールパネル', 'Elitesand Pro 제어판', 'Elitesand Pro 控制面板'],
    'app.remoteTitle': ['Elitesand Pro 遙控器', 'Elitesand Pro Remote', 'Elitesand Pro リモコン', 'Elitesand Pro 리모컨', 'Elitesand Pro 遥控器'],
    'app.displayTitle': ['Elitesand Pro 歌詞顯示', 'Elitesand Pro Lyrics Display', 'Elitesand Pro 歌詞表示', 'Elitesand Pro 가사 화면', 'Elitesand Pro 歌词显示'],
    'app.setlistTitle': ['Elitesand Pro 歌單', 'Elitesand Pro Setlist', 'Elitesand Pro セットリスト', 'Elitesand Pro 세트리스트', 'Elitesand Pro 歌单'],
    'language.label': ['介面語言', 'Interface language', '表示言語', '인터페이스 언어', '界面语言'],
    'nav.home': ['首頁', 'Home', 'ホーム', '홈', '首页'],
    'nav.playlist': ['播放清單', 'Playlist', 'プレイリスト', '재생목록', '播放列表'],
    'nav.library': ['媒體庫', 'Library', 'メディアライブラリ', '미디어 보관함', '媒体库'],
    'nav.lyricsSettings': ['歌詞設定', 'Lyrics settings', '歌詞設定', '가사 설정', '歌词设置'],
    'nav.setlist': ['直播歌單', 'Live setlist', '配信セットリスト', '방송 세트리스트', '直播歌单'],
    'nav.setlistTitle': ['直播歌單與 OBS 輸出', 'Live setlist and OBS output', '配信セットリストと OBS 出力', '방송 세트리스트 및 OBS 출력', '直播歌单与 OBS 输出'],
    'nav.twitch': ['Twitch 點歌', 'Twitch requests', 'Twitch リクエスト', 'Twitch 신청곡', 'Twitch 点歌'],
    'nav.system': ['連線與系統', 'Connection & system', '接続とシステム', '연결 및 시스템', '连接与系统'],
    'nav.tutorial': ['教學', 'Guide', 'ガイド', '가이드', '教学'],
    'nav.tutorialTitle': ['新手教學', 'Getting started', 'はじめてガイド', '시작 가이드', '新手教学'],
    'theme.switch': ['切換主題', 'Switch theme', 'テーマを切り替え', '테마 전환', '切换主题'],
    'theme.toDark': ['切換深色模式', 'Switch to dark mode', 'ダークモードに切り替え', '다크 모드로 전환', '切换到深色模式'],
    'theme.toLight': ['切換淺色模式', 'Switch to light mode', 'ライトモードに切り替え', '라이트 모드로 전환', '切换到浅色模式'],
    'window.maximize': ['最大化', 'Maximize', '最大化', '최대화', '最大化'],
    'window.restore': ['還原視窗', 'Restore window', 'ウィンドウを元に戻す', '창 복원', '还原窗口'],
    'top.obsSources': ['OBS 來源網址', 'OBS source URLs', 'OBS ソース URL', 'OBS 소스 URL', 'OBS 来源网址'],
    'top.lyricsUrl': ['歌詞網址', 'Lyrics URL', '歌詞 URL', '가사 URL', '歌词网址'],
    'top.setlistUrl': ['歌單網址', 'Setlist URL', 'セットリスト URL', '세트리스트 URL', '歌单网址'],
    'top.obsStatus': ['OBS 來源連線狀態', 'OBS source connection status', 'OBS ソース接続状態', 'OBS 소스 연결 상태', 'OBS 来源连接状态'],
    'status.connecting': ['連線中', 'Connecting', '接続中', '연결 중', '连接中'],
    'status.connected': ['已連線', 'Connected', '接続済み', '연결됨', '已连接'],
    'status.reconnecting': ['與伺服器連線中斷，重新連線中…', 'Server connection lost. Reconnecting…', 'サーバーとの接続が切れました。再接続中…', '서버 연결이 끊겼습니다. 다시 연결 중…', '与服务器连接中断，正在重新连接…'],
    'status.lyricsConnected': ['歌詞已連線', 'Lyrics connected', '歌詞接続済み', '가사 연결됨', '歌词已连接'],
    'status.lyricsDisconnected': ['歌詞未連線', 'Lyrics disconnected', '歌詞未接続', '가사 연결 안 됨', '歌词未连接'],
    'status.setlistConnected': ['歌單已連線', 'Setlist connected', 'セットリスト接続済み', '세트리스트 연결됨', '歌单已连接'],
    'status.setlistDisconnected': ['歌單未連線', 'Setlist disconnected', 'セットリスト未接続', '세트리스트 연결 안 됨', '歌单未连接'],
    'player.noTrack': ['尚未播放', 'Nothing playing', '再生していません', '재생 중인 곡 없음', '尚未播放'],
    'player.unknownTrack': ['未知歌曲', 'Unknown track', '不明な曲', '알 수 없는 곡', '未知歌曲'],
    'player.unknownArtist': ['未知歌手', 'Unknown artist', '不明なアーティスト', '알 수 없는 아티스트', '未知歌手'],
    'player.previous': ['上一首', 'Previous track', '前の曲', '이전 곡', '上一首'],
    'player.playPause': ['播放或暫停', 'Play or pause', '再生または一時停止', '재생 또는 일시정지', '播放或暂停'],
    'player.next': ['下一首', 'Next track', '次の曲', '다음 곡', '下一首'],
    'common.close': ['關閉', 'Close', '閉じる', '닫기', '关闭'],
    'common.cancel': ['取消', 'Cancel', 'キャンセル', '취소', '取消'],
    'common.confirm': ['確認', 'Confirm', '確認', '확인', '确认'],
    'common.apply': ['套用', 'Apply', '適用', '적용', '应用'],
    'common.reset': ['重置', 'Reset', 'リセット', '초기화', '重置'],
    'common.resetZero': ['歸零', 'Reset to zero', 'ゼロに戻す', '0으로 초기화', '归零'],
    'common.copied': ['已複製', 'Copied', 'コピーしました', '복사됨', '已复制'],
    'common.all': ['全部', 'All', 'すべて', '전체', '全部'],
    'common.off': ['關', 'Off', 'オフ', '끔', '关'],
    'controller.emergency': ['緊急隱藏歌詞', 'Emergency hide lyrics', '歌詞を緊急非表示', '가사 긴급 숨김', '紧急隐藏歌词'],
    'controller.offset': ['歌詞時間偏移', 'Lyrics timing offset', '歌詞タイミング調整', '가사 시간 오프셋', '歌词时间偏移'],
    'controller.languageDisplay': ['語言顯示', 'Lyrics language display', '歌詞の言語表示', '가사 언어 표시', '语言显示'],
    'controller.original': ['原文', 'Original', '原文', '원문', '原文'],
    'controller.romanized': ['拼音', 'Romanization', 'ローマ字', '로마자', '拼音'],
    'controller.originalRomanized': ['原文+拼音', 'Original + romanization', '原文＋ローマ字', '원문 + 로마자', '原文+拼音'],
    'controller.originalPhonetic': ['原文+諧音', 'Original + phonetic guide', '原文＋発音ガイド', '원문 + 발음 가이드', '原文+谐音'],
    'controller.lyricTemplate': ['歌詞模板', 'Lyrics template', '歌詞テンプレート', '가사 템플릿', '歌词模板'],
    'controller.position': ['位置', 'Position', '位置', '위치', '位置'],
    'controller.center': ['置中', 'Center', '中央', '가운데', '居中'],
    'controller.left': ['偏左', 'Left', '左寄せ', '왼쪽', '偏左'],
    'controller.right': ['偏右', 'Right', '右寄せ', '오른쪽', '偏右'],
    'controller.split': ['左右分散', 'Split left/right', '左右に分散', '좌우 분산', '左右分散'],
    'controller.columnStyle': ['直書句流樣式', 'Vertical flow style', '縦書きフロースタイル', '세로쓰기 흐름 스타일', '竖排句流样式'],
    'controller.columnPosition': ['直書位置', 'Vertical text position', '縦書き位置', '세로쓰기 위치', '竖排位置'],
    'controller.retainedLines': ['同時保留句數', 'Lines kept on screen', '同時に残す行数', '동시에 유지할 줄 수', '同时保留句数'],
    'controller.lines': ['{count} 句', '{count} lines', '{count} 行', '{count}줄', '{count} 句'],
    'controller.intensity': ['動態強度', 'Motion intensity', '動きの強さ', '모션 강도', '动态强度'],
    'controller.calm': ['靜', 'Calm', '静', '잔잔', '静'],
    'controller.normal': ['中', 'Medium', '中', '보통', '中'],
    'controller.strong': ['強', 'Strong', '強', '강함', '强'],
    'controller.savedPreset': ['選擇已保存預設', 'Choose a saved preset', '保存済みプリセットを選択', '저장된 프리셋 선택', '选择已保存预设'],
    'controller.noPreset': ['尚未保存預設', 'No saved presets', '保存済みプリセットなし', '저장된 프리셋 없음', '尚未保存预设'],
    'controller.choosePreset': ['請先選擇預設', 'Choose a preset first', '先にプリセットを選択してください', '먼저 프리셋을 선택하세요', '请先选择预设'],
    'controller.presetApplied': ['已套用歌詞預設', 'Lyrics preset applied', '歌詞プリセットを適用しました', '가사 프리셋을 적용했습니다', '已应用歌词预设'],
    'controller.unsupportedSplit': ['這個模板不支援左右分散', 'This template does not support split positioning', 'このテンプレートは左右分散に対応していません', '이 템플릿은 좌우 분산을 지원하지 않습니다', '此模板不支持左右分散'],
    'controller.classicPalette': ['配色風格（經典疊層）', 'Color style (Classic Overlay)', '配色スタイル（クラシックオーバーレイ）', '색상 스타일(클래식 오버레이)', '配色风格（经典叠层）'],
    'controller.cute': ['可愛', 'Cute', 'かわいい', '귀여움', '可爱'],
    'controller.rock': ['搖滾', 'Rock', 'ロック', '록', '摇滚'],
    'controller.ballad': ['抒情', 'Ballad', 'バラード', '발라드', '抒情'],
    'controller.pitchSpeed': ['變調 / 變速', 'Pitch / speed', 'キー / 速度', '키 / 속도', '变调 / 变速'],
    'controller.pitch': ['變調', 'Pitch', 'キー', '키', '变调'],
    'controller.speed': ['變速', 'Speed', '速度', '속도', '变速'],
    'controller.pitchDown': ['降一個半音', 'Down one semitone', '半音下げる', '반음 내리기', '降一个半音'],
    'controller.pitchUp': ['升一個半音', 'Up one semitone', '半音上げる', '반음 올리기', '升一个半音'],
    'controller.slower': ['減速', 'Slower', '遅くする', '느리게', '减速'],
    'controller.faster': ['加速', 'Faster', '速くする', '빠르게', '加速'],
    'controller.introCountdown': ['前奏倒數提示', 'Intro countdown', 'イントロカウントダウン', '인트로 카운트다운', '前奏倒数提示'],
    'controller.lyrics': ['歌詞', 'Lyrics', '歌詞', '가사', '歌词'],
    'controller.pasteLyrics': ['貼上歌詞', 'Paste lyrics', '歌詞を貼り付け', '가사 붙여넣기', '粘贴歌词'],
    'controller.uploadFile': ['上傳檔案', 'Upload file', 'ファイルをアップロード', '파일 업로드', '上传文件'],
    'controller.playlist': ['播放清單', 'Playlist', 'プレイリスト', '재생목록', '播放列表'],
    'controller.emptyPlaylist': ['尚無歌曲', 'No tracks yet', '曲がありません', '곡이 없습니다', '暂无歌曲'],
    'controller.addFromPanel': ['請從控制面板新增歌曲', 'Add tracks from the control panel', 'コントロールパネルから曲を追加してください', '제어판에서 곡을 추가하세요', '请从控制面板添加歌曲'],
    'controller.pastePlaceholder': ['貼上 LRC 或純文字歌詞…', 'Paste LRC or plain-text lyrics…', 'LRC またはプレーンテキストの歌詞を貼り付け…', 'LRC 또는 일반 텍스트 가사를 붙여넣으세요…', '粘贴 LRC 或纯文本歌词…'],
    'controller.applyLyrics': ['套用歌詞', 'Apply lyrics', '歌詞を適用', '가사 적용', '应用歌词'],
    'controller.chooseTrack': ['請先選擇歌曲', 'Choose a track first', '先に曲を選択してください', '먼저 곡을 선택하세요', '请先选择歌曲'],
    'controller.enterLyrics': ['請輸入歌詞內容', 'Enter lyrics first', '歌詞を入力してください', '가사를 입력하세요', '请输入歌词内容'],
    'controller.uploading': ['上傳中…', 'Uploading…', 'アップロード中…', '업로드 중…', '上传中…'],
    'controller.lyricsLoaded': ['歌詞已載入（{count} 行）', 'Lyrics loaded ({count} lines)', '歌詞を読み込みました（{count} 行）', '가사를 불러왔습니다({count}줄)', '歌词已加载（{count} 行）'],
    'controller.lyricsParseFailed': ['歌詞解析失敗', 'Could not parse lyrics', '歌詞の解析に失敗しました', '가사 분석에 실패했습니다', '歌词解析失败'],
    'controller.uploadFailed': ['上傳失敗：{message}', 'Upload failed: {message}', 'アップロードに失敗しました：{message}', '업로드 실패: {message}', '上传失败：{message}'],
    'controller.parseFailed': ['解析失敗：{message}', 'Parsing failed: {message}', '解析に失敗しました：{message}', '분석 실패: {message}', '解析失败：{message}'],
    'controller.selected': ['已選', 'Selected', '選択済み', '선택됨', '已选'],
    'controller.audioError': ['音訊播放錯誤', 'Audio playback error', '音声再生エラー', '오디오 재생 오류', '音频播放错误'],
    'controller.skipping': ['正在跳到下一首…', 'Skipping to the next track…', '次の曲へ移動中…', '다음 곡으로 이동 중…', '正在跳到下一首…'],
    'pin.required': ['需要 PIN', 'PIN required', 'PIN が必要です', 'PIN 필요', '需要 PIN'],
    'pin.deviceHint': ['這台裝置需要輸入 PIN 才能操作 Elitesand Pro。', 'Enter the PIN to control Elitesand Pro from this device.', 'この端末から Elitesand Pro を操作するには PIN を入力してください。', '이 기기에서 Elitesand Pro를 제어하려면 PIN을 입력하세요.', '此设备需要输入 PIN 才能操作 Elitesand Pro。'],
    'pin.placeholder': ['輸入 PIN', 'Enter PIN', 'PIN を入力', 'PIN 입력', '输入 PIN'],
    'pin.enter': ['請輸入 PIN', 'Enter the PIN', 'PIN を入力してください', 'PIN을 입력하세요', '请输入 PIN'],
    'pin.incorrect': ['PIN 不正確', 'Incorrect PIN', 'PIN が正しくありません', 'PIN이 올바르지 않습니다', 'PIN 不正确'],
    'pin.verifyFailed': ['驗證失敗，請確認伺服器連線後再試', 'Verification failed. Check the server connection and try again.', '認証に失敗しました。サーバー接続を確認して再試行してください。', '인증에 실패했습니다. 서버 연결을 확인한 후 다시 시도하세요.', '验证失败，请确认服务器连接后重试'],
    'overlay.connectionLost': ['⚠️ 與伺服器連線中斷…', '⚠️ Server connection lost…', '⚠️ サーバーとの接続が切れました…', '⚠️ 서버 연결이 끊겼습니다…', '⚠️ 与服务器连接中断…'],
    'setlist.done': ['已唱', 'Performed', '歌唱済み', '완료', '已唱'],
    'setlist.nowPlaying': ['正在播放', 'Now playing', '再生中', '재생 중', '正在播放'],
    'setlist.upcoming': ['未唱', 'Up next', '次の曲', '예정', '未唱'],
    'setlist.noTracks': ['尚無歌曲', 'No tracks yet', '曲がありません', '곡이 없습니다', '暂无歌曲'],
    'setlist.singingNow': ['♪ 現在正在唱', '♪ Singing now', '♪ 歌唱中', '♪ 지금 부르는 중', '♪ 现在正在唱'],
    'setlist.startingSoon': ['即將播放', 'Starting soon', 'まもなく再生', '곧 재생', '即将播放'],
    'setlist.notStarted': ['尚未開始播放', 'Playback has not started', 'まだ再生されていません', '아직 재생을 시작하지 않았습니다', '尚未开始播放'],
    'setlist.noUpcoming': ['暫無待播歌曲', 'No upcoming tracks', '次の曲はありません', '예정된 곡이 없습니다', '暂无待播歌曲'],
    'setlist.performanceList': ['演出清單', 'Performance setlist', '演目リスト', '공연 세트리스트', '演出歌单'],
    'setlist.noAddedTracks': ['尚未加入歌曲', 'No tracks added yet', '曲が追加されていません', '추가된 곡이 없습니다', '尚未添加歌曲'],
    'template.classic': ['經典疊層', 'Classic Overlay', 'クラシックオーバーレイ', '클래식 오버레이', '经典叠层'],
    'template.pulse': ['星砂流光', 'Stardust Pulse', '星砂の流光', '별모래 유광', '星砂流光'],
    'template.facet': ['折光階梯', 'Prism Steps', '屈折の階段', '굴절 계단', '折光阶梯'],
    'template.drift': ['斜拍告白', 'Offbeat Confession', 'オフビートの告白', '엇박 고백', '斜拍告白'],
    'template.aura': ['潮汐心景', 'Tidal Mindscape', '潮汐の心景', '조수 심상', '潮汐心景'],
    'template.ktv': ['霓彩伴唱', 'Neon KTV', 'ネオン KTV', '네온 KTV', '霓彩伴唱'],
    'template.columnflow': ['直書句流', 'Vertical Verse Flow', '縦書き句流', '세로쓰기 문장 흐름', '竖排句流'],
    'template.columnSen': ['素筆直書', 'Plain Vertical', '素筆の縦書き', '담백한 세로쓰기', '素笔竖排'],
    'template.columnFuda': ['字札直書', 'Card Vertical', '字札の縦書き', '글패 세로쓰기', '字札竖排']
  };

  const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, {}]));
  Object.entries(ROWS).forEach(([key, values]) => {
    LOCALES.forEach((locale, index) => { catalogs[locale][key] = values[index]; });
  });

  let activeLocale = DEFAULT_LOCALE;
  let initialized = false;

  function normalizeLocale(value) {
    const input = String(value || '').trim().replace(/_/g, '-');
    if (!input) return null;
    const lower = input.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower.startsWith('zh-hant')) return 'zh-TW';
    if (lower === 'zh-cn' || lower === 'zh-sg' || lower.startsWith('zh-hans')) return 'zh-CN';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja';
    if (lower === 'ko' || lower.startsWith('ko-')) return 'ko';
    return null;
  }

  function getSavedLocale() {
    try { return normalizeLocale(root.localStorage && root.localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
  }

  function getQueryLocale() {
    try {
      return normalizeLocale(new URL(root.location.href).searchParams.get('lang'));
    } catch (_) {
      return null;
    }
  }

  function getBrowserLocale() {
    try {
      const values = [root.navigator && root.navigator.language].concat(
        root.navigator && Array.isArray(root.navigator.languages) ? root.navigator.languages : []
      );
      for (const value of values) {
        const locale = normalizeLocale(value);
        if (locale) return locale;
      }
    } catch (_) { /* default below */ }
    return DEFAULT_LOCALE;
  }

  function resolveLocale() {
    return getQueryLocale() || getSavedLocale() || getBrowserLocale() || DEFAULT_LOCALE;
  }

  function interpolate(value, vars) {
    if (!vars) return value;
    return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    ));
  }

  function t(key, vars) {
    const catalog = catalogs[activeLocale] || catalogs[DEFAULT_LOCALE];
    const value = catalog[key] || catalogs[DEFAULT_LOCALE][key] || key;
    return interpolate(value, vars);
  }

  function translateElement(element) {
    if (!element || !element.getAttribute) return;
    const textKey = element.getAttribute('data-i18n');
    const titleKey = element.getAttribute('data-i18n-title');
    const ariaKey = element.getAttribute('data-i18n-aria-label');
    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    if (textKey) element.textContent = t(textKey);
    if (titleKey) element.setAttribute('title', t(titleKey));
    if (ariaKey) element.setAttribute('aria-label', t(ariaKey));
    if (placeholderKey) element.setAttribute('placeholder', t(placeholderKey));
  }

  function apply(rootNode) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = activeLocale;
    const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
    if (scope.matches && scope.matches('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]')) {
      translateElement(scope);
    }
    scope.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]')
      .forEach(translateElement);
    document.querySelectorAll('[data-i18n-locale]').forEach((select) => {
      if (select.value !== activeLocale) select.value = activeLocale;
      select.setAttribute('aria-label', t('language.label'));
      select.title = t('language.label');
    });
  }

  function updateExplicitQuery(locale) {
    if (typeof history === 'undefined' || !getQueryLocale()) return;
    try {
      const url = new URL(root.location.href);
      url.searchParams.set('lang', locale);
      history.replaceState(history.state, '', url.href);
    } catch (_) { /* URL pinning is best-effort */ }
  }

  function setLocale(value, options) {
    const locale = normalizeLocale(value) || DEFAULT_LOCALE;
    const opts = options || {};
    activeLocale = locale;
    if (opts.persist !== false) {
      try { root.localStorage && root.localStorage.setItem(STORAGE_KEY, locale); } catch (_) { /* private mode */ }
    }
    if (opts.updateQuery !== false) updateExplicitQuery(locale);
    apply();
    dispatchChange(locale);
    return locale;
  }

  function dispatchChange(locale) {
    if (typeof root.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      root.dispatchEvent(new CustomEvent('i18n:change', { detail: { locale } }));
    }
  }

  function localizeUrl(value, locale) {
    try {
      const url = new URL(value, root.location && root.location.origin ? root.location.origin : 'http://localhost');
      const target = normalizeLocale(locale) || activeLocale;
      if (target === DEFAULT_LOCALE) url.searchParams.delete('lang');
      else url.searchParams.set('lang', target);
      return url.href;
    } catch (_) {
      return String(value || '');
    }
  }

  function bindLocaleControls() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-i18n-locale]').forEach((select) => {
      if (select.dataset.i18nBound === '1') return;
      select.dataset.i18nBound = '1';
      select.addEventListener('change', () => setLocale(select.value));
    });
  }

  function init() {
    if (initialized || typeof document === 'undefined') return;
    initialized = true;
    activeLocale = resolveLocale();
    bindLocaleControls();
    apply();
    dispatchChange(activeLocale);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    DEFAULT_LOCALE,
    LOCALES: LOCALES.slice(),
    STORAGE_KEY,
    catalogs,
    normalizeLocale,
    resolveLocale,
    current: () => activeLocale,
    t,
    apply,
    setLocale,
    localizeUrl,
    init
  };
});
