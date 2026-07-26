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
    'common.copy': ['複製', 'Copy', 'コピー', '복사', '复制'],
    'common.clear': ['清除', 'Clear', 'クリア', '지우기', '清除'],
    'common.import': ['匯入', 'Import', 'インポート', '가져오기', '导入'],
    'common.export': ['匯出', 'Export', 'エクスポート', '내보내기', '导出'],
    'common.select': ['選取', 'Select', '選択', '선택', '选择'],
    'common.retry': ['重試', 'Retry', '再試行', '다시 시도', '重试'],
    'common.all': ['全部', 'All', 'すべて', '전체', '全部'],
    'common.off': ['關', 'Off', 'オフ', '끔', '关'],
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
    'playlist.filterPlayed': ['已唱', 'Performed', '再生済み', '부른 곡', '已唱'],
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
    'playlist.continuousHint': ['一首播完自動播下一首；關閉時單曲播完即停', 'Automatically play the next track; when off, stop after each track', '曲の終了後に次を自動再生。オフでは一曲ごとに停止します', '곡이 끝나면 다음 곡을 자동 재생합니다. 끄면 한 곡 뒤 멈춥니다', '一首播完后自动播放下一首；关闭时单曲播完即停'],
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
    'twitch.pauseRequests': ['暫停點歌', 'Pause requests', 'リクエストを一時停止', '신청곡 일시 중지', '暂停点歌'],
    'twitch.openRequests': ['開放點歌', 'Open requests', 'リクエストを受付', '신청곡 열기', '开放点歌'],
    'twitch.openManagement': ['開啟點歌管理…', 'Open request management…', 'リクエスト管理を開く…', '신청곡 관리 열기…', '打开点歌管理…'],
    'twitch.loadingConnection': ['Twitch 讀取中', 'Loading Twitch', 'Twitch を読み込み中', 'Twitch 불러오는 중', 'Twitch 读取中'],
    'twitch.loadingRequests': ['點歌讀取中', 'Loading requests', 'リクエストを読み込み中', '신청곡 불러오는 중', '点歌读取中'],
    'twitch.loadingRewards': ['忠誠點數讀取中', 'Loading channel points', 'チャンネルポイントを読み込み中', '채널 포인트 불러오는 중', '忠诚点数读取中'],
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
    'twitch.navRewards': ['忠誠點數', 'Channel points', 'チャンネルポイント', '채널 포인트', '忠诚点数'],
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
    'twitch.rewardsPaused': ['忠誠點數已暫停', 'Channel points paused', 'チャンネルポイント一時停止中', '채널 포인트 일시 중지됨', '忠诚点数已暂停'],
    'twitch.rewardsEnabled': ['忠誠點數已啟用', 'Channel points enabled', 'チャンネルポイント有効', '채널 포인트 활성화됨', '忠诚点数已启用'],
    'twitch.rewardsDisabled': ['忠誠點數已停用', 'Channel points disabled', 'チャンネルポイント無効', '채널 포인트 비활성화됨', '忠诚点数已停用'],
    'twitch.repliesEnabled': ['自動回覆已啟用', 'Auto replies enabled', '自動返信有効', '자동 답변 활성화됨', '自动回复已启用'],
    'twitch.repliesDisabled': ['自動回覆已停用', 'Auto replies disabled', '自動返信無効', '자동 답변 비활성화됨', '自动回复已停用'],
    'twitch.unsavedCount': ['{count} 個分類有尚未儲存的變更', '{count} categories have unsaved changes', '{count} カテゴリに未保存の変更があります', '{count}개 분류에 저장하지 않은 변경사항이 있습니다', '{count} 个分类有未保存的更改'],
    'system.obsUrls': ['OBS 來源網址', 'OBS source URLs', 'OBS ソース URL', 'OBS 소스 URL', 'OBS 来源网址'],
    'system.lyricsDisplay': ['歌詞畫面', 'Lyrics display', '歌詞画面', '가사 화면', '歌词画面'],
    'system.setlistDisplay': ['歌單畫面', 'Setlist display', 'セットリスト画面', '세트리스트 화면', '歌单画面'],
    'system.obsUrlHint': ['在 OBS 新增「瀏覽器」來源後貼上對應網址；或用下方 OBS 連動一次建立兩個來源。', 'Paste these URLs into OBS Browser Sources, or use OBS integration below to create both at once.', 'OBS の「ブラウザ」ソースに URL を貼るか、下の OBS 連携で両方を作成します。', 'OBS 브라우저 소스에 URL을 붙여넣거나 아래 OBS 연동으로 두 소스를 한 번에 만드세요.', '在 OBS 新增“浏览器”来源后粘贴对应网址；或用下方 OBS 联动一次建立两个来源。'],
    'system.remote': ['手機遙控器', 'Mobile remote', 'モバイルリモコン', '모바일 리모컨', '手机遥控器'],
    'system.remoteHint': ['手機和電腦連上同一個 Wi-Fi，掃描 QR code 或輸入網址即可遙控播放；不要開放到外網。', 'Connect your phone and computer to the same Wi-Fi, then scan the QR code or enter the URL. Do not expose it to the internet.', 'スマートフォンと PC を同じ Wi-Fi に接続し、QR コードまたは URL で操作してください。外部公開はしないでください。', '휴대폰과 컴퓨터를 같은 Wi-Fi에 연결한 뒤 QR 코드나 URL로 조작하세요. 외부 인터넷에 공개하지 마세요.', '手机和电脑连接同一 Wi-Fi，扫描二维码或输入网址即可遥控播放；请勿开放到外网。'],
    'system.detectingLan': ['偵測區網位址中…', 'Detecting LAN address…', 'LAN アドレスを検出中…', 'LAN 주소 확인 중…', '正在检测局域网地址…'],
    'system.remoteQrAlt': ['手機遙控器 QR code', 'Mobile remote QR code', 'モバイルリモコン QR コード', '모바일 리모컨 QR 코드', '手机遥控器二维码'],
    'system.remoteUrlHint': ['手機瀏覽器打開這個網址（不是 localhost），會自動轉到遙控器頁面。', 'Open this URL on your phone (not localhost) to reach the remote.', 'スマートフォンでこの URL（localhost ではありません）を開くとリモコンへ移動します。', '휴대폰에서 이 URL(localhost 아님)을 열면 리모컨으로 이동합니다.', '在手机浏览器打开这个网址（不是 localhost），会自动转到遥控器页面。'],
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
    const altKey = element.getAttribute('data-i18n-alt');
    if (textKey) element.textContent = t(textKey);
    if (titleKey) element.setAttribute('title', t(titleKey));
    if (ariaKey) element.setAttribute('aria-label', t(ariaKey));
    if (placeholderKey) element.setAttribute('placeholder', t(placeholderKey));
    if (altKey) element.setAttribute('alt', t(altKey));
  }

  function apply(rootNode) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = activeLocale;
    const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
    if (scope.matches && scope.matches('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt]')) {
      translateElement(scope);
    }
    scope.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt]')
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
