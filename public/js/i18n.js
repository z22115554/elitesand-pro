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
    'spout.eyebrow': ['外部透明輸出', 'External transparent output', '外部透過出力', '외부 투명 출력', '外部透明输出'],
    'spout.title': ['Spout 透明歌詞輸出', 'Spout transparent lyrics output', 'Spout 透過歌詞出力', 'Spout 투명 가사 출력', 'Spout 透明歌词输出'],
    'spout.description': ['讓 Shoost 或其他 Spout 接收軟體取得含 Alpha 的歌詞畫面，不需要色度鍵。', 'Send lyrics with alpha to Shoost or another Spout receiver without chroma key.', 'Shoost などの Spout 受信ソフトへ、クロマキーなしで Alpha 付き歌詞を送ります。', 'Shoost 등 Spout 수신 프로그램에 크로마 키 없이 알파가 포함된 가사를 보냅니다.', '让 Shoost 或其他 Spout 接收软件获取带 Alpha 的歌词画面，无需色度键。'],
    'spout.senderName': ['Sender 名稱', 'Sender name', 'Sender 名', 'Sender 이름', 'Sender 名称'],
    'spout.width': ['寬度', 'Width', '幅', '너비', '宽度'],
    'spout.height': ['高度', 'Height', '高さ', '높이', '高度'],
    "fonts.browse": ["瀏覽系統字體","Browse system fonts","システムフォントを参照する","시스템 글꼴 찾아보기","浏览系统字体"],
    "fonts.choose": ["選擇系統字體","Choose a system font","フォントを選択","시스템 글꼴 선택","选择系统字体"],
    "fonts.follow": ["不指定：英文跟主字體","Follow main font","メインフォントに合わせる","기본 글꼴 사용","不指定：英文跟主字体"],
    "fonts.search": ["搜尋字體名稱…","Search font names…","フォント名を検索…","글꼴 이름 검색…","搜索字体名称…"],
    "fonts.refresh": ["重新整理","Refresh","更新","새로 고침","刷新"],
    "fonts.loading": ["正在更新字體清單…","Updating font list…","フォント一覧を更新中…","글꼴 목록 업데이트 중…","正在更新字体列表…"],
    "fonts.empty": ["找不到符合的字體","No matching fonts","該当するフォントがありません","일치하는 글꼴 없음","没有匹配的字体"],
    "fonts.count": ["{count} 個字體","{count} fonts","{count} フォント","글꼴 {count}개","{count} 个字体"],
    "fonts.failed": ["無法更新字體清單；可繼續使用已記住的清單或手動輸入名稱。","Could not update fonts. Use the saved list or type a font name.","フォント一覧を更新できません。保存済みの一覧か手入力を使用できます。","글꼴 목록을 업데이트할 수 없습니다. 저장된 목록을 사용하거나 이름을 입력하세요.","无法更新字体列表；可使用已保存的列表或手动输入名称。"],
    "fonts.hint": ["清單會記住，可搜尋名稱並預覽字型；安裝新字型後可按重新整理。OBS 與控制台須在同一台電腦；找不到時使用備援字型。","The list is saved. Search and preview fonts; refresh after installing new fonts. OBS and the panel must run on the same computer. Unavailable fonts use a fallback.","一覧は保存されます。検索・プレビューができ、新しいフォントの追加後は更新できます。OBS とパネルは同じ PC で使用してください。未対応の場合は代替フォントを使います。","목록이 저장됩니다. 글꼴을 검색하고 미리 볼 수 있으며 새 글꼴 설치 후 새로 고침하세요. OBS와 패널은 같은 PC에서 사용해야 합니다. 없는 글꼴은 대체됩니다.","列表会保存，可搜索名称并预览字体；安装新字体后可刷新。OBS 与控制台须在同一台电脑；不可用时使用备用字体。"],
    'spout.fps': ['FPS', 'FPS', 'FPS', 'FPS', 'FPS'],
    'spout.fpsHint': ['建議使用 30 FPS；60 FPS 仍可選擇，但需要足夠的 GPU 效能。', '30 FPS is recommended. 60 FPS remains available when GPU performance is sufficient.', '30 FPS を推奨します。GPU 性能に余裕がある場合は 60 FPS も選択できます。', '30 FPS를 권장합니다. GPU 성능이 충분하면 60 FPS도 선택할 수 있습니다.', '建议使用 30 FPS；GPU 性能足够时仍可选择 60 FPS。'],
    'spout.start': ['開始透明輸出', 'Start transparent output', '透過出力を開始', '투명 출력 시작', '开始透明输出'],
    'spout.stop': ['停止輸出', 'Stop output', '出力を停止', '출력 중지', '停止输出'],
    'spout.idle': ['尚未啟動', 'Not started', '未開始', '시작하지 않음', '尚未启动'],
    'spout.running': ['輸出中', 'Output running', '出力中', '출력 중', '输出中'],
    'spout.starting': ['正在更新輸出…', 'Updating output…', '出力を更新中…', '출력을 업데이트하는 중…', '正在更新输出…'],
    'spout.error': ['輸出發生錯誤', 'Output error', '出力エラー', '출력 오류', '输出发生错误'],
    'spout.idleHint': ['預設不會自動啟動；開始後在 Shoost 的 Spout 捕捉選擇 Sender 名稱。', 'It never starts automatically. After starting, select the Sender name in Shoost Spout Capture.', '自動では開始しません。開始後、Shoost の Spout Capture で Sender 名を選択してください。', '자동으로 시작하지 않습니다. 시작한 뒤 Shoost Spout 캡처에서 Sender 이름을 선택하세요.', '默认不会自动启动；开始后请在 Shoost 的 Spout 捕捉中选择 Sender 名称。'],
    'spout.runningPerfHint': ['Shoost 請選擇「{name}」。GPU 同步：最近 {lastMs} ms，平均 {avgMs} ms，送出約 {fps} fps。', 'In Shoost, select “{name}”. GPU sync: last {lastMs} ms, average {avgMs} ms, about {fps} fps sent.', 'Shoost で「{name}」を選択してください。GPU 同期：直近 {lastMs} ms、平均 {avgMs} ms、送信は約 {fps} fps です。', 'Shoost에서 “{name}”을 선택하세요. GPU 동기화: 최근 {lastMs}ms, 평균 {avgMs}ms, 전송 약 {fps}fps입니다.', '请在 Shoost 中选择“{name}”。GPU 同步：最近 {lastMs} ms，平均 {avgMs} ms，发送约 {fps} fps。'],
    'spout.metrics': ['畫面：送出 {sent}／收到 {received}，丟棄 {dropped}，GPU 同步逾時 {timeouts}。', 'Frames: {sent} sent / {received} received, {dropped} dropped, {timeouts} GPU sync timeouts.', 'フレーム：送信 {sent}／受信 {received}、破棄 {dropped}、GPU 同期タイムアウト {timeouts}。', '프레임: 전송 {sent} / 수신 {received}, 드롭 {dropped}, GPU 동기화 시간 초과 {timeouts}.', '画面：发送 {sent}／收到 {received}，丢弃 {dropped}，GPU 同步超时 {timeouts}。'],
    'spout.errorDetail': ['無法啟動 Spout 輸出：{message}', 'Could not start Spout output: {message}', 'Spout 出力を開始できません: {message}', 'Spout 출력을 시작할 수 없습니다: {message}', '无法启动 Spout 输出：{message}'],
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
    'appUpdate.title': ['程式更新', 'App update', 'アプリの更新', '앱 업데이트', '程序更新'],
    'appUpdate.intro': ['請先按「檢查更新」查看是否有新版本；確認後才會由你決定是否重新啟動更新，直播中不會自動中斷。', 'Click “Check for updates” to look for a newer version. You choose whether to restart and update; a live session is never interrupted automatically.', '「アップデートを確認」を押して新しいバージョンを確認してください。再起動して更新するかは自分で選べ、配信中に自動で中断されることはありません。', '“업데이트 확인”을 눌러 새 버전을 확인하세요. 다시 시작해 업데이트할지는 직접 선택하며 방송 중에는 자동으로 중단되지 않습니다.', '请先点击“检查更新”查看是否有新版本；是否重新启动更新由你决定，直播中不会自动中断。'],
    'appUpdate.currentVersion': ['目前版本', 'Current version', '現在のバージョン', '현재 버전', '当前版本'],
    'appUpdate.currentUnknown': ['目前版本未知', 'Current version unknown', '現在のバージョンは不明です', '현재 버전을 알 수 없습니다', '当前版本未知'],
    'appUpdate.check': ['檢查更新', 'Check for updates', 'アップデートを確認', '업데이트 확인', '检查更新'],
    'appUpdate.updateNow': ['現在更新', 'Update now', '今すぐ更新', '지금 업데이트', '立即更新'],
    'appUpdate.pendingFound': ['偵測到新版本 {version}（開機時已檢查過）。按「現在更新」開始下載，直播中不會自動中斷。', 'Version {version} was found when the app started. Click “Update now” to download it; a live session is never interrupted automatically.', '起動時に新しいバージョン {version} が見つかりました。「今すぐ更新」を押すとダウンロードを開始します。配信中に自動で中断されることはありません。', '앱 시작 시 새 버전 {version}을(를) 찾았습니다. “지금 업데이트”를 누르면 다운로드를 시작하며, 방송 중에는 자동으로 중단되지 않습니다.', '启动时检测到新版本 {version}。点击“立即更新”开始下载，直播中不会自动中断。'],
    'appUpdate.navBadgeTitle': ['有新版本可更新', 'There is a new version to update', '更新する新しいバージョンがあります', '업데이트할 새 버전이 있습니다.', '有新版本可更新'],
    'appUpdate.checking': ['正在檢查更新…', 'Checking for updates…', 'アップデートを確認しています…', '업데이트 확인 중…', '正在检查更新…'],
    'appUpdate.notChecked': ['尚未檢查。', 'Not checked yet.', 'まだ確認していません。', '아직 확인되지 않았습니다.', '尚未检查。'],
    'appUpdate.notConfigured': ['更新來源尚未設定。', 'Update source is not configured.', '更新元が設定されていません。', '업데이트 소스가 설정되지 않았습니다.', '尚未配置更新来源。'],
    'appUpdate.latest': ['已是最新版本。', 'You are up to date.', '最新バージョンです。', '최신 버전입니다.', '已是最新版本。'],
    'appUpdate.available': ['發現新版本 {version}。按「前往下載頁」到 GitHub 下載安裝檔。', 'Version {version} is available. Click “Open release page” to download the installer from GitHub.', '新しいバージョン {version} があります。「リリースページを開く」から GitHub でインストーラーをダウンロードしてください。', '새 버전 {version}을 사용할 수 있습니다. “릴리스 페이지 열기”를 눌러 GitHub에서 설치 파일을 다운로드하세요.', '发现新版本 {version}。点击“前往发布页”到 GitHub 下载安装包。'],
    'appUpdate.restart': ['重新啟動並更新', 'Restart and update', '再起動して更新', '다시 시작하고 업데이트', '重新启动并更新'],
    'appUpdate.openReleasePage': ['前往下載頁', 'Open release page', 'リリースページを開く', '릴리스 페이지 열기', '前往发布页'],
    'appUpdate.progressTitle': ['正在更新程式', 'Updating', 'アップデート中', '업데이트 중', '正在更新程序'],
    'appUpdate.progressSummary': ['下載與驗證完成後會自動重新啟動。請保持程式開啟、不要關閉電腦或斷線，直播中請先確認可以中斷再接受更新。', 'The app restarts automatically once the download and verification finish. Keep it open — do not shut down or disconnect. If you are live, make sure it is safe to interrupt before accepting an update.', 'ダウンロードと検証が終わると自動的に再起動します。アプリを開いたままにし、電源を切ったり切断したりしないでください。配信中の場合は、中断しても問題ないか確認してから更新を承諾してください。', '다운로드와 검증이 끝나면 자동으로 재시작됩니다. 앱을 계속 켜두고 전원을 끄거나 연결을 끊지 마세요. 방송 중이라면 중단해도 괜찮은지 먼저 확인한 후 업데이트를 수락하세요.', '下载与验证完成后会自动重新启动。请保持程序开启、不要关闭电脑或断线，直播中请先确认可以中断再接受更新。'],
    'appUpdate.progressPreparing': ['準備中…', 'Preparing…', '準備中…', '준비 중…', '准备中…'],
    'appUpdate.restarting': ['正在安全重新啟動並準備更新…', 'Safely restarting to prepare the update…', '安全に再起動して更新を準備しています…', '안전하게 다시 시작하여 업데이트를 준비하는 중…', '正在安全重新启动并准备更新…'],
    'appUpdate.checkFailed': ['暫時無法檢查更新，請稍後再試。', 'Unable to check for updates right now. Try again later.', '現在、更新を確認できません。後でもう一度お試しください。', '지금 업데이트를 확인할 수 없습니다. 나중에 다시 시도하세요.', '暂时无法检查更新，请稍后再试。'],
    'appUpdate.cfDeclined': ['已略過 v{version}，之後隨時可以再按「檢查更新」重新詢問。', 'Skipped v{version}. Click “Check for updates” again anytime to be asked once more.', 'v{version} をスキップしました。いつでも「アップデートを確認」を押せば再度確認できます。', 'v{version}을(를) 건너뛰었습니다. 언제든지 “업데이트 확인”을 다시 눌러 확인할 수 있습니다.', '已跳过 v{version}，之后随时可以再点“检查更新”重新询问。'],
    'appUpdate.cfAcceptFailed': ['更新準備失敗，程式仍可正常使用；請改用完整安裝檔升級。', 'Preparing the update failed; the app still works normally. Please upgrade with the full Installer instead.', '更新の準備に失敗しましたが、アプリは通常どおり使用できます。完全インストーラーでアップグレードしてください。', '업데이트 준비에 실패했지만 앱은 정상적으로 사용할 수 있습니다. 전체 설치 파일로 업그레이드해 주세요.', '更新准备失败，程序仍可正常使用；请改用完整安装包升级。'],
    'appUpdate.failBannerTitle': ['這次更新沒有套用成功', 'This update did not apply successfully', '今回の更新は適用に失敗しました', '이번 업데이트가 정상적으로 적용되지 않았습니다', '这次更新没有套用成功'],
    'appUpdate.failBannerMessage': ['要傳送診斷資訊協助找出原因嗎？送出前你可以先看過完整內容。', 'Send diagnostics to help find the cause? You can review the full content before sending.', '原因調査のために診断情報を送信しますか？送信前に内容をすべて確認できます。', '원인 파악을 위해 진단 정보를 보낼까요? 보내기 전에 전체 내용을 확인할 수 있습니다.', '要发送诊断信息协助找出原因吗？送出前你可以先看过完整内容。'],
    'appUpdate.failReportTitle': ['更新套用失敗', 'Update failed to apply', '更新の適用に失敗しました', '업데이트 적용 실패', '更新套用失败'],
    'appUpdate.failReportActual': ['嘗試更新到 {version} 時失敗，程式仍可正常使用。', 'Updating to {version} failed. The app still works normally.', '{version} への更新に失敗しました。アプリは通常どおり使用できます。', '{version}(으)로 업데이트하는 데 실패했습니다. 앱은 정상적으로 사용할 수 있습니다.', '尝试更新到 {version} 时失败，程序仍可正常使用。'],
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
    'prompter.showFurigana': ['振假名', 'Furigana', 'ふりがな', '후리가나', '振假名'],
    'prompter.showFuriganaHint': ['在日文漢字上方顯示平假名讀音，沒有資料的行不會顯示', 'Shows hiragana readings above Japanese kanji; lines without data are skipped.', '日本語の漢字の上にひらがなの読みを表示します。データがない行は表示されません。', '일본어 한자 위에 히라가나 읽기를 표시합니다. 데이터가 없는 줄은 표시되지 않습니다.', '在日文汉字上方显示平假名读音，没有数据的行不会显示'],
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
    'home.session.statusStale': ['直播狀態異常（可能已收台但未偵測到）· 可直接按「清除歌單」重設', 'Stream status looks stuck (the stream may have ended without being detected) · use “Clear setlist” to reset', '配信状態が異常です（配信終了を検出できなかった可能性）· 「セットリストを消去」で再設定できます', '방송 상태가 비정상입니다(방송 종료가 감지되지 않았을 수 있음) · “세트리스트 지우기”로 초기화하세요', '直播状态异常（可能已下播但未检测到）· 可直接按“清除歌单”重置'],
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
    'home.tab.groupLabel': ['準備工作', 'Preparation', '準備作業', '준비 작업', '准备工作'],
    'home.tab.add': ['加入音樂', 'Add music', '曲を追加', '음악 추가', '加入音乐'],
    'home.tab.sync': ['歌詞對時', 'Lyric timing', '歌詞タイミング', '가사 타이밍', '歌词对时'],
    'home.tab.audio': ['音訊', 'Audio', '音声', '오디오', '音频'],
    'home.tab.session': ['本場直播', 'Current stream', '今回の配信', '이번 방송', '本场直播'],
    'home.tab.ai': ['AI 伴奏', 'AI instrumental', 'AI 伴奏', 'AI 반주', 'AI 伴奏'],
    'home.ai.intro': ['用 AI 去掉人聲、留下純伴奏。想邊唱邊聽原唱當參考，開「分離播放模式」並照「雙路音訊」教學設定 OBS。', 'Use AI to remove the vocals and keep the instrumental. To sing along with the original as a guide, turn on Separated playback mode and follow the Dual audio guide for OBS.', 'AIでボーカルを除去し、伴奏だけを残します。原曲をガイドにして歌いたい場合は「分離再生モード」をオンにし、「デュアル音声」ガイドに従ってOBSを設定します。', 'AI로 보컬을 제거하고 반주만 남깁니다. 원곡을 가이드로 따라 부르려면 분리 재생 모드를 켜고 이중 오디오 가이드에 따라 OBS를 설정하세요.', '用 AI 去掉人声、留下纯伴奏。想边唱边听原唱当参考，开“分离播放模式”并照“双路音频”教程设置 OBS。'],
    'home.ai.engineChecking': ['正在檢查 AI 伴奏元件…', 'Checking the AI instrumental component…', 'AI伴奏コンポーネントを確認中…', 'AI 반주 구성 요소 확인 중…', '正在检查 AI 伴奏组件…'],
    'home.ai.engineMissing': ['尚未安裝 AI 伴奏元件', 'The AI instrumental component is not installed yet', 'AI伴奏コンポーネントはまだインストールされていません', 'AI 반주 구성 요소가 아직 설치되지 않았습니다', '尚未安装 AI 伴奏组件'],
    'home.ai.engineReady': ['AI 伴奏元件已就緒', 'The AI instrumental component is ready', 'AI伴奏コンポーネントは準備完了です', 'AI 반주 구성 요소가 준비되었습니다', 'AI 伴奏组件已就绪'],
    'home.ai.engineReadyWebgpu': ['AI 伴奏元件已就緒（WebGPU 備援可用）', 'The AI instrumental component is ready (WebGPU fallback available)', 'AI伴奏コンポーネントは準備完了です（WebGPUフォールバック利用可）', 'AI 반주 구성 요소가 준비되었습니다(WebGPU 대체 사용 가능)', 'AI 伴奏组件已就绪（WebGPU 备援可用）'],
    'home.ai.install': ['安裝 AI 伴奏元件', 'Install the AI instrumental component', 'AI伴奏コンポーネントをインストール', 'AI 반주 구성 요소 설치', '安装 AI 伴奏组件'],
    'home.ai.makeAll': ['未製作的全部排進佇列', 'Queue all that are not made yet', '未作成のものをすべてキューに追加', '아직 만들지 않은 항목 모두 대기열에 추가', '未制作的全部排进队列'],
    'home.ai.queueing': ['排入佇列中…', 'Queuing…', 'キューに追加中…', '대기열에 추가하는 중…', '排入队列中…'],
    'home.ai.retryFailed': ['重試失敗的', 'Retry the failed ones', '失敗したものを再試行', '실패한 항목 다시 시도', '重试失败的'],
    'home.ai.openAudio': ['分離播放模式', 'Separated playback mode', '分離再生モード', '분리 재생 모드', '分离播放模式'],
    'home.ai.openGuide': ['雙路音訊教學', 'Dual audio guide', 'デュアル音声ガイド', '이중 오디오 가이드', '双路音频教程'],
    'dualAudio.title': ['雙路音訊路由（實驗性）', 'Dual audio routing (experimental)', 'デュアル音声ルーティング（実験的）', '이중 오디오 라우팅(실험적)', '双路音频路由（实验性）'],
    'dualAudio.introMain': ['把播放的聲音分別送到兩個獨立的音訊輸出裝置，本地監聽音量與對外（OBS 擷取）音量可以各自調整、互不影響，對所有歌曲都生效。想要「觀眾只聽伴奏、自己聽得到原唱當導唱」，還要另外在媒體庫分離過這首歌的人聲。需要電腦有至少兩個獨立的音訊輸出裝置（例如虛擬音訊線＋耳機）。', 'Sends playback to two independent audio output devices at once. Local monitoring volume and outgoing (OBS capture) volume can be adjusted independently, and this applies to every song. To have the audience hear only the instrumental while you hear the original vocal as a guide, the song also needs to be vocal-separated in the media library first. Requires at least two independent audio output devices on your computer (for example a virtual audio cable plus headphones).', '再生音声を2つの独立したオーディオ出力デバイスに同時に送ります。ローカルモニター音量と配信用（OBSキャプチャ）音量は個別に調整でき、すべての曲に適用されます。「視聴者には伴奏だけを聞かせ、自分はガイドとして原曲ボーカルを聞く」には、メディアライブラリでその曲のボーカル分離も別途行う必要があります。コンピューターに独立したオーディオ出力デバイスが2つ以上必要です（例：仮想オーディオケーブル＋ヘッドホン）。', '재생 소리를 두 개의 독립된 오디오 출력 장치로 동시에 보냅니다. 로컬 모니터링 볼륨과 송출용(OBS 캡처) 볼륨을 각각 조절할 수 있으며 모든 곡에 적용됩니다. "시청자에게는 반주만 들리고 본인은 가이드용 원곡 보컬을 들으려면" 미디어 라이브러리에서 해당 곡의 보컬 분리도 별도로 해야 합니다. 컴퓨터에 독립된 오디오 출력 장치가 최소 두 개 필요합니다(예: 가상 오디오 케이블 + 헤드폰).', '把播放的声音分别送到两个独立的音频输出设备，本地监听音量与对外（OBS 采集）音量可以各自调整、互不影响，对所有歌曲都生效。想要“观众只听伴奏、自己听得到原唱当导唱”，还要另外在媒体库分离过这首歌的人声。需要电脑有至少两个独立的音频输出设备（例如虚拟音频线＋耳机）。'],
    'dualAudio.introBold': ['務必把 OBS 與 Windows 音效裝置的取樣率都設成 44100Hz', 'Be sure to set both OBS and the Windows audio device sample rate to 44100Hz', 'OBSとWindowsのオーディオデバイスのサンプルレートを必ず44100Hzに設定してください', 'OBS와 Windows 오디오 장치의 샘플링 레이트를 반드시 44100Hz로 설정하세요', '务必把 OBS 与 Windows 音频设备的采样率都设成 44100Hz'],
    'dualAudio.introTail': ['，這是消除長時間播放漂移最重要的免費設定。', ' — this single free setting matters most for eliminating drift over long playback sessions.', '。これが長時間再生時のズレをなくすために最も重要な無料設定です。', '. 이 무료 설정 하나가 장시간 재생 시 어긋남을 없애는 데 가장 중요합니다.', '，这是消除长时间播放漂移最重要的免费设定。'],
    'dualAudio.refreshDevices': ['重新整理裝置清單', 'Refresh device list', 'デバイス一覧を更新', '장치 목록 새로고침', '刷新设备列表'],
    'dualAudio.deviceWarning': ['偵測到少於兩個獨立的音訊輸出裝置，這個功能目前無法使用。', 'Fewer than two independent audio output devices were detected — this feature is currently unavailable.', '独立したオーディオ出力デバイスが2つ未満です。この機能は現在使用できません。', '독립된 오디오 출력 장치가 두 개 미만으로 감지되어 이 기능을 현재 사용할 수 없습니다.', '侦测到少于两个独立的音频输出设备，这个功能目前无法使用。'],
    'dualAudio.streamDevice': ['觀眾／OBS 裝置', 'Audience / OBS device', '視聴者／OBSデバイス', '시청자/OBS 장치', '观众／OBS 设备'],
    'dualAudio.headphoneDevice': ['主播耳機裝置', 'Streamer headphone device', '配信者用ヘッドホンデバイス', '스트리머 헤드폰 장치', '主播耳机设备'],
    'dualAudio.selectPlaceholder': ['（先按上面「重新整理裝置清單」）', '(Click "Refresh device list" above first)', '（先に上の「デバイス一覧を更新」を押してください）', '(먼저 위의 "장치 목록 새로고침"을 누르세요)', '（先点上面“刷新设备列表”）'],
    'dualAudio.routingLabel': ['雙路音訊路由', 'Dual audio routing', 'デュアル音声ルーティング', '이중 오디오 라우팅', '双路音频路由'],
    'dualAudio.routingHint': ['開啟後對所有歌曲生效；歌曲已分離人聲時，主播耳機還會多聽到原唱當導唱', 'Once on, this applies to every song; when a song has separated vocals, your headphones will also carry the original vocal as a guide', 'オンにするとすべての曲に適用されます。ボーカル分離済みの曲では、配信者のヘッドホンにガイドとして原曲ボーカルも聞こえます', '켜면 모든 곡에 적용됩니다. 보컬이 분리된 곡은 스트리머 헤드폰에 가이드용 원곡 보컬도 함께 들립니다', '开启后对所有歌曲生效；歌曲已分离人声时，主播耳机还会多听到原唱当导唱'],
    'dualAudio.headphoneVolume': ['本地監聽音量', 'Local monitoring volume', 'ローカルモニター音量', '로컬 모니터링 볼륨', '本地监听音量'],
    'dualAudio.streamVolume': ['對外音量（OBS 擷取）', 'Outgoing volume (OBS capture)', '配信用音量（OBSキャプチャ）', '송출 볼륨(OBS 캡처)', '对外音量（OBS 采集）'],
    'dualAudio.volumeHint': ['這兩顆疊加在主音量之上，通常設定一次就好——耳機想聽大聲一點不會動到觀眾/OBS 聽到的音量，反之亦然。拉到 150% 以上是把訊號硬放大，原始音檔太小聲時可能會爆音／破音，調高後建議實際聽一下有沒有失真。', 'These two stack on top of the main volume and usually only need to be set once — turning up your headphones will not change what the audience/OBS hears, and vice versa. Above 150% the signal is being force-boosted; if the source audio is quiet this can clip or distort, so listen back after raising it.', 'この2つはメイン音量に重ねて適用され、通常は一度設定すれば十分です。ヘッドホンを大きくしても視聴者／OBS側の音量には影響せず、その逆も同様です。150%を超えると信号を強制的に増幅するため、元の音声が小さいと音割れすることがあります。上げた後は実際に歪みがないか確認してください。', '이 두 볼륨은 메인 볼륨 위에 겹쳐 적용되며 보통 한 번만 설정하면 됩니다. 헤드폰을 크게 해도 시청자/OBS가 듣는 소리는 바뀌지 않고, 반대도 마찬가지입니다. 150%를 넘으면 신호를 강제로 증폭하는 것이라 원본 음원이 작으면 찢어짐이 생길 수 있으니, 올린 뒤에는 실제로 왜곡이 없는지 들어보세요.', '这两颗叠加在主音量之上，通常设定一次就好——耳机想听大声一点不会动到观众/OBS 听到的音量，反之亦然。拉到 150% 以上是把信号硬放大，原始音档太小声时可能会爆音／破音，调高后建议实际听一下有没有失真。'],
    'dualAudio.syncOffset': ['同步偏移', 'Sync offset', '同期オフセット', '동기화 오프셋', '同步偏移'],
    'dualAudio.syncOffsetHint': ['主播路與觀眾路實際上會經過不同的音訊管線，天生會有固定偏移，不是 bug。戴耳機播放一首歌，邊聽邊調這條滑桿，直到兩邊的節奏聽起來對上為止；正值＝延遲主播路，負值＝延遲觀眾路。長時間播放若兩邊又跑掉，用下面的「點擊對時測試」重新校正。', 'The streamer path and the audience path physically pass through different audio pipelines, so a fixed offset between them is expected, not a bug. Play a song with your headphones on and adjust this slider while listening until the two sides line up rhythmically; a positive value delays the streamer path, a negative value delays the audience path. If the two drift apart again during a long session, use the "Click sync test" below to recalibrate.', '配信者側と視聴者側は実際には異なるオーディオパイプラインを通るため、一定のズレが生じるのは仕様であり、バグではありません。ヘッドホンで曲を再生しながらこのスライダーを調整し、両方のリズムが合うまで動かしてください。正の値は配信者側を遅らせ、負の値は視聴者側を遅らせます。長時間再生でまたズレた場合は、下の「クリック同期テスト」で再調整してください。', '스트리머 경로와 시청자 경로는 실제로 서로 다른 오디오 파이프라인을 거치기 때문에 고정된 오프셋이 생기는 것은 정상이며 버그가 아닙니다. 헤드폰을 끼고 곡을 재생하면서 이 슬라이더를 조절해 양쪽 리듬이 맞을 때까지 맞추세요. 양수는 스트리머 경로를 지연시키고, 음수는 시청자 경로를 지연시킵니다. 장시간 재생 중 다시 어긋나면 아래의 "클릭 동기화 테스트"로 재보정하세요.', '主播路与观众路实际上会经过不同的音频管线，天生会有固定偏移，不是 bug。戴耳机播放一首歌，边听边调这条滑杆，直到两边的节奏听起来对上为止；正值＝延迟主播路，负值＝延迟观众路。长时间播放若两边又跑掉，用下面的“点击对时测试”重新校正。'],
    'dualAudio.clickTest': ['點擊對時測試', 'Click sync test', 'クリック同期テスト', '클릭 동기화 테스트', '点击对时测试'],
    'dualAudio.clickTestStart': ['開始對時測試', 'Start sync test', '同期テストを開始', '동기화 테스트 시작', '开始对时测试'],
    'dualAudio.clickTestStop': ['停止對時測試', 'Stop sync test', '同期テストを停止', '동기화 테스트 중지', '停止对时测试'],
    'dualAudio.clickTestHint': ['按下後會對「主播耳機」和「觀眾／OBS」兩路同時送出每秒一下的「嗒」聲。把兩路都放到聽得到的地方（例如 OBS 開「監聽並輸出」），邊聽邊調上面的「同步偏移」，直到兩下「嗒」完全重疊成一下。讓它一直跑，過十幾二十分鐘再聽一次，就知道有沒有漂移、往哪個方向漂。測完記得按「停止」。', 'Once started, a "tick" is sent once per second to both the streamer headphones and the audience/OBS path at the same time. Route both so you can hear them (for example, enable "Monitor and Output" in OBS), then adjust "Sync offset" above while listening until the two ticks merge into one. Leave it running and listen again after 10-20 minutes to see whether — and in which direction — the two have drifted apart. Remember to press "Stop" when you are done testing.', '開始すると、「配信者ヘッドホン」と「視聴者／OBS」の両方に毎秒1回の「カチッ」という音が同時に送られます。両方が聞こえる状態にし（例：OBSで「モニターして出力」を有効化）、上の「同期オフセット」を調整しながら2つの「カチッ」が完全に重なるまで合わせてください。そのまま流し続け、10〜20分後にもう一度聞くと、ズレているか、どちら方向にズレているかがわかります。テストが終わったら必ず「停止」を押してください。', '시작하면 "스트리머 헤드폰"과 "시청자/OBS" 두 경로에 초당 한 번씩 "딱" 소리가 동시에 전송됩니다. 두 경로를 모두 들을 수 있게 하고(예: OBS에서 "모니터링 및 출력" 활성화), 위의 "동기화 오프셋"을 조절하면서 두 "딱" 소리가 완전히 하나로 겹칠 때까지 맞추세요. 그대로 계속 재생한 뒤 10~20분 후 다시 들어보면 어긋남이 있는지, 어느 방향으로 어긋났는지 알 수 있습니다. 테스트가 끝나면 꼭 "중지"를 누르세요.', '按下后会对“主播耳机”和“观众／OBS”两路同时送出每秒一下的“嗒”声。把两路都放到听得到的地方（例如 OBS 开“监听并输出”），边听边调上面的“同步偏移”，直到两下“嗒”完全重叠成一下。让它一直跑，过十几二十分钟再听一次，就知道有没有漂移、往哪个方向漂。测完记得按“停止”。'],
    'help.dualAudio.title': ['⑭ 雙路音訊：觀眾只聽伴奏、你自己聽原唱當參考', '⑭ Dual audio: the audience hears only the instrumental, you hear the original as a guide', '⑭ デュアル音声：視聴者には伴奏だけ、自分にはガイドとして原曲を', '⑭ 이중 오디오: 시청자는 반주만, 나는 가이드용 원곡을', '⑭ 双路音频：观众只听伴奏、你自己听原唱当参考'],
    'help.dualAudio.goalLabel': ['目標', 'Goal', '目標', '목표', '目标'],
    'help.dualAudio.goal': ['直播出去的聲音只有「伴奏 ＋ 你的歌聲」，但你自己的耳機裡還能聽到「原唱人聲」當導唱參考，而這個原唱不會被直播收進去。', 'The stream audio carries only "instrumental + your singing", while your own headphones can still carry the "original vocal" as a guide — and that original vocal never gets picked up by the stream.', '配信される音声は「伴奏＋あなたの歌声」のみですが、自分のヘッドホンではガイドとして「原曲ボーカル」も聞くことができ、その原曲は配信には一切乗りません。', '방송으로 나가는 소리는 "반주 + 본인 노래"뿐이지만, 본인 헤드폰에서는 가이드용 "원곡 보컬"도 들을 수 있고, 이 원곡은 방송에는 전혀 들어가지 않습니다.', '直播出去的声音只有“伴奏＋你的歌声”，但你自己的耳机里还能听到“原唱人声”当导唱参考，而这个原唱不会被直播收进去。'],
    'help.dualAudio.appPartLabel': ['這程式負責哪一半', 'What this app handles', 'このアプリが担当する部分', '이 프로그램이 담당하는 부분', '这个程序负责哪一半'],
    'help.dualAudio.appPart': ['打開「分離播放模式」後，這程式播放的就是純伴奏。這條聲音正常被 OBS／直播收音，沒問題。', 'With "Separated playback mode" on, this app plays back the pure instrumental. This audio is picked up by OBS/the stream normally, no special handling needed.', '「分離再生モード」をオンにすると、このアプリは純粋な伴奏のみを再生します。この音声はOBS／配信に通常通り収録され、問題ありません。', "'분리 재생 모드'를 켜면 이 프로그램은 순수한 반주만 재생합니다. 이 소리는 OBS/방송에 평소대로 수음되며 문제 없습니다.", '打开“分离播放模式”后，这个程序播放的就是纯伴奏。这条声音正常被 OBS／直播收音，没问题。'],
    'help.dualAudio.referenceRouteLabel': ['原唱參考要另外走一條', 'The original-vocal reference needs its own separate route', '原曲リファレンスは別ルートが必要', '원곡 참고음은 별도 경로가 필요', '原唱参考要另外走一条'],
    'help.dualAudio.referenceRoute': ['用媒體庫的「試聽」單獨播原唱人聲軌，或用另一個播放器開 vocals 檔；把這個播放程式的聲音，在 Windows「音量混合器」指定到你的耳機裝置，不要進 OBS 的擷取來源。', 'Use the media library\'s "Preview" to play the original vocal track on its own, or open the vocals file in another player; then in the Windows Volume Mixer, route that player\'s audio to your headphone device only — never into OBS\'s capture source.', 'メディアライブラリの「試聴」で原曲ボーカルトラックを単独再生するか、別のプレイヤーでvocalsファイルを開きます。そのプレイヤーの音声をWindowsの「音量ミキサー」でヘッドホンデバイスのみに割り当て、OBSのキャプチャソースには入れないでください。', '미디어 라이브러리의 "미리 듣기"로 원곡 보컬 트랙만 재생하거나, 다른 플레이어로 vocals 파일을 여세요. 그 플레이어의 소리를 Windows "볼륨 믹서"에서 헤드폰 장치로만 지정하고, OBS 캡처 소스에는 넣지 마세요.', '用媒体库的“试听”单独播原唱人声轨，或用另一个播放器开 vocals 档；把这个播放程序的声音，在 Windows“音量混合器”指定到你的耳机设备，不要进 OBS 的采集来源。'],
    'help.dualAudio.obsWayLabel': ['用 OBS 做法（進階）', 'The OBS way (advanced)', 'OBSでの方法（上級）', 'OBS 방식(고급)', '用 OBS 做法（进阶）'],
    'help.dualAudio.obsWay': ['把「原唱參考」放成 OBS 的一個獨立音訊來源，在「進階音訊內容」把它的「音訊監控」設成「僅監聽」，並取消它在直播／錄影軌道的勾選。這樣只有你戴耳機聽得到，觀眾聽不到。', 'Add the "original-vocal reference" as its own OBS audio source, set its "Audio Monitoring" to "Monitor Only" in Advanced Audio Properties, and uncheck it from the stream/recording tracks. That way only you, wearing headphones, hear it — never the audience.', '「原曲リファレンス」をOBSの独立したオーディオソースとして追加し、「詳細オーディオプロパティ」で「オーディオモニタリング」を「モニターのみ」に設定し、配信／録画トラックのチェックを外します。これでヘッドホンをつけているあなただけが聞こえ、視聴者には聞こえません。', '"원곡 참고음"을 OBS의 별도 오디오 소스로 추가하고, "고급 오디오 속성"에서 "오디오 모니터링"을 "모니터링만"으로 설정한 뒤 방송/녹화 트랙 체크를 해제하세요. 이렇게 하면 헤드폰을 낀 본인만 듣고 시청자는 듣지 못합니다.', '把“原唱参考”放成 OBS 的一个独立音频来源，在“高级音频属性”把它的“音频监听”设成“仅监听”，并取消它在直播／录制轨道的勾选。这样只有你戴耳机听得到，观众听不到。'],
    'help.dualAudio.simplestAlternativeLabel': ['最簡單的替代方案', 'The simplest alternative', '最も簡単な代替案', '가장 간단한 대안', '最简单的替代方案'],
    'help.dualAudio.simplestAlternative': ['不需要導唱就別開原唱那條——只播伴奏、看著首頁的逐字歌詞跟拍，一樣能唱，設定也最不容易出錯。', 'If you don\'t need a vocal guide, just skip the original-vocal path entirely — play only the instrumental and follow along with the word-by-word lyrics on the home screen. You can still sing along, and there\'s much less to misconfigure.', 'ガイドが不要なら原曲側は開かなくて構いません。伴奏だけを再生し、ホーム画面の一字ずつ表示される歌詞を見ながら歌えば十分で、設定ミスも起きにくくなります。', '가이드가 필요 없다면 원곡 경로 자체를 열지 않아도 됩니다. 반주만 재생하고 홈 화면의 한 글자씩 표시되는 가사를 보며 따라 부르면 되고, 설정 실수도 훨씬 적습니다.', '不需要导唱就别开原唱那条——只播伴奏、看着首页的逐字歌词跟拍，一样能唱，设定也最不容易出错。'],
    'help.dualAudio.reminderLabel': ['提醒', 'Reminder', '注意', '알림', '提醒'],
    'help.dualAudio.reminder': ['務必先在錄一小段測試檔、或找一個人幫你聽直播，確認觀眾端「真的只有伴奏」再正式開唱。', 'Always record a short test clip first, or have someone else listen to your stream, to confirm the audience side truly hears only the instrumental before you start singing for real.', '正式に歌い始める前に、必ず短いテスト録音をするか、誰かに配信を聞いてもらい、視聴者側が本当に伴奏だけを聞いているか確認してください。', '실제로 노래를 시작하기 전에 반드시 짧은 테스트 녹화를 하거나 다른 사람에게 방송을 들어달라고 해서, 시청자 쪽에 정말 반주만 들리는지 확인하세요.', '务必先在录一小段测试档、或找一个人帮你听直播，确认观众端“真的只有伴奏”再正式开唱。'],
    'home.ai.listTitle': ['本場清單的伴奏狀態', 'Instrumental status for this playlist', 'このプレイリストの伴奏状態', '이 재생 목록의 반주 상태', '本场清单的伴奏状态'],
    'home.ai.coverage': ['已完成 {done} / {total} 首', '{done} / {total} done', '{done} / {total} 曲完了', '{done} / {total}곡 완료', '已完成 {done} / {total} 首'],
    'home.ai.empty': ['播放清單裡有歌之後，這裡會列出每首的伴奏狀態。', 'Once the playlist has songs, each one’s instrumental status is listed here.', 'プレイリストに曲が入ると、各曲の伴奏状態がここに表示されます。', '재생 목록에 곡이 들어오면 각 곡의 반주 상태가 여기에 표시됩니다.', '播放清单里有歌之后，这里会列出每首的伴奏状态。'],
    'home.ai.untitled': ['未命名', 'Untitled', '無題', '제목 없음', '未命名'],
    'home.ai.status.done': ['已分離', 'Made', '分離済み', '완료됨', '已分离'],
    'home.ai.status.working': ['製作中', 'In progress', '作成中', '진행 중', '制作中'],
    'home.ai.status.failed': ['失敗', 'Failed', '失敗', '실패', '失败'],
    'home.ai.status.none': ['未製作', 'Not made', '未作成', '안 만듦', '未制作'],
    'home.ai.make': ['製作伴奏', 'Make instrumental', '伴奏を作成', '반주 만들기', '制作伴奏'],
    'home.ai.retry': ['重試', 'Retry', '再試行', '다시 시도', '重试'],
    'home.ai.startFailed': ['啟動分離失敗：{message}', 'Could not start separation: {message}', '分離を開始できませんでした：{message}', '분리를 시작할 수 없습니다: {message}', '启动分离失败：{message}'],
    'home.ai.cancelFailed': ['取消失敗，工作可能已經結束', 'Cancel failed; the job may have already finished', 'キャンセルできませんでした。処理は既に終了している可能性があります', '취소하지 못했습니다. 작업이 이미 끝났을 수 있습니다', '取消失败，任务可能已经结束'],
    'home.ai.queueAllPartial': ['有 {count} 首沒能排進佇列', '{count} could not be queued', '{count} 曲をキューに追加できませんでした', '{count}곡을 대기열에 추가하지 못했습니다', '有 {count} 首没能排进队列'],
    'home.lyricNow.label': ['目前歌詞（對時用）', 'Current lyric (for timing)', '現在の歌詞（タイミング用）', '현재 가사(타이밍용)', '当前歌词（对时用）'],
    'home.lyricNow.empty': ['尚無歌詞', 'No lyrics yet', 'まだ歌詞がありません', '아직 가사가 없습니다', '尚无歌词'],
    'home.countdownAlign.boxLabel': ['倒數對齊：從第一句前 10 秒開始播放並倒數；聽到第一個字時按「對齊第一句」定位', 'Countdown align: playback starts 10s before the first line and counts down; tap "Align first line" when you hear the first word', 'カウントダウン合わせ：最初の行の 10 秒前から再生してカウントダウン。最初の言葉が聞こえたら「最初の行に合わせる」を押す', '카운트다운 정렬: 첫 줄 10초 전부터 재생하며 카운트다운; 첫 단어가 들리면 "첫 줄 맞추기"를 누르세요', '倒数对齐：从第一句前 10 秒开始播放并倒数；听到第一个字时按“对齐第一句”定位'],
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
    'source.youtubeModeLabel': ['YouTube 匯入方式', 'YouTube import method', 'YouTube インポート方法', 'YouTube 가져오기 방식', 'YouTube 导入方式'],
    'source.youtubeModeLink': ['貼上連結', 'Paste link', 'リンクを貼り付け', '링크 붙여넣기', '粘贴链接'],
    'source.youtubeModeSearch': ['搜尋 YouTube', 'Search YouTube', 'YouTube を検索', 'YouTube 검색', '搜索 YouTube'],
    'source.importAudio': ['匯入音訊', 'Import audio', '音声をインポート', '오디오 가져오기', '导入音频'],
    'youtubeSearch.label': ['搜尋歌手或歌名', 'Search by artist or song', '歌手名または曲名で検索', '가수 또는 곡명으로 검색', '搜索歌手或歌名'],
    'youtubeSearch.placeholder': ['例如：周杰倫 稻香', 'Example: Aimer Zankyosanka', '例：Aimer 残響散歌', '예: 아이유 좋은 날', '例如：周杰伦 稻香'],
    'youtubeSearch.submit': ['搜尋', 'Search', '検索', '검색', '搜索'],
    'youtubeSearch.searching': ['正在搜尋 YouTube…', 'Searching YouTube…', 'YouTube を検索しています…', 'YouTube 검색 중…', '正在搜索 YouTube…'],
    'youtubeSearch.empty': ['找不到符合的影片，請換一組歌手或歌名。', 'No matching videos. Try a different artist or title.', '一致する動画がありません。歌手名や曲名を変えてください。', '일치하는 동영상이 없습니다. 가수 또는 곡명을 바꿔 보세요.', '找不到符合的视频，请更换歌手或歌名。'],
    'youtubeSearch.failed': ['搜尋失敗：{message}', 'Search failed: {message}', '検索に失敗しました：{message}', '검색 실패: {message}', '搜索失败：{message}'],
    'youtubeSearch.timeout': ['搜尋逾時，請稍後再試', 'Search timed out. Try again shortly.', '検索がタイムアウトしました。しばらくしてから再試行してください。', '검색 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', '搜索超时，请稍后再试'],
    'youtubeSearch.runtimeMissing': ['找不到 YouTube 搜尋元件，請到「連線與系統」重新檢查', 'The YouTube search component is missing. Recheck it under Connections & System.', 'YouTube 検索コンポーネントが見つかりません。「接続とシステム」で再確認してください。', 'YouTube 검색 구성 요소를 찾을 수 없습니다. 연결 및 시스템에서 다시 확인하세요.', '找不到 YouTube 搜索组件，请到“连接与系统”重新检查'],
    'youtubeSearch.unavailable': ['YouTube 搜尋暫時無法使用（{status}）', 'YouTube search is temporarily unavailable ({status}).', 'YouTube 検索は一時的に利用できません（{status}）。', 'YouTube 검색을 일시적으로 사용할 수 없습니다({status}).', 'YouTube 搜索暂时无法使用（{status}）'],
    'youtubeSearch.resultCount': ['找到 {count} 筆結果', 'Found {count} results', '{count} 件見つかりました', '{count}개 결과를 찾았습니다', '找到 {count} 条结果'],
    'youtubeSearch.clear': ['清除結果', 'Clear results', '結果をクリア', '결과 지우기', '清除结果'],
    'youtubeSearch.loadMore': ['找更多結果', 'Load more', 'もっと表示', '더 불러오기', '加载更多'],
    'youtubeSearch.loadingMore': ['載入中…', 'Loading…', '読み込み中…', '로드 중…', '加载中…'],
    'youtubeSearch.compilation': ['合輯', 'Compilation', 'メドレー', '모음집', '合辑'],
    'youtubeSearch.choose': ['選這首', 'Choose', 'この曲を選ぶ', '이 곡 선택', '选择这首'],
    'youtubeSearch.queued': ['已加入匯入佇列', 'Added to import queue', 'インポートキューに追加しました', '가져오기 대기열에 추가했습니다', '已加入导入队列'],
    'youtubeSearch.views': ['{count} 次觀看', '{count} views', '{count} 回視聴', '조회수 {count}회', '{count} 次观看'],
    'youtubeSearch.unknownChannel': ['未知頻道', 'Unknown channel', '不明なチャンネル', '알 수 없는 채널', '未知频道'],
    'youtubeSearch.unknownDuration': ['時長未知', 'Duration unknown', '長さ不明', '길이 알 수 없음', '时长未知'],
    'youtubeSearch.live': ['目前直播中，不能匯入', 'Live now; cannot import', 'ライブ配信中のためインポートできません', '현재 라이브 중이라 가져올 수 없습니다', '当前直播中，无法导入'],
    'youtubeSearch.upcoming': ['尚未開始，不能匯入', 'Upcoming; cannot import', '開始前のためインポートできません', '아직 시작되지 않아 가져올 수 없습니다', '尚未开始，无法导入'],
    'youtubeSearch.short': ['短影片', 'Short video', '短い動画', '짧은 동영상', '短视频'],
    'youtubeSearch.autoSeparate': ['匯入後製作伴奏', 'Create instrumental after import', 'インポート後に伴奏を作成', '가져온 뒤 반주 만들기', '导入后制作伴奏'],
    'youtubeSearch.autoSeparateHint': ['下載成功後自動排入 AI 人聲分離；預設關閉', 'Queue AI vocal separation after a successful download; off by default', 'ダウンロード成功後に AI ボーカル分離へ追加します。初期設定はオフです', '다운로드에 성공하면 AI 보컬 분리를 대기열에 추가합니다. 기본값은 꺼짐입니다', '下载成功后自动加入 AI 人声分离队列；默认关闭'],
    'source.warningDisabled': ['匯入警告已關閉，遇到可疑影片會自動繼續。', 'Import warnings are off; suspicious videos will continue automatically.', 'インポート警告はオフです。疑わしい動画も自動的に続行します。', '가져오기 경고가 꺼져 있어 의심스러운 동영상도 자동으로 계속됩니다.', '导入警告已关闭，遇到可疑视频会自动继续。'],
    'source.reenableWarnings': ['重新啟用', 'Turn back on', '再度有効にする', '다시 켜기', '重新启用'],
    'source.workCenter': ['工作中心', 'Work center', '作業センター', '작업 센터', '工作中心'],
    'source.clearCompleted': ['清除已完成', 'Clear completed', '完了分を消去', '완료 항목 지우기', '清除已完成'],
    'source.dropFiles': ['拖放音訊檔案到這裡', 'Drop audio files here', '音声ファイルをここにドロップ', '오디오 파일을 여기에 놓으세요', '将音频文件拖放到这里'],
    'source.supportedFormats': ['支援 MP3 / FLAC / WAV / M4A / OGG', 'Supports MP3 / FLAC / WAV / M4A / OGG', 'MP3 / FLAC / WAV / M4A / OGG に対応', 'MP3 / FLAC / WAV / M4A / OGG 지원', '支持 MP3 / FLAC / WAV / M4A / OGG'],
    'source.chooseFiles': ['選擇檔案', 'Choose files', 'ファイルを選択', '파일 선택', '选择文件'],
    'preview.title': ['歌詞即時預覽', 'Live lyrics preview', '歌詞ライブプレビュー', '실시간 가사 미리보기', '歌词实时预览'],
    'preview.sampleLyrics': ['示範歌詞', 'Sample lyrics', 'サンプル歌詞', '샘플 가사', '示范歌词'],
    'preview.sampleLine1': ['這是一句示範用的歌詞 This is an example lyric.', 'This is a sample lyric This is an example lyric.', 'これはサンプル用の歌詞です This is an example lyric.', '이것은 샘플용 가사입니다 This is an example lyric.', '这是一句示范用的歌词 This is an example lyric.'],
    'preview.sampleLine2': ['字體效果測試 Font preview sample.', 'Font effect test Font preview sample.', 'フォント効果テスト Font preview sample.', '글꼴 효과 테스트 Font preview sample.', '字体效果测试 Font preview sample.'],
    'settings.lyrics.progressBar': ['底部進度條', 'Bottom progress bar', '下部の進行バー', '하단 진행 바', '底部进度条'],
    'settings.lyrics.progressBarHint': ['畫面最下緣 2px 的歌曲進度條；OBS 不想要可以關掉', 'A 2px song progress bar at the very bottom. Turn it off if you do not want it in OBS.', '画面最下部の 2px の曲進行バー。OBS で不要ならオフにできます。', '화면 맨 아래 2px 곡 진행 바. OBS에서 원하지 않으면 끌 수 있습니다.', '画面最下缘 2px 的歌曲进度条；OBS 不想要可以关掉'],
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
    'import.duplicate.title': ['歌庫已經有這首歌', 'Already in your library', 'このライブラリには既にあります', '라이브러리에 이미 있는 곡입니다', '歌库中已经有这首歌'],
    'import.duplicate.summary': ['歌手/歌名相符的版本已在媒體庫：{label}', 'A version with the same artist and title is already in your library: {label}', '同じ歌手・曲名のバージョンが既にライブラリにあります：{label}', '아티스트/제목이 일치하는 버전이 라이브러리에 이미 있습니다: {label}', '歌手/歌名相符的版本已在媒体库：{label}'],
    'import.duplicate.impact': ['取代：移除舊版本，改用這次抓到的新版本。略過：保留舊版本，不重複下載。', 'Replace removes the old version and uses this new one. Skip keeps the old version and does not download again.', '「置き換え」は旧バージョンを削除して新しいバージョンを使用します。「スキップ」は旧バージョンを保持し、再ダウンロードしません。', '"교체"는 이전 버전을 제거하고 새 버전을 사용합니다. "건너뛰기"는 이전 버전을 유지하고 다시 다운로드하지 않습니다.', '替换：移除旧版本，改用这次抓到的新版本。跳过：保留旧版本，不重复下载。'],
    'import.duplicate.replace': ['取代', 'Replace', '置き換え', '교체', '替换'],
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
    'import.separation.starting': ['已匯入，正在啟動人聲分離', 'Imported; starting vocal separation', 'インポート完了。ボーカル分離を開始しています', '가져오기 완료. 보컬 분리를 시작하는 중입니다', '已导入，正在启动人声分离'],
    'import.separation.queued': ['已匯入，等待人聲分離（第 {position} 位）', 'Imported; waiting for vocal separation (position {position})', 'インポート完了。ボーカル分離待ち（{position} 番目）', '가져오기 완료. 보컬 분리 대기 중 ({position}번째)', '已导入，等待人声分离（第 {position} 位）'],
    'import.separation.state': ['已匯入，{state} {percent}', 'Imported; {state} {percent}', 'インポート完了。{state} {percent}', '가져오기 완료. {state} {percent}', '已导入，{state} {percent}'],
    'import.separation.prepareFailed': ['無法準備 AI 伴奏元件：{message}', 'Could not prepare AI instrumental components: {message}', 'AI 伴奏コンポーネントを準備できません：{message}', 'AI 반주 구성 요소를 준비할 수 없습니다: {message}', '无法准备 AI 伴奏组件：{message}'],
    'import.separation.notEnabled': ['尚未啟用 AI 伴奏製作', 'AI instrumental creation was not enabled', 'AI 伴奏作成が有効になっていません', 'AI 반주 제작이 활성화되지 않았습니다', '尚未启用 AI 伴奏制作'],
    'import.separation.completed': ['已加入播放清單並完成伴奏製作：{title}', 'Added to playlist and instrumental created: {title}', 'プレイリストに追加し、伴奏を作成しました：{title}', '재생목록에 추가하고 반주 제작 완료: {title}', '已加入播放列表并完成伴奏制作：{title}'],
    'import.separation.failedAfterImport': ['歌曲已匯入，但伴奏製作未完成：{message}', 'Track imported, but instrumental creation did not finish: {message}', '曲はインポートしましたが、伴奏を作成できませんでした：{message}', '곡은 가져왔지만 반주 제작을 완료하지 못했습니다: {message}', '歌曲已导入，但伴奏制作未完成：{message}'],
    'import.separation.unknownFailure': ['未知的分離錯誤', 'Unknown separation error', '不明な分離エラー', '알 수 없는 분리 오류', '未知的分离错误'],
    'import.separation.timeout': ['等待人聲分離完成逾時', 'Timed out waiting for vocal separation', 'ボーカル分離の完了待ちがタイムアウトしました', '보컬 분리 완료 대기 시간이 초과되었습니다', '等待人声分离完成超时'],
    'import.separation.cancelled': ['歌曲已匯入，人聲分離已取消', 'Track imported; vocal separation cancelled', '曲はインポートしました。ボーカル分離はキャンセルされました', '곡은 가져왔고 보컬 분리는 취소되었습니다', '歌曲已导入，人声分离已取消'],
    'aiInstall.title': ['首次啟用 AI 伴奏製作', 'Enable AI instrumental creation', 'AI 伴奏作成を初めて有効にする', 'AI 반주 제작 처음 사용', '首次启用 AI 伴奏制作'],
    'aiInstall.summary': ['需要先下載完整的離線分離元件。安裝完成後約佔 7.3 GB，安裝過程需要至少 9 GB 可用空間。', 'The complete offline separation package must be downloaded first. It uses about 7.3 GB after installation and needs at least 9 GB free during setup.', '完全なオフライン分離コンポーネントを先にダウンロードします。インストール後は約 7.3 GB、セットアップ中は最低 9 GB の空き容量が必要です。', '먼저 전체 오프라인 분리 구성 요소를 다운로드해야 합니다. 설치 후 약 7.3GB를 사용하며 설치 중 최소 9GB의 여유 공간이 필요합니다.', '需要先下载完整的离线分离组件。安装完成后约占 7.3 GB，安装过程需要至少 9 GB 可用空间。'],
    'aiInstall.orderLabel': ['自動備援順序', 'Automatic fallback order', '自動フォールバック順序', '자동 대체 순서', '自动备用顺序'],
    'aiInstall.python': ['Python GPU 主引擎', 'Python GPU primary engine', 'Python GPU メインエンジン', 'Python GPU 기본 엔진', 'Python GPU 主引擎'],
    'aiInstall.webgpu': ['WebGPU 自動備援', 'Automatic WebGPU fallback', 'WebGPU 自動フォールバック', 'WebGPU 자동 대체', 'WebGPU 自动备用'],
    'aiInstall.cpu': ['CPU 最後備援', 'CPU final fallback', 'CPU 最終フォールバック', 'CPU 최종 대체', 'CPU 最后备用'],
    'aiInstall.shared': ['CPU 會共用 Python 元件，不會再下載第三套模型。下載完成前請保持程式開啟。', 'CPU uses the same Python components, so no third model is downloaded. Keep the app open until setup finishes.', 'CPU は Python コンポーネントを共有するため、3 つ目のモデルはダウンロードしません。完了までアプリを開いたままにしてください。', 'CPU는 Python 구성 요소를 함께 사용하므로 세 번째 모델을 다운로드하지 않습니다. 완료될 때까지 앱을 열어 두세요.', 'CPU 会共用 Python 组件，不会再下载第三套模型。下载完成前请保持程序开启。'],
    'aiInstall.confirm': ['下載並啟用', 'Download and enable', 'ダウンロードして有効化', '다운로드 및 사용', '下载并启用'],
    'aiInstall.downloading': ['正在下載完整元件…', 'Downloading complete package…', '完全なコンポーネントをダウンロード中…', '전체 구성 요소 다운로드 중…', '正在下载完整组件…'],
    'aiInstall.retry': ['重新下載', 'Retry download', '再ダウンロード', '다시 다운로드', '重新下载'],
    'aiInstall.failed': ['元件下載失敗', 'Component download failed', 'コンポーネントのダウンロードに失敗しました', '구성 요소 다운로드 실패', '组件下载失败'],
    'aiInstall.incomplete': ['下載跑完了，但元件仍不齊（通常是缺 FFmpeg）。按「重新下載」補齊，或先關掉這個視窗。', 'The download finished but the package is still incomplete (usually FFmpeg is missing). Press Retry to finish, or close this window for now.', 'ダウンロードは終わりましたが、コンポーネントがまだ揃っていません（通常は FFmpeg 不足）。「再ダウンロード」で補完するか、ひとまずこのウィンドウを閉じてください。', '다운로드는 끝났지만 구성 요소가 아직 완전하지 않습니다(보통 FFmpeg 누락). 다시 다운로드를 눌러 완료하거나 이 창을 닫으세요.', '下载跑完了，但组件仍不齐（通常是缺 FFmpeg）。按“重新下载”补齐，或先关掉这个窗口。'],
    'aiInstall.statusFailed': ['無法讀取 AI 伴奏元件狀態', 'Could not read AI component status', 'AI コンポーネントの状態を取得できません', 'AI 구성 요소 상태를 읽을 수 없습니다', '无法读取 AI 伴奏组件状态'],
    'aiInstall.stagePreparing': ['準備下載…', 'Preparing download…', 'ダウンロードを準備中…', '다운로드 준비 중…', '准备下载…'],
    'aiInstall.stageDone': ['完整元件已就緒', 'Complete package is ready', '完全なコンポーネントの準備が完了しました', '전체 구성 요소 준비 완료', '完整组件已就绪'],
    'aiInstall.webgpuSkipped': ['WebGPU 備援模型沒下載成功，不影響製作伴奏；之後可在設定裡重試。', 'The WebGPU fallback model did not download. Instrumental creation still works; you can retry it later in settings.', 'WebGPU フォールバックモデルをダウンロードできませんでした。伴奏の作成は可能です。設定から後で再試行できます。', 'WebGPU 대체 모델을 다운로드하지 못했습니다. 반주 제작은 가능하며, 나중에 설정에서 다시 시도할 수 있습니다.', 'WebGPU 备用模型没有下载成功，不影响制作伴奏；之后可在设置里重试。'],
    'aiInstall.step.ffmpeg': ['下載音訊轉檔元件 FFmpeg…', 'Downloading FFmpeg audio converter…', '音声変換コンポーネント FFmpeg をダウンロード中…', '오디오 변환 구성 요소 FFmpeg 다운로드 중…', '下载音频转换组件 FFmpeg…'],
    'aiInstall.ffmpegFailed': ['FFmpeg 下載失敗，AI 伴奏製作需要它才能讀取音檔', 'FFmpeg download failed; AI instrumental creation needs it to read audio', 'FFmpeg のダウンロードに失敗しました。AI 伴奏作成には音声の読み込みに必要です', 'FFmpeg 다운로드 실패. AI 반주 제작에는 오디오를 읽기 위해 FFmpeg가 필요합니다', 'FFmpeg 下载失败，AI 伴奏制作需要它才能读取音频'],
    'aiInstall.step.pythonPrep': ['準備 Python 執行環境…', 'Preparing Python runtime…', 'Python ランタイムを準備中…', 'Python 런타임 준비 중…', '准备 Python 运行环境…'],
    'aiInstall.step.downloadPython': ['下載 Python 執行環境 {detail}', 'Downloading Python runtime {detail}', 'Python ランタイムをダウンロード中 {detail}', 'Python 런타임 다운로드 중 {detail}', '下载 Python 运行环境 {detail}'],
    'aiInstall.step.verify': ['驗證檔案完整性…', 'Verifying file integrity…', 'ファイルの整合性を検証中…', '파일 무결성 확인 중…', '验证文件完整性…'],
    'aiInstall.step.extract': ['解壓縮 Python 執行環境…', 'Extracting Python runtime…', 'Python ランタイムを展開中…', 'Python 런타임 압축 해제 중…', '解压 Python 运行环境…'],
    'aiInstall.step.bootstrapPip': ['準備套件管理器…', 'Setting up package manager…', 'パッケージマネージャーを準備中…', '패키지 관리자 준비 중…', '准备包管理器…'],
    'aiInstall.step.pipResolve': ['解析相依套件…', 'Resolving dependencies…', '依存パッケージを解決中…', '의존성 확인 중…', '解析依赖套件…'],
    'aiInstall.step.pipDownload': ['下載相依套件（含 PyTorch）{detail}', 'Downloading packages (incl. PyTorch) {detail}', 'パッケージをダウンロード中（PyTorch 含む）{detail}', '패키지 다운로드 중(PyTorch 포함) {detail}', '下载依赖套件（含 PyTorch）{detail}'],
    'aiInstall.step.pipInstall': ['安裝套件中（解壓 PyTorch，約 1–3 分鐘，不會卡住）', 'Installing packages (unpacking PyTorch, ~1–3 min, not stuck)', 'パッケージをインストール中（PyTorch を展開、約 1〜3 分。停止していません）', '패키지 설치 중(PyTorch 압축 해제, 약 1~3분, 멈춘 것이 아닙니다)', '安装套件中（解压 PyTorch，约 1–3 分钟，不会卡住）'],
    'aiInstall.step.primaryModel': ['下載主分離模型 {detail}', 'Downloading primary separation model {detail}', 'メイン分離モデルをダウンロード中 {detail}', '기본 분리 모델 다운로드 중 {detail}', '下载主分离模型 {detail}'],
    'aiInstall.step.webgpuModel': ['下載 WebGPU 備援模型（{n}/{c}）{detail}', 'Downloading WebGPU fallback model ({n}/{c}) {detail}', 'WebGPU フォールバックモデルをダウンロード中（{n}/{c}）{detail}', 'WebGPU 대체 모델 다운로드 중({n}/{c}) {detail}', '下载 WebGPU 备用模型（{n}/{c}）{detail}'],
    'aiInstall.featureName': ['AI 伴奏製作（實驗性）', 'AI instrumental creation (experimental)', 'AI 伴奏作成（実験的）', 'AI 반주 제작(실험적)', 'AI 伴奏制作（实验性）'],
    'aiInstall.downloadComponents': ['下載完整元件', 'Download complete package', '完全なコンポーネントをダウンロード', '전체 구성 요소 다운로드', '下载完整组件'],
    'aiInstall.viewProgress': ['查看下載進度', 'View download progress', 'ダウンロード進捗を表示', '다운로드 진행률 보기', '查看下载进度'],
    'aiInstall.notInstalled': ['尚未安裝', 'Not installed', '未インストール', '설치되지 않음', '尚未安装'],
    'aiInstall.checkFailed': ['檢查失敗', 'Check failed', '確認に失敗しました', '확인 실패', '检查失败'],
    'aiInstall.featureHint': ['程式會自動依序使用 Python GPU、WebGPU、CPU，不需要手動選引擎。第三方模型作者的書面授權確認目前仍在等待中。', 'The app automatically tries Python GPU, WebGPU, then CPU; there is no engine selection. Written authorization from the third-party model author is still pending.', 'Python GPU、WebGPU、CPU の順に自動で使用するため、エンジンを選ぶ必要はありません。第三者モデル作者の書面による許可は現在も確認待ちです。', '앱이 Python GPU, WebGPU, CPU 순으로 자동 사용하므로 엔진을 직접 선택할 필요가 없습니다. 타사 모델 작성자의 서면 허가는 아직 확인 중입니다.', '程序会自动依次使用 Python GPU、WebGPU、CPU，无需手动选择引擎。第三方模型作者的书面授权确认目前仍在等待中。'],
    'aiJob.queued': ['排隊中（第 {position} 位）', 'Queued (position {position})', '待機中（{position} 番目）', '대기 중({position}번째)', '排队中（第 {position} 位）'],
    'aiJob.preparing': ['準備 AI 伴奏', 'Preparing AI instrumental', 'AI 伴奏を準備中', 'AI 반주 준비 중', '准备 AI 伴奏'],
    'aiJob.webgpuFallback': ['正在改用 WebGPU 備援', 'Switching to WebGPU fallback', 'WebGPU フォールバックへ切り替え中', 'WebGPU 대체로 전환 중', '正在改用 WebGPU 备用'],
    'aiJob.cpuFallback': ['GPU 加速無法使用，正在改用 CPU（較慢）', 'GPU acceleration unavailable; switching to CPU (slower)', 'GPU アクセラレーションを使用できないため CPU へ切り替え中（低速）', 'GPU 가속을 사용할 수 없어 CPU로 전환 중(느림)', 'GPU 加速无法使用，正在改用 CPU（较慢）'],
    'aiJob.preparingModel': ['準備分離模型', 'Preparing separation model', '分離モデルを準備中', '분리 모델 준비 중', '准备分离模型'],
    'aiJob.preparingAudio': ['準備音訊', 'Preparing audio', '音声を準備中', '오디오 준비 중', '准备音频'],
    'aiJob.separating': ['製作伴奏中', 'Creating instrumental', '伴奏を作成中', '반주 제작 중', '正在制作伴奏'],
    'aiJob.done': ['伴奏製作完成', 'Instrumental complete', '伴奏の作成が完了しました', '반주 제작 완료', '伴奏制作完成'],
    'aiJob.error': ['伴奏製作失敗', 'Instrumental creation failed', '伴奏を作成できませんでした', '반주 제작 실패', '伴奏制作失败'],
    'aiJob.engineUnavailable': ['AI 引擎無法啟動，請重新安裝或回報問題', 'The AI engine could not start; reinstall or report the problem', 'AI エンジンを起動できません。再インストールするか問題を報告してください', 'AI 엔진을 시작할 수 없습니다. 다시 설치하거나 문제를 신고해 주세요', 'AI 引擎无法启动，请重新安装或回报问题'],
    'aiJob.action': ['製作 AI 伴奏（實驗性）', 'Create AI instrumental (experimental)', 'AI 伴奏を作成（実験的）', 'AI 반주 제작(실험적)', '制作 AI 伴奏（实验性）'],
    'aiJob.retryAction': ['重試製作 AI 伴奏', 'Retry AI instrumental', 'AI 伴奏作成を再試行', 'AI 반주 제작 다시 시도', '重试制作 AI 伴奏'],
    'aiJob.completedAction': ['AI 伴奏已完成', 'AI instrumental ready', 'AI 伴奏の準備完了', 'AI 반주 준비 완료', 'AI 伴奏已完成'],
    'aiJob.cancelled': ['已取消', 'Cancelled', 'キャンセルしました', '취소됨', '已取消'],
    'aiJob.cancelAction': ['取消分離', 'Cancel separation', '分離をキャンセル', '분리 취소', '取消分离'],
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
    'validation.searchLength': ['搜尋文字需為 2–100 個字元', 'Search text must be 2–100 characters', '検索文字は 2～100 文字で入力してください', '검색어는 2~100자여야 합니다', '搜索文字需为 2–100 个字符'],
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
    'system.obsLocaleLabel': ['OBS 顯示語言', 'OBS display language', 'OBS 表示言語', 'OBS 표시 언어', 'OBS 显示语言'],
    'system.obsLocaleFollow': ['跟隨面板語言', 'Follow the panel language', 'パネルの言語に合わせる', '패널 언어를 따름', '跟随面板语言'],
    'system.obsLocaleHint': ['歌詞畫面與歌單畫面用哪個語言顯示，直播中途改也會立刻套用，不用重新複製網址。選「跟隨面板語言」時就跟著上方語言切換；想讓面板中文、OBS 英文就在這裡直接指定。（網址若自己帶了 ?lang=，那個網址會釘死語言、不受這裡影響。）', 'Which language the lyrics and setlist displays use. Changes apply immediately, even mid-stream, with no need to copy the URLs again. Follow the panel language, or pin a different one here if you want the panel in one language and OBS in another. (A URL that carries its own ?lang= stays pinned to that language and ignores this setting.)', '歌詞画面とセットリスト画面の表示言語です。配信中に変更してもすぐ反映され、URL を貼り直す必要はありません。パネルに合わせるか、パネルは日本語で OBS は英語といった使い方ならここで直接指定します。（?lang= 付きの URL はその言語に固定され、この設定を無視します。）', '가사 화면과 세트리스트 화면에 쓸 언어입니다. 방송 중에 바꿔도 즉시 적용되며 URL을 다시 복사할 필요가 없습니다. 패널 언어를 따르거나, 패널은 한국어·OBS는 영어처럼 쓰고 싶으면 여기서 직접 지정하세요. (URL에 ?lang= 가 붙어 있으면 그 언어로 고정되어 이 설정을 무시합니다.)', '歌词画面与歌单画面用哪个语言显示，直播中途改也会立刻应用，不用重新复制网址。选“跟随面板语言”就跟着上方语言切换；想让面板中文、OBS 英文就在这里直接指定。（网址若自己带了 ?lang=，那个网址会固定语言、不受这里影响。）'],
    'system.obsUrlHint': ['在 OBS 新增「瀏覽器」來源後貼上對應網址；或用下方 OBS 連動一次建立兩個來源。', 'Paste these URLs into OBS Browser Sources, or use OBS integration below to create both at once.', 'OBS の「ブラウザ」ソースに URL を貼るか、下の OBS 連携で両方を作成します。', 'OBS 브라우저 소스에 URL을 붙여넣거나 아래 OBS 연동으로 두 소스를 한 번에 만드세요.', '在 OBS 新增“浏览器”来源后粘贴对应网址；或用下方 OBS 联动一次创建两个来源。'],
    'system.remote': ['手機遙控器', 'Mobile remote', 'モバイルリモコン', '모바일 리모컨', '手机遥控器'],
    'system.remoteHint': ['手機和電腦連上同一個 Wi-Fi，掃描 QR code 或輸入網址即可遙控播放；不要開放到外網。', 'Connect your phone and computer to the same Wi-Fi, then scan the QR code or enter the URL. Do not expose it to the internet.', 'スマートフォンと PC を同じ Wi-Fi に接続し、QR コードまたは URL で操作してください。外部公開はしないでください。', '휴대폰과 컴퓨터를 같은 Wi-Fi에 연결한 뒤 QR 코드나 URL로 조작하세요. 외부 인터넷에 공개하지 마세요.', '手机和电脑连接同一 Wi-Fi，扫描二维码或输入网址即可遥控播放；请勿开放到外网。'],
    'system.detectingLan': ['偵測區網位址中…', 'Detecting LAN address…', 'LAN アドレスを検出中…', 'LAN 주소 확인 중…', '正在检测局域网地址…'],
    'system.remoteQrAlt': ['手機遙控器 QR code', 'Mobile remote QR code', 'モバイルリモコン QR コード', '모바일 리모컨 QR 코드', '手机遥控器二维码'],
    'system.remoteUrlHint': ['手機瀏覽器打開這個網址（不是 localhost），會自動轉到遙控器頁面。', 'Open this URL on your phone (not localhost) to reach the remote.', 'スマートフォンでこの URL（localhost ではありません）を開くとリモコンへ移動します。', '휴대폰에서 이 URL(localhost 아님)을 열면 리모컨으로 이동합니다.', '在手机浏览器打开这个网址（不是 localhost），会自动转到遥控器页面。'],
    'system.pairingGenerate': ['產生配對 QR Code', 'Generate pairing QR code', 'ペアリング QR コードを生成', '페어링 QR 코드 생성', '生成配对 QR Code'],
    'system.pairingRevokeAll': ['撤銷所有手機', 'Revoke all phones', 'すべてのスマホを解除', '모든 휴대폰 해제', '撤销所有手机'],
    'system.pairingIdle': ['掃描前請先產生一次性配對 QR Code。', 'Generate a one-time pairing QR code before scanning.', 'スキャンする前に、使い捨てのペアリング QR コードを生成してください。', '스캔하기 전에 일회용 페어링 QR 코드를 생성하세요.', '扫描前请先生成一次性配对 QR Code。'],
    'system.pairingCreating': ['正在建立一次性配對 QR Code…', 'Creating a one-time pairing QR code…', '使い捨てのペアリング QR コードを作成しています…', '일회용 페어링 QR 코드를 만드는 중…', '正在创建一次性配对 QR Code…'],
    'system.pairingCreated': ['QR Code 已建立，請在 {minutes} 分鐘內掃描；每張只能配對一台手機。', 'QR code created. Scan it within {minutes} minutes; each code pairs with only one phone.', 'QR コードを作成しました。{minutes} 分以内にスキャンしてください。各コードはスマホ 1 台のみペアリングできます。', 'QR 코드를 만들었습니다. {minutes}분 안에 스캔하세요. 코드마다 휴대폰 한 대만 페어링할 수 있습니다.', 'QR Code 已创建，请在 {minutes} 分钟内扫描；每张只能配对一台手机。'],
    'system.pairingCreateFailed': ['無法建立配對 QR Code。', 'Could not create a pairing QR code.', 'ペアリング QR コードを作成できません。', '페어링 QR 코드를 만들 수 없습니다.', '无法创建配对 QR Code。'],
    'system.pairingRevokeSummary': ['這會讓所有已配對的手機立即失效。', 'This immediately invalidates every paired phone.', 'ペアリング済みのスマホがすべて直ちに無効になります。', '페어링된 모든 휴대폰이 즉시 무효가 됩니다.', '这会让所有已配对的手机立即失效。'],
    'system.pairingRevokeImpact': ['之後需要重新掃描 QR Code 才能控制。', 'You will need to scan a QR code again before you can control playback.', '操作するには、もう一度 QR コードをスキャンする必要があります。', '다시 QR 코드를 스캔해야 조작할 수 있습니다.', '之后需要重新扫描 QR Code 才能控制。'],
    'system.pairingRevokeConfirm': ['撤銷', 'Revoke', '解除', '해제', '撤销'],
    'system.pairingRevoked': ['已撤銷 {count} 台手機；請重新產生 QR Code 進行配對。', 'Revoked {count} phone(s). Generate a new QR code to pair again.', '{count} 台のスマホを解除しました。ペアリングするには QR コードを再生成してください。', '휴대폰 {count}대를 해제했습니다. 페어링하려면 QR 코드를 다시 생성하세요.', '已撤销 {count} 台手机；请重新生成 QR Code 进行配对。'],
    'system.pairingRevokeFailed': ['撤銷手機失敗。', 'Could not revoke paired phones.', 'スマホの解除に失敗しました。', '휴대폰 해제에 실패했습니다.', '撤销手机失败。'],
    'system.usageTitle': ['匿名活躍統計', 'Anonymous usage statistics', '匿名利用統計', '익명 사용 통계', '匿名活跃统计'],
    'system.usageDescription': ['協助了解實際使用人數。只傳送程式版本、啟動／核心功能使用事件，以及每日／每週／每月輪替的匿名代碼。', 'Helps measure real usage. Only the app version, startup/core-use event, and daily/weekly/monthly rotating anonymous codes are sent.', '実際の利用者数を把握するため、アプリのバージョン、起動／主要機能の利用イベント、日・週・月ごとに変わる匿名コードのみを送信します。', '실제 사용 인원을 파악하기 위해 앱 버전, 시작/핵심 기능 사용 이벤트, 일간/주간/월간으로 변경되는 익명 코드만 전송합니다.', '用于了解实际使用人数。仅发送程序版本、启动/核心功能使用事件，以及每日/每周/每月轮换的匿名代码。'],
    'system.usagePrivacy': ['不傳送固定安裝 ID、IP、電腦或硬體資訊、歌名、歌詞、歌單、Twitch 帳號或憑證；傳送失敗不影響程式，也不會補傳。', 'No permanent install ID, IP address, computer/hardware data, song titles, lyrics, playlists, Twitch accounts, or credentials are sent. Failures never affect the app and are not retried later.', '固定インストール ID、IP アドレス、PC／ハードウェア情報、曲名、歌詞、セットリスト、Twitch アカウントや認証情報は送信しません。失敗しても動作には影響せず、後から再送もしません。', '고정 설치 ID, IP 주소, 컴퓨터/하드웨어 정보, 곡명, 가사, 재생목록, Twitch 계정 또는 인증 정보는 전송하지 않습니다. 실패해도 앱에 영향을 주지 않으며 나중에 재전송하지 않습니다.', '不会发送固定安装 ID、IP 地址、电脑或硬件信息、歌名、歌词、歌单、Twitch 账号或凭证；发送失败不影响程序，也不会补传。'],
    'system.usageToggle': ['允許匿名活躍統計', 'Allow anonymous usage statistics', '匿名利用統計を許可', '익명 사용 통계 허용', '允许匿名活跃统计'],
    'system.usageEnabled': ['已啟用', 'Enabled', '有効', '사용 중', '已启用'],
    'system.usageDisabled': ['已停用；本機匿名祕密已刪除', 'Disabled; the local anonymous secret was deleted', '無効です。端末内の匿名シークレットは削除されました', '사용 안 함; 로컬 익명 비밀값이 삭제되었습니다', '已停用；本地匿名密钥已删除'],
    'system.usageSaving': ['儲存中…', 'Saving…', '保存中…', '저장 중…', '保存中…'],
    'system.usageSaveFailed': ['儲存失敗，已還原原設定', 'Could not save; the previous setting was restored', '保存できなかったため、以前の設定に戻しました', '저장하지 못해 이전 설정으로 복원했습니다', '保存失败，已恢复原设置'],
    'system.usageUnavailable': ['統計服務目前未設定；不會傳送資料', 'The statistics service is not configured; no data will be sent', '統計サービスが未設定のため、データは送信されません', '통계 서비스가 설정되지 않아 데이터를 전송하지 않습니다', '统计服务目前未设置；不会发送数据'],
    'system.lyricOffsetSyncTitle': ['歌詞偏移社群回饋', 'Community lyric-offset sharing', '歌詞タイミング補正の共有', '가사 오프셋 커뮤니티 공유', '歌词偏移社群回馈'],
    'system.lyricOffsetSyncDescription': ['分享你調整過的歌詞時間偏移，也取得其他人已校正過的建議值，讓同一支影片下次匯入時更準。', "Share the lyric timing corrections you make, and get other people's already-corrected suggestions, so the same video starts in sync next time it's imported.", '調整した歌詞タイミングのずれを共有し、他の人がすでに補正した提案値も受け取れます。同じ動画を次に取り込むときにより正確になります。', '조정한 가사 타이밍 보정값을 공유하고, 다른 사람이 이미 보정한 제안값도 받아보세요. 같은 영상을 다음에 가져올 때 더 정확해집니다.', '分享你调整过的歌词时间偏移，也获取其他人已校正过的建议值，让同一个视频下次导入时更准。'],
    'system.offsetFieldsHint': ['送出的內容與時機同樣寫死在原始碼裡，可以自己核對：', 'What gets sent, and when, is likewise fixed in the source and can be checked yourself:', '送信される内容とタイミングも同様にソース内で固定されており、自分で確認できます：', '전송되는 내용과 시점도 마찬가지로 소스에 고정되어 있어 직접 확인할 수 있습니다:', '发送的内容与时机同样写死在源代码里，可以自己核对：'],
    'system.usageFieldsLink': ['完整欄位清單', 'Full field list', '送信フィールド一覧', '전체 필드 목록', '完整字段清单'],
    'system.usageFieldsHint': ['會送出的每一個欄位都列在原始碼的封閉白名單裡，不在清單上的一律丟棄：', 'Every field that can be sent is listed in a closed allowlist in the source; anything not on it is discarded:', '送信され得るフィールドはすべてソース内のクローズドな許可リストに列挙されています。リストにないものは破棄されます：', '전송될 수 있는 모든 필드는 소스의 폐쇄형 허용 목록에 있으며, 목록에 없는 것은 폐기됩니다:', '会发送的每一个字段都列在源代码的封闭白名单里，不在清单上的一律丢弃：'],
    'system.lyricOffsetSyncPrivacy': ['會傳送 YouTube 影片 ID 與你調整過的偏移毫秒數，以及每日／每月輪替的匿名代碼；不傳送固定安裝 ID、歌名、歌詞內容、歌單或帳號。跟上方的匿名活躍統計是各自獨立的開關。', 'Sends the YouTube video id, the offset (ms) you adjusted, and a daily/monthly rotating anonymous code. No permanent install ID, song titles, lyrics content, playlists, or accounts are sent. Independent of the anonymous usage toggle above.', 'YouTube 動画 ID と調整したオフセット（ミリ秒）、日・月ごとに変わる匿名コードを送信します。固定インストール ID、曲名、歌詞内容、セットリスト、アカウントは送信しません。上の匿名利用統計とは別の独立したスイッチです。', 'YouTube 동영상 ID와 조정한 오프셋(ms), 일간/월간으로 변경되는 익명 코드를 전송합니다. 고정 설치 ID, 곡명, 가사 내용, 재생목록, 계정은 전송하지 않습니다. 위의 익명 사용 통계와는 별개의 독립된 스위치입니다.', '会发送 YouTube 视频 ID 与你调整过的偏移毫秒数，以及每日/每月轮换的匿名代码；不发送固定安装 ID、歌名、歌词内容、歌单或账号。跟上方的匿名活跃统计是各自独立的开关。'],
    'system.lyricOffsetSyncToggle': ['允許歌詞偏移社群回饋', 'Allow community lyric-offset sharing', '歌詞タイミング補正の共有を許可', '가사 오프셋 커뮤니티 공유 허용', '允许歌词偏移社群回馈'],
    'system.lyricOffsetSyncEnabled': ['已啟用', 'Enabled', '有効', '사용 중', '已启用'],
    'system.lyricOffsetSyncDisabled': ['已停用；本機匿名祕密已刪除', 'Disabled; the local anonymous secret was deleted', '無効です。端末内の匿名シークレットは削除されました', '사용 안 함; 로컬 익명 비밀값이 삭제되었습니다', '已停用；本地匿名密钥已删除'],
    'system.lyricOffsetSyncSaving': ['儲存中…', 'Saving…', '保存中…', '저장 중…', '保存中…'],
    'system.lyricOffsetSyncSaveFailed': ['儲存失敗，已還原原設定', 'Could not save; the previous setting was restored', '保存できなかったため、以前の設定に戻しました', '저장하지 못해 이전 설정으로 복원했습니다', '保存失败，已恢复原设置'],
    'system.lyricOffsetSyncUnavailable': ['回饋服務目前未設定；不會傳送資料', 'The offset-sharing service is not configured; no data will be sent', '共有サービスが未設定のため、データは送信されません', '공유 서비스가 설정되지 않아 데이터를 전송하지 않습니다', '回馈服务目前未设置；不会发送数据'],
    'system.twitchHintBefore': ['連接後會以 Twitch 的實際', 'Once connected, the live setlist starts from Twitch’s actual', '接続後、Twitch の実際の', '연결 후 Twitch의 실제', '连接后会以 Twitch 的实际'],
    'system.twitchHintMiddle': ['時間自動開始直播歌單；聊天室輸入', 'time; entering', '時刻から配信セットリストを自動開始します。チャットで', '시간을 기준으로 방송 세트리스트를 자동 시작합니다. 채팅에', '时间自动开始直播歌单；聊天室输入'],
    'system.twitchHintAfter': ['會走既有單一下載佇列，完成後才在聊天室回覆成功。', 'uses the existing single download queue and replies in chat only after completion.', 'を入力すると既存の単一ダウンロードキューを使い、完了後にのみチャットへ成功を返信します。', '을 입력하면 기존 단일 다운로드 대기열을 사용하며, 완료 후에만 채팅에 성공 메시지를 보냅니다.', '会走既有单一下载队列，完成后才在聊天室回复成功。'],
    'system.twitchHintLinkPlaceholder': ['YouTube連結', 'YouTube link', 'YouTube リンク', 'YouTube 링크', 'YouTube链接'],
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
    'feedback.typeSpout': ['Spout 透明輸出問題', 'Spout transparent output problem', 'Spout 透過出力の問題', 'Spout 투명 출력 문제', 'Spout 透明输出问题'],
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
    'feedback.includeDiagnosticsHint': ['版本、系統、yt-dlp／FFmpeg 狀態、連線觀測與已遮蔽的最近日誌；Spout 問題另附最近五分鐘效能紀錄。取消後只送出你填的文字。', 'Version, system, yt-dlp/FFmpeg status, connection observations, and redacted recent logs; Spout reports also include the last five minutes of performance samples. Turn this off to send only what you typed.', 'バージョン、システム、yt-dlp／FFmpeg の状態、接続の観測、マスク済みの直近ログに加え、Spout の問題には直近 5 分間の性能記録が含まれます。オフにすると入力した文章だけを送ります。', '버전, 시스템, yt-dlp/FFmpeg 상태, 연결 관측, 마스킹된 최근 로그와 함께 Spout 문제에는 최근 5분 성능 기록이 포함됩니다. 끄면 입력한 내용만 전송됩니다.', '版本、系统、yt-dlp／FFmpeg 状态、连接观测与已遮蔽的最近日志；Spout 问题还会附上最近五分钟性能记录。取消后只发送你填的文字。'],
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
    'controller.columnEntrance': ['逐字進場', 'Per-glyph entrance', '一字ずつの登場', '글자별 등장', '逐字进场'],
    'controller.columnPosition': ['直書位置', 'Vertical text position', '縦書き位置', '세로쓰기 위치', '竖排位置'],
    'controller.retainedLines': ['同時保留句數', 'Lines kept on screen', '同時に残す行数', '동시에 유지할 줄 수', '同时保留句数'],
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
    // KTV 長間奏／全曲結尾的畫面字樣（繁中維持模板內原本的三則輪播，不吃這個 key）
    'ktv.interlude': ['間奏', 'Instrumental', '間奏', '간주', '间奏'],
    'ktv.ending': ['感謝聆聽', 'Thanks for listening', 'ご清聴ありがとうございました', '감상해 주셔서 감사합니다', '感谢聆听'],
    'ktv.interludeTextLabel': ['長間奏字樣', 'Long-interlude text', '長い間奏のテキスト', '긴 간주 문구', '长间奏文字'],
    'ktv.interludeTextPlaceholder': ['留空＝依顯示語言（英「Instrumental」、日「間奏」、韓「간주」…）', 'Leave blank = follow the display language (EN "Instrumental", JA "間奏", KO "간주", …)', '空欄＝表示言語に従う（英「Instrumental」、日「間奏」、韓「간주」…）', '비워 두면 = 표시 언어를 따름(영어 "Instrumental", 일본어 "間奏", 한국어 "간주" …)', '留空＝按显示语言（英“Instrumental”、日“間奏”、韩“간주”…）'],
    'ktv.endingTextLabel': ['全曲結尾字樣', 'Song-ending text', '曲の終わりのテキスト', '곡 종료 문구', '全曲结尾文字'],
    'ktv.endingTextPlaceholder': ['留空＝依顯示語言（英「Thanks for listening」…）', 'Leave blank = follow the display language (EN "Thanks for listening", …)', '空欄＝表示言語に従う（英「Thanks for listening」…）', '비워 두면 = 표시 언어를 따름(영어 "Thanks for listening", …)', '留空＝按显示语言（英“Thanks for listening”…）'],
    'ktv.customTextHint': ['長間奏與唱完整首時，畫面中間會顯示的字。留空時依觀眾看到的顯示語言自動帶入；繁體中文維持原本的三則輪播文案。填了就完全照你打的字（語言請自己顧）。', 'The text shown in the center of the screen during a long instrumental break and when a song finishes. Leave it blank and it follows the display language the viewer sees; Traditional Chinese keeps its original three-message rotation. Fill it in and it shows exactly what you type (you handle the language yourself).', '長い間奏中と曲が終わったときに画面中央に表示されるテキストです。空欄にすると視聴者が見ている表示言語に従います。繁体字中国語は元の3種類の巡回文をそのまま使います。入力するとそのまま表示されます（言語はご自身で調整してください）。', '긴 간주 중과 곡이 끝났을 때 화면 중앙에 표시되는 문구입니다. 비워 두면 시청자가 보는 표시 언어를 따르며, 번체 중국어는 원래의 세 가지 순환 문구를 유지합니다. 입력하면 입력한 그대로 표시됩니다(언어는 직접 관리하세요).', '长间奏与唱完整首时，画面中间会显示的字。留空时按观众看到的显示语言自动带入；繁体中文维持原本的三则轮播文案。填了就完全照你打的字（语言请自己顾）。'],
    'template.columnflow': ['直書句流', 'Vertical Verse Flow', '縦書き句流', '세로쓰기 문장 흐름', '竖排句流'],
    'template.paperstrip': ['紙帶逐字', 'Paper Strip', 'ペーパーストリップ', '페이퍼 스트립', '纸带逐字'],
    'template.mirror': ['虛實鏡書', 'Mirror', 'ミラー', '미러', '虚实镜书'],
    'template.typewriter': ['對話氣泡', 'Typewriter', 'タイプライター', '타자기', '对话气泡'],
    'template.lightboard': ['跑馬燈牌', 'Light Board', 'ライトボード', '라이트보드', '跑马灯牌'],
    'template.ktvTitle': ['霓彩伴唱：雙行錯開、逐字掃色與原地倒數', 'Neon KTV: two offset rows with per-character color sweep and in-place countdown', 'ネオン KTV：2行を互い違いに配置し、一字ずつ色が変わりその場でカウントダウン', '네온 KTV: 두 줄을 엇갈리게 배치, 한 글자씩 색이 채워지고 제자리 카운트다운', '霓彩伴唱：双行错开、逐字扫色与原地倒数'],
    'template.ktvDesc': ['逐字伴唱、固定雙行', 'Per-character sing-along, fixed two rows', '一字ずつ伴奏、固定2行', '한 글자씩 반주, 고정 두 줄', '逐字伴唱、固定双行'],
    'template.columnflowTitle': ['直書句流：直行在畫面兩側錯落，逐字浮現，唱過的句子留下淡淡殘影', 'Vertical Verse Flow: vertical columns scatter along both sides of the screen, revealing character by character, with sung lines leaving a faint afterimage', '縦書き句流：画面両側に縦書きの行が散らばり、一字ずつ現れ、歌い終えた行はうっすら残像として残ります', '세로쓰기 문장 흐름: 화면 양쪽에 세로줄이 흩어져 배치되고 한 글자씩 나타나며, 부른 문장은 은은한 잔상으로 남습니다', '竖排句流：竖行在画面两侧错落，逐字浮现，唱过的句子留下淡淡残影'],
    'template.columnflowDesc': ['直書殘影、中央留白', 'Vertical afterimage, empty center', '縦書きの残像、中央は余白', '세로쓰기 잔상, 중앙 여백', '竖排残影、中央留白'],
    'template.paperstripTitle': ['紙帶逐字：白色紙帶先展開，再依句長、總字數與節奏分成 2～4 句一頁，尺寸進場前就決定', 'Paper Strip: a white paper strip unrolls first, then splits into 2-4 lines per page based on line length, total character count, and rhythm — the size is decided before it enters', 'ペーパーストリップ：白い紙テープがまず広がり、行の長さ・総文字数・リズムに応じて1ページ2〜4行に分けられます。サイズは登場前に決まります', '페이퍼 스트립: 흰색 종이 띠가 먼저 펼쳐진 뒤 줄 길이·총 글자 수·리듬에 따라 한 페이지에 2~4줄로 나뉘며, 크기는 등장 전에 정해집니다', '纸带逐字：白色纸带先展开，再依句长、总字数与节奏分成 2～4 句一页，尺寸进场前就决定'],
    'template.paperstripDesc': ['白底展開、逐字填入', 'White strip unrolls, fills in character by character', '白地が広がり、一字ずつ埋まる', '흰 바탕이 펼쳐지고 한 글자씩 채워짐', '白底展开、逐字填入'],
    'template.mirrorTitle': ['虛實鏡書：固定左右雙側，左實心原文、右描邊鏡像字，中央保留人物安全區', 'Mirror: fixed left/right layout — solid original text on the left, outlined mirrored text on the right, with the center kept clear as a safe zone for the performer', 'ミラー：左右固定レイアウト。左は塗りつぶしの原文、右は輪郭のみの鏡文字。中央は配信者用のセーフゾーンとして空けます', '미러: 좌우 고정 레이아웃 — 왼쪽은 채워진 원문, 오른쪽은 윤곽선만 있는 거울 글자, 중앙은 출연자를 위한 안전 구역으로 비워둡니다', '虚实镜书：固定左右双侧，左实心原文、右描边镜像字，中央保留人物安全区'],
    'template.mirrorDesc': ['雙側排版、中央留白', 'Two-sided layout, empty center', '両側配置、中央は余白', '양쪽 배치, 중앙 여백', '双侧排版、中央留白'],
    'template.typewriterTitle': ['對話氣泡：當前句在對話泡泡裡逐字打出、字後帶游標，換句時泡泡交替左右', 'Typewriter: the current line types out character by character inside a chat bubble with a trailing cursor, alternating left and right as lines change', 'タイプライター：現在の行がチャット吹き出しの中で一字ずつタイプされ、末尾にカーソルが付きます。行が変わるたびに吹き出しは左右交互に表示されます', '타자기: 현재 줄이 채팅 말풍선 안에서 한 글자씩 타이핑되고 끝에 커서가 표시되며, 줄이 바뀔 때마다 말풍선이 좌우로 번갈아 나타납니다', '对话气泡：当前句在对话气泡里逐字打出、字后带游标，换句时气泡交替左右'],
    'template.typewriterDesc': ['對話泡泡、逐字打出', 'Chat bubble, types out character by character', 'チャット吹き出し、一字ずつタイプ', '채팅 말풍선, 한 글자씩 타이핑', '对话气泡、逐字打出'],
    'template.lightboardTitle': ['跑馬燈牌：LED 點陣燈牌，唱過的燈亮、沒唱到的是熄滅的暗點', 'Light Board: an LED dot-matrix sign — dots for sung characters stay lit, dots for characters not yet sung stay dark', 'ライトボード：LEDドットマトリクス看板。歌い終えた部分は点灯したまま、まだ歌っていない部分は消灯したドットのまま', '라이트보드: LED 도트 매트릭스 간판 — 부른 부분은 점등된 채 남고, 아직 부르지 않은 부분은 꺼진 점 그대로 유지됩니다', '跑马灯牌：LED 点阵灯牌，唱过的灯亮、没唱到的是熄灭的暗点'],
    'template.lightboardDesc': ['LED 點陣、機台質感', 'LED dot matrix, arcade-cabinet feel', 'LEDドットマトリクス、筐体の質感', 'LED 도트 매트릭스, 오락기 질감', 'LED 点阵、机台质感'],
    'template.particle': ['風息成字', 'Windborne Particles', '風が文字を結ぶ', '바람 입자 글자', '风息成字'],
    'template.particleTitle': ['風息成字：粒子隨風散開，再聚成正在唱的文字；字級走一般字幕尺度、留安全邊距，可調直書與左右分散', 'Windborne Particles: particles scatter with the wind, then gather into the sung words at subtitle scale inside a safe-area margin; supports vertical text and split sides.', '風に散った粒子が歌詞へ集まります。字幕サイズでセーフエリアの余白を確保し、縦組みや左右振り分けも可能', '바람에 흩어진 입자가 노래하는 글자로 모입니다. 자막 크기로 세이프 영역 여백을 두며 세로쓰기·좌우 분산도 지원', '风息成字：粒子随风散开，再聚成正在唱的文字；字级走一般字幕尺度、留安全边距，可调竖排与左右分散'],
    'template.particleDesc': ['粒子聚字、字幕尺度', 'Particles form words, subtitle scale', '粒子が文字を結ぶ、字幕サイズ', '입자가 글자를 이루는 자막 크기', '粒子聚字、字幕尺度'],
    'stage.safeZoneObsLabel': ['安全框也疊在 OBS 來源上', 'Also overlay the safe-zone box on the OBS source', 'セーフゾーン枠を OBS ソースにも表示', 'OBS 소스에도 안전 영역 상자 표시', '安全框也叠在 OBS 来源上'],
    'stage.safeZoneObsHint': ['預設只有這裡的預覽看得到引導線；打開後連 OBS 裡的真正歌詞來源也會疊出紅色框線，方便直接對著 OBS 畫面調整。⚠️ 調完記得關掉，不然直播畫面會一直帶著這條線。', 'By default only this preview shows the guide line; turn this on and the real OBS lyric source will also overlay a red box, making it easier to adjust directly against the OBS view. ⚠️ Remember to turn it off when done, or the line will stay on your live picture.', '既定ではこのプレビューにのみガイド線が表示されます。オンにすると、OBS内の実際の歌詞ソースにも赤い枠線が重ねて表示され、OBS画面を見ながら直接調整できます。⚠️ 調整が終わったら必ずオフにしてください。そのままにすると配信画面に線が残ります。', '기본적으로 이 미리보기에서만 안내선이 보입니다. 켜면 OBS의 실제 가사 소스에도 빨간 상자가 겹쳐 표시되어 OBS 화면을 보면서 바로 조정할 수 있습니다. ⚠️ 조정이 끝나면 꼭 꺼주세요. 안 그러면 방송 화면에 선이 계속 남습니다.', '预设只有这里的预览看得到引导线；打开后连 OBS 里的真正歌词来源也会叠出红色框线，方便直接对着 OBS 画面调整。⚠️ 调完记得关掉，不然直播画面会一直带着这条线。'],
    'columnflow.variantLabel': ['直書句流樣式', 'Vertical Verse Flow style', '縦書き句流のスタイル', '세로쓰기 문장 흐름 스타일', '竖排句流样式'],
    'columnflow.senTitle': ['素筆直書：細緻文字在畫面中錯落填入，保留主播主視覺', 'Plain Brush Vertical: fine text scatters across the screen, keeping the streamer as the main visual focus', '素筆縦書き：繊細な文字が画面に散らばって配置され、配信者の映像を主役として保ちます', '담백한 세로쓰기: 세밀한 글자가 화면에 흩어져 배치되며 스트리머 화면을 주인공으로 유지합니다', '素笔竖排：细致文字在画面中错落填入，保留主播主视觉'],
    'columnflow.fudaTitle': ['字札直書：每個字像一張小紙札，保有不規則手感', 'Card Vertical: each character looks like a small paper card, with an irregular handmade feel', '字札縦書き：一字ずつが小さな紙札のようで、不揃いな手作り感があります', '글패 세로쓰기: 글자 하나하나가 작은 종이 패처럼 보이며 불규칙한 손맛이 있습니다', '字札竖排：每个字像一张小纸札，保有不规则手感'],
    'columnflow.variantHint': ['素筆是乾淨的文字殘影；字札讓每個字帶小紙片手感。', 'Plain Brush leaves a clean text afterimage; Card gives each character a small paper-card feel.', '素筆はすっきりした文字の残像。字札は一字ずつに小さな紙札の質感を与えます。', '담백한 붓은 깔끔한 글자 잔상을 남기고, 글패는 한 글자씩 작은 종이 패 느낌을 줍니다.', '素笔是干净的文字残影；字札让每个字带小纸片手感。'],
    'columnflow.entranceLabel': ['逐字進場', 'Per-glyph entrance', '一字ずつの登場', '글자별 등장', '逐字进场'],
    'columnflow.entranceNativeTitle': ['原樣：吃素筆／字札各自的浮現或掉入', 'Native: uses whichever entrance Plain Brush or Card style already has (fade in / drop in)', 'そのまま：素筆／字札それぞれ本来の登場（フェードイン／落下）を使用', '기본: 담백한 붓/글패 각자 원래의 등장(페이드인/떨어짐)을 사용', '原样：吃素笔／字札各自的浮现或掉入'],
    'columnflow.entranceDriftTitle': ['四相漂字：每個字從四角帶弧度漂入定點、入場後完全靜止；可調動畫強度', 'Quad Drift: each character arcs in from one of the four corners to its resting spot and stays fully still afterward; animation intensity is adjustable', '四相漂字：各文字が四隅のいずれかから弧を描いて所定の位置に流れ込み、その後は完全に静止します。アニメーションの強さは調整可能', '사방 흐름: 각 글자가 네 모서리 중 한 곳에서 곡선을 그리며 제자리로 흘러들어와 이후 완전히 정지합니다. 애니메이션 강도는 조절 가능', '四相漂字：每个字从四角带弧度漂入定点、入场后完全静止；可调动画强度'],
    'columnflow.entranceHint': ['原樣＝該外觀本來的進場；四相漂字讓字從四角漂入定點後靜止（可調沉穩／標準／狂放強度），素筆、字札都能套。', 'Native = the entrance that style already has; Quad Drift makes characters drift in from the four corners and settle still (with adjustable calm/normal/wild intensity), and it works on top of either Plain Brush or Card style.', 'そのまま＝そのスタイル本来の登場。四相漂字は四隅から文字が流れ込んで静止します（落ち着き／標準／激しさの強度調整可）。素筆・字札どちらにも適用できます。', '기본 = 해당 스타일 원래의 등장. 사방 흐름은 네 모서리에서 글자가 흘러들어와 정지합니다(차분함/보통/격렬함 강도 조절 가능). 담백한 붓, 글패 어디에도 적용됩니다.', '原样＝该外观本来的进场；四相漂字让字从四角漂入定点后静止（可调沉稳／标准／狂放强度），素笔、字札都能套。'],
    'columnflow.placementLabel': ['直書位置', 'Vertical position', '縦書きの位置', '세로쓰기 위치', '竖排位置'],
    'columnflow.placementLeftTitle': ['偏左：所有直行留在畫面左側，避開正中', 'Left: all vertical columns stay on the left side of the screen, avoiding the center', '左寄せ：すべての縦書き列を画面左側に配置し、中央を避けます', '왼쪽: 모든 세로줄이 화면 왼쪽에 머물며 중앙을 피합니다', '偏左：所有竖行留在画面左侧，避开正中'],
    'columnflow.placementRightTitle': ['偏右：所有直行留在畫面右側，避開正中', 'Right: all vertical columns stay on the right side of the screen, avoiding the center', '右寄せ：すべての縦書き列を画面右側に配置し、中央を避けます', '오른쪽: 모든 세로줄이 화면 오른쪽에 머물며 중앙을 피합니다', '偏右：所有竖行留在画面右侧，避开正中'],
    'columnflow.placementSplitTitle': ['左右分散：新句交錯補到左右兩側，畫面正中保持留白', 'Split: new lines alternate onto the left and right sides, keeping the center of the screen clear', '左右分散：新しい行は左右交互に配置され、画面中央は空けたままにします', '좌우 분산: 새 줄이 좌우로 번갈아 배치되며 화면 중앙은 비워둡니다', '左右分散：新句交错补到左右两侧，画面正中保持留白'],
    'columnflow.placementHint': ['預設左右分散；新句補上時，最舊的一句會淡出。', 'Split left/right by default; when a new line is added, the oldest one fades out.', '既定は左右分散です。新しい行が追加されると、最も古い行がフェードアウトします。', '기본값은 좌우 분산입니다. 새 줄이 추가되면 가장 오래된 줄이 서서히 사라집니다.', '预设左右分散；新句补上时，最旧的一句会淡出。'],
    'columnflow.maxLinesLabel': ['同時保留句數', 'Lines kept at once', '同時に保持する行数', '동시에 유지할 줄 수', '同时保留句数'],
    'columnflow.maxLinesHint': ['偏左或偏右畫面較擠時，可把句數調低。', 'If the screen feels cramped when using Left or Right, lower the line count.', '左寄せ・右寄せで画面が窮屈な場合は、行数を減らしてください。', '왼쪽/오른쪽 배치에서 화면이 답답하면 줄 수를 줄이세요.', '偏左或偏右画面较挤时，可把句数调低。'],
    'columnflow.safeMarginLabel': ['中央安全距離', 'Center safe margin', '中央セーフマージン', '중앙 안전 여백', '中央安全距离'],
    'columnflow.safeMarginHint': ['畫面正中保留給主播真人／人物模型的區域，直行不會跨入；拖曳時右側預覽會用紅色斜線標出目前的範圍，調到剛好蓋住人物即可放開。數字越大留白越寬。', 'The center of the screen is reserved for the streamer or model — vertical columns will never cross into it. While dragging, the preview marks the current range with red hatching; release once it just covers the performer. A larger number leaves more empty space.', '画面中央は配信者本人やモデル用に確保され、縦書き列は入り込みません。ドラッグ中は右側プレビューに赤い斜線で現在の範囲が表示され、配信者をちょうど覆ったところで離してください。数値が大きいほど余白が広がります。', '화면 중앙은 스트리머 본인이나 모델을 위해 남겨두며 세로줄이 침범하지 않습니다. 드래그하는 동안 오른쪽 미리보기에 빨간 사선으로 현재 범위가 표시되며, 인물을 딱 덮었을 때 놓으세요. 숫자가 클수록 여백이 넓어집니다.', '画面正中保留给主播真人／人物模型的区域，竖行不会跨入；拖曳时右侧预览会用红色斜线标出目前的范围，调到刚好盖住人物即可放开。数字越大留白越宽。'],
    'typewriter.paddingLabel': ['左右邊距', 'Left/right padding', '左右の余白', '좌우 여백', '左右边距'],
    'typewriter.paddingHint': ['對話泡泡離畫面左右邊緣的距離。', 'Distance from the chat bubbles to the left/right edges of the screen.', 'チャット吹き出しと画面左右端との距離。', '채팅 말풍선과 화면 좌우 가장자리 사이의 거리.', '对话气泡离画面左右边缘的距离。'],
    'typewriter.bubbleRightLabel': ['對話泡泡（右／藍側）', 'Chat bubble (right / blue side)', 'チャット吹き出し（右／青側）', '채팅 말풍선(오른쪽/파란색)', '对话气泡（右／蓝侧）'],
    'typewriter.bubbleLeftLabel': ['對話泡泡（左／灰側）', 'Chat bubble (left / gray side)', 'チャット吹き出し（左／グレー側）', '채팅 말풍선(왼쪽/회색)', '对话气泡（左／灰侧）'],
    'typewriter.stickerLabel': ['長間奏跳貼圖', 'Sticker during long interludes', '長い間奏でスタンプ表示', '긴 간주 중 스티커 표시', '长间奏跳贴图'],
    'typewriter.stickerHint': ['冷場時像聊天室發張貼圖。清單空或關掉就沿用純打字。', 'Sends a sticker like a chat room does during a quiet stretch. Falls back to plain typing if the list is empty or this is off.', '間が空いたときにチャットのようにスタンプを送ります。リストが空か、オフの場合は通常のタイプ表示のままです。', '조용한 구간에서 채팅방처럼 스티커를 보냅니다. 목록이 비어 있거나 꺼져 있으면 평소대로 타이핑만 표시됩니다.', '冷场时像聊天室发张贴图。清单空或关掉就沿用纯打字。'],
    'typewriter.stickerGapLabel': ['長間奏門檻', 'Long-interlude threshold', '長い間奏の閾値', '긴 간주 기준 시간', '长间奏门槛'],
    'typewriter.stickerGalleryLabel': ['間奏貼圖圖庫', 'Interlude sticker library', '間奏スタンプライブラリ', '간주 스티커 갤러리', '间奏贴图图库'],
    'typewriter.stickerUpload': ['上傳貼圖', 'Upload stickers', 'スタンプをアップロード', '스티커 업로드', '上传贴图'],
    'typewriter.stickerReset': ['還原內建貼圖', 'Restore built-in stickers', '内蔵スタンプを復元', '내장 스티커 복원', '还原内置贴图'],
    'typewriter.stickerFieldHint': ['支援透明 PNG／GIF（動圖自動播放）。單張 8MB、自訂最多 24 張。內建貼圖也能按 ✕ 拿掉，之後按「還原內建貼圖」找回。長間奏會依間奏序穩定抽一張（很長的間奏會跳兩張）。', 'Supports transparent PNG/GIF (animated GIFs auto-play). Up to 8MB per file, up to 24 custom stickers. Built-in stickers can also be removed with ✕ and brought back later with "Restore built-in stickers". A long interlude picks one sticker deterministically by interlude order (a very long one shows two).', '透過PNG／GIF（アニメーションは自動再生）に対応。1枚8MBまで、カスタムは最大24枚。内蔵スタンプも✕で削除でき、後で「内蔵スタンプを復元」で戻せます。間奏の順序に応じて安定して1枚選ばれます（非常に長い間奏では2枚）。', '투명 PNG/GIF 지원(GIF는 자동 재생). 파일당 8MB, 사용자 지정 최대 24장. 내장 스티커도 ✕로 제거할 수 있고 나중에 "내장 스티커 복원"으로 되돌릴 수 있습니다. 긴 간주는 간주 순서에 따라 스티커 한 장을 고정적으로 뽑습니다(아주 긴 간주는 두 장).', '支持透明 PNG／GIF（动图自动播放）。单张 8MB、自定义最多 24 张。内置贴图也能按 ✕ 拿掉，之后按“还原内置贴图”找回。长间奏会依间奏序稳定抽一张（很长的间奏会跳两张）。'],
    'lightboard.scrollLabel': ['燈牌捲動', 'Sign scrolling', '看板のスクロール', '간판 스크롤', '灯牌卷动'],
    'lightboard.panLabel': ['長句平移', 'Pan long lines', '長い行のパン', '긴 줄 이동', '长句平移'],
    'lightboard.panHint': ['整句塞不下時才平移，而且只移到「正在唱的字剛好留在燈箱裡」。關掉的話字級要遷就最長的一句，整首歌會小一截。', 'Only pans when the whole line does not fit, and only far enough that the character currently being sung stays inside the sign. If turned off, the font size has to shrink to fit the longest line, making the whole song noticeably smaller.', '行全体が収まらない場合のみパンし、歌っている文字が常に看板内に収まる範囲でしか動きません。オフにすると、最も長い行に合わせて文字サイズを縮める必要があり、曲全体が小さくなります。', '줄 전체가 들어가지 않을 때만 이동하며, 부르고 있는 글자가 항상 간판 안에 머무는 범위까지만 움직입니다. 끄면 가장 긴 줄에 맞춰 글자 크기를 줄여야 해서 곡 전체가 작아집니다.', '整句塞不下时才平移，而且只移到“正在唱的字刚好留在灯箱里”。关掉的话字级要迁就最长的一句，整首歌会小一截。'],
    'lightboard.idleLabel': ['間奏跑馬', 'Marquee during interludes', '間奏中のマーキー', '간주 중 흐르는 글자', '间奏跑马'],
    'lightboard.idleHint': ['只在沒有人在唱的間奏跑曲名，右上讀數同時切成 INTERLUDE。不影響跟唱。', 'Scrolls the song title only during an interlude with nobody singing, while the readout in the corner switches to INTERLUDE. Does not affect the sing-along display.', '誰も歌っていない間奏中のみ曲名がスクロールし、右上の表示は同時にINTERLUDEに切り替わります。歌詞表示には影響しません。', '아무도 부르지 않는 간주 중에만 곡명이 흐르고, 오른쪽 위 표시는 동시에 INTERLUDE로 바뀝니다. 따라 부르기 표시에는 영향이 없습니다.', '只在没有人在唱的间奏跑曲名，右上读数同时切成 INTERLUDE。不影响跟唱。'],
    'lightboard.idleGapLabel': ['長間奏門檻', 'Long-interlude threshold', '長い間奏の閾値', '긴 간주 기준 시간', '长间奏门槛'],
    'lightboard.idleGapHint': ['間奏長過這個秒數才開始跑馬——調高＝只有夠久的間奏才跑，短空檔不閃。', 'The marquee only starts once an interlude runs longer than this many seconds — raise it so only sufficiently long interludes trigger it, and short gaps stay still.', '間奏がこの秒数を超えたときのみマーキーが開始します。値を上げると十分に長い間奏でのみ動き、短い間には反応しません。', '간주가 이 초 수보다 길 때만 흐르는 글자가 시작됩니다. 값을 올리면 충분히 긴 간주에서만 작동하고 짧은 공백에서는 움직이지 않습니다.', '间奏长过这个秒数才开始跑马——调高＝只有够久的间奏才跑，短空档不闪。'],
    'lightboard.slideLabel': ['進場滑入', 'Slide-in entrance', 'スライドイン登場', '슬라이드인 등장', '进场滑入'],
    'lightboard.slideHint': ['每句從右側滑入。動作只發生在換句的空檔，但每句都動、累積起來會有點吵，預設關。', 'Each line slides in from the right. This only happens in the gap between lines, but since every line moves, it can feel a bit busy over a whole song, so it is off by default.', '各行が右側からスライドインします。行の切り替わりの合間のみ動きますが、毎行動くため曲全体では少しうるさく感じることがあり、既定ではオフです。', '각 줄이 오른쪽에서 슬라이드인합니다. 줄이 바뀌는 사이에만 움직이지만, 매 줄마다 움직이므로 곡 전체로는 다소 정신없게 느껴질 수 있어 기본값은 꺼짐입니다.', '每句从右侧滑入。动作只发生在换句的空档，但每句都动、累积起来会有点吵，预设关。'],
    'particle.orientLabel': ['排向', 'Orientation', '組み方向', '배치 방향', '排向'],
    'particle.orientHorizontal': ['橫排', 'Horizontal', '横組み', '가로', '横排'],
    'particle.orientVertical': ['直書', 'Vertical', '縦組み', '세로', '直书'],
    'particle.orientHorizontalTitle': ['橫排：一行行的字幕式排版', 'Horizontal: subtitle-style rows', '横組み：字幕のような行組み', '가로: 자막식 줄 배치', '横排：一行行的字幕式排版'],
    'particle.orientVerticalTitle': ['直書：直欄由右往左', 'Vertical: columns run right to left', '縦組み：右から左へ列を送る', '세로: 오른쪽에서 왼쪽으로 열 배치', '竖排：竖栏由右往左'],
    'particle.shadowLabel': ['文字陰影', 'Text shadow', '文字の影', '텍스트 그림자', '文字阴影'],
    'particle.shadowColorLabel': ['陰影色', 'Shadow color', '影の色', '그림자 색', '阴影色'],
    'particle.marginHint': ['「左右邊距／上下邊距」（詳細設定）是外圈安全邊界；選「左右分散」時另有中央安全距離。', 'The Left/right and Top/bottom margins (Advanced) are the outer safe edges; “Split sides” adds a centre safe gap.', '「左右の余白／上下の余白」（詳細設定）が外周のセーフ境界です。「左右振り分け」では中央のセーフ距離も加わります。', '「좌우 여백／상하 여백」(고급 설정)이 바깥쪽 세이프 경계이며, ‘좌우 분산’에서는 중앙 세이프 간격이 추가됩니다.', '“左右边距／上下边距”（详细设置）是外圈安全边界；选“左右分散”时另有中央安全距离。'],
    'lightboard.fontLabel': ['燈牌字型', 'Sign font', '看板フォント', '간판 글꼴', '灯牌字体'],
    'lightboard.fontCubic11': ['Cubic 11（11×11，內建）', 'Cubic 11 (11×11, built in)', 'Cubic 11（11×11、内蔵）', 'Cubic 11(11×11, 내장)', 'Cubic 11（11×11，内置）'],
    'lightboard.fontBoutique9x9': ['精品點陣體 9×9（9×9，內建）', 'Boutique Bitmap 9×9 (9×9, built in)', 'ブティックビットマップ 9×9（9×9、内蔵）', '부티크 비트맵 9×9(9×9, 내장)', '精品点阵体 9×9（9×9，内置）'],
    'lightboard.fontHint': ['燈牌只吃真點陣字型：一般字體被圓點網遮罩切開後，筆畫之間的縫小於一個燈距就會糊成一團。兩款都隨程式打包（皆為 SIL OFL 授權），選了就生效。', 'The sign only works with true dot-matrix fonts: once a regular font is cut up by the dot mask, strokes closer together than one dot spacing blur into a blob. Both fonts ship with the app (both SIL OFL licensed) and take effect as soon as selected.', '看板は本物のドットマトリクスフォントのみ対応しています。通常のフォントをドットマスクで切ると、ストローク間の隙間がドット間隔より狭い箇所は潰れて見えます。両フォントともアプリに同梱（いずれも SIL OFL ライセンス）され、選択するとすぐ反映されます。', '간판은 진짜 도트 매트릭스 글꼴만 지원합니다. 일반 글꼴을 도트 마스크로 자르면 획 사이 간격이 도트 간격보다 좁은 부분은 뭉개져 보입니다. 두 글꼴 모두 앱에 내장되어 있으며(둘 다 SIL OFL 라이선스), 선택하면 바로 적용됩니다.', '灯牌只吃真点阵字体：一般字体被圆点网遮罩切开后，笔画之间的缝小于一个灯距就会糊成一团。两款都随程序打包（皆为 SIL OFL 授权），选了就生效。'],
    'paperstrip.orientLabel': ['紙帶排向', 'Strip orientation', 'ストリップの向き', '스트립 방향', '纸带排向'],
    'paperstrip.horizontalTitle': ['橫式：紙帶由左往右展開、字左到右填入（預設白條黑字）', 'Horizontal: the strip unrolls left to right, filling in characters left to right (defaults to a white strip with black text)', '横式：紙テープが左から右に展開し、文字も左から右に埋まります（既定は白地に黒文字）', '가로: 종이 띠가 왼쪽에서 오른쪽으로 펼쳐지고 글자도 왼쪽에서 오른쪽으로 채워집니다(기본값: 흰 바탕에 검은 글씨)', '横式：纸带由左往右展开、字左到右填入（预设白条黑字）'],
    'paperstrip.verticalTitle': ['直式：紙帶由上往下展開、字沿直欄填入（預設黑條白字）', 'Vertical: the strip unrolls top to bottom, filling in characters down each column (defaults to a black strip with white text)', '縦式：紙テープが上から下に展開し、文字は縦の列に沿って埋まります（既定は黒地に白文字）', '세로: 종이 띠가 위에서 아래로 펼쳐지고 글자는 세로줄을 따라 채워집니다(기본값: 검은 바탕에 흰 글씨)', '直式：纸带由上往下展开、字沿竖栏填入（预设黑条白字）'],
    'paperstrip.horizontal': ['橫式紙帶', 'Horizontal strip', '横式ストリップ', '가로 스트립', '横式纸带'],
    'paperstrip.vertical': ['直式紙帶', 'Vertical strip', '縦式ストリップ', '세로 스트립', '直式纸带'],
    'paperstrip.orientHint': ['出場、逐字、分頁、尺寸邏輯完全一樣，只是整個轉 90°。切排向會一併套用色彩預設（橫式白條黑字／直式黑條白字），之後可再各自調。', 'The entrance, per-character reveal, pagination, and sizing logic are all identical — the whole thing is just rotated 90°. Switching orientation also applies the matching color preset (horizontal = white strip/black text, vertical = black strip/white text), which you can still adjust afterward.', '登場、一字ずつの表示、ページ分割、サイズのロジックはすべて同じで、全体を90°回転させただけです。向きを切り替えると対応する配色プリセット（横式＝白地黒文字、縦式＝黒地白文字）も適用され、その後個別に調整できます。', '등장, 한 글자씩 표시, 페이지 나누기, 크기 로직은 모두 동일하며 전체를 90° 회전시킨 것뿐입니다. 방향을 바꾸면 해당 색상 프리셋(가로=흰 바탕 검은 글씨, 세로=검은 바탕 흰 글씨)도 함께 적용되며 이후 각각 조정할 수 있습니다.', '出场、逐字、分页、尺寸逻辑完全一样，只是整个转 90°。切排向会一并套用色彩预设（横式白条黑字／直式黑条白字），之后可再各自调。'],
    'paperstrip.colorLabel': ['紙條顏色', 'Strip color', 'ストリップの色', '스트립 색상', '纸条颜色'],
    'paperstrip.colorHint': ['紙帶本身的顏色。文字色在上面的「文字色」調。', 'The color of the strip itself. Text color is adjusted with "Text color" above.', 'テープ自体の色です。文字色は上の「文字色」で調整します。', '띠 자체의 색상입니다. 글자 색은 위의 "글자 색"에서 조정합니다.', '纸带本身的颜色。文字色在上面的“文字色”调。'],
    'setlist.roundOnlyTitle': ['圓角氣泡專屬', 'Rounded Bubble only', 'ラウンドバブル専用', '라운드 버블 전용', '圆角气泡专属'],
    'setlist.roundDecorLabel': ['顯示背景球體與圓環裝飾', 'Show background sphere and ring decoration', '背景の球体とリング装飾を表示', '배경 구체와 링 장식 표시', '显示背景球体与圆环装饰'],
    'setlist.roundDecorHint': ['純裝飾用的莓果球體與薄荷圓環，預設關閉讓畫面更乾淨', 'Purely decorative berry spheres and mint rings; off by default for a cleaner look', '装飾専用のベリー球体とミントリングです。既定ではオフでよりすっきりした見た目になります', '순수 장식용 베리 구체와 민트 링이며, 더 깔끔한 화면을 위해 기본값은 꺼짐입니다', '纯装饰用的莓果球体与薄荷圆环，预设关闭让画面更干净'],
    'setlist.glowOnlyTitle': ['夜間霓虹專屬', 'Night Neon only', 'ナイトネオン専用', '나이트 네온 전용', '夜间霓虹专属'],
    'setlist.flapOnlyTitle': ['發車看板專屬', 'Departure Board only', 'ディパーチャーボード専用', '출발 안내판 전용', '发车看板专属'],
    'setlist.flapStopsLabel': ['路線條顯示幾首歌', 'Songs shown on the route strip', 'ルート帯に表示する曲数', '경로 띠에 표시할 곡 수', '路线条显示几首歌'],
    'setlist.flapStopsHint': ['底部路線條一次顯示幾個站點（含目前這首）。站點等距排列，數量越多每格越窄、歌名越容易被擠掉；歌單比這個長時會以「正在播放」為中心自動捲動。', 'How many stops the bottom route strip shows at once, including the current song. Stops are evenly spaced, so the more you show the narrower each one gets and the more easily titles are squeezed out. Longer setlists scroll automatically, keeping the current song centred.', '下部のルート帯に一度に表示する停車駅の数（再生中の曲を含む）。停車駅は等間隔に並ぶため、数が多いほど各枠が狭くなり曲名が見切れやすくなります。セットリストがこれより長い場合は、再生中の曲を中心に自動でスクロールします。', '하단 경로 띠에 한 번에 표시할 정거장 수(현재 곡 포함). 정거장은 균등하게 배치되므로 많이 표시할수록 각 칸이 좁아져 곡명이 잘리기 쉽습니다. 세트리스트가 이보다 길면 현재 곡을 중심으로 자동 스크롤됩니다.', '底部路线条一次显示几个站点（含当前这首）。站点等距排列，数量越多每格越窄、歌名越容易被挤掉；歌单比这个长时会以“正在播放”为中心自动滚动。'],
    'setlist.waitingFirstSong': ['直播中…等待第一首歌', 'Live — waiting for the first song', '配信中 — 最初の曲を待っています', '방송 중 — 첫 곡을 기다리는 중', '直播中…等待第一首歌'],
    'setlist.noneSungYet': ['尚未唱任何歌曲', 'No songs sung yet', 'まだ歌った曲はありません', '아직 부른 곡이 없습니다', '尚未唱任何歌曲'],
    'setlist.allSung': ['已唱完所有歌曲', 'All songs have been sung', 'すべての曲を歌い終えました', '모든 곡을 불렀습니다', '已唱完所有歌曲'],
    'setlist.glowHeaderLabel': ['左上角看板文字', 'Top-left header text', '左上のヘッダーテキスト', '왼쪽 상단 헤더 텍스트', '左上角看板文字'],
    'setlist.presetsSummary': ['風格預設與儲存（選用）', 'Style presets and saving (optional)', 'スタイルプリセットと保存（任意）', '스타일 프리셋 및 저장(선택)', '风格预设与保存（选用）'],
    'setlist.presetsDesc': ['套用到目前選擇的設定範圍；每個預設都會保留亮色背景可讀性。', 'Applies to the currently selected settings scope; every preset preserves readability against a bright background.', '現在選択している設定範囲に適用されます。どのプリセットも明るい背景での可読性を保ちます。', '현재 선택된 설정 범위에 적용되며, 모든 프리셋은 밝은 배경에서의 가독성을 유지합니다.', '套用到目前选择的设置范围；每个预设都会保留亮色背景可读性。'],
    'setlist.presetsResetNote': ['可隨時回到出廠設定', 'You can return to the factory defaults anytime', 'いつでも初期設定に戻せます', '언제든 공장 기본값으로 되돌릴 수 있습니다', '可随时回到出厂设置'],
    'setlist.presetsResetTitle': ['把目前版型的所有外觀設定還原成出廠預設值', 'Restore all appearance settings for the current layout to factory defaults', '現在のレイアウトのすべての外観設定を初期値に戻します', '현재 레이아웃의 모든 외관 설정을 공장 기본값으로 되돌립니다', '把目前版型的所有外观设置还原成出厂预设值'],
    'setlist.presetsResetBtn': ['重置此版型的設定', 'Reset this layout\'s settings', 'このレイアウトの設定をリセット', '이 레이아웃 설정 초기화', '重置此版型的设置'],
    'setlist.presetSand': ['沙金', 'Sand', 'サンド', '샌드', '沙金'],
    'setlist.presetGlass': ['毛玻璃', 'Glass', 'ガラス', '글래스', '毛玻璃'],
    'setlist.presetNeon': ['霓虹', 'Neon', 'ネオン', '네온', '霓虹'],
    'setlist.presetMinimal': ['極簡', 'Minimal', 'ミニマル', '미니멀', '极简'],
    'setlist.presetDark': ['深色', 'Dark', 'ダーク', '다크', '深色'],
    'setlist.presetLight': ['淺色', 'Light', 'ライト', '라이트', '浅色'],
    'setlist.presetSavePlaceholder': ['幫這組風格取個名字…', 'Give this style a name…', 'このスタイルに名前を付ける…', '이 스타일에 이름을 지어주세요…', '给这组风格取个名字…'],
    'setlist.presetSaveBtn': ['＋ 儲存目前設定為新風格', '+ Save current settings as a new style', '＋ 現在の設定を新しいスタイルとして保存', '+ 현재 설정을 새 스타일로 저장', '＋ 保存目前设置为新风格'],
    'setlist.presetSaveHint': ['存在這台電腦的瀏覽器裡（不會同步到別台裝置），可存多組，方便切換不同直播企劃的風格。', 'Stored in this computer\'s browser only (not synced to other devices); you can save multiple, making it easy to switch styles between different stream projects.', 'このパソコンのブラウザにのみ保存されます（他の端末とは同期されません）。複数保存でき、配信企画ごとにスタイルを切り替えやすくなります。', '이 컴퓨터의 브라우저에만 저장됩니다(다른 기기와 동기화되지 않음). 여러 개 저장할 수 있어 방송 기획마다 스타일을 바꾸기 편합니다.', '存在这台电脑的浏览器里（不会同步到别的设备），可存多组，方便切换不同直播企划的风格。'],
    'setlist.textDetailTitle': ['文字細節（次要文字）', 'Text details (secondary text)', 'テキストの詳細（サブテキスト）', '텍스트 세부 사항(보조 텍스트)', '文字细节（次要文字）'],
    'setlist.textDetailDesc': ['主要文字色已在快速調整；這裡只保留需要細調的次要文字層次。', 'The primary text color is already in Quick Adjust; only the secondary text layers that need fine-tuning are kept here.', 'メインの文字色はクイック調整にあります。ここには微調整が必要なサブテキストの階層のみを残しています。', '주요 글자 색은 빠른 조정에 있으며, 여기에는 세밀한 조정이 필요한 보조 텍스트 계층만 남겨두었습니다.', '主要文字色已在快速调整；这里只保留需要细调的次要文字层次。'],
    'setlist.artistOpacityLabel': ['歌手名的透明度', 'Artist name opacity', 'アーティスト名の不透明度', '가수명 투명도', '歌手名的透明度'],
    'setlist.doneNameOpacityLabel': ['已唱歌名的透明度', 'Sung song title opacity', '既唱曲名の不透明度', '부른 곡명 투명도', '已唱歌名的透明度'],
    'setlist.textDetailHint': ['這兩個都是以「主要文字色」為基礎調整深淺，數字越小越淡。開著可讀性保護時會保留安全下限；想做極淡效果再關閉保護。', 'Both of these adjust shade based on the "primary text color" — the smaller the number, the fainter. With readability protection on, a safe minimum is kept; turn protection off if you want a very faint effect.', 'どちらも「メインの文字色」を基準に濃淡を調整します。数値が小さいほど薄くなります。可読性保護をオンにすると安全な下限が保たれます。かなり薄くしたい場合は保護をオフにしてください。', '둘 다 "주요 글자 색"을 기준으로 진하기를 조절하며, 숫자가 작을수록 흐려집니다. 가독성 보호가 켜져 있으면 안전 하한이 유지됩니다. 아주 흐리게 하려면 보호를 꺼주세요.', '这两个都是以“主要文字色”为基础调整深浅，数字越小越淡。开着可读性保护时会保留安全下限；想做极淡效果再关闭保护。'],
    'setlist.metaOpacityLabel': ['編號／時間文字的透明度', 'Index/time text opacity', '番号・時刻テキストの不透明度', '번호/시간 텍스트 투명도', '编号／时间文字的透明度'],
    'setlist.metaOpacityHint': ['影響：清單前面的數字編號、已唱歌曲旁邊的時間戳記、區塊小標籤。', 'Affects: the numbering in front of the list, the timestamp next to sung songs, and small section labels.', '影響範囲：リスト先頭の番号、既唱曲の横のタイムスタンプ、セクションの小さなラベル。', '영향 범위: 목록 앞의 번호, 부른 곡 옆의 타임스탬프, 섹션 소제목.', '影响：列表前面的数字编号、已唱歌曲旁边的时间戳、区块小标签。'],
    'setlist.cardBorderTitle': ['卡片邊框（經典／清單版）', 'Card border (Classic/List)', 'カード枠線（クラシック／リスト版）', '카드 테두리(클래식/목록형)', '卡片边框（经典／列表版）'],
    'setlist.cardBorderDesc': ['主要文字與可讀性襯底已移到快速調整；這裡只保留不常改的邊框細節。', 'Primary text and the readability backing have moved to Quick Adjust; only the rarely-changed border details are kept here.', 'メインの文字と可読性用の背景はクイック調整に移動しました。ここにはあまり変更しない枠線の詳細のみを残しています。', '주요 글자와 가독성 배경은 빠른 조정으로 이동했으며, 여기에는 자주 바꾸지 않는 테두리 세부 사항만 남겨두었습니다.', '主要文字与可读性衬底已移到快速调整；这里只保留不常改的边框细节。'],
    'setlist.borderColorLabel': ['邊框顏色', 'Border color', '枠線の色', '테두리 색상', '边框颜色'],
    'setlist.borderOpacityLabel': ['邊框透明度', 'Border opacity', '枠線の不透明度', '테두리 투명도', '边框透明度'],
    'setlist.borderWidthLabel': ['邊框粗細', 'Border width', '枠線の太さ', '테두리 두께', '边框粗细'],
    'setlist.cardBorderHint': ['影響：已唱／未唱每一行外圍的細框線（經典版型的「正在播放」外框也用這組顏色與粗細）。', 'Affects: the thin border around each sung/upcoming row (Classic\'s "now playing" outline also uses this color and width).', '影響範囲：既唱・未唱の各行を囲む細い枠線（クラシック版の「再生中」の外枠もこの色と太さを使用）。', '영향 범위: 부른 곡/안 부른 곡 각 줄을 둘러싼 얇은 테두리(클래식 버전의 "재생 중" 외곽선도 이 색과 두께를 사용).', '影响：已唱／未唱每一行外围的细框线（经典版型的“正在播放”外框也用这组颜色与粗细）。'],
    'setlist.fontSizeTitle': ['字體與字級', 'Fonts and sizes', 'フォントとサイズ', '글꼴 및 크기', '字体与字级'],
    'setlist.fontSizeDesc': ['字體分三種用途：場景版的大標題、一般內文、還有編號/標籤這種等寬數字。', 'Fonts serve three purposes: the large title in scene layouts, general body text, and monospaced digits for numbering/labels.', 'フォントには3つの用途があります：シーン版の大見出し、通常の本文、そして番号・ラベル用の等幅数字です。', '글꼴은 세 가지 용도로 쓰입니다: 장면형의 큰 제목, 일반 본문, 번호/라벨용 고정폭 숫자입니다.', '字体分三种用途：场景版的大标题、一般内文、还有编号/标签这种等宽数字。'],
    'setlist.fontDisplayLabel': ['標題字體（場景版的大標題）', 'Display font (large titles in scene layouts)', '見出しフォント（シーン版の大見出し）', '제목 글꼴(장면형의 큰 제목)', '标题字体（场景版的大标题）'],
    'setlist.fontFraunces': ['Fraunces（預設，襯線體）', 'Fraunces (default, serif)', 'Fraunces（既定、セリフ体）', 'Fraunces(기본, 세리프)', 'Fraunces（预设，衬线体）'],
    'setlist.fontDmSerif': ['DM Serif Display（襯線體）', 'DM Serif Display (serif)', 'DM Serif Display（セリフ体）', 'DM Serif Display(세리프)', 'DM Serif Display（衬线体）'],
    'setlist.fontNotoSerifTc': ['思源宋體（中文襯線）', 'Noto Serif TC (Chinese serif)', '思源宋体（中国語セリフ体）', 'Noto Serif TC(중국어 세리프)', '思源宋体（中文衬线）'],
    'setlist.fontGeorgia': ['Georgia（襯線體）', 'Georgia (serif)', 'Georgia（セリフ体）', 'Georgia(세리프)', 'Georgia（衬线体）'],
    'setlist.fontCustomOption': ['自訂／系統字體…', 'Custom / system font…', 'カスタム／システムフォント…', '사용자 지정/시스템 글꼴…', '自定义／系统字体…'],
    'setlist.fontDisplayHint': ['用在 Timeline／Diagonal／Constellation 的大標題，以及經典版與四款皮膚的「正在播放」歌名。', 'Used for the large titles in Timeline/Diagonal/Constellation, and the "now playing" title in Classic and the four skin layouts.', 'Timeline／Diagonal／Constellationの大見出し、およびクラシック版と4種類のスキンの「再生中」曲名に使用されます。', 'Timeline/Diagonal/Constellation의 큰 제목과, 클래식 버전 및 4가지 스킨의 "재생 중" 곡명에 사용됩니다.', '用在 Timeline／Diagonal／Constellation 的大标题，以及经典版与四款皮肤的“正在播放”歌名。'],
    'setlist.fontBodyLabel': ['內文字體（歌名、歌手名等一般文字）', 'Body font (song titles, artist names, and other general text)', '本文フォント（曲名・アーティスト名など通常のテキスト）', '본문 글꼴(곡명, 가수명 등 일반 텍스트)', '内文字体（歌名、歌手名等一般文字）'],
    'setlist.fontManrope': ['Manrope（預設，無襯線）', 'Manrope (default, sans-serif)', 'Manrope（既定、サンセリフ体）', 'Manrope(기본, 산세리프)', 'Manrope（预设，无衬线）'],
    'setlist.fontInter': ['Inter（無襯線）', 'Inter (sans-serif)', 'Inter（サンセリフ体）', 'Inter(산세리프)', 'Inter（无衬线）'],
    'setlist.fontNotoSansTc': ['思源黑體（中文無襯線）', 'Noto Sans TC (Chinese sans-serif)', '思源黒体（中国語サンセリフ体）', 'Noto Sans TC(중국어 산세리프)', '思源黑体（中文无衬线）'],
    'setlist.fontMonoLabel': ['等寬字體（編號、時間戳記）', 'Monospace font (numbers, timestamps)', '等幅フォント（番号、タイムスタンプ）', '고정폭 글꼴(번호, 타임스탬프)', '等宽字体（编号、时间戳）'],
    'setlist.fontJetBrainsMono': ['JetBrains Mono（預設）', 'JetBrains Mono (default)', 'JetBrains Mono（既定）', 'JetBrains Mono(기본)', 'JetBrains Mono（预设）'],
    'setlist.fontMonoHint': ['影響：清單編號（01、02…）與已唱歌曲的時間戳記，等寬字體數字比較整齊好讀。', 'Affects: list numbering (01, 02…) and timestamps for sung songs — monospaced digits are neater and easier to read.', '影響範囲：リスト番号（01、02…）と既唱曲のタイムスタンプ。等幅フォントの数字は揃っていて読みやすくなります。', '영향 범위: 목록 번호(01, 02…)와 부른 곡의 타임스탬프. 고정폭 글꼴 숫자는 정렬되어 읽기 편합니다.', '影响：列表编号（01、02…）与已唱歌曲的时间戳，等宽字体数字比较整齐好读。'],
    'setlist.listFontSizeLabel': ['清單列表字級', 'List font size', 'リストの文字サイズ', '목록 글자 크기', '列表字级'],
    'setlist.artistFontSizeLabel': ['歌手名字級', 'Artist name font size', 'アーティスト名の文字サイズ', '가수명 글자 크기', '歌手名字级'],
    'setlist.metaFontSizeLabel': ['編號／標籤字級', 'Index/label font size', '番号・ラベルの文字サイズ', '번호/라벨 글자 크기', '编号／标签字级'],
    'setlist.activeWeightLabel': ['「正在播放」文字粗細', '"Now playing" text weight', '「再生中」の文字の太さ', '"재생 중" 텍스트 굵기', '“正在播放”文字粗细'],
    'setlist.weightLight': ['細（300）', 'Light (300)', '細字（300）', '가늘게(300)', '细（300）'],
    'setlist.weightNormal': ['正常（400）', 'Normal (400)', '標準（400）', '보통(400)', '正常（400）'],
    'setlist.weightMedium': ['中等（500）', 'Medium (500)', '中字（500）', '중간(500)', '中等（500）'],
    'setlist.weightSemibold': ['半粗（600）', 'Semibold (600)', 'やや太字（600）', '반굵게(600)', '半粗（600）'],
    'setlist.weightBoldDefault': ['粗體（700，預設）', 'Bold (700, default)', '太字（700、既定）', '굵게(700, 기본)', '粗体（700，预设）'],
    'setlist.listWeightLabel': ['清單列表文字粗細', 'List text weight', 'リストの文字の太さ', '목록 텍스트 굵기', '列表文字粗细'],
    'setlist.weightNormalDefault': ['正常（400，預設）', 'Normal (400, default)', '標準（400、既定）', '보통(400, 기본)', '正常（400，预设）'],
    'setlist.sceneFontSizeHint': ['場景版的正在播放歌曲文字大小可個別調整；整體大小用上面「大小」區的「整體大小倍率」。', 'The now-playing text size in scene layouts can be adjusted individually; overall size uses "Overall size multiplier" in the Size section above.', 'シーン版の再生中曲のテキストサイズは個別に調整できます。全体のサイズは上の「サイズ」にある「全体のサイズ比率」で調整します。', '장면형의 재생 중 곡 텍스트 크기는 개별적으로 조절할 수 있습니다. 전체 크기는 위 "크기" 항목의 "전체 크기 비율"을 사용합니다.', '场景版的正在播放歌曲文字大小可个别调整；整体大小用上面“大小”区的“整体大小倍率”。'],
    'setlist.layoutSizeTitle': ['版面尺寸 — 寬度／圓角／內距', 'Layout size — width / corner radius / padding', 'レイアウトサイズ — 幅／角丸／内側余白', '레이아웃 크기 — 너비/모서리 반경/여백', '版面尺寸 — 宽度／圆角／内距'],
    'setlist.layoutSizeDesc': ['清單型模板的寬度由 OBS Browser Source 決定，這裡不再提供固定像素寬度；要更寬就把來源拉寬，字級與間距會一起等比調整。整體大小倍率已移到快速調整的「大小」。', 'The width of list-style templates is set by the OBS Browser Source; a fixed pixel width is no longer offered here — widen the source to make it wider, and font size and spacing scale proportionally. The overall size multiplier has moved to "Size" in Quick Adjust.', 'リスト型テンプレートの幅はOBSブラウザソースによって決まり、ここでは固定ピクセル幅は提供されません。幅を広げたい場合はソースを広げてください。文字サイズと間隔は比例して調整されます。全体サイズ倍率はクイック調整の「サイズ」に移動しました。', '목록형 템플릿의 너비는 OBS 브라우저 소스로 결정되며, 여기서는 고정 픽셀 너비를 제공하지 않습니다. 더 넓게 하려면 소스를 넓히면 글자 크기와 간격이 비례해서 조절됩니다. 전체 크기 배율은 빠른 조정의 "크기"로 이동했습니다.', '列表型模板的宽度由 OBS Browser Source 决定，这里不再提供固定像素宽度；要更宽就把来源拉宽，字级与间距会一起等比调整。整体大小倍率已移到快速调整的“大小”。'],
    'setlist.radiusLabel': ['卡片圓角', 'Card corner radius', 'カードの角丸', '카드 모서리 반경', '卡片圆角'],
    'setlist.radiusHint': ['「正在播放」大卡用這個值；已唱／未唱每列自動略小一點（−6px）比較協調。', 'The "now playing" card uses this value; sung/upcoming rows are automatically slightly smaller (−6px) for visual balance.', '「再生中」の大きなカードにこの値が使われます。既唱・未唱の各行は自動的に少し小さく（−6px）なり、バランスが取れます。', '"재생 중" 큰 카드에 이 값이 사용됩니다. 부른 곡/안 부른 곡 각 줄은 자동으로 조금 작게(−6px) 조정되어 균형이 맞습니다.', '“正在播放”大卡用这个值；已唱／未唱每列自动略小一点（−6px）比较协调。'],
    'setlist.paddingVLabel': ['「正在播放」上下內距', '"Now playing" vertical padding', '「再生中」の上下内側余白', '"재생 중" 상하 여백', '“正在播放”上下内距'],
    'setlist.paddingHLabel': ['「正在播放」左右內距', '"Now playing" horizontal padding', '「再生中」の左右内側余白', '"재생 중" 좌우 여백', '“正在播放”左右内距'],
    'setlist.itemGapLabel': ['歌曲項目之間的間距', 'Gap between song items', '曲項目間の間隔', '곡 항목 간 간격', '歌曲项目之间的间距'],
    'setlist.layoutAnimTitle': ['排版與動畫', 'Layout and animation', 'レイアウトとアニメーション', '레이아웃 및 애니메이션', '排版与动画'],
    'setlist.lineHeightLabel': ['文字行高', 'Line height', '行の高さ', '줄 높이', '文字行高'],
    'setlist.lineHeightHint': ['數字越大，多行文字之間的垂直間距越寬鬆。', 'The larger the number, the more vertical space between lines of text.', '数値が大きいほど、複数行のテキスト間の垂直方向の間隔が広くなります。', '숫자가 클수록 여러 줄 텍스트 사이의 세로 간격이 넓어집니다.', '数字越大，多行文字之间的垂直间距越宽松。'],
    'setlist.marginVLabel': ['整體外邊距（上下）', 'Overall margin (top/bottom)', '全体の外側余白（上下）', '전체 바깥 여백(위아래)', '整体外边距（上下）'],
    'setlist.marginHLabel': ['整體外邊距（左右）', 'Overall margin (left/right)', '全体の外側余白（左右）', '전체 바깥 여백(좌우)', '整体外边距（左右）'],
    'setlist.marginHint': ['讓整組歌單離畫面邊緣遠一點，避免被 OBS 場景的其他元素擋住。', 'Moves the whole setlist further from the screen edges, to avoid being covered by other elements in the OBS scene.', 'セットリスト全体を画面端から離し、OBSシーンの他の要素に隠れないようにします。', '전체 세트리스트를 화면 가장자리에서 더 멀리 떨어뜨려 OBS 장면의 다른 요소에 가리지 않게 합니다.', '让整组歌单离画面边缘远一点，避免被 OBS 场景的其他元素挡住。'],
    'setlist.rowAnimLabel': ['新歌曲進場動畫', 'New song entrance animation', '新曲登場アニメーション', '새 곡 등장 애니메이션', '新歌曲进场动画'],
    'setlist.animFade': ['淡入（預設）', 'Fade in (default)', 'フェードイン（既定）', '페이드인(기본)', '淡入（预设）'],
    'setlist.animNone': ['無動畫', 'No animation', 'アニメーションなし', '애니메이션 없음', '无动画'],
    'setlist.animSlideUp': ['由下往上滑入', 'Slide up from bottom', '下からスライドイン', '아래에서 위로 슬라이드', '由下往上滑入'],
    'setlist.animSlideSide': ['由側邊滑入', 'Slide in from the side', '横からスライドイン', '옆에서 슬라이드', '由侧边滑入'],
    'setlist.timeFormatLabel': ['已唱時間的顯示格式', 'Sung time display format', '既唱時刻の表示形式', '부른 시간 표시 형식', '已唱时间的显示格式'],
    'setlist.timeFormatMmss': ['分:秒（例如 03:45，預設）', 'Minutes:seconds (e.g. 03:45, default)', '分:秒（例：03:45、既定）', '분:초(예: 03:45, 기본)', '分:秒（例如 03:45，预设）'],
    'setlist.timeFormatHmmss': ['時:分:秒（例如 1:03:45）', 'Hours:minutes:seconds (e.g. 1:03:45)', '時:分:秒（例：1:03:45）', '시:분:초(예: 1:03:45)', '时:分:秒（例如 1:03:45）'],
    'setlist.timeFormatNone': ['不顯示時間', 'Do not show time', '時刻を表示しない', '시간 표시 안 함', '不显示时间'],
    'setlist.timeFormatHint': ['直播超過一小時建議選「時:分:秒」，比較好對照真實時間。', 'For streams longer than an hour, "Hours:minutes:seconds" is recommended for easier comparison with real time.', '配信が1時間を超える場合は「時:分:秒」を選ぶと実際の時刻と照らし合わせやすくなります。', '방송이 1시간을 넘으면 "시:분:초"를 선택하면 실제 시간과 비교하기 편합니다.', '直播超过一小时建议选“时:分:秒”，比较好对照真实时间。'],
    'setlist.fxTitle': ['特效（毛玻璃／外框發光）', 'Effects (frosted glass / border glow)', 'エフェクト（すりガラス／外枠発光）', '효과(유리 흐림/테두리 발광)', '特效（毛玻璃／外框发光）'],
    'setlist.blurLabel': ['毛玻璃模糊程度', 'Frosted glass blur amount', 'すりガラスのぼかし度', '유리 흐림 정도', '毛玻璃模糊程度'],
    'setlist.blurHint': ['注意：在 OBS 裡只能模糊「歌單疊加層自己內部」的內容——疊加層背後的遊戲／鏡頭畫面模糊不到，這是 OBS 瀏覽器來源的限制（左邊預覽窗有底圖所以看得到效果）。想在 OBS 看出毛玻璃感，請搭配「半透明的歌曲列底色」使用。', 'Note: in OBS this can only blur content inside the setlist overlay itself — it cannot blur the game/camera footage behind the overlay, a limitation of the OBS Browser Source (the left preview has a background image so the effect is visible there). To see the frosted-glass look in OBS, pair it with a semi-transparent song-row background color.', '注意：OBSでは「セットリストのオーバーレイ内部」の内容しかぼかせません。オーバーレイの背後にあるゲーム／カメラ映像はぼかせません。これはOBSブラウザソースの制限です（左のプレビューには背景画像があるため効果が見えます）。OBSですりガラス感を出すには、「半透明の曲行背景色」と組み合わせてください。', '참고: OBS에서는 "세트리스트 오버레이 자체 내부"의 내용만 흐리게 할 수 있습니다. 오버레이 뒤의 게임/카메라 화면은 흐리게 할 수 없으며, 이는 OBS 브라우저 소스의 제한입니다(왼쪽 미리보기는 배경 이미지가 있어 효과가 보입니다). OBS에서 유리 흐림 느낌을 보려면 "반투명한 곡 행 배경색"과 함께 사용하세요.', '注意：在 OBS 里只能模糊“歌单叠加层自己内部”的内容——叠加层背后的游戏／镜头画面模糊不到，这是 OBS 浏览器来源的限制（左边预览窗有底图所以看得到效果）。想在 OBS 看出毛玻璃感，请搭配“半透明的歌曲行底色”使用。'],
    'setlist.cardGlowLabel': ['啟用卡片外框發光', 'Enable card border glow', 'カード外枠の発光を有効化', '카드 테두리 발광 켜기', '启用卡片外框发光'],
    'setlist.cardGlowSub': ['用「主色」讓卡片外圍發出柔光，不是文字陰影', 'Uses the "primary color" to give the card a soft outer glow — not a text shadow', '「メインカラー」を使ってカードの外側にやわらかい光を出します。文字影ではありません。', '"주요 색상"을 사용해 카드 바깥쪽에 부드러운 빛을 냅니다. 텍스트 그림자가 아닙니다.', '用“主色”让卡片外围发出柔光，不是文字阴影'],
    'setlist.cardGlowBlurLabel': ['外框發光模糊範圍', 'Border glow blur radius', '外枠発光のぼかし範囲', '테두리 발광 흐림 범위', '外框发光模糊范围'],
    'setlist.cardGlowStrengthLabel': ['外框發光強度', 'Border glow strength', '外枠発光の強さ', '테두리 발광 강도', '外框发光强度'],
    'setlist.cardGlowHint': ['這兩項只有上面「啟用卡片外框發光」打開時才看得出效果。（已唱／未唱的淡化程度移到上面「常用外觀」區，與已唱成對。）', 'These two settings only show an effect when "Enable card border glow" above is turned on. (Sung/upcoming fade amount has moved to the "Common appearance" section above, paired with sung.)', 'この2つの項目は上の「カード外枠の発光を有効化」がオンのときのみ効果が見えます。（既唱・未唱の淡化度は上の「よく使う外観」に移動し、既唱とペアになっています。）', '이 두 항목은 위의 "카드 테두리 발광 켜기"가 켜져 있을 때만 효과가 보입니다. (부른 곡/안 부른 곡 흐림 정도는 위의 "자주 쓰는 외관" 섹션으로 이동해 부른 곡과 짝을 이룹니다.)', '这两项只有上面“启用卡片外框发光”打开时才看得出效果。（已唱／未唱的淡化程度移到上面“常用外观”区，与已唱成对。）'],
    'setlist.displayItemsTitle': ['顯示項目', 'Display items', '表示項目', '표시 항목', '显示项目'],
    'setlist.showNumberLabel': ['顯示歌曲編號', 'Show song numbers', '曲番号を表示', '곡 번호 표시', '显示歌曲编号'],
    'setlist.showNumberSub': ['在每首歌前面加上 01、02… 的編號（經典版本來就沒有編號，故不適用）', 'Adds numbering like 01, 02… before each song (not applicable to Classic, which has no numbering to begin with)', '各曲の前に01、02…の番号を付けます（クラシック版はもともと番号がないため対象外）', '각 곡 앞에 01, 02… 같은 번호를 붙입니다(클래식 버전은 원래 번호가 없어 해당되지 않음)', '在每首歌前面加上 01、02… 的编号（经典版本来就没有编号，故不适用）'],
    'setlist.customLabelsTitle': ['自訂文字標籤', 'Custom text labels', 'カスタムテキストラベル', '사용자 지정 텍스트 라벨', '自定义文字标签'],
    'setlist.customLabelsDesc': ['畫面上固定顯示的文字，可以換成中文或你喜歡的用語。', 'Fixed on-screen text that you can replace with your own wording.', '画面に固定表示されるテキストです。お好みの表現に変更できます。', '화면에 고정 표시되는 텍스트로, 원하는 문구로 바꿀 수 있습니다.', '画面上固定显示的文字，可以换成你喜欢的用语。'],
    'setlist.labelNowLabel': ['「正在播放」的顯示文字', '"Now playing" display text', '「再生中」の表示テキスト', '"재생 중" 표시 텍스트', '“正在播放”的显示文字'],
    'setlist.labelDoneLabel': ['「已唱」區塊標題', '"Sung" section title', '「既唱」セクションタイトル', '"부른 곡" 섹션 제목', '“已唱”区块标题'],
    'setlist.labelWaitLabel': ['「未唱」區塊標題', '"Upcoming" section title', '「未唱」セクションタイトル', '"안 부른 곡" 섹션 제목', '“未唱”区块标题'],
    'setlist.sceneSettingsTitle': ['場景版設定（目前版型專屬）', 'Scene layout settings (specific to the current layout)', 'シーン版設定（現在のレイアウト専用）', '장면형 설정(현재 레이아웃 전용)', '场景版设置（目前版型专属）'],
    'setlist.sceneSettingsDesc': ['場景版是全螢幕 16:9 舞台設計，背景透明可疊在角色身上；以下設定每個場景版型各自獨立，互不影響。', 'Scene layouts are full-screen 16:9 stage designs with a transparent background that can overlay your character; the settings below are independent per scene layout and don\'t affect each other.', 'シーン版はフルスクリーン16:9のステージデザインで、背景は透明でキャラクターに重ねられます。以下の設定は各シーン版レイアウトごとに独立しており、互いに影響しません。', '장면형은 전체 화면 16:9 무대 디자인이며 배경이 투명해 캐릭터 위에 겹칠 수 있습니다. 아래 설정은 각 장면형 레이아웃마다 독립적이며 서로 영향을 주지 않습니다.', '场景版是全屏 16:9 舞台设计，背景透明可叠在角色身上；以下设置每个场景版型各自独立，互不影响。'],
    'setlist.sceneXLabel': ['內容水平位置', 'Content horizontal position', 'コンテンツの水平位置', '콘텐츠 수평 위치', '内容水平位置'],
    'setlist.sceneYLabel': ['內容垂直位置', 'Content vertical position', 'コンテンツの垂直位置', '콘텐츠 수직 위치', '内容垂直位置'],
    // 標籤刻意跟清單版那顆（快速調整「大小」區的純文字欄位）用同一個字串：兩者在同一個
    // 位置輪流出現，讀起來必須一致。五語沿用長尾表既有譯法（測試會檢查兩張表不得各自表述）。
    'setlist.sceneScaleLabel': ['整體大小倍率', 'Overall size multiplier', '全体のサイズ比率', '전체 크기 비율', '整体大小倍率'],
    'setlist.sceneScaleHint': ['把歌單內容整體放大或縮小，每個版型各自獨立保存；底片邊條放大時每一格變大，看得到的首數會自動變少。', 'Scales the whole setlist content up or down, saved independently per layout. On the Departure Board the film strip enlarges each frame, so fewer tracks stay visible.', 'セットリスト全体を拡大・縮小します（レイアウトごとに個別保存）。フィルムストリップでは 1 コマが大きくなるため、表示される曲数は自動的に少なくなります。', '세트리스트 전체를 확대/축소합니다(레이아웃마다 따로 저장). 필름 스트립은 한 칸이 커지므로 보이는 곡 수가 자동으로 줄어듭니다.', '把歌单内容整体放大或缩小，每个版型各自独立保存；胶片边条放大时每一格变大，看得到的首数会自动变少。'],
    'setlist.noteNowColorLabel': ['正在唱', 'Now singing', '歌唱中', '부르는 중', '正在唱'],
    'setlist.noteNowColorNote': ['歌名與頁首標題', 'Song title and sheet heading', '曲名とページ見出し', '곡명과 페이지 제목', '歌名与页首标题'],
    'setlist.noteWaitColorLabel': ['未唱', 'Not sung yet', '未歌唱', '아직 안 부름', '未唱'],
    'setlist.noteWaitColorNote': ['歌名、編號與勾選框', 'Song title, number and checkbox', '曲名・番号・チェックボックス', '곡명, 번호, 체크박스', '歌名、编号与勾选框'],
    'setlist.noteDoneColorLabel': ['已唱', 'Performed', '歌唱済み', '부른 곡', '已唱'],
    'setlist.noteDoneColorNote': ['刪除線歌名與打勾', 'Struck-through title and tick', '取り消し線付きの曲名とチェック', '취소선 곡명과 체크', '删除线歌名与打勾'],
    'setlist.noteColorHint': ['手帳頁是米色紙上的手寫感設計，三個狀態各一個顏色就夠用。紙張、膠帶、螢光筆與蓋章的紅印泥是這個模板的固定文具元素，不跟著換色。', 'The notebook page is a handwritten design on cream paper, so one colour per state is enough. The paper, washi tape, highlighter and the stamp\'s red ink are fixed stationery elements of this layout and do not follow these colours.', '手帳ページはクリーム色の紙に手書きするデザインなので、状態ごとに 1 色で十分です。紙・マスキングテープ・蛍光ペン・スタンプの朱肉はこのレイアウト固有の文具要素で、この設定では変わりません。', '수첩 페이지는 크림색 종이에 손으로 쓴 느낌의 디자인이라 상태마다 색 하나면 충분합니다. 종이, 마스킹 테이프, 형광펜, 도장의 붉은 인주는 이 레이아웃 고유의 문구 요소라 이 설정을 따르지 않습니다.', '手帐页是米色纸上的手写感设计，三个状态各一个颜色就够用。纸张、胶带、荧光笔与盖章的红印泥是这个模板的固定文具元素，不跟着换色。'],
    'setlist.scenePositionHint': ['把歌單內容整體平移，避免擋住角色站位；位置對目前選擇的場景版型各自獨立生效。', 'Shifts the whole setlist content to avoid blocking your character\'s position; the position applies independently to the currently selected scene layout.', 'セットリスト全体を移動し、キャラクターの立ち位置を隠さないようにします。位置は現在選択中のシーン版レイアウトにのみ独立して適用されます。', '세트리스트 전체를 이동해 캐릭터 위치를 가리지 않게 합니다. 위치는 현재 선택된 장면형 레이아웃에만 독립적으로 적용됩니다.', '把歌单内容整体平移，避免挡住角色站位；位置对目前选择的场景版型各自独立生效。'],
    'setlist.sceneArtistSizeLabel': ['「正在播放」歌手名字級', '"Now playing" artist name font size', '「再生中」のアーティスト名フォントサイズ', '"재생 중" 가수명 글자 크기', '“正在播放”歌手名字级'],
    'setlist.sceneArtistSizeHint': ['場景版大標題下方那行歌手名的字級（Timeline／Diagonal／Constellation 通用）。', 'The font size of the artist name line below the large title in scene layouts (shared by Timeline/Diagonal/Constellation).', 'シーン版の大見出し下にあるアーティスト名行のフォントサイズです（Timeline／Diagonal／Constellation共通）。', '장면형 큰 제목 아래의 가수명 줄 글자 크기입니다(Timeline/Diagonal/Constellation 공통).', '场景版大标题下方那行歌手名的字级（Timeline／Diagonal／Constellation 通用）。'],
    'setlist.tlTitle': ['Timeline 時間軸', 'Timeline', 'Timeline（タイムライン）', 'Timeline(타임라인)', 'Timeline 时间轴'],
    'setlist.tlAxisLabel': ['中央時間軸的垂直位置', 'Vertical position of the central timeline', '中央タイムラインの垂直位置', '중앙 타임라인의 수직 위치', '中央时间轴的垂直位置'],
    'setlist.tlAxisWidthLabel': ['軸線粗細', 'Axis line thickness', '軸線の太さ', '축선 두께', '轴线粗细'],
    'setlist.tlAxisColorLabel': ['軸線顏色', 'Axis line color', '軸線の色', '축선 색상', '轴线颜色'],
    'setlist.tlDotSizeLabel': ['「正在播放」節點大小', '"Now playing" node size', '「再生中」ノードのサイズ', '"재생 중" 노드 크기', '“正在播放”节点大小'],
    'setlist.tlDotColorLabel': ['節點顏色', 'Node color', 'ノードの色', '노드 색상', '节点颜色'],
    'setlist.tlDotHint': ['節點＝軸線上的圓點；「正在播放」的節點會放大並發光（發光跟著節點顏色走）。', 'A node is the dot on the axis line; the "now playing" node enlarges and glows (the glow follows the node color).', 'ノード＝軸線上の丸い点です。「再生中」のノードは拡大して発光します（発光はノードの色に従います）。', '노드는 축선 위의 점입니다. "재생 중" 노드는 커지면서 빛나며(발광은 노드 색을 따름), ', '节点＝轴线上的圆点；“正在播放”的节点会放大并发光（发光跟着节点颜色走）。'],
    'setlist.tlItemGapLabel': ['節點之間的間距', 'Gap between nodes', 'ノード間の間隔', '노드 간 간격', '节点之间的间距'],
    'setlist.tlTextTitle': ['Timeline 歌名與文字', 'Timeline song titles and text', 'Timelineの曲名とテキスト', 'Timeline 곡명 및 텍스트', 'Timeline 歌名与文字'],
    'setlist.tlNamePosLabel': ['歌名相對軸線的位置', 'Song title position relative to the axis', '軸線に対する曲名の位置', '축선 기준 곡명 위치', '歌名相对轴线的位置'],
    'setlist.tlNamePosBelow': ['軸線下方（預設）', 'Below the axis (default)', '軸線の下（既定）', '축선 아래(기본)', '轴线下方（预设）'],
    'setlist.tlNamePosOn': ['貼齊軸線', 'Aligned with the axis', '軸線に沿う', '축선에 맞춤', '贴齐轴线'],
    'setlist.tlNamePosAbove': ['軸線上方', 'Above the axis', '軸線の上', '축선 위', '轴线上方'],
    'setlist.tlNameGapLabel': ['軸線與歌名的間距', 'Gap between axis and song title', '軸線と曲名の間隔', '축선과 곡명 간 간격', '轴线与歌名的间距'],
    'setlist.tlNameSizeLabel': ['歌名字級', 'Song title font size', '曲名フォントサイズ', '곡명 글자 크기', '歌名字级'],
    'setlist.tlNowPosLabel': ['「正在播放」大標題的垂直位置', 'Vertical position of the "now playing" large title', '「再生中」大見出しの垂直位置', '"재생 중" 큰 제목의 수직 위치', '“正在播放”大标题的垂直位置'],
    'setlist.tlNowPosHint': ['畫面中央那組大字（Now Playing＋歌名＋歌手）離畫面頂端的距離。', 'The distance from the top of the screen to the large center text (Now Playing + title + artist).', '画面中央の大きな文字（Now Playing＋曲名＋アーティスト）が画面上端からどれだけ離れているか。', '화면 중앙의 큰 텍스트(Now Playing + 곡명 + 가수)가 화면 상단에서 떨어진 거리입니다.', '画面中央那组大字（Now Playing＋歌名＋歌手）离画面顶端的距离。'],
    'setlist.dgTitle': ['Diagonal 斜線', 'Diagonal', 'Diagonal（斜線）', 'Diagonal(대각선)', 'Diagonal 斜线'],
    'setlist.dgAngleLabel': ['分隔線傾斜角度', 'Divider line tilt angle', '区切り線の傾斜角度', '구분선 기울기 각도', '分隔线倾斜角度'],
    'setlist.dgAngleHint': ['畫面中央那條把歌單與角色分開的斜線角度。', 'The angle of the diagonal line in the center of the screen that separates the setlist from your character.', '画面中央でセットリストとキャラクターを分ける斜め線の角度です。', '화면 중앙에서 세트리스트와 캐릭터를 나누는 대각선의 각도입니다.', '画面中央那条把歌单与角色分开的斜线角度。'],
    'setlist.dgLinePosLabel': ['分隔線水平位置', 'Divider line horizontal position', '区切り線の水平位置', '구분선 수평 위치', '分隔线水平位置'],
    'setlist.dgLineWidthLabel': ['分隔線粗細', 'Divider line thickness', '区切り線の太さ', '구분선 두께', '分隔线粗细'],
    'setlist.dgLineColorLabel': ['分隔線顏色', 'Divider line color', '区切り線の色', '구분선 색상', '分隔线颜色'],
    'setlist.dgWaitSizeLabel': ['未唱／已唱歌曲字級', 'Upcoming/sung song font size', '未唱・既唱曲のフォントサイズ', '안 부른 곡/부른 곡 글자 크기', '未唱／已唱歌曲字级'],
    'setlist.dgWaitSizeHint': ['畫面兩側那排小字歌名（已唱斜體較淡、未唱附編號）的字級。', 'The font size of the small song titles on both sides of the screen (sung is italic and faded, upcoming has numbering).', '画面両側の小さな曲名（既唱は斜体で薄く、未唱は番号付き）のフォントサイズです。', '화면 양쪽의 작은 곡명(부른 곡은 이탤릭체로 흐리게, 안 부른 곡은 번호 포함) 글자 크기입니다.', '画面两侧那排小字歌名（已唱斜体较淡、未唱附编号）的字级。'],
    'setlist.dgWaitTopLabel': ['「正在播放」與未唱歌曲的距離', 'Distance between "now playing" and upcoming songs', '「再生中」と未唱曲の距離', '"재생 중"과 안 부른 곡 사이의 거리', '“正在播放”与未唱歌曲的距离'],
    'setlist.dgWaitTopHint': ['數字越大，未唱清單離「正在播放」的大標題越遠（往畫面下方移動）。', 'The larger the number, the further the upcoming list is from the "now playing" title (moving toward the bottom of the screen).', '数値が大きいほど、未唱リストは「再生中」の大見出しから離れます（画面下方向へ移動）。', '숫자가 클수록 안 부른 곡 목록이 "재생 중" 큰 제목에서 멀어집니다(화면 아래쪽으로 이동).', '数字越大，未唱列表离“正在播放”的大标题越远（往画面下方移动）。'],
    'setlist.cnTitle': ['Constellation 星座', 'Constellation', 'Constellation（星座）', 'Constellation(별자리)', 'Constellation 星座'],
    'setlist.cnSpreadLabel': ['星座節點的疏密程度', 'Constellation node spacing', '星座ノードの密度', '별자리 노드 밀도', '星座节点的疏密程度'],
    'setlist.cnSpreadHint': ['數字越大，代表每首歌的星星節點之間拉得越開（越疏）。', 'The larger the number, the further apart the star nodes for each song are spread (sparser).', '数値が大きいほど、各曲の星ノード間の距離が広がります（疎になります）。', '숫자가 클수록 각 곡의 별 노드 사이 간격이 넓어집니다(성기게).', '数字越大，代表每首歌的星星节点之间拉得越开（越疏）。'],
    'setlist.cnDotColorLabel': ['星點顏色', 'Star dot color', '星の点の色', '별점 색상', '星点颜色'],
    'setlist.cnGlowColorLabel': ['「正在播放」星點的光暈色', 'Glow color of the "now playing" star', '「再生中」の星の光暈色', '"재생 중" 별의 광휘 색상', '“正在播放”星点的光晕色'],
    'setlist.cnDustLabel': ['顯示背景星塵', 'Show background stardust', '背景の星屑を表示', '배경 별가루 표시', '显示背景星尘'],
    'setlist.cnDustSub': ['散落在畫面上的細小星點裝飾，關閉＝更乾淨', 'Small scattered star decorations across the screen; off = a cleaner look', '画面に散らばる小さな星の装飾です。オフにするとよりすっきりします。', '화면에 흩뿌려진 작은 별 장식입니다. 끄면 더 깔끔해집니다.', '散落在画面上的细小星点装饰，关闭＝更干净'],
    'setlist.cnWaitSizeLabel': ['未唱／已唱歌曲字級', 'Upcoming/sung song font size', '未唱・既唱曲のフォントサイズ', '안 부른 곡/부른 곡 글자 크기', '未唱／已唱歌曲字级'],
    'setlist.cnWaitSizeHint': ['星座節點旁邊的小字歌名字級（「正在播放」的大標題不受影響）。', 'The font size of small song titles next to constellation nodes (does not affect the "now playing" large title).', '星座ノードの横にある小さな曲名のフォントサイズです（「再生中」の大見出しには影響しません）。', '별자리 노드 옆의 작은 곡명 글자 크기입니다("재생 중" 큰 제목에는 영향 없음).', '星座节点旁边的小字歌名字级（“正在播放”的大标题不受影响）。'],
    'setlist.classicFxTitle': ['經典版專屬效果（整體背板／文字陰影／發光／描邊）', 'Classic-only effects (overall backdrop / text shadow / glow / outline)', 'クラシック版専用エフェクト（全体背景／文字影／発光／縁取り）', '클래식 전용 효과(전체 배경/텍스트 그림자/발광/윤곽선)', '经典版专属效果（整体背板／文字阴影／发光／描边）'],
    'setlist.bgColorLabel': ['整體背板顏色', 'Overall backdrop color', '全体背景の色', '전체 배경 색상', '整体背板颜色'],
    'setlist.bgOpacityLabel': ['整體背板不透明度', 'Overall backdrop opacity', '全体背景の不透明度', '전체 배경 불투명도', '整体背板不透明度'],
    'setlist.bgOpacityTransparent': ['透明', 'Transparent', '透明', '투명', '透明'],
    'setlist.bgOpacityHintMain': ['0＝完全不鋪，這是預設。清單型模板會', '0 = no backdrop at all, the default. List-style templates will', '0＝背景なし（既定）。リスト型テンプレートは', '0＝배경 없음(기본값). 목록형 템플릿은', '0＝完全不铺，这是预设。列表型模板会'],
    'setlist.bgOpacityHintBold': ['鋪滿整個 OBS 來源範圍', 'fill the entire OBS source area', 'OBSソース範囲全体を埋めます', 'OBS 소스 영역 전체를 채웁니다', '铺满整个 OBS 来源范围'],
    'setlist.bgOpacityHintTail': ['，所以要先把 Browser Source 縮成你要的框再開不透明度，否則會蓋掉那塊區域內的直播畫面。這和「可讀性襯底」是不同層：襯底只墊在文字後面，背板是整塊來源的底色。', ', so resize the Browser Source to your desired frame before turning up opacity — otherwise it will cover the stream footage in that area. This is a different layer from the "readability backing": the backing only sits behind text, while the backdrop is the background color of the entire source.', 'ので、不透明度を上げる前にブラウザソースを希望の枠に縮めてください。そうしないとその範囲の配信映像が隠れてしまいます。これは「可読性の背景」とは別の層です。背景は文字の裏にのみ敷かれますが、この背景板はソース全体の背景色です。', ', 불투명도를 올리기 전에 Browser Source를 원하는 프레임 크기로 줄여야 합니다. 그렇지 않으면 해당 영역의 방송 화면을 덮어버립니다. 이는 "가독성 배경"과는 다른 레이어입니다. 배경은 텍스트 뒤에만 깔리지만, 이 배경판은 소스 전체의 바탕색입니다.', '，所以要先把 Browser Source 缩成你要的框再开不透明度，否则会盖掉那块区域内的直播画面。这和“可读性衬底”是不同层：衬底只垫在文字后面，背板是整块来源的底色。'],
    'setlist.textShadowLabel': ['文字陰影深度', 'Text shadow depth', '文字影の深さ', '텍스트 그림자 깊이', '文字阴影深度'],
    'setlist.textShadowColorLabel': ['陰影顏色', 'Shadow color', '影の色', '그림자 색상', '阴影颜色'],
    'setlist.textShadowHint': ['這是加在「文字」後面的陰影，讓字有立體感，跟「特效」區的卡片外框發光是不同東西。', 'This is a shadow added behind the "text" to give it depth — it is a different thing from the card border glow in the "Effects" section.', 'これは「文字」の背後に加える影で、文字に立体感を与えます。「特効」欄のカード外枠発光とは別のものです。', '이것은 "텍스트" 뒤에 추가되는 그림자로 글자에 입체감을 줍니다. "특효" 영역의 카드 테두리 발광과는 다른 것입니다.', '这是加在“文字”后面的阴影，让字有立体感，跟“特效”区的卡片外框发光是不同东西。'],
    'setlist.textGlowLabel': ['文字發光強度', 'Text glow strength', '文字発光の強さ', '텍스트 발광 강도', '文字发光强度'],
    'setlist.textGlowColorLabel': ['發光顏色', 'Glow color', '発光の色', '발광 색상', '发光颜色'],
    'setlist.textGlowHint': ['讓文字周圍暈開柔光，適合霓虹／夜店風格；跟卡片外框發光是分開的兩層效果。', 'Adds a soft glow around the text, suited to neon/club styles; this is a separate layer from the card border glow.', '文字の周りに柔らかい光をにじませます。ネオン／クラブ風に適しています。カード外枠発光とは別の層の効果です。', '텍스트 주위에 부드러운 빛을 번지게 합니다. 네온/클럽 스타일에 적합합니다. 카드 테두리 발광과는 별개의 레이어 효과입니다.', '让文字周围晕开柔光，适合霓虹／夜店风格；跟卡片外框发光是分开的两层效果。'],
    'setlist.textStrokeLabel': ['文字描邊寬度', 'Text outline width', '文字縁取りの太さ', '텍스트 윤곽선 두께', '文字描边宽度'],
    'setlist.textStrokeColorLabel': ['描邊顏色', 'Outline color', '縁取りの色', '윤곽선 색상', '描边颜色'],
    'setlist.textStrokeHint': ['在文字外圍加一層實色邊框，在複雜背景上能提高文字可讀性。', 'Adds a solid-color outline around the text, improving readability on complex backgrounds.', '文字の周りに単色の縁取りを加え、複雑な背景でも読みやすくします。', '텍스트 주위에 단색 윤곽선을 추가해 복잡한 배경에서도 가독성을 높입니다.', '在文字外围加一层实色边框，在复杂背景上能提高文字可读性。'],
    'template.columnSen': ['素筆直書', 'Plain Brush Vertical', '素筆の縦書き', '담백한 세로쓰기', '素笔竖排'],
    'template.columnFuda': ['字札直書', 'Card Vertical', '字札の縦書き', '글패 세로쓰기', '字札竖排'],
    'template.columnEntranceNative': ['原樣', 'Native', 'そのまま', '기본', '原样'],
    'template.columnEntranceDrift': ['四相漂字', 'Quad Drift', '四方から漂う', '사방에서 떠도는', '四相漂字'],
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
    'tour.advanced.step.obsAiSeparation.title': ['先把歌做成純伴奏', 'Turn songs into instrumentals first', 'まず曲を伴奏だけにする', '먼저 곡을 반주로 만들기', '先把歌做成纯伴奏'],
    'tour.advanced.step.obsAiSeparation.body': ['「AI 伴奏」分頁用 AI 把每首歌拆成人聲和伴奏兩軌。按「未製作的全部排進佇列」一次處理整份播放清單，下面會列出每首的狀態（未製作／製作中／已分離／失敗）。第一次使用會先下載一次元件。', 'The AI Instrumental tab uses AI to split each song into vocal and instrumental tracks. Click “Queue all unprocessed” to run the whole playlist at once; the list below shows each song’s state (not made / processing / separated / failed). The first use downloads the components once.', '「AI 伴奏」タブは、AI で各曲をボーカルと伴奏の2トラックに分けます。「未処理をすべてキューに追加」を押すとプレイリスト全体を一度に処理でき、下のリストに各曲の状態（未作成／処理中／分離済み／失敗）が表示されます。初回のみコンポーネントを一度ダウンロードします。', '‘AI 반주’ 탭은 AI로 각 곡을 보컬과 반주 두 트랙으로 나눕니다. ‘미처리 전체 대기열에 추가’를 누르면 재생목록 전체를 한 번에 처리하며, 아래 목록에 각 곡의 상태(미생성／처리 중／분리됨／실패)가 표시됩니다. 처음 사용할 때 구성 요소를 한 번 내려받습니다.', '“AI 伴奏”分页用 AI 把每首歌拆成人声和伴奏两轨。点“未制作的全部排进队列”一次处理整份播放列表，下面会列出每首的状态（未制作／制作中／已分离／失败）。第一次使用会先下载一次组件。'],
    'tour.advanced.step.obsAiSeparation.hint': ['分離很吃時間，開台前先做好；做完再到下一步開「分離播放模式」。', 'Separation takes a while — do it before going live. Once it’s done, move to the next step to turn on Separated playback mode.', '分離には時間がかかります。配信前に済ませておき、完了したら次のステップで「分離再生モード」をオンにします。', '분리에는 시간이 걸리니 방송 전에 미리 해 두세요. 끝나면 다음 단계에서 ‘분리 재생 모드’를 켭니다.', '分离很吃时间，开播前先做好；做完再到下一步开“分离播放模式”。'],
    'tour.advanced.step.obsDualAudio.title': ['雙路音訊：直播只送伴奏', 'Dual audio: send only the instrumental', 'デュアル音声：配信には伴奏だけ', '이중 오디오: 방송에는 반주만', '双路音频：直播只送伴奏'],
    'tour.advanced.step.obsDualAudio.body': ['開「分離播放模式」後，這程式播放的就是純伴奏，OBS 收到、送出去的也只有伴奏。想邊唱邊聽原唱當參考，要另外走一條不進 OBS 的音訊——完整做法看「新手教學 ⑭ 雙路音訊」。', 'With Separated playback mode on, this app plays the instrumental only, so OBS captures and streams the instrumental only. To hear the original vocals as a guide while singing, route them through a separate channel that does not enter OBS — see “Guide ⑭ Dual audio”.', '「分離再生モード」をオンにすると、本アプリは伴奏だけを再生し、OBS が取り込んで配信するのも伴奏だけになります。歌いながら原曲をガイドにしたい場合は、OBS に入れない別経路で流します。詳しくは「ガイド ⑭ デュアル音声」を参照。', '‘분리 재생 모드’를 켜면 이 앱은 반주만 재생하므로 OBS가 잡아 송출하는 것도 반주뿐입니다. 부르면서 원곡을 가이드로 듣고 싶으면 OBS에 들어가지 않는 별도 경로로 보내세요 — ‘가이드 ⑭ 이중 오디오’ 참조.', '开“分离播放模式”后，这程序播放的就是纯伴奏，OBS 收到、送出去的也只有伴奏。想边唱边听原唱当参考，要另外走一条不进 OBS 的音频——完整做法看“新手教程 ⑭ 双路音频”。'],
    'tour.advanced.step.obsDualAudio.hint': ['只播伴奏、看首頁逐字歌詞跟拍是最不容易出錯的做法；需要原唱參考時再照教學設定監聽。', 'Playing just the instrumental and following the word-by-word lyrics on the home page is the least error-prone setup. Set up monitoring per the guide only when you need the reference vocals.', '伴奏だけを再生し、ホームの一文字ずつの歌詞で合わせるのが最も間違いにくい方法です。原曲ガイドが必要なときだけガイドに従ってモニターを設定します。', '반주만 재생하고 홈의 한 글자씩 가사를 따라가는 것이 가장 실수 적은 방법입니다. 원곡 가이드가 필요할 때만 가이드대로 모니터링을 설정하세요.', '只播伴奏、看首页逐字歌词跟拍是最不容易出错的做法；需要原唱参考时再照教程设置监听。'],
    'tour.advanced.step.liveSetlist.title': ['直播歌單是另一個 OBS 來源', 'The live setlist is a separate OBS source', '配信歌単はOBSの別ソースです', '라이브 세트리스트는 별도의 OBS 소스입니다', '直播歌单是另一个 OBS 来源'],
    'tour.advanced.step.liveSetlist.body': ['跟歌詞來源分開，這裡輸出現在播放、待唱、已唱的清單畫面給觀眾看。左邊選一個模板套用，下面這個網址貼到 OBS 的瀏覽器來源即可；之後在這裡換模板、調設定都會即時套用，不用重新貼網址。', 'Separate from the lyrics source, this outputs a now-playing / upcoming / played list for viewers. Pick a template on the left, then paste the URL below into an OBS Browser Source. Switching templates or settings later applies live — you never need to re-paste the URL.', '歌詞ソースとは別に、現在再生中・待機中・再生済みの一覧を視聴者向けに出力します。左でテンプレートを選び、下のURLをOBSのブラウザソースに貼り付けてください。以降テンプレートや設定を変えても即時反映され、URLを貼り直す必要はありません。', '가사 소스와는 별개로, 지금 재생 중·대기 중·재생 완료 목록을 시청자에게 보여줍니다. 왼쪽에서 템플릿을 고르고 아래 URL을 OBS 브라우저 소스에 붙여 넣으세요. 이후 템플릿이나 설정을 바꿔도 즉시 반영되므로 URL을 다시 붙일 필요가 없습니다.', '跟歌词来源是分开的，这里输出现在播放、待唱、已唱的清单画面给观众看。左边选一个模板套用，下面这个网址粘贴到 OBS 的浏览器来源即可；之后在这里换模板、调设置都会即时套用，不用重新粘贴网址。'],
    'tour.advanced.step.liveSetlist.hint': ['想調整字體、邊框、動畫這些細節，按下面的「開啟詳細設定…」。', 'For fonts, borders, or animation details, use “Open detailed settings…” below.', 'フォントや枠線、アニメーションなど細部の調整は、下の「詳細設定を開く…」から行えます。', '글꼴, 테두리, 애니메이션 같은 세부 설정은 아래 ‘상세 설정 열기…’에서 조정하세요.', '想调整字体、边框、动画这些细节，点下面的“打开详细设置…”。'],
    'tour.advanced.step.liveDeletePlayed.title': ['已唱歌曲要去哪裡刪', 'Where to delete already-played songs', '歌い終わった曲はどこで削除する？', '이미 부른 곡은 어디서 삭제하나요', '已唱歌曲要去哪里删'],
    'tour.advanced.step.liveDeletePlayed.body': ['篩選選單選「已唱」，先篩出唱過的歌；接著按清單右上角的「選取」，勾選要刪的幾首，再按「移除已選」一次清掉。正在播放的歌曲不會被選進去，不用擔心手滑砍到現在這首。', 'Set the filter to “Played” to show songs you’ve already sung, then click “Select” at the top right, check the ones to remove, and click “Remove selected” to clear them at once. The current track is excluded from selection, so you won’t accidentally delete it.', 'フィルターで「再生済み」を選び、歌い終わった曲だけを表示します。右上の「選択」を押し、削除したい曲にチェックを入れて「選択項目を削除」でまとめて消せます。再生中の曲は選択対象に入らないので誤って消す心配はありません。', '필터에서 ‘재생 완료’를 선택해 이미 부른 곡만 걸러내세요. 오른쪽 위 ‘선택’을 누르고 지울 곡에 체크한 뒤 ‘선택 항목 삭제’를 누르면 한 번에 지워집니다. 지금 재생 중인 곡은 선택 대상에서 제외되므로 실수로 지울 걱정은 없습니다.', '筛选菜单选“已唱”，先筛出唱过的歌；接着点清单右上角的“选取”，勾选要删的几首，再点“移除已选”一次清掉。正在播放的歌曲不会被选中，不用担心手滑删到现在这首。'],
    'tour.advanced.step.liveDeletePlayed.hint': ['只想砍這一場的統計、保留播放清單本身，用下一步的「開始新場次」更快。', 'To reset this stream’s tally while keeping the playlist itself, the “Start new session” button in the next step is faster.', 'このライブの集計だけリセットしてプレイリスト自体は残したいなら、次のステップの「新しいセッションを開始」の方が早いです。', '이번 방송 집계만 초기화하고 재생목록 자체는 남기고 싶다면, 다음 단계의 ‘새 세션 시작’이 더 빠릅니다.', '只想清空这一场的统计、保留播放列表本身，用下一步的“开始新场次”更快。'],
    'tour.advanced.step.liveSession.title': ['場次控制與 YouTube 章節', 'Session controls & YouTube chapters', 'セッション操作とYouTubeチャプター', '세션 제어와 YouTube 챕터', '场次控制与 YouTube 章节'],
    'tour.advanced.step.liveSession.body': ['「開始新場次」會清空這場的已唱紀錄和播放清單，重新計數；平常不太需要手動按，開台／收台多半由 OBS WebSocket 自動判斷。這個分頁下面直接列出本場的「已唱歌曲」清單；直播結束後要在 YouTube 影片說明欄放時間戳記，按清單旁的「複製 YouTube 章節」，一次複製整場的時間軸。', '“Start new session” clears this stream’s played history and playlist to restart the count — you rarely need to click it, since going live/offline is usually detected automatically via OBS WebSocket. Further down this tab is the “Played songs” list for this stream; after streaming, use the “Copy YouTube chapters” button next to that list to copy the whole timeline at once for a video description.', '「新しいセッションを開始」はこのライブの再生済み履歴とプレイリストをクリアしてカウントをリセットします。配信の開始・終了は通常OBS WebSocketが自動検知するため、手動で押す機会はあまりありません。このタブの下部に今回の「再生済みの曲」リストがあり、配信後はそのリスト横の「YouTubeチャプターをコピー」ボタンで全体のタイムラインを一括コピーして概要欄に貼れます。', '‘새 세션 시작’은 이번 방송의 재생 완료 기록과 재생목록을 지우고 다시 세기 시작합니다. 방송 시작/종료는 보통 OBS WebSocket이 자동으로 감지하므로 직접 누를 일은 많지 않습니다. 이 탭 아래쪽에 이번 방송의 ‘재생한 곡’ 목록이 있으며, 방송 후에는 그 목록 옆의 ‘YouTube 챕터 복사’ 버튼으로 전체 타임라인을 한 번에 복사해 설명란에 붙여 넣을 수 있습니다.', '“开始新场次”会清空这一场的已唱记录和播放列表，重新计数；平时不太需要手动点，开播/下播大多由 OBS WebSocket 自动判断。这个分页下面直接列出本场的“已唱歌曲”清单；直播结束后要在 YouTube 视频简介放时间戳，点清单旁的“复制 YouTube 章节”，一次复制整场的时间轴。'],
    'tour.advanced.step.liveSession.hint': ['這裡的「已唱」是這場直播的紀錄，跟播放清單裡歌曲卡片上的「已唱」狀態是兩回事——清單裡要刪歌用上一步教的篩選＋選取方式。', '“Played” here refers to this stream’s log — it’s separate from the “Played” status shown on playlist cards. To delete songs from the playlist itself, use the filter + select method from the previous step.', 'ここでの「再生済み」はこのライブの記録であり、プレイリストのカード上に出る「再生済み」ステータスとは別物です。プレイリストから曲を削除するには、前のステップで説明したフィルター＋選択の方法を使ってください。', '여기서 ‘재생 완료’는 이번 방송의 기록이며, 재생목록 카드에 표시되는 ‘재생 완료’ 상태와는 다릅니다. 재생목록 자체에서 곡을 지우려면 이전 단계에서 설명한 필터 + 선택 방법을 사용하세요.', '这里的“已唱”是这场直播的记录，跟播放列表歌曲卡片上的“已唱”状态是两回事——列表里要删歌请用上一步教的筛选＋选取方式。'],
    'tour.advanced.step.liveTwitch.title': ['Twitch 連線在哪裡', 'Where to connect Twitch', 'Twitch連携はどこで行う？', 'Twitch 연결은 어디서 하나요', 'Twitch 连接在哪里'],
    'tour.advanced.step.liveTwitch.body': ['左側選單切到「連線與系統」，往下捲到「Twitch 開台／聊天室點歌」卡片，按「連接 Twitch」走官方登入完成授權；連上後才能開放觀眾用聊天室指令或忠誠點數點歌。已連接時同一顆按鈕會變成「解除 Twitch 授權」。「Twitch 點歌」那個分頁是連上之後用來看點歌狀態、暫停點歌的地方。', 'Switch to “Connection & System” in the sidebar and scroll down to the “Twitch Streaming / Chat Requests” card. Click “Connect Twitch” to authorize through Twitch’s official login; once connected, viewers can request songs via chat commands or channel points. The button becomes “Revoke Twitch Authorization” once connected. The separate “Twitch Requests” tab is where you manage requests and pause them after you’re connected.', '左側メニューを「接続とシステム」に切り替え、下にスクロールして「Twitch配信／チャットリクエスト」カードを開きます。「Twitchに接続」を押すとTwitch公式ログインで認証できます。接続すると、視聴者がチャットコマンドやチャンネルポイントでリクエストできるようになります。接続済みの場合、同じボタンが「Twitch認証を解除」に変わります。「Twitchリクエスト」タブは接続後にリクエストの状態確認や一時停止を行う場所です。', '왼쪽 메뉴를 ‘연결 및 시스템’으로 전환하고 아래로 스크롤해 ‘Twitch 방송/채팅 신청곡’ 카드를 찾으세요. ‘Twitch 연결’을 누르면 Twitch 공식 로그인으로 인증합니다. 연결되면 시청자가 채팅 명령어나 채널 포인트로 곡을 신청할 수 있습니다. 이미 연결된 상태라면 같은 버튼이 ‘Twitch 인증 해제’로 바뀝니다. 별도의 ‘Twitch 신청곡’ 탭은 연결 후 신청곡 상태를 확인하고 일시정지하는 곳입니다.', '左侧菜单切到“连接与系统”，往下滚动到“Twitch 开播／聊天室点歌”卡片，点“连接 Twitch”走官方登录完成授权；连上后观众才能用聊天室指令或忠诚点数点歌。已连接时同一个按钮会变成“解除 Twitch 授权”。“Twitch 点歌”那个分页是连上之后用来看点歌状态、暂停点歌的地方。'],
    'tour.advanced.step.liveTwitch.hint': ['沒有要開放觀眾點歌的話，這張卡片可以完全跳過，不影響其他功能。', 'If you don’t need viewer song requests, you can skip this card entirely — it doesn’t affect anything else.', '視聴者リクエストを使わないなら、このカードは完全にスキップしても他の機能に影響しません。', '시청자 신청곡 기능이 필요 없다면 이 카드는 완전히 건너뛰어도 다른 기능에는 영향이 없습니다.', '不打算开放观众点歌的话，这张卡片可以完全跳过，不影响其他功能。'],
    'tour.step.navigation.title': ['這是控制面板', 'This is the control panel', 'ここがコントロールパネルです', '여기가 제어판입니다', '这是控制面板'],
    'tour.step.navigation.body': ['你在這裡操作歌曲與歌詞，觀眾不會看見這個畫面。左側可切換首頁、媒體庫、歌詞設定、直播歌單、Twitch 點歌與連線與系統。', 'This is where you control songs and lyrics; viewers never see this screen. The left sidebar switches between Home, Library, Lyrics Settings, Live Setlist, Twitch Requests, and Connection & System.', 'ここで曲と歌詞を操作します。この画面が視聴者に見えることはありません。左側からホーム、メディアライブラリ、歌詞設定、配信セットリスト、Twitch リクエスト、接続とシステムへ切り替えます。', '여기서 곡과 가사를 조작하며 시청자에게는 이 화면이 보이지 않습니다. 왼쪽에서 홈, 미디어 보관함, 가사 설정, 방송 세트리스트, Twitch 신청곡, 연결 및 시스템으로 이동합니다.', '你在这里操作歌曲与歌词，观众不会看到这个画面。左侧可切换首页、媒体库、歌词设置、直播歌单、Twitch 点歌与连接与系统。'],
    'tour.step.navigation.hint': ['先記住左側選單的位置，其他功能之後再慢慢認識。', 'Just remember where the sidebar is; you can learn the other features later.', 'まずは左側メニューの位置だけ覚えておけば大丈夫です。', '지금은 왼쪽 메뉴 위치만 기억하면 됩니다.', '先记住左侧菜单的位置，其他功能之后再慢慢了解。'],
    'tour.step.source.title': ['加入第一首歌', 'Add your first song', '最初の曲を追加', '첫 곡 추가하기', '添加第一首歌'],
    'tour.step.source.body': ['在「加入音樂」分頁貼上 YouTube 連結、用「搜尋 YouTube」找歌，或切到「本機檔案」加入電腦裡的音訊。現在一首測試歌就夠。', 'On the Add music tab, paste a YouTube link, use Search YouTube, or switch to Local Files to add audio from your computer. One test song is enough for now.', '「曲を追加」タブで YouTube リンクを貼るか、「YouTube を検索」で曲を探すか、「ローカルファイル」に切り替えてパソコン内の音声を追加します。今はテスト曲が1曲あれば十分です。', '‘음악 추가’ 탭에서 YouTube 링크를 붙여 넣거나 ‘YouTube 검색’으로 곡을 찾거나 ‘로컬 파일’로 전환해 컴퓨터의 오디오를 추가하세요. 지금은 테스트 곡 한 곡이면 됩니다.', '在“加入音乐”分页粘贴 YouTube 链接、用“搜索 YouTube”找歌，或切到“本地文件”添加电脑里的音频。现在一首测试歌就够。'],
    'tour.step.source.mobileBody': ['在「加入音樂」分頁貼上 YouTube 連結並匯入；本機檔案可在導覽結束後再切分頁加入。', 'On the Add music tab, paste and import a YouTube link. You can switch to Local Files after the tour.', '「曲を追加」タブで YouTube リンクを貼り付けて読み込みます。ローカルファイルはツアー終了後に切り替えられます。', '‘음악 추가’ 탭에서 YouTube 링크를 붙여 넣어 가져오세요. 로컬 파일은 둘러보기 후에 전환할 수 있습니다.', '在“加入音乐”分页粘贴 YouTube 链接并导入；本地文件可在导览结束后再切分页添加。'],
    'tour.step.source.hint': ['手邊沒有歌曲也沒關係，按下方「先用示範歌詞」即可繼續。', 'No song ready? Choose “Use sample lyrics” below to continue.', '曲がなくても、下の「サンプル歌詞を使う」で続けられます。', '곡이 없다면 아래의 ‘샘플 가사 먼저 보기’를 눌러 계속하세요.', '手边没有歌曲也没关系，点击下方“先用示范歌词”即可继续。'],
    'tour.step.playlist.title': ['這是播放清單', 'This is the playlist', 'ここがプレイリストです', '여기가 재생목록입니다', '这是播放列表'],
    'tour.step.playlist.body': ['加入的歌曲會出現在這裡。點選歌曲會把它設為目前播放項目；媒體庫則保存以前匯入過的歌曲。', 'Songs you add appear here. Select one to make it the current track; the Library stores songs you imported before.', '追加した曲はここに表示されます。曲を選ぶと現在の再生曲になり、メディアライブラリには以前取り込んだ曲が保存されます。', '추가한 곡이 여기에 표시됩니다. 곡을 선택하면 현재 재생 곡이 되며, 미디어 보관함에는 이전에 가져온 곡이 저장됩니다.', '添加的歌曲会出现在这里。点击歌曲会将它设为当前播放项目；媒体库则保存以前导入过的歌曲。'],
    'tour.step.playlist.hint': ['播放清單是這次準備要唱的順序；媒體庫是長期保存歌曲的倉庫。', 'The playlist is your order for this session; the Library is long-term storage.', 'プレイリストは今回歌う順番、メディアライブラリは長期保存する場所です。', '재생목록은 이번 방송 순서이고, 미디어 보관함은 곡을 오래 보관하는 곳입니다.', '播放列表是这次准备演唱的顺序；媒体库是长期保存歌曲的仓库。'],
    'tour.step.player.title': ['播放與切歌', 'Play and change tracks', '再生と曲送り', '재생 및 곡 전환', '播放与切歌'],
    'tour.step.player.body': ['這裡控制播放、暫停、上一首、下一首與歌曲進度。歌曲開始播放後，歌詞會依時間同步。', 'Control play, pause, previous, next, and song position here. Once playback starts, the lyrics follow the timeline.', 'ここで再生、一時停止、前の曲、次の曲、再生位置を操作します。再生を始めると歌詞が時間に合わせて同期します。', '여기서 재생, 일시정지, 이전 곡, 다음 곡, 재생 위치를 조작합니다. 재생이 시작되면 가사가 시간에 맞춰 동기화됩니다.', '这里控制播放、暂停、上一首、下一首与歌曲进度。歌曲开始播放后，歌词会按时间同步。'],
    'tour.step.player.hint': ['示範歌詞不需要播放音訊；真的歌曲則先選歌，再按中央播放鍵。', 'Sample lyrics need no audio. For a real song, select it first, then press the center Play button.', 'サンプル歌詞には音声再生は不要です。実際の曲は先に選び、中央の再生ボタンを押します。', '샘플 가사는 오디오 재생이 필요 없습니다. 실제 곡은 먼저 선택한 뒤 가운데 재생 버튼을 누르세요.', '示范歌词不需要播放音频；真实歌曲则先选歌，再按中央播放键。'],
    'tour.step.preview.title': ['看到歌詞就代表流程正常', 'Lyrics here means the flow works', '歌詞が出れば流れは正常', '가사가 보이면 흐름이 정상', '看到歌词就代表流程正常'],
    'tour.step.preview.body': ['這是 Live Bar 的「目前歌詞」迷你視圖，也是對時用的地方。這裡有字，就代表選歌 → 歌詞 → 同步的核心流程正常。觀眾看到的完整畫面在「歌詞設定」頁的預覽。', 'This is the Live Bar’s Current lyric mini view, also used for timing. Text here means the pick-song → lyrics → sync flow works. The full picture viewers see is in the preview on the Lyric settings page.', 'これは Live Bar の「現在の歌詞」ミニ表示で、タイミング合わせにも使います。ここに文字が出れば、曲選択→歌詞→同期の流れは正常です。視聴者が見る完成画面は「歌詞設定」ページのプレビューにあります。', 'Live Bar의 ‘현재 가사’ 미니 뷰이며 타이밍 조정에도 씁니다. 여기 글자가 보이면 곡 선택 → 가사 → 동기화 흐름이 정상입니다. 시청자가 보는 완성 화면은 ‘가사 설정’ 페이지의 미리보기에 있습니다.', '这是 Live Bar 的“当前歌词”迷你视图，也是对时用的地方。这里有字，就代表选歌 → 歌词 → 同步的核心流程正常。观众看到的完整画面在“歌词设置”页的预览。'],
    'tour.step.preview.hint': ['完整的所見即所得預覽（字體、動畫、位置）在歌詞設定頁；這裡只確認歌詞有沒有跟著跑。', 'The full what-you-see-is-what-you-get preview (font, animation, position) is on the Lyric settings page. Here you only confirm that the lyrics are following along.', '完全な WYSIWYG プレビュー（フォント・アニメ・位置）は「歌詞設定」ページにあります。ここでは歌詞が追従しているかだけを確認します。', '완전한 WYSIWYG 미리보기(글꼴·애니메이션·위치)는 ‘가사 설정’ 페이지에 있습니다. 여기서는 가사가 따라오는지만 확인합니다.', '完整的所见即所得预览（字体、动画、位置）在歌词设置页；这里只确认歌词有没有跟着跑。'],
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
