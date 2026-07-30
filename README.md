# Elitesand Pro

**Languages / 語言 / 言語 / 언어 / 语言**  
[繁體中文](#繁體中文) · [English](#english) · [日本語](#日本語) · [한국어](#한국어) · [简体中文](#简体中文)

---

## 繁體中文

### 版本狀態

**最新穩定版：`v0.9.7`**

`v0.9.7` 將作為接下來兩週的穩定驗證版本，期間原則上不再新增功能或發布一般更新，只處理必要的重大問題。完成兩週實際直播與使用情境驗證後，預計發布 **`v1.0.0` 正式穩定版**。

> [!WARNING]
> `v0.7.1`～`v0.7.3` 的舊更新器無法安全完成跨版本升級。請下載完整新版安裝程式或 Portable 版本，並先保留舊資料夾備份。`v0.7.3-p0-hotfix.1` 或之後版本可依程式提示使用安全線上更新。

### 產品定位

Elitesand Pro 是為 VTuber、歌回實況主與直播演出者設計的 Windows 桌面工具。它將歌曲管理、歌詞搜尋、同步播放、OBS 動態歌詞、直播歌單與 Twitch 點歌流程整合在同一套本機應用程式中。

程式在本機執行，OBS 透過 Browser Source 載入透明歌詞與歌單畫面；桌面控制台、手機遙控器與 OBS 顯示來源會即時同步。

### 主要功能

#### 歌曲匯入與播放

- 貼上 YouTube 單曲或播放清單連結，自動下載音訊、辨識歌手／歌名、搜尋歌詞與取得封面。
- 支援 MP3、FLAC、WAV、M4A、OGG 等本機音訊拖放匯入。
- 匯入前檢查影片時長、類型與重複項目，降低誤下載非音樂內容的風險。
- 單一匯入佇列、播放清單批次工作、取消、重試與工作狀態管理。
- 播放、暫停、上一首、下一首、進度拖曳與迷你播放器。
- 每首歌可獨立保存 ±12 半音變調、0.5x～1.5x 變速與時間偏移。
- 內建 SoundTouch／WSOLA 高品質變調與變速處理。
- 播放清單拖曳排序、歌曲資訊編輯、清單匯入／匯出與清除確認。
- 媒體庫自動保存已使用歌曲、播放次數、歌詞、時間校正與播放設定。

#### 歌詞搜尋與處理

- 多來源並行搜尋：BetterLyrics、Apple Music、酷狗、QQ Music、LRCLIB、網易雲等。
- 自動比對最佳歌詞，也可手動選擇來源。
- 支援逐字、逐句、LRC、KRC、TTML、SRT 與純文字歌詞。
- 可直接貼上歌詞，或使用逐行時間軸編輯器修正每句時間。
- 一鍵「對齊第一句」整體平移歌詞時間。
- 日文／韓文羅馬拼音、中文漢語拼音與部分中文諧音顯示。
- 簡體轉繁體顯示，不破壞拼音與原始時間資料。
- 清洗來源中的多餘製作資訊、工作室名稱、版本註記與錯誤標題。
- 歌詞來源快取、健康狀態、失敗重試與來源降級處理。

#### OBS 動態歌詞

內建七種歌詞演出模板：

- 經典疊層
- 星砂流光
- 折光階梯
- 斜拍告白
- 潮汐心景
- 霓彩伴唱／KTV
- 直書句流

每個模板可獨立保存：

- 字體、字級、顏色、描邊與透明度
- 位置、間距、對齊、顯示範圍
- 動畫強度與切換效果
- 具名預設

其他能力：

- OBS 透明背景 Browser Source。
- 逐字掃光、逐句切換、間奏倒數與 KTV 時鐘同步。
- 緊急隱藏只隱藏 Elitesand Pro 元素，不遮蓋整個直播畫面。
- OBS 歌詞與歌單來源連線狀態即時顯示。
- 修改設定後即時同步，不需要重新貼 OBS 網址。

#### 直播歌單

- 顯示已唱、正在唱與接下來歌曲。
- 自動記錄場次歌曲與時間戳，可複製為 YouTube 章節。
- 支援角落清單與全畫面場景版型。
- 多種主題與 40 項以上外觀設定。
- 依 OBS Browser Source 尺寸自動調整版面。
- 長歌名與長歌手名稱會自動分配空間，避免重要資訊被擠壓。
- 可建立、保存與切換不同直播場次。

#### Twitch 整合

- Twitch Device Code Flow 登入，不需要 Client Secret。
- 依 Twitch 實際開台時間自動建立直播歌單場次。
- 聊天室點歌指令與 YouTube 連結解析。
- 點歌先進入待確認區，由主播確認後才下載，不會直接污染正式歌單。
- 匯入失敗可重試，逾時或拒絕可取消。
- 忠誠點數兌換點歌、必要文字輸入、成功完成與失敗退款。
- 點歌限制、歌曲長度、重複歌曲、使用者名額與公平工作階段。
- 觀眾可查詢、自行取消，管理員可透過聊天室管理。
- 自訂成功、失敗、等待與拒絕回覆。
- Twitch 斷線重連、請求持久化與程式重啟後恢復。
- 未知 EventSub 或聊天 fragment 會安全忽略，不中斷整體流程。

#### 控制與安全

- 手機遙控器：播放、切歌、進度、變調、歌詞來源、模板與預設控制。
- Stream Deck HTTP API：`/api/deck/:action`。
- 可選 PIN 保護，避免同區網裝置誤操作；OBS 顯示來源不受影響。
- 唯讀／可寫控制權限與請求大小限制。
- 狀態版本、損壞備份、自動恢復、資料遷移與回滾。
- 多實例與連接衝突保護。
- 詳細日誌、錯誤提示、yt-dlp／FFmpeg 健康檢查。

#### 多語言介面

程式目前支援：

- 繁體中文
- English
- 日本語
- 한국어
- 简体中文

主要桌面操作、Twitch 狀態、錯誤訊息、授權流程與動態數字格式皆已納入本地化；缺少字串時會回退至繁體中文。

### 安裝方式

#### 一般使用者

請從 GitHub Releases 下載最新的 Windows Installer 或 Portable 版本。

- **Installer**：執行安裝程式並依精靈完成安裝。
- **Portable**：解壓縮後直接執行啟動檔，不需另外安裝 Node.js、yt-dlp 或 FFmpeg。

安裝包目前未進行商業程式碼簽章，Windows SmartScreen 可能顯示警告。請確認下載來源與 SHA-256 校驗值後再執行。

PowerShell 驗證範例：

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.7.exe" -Algorithm SHA256
```

#### 原始碼開發

需求：Node.js 18+

```bash
npm install
npm start
```

Electron 開發與測試：

```bash
npm run electron
npm test
npm run smoke:electron
npm run smoke:portable
npm run smoke:reliability
```

### OBS 設定

1. 在 Elitesand Pro 複製「歌詞網址」或「歌單網址」。
2. OBS 新增「瀏覽器」來源。
3. 貼上網址並設定尺寸；歌詞通常建議使用直播畫布尺寸，例如 1920×1080。
4. 設定修改後會即時同步。若 OBS 仍顯示舊內容，請對來源按右鍵並重新整理快取。

常用網址：

| 網址 | 用途 |
|---|---|
| `/` | 桌面控制面板 |
| `/controller` | 手機遙控器 |
| `/display` | OBS 動態歌詞 |
| `/setlist` | OBS 直播歌單 |

### 安全更新

安全增量更新只接受 GitHub Release 中名稱完全相符的：

- `update.zip`
- `update.zip.sha256`

更新器會驗證 SHA-256、ZIP 路徑與大小、檔案白名單、manifest、依賴與 lockfile 結構。`data/`、`downloads/`、`logs/`、設定、授權資料、Twitch token、PIN 與使用者媒體不會被增量更新覆蓋。

若依賴或封裝結構不相容，程式會要求下載完整安裝包或 Portable 版本。

### 打包

```powershell
npm run package:portable
npm run package:update -- -BaselineRoot "C:\path\to\previous-portable\app"
npm run package:installer
```

建置會產生對應 SHA-256 檔案。Portable 預設包含 Node.js、yt-dlp、FFmpeg／ffprobe，並附 FFmpeg 原始碼快照、GPLv3 與建置資訊。

### 授權

Elitesand Pro 採用 [Elitesand Pro 授權條款](LICENSE)：可免費用於個人與商業直播／演出，允許私人且不對外散布的自用修改；未經書面同意不得重新散布原版或修改版。

第三方元件依其原授權使用，詳見 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。歌曲、歌詞、封面及其他媒體權利不包含在本專案授權內。

---

## English

### Release status

**Latest stable release: `v0.9.7`**

`v0.9.7` is the stabilization build for the next two weeks. No normal feature updates are planned during this period; only critical fixes will be considered. After two weeks of real-world streaming validation, **`v1.0.0` stable** is planned for release.

> [!WARNING]
> The updater bundled with `v0.7.1`–`v0.7.3` cannot safely complete major upgrades. Download the latest full Installer or Portable build and keep a backup of the old folder. Users on `v0.7.3-p0-hotfix.1` or later may use the safe updater when the application allows it.

### Overview

Elitesand Pro is a Windows desktop tool for VTubers, singing streamers, and live performers. It combines song import, lyrics lookup, synchronized playback, animated OBS lyrics, live setlists, and Twitch song requests in one local application.

### Core features

- YouTube single-video and playlist import with audio, metadata, cover art, and lyrics lookup.
- Local MP3, FLAC, WAV, M4A, and OGG import.
- Playlist queue, cancellation, retry, duplicate checks, duration checks, and media library persistence.
- Per-song transpose, tempo, timing offset, lyrics, and playback settings.
- Multi-source lyrics search: BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase, and fallbacks.
- Word-synced, line-synced, LRC, KRC, TTML, SRT, and plain-text lyrics.
- Timeline editor, first-line alignment, romanization, pinyin, and Simplified-to-Traditional display conversion.
- Seven animated lyrics templates with independent style settings and named presets.
- Transparent OBS lyrics and setlist Browser Sources with instant synchronization.
- KTV word highlighting, interlude countdowns, clock synchronization, and emergency hide.
- Live setlist sessions with sung / now playing / up next states and YouTube chapter timestamps.
- Twitch Device Code login, chat requests, approval queue, retries, expiration, and persistence.
- Twitch Channel Points requests with completion, rejection, timeout, and automatic refund handling.
- Fair-request sessions, duplicate limits, viewer quotas, self-cancel, moderator controls, and custom replies.
- Phone remote, Stream Deck HTTP API, optional PIN protection, health checks, logs, backup, recovery, and rollback.
- Five-language UI: Traditional Chinese, English, Japanese, Korean, and Simplified Chinese.

### Installation

Download the latest Windows Installer or Portable build from GitHub Releases.

- **Installer**: run the setup wizard.
- **Portable**: extract and launch directly; Node.js, yt-dlp, and FFmpeg are bundled.

The build is currently unsigned, so Windows SmartScreen may display a warning. Verify the download source and SHA-256 checksum before running it.

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.7.exe" -Algorithm SHA256
```

### Development

Requires Node.js 18+.

```bash
npm install
npm start
npm run electron
npm test
npm run smoke:electron
npm run smoke:portable
npm run smoke:reliability
```

### OBS setup

1. Copy the Lyrics URL or Setlist URL from Elitesand Pro.
2. Add an OBS Browser Source.
3. Paste the URL and set the source size, usually 1920×1080 for lyrics.
4. Changes sync immediately. Refresh the Browser Source cache if OBS shows stale content.

| URL | Purpose |
|---|---|
| `/` | Desktop control panel |
| `/controller` | Phone remote |
| `/display` | Animated lyrics overlay |
| `/setlist` | Live setlist overlay |

### Updates and packaging

Incremental updates only accept `update.zip` and `update.zip.sha256`, and validate checksums, paths, sizes, manifests, file allowlists, dependencies, and lockfiles. User data, downloads, logs, settings, tokens, PIN state, and media are preserved.

```powershell
npm run package:portable
npm run package:update -- -BaselineRoot "C:\path\to\previous-portable\app"
npm run package:installer
```

### License

Elitesand Pro is free for personal and commercial streaming or performance. Private, non-distributed modifications are allowed. Redistribution of the original or modified application requires written permission. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

---

## 日本語

### リリース状況

**最新安定版：`v0.9.7`**

`v0.9.7` は今後2週間の安定性検証版です。この期間は通常の機能追加や更新を行わず、重大な問題のみ必要に応じて修正します。2週間の実配信テスト完了後、**`v1.0.0` 正式安定版**を公開する予定です。

### 概要

Elitesand Pro は、VTuber、歌配信者、ライブ出演者向けの Windows デスクトップツールです。YouTube／ローカル音源の取り込み、歌詞検索、同期再生、OBS 用の動く歌詞、セットリスト、Twitch リクエストを一つのローカルアプリに統合します。

### 主な機能

- YouTube 単曲・プレイリストの音源、曲情報、カバー、歌詞の自動取得。
- MP3、FLAC、WAV、M4A、OGG のローカル音源取り込み。
- 再生キュー、キャンセル、再試行、重複・時間チェック、メディアライブラリ。
- 曲ごとのキー、テンポ、歌詞タイミング、再生設定の保存。
- BetterLyrics、Apple Music、Kugou、QQ Music、LRCLIB、NetEase などの複数歌詞ソース。
- 単語同期、行同期、LRC、KRC、TTML、SRT、プレーンテキスト対応。
- タイムライン編集、先頭行合わせ、ローマ字、ピンイン、簡体字から繁体字への表示変換。
- 7種類の歌詞アニメーションとテンプレート別設定・プリセット。
- OBS 用透明歌詞／セットリスト Browser Source とリアルタイム同期。
- KTV ハイライト、間奏カウントダウン、時計同期、緊急非表示。
- 配信セットリスト、歌唱履歴、次曲表示、YouTube チャプター出力。
- Twitch Device Code 認証、チャットリクエスト、承認、再試行、期限切れ、永続化。
- チャンネルポイントによる曲リクエスト、完了・拒否・タイムアウト・自動返金。
- 公平な受付セッション、重複制限、視聴者枠、自分でキャンセル、モデレーター操作。
- スマートフォンリモコン、Stream Deck HTTP API、PIN 保護、ログ、バックアップ、復旧。
- 対応言語：繁体字中国語、英語、日本語、韓国語、簡体字中国語。

### インストール

GitHub Releases から最新の Windows Installer または Portable 版をダウンロードしてください。

- **Installer**：セットアップウィザードを実行します。
- **Portable**：展開して直接起動できます。Node.js、yt-dlp、FFmpeg は同梱されています。

現在の配布物はコード署名されていないため、Windows SmartScreen の警告が表示される場合があります。配布元と SHA-256 を確認してください。

### OBS 設定

Elitesand Pro から歌詞 URL またはセットリスト URL をコピーし、OBS の Browser Source に貼り付けます。設定変更は即時反映されます。表示が古い場合は Browser Source のキャッシュを更新してください。

### ライセンス

個人・商用の配信や演奏で無料利用できます。個人利用の非公開改造は可能ですが、原版または改造版の再配布には書面による許可が必要です。詳細は [LICENSE](LICENSE) を参照してください。

---

## 한국어

### 릴리스 상태

**최신 안정 버전: `v0.9.7`**

`v0.9.7`은 앞으로 2주 동안 사용할 안정화 검증 버전입니다. 이 기간에는 일반 기능 추가나 정기 업데이트를 진행하지 않으며, 필요한 중대한 문제만 수정합니다. 2주간 실제 방송 검증을 마친 뒤 **`v1.0.0` 정식 안정 버전**을 출시할 예정입니다.

### 개요

Elitesand Pro는 VTuber, 노래 방송 스트리머, 라이브 공연자를 위한 Windows 데스크톱 도구입니다. YouTube 및 로컬 음원 가져오기, 가사 검색, 동기화 재생, OBS 동적 가사, 라이브 세트리스트, Twitch 신청곡 기능을 하나의 로컬 앱에 통합합니다.

### 주요 기능

- YouTube 단일 영상 및 재생목록의 음원, 메타데이터, 커버, 가사 자동 가져오기.
- MP3, FLAC, WAV, M4A, OGG 로컬 음원 지원.
- 가져오기 대기열, 취소, 재시도, 중복 및 길이 검사, 미디어 라이브러리.
- 곡별 키, 속도, 가사 오프셋, 재생 설정 저장.
- BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase 등 다중 가사 소스.
- 단어 동기화, 문장 동기화, LRC, KRC, TTML, SRT, 일반 텍스트 지원.
- 타임라인 편집, 첫 줄 정렬, 로마자, 병음, 간체→번체 표시 변환.
- 7가지 가사 애니메이션과 템플릿별 독립 설정 및 프리셋.
- OBS 투명 가사 및 세트리스트 Browser Source 실시간 동기화.
- KTV 하이라이트, 간주 카운트다운, 시계 동기화, 긴급 숨김.
- 방송 세트리스트, 부른 곡 기록, 현재 곡/다음 곡, YouTube 챕터 출력.
- Twitch Device Code 로그인, 채팅 신청곡, 승인, 재시도, 만료, 상태 복구.
- 채널 포인트 신청곡, 완료·거절·시간 초과·자동 환불.
- 공정 신청 세션, 중복 제한, 시청자 한도, 직접 취소, 관리자 제어.
- 휴대폰 리모컨, Stream Deck HTTP API, PIN 보호, 로그, 백업, 복구.
- 지원 언어: 번체 중국어, 영어, 일본어, 한국어, 간체 중국어.

### 설치

GitHub Releases에서 최신 Windows Installer 또는 Portable 버전을 다운로드하세요.

- **Installer**: 설치 마법사를 실행합니다.
- **Portable**: 압축을 풀고 바로 실행합니다. Node.js, yt-dlp, FFmpeg가 포함되어 있습니다.

현재 배포 파일은 코드 서명이 없으므로 Windows SmartScreen 경고가 표시될 수 있습니다. 다운로드 출처와 SHA-256 체크섬을 확인하세요.

### OBS 설정

Elitesand Pro에서 가사 URL 또는 세트리스트 URL을 복사해 OBS Browser Source에 붙여 넣습니다. 설정은 즉시 동기화되며, 오래된 화면이 보이면 Browser Source 캐시를 새로 고치세요.

### 라이선스

개인 및 상업 방송·공연에서 무료로 사용할 수 있습니다. 비공개 개인 수정은 허용되지만 원본 또는 수정본을 재배포하려면 서면 허가가 필요합니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.

---

## 简体中文

### 版本状态

**最新稳定版：`v0.9.7`**

`v0.9.7` 将作为未来两周的稳定验证版本。期间原则上不再新增功能或发布常规更新，只处理必要的重大问题。完成两周实际直播与使用场景验证后，计划发布 **`v1.0.0` 正式稳定版**。

### 产品定位

Elitesand Pro 是面向 VTuber、歌回主播与直播演出者的 Windows 桌面工具。它将 YouTube／本地音频导入、歌词搜索、同步播放、OBS 动态歌词、直播歌单与 Twitch 点歌流程整合在同一个本地应用中。

### 主要功能

- YouTube 单曲与播放列表的音频、歌曲信息、封面和歌词自动导入。
- 支持 MP3、FLAC、WAV、M4A、OGG 本地音频。
- 导入队列、取消、重试、重复检查、时长检查与媒体库。
- 每首歌曲独立保存升降调、速度、歌词偏移与播放设置。
- BetterLyrics、Apple Music、酷狗、QQ Music、LRCLIB、网易云等多歌词来源。
- 支持逐字、逐句、LRC、KRC、TTML、SRT 与纯文本歌词。
- 时间轴编辑、首句对齐、罗马音、拼音与简繁显示转换。
- 七种歌词动画模板，各模板独立保存样式与预设。
- OBS 透明歌词与直播歌单 Browser Source 实时同步。
- KTV 扫光、间奏倒计时、时钟同步与紧急隐藏。
- 直播歌单、已唱／正在唱／下一首、YouTube 章节时间戳。
- Twitch Device Code 登录、聊天室点歌、确认、重试、超时与状态恢复。
- 忠诚点数点歌、完成、拒绝、超时与自动退款。
- 公平点歌场次、重复限制、观众名额、自助取消与管理员控制。
- 手机遥控器、Stream Deck HTTP API、PIN 保护、日志、备份与恢复。
- 支持语言：繁体中文、English、日本語、한국어、简体中文。

### 安装

请从 GitHub Releases 下载最新 Windows Installer 或 Portable 版本。

- **Installer**：运行安装向导。
- **Portable**：解压后直接运行，已包含 Node.js、yt-dlp 与 FFmpeg。

当前安装包尚未进行商业代码签名，Windows SmartScreen 可能显示警告。请确认下载来源与 SHA-256 校验值。

### OBS 设置

从 Elitesand Pro 复制歌词网址或歌单网址，粘贴到 OBS Browser Source。设置会即时同步；若显示旧内容，请刷新 Browser Source 缓存。

### 授权

可免费用于个人与商业直播／演出，并允许不对外分发的私人修改；未经书面许可，不得重新分发原版或修改版。详细内容请参阅 [LICENSE](LICENSE) 与 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
