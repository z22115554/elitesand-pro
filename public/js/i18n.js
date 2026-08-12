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
  const AUTO_ROWS = (root && root.I18nAutoRows) || (
    typeof require === 'function'
      ? (() => { try { return require('./i18n-auto.js'); } catch (_) { return {}; } })()
      : {}
  );
  const AUTO_EXCLUDE = [
    '[data-i18n-skip]',
    '[data-i18n]',
    'script',
    'style',
    'code',
    'pre',
    'textarea',
    '[contenteditable="true"]',
    '.style-thumb-char',
    '.style-thumb-column',
    '#track-title',
    '#track-artist',
    '#lt-track-title',
    '#mini-player-title',
    '#mini-player-artist',
    '.pi-title',
    '.pi-artist',
    '.lib-title',
    '.announcement-item-title',
    '#announcement-banner-title',
    '#announcement-banner-message',
    '#announcement-banner-link',
    '#announcement-critical-title',
    '#announcement-critical-message',
    '#announcement-critical-link',
    '.twitch-req-title',
    '.twitch-req-author',
    '.twitch-req-url',
    '#youtube-risk-title',
    '#youtube-risk-author'
  ].join(',');
  const AUTO_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
  const autoTextState = new WeakMap();
  const autoAttributeState = new WeakMap();
  let autoObserver = null;

  // Each row is [繁中, English, 日本語, 한국어, 简中].
  // Keeping all five values together makes missing translations mechanically testable.
  const ROWS = {
    'app.panelTitle': ['Elitesand Pro 控制面板', 'Elitesand Pro Control Panel', 'Elitesand Pro コントロールパネル', 'Elitesand Pro 제어판', 'Elitesand Pro 控制面板'],
    'app.remoteTitle': ['Elitesand Pro 遙控器', 'Elitesand Pro Remote', 'Elitesand Pro リモコン', 'Elitesand Pro 리모컨', 'Elitesand Pro 遥控器'],
    'app.displayTitle': ['Elitesand Pro 歌詞顯示', 'Elitesand Pro Lyrics Display', 'Elitesand Pro 歌詞表示', 'Elitesand Pro 가사 화면', 'Elitesand Pro 歌词显示'],
    'app.setlistTitle': ['Elitesand Pro 歌單', 'Elitesand Pro Setlist', 'Elitesand Pro セットリスト', 'Elitesand Pro 세트리스트', 'Elitesand Pro 歌单'],
    'app.prompterTitle': ['Elitesand Pro 跟唱視圖', 'Elitesand Pro Sing-Along View', 'Elitesand Pro 歌唱ビュー', 'Elitesand Pro 따라 부르기 화면', 'Elitesand Pro 跟唱视图'],
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
    'guide.obsTaskBefore': ['複製', 'Copy', 'コピーして', '복사해서', '复制'],
    'guide.obsTaskAfter': ['網址加入瀏覽器來源', 'URL into a Browser Source', 'URL をブラウザソースに追加', 'URL을 브라우저 소스에 추가', '网址加入浏览器来源'],
    'guide.playlistUrlBefore': ['：只要網址裡有', ': A URL containing', '：URL に', ': URL에', '：只要网址里有'],
    'guide.playlistUrlAfter': ['就會整批匯入。清單很長時會花比較久，第一次建議先貼幾首少量的測試。', 'imports the whole playlist. Long lists take more time, so start with a few tracks for your first test.', 'があればプレイリスト全体をインポートします。長いリストは時間がかかるため、最初は数曲で試してください。', '가 있으면 재생목록 전체를 가져옵니다. 긴 목록은 시간이 걸리므로 처음에는 몇 곡만 테스트하세요.', '就会整批导入。列表很长时会花较久，第一次建议先贴几首测试。'],
    'guide.setlistUrlBefore': ['OBS 這邊的歌單網址固定是', 'The OBS setlist URL is always', 'OBS のセットリスト URL は常に', 'OBS 세트리스트 URL은 항상', 'OBS 这边的歌单网址固定是'],
    'guide.setlistUrlAfter': ['，換版型不用換網址，會自動同步。', '; layouts sync automatically without changing the URL.', 'です。レイアウトを変えても URL はそのままで自動同期します。', '이며, 레이아웃을 바꿔도 URL은 그대로 자동 동기화됩니다.', '，更换版型不用换网址，会自动同步。'],
    'guide.displayUrlBefore': ['：先確認網址真的是', ': First confirm the URL is', '：まず URL が', ': 먼저 URL이', '：先确认网址确实是'],
    'guide.displayUrlAfter': ['；再看控制台右上角有沒有寫「歌詞已連線」；最後檢查 OBS 來源的寬高是不是設得太小。', '; then check for “Lyrics connected” at the top right, and confirm the OBS source is not too small.', 'であることを確認し、右上に「歌詞接続済み」と表示されるか、OBS ソースが小さすぎないかを確認してください。', '인지 확인하고 오른쪽 위에 “가사 연결됨”이 표시되는지, OBS 소스 크기가 너무 작지 않은지 확인하세요.', '；再看控制台右上角是否显示“歌词已连接”；最后检查 OBS 来源尺寸是否太小。'],
    'guide.faqTwitchAnswer': ['不用，Twitch 只是選配功能，用來接收聊天室的「!點歌」指令；不接 Twitch，其他所有功能都能正常使用。', 'No. Twitch is optional and only receives the chat command “!點歌”; every other feature works without it.', '不要です。Twitch はチャットの「!點歌」コマンドを受け取るためのオプションで、接続しなくても他の機能はすべて使えます。', '아니요. Twitch는 채팅의 “!點歌” 명령을 받기 위한 선택 기능이며, 연결하지 않아도 다른 모든 기능을 사용할 수 있습니다.', '不用，Twitch 只是可选功能，用来接收聊天室的“!点歌”指令；不连接 Twitch，其他功能都能正常使用。'],
    'guide.currentVersion': ['目前 v{version}', 'Current v{version}', '現在 v{version}', '현재 v{version}', '目前 v{version}'],
    'guide.updateVersion': ['可更新 v{version}', 'Update available: v{version}', '更新可能：v{version}', '업데이트 가능: v{version}', '可更新 v{version}'],
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
    'status.lyricsStale': ['歌詞來源可能仍為舊版', 'Lyrics source may be outdated', '歌詞ソースが旧バージョンの可能性があります', '가사 소스가 이전 버전일 수 있음', '歌词来源可能是旧版本'],
    'status.lyricsStaleAria': ['歌詞已連線，但 OBS 來源可能仍使用舊程式碼', 'Lyrics are connected, but the OBS source may still be using outdated code', '歌詞は接続済みですが、OBS ソースが古いコードを使用している可能性があります', '가사는 연결되었지만 OBS 소스가 이전 코드를 사용 중일 수 있습니다', '歌词已连接，但 OBS 来源可能仍在使用旧代码'],
    'status.lyricsStaleWarning': ['偵測到 OBS 歌詞來源可能仍使用舊程式碼。請在 OBS 對「歌詞」瀏覽器來源按右鍵 → 重新整理快取；若仍無效，關閉再開啟該來源。', 'The OBS lyrics source may still be using outdated code. In OBS, right-click the Lyrics Browser Source and choose Refresh cache. If that does not help, close and reopen the source.', 'OBS の歌詞ソースが古いコードを使用している可能性があります。OBS で「歌詞」のブラウザソースを右クリックし、「キャッシュを更新」を実行してください。改善しない場合は、そのソースを閉じて再度開いてください。', 'OBS 가사 소스가 이전 코드를 사용 중일 수 있습니다. OBS에서 ‘가사’ 브라우저 소스를 마우스 오른쪽 버튼으로 클릭한 뒤 캐시 새로 고침을 선택하세요. 그래도 해결되지 않으면 해당 소스를 닫았다가 다시 여세요.', '检测到 OBS 歌词来源可能仍在使用旧代码。请在 OBS 中右键单击“歌词”浏览器来源并选择“刷新缓存”；如果仍无效，请关闭后重新打开该来源。'],
    'status.lyricsPending': ['歌詞驗證中', 'Verifying lyrics source', '歌詞ソースを確認中', '가사 소스 확인 중', '正在验证歌词来源'],
    'status.lyricsPendingAria': ['歌詞已連線，正在確認 OBS 程式版本', 'Lyrics are connected; checking the OBS source version', '歌詞は接続済みで、OBS ソースのバージョンを確認しています', '가사가 연결되었으며 OBS 소스 버전을 확인 중입니다', '歌词已连接，正在确认 OBS 来源版本'],
    'status.setlistConnected': ['歌單已連線', 'Setlist connected', 'セットリスト接続済み', '세트리스트 연결됨', '歌单已连接'],
    'status.setlistDisconnected': ['歌單未連線', 'Setlist disconnected', 'セットリスト未接続', '세트리스트 연결 안 됨', '歌单未连接'],
    'player.noTrack': ['尚未播放', 'Nothing playing', '再生していません', '재생 중인 곡 없음', '尚未播放'],
    'player.unknownTrack': ['未知歌曲', 'Unknown track', '不明な曲', '알 수 없는 곡', '未知歌曲'],
    'player.unknownArtist': ['未知歌手', 'Unknown artist', '不明なアーティスト', '알 수 없는 아티스트', '未知歌手'],
    'player.previous': ['上一首', 'Previous track', '前の曲', '이전 곡', '上一首'],
    'player.playPause': ['播放或暫停', 'Play or pause', '再生または一時停止', '재생 또는 일시정지', '播放或暂停'],
    'player.next': ['下一首', 'Next track', '次の曲', '다음 곡', '下一首'],
    'prompter.name': ['跟唱視圖', 'Sing-Along View', '歌唱ビュー', '따라 부르기 화면', '跟唱视图'],
    'prompter.open': ['跟唱視圖', 'Sing-Along View', '歌唱ビュー', '따라 부르기', '跟唱视图'],
    'prompter.openTitle': ['開啟跟唱視圖（整句歌詞，給主播自己看）', 'Open the sing-along view with full-line lyrics for the streamer', '配信者向けの一行歌詞を表示する歌唱ビューを開く', '스트리머용 전체 줄 가사가 표시되는 따라 부르기 화면 열기', '打开跟唱视图（整句歌词，供主播查看）'],
    'prompter.appearance': ['歌詞外觀', 'Lyrics appearance', '歌詞の表示設定', '가사 모양', '歌词外观'],
    'prompter.progress': ['播放進度', 'Playback progress', '再生位置', '재생 진행률', '播放进度'],
    'prompter.playlistEmpty': ['尚無歌曲', 'No tracks yet', '曲がありません', '아직 곡이 없습니다', '暂无歌曲'],
    'prompter.noLyrics': ['此歌曲無歌詞', 'This song has no lyrics', 'この曲には歌詞がありません', '이 노래에는 가사가 없습니다', '此歌曲无歌词'],
    'prompter.font': ['字體', 'Font', 'フォント', '글꼴', '字体'],
    'prompter.builtInFonts': ['內建字體', 'Built-in fonts', '内蔵フォント', '기본 글꼴', '内置字体'],
    'prompter.localFonts': ['本機字體', 'Installed fonts', 'インストール済みフォント', '설치된 글꼴', '本机字体'],
    'prompter.fontDefault': ['預設（圓體）', 'Default (rounded sans)', '標準（丸ゴシック）', '기본(둥근 고딕)', '默认（圆体）'],
    'prompter.fontSerif': ['襯線', 'Serif', '明朝体', '명조체', '衬线'],
    'prompter.fontMono': ['等寬', 'Monospace', '等幅', '고정폭', '等宽'],
    'prompter.fontSystem': ['系統無襯線', 'System sans-serif', 'システムゴシック', '시스템 고딕', '系统无衬线'],
    'prompter.fontLoading': ['開啟設定時會讀取這台電腦已安裝的字體。', 'Installed fonts on this computer are loaded when settings open.', '設定を開くと、このパソコンにインストール済みのフォントを読み込みます。', '설정을 열면 이 컴퓨터에 설치된 글꼴을 불러옵니다.', '打开设置时会读取此电脑已安装的字体。'],
    'prompter.fontLoadingActive': ['正在讀取本機字體…', 'Loading installed fonts…', 'インストール済みフォントを読み込み中…', '설치된 글꼴을 불러오는 중…', '正在读取本机字体…'],
    'prompter.fontLoaded': ['已載入 {count} 個本機字體', 'Loaded {count} installed fonts', 'インストール済みフォントを {count} 件読み込みました', '설치된 글꼴 {count}개를 불러왔습니다', '已加载 {count} 个本机字体'],
    'prompter.fontUnavailable': ['無法讀取本機字體；仍可使用內建字體。', 'Installed fonts could not be read; built-in fonts remain available.', 'インストール済みフォントを読み込めませんでした。内蔵フォントは使用できます。', '설치된 글꼴을 읽지 못했습니다. 기본 글꼴은 계속 사용할 수 있습니다.', '无法读取本机字体；仍可使用内置字体。'],
    'prompter.fontSize': ['字級', 'Font size', 'フォントサイズ', '글꼴 크기', '字号'],
    'prompter.textColor': ['文字顏色', 'Text color', '文字色', '글자 색상', '文字颜色'],
    'prompter.strokeColor': ['描邊顏色', 'Stroke color', 'ストロークの色', '획 색상', '描边颜色'],
    'prompter.strokeWidth': ['描邊寬度', 'Outline width', '縁取り幅', '외곽선 너비', '描边宽度'],
    'prompter.showRomaji': ['羅馬拼音', 'Romanization', 'ローマ字', '로마자', '罗马拼音'],
    'prompter.showRomajiHint': ['歌詞下方加一行拼音，沒有資料的行不會顯示', 'Adds a romanization line under each lyric; lines without data are skipped.', '歌詞の下にローマ字を1行追加します。データがない行は表示されません。', '가사 아래에 로마자 한 줄을 추가합니다. 데이터가 없는 줄은 표시되지 않습니다.', '歌词下方加一行拼音，没有数据的行不会显示'],
    'prompter.showXieyin': ['諧音', 'Phonetic guide', '発音ガイド', '발음 가이드', '谐音'],
    'prompter.showXieyinHint': ['歌詞下方加一行中文諧音，沒有資料的行不會顯示', 'Adds a Chinese phonetic-guide line under each lyric; lines without data are skipped.', '歌詞の下に中国語の発音ガイドを1行追加します。データがない行は表示されません。', '가사 아래에 중국어 발음 가이드 한 줄을 추가합니다. 데이터가 없는 줄은 표시되지 않습니다.', '歌词下方加一行中文谐音，没有数据的行不会显示'],
    'prompter.resetAppearance': ['重置為預設', 'Reset to defaults', 'デフォルトに戻す', '기본값으로 재설정', '重置为默认值'],
    'common.close': ['關閉', 'Close', '閉じる', '닫기', '关闭'],
    'common.cancel': ['取消', 'Cancel', 'キャンセル', '취소', '取消'],
    'common.confirm': ['確認', 'Confirm', '確認', '확인', '确认'],
    'common.apply': ['套用', 'Apply', '適用', '적용', '应用'],
    'common.reset': ['重置', 'Reset', 'リセット', '초기화', '重置'],
    'common.resetZero': ['歸零', 'Reset to zero', 'ゼロに戻す', '0으로 초기화', '归零'],
    'common.copied': ['已複製', 'Copied', 'コピーしました', '복사됨', '已复制'],
    'common.copy': ['複製', 'Copy', 'コピー', '복사', '复制'],
    'common.clear': ['清除', 'Clear', 'クリア', '지우기', '清除'],
    'common.import': ['匯入', 'Import', 'インポート', '가져오기', '导入'],
    'common.export': ['匯出', 'Export', 'エクスポート', '내보내기', '导出'],
    'common.select': ['選取', 'Select', '選択', '선택', '选择'],
    'common.retry': ['重試', 'Retry', '再試行', '다시 시도', '重试'],
    'common.enterPhrase': ['輸入「{phrase}」', 'Enter “{phrase}”', '「{phrase}」と入力', '“{phrase}” 입력', '输入“{phrase}”'],
    'common.all': ['全部', 'All', 'すべて', '전체', '全部'],
    'common.enabled': ['啟用', 'Enabled', '有効', '활성화', '启用'],
    'common.disabled': ['停用', 'Disabled', '無効', '비활성화', '停用'],
    'common.on': ['開', 'On', 'オン', '켬', '开'],
    'common.off': ['關', 'Off', 'オフ', '끔', '关'],
    'settings.workspace.obsOutput': ['OBS 輸出', 'OBS output', 'OBS 出力', 'OBS 출력', 'OBS 输出'],
    'settings.workspace.navLabel': ['設定分類', 'Settings categories', '設定カテゴリ', '설정 분류', '设置分类'],
    'settings.workspace.layout': ['版面', 'Layout', 'レイアウト', '레이아웃', '布局'],
    'settings.workspace.readability': ['可讀性', 'Readability', '可読性', '가독성', '可读性'],
    'settings.workspace.appearance': ['外觀', 'Appearance', '見た目', '외관', '外观'],
    'settings.workspace.advanced': ['進階', 'Advanced', '詳細', '고급', '高级'],
    'settings.workspace.liveSaved': ['已即時儲存', 'Saved in real time', 'リアルタイムで保存済み', '실시간 저장됨', '已实时保存'],
    'settings.workspace.saving': ['儲存中…', 'Saving…', '保存中…', '저장 중…', '保存中…'],
    'settings.workspace.savedAt': ['已儲存 {time}', 'Saved {time}', '{time} に保存しました', '{time}에 저장됨', '已保存 {time}'],
    'settings.workspace.saveFailed': ['儲存失敗：{message}', 'Could not save: {message}', '保存に失敗しました：{message}', '저장하지 못했습니다: {message}', '保存失败：{message}'],
    'settings.workspace.currentTemplate': ['目前：{template}', 'Current: {template}', '現在：{template}', '현재: {template}', '当前：{template}'],
    'settings.workspace.livePreview': ['即時預覽', 'Live preview', 'ライブプレビュー', '실시간 미리보기', '即时预览'],
    'settings.workspace.findSettings': ['找設定', 'Find settings', '設定を検索', '설정 찾기', '查找设置'],
    'settings.workspace.searchPlaceholder': ['例如：位置、寬度、陰影、背景', 'For example: position, width, shadow, background', '例：位置、幅、影、背景', '예: 위치, 너비, 그림자, 배경', '例如：位置、宽度、阴影、背景'],
    'settings.workspace.searchHint': ['只會顯示目前模板可用的設定。', 'Only settings available for the current template will be displayed.', '現在のテンプレートで利用可能な設定のみが表示されます。', '현재 템플릿에서 사용할 수 있는 설정만 표시됩니다.', '只会显示当前模板可用的设置。'],
    'settings.workspace.searchMatches': ['找到 {count} 個目前模板可用的設定分類。', 'Found {count} setting categories available for the current template.', '現在のテンプレートで利用できる設定カテゴリが {count} 件見つかりました。', '현재 템플릿에서 사용할 수 있는 설정 분류 {count}개를 찾았습니다.', '找到 {count} 个当前模板可用的设置分类。'],
    'settings.workspace.searchNoMatches': ['目前模板沒有相符設定；可改用另一個關鍵字或切換模板。', 'No matching settings are available for the current template. Try another keyword or switch templates.', '現在のテンプレートに一致する設定はありません。別のキーワードを試すか、テンプレートを切り替えてください。', '현재 템플릿에 일치하는 설정이 없습니다. 다른 키워드를 사용하거나 템플릿을 전환하세요.', '当前模板没有匹配的设置；请尝试其他关键词或切换模板。'],
    'settings.workspace.resetAll': ['全部重置為預設', 'Reset all to default', 'すべてをデフォルトにリセット', '모두 기본값으로 재설정', '全部重置为默认值'],
    'settings.workspace.pausedTemplate': ['{template}（暫停提供）', '{template} (unavailable)', '{template}（現在利用不可）', '{template} (현재 사용 불가)', '{template}（暂不可用）'],
    'settings.preview.hint': ['調整設定時，這裡會即時顯示 OBS 輸出。', 'OBS output updates here as you adjust settings.', '設定を変更すると、ここに OBS 出力がリアルタイムで表示されます。', '설정을 조정하면 OBS 출력이 여기에 실시간으로 표시됩니다.', '调整设置时，这里会实时显示 OBS 输出。'],
    'settings.openDetails': ['開啟詳細設定…', 'Open detailed settings…', '詳細設定を開く…', '세부 설정 열기…', '打开详细设置…'],
    'settings.lyrics.detailTitle': ['詳細外觀設定', 'Detailed appearance settings', '外観の詳細設定', '세부 외관 설정', '详细外观设置'],
    'settings.lyrics.detailHint': ['位置、排版、歷史行、描邊、陰影、發光與背景等低頻設定。', 'Less frequently used settings for position, layout, previous lyric lines, outlines, shadows, glow, and background.', '位置、レイアウト、過去の歌詞行、縁取り、影、発光、背景など、変更頻度の低い設定です。', '위치, 레이아웃, 이전 가사 줄, 외곽선, 그림자, 발광, 배경처럼 자주 바꾸지 않는 설정입니다.', '位置、布局、历史歌词行、描边、阴影、发光与背景等不常调整的设置。'],
    'settings.lyrics.modalTitle': ['歌詞詳細設定', 'Detailed lyrics settings', '歌詞の詳細設定', '가사 세부 설정', '歌词详细设置'],
    'settings.setlist.templateTitle': ['歌單模板', 'Setlist templates', 'セットリストテンプレート', '세트리스트 템플릿', '歌单模板'],
    'settings.setlist.modalTitle': ['歌單詳細設定', 'Detailed setlist settings', 'セットリストの詳細設定', '세트리스트 세부 설정', '歌单详细设置'],
    'settings.setlist.previewTitle': ['歌單即時預覽', 'Live setlist preview', 'セットリストのライブプレビュー', '실시간 세트리스트 미리보기', '歌单实时预览'],
    'settings.setlist.detailTitle': ['詳細歌單設定', 'Detailed setlist settings', 'セットリストの詳細設定', '세트리스트 세부 설정', '详细歌单设置'],
    'settings.setlist.detailHint': ['字體、尺寸、邊框、動畫、固定標籤與模板專屬設定。', 'Fonts, sizing, borders, animation, fixed labels, and template-specific settings.', 'フォント、サイズ、枠線、アニメーション、固定ラベル、テンプレート固有の設定です。', '글꼴, 크기, 테두리, 애니메이션, 고정 라벨과 템플릿 전용 설정입니다.', '字体、尺寸、边框、动画、固定标签与模板专属设置。'],
    'settings.setlist.demoLoad': ['載入示範資料', 'Load sample data', 'サンプルデータを読み込む', '샘플 데이터 불러오기', '加载示例数据'],
    'settings.setlist.demoClear': ['清除示範資料', 'Clear sample data', 'サンプルデータを消去', '샘플 데이터 지우기', '清除示例数据'],
    'settings.setlist.searchPlaceholder': ['例如：字體、寬度、已唱、陰影、場景', 'For example: font, width, performed, shadow, scene', '例：フォント、幅、歌唱済み、影、シーン', '예: 글꼴, 너비, 부른 곡, 그림자, 장면', '例如：字体、宽度、已唱、阴影、场景'],
    'settings.setlist.searchHint': ['可直接搜尋設定名稱或用途。', 'Search by setting name or purpose.', '設定名や用途で検索できます。', '설정 이름이나 용도로 검색할 수 있습니다.', '可按设置名称或用途搜索。'],
    'settings.setlist.searchMatches': ['找到 {count} 個設定區塊。', 'Found {count} setting sections.', '設定セクションが {count} 件見つかりました。', '설정 구역 {count}개를 찾았습니다.', '找到 {count} 个设置区块。'],
    'settings.setlist.searchNoMatches': ['找不到相符設定；可試試「字體」、「寬度」、「已唱」或「特效」。', 'No matching settings. Try “font,” “width,” “performed,” or “effects.”', '一致する設定がありません。「フォント」「幅」「歌唱済み」「エフェクト」などを試してください。', '일치하는 설정이 없습니다. “글꼴”, “너비”, “부른 곡”, “효과”를 검색해 보세요.', '找不到匹配的设置；可尝试“字体”“宽度”“已唱”或“特效”。'],
    'settings.setlist.previewSizeLabel': ['模擬 OBS 來源尺寸', 'Simulate OBS source size', 'OBS ソースサイズをシミュレーション', 'OBS 소스 크기 시뮬레이션', '模拟 OBS 来源尺寸'],
    'settings.setlist.sizeLandscape': ['橫式 1920×1080', 'Landscape 1920×1080', '横 1920×1080', '가로 1920×1080', '横向 1920×1080'],
    'settings.setlist.sizePortrait': ['直式 600×1080', 'Portrait 600×1080', '縦 600×1080', '세로 600×1080', '竖屏 600×1080'],
    'settings.setlist.sizeStrip': ['橫條 1920×320', 'Strip 1920×320', '横長 1920×320', '가로 막대 1920×320', '横条 1920×320'],
    'settings.setlist.sizeSmall': ['小框 640×480', 'Small frame 640×480', '小型 640×480', '소형 640×480', '小窗口 640×480'],
    'settings.setlist.previewFrameTitle': ['歌單預覽', 'Setlist preview', 'セットリストプレビュー', '세트리스트 미리보기', '歌单预览'],
    'settings.setlist.obsHint': ['貼上此網址後，直接在 OBS 把 Browser Source 拉成你要的大小與位置；模板、配色與大小都會即時同步，網址永遠不用換。', 'Paste this URL into OBS, then resize and position the Browser Source as needed. Templates, colors, and sizing sync live, so the URL never changes.', 'この URL を OBS に貼り付け、ブラウザソースを必要なサイズと位置に調整してください。テンプレート、配色、サイズはリアルタイムで同期され、URL を変更する必要はありません。', '이 URL을 OBS에 붙여넣고 브라우저 소스를 원하는 크기와 위치로 조정하세요. 템플릿, 색상과 크기는 실시간으로 동기화되며 URL은 바꿀 필요가 없습니다.', '粘贴此网址后，直接在 OBS 中把浏览器来源调整到所需大小与位置；模板、配色与尺寸会实时同步，网址无需更换。'],
    'settings.setlist.queueScrollDelay': ['捲動前停留秒數', 'Pause before scrolling', 'スクロール前の停止時間', '스크롤 전 대기 시간', '滚动前停留秒数'],
    'settings.setlist.queueScrollSpeed': ['捲動速度', 'Scroll speed', 'スクロール速度', '스크롤 속도', '滚动速度'],
    'settings.setlist.queueScrollHint': ['已唱／未唱清單放不下才會自動捲動：每輪先停留幾秒讓觀眾看清楚，再往上捲；捲動速度越大，捲得越快。', 'Performed and upcoming lists scroll only when they overflow. Each loop pauses first, then moves upward; a higher speed scrolls faster.', '歌唱済み／未歌唱リストが収まらない場合のみ自動スクロールします。各周回で一度停止してから上へ移動し、速度を上げるほど速くなります。', '부른 곡／예정 곡 목록이 공간을 넘을 때만 자동으로 스크롤됩니다. 매 반복마다 잠시 멈춘 뒤 위로 이동하며, 속도 값이 클수록 더 빠르게 움직입니다.', '已唱／未唱列表放不下时才会自动滚动：每轮先停留几秒再向上滚动；速度数值越大，滚动越快。'],
    'home.session.title': ['本場直播', 'Current stream', '今回の配信', '이번 방송', '本场直播'],
    'home.session.openRecord': ['查看本場紀錄', 'View stream history', '今回の配信履歴を見る', '이번 방송 기록 보기', '查看本场记录'],
    'home.session.recordTitle': ['本場演出紀錄', 'Current stream history', '今回の配信履歴', '이번 방송 기록', '本场直播记录'],
    'home.session.recordHint': ['直播 Session、已唱歌曲與 YouTube 章節集中在這裡管理。', 'Manage the live session, performed tracks, and YouTube chapters here.', '配信セッション、歌唱済みの曲、YouTube チャプターをここでまとめて管理します。', '방송 세션, 부른 곡과 YouTube 챕터를 여기에서 함께 관리합니다.', '在这里集中管理直播场次、已唱歌曲与 YouTube 章节。'],
    'home.session.statusTitle': ['直播 Session', 'Live session', '配信セッション', '방송 세션', '直播场次'],
    'home.session.statusHint': ['開台與收台會由 OBS WebSocket 自動同步；播放的每首歌會自動記錄，可匯出為 YouTube 章節格式。', 'OBS WebSocket keeps stream start and end in sync. Each played track is recorded and can be exported as YouTube chapters.', '配信開始・終了は OBS WebSocket と自動同期されます。再生した曲は自動記録され、YouTube チャプター形式で書き出せます。', '방송 시작과 종료는 OBS WebSocket과 자동으로 동기화됩니다. 재생한 곡은 자동으로 기록되며 YouTube 챕터 형식으로 내보낼 수 있습니다.', '开播与下播会通过 OBS WebSocket 自动同步；播放的每首歌会自动记录，并可导出为 YouTube 章节格式。'],
    'home.session.refresh': ['重新整理狀態', 'Refresh status', '状態を更新', '상태 새로고침', '刷新状态'],
    'home.session.refreshing': ['重新整理中…', 'Refreshing…', '更新中…', '새로고침 중…', '正在刷新…'],
    'home.session.clear': ['清除歌單', 'Clear setlist', 'セットリストを消去', '세트리스트 지우기', '清除歌单'],
    'home.session.waitingObs': ['等待 OBS 開始推流', 'Waiting for OBS to start streaming', 'OBS の配信開始を待っています', 'OBS 송출 시작 대기 중', '等待 OBS 开始推流'],
    'home.session.performed': ['已唱歌曲', 'Performed tracks', '歌唱済みの曲', '부른 곡', '已唱歌曲'],
    'home.session.copyChapters': ['複製 YouTube 章節', 'Copy YouTube chapters', 'YouTube チャプターをコピー', 'YouTube 챕터 복사', '复制 YouTube 章节'],
    'home.session.empty': ['開台後播放歌曲，歌單會自動在此顯示。', 'Play tracks after going live and they will appear here automatically.', '配信開始後に曲を再生すると、ここに自動表示されます。', '방송 시작 후 곡을 재생하면 여기에 자동으로 표시됩니다.', '开播后播放歌曲，歌单会自动显示在这里。'],
    'home.session.removeSong': ['從已唱歌單移除', 'Remove from performed list', '歌唱済みリストから削除', '부른 곡 목록에서 삭제', '从已唱歌单移除'],
    'home.session.count': ['{count} 首', '{count} tracks', '{count} 曲', '{count}곡', '{count} 首'],
    'home.session.statusNotLive': ['尚未開台 · 已唱 0 首', 'Not live yet · 0 tracks performed', '配信前 · 歌唱済み 0 曲', '아직 방송 전 · 부른 곡 0개', '尚未开播 · 已唱 0 首'],
    'home.session.statusPending': ['等待確認直播狀態 · {count} 首已記錄', 'Waiting to confirm stream status · {count} tracks recorded', '配信状態の確認待ち · {count} 曲を記録', '방송 상태 확인 대기 중 · {count}곡 기록됨', '等待确认直播状态 · 已记录 {count} 首'],
    'home.session.statusLive': ['{source} · {duration} · 已唱 {count} 首', '{source} · {duration} · {count} tracks performed', '{source} · {duration} · 歌唱済み {count} 曲', '{source} · {duration} · 부른 곡 {count}개', '{source} · {duration} · 已唱 {count} 首'],
    'home.session.statusEnded': ['已收台 · {count} 首已記錄', 'Stream ended · {count} tracks recorded', '配信終了 · {count} 曲を記録', '방송 종료 · {count}곡 기록됨', '已下播 · 已记录 {count} 首'],
    'home.session.sourceObs': ['OBS 推流中', 'OBS streaming', 'OBS 配信中', 'OBS 송출 중', 'OBS 推流中'],
    'home.session.sourceTwitch': ['Twitch 開台中', 'Live on Twitch', 'Twitch で配信中', 'Twitch 방송 중', 'Twitch 开播中'],
    'home.session.sourceLive': ['直播中', 'Live', '配信中', '방송 중', '直播中'],
    'home.session.copySuccess': ['✓ 已複製章節', '✓ Chapters copied', '✓ チャプターをコピーしました', '✓ 챕터 복사됨', '✓ 已复制章节'],
    'home.session.chapterOpening': ['00:00 開台', '00:00 Stream started', '00:00 配信開始', '00:00 방송 시작', '00:00 开播'],
    'home.session.toastObsStreaming': ['OBS 正在推流，直播 Session 已重新確認', 'OBS is streaming. Live session status was updated.', 'OBS は配信中です。配信セッションの状態を更新しました。', 'OBS가 송출 중입니다. 방송 세션 상태를 갱신했습니다.', 'OBS 正在推流，直播场次状态已更新'],
    'home.session.toastTwitchContinues': ['OBS 目前未推流；Twitch 開台中的 Session 維持不變', 'OBS is not streaming; the active Twitch session is unchanged.', 'OBS は現在配信していません。Twitch の配信セッションはそのまま維持されます。', 'OBS는 현재 송출 중이 아니며 Twitch 방송 세션은 그대로 유지됩니다.', 'OBS 当前未推流；Twitch 直播场次保持不变'],
    'home.session.toastObsNotStreaming': ['OBS 目前未推流，直播 Session 已重新確認', 'OBS is not streaming. Live session status was updated.', 'OBS は現在配信していません。配信セッションの状態を更新しました。', 'OBS는 현재 송출 중이 아닙니다. 방송 세션 상태를 갱신했습니다.', 'OBS 当前未推流，直播场次状态已更新'],
    'home.session.toastObsReadFailed': ['無法讀取 OBS 推流狀態，已重新讀取歌單資料', 'Could not read OBS stream status; setlist data was refreshed.', 'OBS の配信状態を取得できなかったため、セットリストデータを再読み込みしました。', 'OBS 송출 상태를 읽지 못해 세트리스트 데이터를 다시 불러왔습니다.', '无法读取 OBS 推流状态，已重新读取歌单数据'],
    'home.session.toastObsDisconnected': ['已重新讀取歌單資料；OBS WebSocket 未連線，無法確認推流狀態', 'Setlist data was refreshed, but OBS WebSocket is disconnected so stream status could not be confirmed.', 'セットリストデータを再読み込みしましたが、OBS WebSocket が未接続のため配信状態を確認できません。', '세트리스트 데이터를 다시 불러왔지만 OBS WebSocket이 연결되지 않아 송출 상태를 확인할 수 없습니다.', '已重新读取歌单数据；OBS WebSocket 未连接，无法确认推流状态'],
    'home.session.confirmTitle': ['清除整個直播歌單？', 'Clear the entire stream setlist?', '配信セットリストをすべて消去しますか？', '방송 세트리스트 전체를 지울까요?', '清除整个直播歌单？'],
    'home.session.confirmSummary': ['本次直播已唱歌曲與 YouTube 章節將被清除。', 'Performed tracks and YouTube chapters from this stream will be cleared.', '今回の配信で歌唱した曲と YouTube チャプターが消去されます。', '이번 방송에서 부른 곡과 YouTube 챕터가 삭제됩니다.', '本次直播的已唱歌曲与 YouTube 章节将被清除。'],
    'home.session.confirmImpact': ['播放清單、音檔、媒體庫與 OBS 版型設定都會保留。', 'The playlist, audio files, media library, and OBS layout settings will be kept.', 'プレイリスト、音声ファイル、メディアライブラリ、OBS レイアウト設定は保持されます。', '재생목록, 오디오 파일, 미디어 라이브러리와 OBS 레이아웃 설정은 유지됩니다.', '播放列表、音频文件、媒体库与 OBS 布局设置都会保留。'],
    'home.session.confirmLabel': ['清除直播歌單', 'Clear stream setlist', '配信セットリストを消去', '방송 세트리스트 지우기', '清除直播歌单'],
    'home.session.startNew': ['開始新場次', 'Start new session', '新しいセッションを開始', '새 세션 시작', '开始新场次'],
    'home.session.newTitle': ['開始新場次？', 'Start a new session?', '新しいセッションを開始しますか？', '새 세션을 시작할까요？', '开始新场次？'],
    'home.session.newSummary': ['會清空目前的播放清單與本場已唱記錄，準備好唱新的一場。', 'This clears the current playlist and this session’s performed-track history, ready for a fresh start.', '現在の再生リストと今回のセッションの歌唱履歴を消去し、新しいセッションに備えます。', '현재 재생목록과 이번 세션의 부른 곡 기록을 지우고 새 세션을 준비합니다.', '会清空当前播放清单与本场已唱记录，准备好开始新的一场。'],
    'home.session.newImpact': ['歌曲音檔、媒體庫紀錄與歌詞設定都會保留；播放清單與已唱歌單清空後可從媒體庫重新加入歌曲。', 'Audio files, media library records, and lyric settings are kept; after the playlist and performed-track list are cleared, songs can be re-added from the media library.', '音声ファイル、メディアライブラリの記録、歌詞設定は保持されます。再生リストと歌唱履歴を消去した後は、メディアライブラリから曲を再度追加できます。', '오디오 파일, 미디어 라이브러리 기록과 가사 설정은 유지됩니다. 재생목록과 부른 곡 목록을 지운 후에는 미디어 라이브러리에서 곡을 다시 추가할 수 있습니다.', '歌曲音频文件、媒体库记录与歌词设置都会保留；播放清单与已唱歌单清空后可从媒体库重新添加歌曲。'],
    'home.session.newConfirmLabel': ['開始新場次', 'Start new session', '新しいセッションを開始', '새 세션 시작', '开始新场次'],
    'home.session.newDone': ['已開始新場次', 'New session started', '新しいセッションを開始しました', '새 세션을 시작했습니다', '已开始新场次'],
    'home.session.detectTitle': ['偵測到新場次開始', 'New session detected', '新しいセッションの開始を検出しました', '새 세션 시작이 감지되었습니다', '侦测到新场次开始'],
    'home.session.detectSummary': ['播放清單裡還留著上一場的歌，要順便清空嗎？', 'The playlist still has tracks from the last session. Want to clear it too?', '再生リストには前回のセッションの曲がまだ残っています。一緒に消去しますか？', '재생목록에 지난 세션의 곡이 아직 남아 있습니다. 함께 지울까요？', '播放清单里还留着上一场的歌，要顺便清空吗？'],
    'home.session.detectImpact': ['歌曲音檔、媒體庫紀錄與歌詞設定都會保留；清空後可從媒體庫重新加入歌曲。', 'Audio files, media library records, and lyric settings are kept; songs can be re-added from the media library after clearing.', '音声ファイル、メディアライブラリの記録、歌詞設定は保持されます。消去後はメディアライブラリから曲を再度追加できます。', '오디오 파일, 미디어 라이브러리 기록과 가사 설정은 유지됩니다. 지운 후에는 미디어 라이브러리에서 곡을 다시 추가할 수 있습니다.', '歌曲音频文件、媒体库记录与歌词设置都会保留；清空后可从媒体库重新添加歌曲。'],
    'home.session.detectConfirmLabel': ['清空播放清單', 'Clear playlist', '再生リストを消去', '재생목록 지우기', '清空播放清单'],
    'home.welcome': ['歡迎使用 Elitesand Pro！先從下方「音樂來源」上傳檔案或貼上 YouTube 連結，再把右側的 OBS 來源網址加進 OBS 即可開始。', 'Welcome to Elitesand Pro! Upload a file or paste a YouTube link under Music source, then add the OBS source URL on the right to OBS.', 'Elitesand Pro へようこそ！「音楽ソース」でファイルをアップロードするか YouTube リンクを貼り、右側の OBS ソース URL を OBS に追加してください。', 'Elitesand Pro에 오신 것을 환영합니다! 음악 소스에서 파일을 업로드하거나 YouTube 링크를 붙여넣고, 오른쪽 OBS 소스 URL을 OBS에 추가하세요.', '欢迎使用 Elitesand Pro！请在“音乐来源”上传文件或粘贴 YouTube 链接，再把右侧的 OBS 来源网址添加到 OBS。'],
    'home.openGuide': ['查看完整新手教學 →', 'Open the full guide →', '詳しいガイドを見る →', '전체 가이드 보기 →', '查看完整新手教程 →'],
    'home.closeHint': ['關閉提示', 'Dismiss tip', 'ヒントを閉じる', '도움말 닫기', '关闭提示'],
    'home.nowPlaying': ['正在播放', 'Now playing', '再生中', '재생 중', '正在播放'],
    'home.volume': ['音量', 'Volume', '音量', '볼륨', '音量'],
    'home.emergency': ['緊急隱藏', 'Emergency hide', '緊急非表示', '긴급 숨기기', '紧急隐藏'],
    'playlist.title': ['播放清單', 'Playlist', 'プレイリスト', '재생목록', '播放列表'],
    'playlist.manage': ['播放清單管理', 'Playlist management', 'プレイリスト管理', '재생목록 관리', '播放列表管理'],
    'playlist.clearAll': ['清除全部', 'Clear all', 'すべて削除', '모두 지우기', '全部清除'],
    'playlist.searchAndFilter': ['播放清單搜尋與篩選', 'Playlist search and filters', 'プレイリストの検索と絞り込み', '재생목록 검색 및 필터', '播放列表搜索与筛选'],
    'playlist.search': ['搜尋播放清單', 'Search playlist', 'プレイリストを検索', '재생목록 검색', '搜索播放列表'],
    'playlist.searchPlaceholder': ['搜尋歌名、歌手或翻唱者…', 'Search title, artist, or performer…', '曲名、アーティスト、歌い手を検索…', '곡명, 아티스트 또는 가수 검색…', '搜索歌名、歌手或翻唱者…'],
    'playlist.filter': ['播放清單篩選', 'Playlist filter', 'プレイリスト絞り込み', '재생목록 필터', '播放列表筛选'],
    'playlist.filterAll': ['全部歌曲', 'All tracks', 'すべての曲', '모든 곡', '全部歌曲'],
    'playlist.filterUpcoming': ['待唱', 'Upcoming', '未再生', '부를 곡', '待唱'],
    'playlist.filterPlayed': ['已唱', 'Performed', '歌唱済み', '부른 곡', '已唱'],
    'playlist.filterNoLyrics': ['無歌詞', 'No lyrics', '歌詞なし', '가사 없음', '无歌词'],
    'playlist.filterMissingAudio': ['音檔遺失', 'Missing audio', '音声ファイルなし', '오디오 파일 없음', '音频丢失'],
    'playlist.count': ['{count} 首', '{count} tracks', '{count} 曲', '{count}곡', '{count} 首'],
    'playlist.remaining': [' · 剩 {time}', ' · {time} left', ' · 残り {time}', ' · {time} 남음', ' · 剩余 {time}'],
    'playlist.visibleCount': ['顯示 {visible} / {total} 首', 'Showing {visible} / {total}', '{visible} / {total} 曲を表示', '{visible} / {total}곡 표시', '显示 {visible} / {total} 首'],
    'playlist.totalCount': ['共 {count} 首歌曲', '{count} tracks total', '全 {count} 曲', '총 {count}곡', '共 {count} 首歌曲'],
    'playlist.doneSelecting': ['完成選取', 'Done selecting', '選択完了', '선택 완료', '完成选择'],
    'playlist.deselectVisible': ['取消顯示結果', 'Deselect visible results', '表示結果の選択を解除', '표시된 결과 선택 해제', '取消显示结果'],
    'playlist.selectedCount': ['已選 {count} 首', '{count} selected', '{count} 曲選択', '{count}곡 선택', '已选 {count} 首'],
    'playlist.removeSelectedCount': ['移除已選 ({count})', 'Remove selected ({count})', '選択項目を削除（{count}）', '선택 항목 삭제 ({count})', '移除已选 ({count})'],
    'playlist.selectedZero': ['已選 0 首', '0 selected', '0 曲選択', '0곡 선택', '已选 0 首'],
    'playlist.selectionHint': ['正在播放的歌曲不會加入批次移除', 'The playing track is excluded from bulk removal', '再生中の曲は一括削除の対象外です', '재생 중인 곡은 일괄 삭제에서 제외됩니다', '正在播放的歌曲不会加入批量移除'],
    'playlist.selectVisible': ['全選顯示結果', 'Select visible results', '表示結果をすべて選択', '표시된 결과 모두 선택', '全选显示结果'],
    'playlist.cancelSelection': ['取消選取', 'Cancel selection', '選択を解除', '선택 취소', '取消选择'],
    'playlist.removeSelected': ['移除已選', 'Remove selected', '選択項目を削除', '선택 항목 삭제', '移除已选'],
    'playlist.empty': ['尚無歌曲，請上傳檔案或貼上 YouTube 連結', 'No tracks yet. Upload a file or paste a YouTube link.', '曲がありません。ファイルをアップロードするか YouTube リンクを貼り付けてください。', '아직 곡이 없습니다. 파일을 업로드하거나 YouTube 링크를 붙여넣으세요.', '暂无歌曲，请上传文件或粘贴 YouTube 链接'],
    'playlist.noMatches': ['沒有符合目前搜尋與篩選條件的歌曲。', 'No tracks match the current search and filters.', '現在の検索・絞り込み条件に一致する曲はありません。', '현재 검색 및 필터 조건에 맞는 곡이 없습니다.', '没有符合当前搜索与筛选条件的歌曲。'],
    'playlist.continuous': ['連續播放', 'Continuous playback', '連続再生', '연속 재생', '连续播放'],
    'playlist.continuousHint': ['一首播完自動播下一首；關閉時單曲播完即停', 'Automatically play the next track; when off, stop after each track', '曲の終了後に次を自動再生。オフでは一曲ごとに停止します', '한 곡이 끝나면 다음 곡을 자동으로 재생합니다. 끄면 한 곡 재생이 끝난 뒤 멈춥니다.', '一首播完后自动播放下一首；关闭时单曲播完即停'],
    'playlist.defaultExportName': ['播放清單-{date}', 'Playlist-{date}', 'プレイリスト-{date}', '재생목록-{date}', '播放列表-{date}'],
    'source.title': ['音樂來源', 'Music source', '音楽ソース', '음악 소스', '音乐来源'],
    'source.localFiles': ['本機檔案', 'Local files', 'ローカルファイル', '로컬 파일', '本地文件'],
    'source.youtubeLink': ['YouTube 連結', 'YouTube link', 'YouTube リンク', 'YouTube 링크', 'YouTube 链接'],
    'source.youtubePlaceholder': ['貼上 YouTube 連結', 'Paste a YouTube link', 'YouTube リンクを貼り付け', 'YouTube 링크 붙여넣기', '粘贴 YouTube 链接'],
    'source.importAudio': ['匯入音訊', 'Import audio', '音声をインポート', '오디오 가져오기', '导入音频'],
    'source.warningDisabled': ['匯入警告已關閉，遇到可疑影片會自動繼續。', 'Import warnings are off; suspicious videos will continue automatically.', 'インポート警告はオフです。疑わしい動画も自動的に続行します。', '가져오기 경고가 꺼져 있어 의심스러운 동영상도 자동으로 계속됩니다.', '导入警告已关闭，遇到可疑视频会自动继续。'],
    'source.reenableWarnings': ['重新啟用', 'Turn back on', '再度有効にする', '다시 켜기', '重新启用'],
    'source.workCenter': ['工作中心', 'Work center', '作業センター', '작업 센터', '工作中心'],
    'source.clearCompleted': ['清除已完成', 'Clear completed', '完了分を消去', '완료 항목 지우기', '清除已完成'],
    'source.dropFiles': ['拖放音訊檔案到這裡', 'Drop audio files here', '音声ファイルをここにドロップ', '오디오 파일을 여기에 놓으세요', '将音频文件拖放到这里'],
    'source.supportedFormats': ['支援 MP3 / FLAC / WAV / M4A / OGG', 'Supports MP3 / FLAC / WAV / M4A / OGG', 'MP3 / FLAC / WAV / M4A / OGG に対応', 'MP3 / FLAC / WAV / M4A / OGG 지원', '支持 MP3 / FLAC / WAV / M4A / OGG'],
    'source.chooseFiles': ['選擇檔案', 'Choose files', 'ファイルを選択', '파일 선택', '选择文件'],
    'preview.title': ['歌詞即時預覽', 'Live lyrics preview', '歌詞ライブプレビュー', '실시간 가사 미리보기', '歌词实时预览'],
    'preview.homeHint': ['選歌或調整設定時，這裡會即時顯示 OBS 輸出。', 'OBS output appears here as you select a track or adjust settings.', '曲の選択や設定変更に合わせて OBS 出力をここに表示します。', '곡을 선택하거나 설정을 조정하면 OBS 출력이 여기에 표시됩니다.', '选歌或调整设置时，这里会实时显示 OBS 输出。'],
    'preview.synced': ['已即時同步', 'Live sync active', 'リアルタイム同期中', '실시간 동기화 중', '已实时同步'],
    'preview.sampleLyrics': ['示範歌詞', 'Sample lyrics', 'サンプル歌詞', '샘플 가사', '示范歌词'],
    'preview.chooseSource': ['選擇來源', 'Choose source', 'ソースを選択', '소스 선택', '选择来源'],
    'preview.pasteLyrics': ['貼上歌詞', 'Paste lyrics', '歌詞を貼り付け', '가사 붙여넣기', '粘贴歌词'],
    'preview.obs': ['OBS 預覽', 'OBS preview', 'OBS プレビュー', 'OBS 미리보기', 'OBS 预览'],
    'preview.obsTitle': ['OBS 歌詞即時預覽', 'Live OBS lyrics preview', 'OBS 歌詞ライブプレビュー', 'OBS 실시간 가사 미리보기', 'OBS 歌词实时预览'],
    'preview.obsHint': ['在 OBS 新增「瀏覽器來源」後貼上此網址；歌詞設定會自動同步，不需要更新網址。', 'Add a Browser Source in OBS and paste this URL. Lyrics settings sync automatically.', 'OBS に「ブラウザソース」を追加してこの URL を貼り付けてください。歌詞設定は自動同期されます。', 'OBS에 브라우저 소스를 추가하고 이 URL을 붙여넣으세요. 가사 설정은 자동으로 동기화됩니다.', '在 OBS 新增“浏览器来源”后粘贴此网址；歌词设置会自动同步。'],
    'twitch.statusTitle': ['點歌狀態', 'Request status', 'リクエスト状態', '신청곡 상태', '点歌状态'],
    'twitch.statusHint': ['直播中常用的狀態與操作集中在這裡。', 'Common live status and actions are collected here.', '配信中によく使う状態と操作をここにまとめています。', '방송 중 자주 쓰는 상태와 작업을 모았습니다.', '直播中常用的状态与操作集中在这里。'],
    'twitch.pauseRequests': ['暫停點歌', 'Pause song requests', 'リクエストを一時停止', '신청곡 일시 중지', '暂停点歌'],
    'twitch.openRequests': ['開放點歌', 'Open requests', 'リクエストを受付', '신청곡 열기', '开放点歌'],
    'twitch.openManagement': ['開啟點歌管理…', 'Open request management…', 'リクエスト管理を開く…', '신청곡 관리 열기…', '打开点歌管理…'],
    'twitch.loadingConnection': ['Twitch 讀取中', 'Loading Twitch', 'Twitch を読み込み中', 'Twitch 불러오는 중', 'Twitch 读取中'],
    'twitch.loadingRequests': ['點歌讀取中', 'Loading requests', 'リクエストを読み込み中', '신청곡 불러오는 중', '点歌读取中'],
    'twitch.loadingRewards': ['忠誠點數讀取中', 'Loading Channel Points', 'チャンネルポイントを読み込み中', '채널 포인트 불러오는 중', '频道积分读取中'],
    'twitch.loadingReplies': ['回覆讀取中', 'Loading replies', '返信を読み込み中', '답변 불러오는 중', '回复读取中'],
    'twitch.pendingTitle': ['待確認點歌', 'Requests awaiting review', '確認待ちリクエスト', '확인 대기 신청곡', '待确认点歌'],
    'twitch.pendingHint': ['觀眾的點歌會先排在這裡；確認後才開始下載。', 'Viewer requests wait here and download only after approval.', '視聴者のリクエストはここで待機し、確認後にダウンロードを開始します。', '시청자 신청곡은 여기서 대기하며 승인 후 다운로드됩니다.', '观众点歌会先排在这里；确认后才开始下载。'],
    'twitch.noPending': ['目前沒有待確認的點歌', 'No requests awaiting review', '確認待ちのリクエストはありません', '확인 대기 중인 신청곡이 없습니다', '目前没有待确认的点歌'],
    'twitch.rejectAll': ['拒絕全部', 'Reject all', 'すべて拒否', '모두 거절', '全部拒绝'],
    'twitch.activityTitle': ['最近活動', 'Recent activity', '最近のアクティビティ', '최근 활동', '最近活动'],
    'twitch.activityHint': ['只保留點歌結果與退款／完成狀態，不保存 token 或完整聊天室內容。', 'Only request outcomes and refund/completion status are kept; tokens and full chat are not stored.', 'リクエスト結果と返金・完了状態のみを保存し、トークンやチャット全文は保存しません。', '신청 결과와 환불/완료 상태만 보관하며 토큰이나 전체 채팅은 저장하지 않습니다.', '只保留点歌结果与退款／完成状态，不保存令牌或完整聊天室内容。'],
    'twitch.viewHistory': ['查看完整歷史', 'View full history', '履歴をすべて表示', '전체 기록 보기', '查看完整历史'],
    'twitch.noHistory': ['目前還沒有點歌歷史；之後會在這裡看到成功、拒絕、退款與逾時結果。', 'No request history yet. Accepted, rejected, refunded, and timed-out results will appear here.', 'リクエスト履歴はまだありません。成功、拒否、返金、タイムアウトの結果がここに表示されます。', '아직 신청곡 기록이 없습니다. 성공, 거절, 환불, 시간 초과 결과가 여기에 표시됩니다.', '目前还没有点歌历史；之后会在这里看到成功、拒绝、退款与超时结果。'],
    'twitch.managementTitle': ['Twitch 點歌管理', 'Twitch request management', 'Twitch リクエスト管理', 'Twitch 신청곡 관리', 'Twitch 点歌管理'],
    'twitch.allSaved': ['所有設定都已儲存', 'All settings saved', 'すべての設定を保存しました', '모든 설정이 저장됨', '所有设置均已保存'],
    'twitch.findSettings': ['找設定', 'Find settings', '設定を検索', '설정 찾기', '查找设置'],
    'twitch.searchPlaceholder': ['找設定，例如：冷卻、退款、黑名單、目前歌曲', 'Find settings, e.g. cooldown, refund, blacklist, current song', '設定を検索（例：クールダウン、返金、ブラックリスト、現在の曲）', '설정 찾기: 쿨다운, 환불, 차단 목록, 현재 곡', '查找设置，例如：冷却、退款、黑名单、当前歌曲'],
    'twitch.searchHint': ['輸入設定名稱後可直接跳到對應分類。', 'Enter a setting name to jump to its category.', '設定名を入力すると該当カテゴリへ移動できます。', '설정 이름을 입력하면 해당 분류로 이동합니다.', '输入设置名称后可直接跳到对应分类。'],
    'twitch.navLabel': ['Twitch 點歌管理分類', 'Twitch request management categories', 'Twitch リクエスト管理カテゴリ', 'Twitch 신청곡 관리 분류', 'Twitch 点歌管理分类'],
    'twitch.navCommands': ['指令', 'Commands', 'コマンド', '명령어', '指令'],
    'twitch.navRules': ['接受規則', 'Acceptance rules', '受付ルール', '접수 규칙', '接受规则'],
    'twitch.navBlacklist': ['黑名單', 'Blacklist', 'ブラックリスト', '차단 목록', '黑名单'],
    'twitch.navRewards': ['忠誠點數', 'Channel Points', 'チャンネルポイント', '채널 포인트', '频道积分'],
    'twitch.navReplies': ['聊天室回覆', 'Chat replies', 'チャット返信', '채팅 답변', '聊天室回复'],
    'twitch.navCustom': ['自訂指令', 'Custom commands', 'カスタムコマンド', '사용자 지정 명령어', '自定义指令'],
    'twitch.navTest': ['測試與預覽', 'Test & preview', 'テストとプレビュー', '테스트 및 미리보기', '测试与预览'],
    'twitch.navHistory': ['歷史', 'History', '履歴', '기록', '历史'],
    'twitch.unsaved': ['未儲存', 'Unsaved', '未保存', '저장 안 됨', '未保存'],
    'twitch.connectedAs': ['已連接 {name}', 'Connected as {name}', '{name} に接続済み', '{name}(으)로 연결됨', '已连接 {name}'],
    'twitch.connecting': ['Twitch 連線中', 'Connecting to Twitch', 'Twitch に接続中', 'Twitch 연결 중', 'Twitch 连接中'],
    'twitch.notConnected': ['Twitch 未連接', 'Twitch not connected', 'Twitch 未接続', 'Twitch 연결 안 됨', 'Twitch 未连接'],
    'twitch.requestsOpen': ['點歌已開放', 'Requests open', 'リクエスト受付中', '신청곡 열림', '点歌已开放'],
    'twitch.requestsPaused': ['點歌已暫停', 'Requests paused', 'リクエスト一時停止中', '신청곡 일시 중지됨', '点歌已暂停'],
    'twitch.rewardsPaused': ['忠誠點數已暫停', 'Channel Points paused', 'チャンネルポイント一時停止中', '채널 포인트 일시 중지됨', '频道积分已暂停'],
    'twitch.rewardsEnabled': ['忠誠點數已啟用', 'Channel Points enabled', 'チャンネルポイント有効', '채널 포인트 활성화됨', '频道积分已启用'],
    'twitch.rewardsDisabled': ['忠誠點數已停用', 'Channel Points disabled', 'チャンネルポイント無効', '채널 포인트 비활성화됨', '频道积分已停用'],
    'twitch.repliesEnabled': ['自動回覆已啟用', 'Auto replies enabled', '自動返信有効', '자동 답변 활성화됨', '自动回复已启用'],
    'twitch.repliesDisabled': ['自動回覆已停用', 'Auto replies disabled', '自動返信無効', '자동 답변 비활성화됨', '自动回复已停用'],
    'twitch.unsavedCount': ['{count} 個分類有尚未儲存的變更', '{count} categories have unsaved changes', '{count} カテゴリに未保存の変更があります', '{count}개 분류에 저장하지 않은 변경사항이 있습니다', '{count} 个分类有未保存的更改'],
    'twitch.preview': ['預覽：{message}', 'Preview: {message}', 'プレビュー：{message}', '미리보기: {message}', '预览：{message}'],
    'twitch.localPreview': ['本機預覽：{message}', 'Local preview: {message}', 'ローカルプレビュー：{message}', '로컬 미리보기: {message}', '本地预览：{message}'],
    'twitch.rule.accepting': ['接受點歌', 'Accepting requests', 'リクエスト受付中', '신청곡 접수 중', '接受点歌'],
    'twitch.rule.maxPending': ['最多 {count} 首待確認', 'Up to {count} awaiting review', '確認待ちは最大 {count} 曲', '검토 대기 최대 {count}곡', '最多 {count} 首待确认'],
    'twitch.rule.perUserMax': ['每人最多 {count} 首', 'Up to {count} per viewer', '1 人最大 {count} 曲', '시청자당 최대 {count}곡', '每人最多 {count} 首'],
    'twitch.rule.perUserUnlimited': ['每人不限首數', 'No per-viewer limit', '1 人あたり無制限', '시청자당 제한 없음', '每人不限首数'],
    'twitch.rule.maxDuration': ['最長 {count} 分鐘', 'Up to {count} minutes', '最長 {count} 分', '최대 {count}분', '最长 {count} 分钟'],
    'twitch.rule.noDuration': ['不限制歌曲長度', 'No track-length limit', '曲の長さは無制限', '곡 길이 제한 없음', '不限制歌曲长度'],
    'twitch.rule.recentHours': ['檢查最近 {count} 小時', 'Check the last {count} hours', '直近 {count} 時間を確認', '최근 {count}시간 확인', '检查最近 {count} 小时'],
    'twitch.rule.duplicateScope': ['重複範圍：{scope}', 'Duplicate scope: {scope}', '重複チェック範囲：{scope}', '중복 확인 범위: {scope}', '重复范围：{scope}'],
    'twitch.rule.liveOnly': ['只在直播中接受', 'Live only', '配信中のみ受付', '방송 중에만 접수', '只在直播中接受'],
    'twitch.rule.offlineAccepted': ['離線也接受', 'Accept while offline', 'オフライン時も受付', '오프라인에서도 접수', '离线也接受'],
    'twitch.rule.perSession': ['每人每場 {count} 首', '{count} per viewer per stream', '1 配信につき 1 人 {count} 曲', '방송당 시청자별 {count}곡', '每人每场 {count} 首'],
    'twitch.rule.perSessionUnlimited': ['每人每場不限', 'No per-viewer stream limit', '1 配信あたりの個人上限なし', '시청자 1인당 방송별 제한 없음', '每人每场不限'],
    'twitch.rule.streamTotal': ['全場 {count} 首', '{count} total per stream', '配信全体で {count} 曲', '방송 전체 {count}곡', '全场 {count} 首'],
    'twitch.rule.streamUnlimited': ['全場不限', 'No stream-wide limit', '配信全体の上限なし', '방송 전체 제한 없음', '全场不限'],
    'twitch.rule.warnConsecutive': ['連續點歌會提醒', 'Warn on consecutive requests', '連続リクエストを通知', '연속 신청곡 경고', '连续点歌会提醒'],
    'twitch.rule.noConsecutiveWarning': ['不提醒連續點歌', 'No consecutive-request warning', '連続リクエストを通知しない', '연속 신청곡 경고 안 함', '不提醒连续点歌'],
    // Dynamic Twitch surfaces use curated keys.  User, command, title, URL, and
    // server-error values stay presentation variables and are never translated.
    'twitch.points': ['{count} 點', '{count} points', '{count} ポイント', '{count}포인트', '{count} 点'],
    'twitch.runtime.clientIdMissing': ['尚未設定 Twitch Client ID。', 'Twitch Client ID is not configured.', 'Twitch Client ID が設定されていません。', 'Twitch Client ID가 설정되지 않았습니다.', '尚未设置 Twitch Client ID。'],
    'twitch.runtime.authorizationRequired': ['尚未連接 Twitch；啟用獎勵前需要先授權。', 'Twitch is not connected. Authorize it before enabling rewards.', 'Twitch に接続されていません。特典を有効にする前に認証してください。', 'Twitch가 연결되지 않았습니다. 보상을 활성화하기 전에 인증하세요.', '尚未连接 Twitch；启用奖励前需要先授权。'],
    'twitch.runtime.authorizationRefreshUnavailable': ['Twitch 授權暫時無法更新', 'Twitch authorization cannot be refreshed right now.', 'Twitch の認証情報を現在更新できません。', '현재 Twitch 인증을 갱신할 수 없습니다.', '暂时无法更新 Twitch 授权。'],
    'twitch.runtime.rewardScopeMissing': ['目前授權缺少忠誠點數管理權限，請重新連接 Twitch 一次。', 'The current authorization lacks Channel Points management permission. Reconnect Twitch once.', '現在の認証にはチャンネルポイント管理権限がありません。Twitch に再接続してください。', '현재 인증에 채널 포인트 관리 권한이 없습니다. Twitch에 다시 연결해 주세요.', '当前授权缺少频道积分管理权限，请重新连接 Twitch。'],
    'twitch.runtime.rewardSyncFailed': ['同步失敗；下方保留 Twitch 上次已確認的狀態。', 'Sync failed. The last confirmed Twitch state is kept below.', '同期に失敗しました。下には Twitch で最後に確認された状態を表示しています。', '동기화에 실패했습니다. 아래에는 Twitch에서 마지막으로 확인된 상태가 유지됩니다.', '同步失败；下方保留 Twitch 上次已确认的状态。'],
    'twitch.runtime.rewardPaused': ['專用獎勵目前暫停兌換。', 'The dedicated reward is currently paused.', '専用特典は現在一時停止中です。', '전용 보상은 현재 일시 중지되어 있습니다.', '专用奖励目前已暂停兑换。'],
    'twitch.runtime.rewardListening': ['專用獎勵已啟用並監聽兌換。', 'The dedicated reward is enabled and redemption events are being monitored.', '専用特典は有効で、引き換えイベントを監視しています。', '전용 보상이 활성화되어 교환 이벤트를 감시하고 있습니다.', '专用奖励已启用，正在监听兑换事件。'],
    'twitch.runtime.rewardSubscribing': ['獎勵已建立；EventSub 正在等待忠誠點數兌換訂閱。', 'Rewards created; EventSub is waiting to subscribe to Channel Points redemption events.', '報酬を作成しました。EventSub のチャンネルポイント報酬引き換えイベントの購読を待機しています。', '보상이 생성되었습니다. EventSub가 채널 포인트 보상 교환 이벤트 구독을 기다리는 중입니다.', '奖励已创建；EventSub 正在等待订阅频道积分兑换事件。'],
    'twitch.runtime.rewardDisabled': ['專用獎勵已停用；再次開啟並儲存即可恢復。', 'The dedicated reward is disabled. Turn it back on and save to restore it.', '専用特典は無効です。再び有効にして保存すると復元できます。', '전용 보상이 비활성화되어 있습니다. 다시 켠 뒤 저장하면 복원됩니다.', '专用奖励已停用；重新开启并保存即可恢复。'],
    'twitch.runtime.rewardNotCreated': ['尚未建立專用獎勵；開啟後按「儲存並同步 Twitch」。', 'No dedicated reward has been created. Enable it, then choose “Save and sync Twitch.”', '専用特典はまだ作成されていません。有効にしてから「保存して Twitch と同期」を選択してください。', '아직 전용 보상이 생성되지 않았습니다. 활성화한 뒤 “Twitch 저장 및 동기화”를 누르세요.', '尚未创建专用奖励；开启后点击“保存并同步 Twitch”。'],
    'twitch.reward.paused': ['已暫停', 'Paused', '一時停止中', '일시 중지됨', '已暂停'],
    'twitch.reward.enabled': ['已啟用', 'Enabled', '有効', '활성화됨', '已启用'],
    'twitch.reward.disabled': ['已停用', 'Disabled', '無効', '비활성화됨', '已停用'],
    'twitch.reward.perStream': ['每場 {count} 次', '{count} per stream', '配信ごとに {count} 回', '방송별 {count}회', '每场 {count} 次'],
    'twitch.reward.perStreamUnlimited': ['每場不限', 'No per-stream limit', '配信ごとの上限なし', '방송별 제한 없음', '每场不限'],
    'twitch.reward.perUserPerStream': ['每人每場 {count} 次', '{count} per viewer per stream', '1 人あたり 1 配信 {count} 回', '시청자 1인당 방송별 {count}회', '每人每场 {count} 次'],
    'twitch.reward.perUserPerStreamUnlimited': ['每人不限', 'No per-viewer limit', '視聴者ごとの上限なし', '시청자별 제한 없음', '每人不限'],
    'twitch.reward.cooldown': ['冷卻 {count} 秒', '{count}s cooldown', '{count} 秒のクールダウン', '{count}초 쿨다운', '冷却 {count} 秒'],
    'twitch.reward.noCooldown': ['無冷卻', 'No cooldown', 'クールダウンなし', '쿨다운 없음', '无冷却'],
    'twitch.reward.redeemedThisStream': ['同步時本場已兌換 {count} 次', '{count} redeemed this stream when synced', '同期時、この配信では {count} 回引き換え済み', '동기화 시 이번 방송에서 {count}회 교환됨', '同步时本场已兑换 {count} 次'],
    'twitch.reward.outOfStock': ['目前不可兌換', 'Currently unavailable', '現在は引き換えできません', '현재 교환할 수 없습니다', '目前不可兑换'],
    'twitch.reward.none': ['尚無 Twitch 已確認的專用獎勵。', 'No dedicated Twitch reward has been confirmed yet.', 'Twitch で確認済みの専用特典はまだありません。', 'Twitch에서 확인된 전용 보상이 아직 없습니다.', '尚无 Twitch 已确认的专用奖励。'],
    'twitch.runtime.notEnabled': ['Twitch 尚未啟用，請聯絡 Elitesand Pro 開發者。', 'Twitch is not enabled. Contact the Elitesand Pro developer.', 'Twitch は有効になっていません。Elitesand Pro の開発者に連絡してください。', 'Twitch가 활성화되어 있지 않습니다. Elitesand Pro 개발자에게 문의하세요.', 'Twitch 尚未启用，请联系 Elitesand Pro 开发者。'],
    'twitch.runtime.deauthorize': ['解除 Twitch 授權', 'Deauthorize Twitch', 'Twitch の認証を解除', 'Twitch 인증 해제', '解除 Twitch 授权'],
    'twitch.runtime.cancelConnect': ['取消 Twitch 連接流程', 'Cancel Twitch connection', 'Twitch 接続をキャンセル', 'Twitch 연결 취소', '取消 Twitch 连接流程'],
    'twitch.runtime.enterCode': ['請到 Twitch 輸入代碼：{code}', 'Enter this code on Twitch: {code}', 'Twitch でこのコードを入力してください：{code}', 'Twitch에서 이 코드를 입력하세요: {code}', '请到 Twitch 输入代码：{code}'],
    'twitch.runtime.notConnectedHint': ['尚未連接 Twitch。按「連接 Twitch」後登入並授權聊天室讀寫。', 'Twitch is not connected. Choose “Connect Twitch,” then sign in and authorize chat access.', 'Twitch に接続されていません。「Twitch に接続」を選んでログインし、チャットの読み書きを許可してください。', 'Twitch가 연결되지 않았습니다. “Twitch 연결”을 누른 뒤 로그인하고 채팅 읽기/쓰기 권한을 허용하세요.', '尚未连接 Twitch。点击“连接 Twitch”后登录并授权聊天室读写。'],
    'twitch.runtime.subscriptionFailed': ['Twitch 已連線，但事件訂閱失敗：{reason}', 'Twitch is connected, but event subscription failed: {reason}', 'Twitch には接続されていますが、イベント購読に失敗しました：{reason}', 'Twitch가 연결되었지만 이벤트 구독에 실패했습니다: {reason}', 'Twitch 已连接，但事件订阅失败：{reason}'],
    'twitch.runtime.connectedSubscribing': ['已連接 {name}，正在訂閱開台、下播與聊天室事件…', 'Connected as {name}; subscribing to stream and chat events…', '{name} に接続済みです。配信開始・終了とチャットのイベントを購読中…', '{name}에 연결되었습니다. 방송 시작/종료 및 채팅 이벤트를 구독하는 중…', '已连接 {name}，正在订阅开播、下播和聊天室事件…'],
    'twitch.runtime.pendingCount': ['；{count} 筆點歌待確認', '; {count} requests awaiting review', '；確認待ちのリクエスト {count} 件', '; 확인 대기 신청곡 {count}건', '；{count} 笔点歌待确认'],
    'twitch.runtime.connectedListening': ['已連接 {name}：正在監聽 {command}{pending}。', 'Connected as {name}: listening for {command}{pending}.', '{name} に接続済み：{command}{pending} を監視しています。', '{name}에 연결됨: {command}{pending}을(를) 감시 중입니다.', '已连接 {name}：正在监听 {command}{pending}。'],
    'twitch.runtime.retryIn': ['{seconds} 秒後', 'in {seconds}s', '{seconds} 秒後', '{seconds}초 후', '{seconds} 秒后'],
    'twitch.runtime.retrySoon': ['稍後', 'soon', 'まもなく', '잠시 후', '稍后'],
    'twitch.runtime.errorDetail': ['：{message}', ': {message}', '：{message}', ': {message}', '：{message}'],
    'twitch.runtime.reconnecting': ['Twitch 連線中斷，{delay}自動重連（第 {attempt} 次）{error}', 'Twitch connection lost; reconnecting automatically {delay} (attempt {attempt}){error}', 'Twitch の接続が切れました。{delay}自動再接続します（{attempt} 回目）{error}', 'Twitch 연결이 끊겼습니다. {delay} 자동 재연결합니다({attempt}회째){error}', 'Twitch 连接中断，{delay}自动重连（第 {attempt} 次）{error}'],
    'twitch.runtime.authorizedConnecting': ['已授權 {name}，正在連接 EventSub…', '{name} is authorized; connecting EventSub…', '{name} を認証しました。EventSub に接続中…', '{name} 인증됨. EventSub에 연결하는 중…', '已授权 {name}，正在连接 EventSub…'],
    'twitch.runtime.readFailed': ['Twitch 狀態讀取失敗：{message}', 'Could not read Twitch status: {message}', 'Twitch の状態を読み取れません：{message}', 'Twitch 상태를 읽을 수 없습니다: {message}', '读取 Twitch 状态失败：{message}'],
    'twitch.runtime.statusReadFailed': ['Twitch 狀態讀取失敗', 'Could not read Twitch status', 'Twitch の状態を読み取れません', 'Twitch 상태를 읽을 수 없습니다', '读取 Twitch 状态失败'],
    'twitch.settings.jump': ['已前往「{category}」的「{label}」。', 'Jumped to “{label}” in “{category}.”', '「{category}」の「{label}」へ移動しました。', '“{category}”의 “{label}”로 이동했습니다.', '已跳转到“{category}”中的“{label}”。'],
    'twitch.settings.matchCount': ['找到 {count} 個設定。', 'Found {count} settings.', '{count} 件の設定が見つかりました。', '설정 {count}개를 찾았습니다.', '找到 {count} 个设置。'],
    'twitch.settings.ruleCount': ['{count} 筆', '{count} rules', '{count} 件', '{count}개', '{count} 条'],
    'twitch.history.pending': ['等待確認', 'Awaiting review', '確認待ち', '확인 대기', '等待确认'],
    'twitch.history.retrying': ['等待重試', 'Waiting to retry', '再試行待ち', '재시도 대기', '等待重试'],
    'twitch.history.imported': ['已匯入', 'Imported', 'インポート済み', '가져옴', '已导入'],
    'twitch.history.rejected': ['已拒絕', 'Rejected', '拒否済み', '거절됨', '已拒绝'],
    'twitch.history.failed': ['失敗', 'Failed', '失敗', '실패', '失败'],
    'twitch.history.canceled': ['已取消', 'Canceled', 'キャンセル済み', '취소됨', '已取消'],
    'twitch.history.expired': ['等待逾時', 'Review timed out', '確認待ちがタイムアウト', '확인 대기 시간 초과', '等待确认超时'],
    'twitch.history.unknownResult': ['未知結果', 'Unknown result', '不明な結果', '알 수 없는 결과', '未知结果'],
    'twitch.history.rewardPending': ['忠誠點數待處理', 'Channel Points pending', 'チャンネルポイント処理待ち', '채널 포인트 처리 대기', '频道积分待处理'],
    'twitch.history.rewardFulfilled': ['忠誠點數已完成', 'Channel Points completed', 'チャンネルポイントの引き換えが完了しました', '채널 포인트 사용 완료', '频道积分已完成'],
    'twitch.history.rewardRefunded': ['忠誠點數已退款', 'Channel Points refunded', 'チャンネルポイントを返金しました', '채널 포인트 환불 완료', '频道积分已退款'],
    'twitch.history.rewardRefundFailed': ['忠誠點數退款待重試', 'Channel Points refund pending retry', 'チャンネルポイント返金の再試行待ち', '채널 포인트 환불 재시도 대기', '频道积分退款待重试'],
    'twitch.history.rewardFulfillmentFailed': ['忠誠點數完成待重試', 'Channel Points fulfillment pending retry', 'チャンネルポイント完了処理の再試行待ち', '채널 포인트 완료 처리 재시도 대기', '频道积分完成待重试'],
    'twitch.history.sourceChannelPoints': ['忠誠點數', 'Channel Points', 'チャンネルポイント', '채널 포인트', '频道积分'],
    'twitch.history.sourceChat': ['聊天室', 'Chat', 'チャット', '채팅', '聊天室'],
    'twitch.history.unknownTime': ['時間不明', 'Time unknown', '時刻不明', '시간 알 수 없음', '时间不明'],
    'twitch.history.unknownRequester': ['觀眾', 'Viewer', '視聴者', '시청자', '观众'],
    'twitch.history.unknownTrack': ['未取得歌曲資訊', 'Track details unavailable', '曲の情報を取得できません', '곡 정보를 가져올 수 없습니다', '未获取歌曲信息'],
    'twitch.history.reason': ['原因：{reason}', 'Reason: {reason}', '理由：{reason}', '사유: {reason}', '原因：{reason}'],
    'twitch.request.requester': ['點歌者：{name}{code}', 'Requester: {name}{code}', 'リクエスト者：{name}{code}', '신청자: {name}{code}', '点歌者：{name}{code}'],
    'twitch.request.code': [' · 編號 #{id}', ' · ID #{id}', ' · 番号 #{id}', ' · 번호 #{id}', ' · 编号 #{id}'],
    'twitch.request.unknownTitle': ['無法取得影片標題', 'Video title unavailable', '動画タイトルを取得できません', '동영상 제목을 가져올 수 없습니다', '无法获取视频标题'],
    'twitch.request.unknownChannel': ['未知頻道', 'Unknown channel', '不明なチャンネル', '알 수 없는 채널', '未知频道'],
    'twitch.request.missingThumbnail': ['無縮圖', 'No thumbnail', 'サムネイルなし', '썸네일 없음', '无缩略图'],
    'twitch.request.redemption': ['忠誠點數兌換 · {cost}', 'Channel Points redemption · {cost}', 'チャンネルポイントの引き換え · {cost}', '채널 포인트 보상 교환 · {cost}', '频道积分兑换 · {cost}'],
    'twitch.request.durationWarning': ['影片超過 15 分鐘，請確認後再下載', 'The video is longer than 15 minutes. Confirm before downloading.', '動画が 15 分を超えています。確認してからダウンロードしてください。', '동영상이 15분을 넘습니다. 확인한 뒤 다운로드하세요.', '视频超过 15 分钟，请确认后再下载'],
    'twitch.request.downloadingNext': ['插播下載中…', 'Downloading for next…', '次の曲としてダウンロード中…', '다음 곡으로 삽입하며 다운로드 중…', '正在插播下载…'],
    'twitch.request.downloading': ['下載中…', 'Downloading…', 'ダウンロード中…', '다운로드 중…', '下载中…'],
    'twitch.request.addNext': ['插到下一首', 'Add next', '次の曲に追加', '다음 곡에 넣기', '插到下一首'],
    'twitch.request.addEnd': ['加入尾端', 'Add to end', '最後に追加', '맨 뒤에 추가', '加入队尾'],
    'twitch.request.rejectAndRefund': ['拒絕並退款', 'Reject and refund', '拒否して返金', '거절 및 환불', '拒绝并退款'],
    'twitch.request.reject': ['拒絕', 'Reject', '拒否', '거절', '拒绝'],
    'twitch.request.addedNext': ['已插到下一首：{title}', 'Added next: {title}', '次の曲に追加しました：{title}', '다음 곡에 넣었습니다: {title}', '已插到下一首：{title}'],
    'twitch.request.addedEnd': ['已加入清單尾端：{title}', 'Added to the end of the playlist: {title}', 'プレイリストの最後に追加しました：{title}', '재생목록 맨 뒤에 추가했습니다: {title}', '已加入队尾：{title}'],
    'twitch.request.fallbackTrack': ['歌曲', 'Track', '曲', '곡', '歌曲'],
    'twitch.request.rejectFailed': ['拒絕失敗：{message}', 'Could not reject request: {message}', 'リクエストを拒否できません：{message}', '신청곡을 거절하지 못했습니다: {message}', '拒绝点歌失败：{message}'],
    'twitch.request.toggleFailed': ['切換點歌狀態失敗：{message}', 'Could not change request status: {message}', 'リクエスト状態を変更できません：{message}', '신청곡 상태를 바꾸지 못했습니다: {message}', '切换点歌状态失败：{message}'],
    'twitch.request.newRequest': ['{name} 點了一首歌，請到「點歌」頁確認', '{name} requested a song. Review it on the Requests page.', '{name} さんが曲をリクエストしました。「リクエスト」ページで確認してください。', '{name}님이 곡을 신청했습니다. “신청곡” 페이지에서 확인하세요.', '{name} 点了一首歌，请到“点歌”页确认'],
    'twitch.error.noResponse': ['伺服器沒有回應', 'The server did not respond', 'サーバーから応答がありません', '서버가 응답하지 않습니다', '服务器没有响应'],
    'twitch.error.testNotSent': ['測試未送出：{message}', 'Test not sent: {message}', 'テストを送信できませんでした：{message}', '테스트를 보내지 못했습니다: {message}', '测试未发送：{message}'],
    'twitch.error.testSent': ['已送出：{message}', 'Sent: {message}', '送信しました：{message}', '보냈습니다: {message}', '已发送：{message}'],
    'twitch.error.saveFailed': ['儲存失敗：{message}', 'Could not save: {message}', '保存に失敗しました：{message}', '저장에 실패했습니다: {message}', '保存失败：{message}'],
    'twitch.error.connectionCheckSoon': ['稍後會重新確認連線', 'The connection will be checked again shortly.', 'まもなく接続を再確認します。', '잠시 후 연결을 다시 확인합니다.', '稍后会重新确认连接。'],
    'twitch.publicTest.customSummary': ['將把「{command}」的範例回覆公開送到目前連接的 Twitch 聊天室。', 'A sample reply for “{command}” will be sent publicly to the connected Twitch chat.', '「{command}」のサンプル返信を、接続中の Twitch チャットへ公開送信します。', '“{command}”의 예시 답변을 현재 연결된 Twitch 채팅에 공개로 보냅니다.', '将把“{command}”的示例回复公开发送到当前连接的 Twitch 聊天室。'],
    'twitch.publicTest.replySummary': ['將把「{label}」的範例回覆公開送到目前連接的 Twitch 聊天室。', 'A sample “{label}” reply will be sent publicly to the connected Twitch chat.', '「{label}」のサンプル返信を、接続中の Twitch チャットへ公開送信します。', '“{label}”의 예시 답변을 현재 연결된 Twitch 채팅에 공개로 보냅니다.', '将把“{label}”的示例回复公开发送到当前连接的 Twitch 聊天室。'],
    'twitch.request.rejectAllTitle': ['拒絕全部 {count} 筆點歌？', 'Reject all {count} requests?', '確認待ちのリクエスト {count} 件をすべて拒否しますか？', '확인 대기 신청곡 {count}건을 모두 거절할까요?', '拒绝全部 {count} 笔点歌？'],
    'twitch.request.rejectAllSummary': ['這些待確認點歌會全部標記為略過。', 'All requests awaiting review will be marked as skipped.', '確認待ちのリクエストはすべてスキップ済みにします。', '확인 대기 신청곡을 모두 건너뜀으로 표시합니다.', '这些待确认点歌都会标记为已跳过。'],
    'twitch.request.rejectAllImpact': ['已加入播放清單的歌曲與其他設定不受影響。', 'Tracks already added to the playlist and other settings are unchanged.', 'すでにプレイリストへ追加した曲と他の設定には影響しません。', '이미 재생목록에 추가한 곡과 다른 설정에는 영향을 주지 않습니다.', '已加入播放列表的歌曲和其他设置不受影响。'],
    'twitch.simulation.failed': ['無法模擬：{message}', 'Could not simulate: {message}', 'シミュレーションできません：{message}', '시뮬레이션할 수 없습니다: {message}', '无法模拟：{message}'],
    'twitch.simulation.accepted': ['模擬結果：會接受這筆點歌', 'Simulation result: this request would be accepted', 'シミュレーション結果：このリクエストは受け付けられます', '시뮬레이션 결과: 이 신청곡은 수락됩니다', '模拟结果：会接受这条点歌'],
    'twitch.simulation.rejected': ['模擬結果：會拒絕這筆點歌', 'Simulation result: this request would be rejected', 'シミュレーション結果：このリクエストは拒否されます', '시뮬레이션 결과: 이 신청곡은 거절됩니다', '模拟结果：会拒绝这条点歌'],
    'twitch.simulation.rule': ['規則', 'Rule', 'ルール', '규칙', '规则'],
    'twitch.simulation.reply': ['預計回覆：{message}', 'Planned reply: {message}', '予定する返信：{message}', '예정된 답변: {message}', '预计回复：{message}'],
    'twitch.simulation.noReply': ['預計回覆：不會送出（自動回覆目前關閉）', 'Planned reply: none (auto replies are off)', '予定する返信：送信しません（自動返信はオフです）', '예정된 답변: 보내지 않음(자동 답변이 꺼져 있음)', '预计回复：不会发送（自动回复当前已关闭）'],
    'twitch.auth.opened': ['已開啟 Twitch 登入與授權頁，請依 Twitch 指示完成授權。', 'Opened the Twitch sign-in and authorization page. Follow Twitch’s instructions to finish.', 'Twitch のログイン・認証ページを開きました。Twitch の案内に従って完了してください。', 'Twitch 로그인 및 인증 페이지를 열었습니다. Twitch 안내에 따라 완료하세요.', '已打开 Twitch 登录和授权页面，请按 Twitch 指示完成授权。'],
    'twitch.auth.openedCode': ['已開啟 Twitch 授權頁（若未自動開啟，請按「前往 Twitch 輸入代碼」）。代碼：{code}', 'Opened the Twitch authorization page. If it did not open automatically, choose “Go to Twitch to enter the code.” Code: {code}', 'Twitch の認証ページを開きました。自動で開かない場合は「Twitch でコードを入力」を選択してください。コード：{code}', 'Twitch 인증 페이지를 열었습니다. 자동으로 열리지 않으면 “Twitch에서 코드 입력”을 누르세요. 코드: {code}', '已打开 Twitch 授权页面；若未自动打开，请点击“前往 Twitch 输入代码”。代码：{code}'],
    'twitch.auth.startFailed': ['無法開始 Twitch 授權：{message}', 'Could not start Twitch authorization: {message}', 'Twitch の認証を開始できません：{message}', 'Twitch 인증을 시작할 수 없습니다: {message}', '无法开始 Twitch 授权：{message}'],
    'twitch.auth.remoteDeauthorizeFailed': ['本機 Twitch 授權已移除，但暫時無法通知 Twitch：{message}', 'Local Twitch authorization was removed, but Twitch could not be notified yet: {message}', 'ローカルの Twitch 認証は削除しましたが、Twitch への通知に失敗しました：{message}', '로컬 Twitch 인증은 제거했지만 Twitch에 알리지 못했습니다: {message}', '本机 Twitch 授权已移除，但暂时无法通知 Twitch：{message}'],
    'twitch.auth.deauthorized': ['Twitch 授權已解除。', 'Twitch authorization has been removed.', 'Twitch の認証を解除しました。', 'Twitch 인증을 해제했습니다.', 'Twitch 授权已解除。'],
    'twitch.auth.deauthorizeFailed': ['解除 Twitch 授權失敗：{message}', 'Could not deauthorize Twitch: {message}', 'Twitch の認証を解除できません：{message}', 'Twitch 인증을 해제하지 못했습니다: {message}', '解除 Twitch 授权失败：{message}'],
    'import.uploadFailed': ['上傳失敗：{message}', 'Upload failed: {message}', 'アップロードに失敗しました：{message}', '업로드 실패: {message}', '上传失败：{message}'],
    'import.fileRejected': ['伺服器未接受檔案', 'The server did not accept the file', 'サーバーがファイルを受け付けませんでした', '서버가 파일을 받지 않았습니다', '服务器未接受该文件'],
    'errorHistory.empty': ['目前沒有錯誤記錄', 'No error records yet', 'エラー記録はありません', '오류 기록이 없습니다', '当前没有错误记录'],
    // Import jobs keep transport/state data untouched and localize only their UI framing.
    'import.uploading': ['上傳處理中…', 'Uploading…', 'アップロード中…', '업로드 중…', '正在上传…'],
    'import.playlist.loading': ['讀取播放清單中', 'Loading playlist', 'プレイリストを読み込み中', '재생목록을 불러오는 중', '正在读取播放列表'],
    'import.playlist.processing': ['處理中…', 'Processing…', '処理中…', '처리 중…', '正在处理…'],
    'import.playlist.loadFailed': ['播放清單讀取失敗', 'Could not load the playlist', 'プレイリストを読み込めません', '재생목록을 불러오지 못했습니다', '读取播放列表失败'],
    'import.playlist.confirmTitle': ['匯入這份 {count} 首的播放清單？', 'Import this {count}-track playlist?', 'この {count} 曲のプレイリストをインポートしますか？', '이 {count}곡 재생목록을 가져올까요?', '导入这份 {count} 首的播放列表？'],
    'import.playlist.confirmSummary': ['歌曲會逐首檢查、依序加入，完成前即可開始播放。', 'Tracks are checked and added one at a time; you can start playback before the import finishes.', '曲は 1 曲ずつ確認して順に追加します。完了前でも再生を始められます。', '곡을 하나씩 확인해 순서대로 추가합니다. 가져오기가 끝나기 전에도 재생을 시작할 수 있습니다.', '歌曲会逐首检查、依次加入，完成前即可开始播放。'],
    'import.playlist.confirmImpact': ['可隨時在工作中心取消尚未開始的匯入；已完成的歌曲會保留在播放清單。', 'You can cancel imports that have not started from Work Center at any time. Completed tracks stay in the playlist.', 'まだ開始していないインポートは作業センターからいつでもキャンセルできます。完了した曲はプレイリストに残ります。', '아직 시작하지 않은 가져오기는 작업 센터에서 언제든 취소할 수 있습니다. 완료된 곡은 재생목록에 남습니다.', '可随时在工作中心取消尚未开始的导入；已完成的歌曲会保留在播放列表。'],
    'import.playlist.confirmStart': ['開始匯入', 'Start import', 'インポートを開始', '가져오기 시작', '开始导入'],
    'import.playlist.cancelled': ['已取消播放清單匯入', 'Playlist import canceled', 'プレイリストのインポートをキャンセルしました', '재생목록 가져오기를 취소했습니다', '已取消播放列表导入'],
    'import.playlist.source': ['播放清單 {index}/{total}', 'Playlist {index}/{total}', 'プレイリスト {index}/{total}', '재생목록 {index}/{total}', '播放列表 {index}/{total}'],
    'import.playlist.itemFallbackLabel': ['播放清單第 {index} 首', 'Playlist track {index}', 'プレイリストの {index} 曲目', '재생목록 {index}번 곡', '播放列表第 {index} 首'],
    'import.playlist.queued': ['已排入 {count} 首，將逐首檢查後匯入', '{count} tracks queued; each will be checked before importing', '{count} 曲をキューに追加しました。確認してから順にインポートします', '{count}곡을 대기열에 넣었습니다. 각각 확인한 뒤 가져옵니다', '已排入 {count} 首，将逐首检查后导入'],
    'import.playlist.skippedSuffix': ['，略過 {count} 首', ', {count} skipped', '、{count} 曲をスキップ', ', {count}곡 건너뜀', '，跳过 {count} 首'],
    'import.playlist.failedSuffix': ['，失敗 {count} 首', ', {count} failed', '、{count} 曲に失敗', ', {count}곡 실패', '，失败 {count} 首'],
    'import.playlist.complete': ['播放清單匯入完成：{imported} 首{skipped}{failed}', 'Playlist import complete: {imported} tracks{skipped}{failed}', 'プレイリストのインポートが完了しました：{imported} 曲{skipped}{failed}', '재생목록 가져오기가 완료되었습니다: {imported}곡{skipped}{failed}', '播放列表导入完成：{imported} 首{skipped}{failed}'],
    'import.playlist.completeProgress': ['✓ 播放清單匯入完成：{imported} 首{skipped}{failed}', '✓ Playlist import complete: {imported} tracks{skipped}{failed}', '✓ プレイリストのインポートが完了しました：{imported} 曲{skipped}{failed}', '✓ 재생목록 가져오기가 완료되었습니다: {imported}곡{skipped}{failed}', '✓ 播放列表导入完成：{imported} 首{skipped}{failed}'],
    'import.playlist.failed': ['播放清單匯入失敗：{message}', 'Playlist import failed: {message}', 'プレイリストのインポートに失敗しました：{message}', '재생목록 가져오기에 실패했습니다: {message}', '播放列表导入失败：{message}'],
    'import.riskWarningsReenabled': ['已重新啟用 YouTube 匯入警告', 'YouTube import warnings are back on', 'YouTube インポートの警告を再度有効にしました', 'YouTube 가져오기 경고를 다시 켰습니다', '已重新启用 YouTube 导入警告'],
    'import.assessment.unknownTitle': ['無法取得影片標題', 'Video title unavailable', '動画タイトルを取得できません', '동영상 제목을 가져올 수 없습니다', '无法获取视频标题'],
    'import.assessment.unknownChannel': ['未知頻道', 'Unknown channel', '不明なチャンネル', '알 수 없는 채널', '未知频道'],
    'import.assessment.unknownDuration': ['時長未知', 'Duration unknown', '長さ不明', '길이 알 수 없음', '时长未知'],
    'import.assessment.unavailable': ['無法確認影片是否適合匯入', 'Could not determine whether this video is suitable for import', 'この動画をインポートしてよいか確認できません', '이 동영상을 가져와도 되는지 확인할 수 없습니다', '无法确认该视频是否适合导入'],
    'import.assessment.unavailableWithReason': ['無法在下載前確認影片資訊：{message}', 'Could not verify video details before downloading: {message}', 'ダウンロード前に動画情報を確認できません：{message}', '다운로드 전에 동영상 정보를 확인할 수 없습니다: {message}', '无法在下载前确认视频信息：{message}'],
    'import.assessment.unknownReason': ['未知原因', 'Unknown reason', '理由不明', '알 수 없는 이유', '未知原因'],
    'import.stage.inspecting': ['正在檢查影片', 'Checking video', '動画を確認中', '동영상 확인 중', '正在检查视频'],
    'import.stage.inspectDetails': ['正在檢查時長與內容類型', 'Checking duration and content type', '長さとコンテンツ種別を確認中', '길이와 콘텐츠 유형을 확인 중', '正在检查时长和内容类型'],
    'import.stage.waiting': ['等待中', 'Waiting', '待機中', '대기 중', '等待中'],
    'import.stage.preparing': ['準備匯入', 'Preparing import', 'インポートを準備中', '가져오기 준비 중', '正在准备导入'],
    'import.stage.waitingForConfirmation': ['等待使用者確認', 'Waiting for your confirmation', '確認待ち', '사용자 확인 대기', '等待用户确认'],
    'import.stage.needsAssessment': ['需要確認影片資訊', 'Video details need confirmation', '動画情報の確認が必要です', '동영상 정보 확인이 필요합니다', '需要确认视频信息'],
    'import.stage.preparingDownload': ['準備下載', 'Preparing download', 'ダウンロードを準備中', '다운로드 준비 중', '正在准备下载'],
    'import.stage.checkPassed': ['已通過匯入檢查', 'Import check passed', 'インポート確認を通過しました', '가져오기 확인을 통과했습니다', '已通过导入检查'],
    'import.stage.gettingInfo': ['正在取得影片資訊', 'Getting video details', '動画情報を取得中', '동영상 정보를 가져오는 중', '正在获取视频信息'],
    'import.stage.downloading': ['正在下載', 'Downloading', 'ダウンロード中', '다운로드 중', '正在下载'],
    'import.stage.convertingAudio': ['正在轉換音訊', 'Converting audio', '音声を変換中', '오디오 변환 중', '正在转换音频'],
    'import.stage.searchingLyrics': ['正在搜尋歌詞', 'Searching for lyrics', '歌詞を検索中', '가사를 검색 중', '正在搜索歌词'],
    'import.stage.completed': ['已完成', 'Completed', '完了', '완료됨', '已完成'],
    'import.stage.cancelled': ['已取消', 'Canceled', 'キャンセル済み', '취소됨', '已取消'],
    'import.stage.skipped': ['已略過', 'Skipped', 'スキップ済み', '건너뜀', '已跳过'],
    'import.stage.failed': ['失敗', 'Failed', '失敗', '실패', '失败'],
    'import.stage.processing': ['處理中', 'Processing', '処理中', '처리 중', '正在处理'],
    'import.job.defaultLabel': ['{source} · {id}', '{source} · {id}', '{source} · {id}', '{source} · {id}', '{source} · {id}'],
    'import.job.unresolvedLink': ['待解析連結', 'Unresolved link', '未解析のリンク', '분석 대기 링크', '待解析链接'],
    'import.job.defaultSource': ['YouTube 匯入', 'YouTube import', 'YouTube インポート', 'YouTube 가져오기', 'YouTube 导入'],
    'import.job.redownloadSource': ['重新下載', 'Re-download', '再ダウンロード', '다시 다운로드', '重新下载'],
    'import.job.twitchSource': ['Twitch · {requester}', 'Twitch · {requester}', 'Twitch · {requester}', 'Twitch · {requester}', 'Twitch · {requester}'],
    'import.job.queued': ['等待中 · 佇列第 {position} 位', 'Waiting · queue position {position}', '待機中 · キュー {position} 番目', '대기 중 · 대기열 {position}번째', '等待中 · 队列第 {position} 位'],
    'import.job.cancel': ['取消', 'Cancel', 'キャンセル', '취소', '取消'],
    'import.job.cancelling': ['取消中…', 'Canceling…', 'キャンセル中…', '취소 중…', '正在取消…'],
    'import.job.retry': ['重試', 'Retry', '再試行', '다시 시도', '重试'],
    'import.job.cancelledBeforeStart': ['已取消，未開始下載', 'Canceled before downloading started', 'ダウンロード開始前にキャンセルしました', '다운로드를 시작하기 전에 취소했습니다', '已取消，尚未开始下载'],
    'import.job.skipping': ['將略過這項匯入', 'This import will be skipped', 'このインポートをスキップします', '이 가져오기를 건너뜁니다', '将跳过这项导入'],
    'import.job.stopping': ['正在停止匯入…', 'Stopping import…', 'インポートを停止中…', '가져오기를 중지하는 중…', '正在停止导入…'],
    'import.job.cannotCancel': ['工作已完成，無法取消', 'The job has already finished and cannot be canceled', '作業は完了しているためキャンセルできません', '작업이 이미 완료되어 취소할 수 없습니다', '工作已完成，无法取消'],
    'import.job.cancelFailed': ['取消要求失敗：{message}', 'Could not request cancellation: {message}', 'キャンセルを要求できません：{message}', '취소를 요청하지 못했습니다: {message}', '取消请求失败：{message}'],
    'import.progress.status': ['{stage}{percent}{error}', '{stage}{percent}{error}', '{stage}{percent}{error}', '{stage}{percent}{error}', '{stage}{percent}{error}'],
    'import.progress.percent': [' {value}%', ' {value}%', ' {value}%', ' {value}%', ' {value}%'],
    'import.progress.error': ['：{message}', ': {message}', '：{message}', ': {message}', '：{message}'],
    'import.progress.queuePosition': ['（第 {current}/{total} 首）', ' (item {current}/{total})', '（{current}/{total} 曲目）', '({current}/{total}번째 곡)', '（第 {current}/{total} 首）'],
    'import.progress.firstItem': ['（首次或長曲較久，請稍候）', ' (the first or a long track can take a while)', '（最初の曲または長い曲は時間がかかる場合があります）', '(첫 곡이나 긴 곡은 시간이 더 걸릴 수 있습니다)', '（首次或较长的歌曲可能需要一些时间）'],
    'import.progress.downloadingAndProcessing': ['下載並處理中{detail}', 'Downloading and processing{detail}', 'ダウンロードして処理中{detail}', '다운로드 및 처리 중{detail}', '正在下载并处理{detail}'],
    'import.placement.next': ['已插到下一首', 'Added next', '次の曲に追加しました', '다음 곡에 넣었습니다', '已插到下一首'],
    'import.placement.endBecauseIdle': ['目前沒有播放歌曲，已加入清單尾端', 'Nothing is playing, so it was added to the end of the playlist', '再生中の曲がないため、プレイリストの最後に追加しました', '재생 중인 곡이 없어 재생목록 맨 뒤에 추가했습니다', '当前没有播放歌曲，已加入播放列表队尾'],
    'import.placement.added': ['已加入播放清單', 'Added to playlist', 'プレイリストに追加しました', '재생목록에 추가했습니다', '已加入播放列表'],
    'import.job.completed': ['{placement}：{title}', '{placement}: {title}', '{placement}：{title}', '{placement}: {title}', '{placement}：{title}'],
    'import.error.playlistUpdateFailed': ['重新下載後更新清單失敗：{message}', 'Could not update the playlist after redownloading: {message}', '再ダウンロード後にプレイリストを更新できません：{message}', '다시 다운로드한 뒤 재생목록을 업데이트하지 못했습니다: {message}', '重新下载后更新播放列表失败：{message}'],
    'import.error.serverUnconfirmed': ['伺服器沒有確認', 'The server did not confirm the change', 'サーバーが変更を確認しませんでした', '서버가 변경을 확인하지 않았습니다', '服务器没有确认'],
    'import.error.importFailed': ['YouTube 匯入失敗：{message}', 'YouTube import failed: {message}', 'YouTube インポートに失敗しました：{message}', 'YouTube 가져오기에 실패했습니다: {message}', 'YouTube 导入失败：{message}'],
    'import.error.unknown': ['未知錯誤', 'Unknown error', '不明なエラー', '알 수 없는 오류', '未知错误'],
    'import.queue.complete': ['✓ 匯入完成：{count} 首{failed}', '✓ Import complete: {count} tracks{failed}', '✓ インポート完了：{count} 曲{failed}', '✓ 가져오기 완료: {count}곡{failed}', '✓ 导入完成：{count} 首{failed}'],
    'import.queue.failedSuffix': ['（{count} 首失敗）', ' ({count} failed)', '（{count} 曲に失敗）', '({count}곡 실패)', '（{count} 首失败）'],
    'import.enterYouTubeLink': ['請輸入 YouTube 連結', 'Enter a YouTube link', 'YouTube リンクを入力してください', 'YouTube 링크를 입력하세요', '请输入 YouTube 链接'],
    'errorHistory.copied': ['錯誤記錄已複製', 'Error history copied', 'エラー記録をコピーしました', '오류 기록을 복사했습니다', '错误记录已复制'],
    'errorHistory.clipboardUnavailable': ['無法存取剪貼簿，請檢查瀏覽器權限', 'Could not access the clipboard. Check your browser permission.', 'クリップボードにアクセスできません。ブラウザの権限を確認してください。', '클립보드에 접근할 수 없습니다. 브라우저 권한을 확인하세요.', '无法访问剪贴板，请检查浏览器权限。'],
    'errorHistory.cleared': ['錯誤記錄已清除', 'Error history cleared', 'エラー記録を消去しました', '오류 기록을 지웠습니다', '错误记录已清除'],
    'errorHistory.source.operation': ['操作錯誤', 'Operation error', '操作エラー', '작업 오류', '操作错误'],
    'errorHistory.source.warning': ['警告', 'Warning', '警告', '경고', '警告'],
    'validation.youtubeRequired': ['請輸入 YouTube 連結', 'Enter a YouTube link', 'YouTube リンクを入力してください', 'YouTube 링크를 입력하세요', '请输入 YouTube 链接'],
    'validation.youtubeInvalid': ['無效的 YouTube 連結格式，請確認連結正確', 'Invalid YouTube link. Check that the link is correct.', 'YouTube リンクの形式が無効です。リンクを確認してください。', 'YouTube 링크 형식이 올바르지 않습니다. 링크를 확인하세요.', '无效的 YouTube 链接格式，请确认链接正确。'],
    'validation.fileMissing': ['未選擇檔案', 'No file selected', 'ファイルが選択されていません', '파일을 선택하지 않았습니다', '未选择文件'],
    'validation.lyricsFileMissing': ['未選擇歌詞檔案', 'No lyrics file selected', '歌詞ファイルが選択されていません', '가사 파일을 선택하지 않았습니다', '未选择歌词文件'],
    'validation.unsupportedFormat': ['不支援的格式 {ext}，僅支援：{formats}', 'Unsupported format {ext}. Supported formats: {formats}', '形式 {ext} には対応していません。対応形式：{formats}', '지원하지 않는 형식입니다: {ext}. 지원 형식: {formats}', '不支持的格式 {ext}，仅支持：{formats}'],
    'validation.audioFileTooLarge': ['檔案過大（{size} MB），上限 {limit} MB', 'The file is too large ({size} MB). Maximum: {limit} MB', 'ファイルが大きすぎます（{size} MB）。上限：{limit} MB', '파일이 너무 큽니다({size} MB). 최대: {limit} MB', '文件过大（{size} MB），上限 {limit} MB'],
    'validation.lyricsFileTooLarge': ['歌詞檔案過大（{size} MB），上限 {limit} MB', 'The lyrics file is too large ({size} MB). Maximum: {limit} MB', '歌詞ファイルが大きすぎます（{size} MB）。上限：{limit} MB', '가사 파일이 너무 큽니다({size} MB). 최대: {limit} MB', '歌词文件过大（{size} MB），上限 {limit} MB'],
    'validation.lyricsRequired': ['請輸入歌詞內容', 'Enter lyrics', '歌詞を入力してください', '가사를 입력하세요', '请输入歌词内容'],
    'validation.lyricsEmpty': ['歌詞內容不能為空', 'Lyrics cannot be empty', '歌詞を空にすることはできません', '가사는 비워 둘 수 없습니다', '歌词内容不能为空'],
    'validation.lyricsTooLong': ['歌詞內容過長，上限 {limit} 個字元', 'Lyrics are too long. Maximum: {limit} characters', '歌詞が長すぎます。上限：{limit} 文字', '가사가 너무 깁니다. 최대: {limit}자', '歌词内容过长，上限 {limit} 个字符'],
    'network.requestFailed': ['請求失敗（{status}）', 'Request failed ({status})', 'リクエストに失敗しました（{status}）', '요청에 실패했습니다({status})', '请求失败（{status}）'],
    'network.requestTimedOut': ['請求逾時，請檢查網路連線', 'Request timed out. Check your network connection.', 'リクエストがタイムアウトしました。ネットワーク接続を確認してください。', '요청 시간이 초과되었습니다. 네트워크 연결을 확인하세요.', '请求超时，请检查网络连接。'],
    'system.obsUrls': ['OBS 來源網址', 'OBS source URLs', 'OBS ソース URL', 'OBS 소스 URL', 'OBS 来源网址'],
    'system.lyricsDisplay': ['歌詞畫面', 'Lyrics display', '歌詞画面', '가사 화면', '歌词画面'],
    'system.setlistDisplay': ['歌單畫面', 'Setlist display', 'セットリスト画面', '세트리스트 화면', '歌单画面'],
    'system.obsUrlHint': ['在 OBS 新增「瀏覽器」來源後貼上對應網址；或用下方 OBS 連動一次建立兩個來源。', 'Paste these URLs into OBS Browser Sources, or use OBS integration below to create both at once.', 'OBS の「ブラウザ」ソースに URL を貼るか、下の OBS 連携で両方を作成します。', 'OBS 브라우저 소스에 URL을 붙여넣거나 아래 OBS 연동으로 두 소스를 한 번에 만드세요.', '在 OBS 新增“浏览器”来源后粘贴对应网址；或用下方 OBS 联动一次创建两个来源。'],
    'system.remote': ['手機遙控器', 'Mobile remote', 'モバイルリモコン', '모바일 리모컨', '手机遥控器'],
    'system.remoteHint': ['手機和電腦連上同一個 Wi-Fi，掃描 QR code 或輸入網址即可遙控播放；不要開放到外網。', 'Connect your phone and computer to the same Wi-Fi, then scan the QR code or enter the URL. Do not expose it to the internet.', 'スマートフォンと PC を同じ Wi-Fi に接続し、QR コードまたは URL で操作してください。外部公開はしないでください。', '휴대폰과 컴퓨터를 같은 Wi-Fi에 연결한 뒤 QR 코드나 URL로 조작하세요. 외부 인터넷에 공개하지 마세요.', '手机和电脑连接同一 Wi-Fi，扫描二维码或输入网址即可遥控播放；请勿开放到外网。'],
    'system.detectingLan': ['偵測區網位址中…', 'Detecting LAN address…', 'LAN アドレスを検出中…', 'LAN 주소 확인 중…', '正在检测局域网地址…'],
    'system.remoteQrAlt': ['手機遙控器 QR code', 'Mobile remote QR code', 'モバイルリモコン QR コード', '모바일 리모컨 QR 코드', '手机遥控器二维码'],
    'system.remoteUrlHint': ['手機瀏覽器打開這個網址（不是 localhost），會自動轉到遙控器頁面。', 'Open this URL on your phone (not localhost) to reach the remote.', 'スマートフォンでこの URL（localhost ではありません）を開くとリモコンへ移動します。', '휴대폰에서 이 URL(localhost 아님)을 열면 리모컨으로 이동합니다.', '在手机浏览器打开这个网址（不是 localhost），会自动转到遥控器页面。'],
    'system.usageTitle': ['匿名活躍統計', 'Anonymous usage statistics', '匿名利用統計', '익명 사용 통계', '匿名活跃统计'],
    'system.usageDescription': ['協助了解實際使用人數。只傳送程式版本、啟動／核心功能使用事件，以及每日／每週／每月輪替的匿名代碼。', 'Helps measure real usage. Only the app version, startup/core-use event, and daily/weekly/monthly rotating anonymous codes are sent.', '実際の利用者数を把握するため、アプリのバージョン、起動／主要機能の利用イベント、日・週・月ごとに変わる匿名コードのみを送信します。', '실제 사용 인원을 파악하기 위해 앱 버전, 시작/핵심 기능 사용 이벤트, 일간/주간/월간으로 변경되는 익명 코드만 전송합니다.', '用于了解实际使用人数。仅发送程序版本、启动/核心功能使用事件，以及每日/每周/每月轮换的匿名代码。'],
    'system.usagePrivacy': ['不傳送固定安裝 ID、IP、電腦或硬體資訊、歌名、歌詞、歌單、Twitch 帳號或憑證；傳送失敗不影響程式，也不會補傳。', 'No permanent install ID, IP address, computer/hardware data, song titles, lyrics, playlists, Twitch accounts, or credentials are sent. Failures never affect the app and are not retried later.', '固定インストール ID、IP アドレス、PC／ハードウェア情報、曲名、歌詞、セットリスト、Twitch アカウントや認証情報は送信しません。失敗しても動作には影響せず、後から再送もしません。', '고정 설치 ID, IP 주소, 컴퓨터/하드웨어 정보, 곡명, 가사, 재생목록, Twitch 계정 또는 인증 정보는 전송하지 않습니다. 실패해도 앱에 영향을 주지 않으며 나중에 재전송하지 않습니다.', '不会发送固定安装 ID、IP 地址、电脑或硬件信息、歌名、歌词、歌单、Twitch 账号或凭证；发送失败不影响程序，也不会补传。'],
    'system.usageToggle': ['允許匿名活躍統計', 'Allow anonymous usage statistics', '匿名利用統計を許可', '익명 사용 통계 허용', '允许匿名活跃统计'],
    'system.usageEnabled': ['已啟用', 'Enabled', '有効', '사용 중', '已启用'],
    'system.usageDisabled': ['已停用；本機匿名祕密已刪除', 'Disabled; the local anonymous secret was deleted', '無効です。端末内の匿名シークレットは削除されました', '사용 안 함; 로컬 익명 비밀값이 삭제되었습니다', '已停用；本地匿名密钥已删除'],
    'system.usageSaving': ['儲存中…', 'Saving…', '保存中…', '저장 중…', '保存中…'],
    'system.usageSaveFailed': ['儲存失敗，已還原原設定', 'Could not save; the previous setting was restored', '保存できなかったため、以前の設定に戻しました', '저장하지 못해 이전 설정으로 복원했습니다', '保存失败，已恢复原设置'],
    'system.usageUnavailable': ['統計服務目前未設定；不會傳送資料', 'The statistics service is not configured; no data will be sent', '統計サービスが未設定のため、データは送信されません', '통계 서비스가 설정되지 않아 데이터를 전송하지 않습니다', '统计服务目前未设置；不会发送数据'],
    'system.twitchHintBefore': ['連接後會以 Twitch 的實際', 'Once connected, the live setlist starts from Twitch’s actual', '接続後、Twitch の実際の', '연결 후 Twitch의 실제', '连接后会以 Twitch 的实际'],
    'system.twitchHintMiddle': ['時間自動開始直播歌單；聊天室輸入', 'time; entering', '時刻から配信セットリストを自動開始します。チャットで', '시간을 기준으로 방송 세트리스트를 자동 시작합니다. 채팅에', '时间自动开始直播歌单；聊天室输入'],
    'system.twitchHintAfter': ['會走既有單一下載佇列，完成後才在聊天室回覆成功。', 'uses the existing single download queue and replies in chat only after completion.', 'を入力すると既存の単一ダウンロードキューを使い、完了後にのみチャットへ成功を返信します。', '을 입력하면 기존 단일 다운로드 대기열을 사용하며, 완료 후에만 채팅에 성공 메시지를 보냅니다.', '会走既有单一下载队列，完成后才在聊天室回复成功。'],
    'system.compatNotRun': ['尚未驗證 YouTube 相容性', 'YouTube compatibility has not been verified', 'YouTube 互換性は未検証です', 'YouTube 호환성을 확인하지 않았습니다', '尚未验证 YouTube 兼容性'],
    'system.compatMissing': ['找不到 yt-dlp，無法驗證 YouTube 相容性。', 'yt-dlp was not found, so YouTube compatibility cannot be verified.', 'yt-dlp が見つからないため YouTube 互換性を検証できません。', 'yt-dlp를 찾을 수 없어 YouTube 호환성을 확인할 수 없습니다.', '找不到 yt-dlp，无法验证 YouTube 兼容性。'],
    'system.compatTimeout': ['驗證 YouTube 相容性逾時；請檢查網路後重試。', 'YouTube compatibility check timed out. Check the network and try again.', 'YouTube 互換性の確認がタイムアウトしました。ネットワークを確認して再試行してください。', 'YouTube 호환성 확인 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도하세요.', '验证 YouTube 兼容性超时；请检查网络后重试。'],
    'system.compatFailed': ['yt-dlp 目前無法讀取 YouTube；請先檢查或更新 yt-dlp，再重試。', 'yt-dlp cannot currently read YouTube. Check or update yt-dlp, then try again.', 'yt-dlp は現在 YouTube を読み取れません。yt-dlp を確認または更新して再試行してください。', '현재 yt-dlp가 YouTube를 읽을 수 없습니다. yt-dlp를 확인하거나 업데이트한 뒤 다시 시도하세요.', 'yt-dlp 目前无法读取 YouTube；请先检查或更新 yt-dlp，再重试。'],
    'system.compatRunning': ['正在驗證 YouTube 相容性（不會下載音檔）', 'Checking YouTube compatibility (no audio will be downloaded)', 'YouTube 互換性を確認中（音声はダウンロードしません）', 'YouTube 호환성 확인 중(오디오는 다운로드하지 않음)', '正在验证 YouTube 兼容性（不会下载音频）'],
    'system.compatOk': ['已確認 yt-dlp 可以讀取 YouTube（未下載任何音檔）。', 'Confirmed that yt-dlp can read YouTube (no audio was downloaded).', 'yt-dlp が YouTube を読み取れることを確認しました（音声はダウンロードしていません）。', 'yt-dlp가 YouTube를 읽을 수 있음을 확인했습니다(오디오 다운로드 없음).', '已确认 yt-dlp 可以读取 YouTube（未下载任何音频）。'],
    'system.compatReadFailed': ['無法讀取 YouTube 相容性狀態', 'Could not read YouTube compatibility status', 'YouTube 互換性の状態を読み取れません', 'YouTube 호환성 상태를 읽을 수 없습니다', '无法读取 YouTube 兼容性状态'],
    'diagnostics.hoursMinutes': ['{hours} 小時 {minutes} 分', '{hours} h {minutes} min', '{hours} 時間 {minutes} 分', '{hours}시간 {minutes}분', '{hours} 小时 {minutes} 分'],
    'diagnostics.minutes': ['{minutes} 分', '{minutes} min', '{minutes} 分', '{minutes}분', '{minutes} 分'],
    'diagnostics.underMinute': ['未滿 1 分', 'Under 1 min', '1 分未満', '1분 미만', '未满 1 分'],
    'diagnostics.recorded': ['本場已記錄 {duration}', 'Recorded {duration} this session', 'このセッションを {duration} 記録', '이번 세션 {duration} 기록', '本场已记录 {duration}'],
    'diagnostics.thresholdMet': ['四小時時長門檻已達成', 'Four-hour threshold reached', '4 時間の基準を達成', '4시간 기준 달성', '已达到四小时门槛'],
    'diagnostics.thresholdRemaining': ['距四小時時長門檻還差 {duration}', '{duration} remaining to the four-hour threshold', '4 時間の基準まで残り {duration}', '4시간 기준까지 {duration} 남음', '距四小时门槛还差 {duration}'],
    'diagnostics.obsBoth': ['OBS 歌詞／歌單同時連線 {duration}', 'OBS lyrics and setlist connected together for {duration}', 'OBS 歌詞／セットリスト同時接続 {duration}', 'OBS 가사/세트리스트 동시 연결 {duration}', 'OBS 歌词／歌单同时连接 {duration}'],
    'diagnostics.interruptions': ['曾中斷 {count} 次', '{count} interruptions', '{count} 回中断', '{count}회 중단', '曾中断 {count} 次'],
    'diagnostics.noInterruptions': ['未偵測到來源中斷', 'No source interruptions detected', 'ソースの切断なし', '소스 중단 감지 안 됨', '未检测到来源中断'],
    'diagnostics.obsNotTogether': ['OBS 兩個正式來源尚未同時連線', 'The two official OBS sources are not both connected yet.', '2 つの正式 OBS ソースはまだ同時接続されていません', '두 공식 OBS 소스가 아직 동시에 연결되지 않았습니다', '两个正式 OBS 来源尚未同时连接'],
    'diagnostics.noObs': ['尚未偵測到正式 OBS 來源', 'No official OBS source detected yet', '正式な OBS ソースはまだ検出されていません', '공식 OBS 소스가 아직 감지되지 않았습니다', '尚未检测到正式 OBS 来源'],
    'diagnostics.twitchConnected': ['Twitch 目前已連線', 'Twitch is connected', 'Twitch 接続済み', 'Twitch 연결됨', 'Twitch 已连接'],
    'diagnostics.twitchState': ['Twitch 狀態：{state}', 'Twitch status: {state}', 'Twitch 状態：{state}', 'Twitch 상태: {state}', 'Twitch 状态：{state}'],
    'diagnostics.twitchDisabled': ['Twitch 未啟用，不列入本場觀測', 'Twitch is disabled and excluded from this session', 'Twitch は無効のため、このセッションの観測対象外です', 'Twitch가 비활성화되어 이번 세션의 모니터링에서 제외됩니다', 'Twitch 未启用，不列入本场观测'],

    // 問題回報。介面文字跟著使用者語言，但送出的報告內文固定繁體中文
    // （見 server/services/feedback-report.js）——維護者要看得懂收到的東西。
    // 上次未正常關閉的提示。措辭刻意保守：只說「未正常關閉」，不說「當機」——
    // 使用者自己用工作管理員關掉、或 Windows 更新重開機也會觸發，講死了會嚇到人。
    'crash.title': ['Elitesand Pro 上次未正常關閉', 'Elitesand Pro did not shut down cleanly last time', 'Elitesand Pro が前回正常に終了しませんでした', 'Elitesand Pro가 지난번에 정상적으로 종료되지 않았습니다', 'Elitesand Pro 上次未正常关闭'],
    'crash.message': ['要傳送診斷資訊協助找出原因嗎？送出前你可以先看過完整內容。', 'Send diagnostics to help find the cause? You can review the full content before sending.', '原因調査のために診断情報を送信しますか？送信前に内容をすべて確認できます。', '원인 파악을 위해 진단 정보를 보낼까요? 보내기 전에 전체 내용을 확인할 수 있습니다.', '要发送诊断信息协助找出原因吗？送出前你可以先看过完整内容。'],
    'crash.review': ['查看內容', 'Review and send', '内容を確認', '내용 확인', '查看内容'],
    'crash.dismiss': ['不用了', 'No thanks', '今回は送らない', '보내지 않기', '不用了'],
    'crash.prefillTitle': ['程式上次未正常關閉', 'The app did not shut down cleanly', 'アプリが正常に終了しませんでした', '앱이 정상적으로 종료되지 않았습니다', '程序上次未正常关闭'],
    'crash.prefillActual': ['程式上次未正常關閉，可能是意外結束、系統重啟或手動關閉。', 'The app did not shut down cleanly. It may have closed unexpectedly, been restarted by the system, or been closed manually.', 'アプリが正常に終了しませんでした。予期しない終了、システムの再起動、または手動での終了の可能性があります。', '앱이 정상적으로 종료되지 않았습니다. 예기치 않은 종료, 시스템 재시작 또는 수동 종료일 수 있습니다.', '程序上次未正常关闭，可能是意外结束、系统重启或手动关闭。'],

    'feedback.title': ['回報問題給開發者', 'Report a problem', '開発者に問題を報告', '개발자에게 문제 신고', '回报问题给开发者'],
    'feedback.launchBtn': ['回報問題', 'Report a problem', '問題を報告', '문제 신고', '报告问题'],
    'feedback.openBtn': ['填寫問題回報', 'Open the report form', '報告フォームを開く', '신고 양식 열기', '填写问题回报'],
    'feedback.intro': ['遇到問題可以直接在這裡回報，不需要 GitHub 帳號。送出前會把「實際要送出的完整內容」顯示給你確認，你可以先取消附加診斷資訊再送。', 'Report problems here directly — no GitHub account needed. Before sending, the exact content that will be submitted is shown for you to review, and you can turn off the diagnostic details first.', 'GitHub アカウントなしで、ここから直接問題を報告できます。送信前に実際に送られる内容がすべて表示され、診断情報を外してから送ることもできます。', 'GitHub 계정 없이 여기서 바로 문제를 신고할 수 있습니다. 보내기 전에 실제로 전송될 전체 내용을 확인할 수 있으며, 진단 정보를 빼고 보낼 수도 있습니다.', '遇到问题可以直接在这里回报，不需要 GitHub 账号。送出前会把“实际要送出的完整内容”显示给你确认，你可以先取消附加诊断信息再送。'],
    'feedback.fieldType': ['問題類型', 'Problem type', '問題の種類', '문제 유형', '问题类型'],
    'feedback.typeAppError': ['程式錯誤', 'Application error', 'アプリのエラー', '앱 오류', '程序错误'],
    'feedback.typeImportPlayback': ['匯入或播放問題', 'Import or playback problem', '取り込み・再生の問題', '가져오기 또는 재생 문제', '导入或播放问题'],
    'feedback.typeLyrics': ['歌詞問題', 'Lyrics problem', '歌詞の問題', '가사 문제', '歌词问题'],
    'feedback.typeObs': ['OBS 顯示問題', 'OBS display problem', 'OBS 表示の問題', 'OBS 표시 문제', 'OBS 显示问题'],
    'feedback.typeTwitch': ['Twitch 點歌問題', 'Twitch song request problem', 'Twitch リクエストの問題', 'Twitch 신청곡 문제', 'Twitch 点歌问题'],
    'feedback.typeUiI18n': ['介面或翻譯問題', 'Interface or translation problem', 'UI・翻訳の問題', '인터페이스 또는 번역 문제', '界面或翻译问题'],
    'feedback.typeFeature': ['功能建議', 'Feature request', '機能の提案', '기능 제안', '功能建议'],
    'feedback.typeOther': ['其他問題', 'Something else', 'その他', '기타', '其他问题'],
    'feedback.fieldTitle': ['標題', 'Title', 'タイトル', '제목', '标题'],
    'feedback.titlePlaceholder': ['一句話描述問題', 'Describe the problem in one line', '問題を一言で', '문제를 한 줄로 설명', '一句话描述问题'],
    'feedback.fieldDescription': ['問題說明', 'What happened', '問題の説明', '문제 설명', '问题说明'],
    'feedback.descriptionPlaceholder': ['發生了什麼事？', 'What went wrong?', '何が起きましたか？', '무슨 일이 있었나요?', '发生了什么事？'],
    'feedback.fieldSteps': ['重現步驟（一行一步）', 'Steps to reproduce (one per line)', '再現手順（1 行に 1 手順）', '재현 단계(한 줄에 하나)', '重现步骤（一行一步）'],
    'feedback.stepsPlaceholder': ['1. 先做了什麼\n2. 再做了什麼', '1. What you did first\n2. What you did next', '1. 最初にしたこと\n2. 次にしたこと', '1. 먼저 한 일\n2. 그다음 한 일', '1. 先做了什么\n2. 再做了什么'],
    'feedback.fieldActual': ['實際結果', 'What actually happened', '実際の結果', '실제 결과', '实际结果'],
    'feedback.actualPlaceholder': ['實際發生的情況', 'What actually happened', '実際に起きたこと', '실제로 일어난 일', '实际发生的情况'],
    'feedback.fieldExpected': ['預期結果（選填）', 'What you expected (optional)', '期待した結果（任意）', '예상한 결과(선택)', '预期结果（选填）'],
    'feedback.expectedPlaceholder': ['你原本期待會發生什麼', 'What you expected to happen', '本来どうなるはずでしたか', '원래 어떻게 되어야 했나요', '你原本期待会发生什么'],
    'feedback.fieldContact': ['聯絡方式（選填）', 'Contact (optional)', '連絡先（任意）', '연락처(선택)', '联系方式（选填）'],
    'feedback.contactPlaceholder': ['Discord 或 Email，沒留就無法回覆你', 'Discord or email — without it we cannot reply', 'Discord またはメール（未記入だと返信できません）', 'Discord 또는 이메일 — 없으면 답장할 수 없습니다', 'Discord 或 Email，没留就无法回复你'],
    'feedback.contactHint': ['沒有留聯絡方式的話，開發者收得到問題但沒辦法回覆你或追問細節。', 'Without a contact the developer receives the report but cannot reply or ask for details.', '連絡先がないと、報告は届きますが返信も追加確認もできません。', '연락처가 없으면 신고는 접수되지만 답장하거나 자세히 물어볼 수 없습니다.', '没有留联系方式的话，开发者收得到问题但没办法回复你或追问细节。'],
    'feedback.includeDiagnostics': ['附加診斷資訊', 'Attach diagnostics', '診断情報を添付', '진단 정보 첨부', '附加诊断信息'],
    'feedback.includeDiagnosticsHint': ['版本、系統、yt-dlp／FFmpeg 狀態、連線觀測與已遮蔽的最近日誌。取消後只送出你填的文字。', 'Version, system, yt-dlp/FFmpeg status, connection observations, and redacted recent logs. Turn this off to send only what you typed.', 'バージョン、システム、yt-dlp／FFmpeg の状態、接続の観測、マスク済みの直近ログ。オフにすると入力した文章だけを送ります。', '버전, 시스템, yt-dlp/FFmpeg 상태, 연결 관측, 마스킹된 최근 로그. 끄면 입력한 내용만 전송됩니다.', '版本、系统、yt-dlp／FFmpeg 状态、连接观测与已遮蔽的最近日志。取消后只送出你填的文字。'],
    'feedback.previewBtn': ['預覽將送出的內容', 'Preview what will be sent', '送信内容をプレビュー', '보낼 내용 미리보기', '预览将送出的内容'],
    'feedback.collecting': ['正在收集診斷資訊…', 'Collecting diagnostics…', '診断情報を収集中…', '진단 정보 수집 중…', '正在收集诊断信息…'],
    'feedback.clearBtn': ['清空表單', 'Clear form', 'フォームを消去', '양식 비우기', '清空表单'],
    'feedback.previewNotice': ['以下就是實際會送出的全部內容，沒有其他隱藏欄位。確認沒問題再送出。', 'This is everything that will be sent — there are no hidden fields. Send it once you are happy with it.', '以下が実際に送信されるすべての内容です。隠しフィールドはありません。確認のうえ送信してください。', '아래가 실제로 전송되는 전체 내용입니다. 숨겨진 항목은 없습니다. 확인 후 보내세요.', '以下就是实际会送出的全部内容，没有其他隐藏字段。确认没问题再送出。'],
    'feedback.previewSize': ['將送出約 {size} KB 的文字', 'About {size} KB of text will be sent', '約 {size} KB のテキストを送信します', '약 {size} KB의 텍스트가 전송됩니다', '将送出约 {size} KB 的文字'],
    'feedback.submitBtn': ['送出回報', 'Send report', '報告を送信', '신고 보내기', '送出回报'],
    'feedback.copyBtn': ['複製全文', 'Copy everything', '全文をコピー', '전체 복사', '复制全文'],
    'feedback.backBtn': ['返回修改', 'Back to edit', '戻って修正', '돌아가서 수정', '返回修改'],
    'feedback.privacyHint': ['回報只在你按下「送出回報」時才會離開這台電腦。內容會先移除 Token、Cookie、PIN、Email 與家目錄路徑，但日誌仍可能提到歌名或影片標題——送出前請看過預覽。', 'Nothing leaves this computer until you press “Send report.” Tokens, cookies, PINs, emails, and home-folder paths are removed first, but logs may still mention song or video titles — read the preview before sending.', '「報告を送信」を押すまで、この PC から何も送信されません。トークン・Cookie・PIN・メール・ホームフォルダーのパスは事前に除去されますが、ログに曲名や動画タイトルが残る場合があります。送信前にプレビューをご確認ください。', '“신고 보내기”를 누르기 전에는 이 컴퓨터에서 아무것도 나가지 않습니다. 토큰, 쿠키, PIN, 이메일, 홈 폴더 경로는 먼저 제거되지만 로그에 곡명이나 영상 제목이 남을 수 있습니다. 보내기 전에 미리보기를 확인하세요.', '回报只在你按下“送出回报”时才会离开这台电脑。内容会先移除 Token、Cookie、PIN、Email 与家目录路径，但日志仍可能提到歌名或视频标题——送出前请看过预览。'],
    'feedback.fieldSchema': ['回報格式', 'Report format', '報告フォーマット', '신고 형식', '回报格式'],
    'feedback.errorTooShort': ['「{field}」還沒填，或填得太短。', '“{field}” is missing or too short.', '「{field}」が未入力か短すぎます。', '“{field}”이(가) 비었거나 너무 짧습니다.', '“{field}”还没填，或填得太短。'],
    'feedback.errorTooLong': ['「{field}」超過長度上限。', '“{field}” is too long.', '「{field}」が長すぎます。', '“{field}”이(가) 너무 깁니다.', '“{field}”超过长度上限。'],
    'feedback.errorTooMany': ['「{field}」的項目太多了。', '“{field}” has too many items.', '「{field}」の項目が多すぎます。', '“{field}” 항목이 너무 많습니다.', '“{field}”的项目太多了。'],
    'feedback.errorInvalidType': ['請選擇一個問題類型。', 'Choose a problem type.', '問題の種類を選んでください。', '문제 유형을 선택하세요.', '请选择一个问题类型。'],
    'feedback.errorUnsupportedSchema': ['這個版本的回報格式已不支援，請更新 Elitesand Pro。', 'This report format is no longer supported. Please update Elitesand Pro.', 'この報告フォーマットはサポートされていません。Elitesand Pro を更新してください。', '이 신고 형식은 더 이상 지원되지 않습니다. Elitesand Pro를 업데이트하세요.', '这个版本的回报格式已不支持，请更新 Elitesand Pro。'],
    'feedback.errorGeneric': ['「{field}」的內容不正確。', '“{field}” is not valid.', '「{field}」の内容が正しくありません。', '“{field}”의 내용이 올바르지 않습니다.', '“{field}”的内容不正确。'],
    'feedback.previewFailed': ['無法產生預覽，請稍後再試。', 'Could not build the preview. Please try again.', 'プレビューを作成できませんでした。時間をおいて再度お試しください。', '미리보기를 만들지 못했습니다. 잠시 후 다시 시도하세요.', '无法生成预览，请稍后再试。'],
    'feedback.submitting': ['正在送出…', 'Sending…', '送信中…', '보내는 중…', '正在送出…'],
    'feedback.submitted': ['已送出，回報編號 {id}。請保留這組編號。', 'Sent. Your report ID is {id} — please keep it.', '送信しました。報告番号は {id} です。控えておいてください。', '전송되었습니다. 신고 번호는 {id}입니다. 보관해 두세요.', '已送出，回报编号 {id}。请保留这组编号。'],
    'feedback.errorRateLimited': ['短時間內送出的回報過多，請稍後再試。', 'Too many reports in a short time. Please try again later.', '短時間に多くの報告が送信されました。しばらくしてからお試しください。', '짧은 시간에 너무 많이 보냈습니다. 잠시 후 다시 시도하세요.', '短时间内送出的回报过多，请稍后再试。'],
    'feedback.errorNetwork': ['目前無法連線至問題回報服務。', 'Cannot reach the report service right now.', '現在、報告サービスに接続できません。', '지금은 신고 서비스에 연결할 수 없습니다.', '目前无法连接至问题回报服务。'],
    'feedback.errorTooLarge': ['回報內容太大，請取消附加診斷資訊或縮短說明。', 'The report is too large. Turn off diagnostics or shorten the description.', '報告の内容が大きすぎます。診断情報を外すか説明を短くしてください。', '신고 내용이 너무 큽니다. 진단 정보를 끄거나 설명을 줄이세요.', '回报内容太大，请取消附加诊断信息或缩短说明。'],
    'feedback.errorBackend': ['問題回報服務暫時無法使用。', 'The report service is temporarily unavailable.', '報告サービスは一時的に利用できません。', '신고 서비스를 일시적으로 사용할 수 없습니다.', '问题回报服务暂时无法使用。'],
    'feedback.fallbackCopy': ['你填的內容還在，可以按「複製全文」貼給開發者。', 'Your text is still here — use “Copy everything” and send it to the developer.', '入力内容は残っています。「全文をコピー」して開発者に送ってください。', '입력한 내용은 그대로 있습니다. “전체 복사”로 개발자에게 보내세요.', '你填的内容还在，可以按“复制全文”贴给开发者。'],
    'feedback.relayDisabled': ['這個版本沒有設定回報服務，請用「複製全文」把內容貼給開發者。', 'No report service is configured in this build. Use “Copy everything” and send it to the developer.', 'このビルドでは報告サービスが設定されていません。「全文をコピー」して開発者に送ってください。', '이 빌드에는 신고 서비스가 설정되어 있지 않습니다. “전체 복사”로 개발자에게 보내세요.', '这个版本没有设置回报服务，请用“复制全文”把内容贴给开发者。'],
    'feedback.copied': ['已複製回報全文', 'Report copied', '報告全文をコピーしました', '신고 전문을 복사했습니다', '已复制回报全文'],
    'feedback.copyManual': ['已選取全文，請按 Ctrl+C 複製', 'Text selected — press Ctrl+C to copy', '全文を選択しました。Ctrl+C でコピーしてください', '전문이 선택되었습니다. Ctrl+C로 복사하세요', '已选取全文，请按 Ctrl+C 复制'],
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
    'controller.lyricPresetLabel': ['歌詞外觀預設', 'Lyrics appearance preset', '歌詞表示プリセット', '가사 모양 프리셋', '歌词外观预设'],
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
    'controller.enterLyrics': ['請輸入歌詞內容', 'Enter lyrics', '歌詞を入力してください', '가사를 입력하세요', '请输入歌词内容'],
    'controller.uploading': ['上傳中…', 'Uploading…', 'アップロード中…', '업로드 중…', '上传中…'],
    'controller.lyricsLoaded': ['歌詞已載入（{count} 行）', 'Lyrics loaded ({count} lines)', '歌詞を読み込みました（{count} 行）', '가사를 불러왔습니다({count}줄)', '歌词已加载（{count} 行）'],
    'controller.lyricsParseFailed': ['歌詞解析失敗', 'Could not parse lyrics', '歌詞の解析に失敗しました', '가사 분석에 실패했습니다', '歌词解析失败'],
    'controller.uploadFailed': ['上傳失敗：{message}', 'Upload failed: {message}', 'アップロードに失敗しました：{message}', '업로드 실패: {message}', '上传失败：{message}'],
    'controller.parseFailed': ['解析失敗：{message}', 'Parsing failed: {message}', '解析に失敗しました：{message}', '분석 실패: {message}', '解析失败：{message}'],
    'controller.selected': ['已選', 'Selected', '選択済み', '선택됨', '已选'],
    'controller.audioError': ['音訊播放錯誤', 'Audio playback error', '音声再生エラー', '오디오 재생 오류', '音频播放错误'],
    'controller.skipping': ['正在跳到下一首…', 'Skipping to the next track…', '次の曲へ移動中…', '다음 곡으로 이동 중…', '正在跳到下一首…'],
    'eula.title': ['使用前請先閱讀授權條款', 'Read the license terms before use', '使用前にライセンス条項をお読みください', '사용 전 라이선스 약관을 읽어 주세요', '使用前请先阅读许可条款'],
    'eula.subtitle': ['Elitesand Pro 最終使用者授權暨免責聲明（EULA）v{version} — 請完整捲動至最底部後勾選同意', 'Elitesand Pro End-User License Agreement and Disclaimer (EULA) v{version} — scroll to the end before accepting', 'Elitesand Pro エンドユーザー使用許諾契約および免責事項（EULA）v{version} — 最後までスクロールしてから同意してください', 'Elitesand Pro 최종 사용자 사용권 계약 및 면책 조항(EULA) v{version} — 끝까지 스크롤한 후 동의해 주세요', 'Elitesand Pro 最终用户许可协议暨免责声明（EULA）v{version} — 请完整滚动至底部后勾选同意'],
    'eula.agree': ['我已完整閱讀並同意上述最終使用者授權暨免責聲明（EULA）與隨附的 LICENSE 授權條款', 'I have read and agree to the EULA above and the accompanying LICENSE terms', '上記の EULA と付属の LICENSE 条項をすべて読み、同意します', '위 EULA 및 동봉된 LICENSE 약관을 모두 읽고 동의합니다', '我已完整阅读并同意上述最终用户许可协议（EULA）与随附的 LICENSE 许可条款'],
    'eula.scrollHint': ['請先將條款捲動到最底部，才能勾選同意。', 'Scroll to the end of the terms before accepting.', '同意する前に条項の最後までスクロールしてください。', '동의하기 전에 약관 끝까지 스크롤해 주세요.', '请先将条款滚动到底部，才能勾选同意。'],
    'eula.scrolledHint': ['已捲動到最底部，可勾選同意。', 'You reached the end. You can now accept.', '最後までスクロールしました。同意できます。', '끝까지 스크롤했습니다. 이제 동의할 수 있습니다.', '已滚动到底部，可以勾选同意。'],
    'eula.accept': ['同意並開始使用', 'Accept and start', '同意して開始', '동의하고 시작', '同意并开始使用'],
    'eula.saveFailed': ['同意紀錄儲存失敗：{message}', 'Could not save acceptance: {message}', '同意記録を保存できませんでした：{message}', '동의 기록을 저장하지 못했습니다: {message}', '同意记录保存失败：{message}'],
    'pin.required': ['需要 PIN', 'PIN required', 'PIN が必要です', 'PIN 필요', '需要 PIN'],
    'pin.deviceHint': ['這台裝置需要輸入 PIN 才能操作 Elitesand Pro。', 'Enter the PIN to control Elitesand Pro from this device.', 'この端末から Elitesand Pro を操作するには PIN を入力してください。', '이 기기에서 Elitesand Pro를 제어하려면 PIN을 입력하세요.', '此设备需要输入 PIN 才能操作 Elitesand Pro。'],
    'pin.placeholder': ['輸入 PIN', 'Enter PIN', 'PIN を入力', 'PIN 입력', '输入 PIN'],
    'pin.enter': ['請輸入 PIN', 'Enter the PIN', 'PIN を入力してください', 'PIN을 입력하세요', '请输入 PIN'],
    'pin.incorrect': ['PIN 不正確', 'Incorrect PIN', 'PIN が正しくありません', 'PIN이 올바르지 않습니다', 'PIN 不正确'],
    'pin.verifyFailed': ['驗證失敗，請確認伺服器連線後再試', 'Verification failed. Check the server connection and try again.', '認証に失敗しました。サーバー接続を確認して再試行してください。', '인증에 실패했습니다. 서버 연결을 확인한 후 다시 시도하세요.', '验证失败，请确认服务器连接后重试'],
    'overlay.connectionLost': ['⚠️ 與伺服器連線中斷…', '⚠️ Server connection lost…', '⚠️ サーバーとの接続が切れました…', '⚠️ 서버 연결이 끊겼습니다…', '⚠️ 与服务器连接中断…'],
    'setlist.done': ['已唱', 'Performed', '歌唱済み', '부른 곡', '已唱'],
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
    'template.pulse': ['星砂流光', 'Stardust Pulse', '星砂の流光', '스타더스트 펄스', '星砂流光'],
    'template.facet': ['折光階梯', 'Prism Steps', '屈折の階段', '굴절 계단', '折光阶梯'],
    'template.drift': ['斜拍告白', 'Offbeat Confession', 'オフビートの告白', '엇박 고백', '斜拍告白'],
    'template.aura': ['潮汐心景', 'Tidal Mindscape', '潮汐の心景', '조수 심상', '潮汐心景'],
    'template.ktv': ['霓彩伴唱', 'Neon KTV', 'ネオン KTV', '네온 KTV', '霓彩伴唱'],
    'template.columnflow': ['直書句流', 'Vertical Verse Flow', '縦書き句流', '세로쓰기 문장 흐름', '竖排句流'],
    'template.paperstrip': ['紙帶逐字', 'Paper Strip', 'ペーパーストリップ', '페이퍼 스트립', '纸带逐字'],
    'template.mirror': ['鏡像', 'Mirror', 'ミラー', '미러', '镜像'],
    'template.columnSen': ['素筆直書', 'Plain Brush Vertical', '素筆の縦書き', '담백한 세로쓰기', '素笔竖排'],
    'template.columnFuda': ['字札直書', 'Card Vertical', '字札の縦書き', '글패 세로쓰기', '字札竖排'],
    'guide.ffmpegDownload': ['下載 FFmpeg', 'Download FFmpeg', 'FFmpeg をダウンロード', 'FFmpeg 다운로드', '下载 FFmpeg'],
    'guide.ffmpegRecheck': ['重新檢查', 'Recheck', '再確認', '다시 확인', '重新检查'],
    'guide.ffmpegChecking': ['FFmpeg 檢查中…', 'Checking FFmpeg…', 'FFmpeg を確認中…', 'FFmpeg 확인 중…', '正在检查 FFmpeg…'],
    'guide.ffmpegDownloadingButton': ['下載中…（約 100MB，請稍候）', 'Downloading… (about 100 MB; please wait)', 'ダウンロード中…（約100 MB、しばらくお待ちください）', '다운로드 중… (약 100MB, 잠시 기다려 주세요)', '下载中…（约 100 MB，请稍候）'],
    'guide.ffmpegDownloadingProgress': ['下載中… {percent}%（{downloaded}/{total} MB，{speed} MB/s）', 'Downloading… {percent}% ({downloaded}/{total} MB, {speed} MB/s)', 'ダウンロード中… {percent}%（{downloaded}/{total} MB、{speed} MB/s）', '다운로드 중… {percent}% ({downloaded}/{total} MB, {speed} MB/s)', '下载中… {percent}%（{downloaded}/{total} MB，{speed} MB/s）'],
    'guide.ffmpegDownloading': ['FFmpeg 下載中…', 'Downloading FFmpeg…', 'FFmpeg をダウンロード中…', 'FFmpeg 다운로드 중…', '正在下载 FFmpeg…'],
    'guide.ffmpegDownloadFailed': ['FFmpeg 下載失敗', 'FFmpeg download failed', 'FFmpeg のダウンロードに失敗しました', 'FFmpeg 다운로드에 실패했습니다', 'FFmpeg 下载失败'],
    'guide.ffmpegDownloadFailedWithError': ['FFmpeg 下載失敗：{error}', 'FFmpeg download failed: {error}', 'FFmpeg のダウンロードに失敗しました：{error}', 'FFmpeg 다운로드 실패: {error}', 'FFmpeg 下载失败：{error}'],
    'guide.downloadFailed': ['下載失敗', 'Download failed', 'ダウンロードに失敗しました', '다운로드에 실패했습니다', '下载失败'],
    'tour.welcome.kicker': ['3～5 分鐘快速導覽', '3–5 minute quick tour', '3～5分のクイックツアー', '3~5분 빠른 둘러보기', '3～5 分钟快速导览'],
    'tour.welcome.title': ['第一次使用 Elitesand Pro？', 'New to Elitesand Pro?', 'Elitesand Pro は初めてですか？', 'Elitesand Pro가 처음이신가요?', '第一次使用 Elitesand Pro？'],
    'tour.welcome.body': ['跟著畫面完成一次基本流程：加入歌曲、播放、確認歌詞，再了解如何放進 OBS。', 'Follow the screen through the basics: add a song, play it, confirm the lyrics, then learn how to add them to OBS.', '画面に沿って、曲の追加、再生、歌詞の確認、OBSへの追加まで基本の流れを体験します。', '화면 안내에 따라 곡 추가, 재생, 가사 확인, OBS 추가까지 기본 흐름을 완료합니다.', '跟随画面完成一次基本流程：添加歌曲、播放、确认歌词，再了解如何放进 OBS。'],
    'tour.welcome.pointOne': ['畫面會直接高亮現在要操作的位置', 'The current control is highlighted on screen', '操作する場所が画面上で直接ハイライトされます', '지금 조작할 위치를 화면에서 바로 강조합니다', '画面会直接高亮当前要操作的位置'],
    'tour.welcome.pointTwo': ['可以先用示範歌詞，不必準備歌曲', 'Use sample lyrics if you do not have a song ready', '曲がなくてもサンプル歌詞で始められます', '곡이 없어도 샘플 가사로 시작할 수 있습니다', '可以先用示范歌词，不必准备歌曲'],
    'tour.welcome.pointThree': ['中途離開後可以從原步驟繼續', 'Leave anytime and resume from the same step', '途中で閉じても同じ手順から再開できます', '중간에 나가도 같은 단계부터 이어서 할 수 있습니다', '中途离开后可以从原步骤继续'],
    'tour.welcome.start': ['開始互動導覽', 'Start interactive tour', '操作ツアーを開始', '대화형 둘러보기 시작', '开始互动导览'],
    'tour.guide.review': ['重新觀看新手導覽', 'Replay beginner tour', '初心者ツアーをもう一度見る', '초보자 둘러보기 다시 보기', '重新观看新手导览'],
    'tour.welcome.resume': ['繼續上次的導覽', 'Resume the tour', '前回のツアーを再開', '이전 둘러보기 계속', '继续上次的导览'],
    'tour.welcome.fullGuide': ['閱讀完整教學', 'Read the full guide', '詳しいガイドを読む', '전체 가이드 읽기', '阅读完整教学'],
    'tour.welcome.later': ['先自己探索', 'Explore on my own', 'まず自分で試す', '먼저 직접 둘러보기', '先自己探索'],
    'tour.progress': ['第 {current} 步，共 {total} 步', 'Step {current} of {total}', '{total} ステップ中 {current}', '{total}단계 중 {current}단계', '第 {current} 步，共 {total} 步'],
    'tour.back': ['上一步', 'Back', '戻る', '이전', '上一步'],
    'tour.next': ['下一步', 'Next', '次へ', '다음', '下一步'],
    'tour.finish': ['完成導覽', 'Finish tour', 'ツアーを完了', '둘러보기 완료', '完成导览'],
    'tour.leave.label': ['暫時離開', 'Leave for now', '一時中断', '잠시 나가기', '暂时离开'],
    'tour.leave.title': ['暫時離開導覽？', 'Leave the tour for now?', 'ツアーを一時中断しますか？', '둘러보기를 잠시 중단할까요?', '暂时离开导览？'],
    'tour.leave.body': ['目前進度會保留，下次可以從同一步繼續。', 'Your progress will be saved so you can resume from this step.', '進行状況は保存され、次回この手順から再開できます。', '현재 진행 상황이 저장되어 다음에 이 단계부터 계속할 수 있습니다.', '当前进度会保留，下次可以从同一步继续。'],
    'tour.leave.resume': ['繼續導覽', 'Continue tour', 'ツアーを続ける', '둘러보기 계속', '继续导览'],
    'tour.leave.confirm': ['暫時離開', 'Leave for now', '一時中断する', '잠시 나가기', '暂时离开'],
    'tour.viewportTooSmall.kicker': ['導覽已暫停', 'Tour paused', 'ツアーを一時停止', '둘러보기 일시 정지', '导览已暂停'],
    'tour.viewportTooSmall.title': ['請把視窗拉大後繼續', 'Enlarge the window to continue', 'ウィンドウを広げて続行してください', '창을 키운 뒤 계속하세요', '请放大窗口后继续'],
    'tour.viewportTooSmall.body': ['目前沒有足夠空間同時顯示操作區與導覽卡。請把視窗拉大；安全基準為 {width} × {height}。達到足夠空間後會自動回到目前步驟。', 'There is not enough room to show both the control and the tour card. Enlarge the window; the safe baseline is {width} × {height}. The tour will return to this step automatically once there is enough room.', '操作箇所とツアーカードを同時に表示する空間が足りません。安全基準は {width} × {height} です。十分な空間になると、この手順へ自動的に戻ります。', '조작 영역과 둘러보기 카드를 함께 표시할 공간이 부족합니다. 안전 기준은 {width} × {height}이며, 공간이 충분해지면 현재 단계로 자동 복귀합니다.', '当前空间不足以同时显示操作区域和导览卡。安全基准为 {width} × {height}；空间足够后会自动返回当前步骤。'],
    'tour.viewportTooSmall.current': ['目前可用空間：{width} × {height}', 'Current space: {width} × {height}', '現在の表示領域：{width} × {height}', '현재 사용 가능 공간: {width} × {height}', '当前可用空间：{width} × {height}'],
    'tour.viewportTooSmall.skip': ['跳過這一步', 'Skip this step', 'この手順をスキップ', '이 단계 건너뛰기', '跳过这一步'],
    'tour.complete.kicker': ['基本操作完成', 'Basics complete', '基本操作が完了', '기본 조작 완료', '基本操作完成'],
    'tour.complete.title': ['第一個歌詞畫面已準備好', 'Your first lyrics screen is ready', '最初の歌詞画面が準備できました', '첫 가사 화면이 준비되었습니다', '第一个歌词画面已准备好'],
    'tour.complete.body': ['你已經知道如何加入歌曲、播放、確認歌詞、調整外觀並接到 OBS。其他功能可以在需要時再學。', 'You now know how to add a song, play it, confirm the lyrics, adjust the look, and connect it to OBS. Learn the other features when you need them.', '曲の追加、再生、歌詞の確認、見た目の調整、OBSへの接続まで理解できました。ほかの機能は必要になったときに学べます。', '곡 추가, 재생, 가사 확인, 화면 조정, OBS 연결 방법을 익혔습니다. 다른 기능은 필요할 때 배울 수 있습니다.', '你已经知道如何添加歌曲、播放、确认歌词、调整外观并连接到 OBS。其他功能可以在需要时再学习。'],
    'tour.complete.use': ['開始使用', 'Start using Elitesand Pro', '使い始める', '사용 시작', '开始使用'],
    'tour.complete.advanced': ['查看進階導覽', 'View advanced tour', '上級ツアーを見る', '고급 둘러보기', '查看进阶导览'],
    'tour.complete.fullGuide': ['閱讀完整教學', 'Read the full guide', '詳しいガイドを読む', '전체 가이드 읽기', '阅读完整教学'],
    'tour.advanced.entry.kicker': ['進階互動教學 · 約 7 分鐘', 'Advanced interactive tour · about 7 minutes', '上級操作ツアー・約7分', '고급 대화형 둘러보기 · 약 7분', '进阶互动教学 · 约 7 分钟'],
    'tour.advanced.entry.title': ['修正歌詞同步、接好 OBS，再熟悉直播現場操作', 'Fix lyrics timing, connect OBS, and get comfortable running the live show', '歌詞の同期を直し、OBSを接続して、配信本番の操作にも慣れましょう', '가사 싱크를 맞추고 OBS를 연결한 뒤, 라이브 방송 운영에도 익숙해지기', '修正歌词同步、接好 OBS，再熟悉直播现场操作'],
    'tour.advanced.entry.body': ['分成「歌詞來源與同步」「OBS 連接」和「直播現場操作」三章；可以只學現在需要的部分。', 'Split into three chapters — Lyrics Sources & Timing, OBS Connection, and Running the Live Show — so you can learn only what you need right now.', '「歌詞ソースと同期」「OBS接続」「配信本番の操作」の3章に分かれており、今必要な部分だけ学べます。', '‘가사 소스와 싱크’, ‘OBS 연결’, ‘라이브 방송 운영’ 세 장으로 나뉘어 있어 지금 필요한 부분만 배울 수 있습니다.', '分为“歌词来源与同步”“OBS 连接”和“直播现场操作”三章；可以只学习现在需要的部分。'],
    'tour.advanced.entry.badge': ['可隨時離開並續接', 'Leave and resume anytime', 'いつでも中断・再開できます', '언제든 나갔다가 이어서 진행', '可随时离开并继续'],
    'tour.advanced.entry.start': ['開始進階導覽', 'Start advanced tour', '上級ツアーを開始', '고급 둘러보기 시작', '开始进阶导览'],
    'tour.advanced.entry.lyrics': ['歌詞來源與同步', 'Lyrics sources & timing', '歌詞ソースと同期', '가사 소스와 싱크', '歌词来源与同步'],
    'tour.advanced.entry.obs': ['OBS 連接', 'OBS connection', 'OBS接続', 'OBS 연결', 'OBS 连接'],
    'tour.advanced.entry.live': ['直播現場操作', 'Running the live show', '配信本番の操作', '라이브 방송 운영', '直播现场操作'],
    'tour.advanced.lyricsComplete.kicker': ['歌詞同步章完成', 'Lyrics timing chapter complete', '歌詞同期編が完了', '가사 싱크 장 완료', '歌词同步章节完成'],
    'tour.advanced.lyricsComplete.title': ['你已知道該用哪一種校時方式', 'You know which timing fix to use', '状況に合うタイミング修正を選べます', '상황에 맞는 싱크 조정 방법을 익혔습니다', '你已知道该使用哪种校时方式'],
    'tour.advanced.lyricsComplete.body': ['整首偏移先對齊第一句，只有局部跑掉才逐行修正。之後可繼續學 OBS 連接，或回控制台使用。', 'Align the first line when the whole song is offset; edit individual lines only when timing drifts locally. Continue to OBS or return to the panel.', '曲全体のずれは最初の行で合わせ、一部だけのずれは行ごとに直します。次はOBS接続へ進むか、操作画面へ戻れます。', '전체가 어긋나면 첫 소절을 맞추고 일부만 어긋나면 줄별로 수정하세요. OBS 연결을 계속 배우거나 제어판으로 돌아갈 수 있습니다.', '整首偏移先对齐第一句，只有局部偏移才逐行修正。之后可继续学习 OBS 连接，或返回控制面板。'],
    'tour.advanced.obsComplete.kicker': ['OBS 連接章完成', 'OBS connection chapter complete', 'OBS接続編が完了', 'OBS 연결 장 완료', 'OBS 连接章节完成'],
    'tour.advanced.obsComplete.title': ['你已知道如何加入並驗證歌詞來源', 'You know how to add and verify the lyrics source', '歌詞ソースの追加と確認方法を理解できました', '가사 소스를 추가하고 확인하는 방법을 익혔습니다', '你已知道如何添加并验证歌词来源'],
    'tour.advanced.obsComplete.body': ['記得以右上角「歌詞已連線」判斷 OBS 是否真的在讀取；需要時可從側欄「教學」再次開啟。', 'Use the Lyrics Connected indicator at the top right to confirm OBS is really loading the source. Reopen this chapter from Help anytime.', '右上の「歌詞接続済み」でOBSが実際に読み込んでいるか確認します。必要なときはガイドから再開できます。', '오른쪽 위 ‘가사 연결됨’ 상태로 OBS가 실제로 소스를 읽는지 확인하세요. 필요할 때 도움말에서 다시 열 수 있습니다.', '请通过右上角“歌词已连接”确认 OBS 是否真正读取来源；需要时可从侧栏“教学”再次打开。'],
    'tour.advanced.liveComplete.kicker': ['直播現場操作章完成', 'Running the live show chapter complete', '配信本番操作編が完了', '라이브 방송 운영 장 완료', '直播现场操作章节完成'],
    'tour.advanced.liveComplete.title': ['你已知道現場常用的操作在哪裡', 'You know where the day-to-day live controls are', '本番でよく使う操作の場所がわかりました', '방송 중 자주 쓰는 조작 위치를 알게 되었습니다', '你已知道现场常用的操作在哪里'],
    'tour.advanced.liveComplete.body': ['直播歌單、刪已唱歌曲、開新場次、YouTube 章節、Twitch 連線都找得到了；需要時可從側欄「教學」再次開啟這一章。', 'You can now find the live setlist, deleting played songs, starting a new session, YouTube chapters, and Twitch connection. Reopen this chapter anytime from Help in the sidebar.', '配信歌単、再生済み曲の削除、新しいセッションの開始、YouTubeチャプター、Twitch連携の場所がわかりました。必要なときはサイドバーの「ガイド」からいつでもこの章を開き直せます。', '라이브 세트리스트, 재생 완료곡 삭제, 새 세션 시작, YouTube 챕터, Twitch 연결 위치를 모두 알게 되었습니다. 필요할 때 사이드바의 ‘가이드’에서 언제든 이 장을 다시 열 수 있습니다.', '直播歌单、删已唱歌曲、开新场次、YouTube 章节、Twitch 连接都能找到了；需要时可从侧栏“教学”再次打开这一章。'],
    'tour.advanced.complete.nextObs': ['繼續 OBS 連接教學', 'Continue to OBS connection', 'OBS接続へ進む', 'OBS 연결 계속하기', '继续 OBS 连接教学'],
    'tour.advanced.step.lyricsSource.title': ['先確認歌詞來源', 'Confirm the lyrics source first', 'まず歌詞ソースを確認', '먼저 가사 소스 확인', '先确认歌词来源'],
    'tour.advanced.step.lyricsSource.body': ['「選擇來源」可搜尋並套用歌詞；手上已有 LRC、SRT 或純文字時，可直接用「貼上歌詞」。', 'Choose Source searches for and applies lyrics. If you already have LRC, SRT, or plain text, use Paste Lyrics instead.', '「ソースを選択」で歌詞を検索して適用できます。LRC、SRT、テキストがある場合は「歌詞を貼り付け」を使います。', '‘소스 선택’에서 가사를 검색해 적용할 수 있습니다. LRC, SRT 또는 일반 텍스트가 있다면 ‘가사 붙여넣기’를 사용하세요.', '“选择来源”可搜索并应用歌词；如果已有 LRC、SRT 或纯文本，可直接使用“粘贴歌词”。'],
    'tour.advanced.step.lyricsSource.hint': ['按鈕會開啟原本的歌詞視窗；視窗開啟時導覽會暫時隱藏，關閉後回到同一步。', 'These buttons open the existing lyrics dialogs. The tour pauses while a dialog is open and returns to this step when it closes.', 'ボタンを押すと既存の歌詞画面が開きます。開いている間はツアーが一時停止し、閉じると同じ手順へ戻ります。', '버튼을 누르면 기존 가사 창이 열립니다. 창이 열려 있는 동안 둘러보기가 잠시 숨고, 닫으면 같은 단계로 돌아옵니다.', '按钮会打开原有歌词窗口；窗口打开时导览会暂时隐藏，关闭后回到同一步。'],
    'tour.advanced.step.lyricsAlign.title': ['用第一句校正整首時間', 'Align the whole song from the first line', '最初の1行で曲全体を補正', '첫 소절로 전체 시간 맞추기', '用第一句校正整首时间'],
    'tour.advanced.step.lyricsAlign.body': ['播放歌曲，聽到第一句應該開始唱的瞬間按「對齊第一句」，系統會把整首歌詞一起前移或後移。', 'Play the song and press Align First Line exactly when the first line should begin. The whole lyrics timeline shifts together.', '曲を再生し、最初の歌詞を歌い始める瞬間に「最初の行に合わせる」を押すと、歌詞全体がまとめて移動します。', '곡을 재생하고 첫 소절을 불러야 하는 순간 ‘첫 소절 맞추기’를 누르면 전체 가사 시간이 함께 이동합니다.', '播放歌曲，在第一句应该开始唱的瞬间点击“对齐第一句”，系统会整体前移或后移歌词时间。'],
    'tour.advanced.step.lyricsAlign.hint': ['這適合「整首都同樣提早或延遲」；歌曲尚未播放時先不要按。', 'Use this when the whole song is early or late by the same amount. Do not press it before playback starts.', '曲全体が同じだけ早い／遅いときに使います。再生前には押さないでください。', '곡 전체가 같은 만큼 빠르거나 느릴 때 사용합니다. 재생 전에는 누르지 마세요.', '适合“整首都同样提前或延迟”的情况；歌曲尚未播放时先不要点击。'],
    'tour.advanced.step.lyricsNudge.title': ['只差一點時小幅微調', 'Nudge small timing differences', '少しのずれは微調整', '조금 어긋날 때 미세 조정', '只差一点时小幅微调'],
    'tour.advanced.step.lyricsNudge.body': ['用 ±0.1 秒修正小誤差，±0.5 秒做較大調整；每按一次就看右側預覽確認。', 'Use ±0.1 seconds for small errors and ±0.5 seconds for larger ones. Check the preview after each adjustment.', '小さなずれは±0.1秒、大きめのずれは±0.5秒で調整し、押すたびにプレビューを確認します。', '작은 오차는 ±0.1초, 큰 오차는 ±0.5초로 조정하고 누를 때마다 미리보기를 확인하세요.', '用 ±0.1 秒修正小误差，±0.5 秒进行较大调整；每次点击后查看右侧预览确认。'],
    'tour.advanced.step.lyricsNudge.hint': ['先用 0.1 秒，避免一次調過頭；歸零可取消整首偏移。', 'Start with 0.1 seconds to avoid overshooting. Reset removes the whole-song offset.', 'まず0.1秒から試すと調整しすぎを防げます。「リセット」で曲全体の補正を解除できます。', '먼저 0.1초로 조정해 과도하게 바꾸지 마세요. 초기화하면 전체 오프셋을 취소합니다.', '先使用 0.1 秒，避免一次调整过头；归零可取消整首偏移。'],
    'tour.advanced.step.lyricsTimeline.title': ['只有局部跑掉才逐行調整', 'Edit individual lines only when timing drifts', '一部だけずれる場合は行ごとに調整', '일부만 어긋날 때 줄별 조정', '只有局部偏移才逐行调整'],
    'tour.advanced.step.lyricsTimeline.body': ['如果開頭正確、但中段某幾句逐漸不同步，才使用「逐行時間軸編輯」修改特定句子的時間點。', 'If the beginning is correct but some later lines drift out of sync, use Timeline Editor to adjust only those timestamps.', '冒頭は合っていて途中の数行だけずれる場合に、「行ごとのタイムライン編集」で該当箇所だけ直します。', '시작은 맞지만 중간 일부 가사만 점점 어긋날 때 ‘줄별 타임라인 편집’으로 해당 시간만 수정하세요.', '如果开头正确，但中间某几句逐渐不同步，才使用“逐行时间轴编辑”修改特定句子的时间点。'],
    'tour.advanced.step.lyricsTimeline.hint': ['先做第一句對齊，再做逐行修正，通常會省很多時間。', 'Align the first line before editing individual lines; it usually saves a lot of work.', '先に最初の行を合わせ、その後で行ごとに直すと作業を減らせます。', '먼저 첫 소절을 맞춘 뒤 줄별로 수정하면 시간을 많이 아낄 수 있습니다.', '先对齐第一句，再做逐行修正，通常会节省很多时间。'],
    'tour.advanced.step.obsStatus.title': ['先看來源是否真的連上', 'Check whether the source is really connected', 'ソースが実際に接続済みか確認', '소스가 실제로 연결됐는지 확인', '先看来源是否真正连接'],
    'tour.advanced.step.obsStatus.body': ['這兩個狀態分別代表 OBS 的歌詞與歌單頁面是否正在讀取；複製網址不等於已連線。', 'These indicators show whether OBS is actively loading the lyrics and setlist pages. Copying a URL does not mean it is connected.', 'この2つはOBSが歌詞／セットリスト画面を実際に読み込んでいるかを示します。URLのコピーだけでは接続済みになりません。', '두 상태는 OBS가 가사와 세트리스트 페이지를 실제로 읽는지 보여 줍니다. URL 복사만으로 연결된 것은 아닙니다.', '这两个状态分别表示 OBS 是否正在读取歌词与歌单页面；复制网址不等于已连接。'],
    'tour.advanced.step.obsStatus.hint': ['OBS 開啟對應瀏覽器來源後，狀態才會變成已連線；尚未開 OBS 也可以繼續了解設定。', 'The status changes only after OBS opens the matching Browser Source. You can continue learning even if OBS is not open yet.', 'OBSが対応するブラウザソースを開くと接続済みに変わります。OBSが未起動でも案内は続けられます。', 'OBS에서 해당 브라우저 소스를 열어야 연결됨으로 바뀝니다. OBS를 아직 열지 않아도 안내를 계속 볼 수 있습니다.', 'OBS 打开对应浏览器来源后，状态才会变为已连接；尚未打开 OBS 也可以继续了解设置。'],
    'tour.advanced.step.obsCopy.title': ['只複製歌詞網址', 'Copy only the lyrics URL', '歌詞URLだけをコピー', '가사 URL만 복사하기', '只复制歌词网址'],
    'tour.advanced.step.obsCopy.body': ['按「複製」取得 /display 網址；不要把控制面板的網址貼進 OBS。', 'Press Copy to get the /display URL. Do not paste the control-panel URL into OBS.', '「コピー」で/display URLを取得します。操作画面のURLをOBSへ貼らないでください。', '‘복사’를 눌러 /display URL을 가져오세요. 제어판 URL을 OBS에 붙여 넣지 마세요.', '点击“复制”获取 /display 网址；不要把控制面板网址粘贴到 OBS。'],
    'tour.advanced.step.obsCopy.hint': ['換歌、換模板或重開程式都不用更換這個網址。', 'The URL stays the same when you change songs, templates, or restart the app.', '曲やテンプレートを変えたりアプリを再起動したりしてもURLは変わりません。', '곡이나 템플릿을 바꾸거나 앱을 다시 실행해도 URL은 그대로입니다.', '切歌、更换模板或重启程序都无需更换这个网址。'],
    'tour.advanced.step.obsUrl.title': ['手動加入 OBS 的穩定方式', 'The reliable manual OBS setup', 'OBSへ手動で追加する確実な方法', 'OBS에 수동으로 추가하는 안정적인 방법', '手动添加 OBS 的稳定方式'],
    'tour.advanced.step.obsUrl.body': ['複製歌詞畫面的 /display 網址，在 OBS 新增「瀏覽器」來源後貼上。切歌、換模板或重開程式都不必更換網址。', 'Copy the /display URL, add a Browser Source in OBS, and paste it. You do not need a new URL when changing songs, templates, or restarting the app.', '歌詞画面の/display URLをコピーし、OBSで「ブラウザ」ソースを追加して貼り付けます。曲やテンプレートを変えたりアプリを再起動したりしてもURLは同じです。', '/display URL을 복사해 OBS에 ‘브라우저’ 소스를 추가하고 붙여 넣으세요. 곡이나 템플릿을 바꾸거나 앱을 다시 실행해도 URL은 그대로입니다.', '复制歌词画面的 /display 网址，在 OBS 新增“浏览器”来源后粘贴。切歌、更换模板或重启程序都无需更换网址。'],
    'tour.advanced.step.obsUrl.hint': ['建議寬高設成 OBS 畫布尺寸；透明背景由歌詞頁處理，不需要色度鍵。', 'Set the source size to the OBS canvas. The lyrics page already has transparency, so no chroma key is needed.', '幅と高さはOBSキャンバスに合わせます。歌詞画面は透過済みなのでクロマキーは不要です。', '크기와 높이를 OBS 캔버스에 맞추세요. 가사 페이지는 이미 투명하므로 크로마 키가 필요 없습니다.', '建议宽高设为 OBS 画布尺寸；透明背景由歌词页处理，不需要色度键。'],
    'tour.advanced.step.obsWebSocket.title': ['WebSocket 是選配的捷徑', 'WebSocket is an optional shortcut', 'WebSocketは任意のショートカット', 'WebSocket은 선택형 단축 경로', 'WebSocket 是可选捷径'],
    'tour.advanced.step.obsWebSocket.body': ['先在 OBS「工具 → WebSocket 伺服器設定」啟用服務，再於這裡填入位址、4455 埠與密碼後連線。密碼只保存在本機。', 'Enable the WebSocket server in OBS under Tools first, then enter the address, port 4455, and password here. The password stays on this device.', 'OBSの「ツール → WebSocketサーバー設定」で有効にしてから、ここへアドレス、4455番ポート、パスワードを入力します。パスワードは端末内だけに保存されます。', 'OBS의 ‘도구 → WebSocket 서버 설정’에서 먼저 활성화한 뒤 주소, 4455 포트, 비밀번호를 입력하세요. 비밀번호는 이 기기에만 저장됩니다.', '先在 OBS“工具 → WebSocket 服务器设置”启用服务，再在这里填写地址、4455 端口与密码。密码只保存在本机。'],
    'tour.advanced.step.obsWebSocket.hint': ['不想開 WebSocket 時，上一個手動貼網址的方法就已足夠。', 'If you do not want to enable WebSocket, the manual URL method from the previous step is enough.', 'WebSocketを使わない場合は、前の手順のURLを貼る方法だけで十分です。', 'WebSocket을 사용하지 않아도 이전 단계의 URL 수동 입력 방식이면 충분합니다.', '不想启用 WebSocket 时，上一步手动粘贴网址的方法已经足够。'],
    'tour.advanced.step.obsCreate.title': ['連線後才一鍵建立來源', 'Create sources only after connecting', '接続後にソースを一括作成', '연결 후 소스 한 번에 만들기', '连接后再一键创建来源'],
    'tour.advanced.step.obsCreate.body': ['按鈕可用時，會在目前 OBS 場景建立歌詞與歌單兩個瀏覽器來源；導覽只說明位置，不會代替你執行。', 'When enabled, this creates lyrics and setlist Browser Sources in the current OBS scene. The tour only points it out and never runs it for you.', 'ボタンが有効なとき、現在のOBSシーンへ歌詞とセットリストのブラウザソースを作成します。ツアーが代わりに実行することはありません。', '버튼이 활성화되면 현재 OBS 장면에 가사와 세트리스트 브라우저 소스를 만듭니다. 둘러보기는 위치만 안내하며 대신 실행하지 않습니다.', '按钮可用时，会在当前 OBS 场景创建歌词与歌单两个浏览器来源；导览只说明位置，不会替你执行。'],
    'tour.advanced.step.obsCreate.hint': ['建立後回到上方狀態確認「歌詞已連線」；若失敗，手動網址方式仍可使用。', 'After creating them, confirm that Lyrics shows Connected above. If creation fails, the manual URL method still works.', '作成後は上の状態で「歌詞接続済み」を確認します。失敗しても手動URL方式を使えます。', '만든 뒤 위 상태에서 ‘가사 연결됨’을 확인하세요. 실패해도 수동 URL 방식은 계속 사용할 수 있습니다.', '创建后回到上方状态确认“歌词已连接”；若失败，仍可使用手动网址方式。'],
    'tour.advanced.step.liveSetlist.title': ['直播歌單是另一個 OBS 來源', 'The live setlist is a separate OBS source', '配信歌単はOBSの別ソースです', '라이브 세트리스트는 별도의 OBS 소스입니다', '直播歌单是另一个 OBS 来源'],
    'tour.advanced.step.liveSetlist.body': ['跟歌詞來源分開，這裡輸出現在播放、待唱、已唱的清單畫面給觀眾看。左邊選一個模板套用，下面這個網址貼到 OBS 的瀏覽器來源即可；之後在這裡換模板、調設定都會即時套用，不用重新貼網址。', 'Separate from the lyrics source, this outputs a now-playing / upcoming / played list for viewers. Pick a template on the left, then paste the URL below into an OBS Browser Source. Switching templates or settings later applies live — you never need to re-paste the URL.', '歌詞ソースとは別に、現在再生中・待機中・再生済みの一覧を視聴者向けに出力します。左でテンプレートを選び、下のURLをOBSのブラウザソースに貼り付けてください。以降テンプレートや設定を変えても即時反映され、URLを貼り直す必要はありません。', '가사 소스와는 별개로, 지금 재생 중·대기 중·재생 완료 목록을 시청자에게 보여줍니다. 왼쪽에서 템플릿을 고르고 아래 URL을 OBS 브라우저 소스에 붙여 넣으세요. 이후 템플릿이나 설정을 바꿔도 즉시 반영되므로 URL을 다시 붙일 필요가 없습니다.', '跟歌词来源是分开的，这里输出现在播放、待唱、已唱的清单画面给观众看。左边选一个模板套用，下面这个网址粘贴到 OBS 的浏览器来源即可；之后在这里换模板、调设置都会即时套用，不用重新粘贴网址。'],
    'tour.advanced.step.liveSetlist.hint': ['想調整字體、邊框、動畫這些細節，按下面的「開啟詳細設定…」。', 'For fonts, borders, or animation details, use “Open detailed settings…” below.', 'フォントや枠線、アニメーションなど細部の調整は、下の「詳細設定を開く…」から行えます。', '글꼴, 테두리, 애니메이션 같은 세부 설정은 아래 ‘상세 설정 열기…’에서 조정하세요.', '想调整字体、边框、动画这些细节，点下面的“打开详细设置…”。'],
    'tour.advanced.step.liveDeletePlayed.title': ['已唱歌曲要去哪裡刪', 'Where to delete already-played songs', '歌い終わった曲はどこで削除する？', '이미 부른 곡은 어디서 삭제하나요', '已唱歌曲要去哪里删'],
    'tour.advanced.step.liveDeletePlayed.body': ['篩選選單選「已唱」，先篩出唱過的歌；接著按清單右上角的「選取」，勾選要刪的幾首，再按「移除已選」一次清掉。正在播放的歌曲不會被選進去，不用擔心手滑砍到現在這首。', 'Set the filter to “Played” to show songs you’ve already sung, then click “Select” at the top right, check the ones to remove, and click “Remove selected” to clear them at once. The current track is excluded from selection, so you won’t accidentally delete it.', 'フィルターで「再生済み」を選び、歌い終わった曲だけを表示します。右上の「選択」を押し、削除したい曲にチェックを入れて「選択項目を削除」でまとめて消せます。再生中の曲は選択対象に入らないので誤って消す心配はありません。', '필터에서 ‘재생 완료’를 선택해 이미 부른 곡만 걸러내세요. 오른쪽 위 ‘선택’을 누르고 지울 곡에 체크한 뒤 ‘선택 항목 삭제’를 누르면 한 번에 지워집니다. 지금 재생 중인 곡은 선택 대상에서 제외되므로 실수로 지울 걱정은 없습니다.', '筛选菜单选“已唱”，先筛出唱过的歌；接着点清单右上角的“选取”，勾选要删的几首，再点“移除已选”一次清掉。正在播放的歌曲不会被选中，不用担心手滑删到现在这首。'],
    'tour.advanced.step.liveDeletePlayed.hint': ['只想砍這一場的統計、保留播放清單本身，用下一步的「開始新場次」更快。', 'To reset this stream’s tally while keeping the playlist itself, the “Start new session” button in the next step is faster.', 'このライブの集計だけリセットしてプレイリスト自体は残したいなら、次のステップの「新しいセッションを開始」の方が早いです。', '이번 방송 집계만 초기화하고 재생목록 자체는 남기고 싶다면, 다음 단계의 ‘새 세션 시작’이 더 빠릅니다.', '只想清空这一场的统计、保留播放列表本身，用下一步的“开始新场次”更快。'],
    'tour.advanced.step.liveSession.title': ['場次控制與 YouTube 章節', 'Session controls & YouTube chapters', 'セッション操作とYouTubeチャプター', '세션 제어와 YouTube 챕터', '场次控制与 YouTube 章节'],
    'tour.advanced.step.liveSession.body': ['「開始新場次」會清空這場的已唱紀錄和播放清單，重新計數；平常不太需要手動按，開台／收台多半由 OBS WebSocket 自動判斷。想確認唱了幾首，或直播結束後要在 YouTube 影片說明欄放時間戳記，按「查看本場紀錄」——裡面的「已唱歌曲」清單旁邊有「複製 YouTube 章節」按鈕，一次複製整場的時間軸。', '“Start new session” clears this stream’s played history and playlist to restart the count — you rarely need to click it, since going live/offline is usually detected automatically via OBS WebSocket. To check how many songs you’ve sung, or to get a timestamp list for a YouTube video description after streaming, click “View session record” — next to the “Played songs” list there’s a “Copy YouTube chapters” button that copies the whole timeline at once.', '「新しいセッションを開始」はこのライブの再生済み履歴とプレイリストをクリアしてカウントをリセットします。配信の開始・終了は通常OBS WebSocketが自動検知するため、手動で押す機会はあまりありません。何曲歌ったか確認したいときや、配信後にYouTubeの概要欄へ入れるタイムスタンプが欲しいときは「セッション記録を見る」を押してください。「再生済みの曲」リストの横にある「YouTubeチャプターをコピー」ボタンで、全体のタイムラインを一括コピーできます。', '‘새 세션 시작’은 이번 방송의 재생 완료 기록과 재생목록을 지우고 다시 세기 시작합니다. 방송 시작/종료는 보통 OBS WebSocket이 자동으로 감지하므로 직접 누를 일은 많지 않습니다. 몇 곡을 불렀는지 확인하거나 방송 후 YouTube 설명란에 넣을 타임스탬프가 필요하면 ‘세션 기록 보기’를 누르세요. ‘재생한 곡’ 목록 옆의 ‘YouTube 챕터 복사’ 버튼으로 전체 타임라인을 한 번에 복사할 수 있습니다.', '“开始新场次”会清空这一场的已唱记录和播放列表，重新计数；平时不太需要手动点，开播/下播大多由 OBS WebSocket 自动判断。想确认唱了几首，或者直播结束后要在 YouTube 视频简介放时间戳，点“查看本场记录”——里面“已唱歌曲”清单旁边有“复制 YouTube 章节”按钮，一次复制整场的时间轴。'],
    'tour.advanced.step.liveSession.hint': ['這裡的「已唱」是這場直播的紀錄，跟播放清單裡歌曲卡片上的「已唱」狀態是兩回事——清單裡要刪歌用上一步教的篩選＋選取方式。', '“Played” here refers to this stream’s log — it’s separate from the “Played” status shown on playlist cards. To delete songs from the playlist itself, use the filter + select method from the previous step.', 'ここでの「再生済み」はこのライブの記録であり、プレイリストのカード上に出る「再生済み」ステータスとは別物です。プレイリストから曲を削除するには、前のステップで説明したフィルター＋選択の方法を使ってください。', '여기서 ‘재생 완료’는 이번 방송의 기록이며, 재생목록 카드에 표시되는 ‘재생 완료’ 상태와는 다릅니다. 재생목록 자체에서 곡을 지우려면 이전 단계에서 설명한 필터 + 선택 방법을 사용하세요.', '这里的“已唱”是这场直播的记录，跟播放列表歌曲卡片上的“已唱”状态是两回事——列表里要删歌请用上一步教的筛选＋选取方式。'],
    'tour.advanced.step.liveTwitch.title': ['Twitch 連線在哪裡', 'Where to connect Twitch', 'Twitch連携はどこで行う？', 'Twitch 연결은 어디서 하나요', 'Twitch 连接在哪里'],
    'tour.advanced.step.liveTwitch.body': ['左側選單切到「連線與系統」，往下捲到「Twitch 開台／聊天室點歌」卡片，按「連接 Twitch」走官方登入完成授權；連上後才能開放觀眾用聊天室指令或忠誠點數點歌。已連接時同一顆按鈕會變成「解除 Twitch 授權」。「Twitch 點歌」那個分頁是連上之後用來看點歌狀態、暫停點歌的地方。', 'Switch to “Connection & System” in the sidebar and scroll down to the “Twitch Streaming / Chat Requests” card. Click “Connect Twitch” to authorize through Twitch’s official login; once connected, viewers can request songs via chat commands or channel points. The button becomes “Revoke Twitch Authorization” once connected. The separate “Twitch Requests” tab is where you manage requests and pause them after you’re connected.', '左側メニューを「接続とシステム」に切り替え、下にスクロールして「Twitch配信／チャットリクエスト」カードを開きます。「Twitchに接続」を押すとTwitch公式ログインで認証できます。接続すると、視聴者がチャットコマンドやチャンネルポイントでリクエストできるようになります。接続済みの場合、同じボタンが「Twitch認証を解除」に変わります。「Twitchリクエスト」タブは接続後にリクエストの状態確認や一時停止を行う場所です。', '왼쪽 메뉴를 ‘연결 및 시스템’으로 전환하고 아래로 스크롤해 ‘Twitch 방송/채팅 신청곡’ 카드를 찾으세요. ‘Twitch 연결’을 누르면 Twitch 공식 로그인으로 인증합니다. 연결되면 시청자가 채팅 명령어나 채널 포인트로 곡을 신청할 수 있습니다. 이미 연결된 상태라면 같은 버튼이 ‘Twitch 인증 해제’로 바뀝니다. 별도의 ‘Twitch 신청곡’ 탭은 연결 후 신청곡 상태를 확인하고 일시정지하는 곳입니다.', '左侧菜单切到“连接与系统”，往下滚动到“Twitch 开播／聊天室点歌”卡片，点“连接 Twitch”走官方登录完成授权；连上后观众才能用聊天室指令或忠诚点数点歌。已连接时同一个按钮会变成“解除 Twitch 授权”。“Twitch 点歌”那个分页是连上之后用来看点歌状态、暂停点歌的地方。'],
    'tour.advanced.step.liveTwitch.hint': ['沒有要開放觀眾點歌的話，這張卡片可以完全跳過，不影響其他功能。', 'If you don’t need viewer song requests, you can skip this card entirely — it doesn’t affect anything else.', '視聴者リクエストを使わないなら、このカードは完全にスキップしても他の機能に影響しません。', '시청자 신청곡 기능이 필요 없다면 이 카드는 완전히 건너뛰어도 다른 기능에는 영향이 없습니다.', '不打算开放观众点歌的话，这张卡片可以完全跳过，不影响其他功能。'],
    'tour.step.navigation.title': ['這是控制面板', 'This is the control panel', 'ここがコントロールパネルです', '여기가 제어판입니다', '这是控制面板'],
    'tour.step.navigation.body': ['你在這裡操作歌曲與歌詞，觀眾不會看見這個畫面。左側可切換首頁、媒體庫、歌詞設定、直播歌單與系統設定。', 'This is where you control songs and lyrics; viewers never see this screen. Use the left sidebar for Home, Library, Lyrics Settings, Live Setlist, and System Settings.', 'ここで曲と歌詞を操作します。この画面が視聴者に見えることはありません。左側からホーム、メディアライブラリ、歌詞設定、配信セットリスト、システム設定へ切り替えます。', '여기서 곡과 가사를 조작하며 시청자에게는 이 화면이 보이지 않습니다. 왼쪽에서 홈, 미디어 보관함, 가사 설정, 방송 세트리스트, 시스템 설정으로 이동합니다.', '你在这里操作歌曲与歌词，观众不会看到这个画面。左侧可切换首页、媒体库、歌词设置、直播歌单与系统设置。'],
    'tour.step.navigation.hint': ['先記住左側選單的位置，其他功能之後再慢慢認識。', 'Just remember where the sidebar is; you can learn the other features later.', 'まずは左側メニューの位置だけ覚えておけば大丈夫です。', '지금은 왼쪽 메뉴 위치만 기억하면 됩니다.', '先记住左侧菜单的位置，其他功能之后再慢慢了解。'],
    'tour.step.source.title': ['加入第一首歌', 'Add your first song', '最初の曲を追加', '첫 곡 추가하기', '添加第一首歌'],
    'tour.step.source.body': ['貼上 YouTube 網址，或切換到「本機檔案」加入電腦裡的音訊。現在只需要一首測試歌。', 'Paste a YouTube URL, or switch to Local Files to add audio from your computer. You only need one test song for now.', 'YouTube のURLを貼り付けるか、「ローカルファイル」へ切り替えてパソコン内の音声を追加します。今はテスト用の1曲だけで十分です。', 'YouTube URL을 붙여 넣거나 ‘로컬 파일’로 전환해 컴퓨터의 오디오를 추가하세요. 지금은 테스트 곡 한 곡이면 됩니다.', '粘贴 YouTube 网址，或切换到“本地文件”添加电脑里的音频。现在只需要一首测试歌曲。'],
    'tour.step.source.mobileBody': ['手機導覽先貼上 YouTube 網址並匯入；本機檔案可在導覽結束後切換分頁加入。', 'For this mobile tour, paste and import a YouTube URL. You can switch to Local Files after the tour.', 'モバイルツアーでは、まずYouTubeのURLを貼り付けて読み込みます。ローカルファイルはツアー終了後に切り替えられます。', '모바일 둘러보기에서는 YouTube URL을 붙여 넣어 가져오세요. 로컬 파일은 둘러보기 후에 전환할 수 있습니다.', '手机导览请先粘贴并导入 YouTube 网址；本地文件可在导览结束后切换分页添加。'],
    'tour.step.source.hint': ['手邊沒有歌曲也沒關係，按下方「先用示範歌詞」即可繼續。', 'No song ready? Choose “Use sample lyrics” below to continue.', '曲がなくても、下の「サンプル歌詞を使う」で続けられます。', '곡이 없다면 아래의 ‘샘플 가사 먼저 보기’를 눌러 계속하세요.', '手边没有歌曲也没关系，点击下方“先用示范歌词”即可继续。'],
    'tour.step.playlist.title': ['這是播放清單', 'This is the playlist', 'ここがプレイリストです', '여기가 재생목록입니다', '这是播放列表'],
    'tour.step.playlist.body': ['加入的歌曲會出現在這裡。點選歌曲會把它設為目前播放項目；媒體庫則保存以前匯入過的歌曲。', 'Songs you add appear here. Select one to make it the current track; the Library stores songs you imported before.', '追加した曲はここに表示されます。曲を選ぶと現在の再生曲になり、メディアライブラリには以前取り込んだ曲が保存されます。', '추가한 곡이 여기에 표시됩니다. 곡을 선택하면 현재 재생 곡이 되며, 미디어 보관함에는 이전에 가져온 곡이 저장됩니다.', '添加的歌曲会出现在这里。点击歌曲会将它设为当前播放项目；媒体库则保存以前导入过的歌曲。'],
    'tour.step.playlist.hint': ['播放清單是這次準備要唱的順序；媒體庫是長期保存歌曲的倉庫。', 'The playlist is your order for this session; the Library is long-term storage.', 'プレイリストは今回歌う順番、メディアライブラリは長期保存する場所です。', '재생목록은 이번 방송 순서이고, 미디어 보관함은 곡을 오래 보관하는 곳입니다.', '播放列表是这次准备演唱的顺序；媒体库是长期保存歌曲的仓库。'],
    'tour.step.player.title': ['播放與切歌', 'Play and change tracks', '再生と曲送り', '재생 및 곡 전환', '播放与切歌'],
    'tour.step.player.body': ['這裡控制播放、暫停、上一首、下一首與歌曲進度。歌曲開始播放後，歌詞會依時間同步。', 'Control play, pause, previous, next, and song position here. Once playback starts, the lyrics follow the timeline.', 'ここで再生、一時停止、前の曲、次の曲、再生位置を操作します。再生を始めると歌詞が時間に合わせて同期します。', '여기서 재생, 일시정지, 이전 곡, 다음 곡, 재생 위치를 조작합니다. 재생이 시작되면 가사가 시간에 맞춰 동기화됩니다.', '这里控制播放、暂停、上一首、下一首与歌曲进度。歌曲开始播放后，歌词会按时间同步。'],
    'tour.step.player.hint': ['示範歌詞不需要播放音訊；真的歌曲則先選歌，再按中央播放鍵。', 'Sample lyrics need no audio. For a real song, select it first, then press the center Play button.', 'サンプル歌詞には音声再生は不要です。実際の曲は先に選び、中央の再生ボタンを押します。', '샘플 가사는 오디오 재생이 필요 없습니다. 실제 곡은 먼저 선택한 뒤 가운데 재생 버튼을 누르세요.', '示范歌词不需要播放音频；真实歌曲则先选歌，再按中央播放键。'],
    'tour.step.preview.title': ['確認觀眾看到的歌詞', 'Check the lyrics viewers see', '視聴者に見える歌詞を確認', '시청자에게 보이는 가사 확인', '确认观众看到的歌词'],
    'tour.step.preview.body': ['這裡就是 OBS 歌詞輸出的即時預覽。看到文字出現，代表核心歌詞流程已經正常。', 'This is a live preview of the OBS lyrics output. If text appears here, the core lyrics flow is working.', 'ここがOBS歌詞出力のライブプレビューです。文字が表示されれば、歌詞の基本動作は正常です。', '여기가 OBS 가사 출력의 실시간 미리보기입니다. 글자가 보이면 핵심 가사 흐름이 정상입니다.', '这里就是 OBS 歌词输出的实时预览。看到文字出现，代表核心歌词流程已经正常。'],
    'tour.step.preview.hint': ['控制面板是你操作的後台；這塊預覽才接近觀眾實際看到的畫面。', 'The control panel is your backstage view; this preview is close to what viewers actually see.', 'コントロールパネルは操作用の画面で、このプレビューが視聴者に見える画面に近いものです。', '제어판은 조작용 화면이고, 이 미리보기가 시청자에게 실제로 보이는 화면에 가깝습니다.', '控制面板是你操作的后台；这块预览才接近观众实际看到的画面。'],
    'tour.step.style.title': ['選擇歌詞動畫', 'Choose a lyrics animation', '歌詞アニメーションを選択', '가사 애니메이션 선택', '选择歌词动画'],
    'tour.step.style.body': ['模板、字體、顏色、位置與動畫都在歌詞設定頁調整。每個模板會保留自己的設定，右側預覽會立即更新。', 'Adjust templates, fonts, colors, position, and motion in Lyrics Settings. Each template keeps its own settings, and the preview updates immediately.', 'テンプレート、フォント、色、位置、アニメーションは歌詞設定で調整します。各テンプレートの設定は個別に保存され、プレビューへすぐ反映されます。', '템플릿, 글꼴, 색상, 위치, 애니메이션은 가사 설정에서 조정합니다. 각 템플릿은 자체 설정을 유지하며 미리보기에 즉시 반영됩니다.', '模板、字体、颜色、位置与动画都在歌词设置页调整。每个模板会保留自己的设置，右侧预览会立即更新。'],
    'tour.step.style.hint': ['現在只需要知道模板在哪裡，不必一次調完所有選項。', 'For now, just remember where templates are. You do not need to adjust every option.', '今はテンプレートの場所だけ分かれば十分です。すべてを一度に調整する必要はありません。', '지금은 템플릿 위치만 기억하면 됩니다. 모든 옵션을 한 번에 조정할 필요는 없습니다.', '现在只需要知道模板在哪里，不必一次调完所有选项。'],
    'tour.step.obs.title': ['把歌詞加入 OBS', 'Add lyrics to OBS', '歌詞をOBSへ追加', '가사를 OBS에 추가', '把歌词加入 OBS'],
    'tour.step.obs.body': ['在 OBS 新增「瀏覽器」來源，貼上歌詞網址 /display。之後換歌或修改模板時，不需要重新更換網址。', 'Add a Browser Source in OBS and paste the /display lyrics URL. You do not need to change the URL when switching songs or templates.', 'OBSで「ブラウザ」ソースを追加し、歌詞URL /display を貼り付けます。曲やテンプレートを変えてもURLを入れ直す必要はありません。', 'OBS에서 ‘브라우저’ 소스를 추가하고 /display 가사 URL을 붙여 넣으세요. 곡이나 템플릿을 바꿔도 URL을 다시 넣을 필요가 없습니다.', '在 OBS 新增“浏览器”来源，粘贴歌词网址 /display。之后换歌或修改模板时，不需要重新更换网址。'],
    'tour.step.obs.hint': ['OBS WebSocket 已連線時，也可以使用下方「一鍵建立歌詞＋歌單來源」。OBS 尚未準備好則可稍後設定。', 'If OBS WebSocket is connected, you can also use “Create lyrics + setlist sources” below. If OBS is not ready, set it up later.', 'OBS WebSocketが接続済みなら、下の「歌詞＋セットリストソースを一括作成」も使えます。OBSの準備がまだなら後で設定できます。', 'OBS WebSocket이 연결되어 있다면 아래의 ‘가사+세트리스트 소스 한 번에 만들기’도 사용할 수 있습니다. OBS가 준비되지 않았다면 나중에 설정하세요.', 'OBS WebSocket 已连接时，也可以使用下方“一键创建歌词＋歌单来源”。OBS 尚未准备好则可稍后设置。'],
    'tour.action.sample': ['先用示範歌詞', 'Use sample lyrics', 'サンプル歌詞を使う', '샘플 가사 먼저 보기', '先用示范歌词'],
    'tour.action.nextStyle': ['試試下一個風格', 'Try the next style', '次のスタイルを試す', '다음 스타일 사용해 보기', '试试下一个风格'],
    'tour.action.copyObs': ['複製歌詞網址', 'Copy lyrics URL', '歌詞URLをコピー', '가사 URL 복사', '复制歌词网址'],
    'tour.status.sampleReady': ['示範歌詞已準備，可以繼續。', 'Sample lyrics are ready. You can continue.', 'サンプル歌詞の準備ができました。続行できます。', '샘플 가사가 준비되었습니다. 계속할 수 있습니다.', '示范歌词已准备，可以继续。'],
    'tour.status.sampleUnavailable': ['預覽尚未準備好，請稍候再試一次。', 'The preview is not ready yet. Wait a moment and try again.', 'プレビューの準備がまだできていません。少し待ってからもう一度お試しください。', '미리보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.', '预览尚未准备好，请稍候再试一次。'],
    'tour.status.songReady': ['已偵測到歌曲，可以繼續。', 'A song was detected. You can continue.', '曲が検出されました。続行できます。', '곡이 감지되었습니다. 계속할 수 있습니다.', '已检测到歌曲，可以继续。'],
    'tour.status.waitingSource': ['加入一首歌，或先使用示範歌詞。', 'Add one song, or use sample lyrics first.', '曲を1つ追加するか、サンプル歌詞を使ってください。', '곡 한 개를 추가하거나 샘플 가사를 먼저 사용하세요.', '添加一首歌，或先使用示范歌词。'],
    'tour.status.obsCopied': ['已送出複製動作；若瀏覽器允許，歌詞網址已在剪貼簿中。', 'Copy requested. If the browser allowed it, the lyrics URL is now on your clipboard.', 'コピーを要求しました。ブラウザで許可されていれば、歌詞URLはクリップボードに入っています。', '복사를 요청했습니다. 브라우저가 허용했다면 가사 URL이 클립보드에 저장되었습니다.', '已发出复制请求；如果浏览器允许，歌词网址已在剪贴板中。'],
    'tour.status.styleChanged': ['已切換風格；可以繼續試看，設定會即時反映。', 'Style changed. You can keep trying options; settings update immediately.', 'スタイルを切り替えました。続けて試せます。設定はすぐに反映されます。', '스타일을 변경했습니다. 계속 시험해 볼 수 있으며 설정은 즉시 반영됩니다.', '已切换风格；可以继续试用，设置会立即生效。'],
    'tour.targetUnavailable': ['這個區域目前無法顯示。你可以跳過這一步，原本功能不受影響。', 'This area is not available right now. You can skip this step; the original feature is unaffected.', 'この領域は現在表示できません。この手順はスキップでき、元の機能には影響しません。', '이 영역을 현재 표시할 수 없습니다. 이 단계를 건너뛰어도 기존 기능에는 영향이 없습니다.', '这个区域目前无法显示。你可以跳过这一步，原有功能不受影响。']
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

  function normalizeAutoSource(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  const autoExactRows = new Map();
  const autoPatternRows = [];
  function registerAutoRow(source, values) {
    const normalized = normalizeAutoSource(source);
    const literal = normalized.replace(/\{\d+\}/g, '');
    if (!normalized || !/[\u3400-\u9fff]/.test(literal) || !Array.isArray(values) || values.length !== LOCALES.length) return;
    if (!/\{\d+\}/.test(normalized)) {
      autoExactRows.set(normalized, values);
      return;
    }
    const tokens = [];
    const marker = normalized.replace(/\{(\d+)\}/g, (_, index) => {
      const token = `___ES_I18N_${tokens.length}___`;
      tokens.push(Number(index));
      return token;
    });
    let pattern = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    tokens.forEach((_, index) => { pattern = pattern.replace(`___ES_I18N_${index}___`, '(.*?)'); });
    autoPatternRows.push({
      source: normalized,
      values,
      tokens,
      regex: new RegExp(`^${pattern}$`),
      segments: normalized.split(/\{\d+\}/)
    });
  }
  Object.entries(AUTO_ROWS).forEach(([source, values]) => {
    registerAutoRow(source, values);
    const sourceSegments = [...source.matchAll(/>([^<>]+)</g)].map((match) => match[1]);
    const translatedSegments = values.map((value) => (
      [...String(value).matchAll(/>([^<>]+)</g)].map((match) => match[1])
    ));
    if (sourceSegments.length && translatedSegments.every((segments) => segments.length === sourceSegments.length)) {
      sourceSegments.forEach((segment, segmentIndex) => {
        registerAutoRow(segment, translatedSegments.map((segments) => segments[segmentIndex]));
      });
    }
  });
  // Specific templates must run before generic rows such as "{0}格式無效。" or
  // "{0}失敗：{1}", otherwise the generic capture keeps the untranslated
  // Traditional-Chinese prefix and silently overrides the intended row.
  autoPatternRows.sort((left, right) => {
    const literalLength = (row) => row.source.replace(/\{\d+\}/g, '').length;
    return literalLength(right) - literalLength(left) || right.source.length - left.source.length;
  });

  function resolveAutoRow(value) {
    const normalized = normalizeAutoSource(value);
    const exact = autoExactRows.get(normalized);
    if (exact) return { source: normalized, values: exact, captures: [] };
    const matchPattern = (row) => {
      const segments = row.segments || [];
      if (!segments.length || (segments[0] && !normalized.startsWith(segments[0]))) return null;
      const match = row.regex && row.regex.exec(normalized);
      if (!match) return null;
      return { source: row.source, values: row.values, captures: match.slice(1), tokens: row.tokens || [] };
    };
    for (const row of autoPatternRows) {
      const result = matchPattern(row);
      if (result) return result;
    }
    // Defensive fallback for generated catalogs: derive placeholder patterns
    // directly if a host transformed the precompiled pattern table. This is a
    // full scan of the catalog, so it must only run when that table is really
    // missing — every miss goes through here, and misses are the common case
    // (song titles, timestamps, counts) on the MutationObserver hot path.
    if (autoPatternRows.length) return null;
    for (const [source, values] of Object.entries(AUTO_ROWS)) {
      const tokenMatches = [...source.matchAll(/\{(\d+)\}/g)];
      if (!tokenMatches.length || !/[\u3400-\u9fff]/.test(source.replace(/\{\d+\}/g, ''))) continue;
      const result = matchPattern({
        source,
        values,
        tokens: tokenMatches.map((match) => Number(match[1])),
        segments: source.split(/\{\d+\}/),
        regex: new RegExp(`^${source
          .replace(/\{\d+\}/g, '___ES_I18N_TOKEN___')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replaceAll('___ES_I18N_TOKEN___', '(.*?)')}$`)
      });
      if (result) return result;
    }
    return null;
  }

  function renderAutoRow(state) {
    const index = INDEX[activeLocale] == null ? INDEX[DEFAULT_LOCALE] : INDEX[activeLocale];
    let value = state.values[index] || state.values[INDEX[DEFAULT_LOCALE]] || state.source;
    state.tokens && state.tokens.forEach((tokenIndex, captureIndex) => {
      const capture = state.captures[captureIndex] || '';
      value = value.replaceAll(`{${tokenIndex}}`, capture);
    });
    return value;
  }

  function translate(value) {
    const resolved = resolveAutoRow(value);
    if (!resolved) return String(value == null ? '' : value);
    resolved.tokens = resolved.tokens || (autoPatternRows.find((row) => row.source === resolved.source) || {}).tokens || [];
    return renderAutoRow(resolved);
  }

  function isAutoExcluded(element) {
    return !element || (element.closest && !!element.closest(AUTO_EXCLUDE));
  }

  function translateAutoTextNode(node) {
    if (!node || node.nodeType !== 3 || isAutoExcluded(node.parentElement)) return;
    const raw = node.nodeValue || '';
    const normalized = normalizeAutoSource(raw);
    if (!normalized) return;
    let state = autoTextState.get(node);
    if (!state || (state.last && normalized !== normalizeAutoSource(state.last))) {
      const resolved = resolveAutoRow(normalized);
      if (!resolved) {
        autoTextState.delete(node);
        return;
      }
      state = {
        ...resolved,
        tokens: resolved.tokens || (autoPatternRows.find((row) => row.source === resolved.source) || {}).tokens || [],
        leading: (raw.match(/^\s*/) || [''])[0],
        trailing: (raw.match(/\s*$/) || [''])[0],
        last: null
      };
      autoTextState.set(node, state);
    }
    const translated = `${state.leading}${renderAutoRow(state)}${state.trailing}`;
    state.last = translated;
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }

  function translateAutoAttributes(element) {
    if (!element || !element.getAttribute || isAutoExcluded(element)) return;
    let states = autoAttributeState.get(element);
    if (!states) {
      states = {};
      autoAttributeState.set(element, states);
    }
    AUTO_ATTRIBUTES.forEach((attribute) => {
      if (element.hasAttribute(`data-i18n-${attribute}`) || !element.hasAttribute(attribute)) return;
      const current = element.getAttribute(attribute);
      let state = states[attribute];
      if (!state || (state.last && current !== state.last)) {
        state = resolveAutoRow(current);
        if (!state) {
          delete states[attribute];
          return;
        }
        state.tokens = state.tokens || (autoPatternRows.find((row) => row.source === state.source) || {}).tokens || [];
        state.last = null;
        states[attribute] = state;
      }
      const translated = renderAutoRow(state);
      state.last = translated;
      if (current !== translated) element.setAttribute(attribute, translated);
    });
  }

  function applyAuto(rootNode) {
    if (typeof document === 'undefined') return;
    const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
    const roots = [];
    if (scope.matches && scope.matches('[data-i18n-auto]')) roots.push(scope);
    if (scope.closest) {
      const owner = scope.closest('[data-i18n-auto]');
      if (owner && !roots.includes(owner)) roots.push(scope);
    }
    if (scope.querySelectorAll) scope.querySelectorAll('[data-i18n-auto]').forEach((node) => roots.push(node));
    roots.forEach((rootElement) => {
      translateAutoAttributes(rootElement);
      rootElement.querySelectorAll('*').forEach(translateAutoAttributes);
      const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        translateAutoTextNode(node);
        node = walker.nextNode();
      }
    });
  }

  function translateElement(element) {
    if (!element || !element.getAttribute) return;
    const textKey = element.getAttribute('data-i18n');
    const titleKey = element.getAttribute('data-i18n-title');
    const ariaKey = element.getAttribute('data-i18n-aria-label');
    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    const altKey = element.getAttribute('data-i18n-alt');
    const labelKey = element.getAttribute('data-i18n-label');
    if (textKey) element.textContent = t(textKey);
    if (titleKey) element.setAttribute('title', t(titleKey));
    if (ariaKey) element.setAttribute('aria-label', t(ariaKey));
    if (placeholderKey) element.setAttribute('placeholder', t(placeholderKey));
    if (altKey) element.setAttribute('alt', t(altKey));
    if (labelKey) element.setAttribute('label', t(labelKey));
  }

  function apply(rootNode) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = activeLocale;
    const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
    if (scope.matches && scope.matches('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt],[data-i18n-label]')) {
      translateElement(scope);
    }
    scope.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt],[data-i18n-label]')
      .forEach(translateElement);
    applyAuto(scope);
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
    if (!autoObserver && document.body) {
      autoObserver = new MutationObserver((records) => {
        records.forEach((record) => {
          if (record.type === 'characterData') translateAutoTextNode(record.target);
          record.addedNodes && record.addedNodes.forEach((node) => {
            if (node.nodeType === 3) translateAutoTextNode(node);
            else if (node.nodeType === 1) applyAuto(node);
          });
        });
      });
      autoObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
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
    translate,
    apply,
    applyAuto,
    setLocale,
    localizeUrl,
    init
  };
});
