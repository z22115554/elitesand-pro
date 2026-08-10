# Elitesand Pro

**Languages / 語言 / 言語 / 언어 / 语言**  
[繁體中文](#繁體中文) · [English](#english) · [日本語](#日本語) · [한국어](#한국어) · [简体中文](#简体中文)

---

## 繁體中文

### 版本狀態

**最新穩定版：`v0.9.9.1`**

`v0.9.9.1` 將作為接下來兩週的穩定驗證版本，期間原則上不再新增功能或發布一般更新，只處理必要的重大問題。完成兩週實際直播與使用情境驗證後，預計發布 **`v1.0.0` 正式穩定版**。

**發行形式調整：** `v0.9.9` 仍提供 Windows Installer 與 Portable；自 **`v0.9.9.1` 起只提供 Windows Installer，不再發布 Portable 可攜版**。

**本次升級建議（非強制）：** 建議 Portable 使用者在 `v0.9.9` 就改用 Installer，先確認安裝版資料正常，再停用舊可攜版。遷移前請完整關閉程式並備份 `data/` 與 `downloads/`；若已使用媒體庫搬遷功能，則備份設定中顯示的 `Elitesand Pro Media` 資料夾取代 `downloads/`。`data/` 包含播放清單、設定、歌詞快取、授權、Twitch 與 PIN 狀態；媒體資料夾包含歌曲、封面與歌詞檔。`logs/` 不影響遷移，可不備份。

> [!WARNING]
> `v0.7.1`～`v0.7.3` 的舊更新器無法安全完成跨版本升級。另因 `v0.9.2` 導入 Electron 桌面框架與安裝／封裝架構等框架級更新，**從任何早於 `v0.9.2` 的版本升級時，都必須重新下載並安裝完整 Installer 或 Portable 版本，不能使用增量更新**。請先保留舊資料夾與使用者資料備份；完成 `v0.9.2` 或之後版本的完整安裝後，未來相容版本才可依程式提示使用安全增量更新。

### 產品定位

Elitesand Pro 是為 VTuber、歌回實況主與直播演出者設計的 Windows 桌面工具。它將歌曲管理、歌詞搜尋、同步播放、OBS 動態歌詞、直播歌單與 Twitch 點歌流程整合在同一套本機應用程式中。

程式在本機執行，OBS 透過 Browser Source 載入透明歌詞與歌單畫面；桌面控制台、手機遙控器與 OBS 顯示來源會即時同步。

### 使用說明

1. 從 GitHub Releases 下載最新 Windows Installer。`v0.9.9.1` 仍可下載 Portable；自 `v0.9.9.1` 起不再提供可攜版。
2. 啟動 Elitesand Pro，依首次使用引導完成 yt-dlp、FFmpeg、網路與版本檢查。
3. 匯入 YouTube 連結、播放清單或本機音檔，確認歌名、歌手與歌詞來源。
4. 在歌詞設定中選擇動畫模板、字體、顏色、位置與預設。
5. 複製「歌詞網址」與「歌單網址」，分別加入 OBS Browser Source。
6. 需要觀眾點歌時，連接 Twitch，設定聊天室指令或忠誠點數獎勵與限制。
7. 直播中可使用桌面控制台、手機遙控器或 Stream Deck 控制播放、切歌、時間偏移與緊急隱藏。
8. 收播後可保存場次、匯出歌單，並複製 YouTube 章節時間戳。

> 初次使用建議先用測試場景完成一首歌曲的匯入、歌詞同步、OBS 顯示與 Twitch 點歌流程，再投入正式直播。

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

內建六種歌詞演出模板：

- 經典疊層
- Pulse
- Facet
- Aura
- KTV
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

請從 GitHub Releases 下載最新的 Windows Installer。`v0.9.9` 仍可下載 Portable；自 `v0.9.9.1` 起不再提供可攜版。

- **Installer**：執行安裝程式並依精靈完成安裝。
- **Portable**：解壓縮後直接執行啟動檔，不需另外安裝 Node.js、yt-dlp 或 FFmpeg。

安裝包目前未進行商業程式碼簽章，Windows SmartScreen 可能顯示警告。請確認下載來源與 SHA-256 校驗值後再執行。

PowerShell 驗證範例：

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.9.exe" -Algorithm SHA256
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

若依賴或封裝結構不相容，程式會要求下載完整安裝包；`v0.9.x` 舊版仍可能提供 Portable，但 `v0.9.9.1` 起不再提供。

### 授權

Elitesand Pro 採用 [Elitesand Pro 授權條款](LICENSE)：可免費用於個人與商業直播／演出，允許私人且不對外散布的自用修改；未經書面同意不得重新散布原版或修改版。

第三方元件依其原授權使用，詳見 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。歌曲、歌詞、封面及其他媒體權利不包含在本專案授權內。

---

## English

### Release status

**Latest stable release: `v0.9.9.1`**

`v0.9.9.1` will serve as the stabilization build for the next two weeks. During this period, no normal feature additions or routine releases are planned; only necessary critical issues will be addressed. After two weeks of validation in real streaming and usage scenarios, **`v1.0.0` stable** is planned for release.

**Distribution format change:** `v0.9.9` still provides both the Windows Installer and Portable build. Starting with **`v0.9.9.1`, only the Windows Installer is provided and the Portable build is no longer released**.

**Upgrade recommendation for this release (not mandatory):** Portable users are encouraged to switch to the Installer with `v0.9.9`, verify that their data loads correctly in the installed version, and only then stop using the old Portable copy. Before migration, fully exit the application and back up `data/` and `downloads/`. If the media library relocation feature has already been used, back up the `Elitesand Pro Media` folder shown in Settings instead of `downloads/`. `data/` contains playlists, settings, lyrics cache, authorization data, Twitch state, and PIN state; the media folder contains songs, cover images, and lyrics files. `logs/` is not required for migration and does not need to be backed up.

> [!WARNING]
> The old updater used by `v0.7.1`–`v0.7.3` cannot safely complete cross-version upgrades. In addition, `v0.9.2` introduced framework-level changes including the Electron desktop framework and a new installation/packaging architecture. **When upgrading from any version earlier than `v0.9.2`, you must download and install a complete Installer or Portable build again; incremental updates cannot be used.** Keep the old folder and a backup of user data first. After completing a full installation of `v0.9.2` or later, future compatible versions may use safe incremental updates when prompted by the application.

### Product overview

Elitesand Pro is a Windows desktop tool designed for VTubers, karaoke/ singing streamers, and live performers. It combines song management, lyrics search, synchronized playback, animated OBS lyrics, live setlists, and Twitch song-request workflows in one local application.

The application runs locally. OBS loads transparent lyrics and setlist views through Browser Sources, while the desktop control panel, phone remote, and OBS display sources remain synchronized in real time.

### Usage

1. Download the latest Windows Installer from GitHub Releases. `v0.9.9.1` can still be downloaded as Portable; starting with `v0.9.9.1`, Portable builds are no longer provided.
2. Launch Elitesand Pro and follow the first-run guide to complete yt-dlp, FFmpeg, network, and version checks.
3. Import a YouTube link, playlist, or local audio file, then verify the song title, artist, and lyrics source.
4. Choose an animation template, font, colors, position, and preset in Lyrics Settings.
5. Copy the Lyrics URL and Setlist URL and add each one to OBS as a Browser Source.
6. When viewer song requests are needed, connect Twitch and configure chat commands or Channel Points rewards and limits.
7. During a stream, use the desktop control panel, phone remote, or Stream Deck to control playback, switch songs, adjust timing offsets, and trigger emergency hide.
8. After the stream, save the session, export the setlist, and copy YouTube chapter timestamps.

> For first-time use, it is recommended to run one complete test song through import, lyrics synchronization, OBS display, and Twitch request handling in a test scene before using it in a production stream.

### Main features

#### Song import and playback

- Paste a YouTube video or playlist link to automatically download audio, identify the artist/title, search for lyrics, and retrieve cover art.
- Drag and drop local audio files including MP3, FLAC, WAV, M4A, and OGG.
- Check video duration, content type, and duplicates before import to reduce accidental downloads of non-music content.
- Single import queue, playlist batch jobs, cancellation, retry, and job-status management.
- Play, pause, previous, next, seek by dragging, and mini-player controls.
- Save per-song transpose of ±12 semitones, playback speed from 0.5x to 1.5x, and timing offset independently.
- Built-in SoundTouch/WSOLA processing for high-quality pitch and tempo changes.
- Drag-and-drop playlist reordering, song metadata editing, playlist import/export, and clear confirmation.
- The media library automatically stores used songs, play counts, lyrics, timing corrections, and playback settings.

#### Lyrics search and processing

- Parallel multi-source search: BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase, and others.
- Automatically selects the best lyrics match while still allowing manual source selection.
- Supports word-synced, line-synced, LRC, KRC, TTML, SRT, and plain-text lyrics.
- Lyrics can be pasted directly, or each line can be corrected with the line-by-line timeline editor.
- One-click “Align First Line” shifts the entire lyrics timeline.
- Japanese/Korean romanization, Chinese pinyin, and partial Chinese phonetic-homophone display.
- Simplified-to-Traditional Chinese display conversion without damaging pinyin or original timing data.
- Cleans unnecessary production credits, studio names, version notes, and incorrect titles from source lyrics.
- Lyrics source caching, health status, retry handling, and source fallback/degradation handling.

#### Animated OBS lyrics

Six built-in lyric-performance templates:

- Classic Overlay
- Pulse
- Facet
- Aura
- KTV
- Vertical Flow

Each template can independently save:

- Font, font size, colors, outline, and opacity
- Position, spacing, alignment, and display range
- Animation intensity and transition effects
- Named presets

Additional capabilities:

- Transparent-background OBS Browser Source.
- Word-by-word sweep highlighting, line transitions, interlude countdowns, and KTV clock synchronization.
- Emergency hide only hides Elitesand Pro elements and does not cover the entire stream canvas.
- Real-time connection status for OBS lyrics and setlist sources.
- Setting changes synchronize immediately without needing to paste the OBS URL again.

#### Live setlist

- Shows songs already sung, the current song, and upcoming songs.
- Automatically records session songs and timestamps that can be copied as YouTube chapters.
- Supports both corner-list layouts and full-screen scene layouts.
- Multiple themes and more than 40 appearance settings.
- Automatically adapts layout to the OBS Browser Source size.
- Long song titles and artist names automatically receive space so important information is not squeezed out.
- Create, save, and switch between different live sessions.

#### Twitch integration

- Twitch Device Code Flow login with no Client Secret required.
- Automatically creates a live setlist session based on the actual Twitch stream start time.
- Chat song-request commands and YouTube link parsing.
- Requests first enter a pending approval area and are only downloaded after streamer approval, preventing unapproved requests from polluting the main playlist.
- Failed imports can be retried; expired or rejected requests can be cancelled.
- Channel Points song requests with required text input, successful completion, and refunds on failure.
- Request limits, song-duration limits, duplicate-song rules, per-user quotas, and fair-request sessions.
- Viewers can check and cancel their own requests; moderators can manage requests through chat.
- Custom success, failure, waiting, and rejection replies.
- Twitch reconnection, request persistence, and recovery after application restart.
- Unknown EventSub events or chat fragments are safely ignored without interrupting the overall workflow.

#### Controls and safety

- Phone remote: playback, song switching, seek position, transpose, lyrics source, template, and preset controls.
- Stream Deck HTTP API: `/api/deck/:action`.
- Optional PIN protection prevents accidental control by devices on the same local network; OBS display sources remain unaffected.
- Read-only/write control permissions and request-size limits.
- State versioning, corruption backups, automatic recovery, data migration, and rollback.
- Multiple-instance and connection-conflict protection.
- Detailed logs, error messages, and yt-dlp/FFmpeg health checks.

#### Multilingual interface

The application currently supports:

- Traditional Chinese
- English
- Japanese
- Korean
- Simplified Chinese

Major desktop operations, Twitch status, error messages, authorization flows, and dynamic number formatting are localized. Missing strings fall back to Traditional Chinese.

### Installation

#### General users

Download the latest Windows Installer from GitHub Releases. `v0.9.9` remains available as a Portable build; starting with `v0.9.9.1`, Portable builds are no longer provided.

- **Installer**: run the setup program and complete the installation wizard.
- **Portable**: extract the archive and launch it directly; Node.js, yt-dlp, and FFmpeg do not need to be installed separately.

The installer is currently not commercially code-signed, so Windows SmartScreen may display a warning. Verify the download source and SHA-256 checksum before running it.

PowerShell verification example:

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.9.exe" -Algorithm SHA256
```

### OBS setup

1. Copy the Lyrics URL or Setlist URL in Elitesand Pro.
2. Add a Browser Source in OBS.
3. Paste the URL and set the dimensions; for lyrics, the stream canvas size such as 1920×1080 is generally recommended.
4. Changes synchronize immediately. If OBS still shows old content, right-click the source and refresh its cache.

Common URLs:

| URL | Purpose |
|---|---|
| `/` | Desktop control panel |
| `/controller` | Phone remote |
| `/display` | Animated OBS lyrics |
| `/setlist` | OBS live setlist |

### Secure updates

Safe incremental updates only accept files with these exact names from GitHub Releases:

- `update.zip`
- `update.zip.sha256`

The updater validates SHA-256, ZIP paths and sizes, the file allowlist, manifest, dependencies, and lockfile structure. `data/`, `downloads/`, `logs/`, settings, authorization data, Twitch tokens, PIN state, and user media are not overwritten by incremental updates.

If the dependency or packaging structure is incompatible, the application will require a full installer download. Older `v0.9.x` releases may still provide Portable builds, but they are no longer provided starting with `v0.9.9.1`.

### License

Elitesand Pro uses the [Elitesand Pro License](LICENSE): it is free for personal and commercial streaming/performance, and private modifications that are not redistributed are allowed. Redistribution of the original or modified application requires written permission.

Third-party components are used under their respective licenses; see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Rights to songs, lyrics, cover art, and other media are not included in this project's license.

---

## 日本語

### リリース状況

**最新安定版：`v0.9.9.1`**

`v0.9.9.1` は今後2週間の安定性検証版として運用します。この期間は原則として新機能の追加や通常アップデートを行わず、必要な重大問題のみ対応します。2週間の実配信および実利用環境での検証完了後、**`v1.0.0` 正式安定版**を公開する予定です。

**配布形式の変更：** `v0.9.9` では Windows Installer と Portable を提供しますが、**`v0.9.9.1` 以降は Windows Installer のみを提供し、Portable 版は配布しません**。

**今回のアップグレードに関する推奨事項（必須ではありません）：** Portable ユーザーは `v0.9.9` の段階で Installer 版へ移行し、インストール版でデータが正常に読み込まれることを確認してから旧 Portable 版の使用を終了することを推奨します。移行前にアプリを完全に終了し、`data/` と `downloads/` をバックアップしてください。メディアライブラリの移動機能をすでに使用している場合は、`downloads/` の代わりに設定画面に表示される `Elitesand Pro Media` フォルダーをバックアップしてください。`data/` にはプレイリスト、設定、歌詞キャッシュ、認証情報、Twitch 状態、PIN 状態が含まれ、メディアフォルダーには楽曲、カバー画像、歌詞ファイルが含まれます。`logs/` は移行に影響しないため、バックアップは不要です。

> [!WARNING]
> `v0.7.1`～`v0.7.3` の旧アップデーターでは、バージョンをまたぐアップグレードを安全に完了できません。また `v0.9.2` では Electron デスクトップフレームワークやインストール／パッケージ構成を含むフレームワークレベルの変更が導入されました。**`v0.9.2` より前のバージョンからアップグレードする場合は、完全版 Installer または Portable を再ダウンロードして再インストールする必要があり、差分更新は使用できません。** 先に旧フォルダーとユーザーデータのバックアップを保管してください。`v0.9.2` 以降を完全インストールした後は、互換性のある将来バージョンでアプリの案内に従って安全な差分更新を利用できます。

### 製品概要

Elitesand Pro は、VTuber、歌配信者、ライブパフォーマー向けに設計された Windows デスクトップツールです。楽曲管理、歌詞検索、同期再生、OBS の動的歌詞、ライブセットリスト、Twitch のリクエスト機能を1つのローカルアプリに統合します。

アプリはローカル環境で動作し、OBS は Browser Source を通して透明背景の歌詞・セットリスト画面を読み込みます。デスクトップ操作画面、スマートフォンリモコン、OBS 表示ソースはリアルタイムで同期します。

### 使い方

1. GitHub Releases から最新の Windows Installer をダウンロードします。`v0.9.9.1` では Portable もダウンロードできますが、`v0.9.9.1` 以降は Portable 版を提供しません。
2. Elitesand Pro を起動し、初回利用ガイドに従って yt-dlp、FFmpeg、ネットワーク、バージョン確認を完了します。
3. YouTube リンク、プレイリスト、またはローカル音源を取り込み、曲名、アーティスト、歌詞ソースを確認します。
4. 歌詞設定でアニメーションテンプレート、フォント、色、位置、プリセットを選択します。
5. 「歌詞 URL」と「セットリスト URL」をコピーし、それぞれ OBS Browser Source に追加します。
6. 視聴者からのリクエストを受け付ける場合は Twitch を接続し、チャットコマンドまたはチャンネルポイント報酬と制限を設定します。
7. 配信中はデスクトップ操作画面、スマートフォンリモコン、Stream Deck から再生、曲切り替え、タイミングオフセット、緊急非表示を操作できます。
8. 配信終了後はセッションを保存し、セットリストをエクスポートして YouTube チャプターのタイムスタンプをコピーできます。

> 初めて使用する場合は、本番配信の前にテストシーンで1曲分の取り込み、歌詞同期、OBS 表示、Twitch リクエスト処理を一通り確認することを推奨します。

### 主な機能

#### 楽曲の取り込みと再生

- YouTube の単曲またはプレイリスト URL を貼り付けると、音声のダウンロード、アーティスト／曲名の認識、歌詞検索、カバー取得を自動実行します。
- MP3、FLAC、WAV、M4A、OGG などのローカル音源をドラッグ＆ドロップで取り込めます。
- 取り込み前に動画時間、種類、重複項目を確認し、音楽以外のコンテンツを誤ってダウンロードするリスクを減らします。
- 単一取り込みキュー、プレイリストの一括処理、キャンセル、再試行、ジョブ状態管理。
- 再生、一時停止、前の曲、次の曲、シークバーのドラッグ、ミニプレイヤー。
- 曲ごとに ±12 半音のキー変更、0.5x～1.5x の速度変更、タイミングオフセットを個別保存できます。
- SoundTouch／WSOLA による高品質なキー・速度変更処理を内蔵。
- プレイリストのドラッグ並び替え、曲情報編集、リストのインポート／エクスポート、全消去確認。
- メディアライブラリは使用済み楽曲、再生回数、歌詞、タイミング補正、再生設定を自動保存します。

#### 歌詞検索と処理

- 複数ソースを並列検索：BetterLyrics、Apple Music、Kugou、QQ Music、LRCLIB、NetEase など。
- 最適な歌詞を自動照合し、必要に応じて手動でソースを選択できます。
- 単語同期、行同期、LRC、KRC、TTML、SRT、プレーンテキスト歌詞に対応。
- 歌詞を直接貼り付けるか、行ごとのタイムラインエディターで各行の時刻を修正できます。
- 「先頭行を合わせる」機能で歌詞全体のタイミングを一括移動できます。
- 日本語／韓国語のローマ字、中国語ピンイン、一部中国語の同音・読み補助表示。
- ピンインや元のタイミング情報を壊さずに簡体字を繁体字表示へ変換します。
- ソースに含まれる不要な制作情報、スタジオ名、バージョン表記、誤ったタイトルを除去します。
- 歌詞ソースのキャッシュ、ヘルス状態、失敗時の再試行、ソースのフォールバック処理。

#### OBS 動的歌詞

6種類の歌詞演出テンプレートを内蔵：

- Classic Overlay
- Pulse
- Facet
- Aura
- KTV
- Vertical Flow

各テンプレートで個別に保存可能：

- フォント、文字サイズ、色、縁取り、透明度
- 位置、間隔、配置、表示範囲
- アニメーション強度、切り替え効果
- 名前付きプリセット

その他の機能：

- OBS 用の透明背景 Browser Source。
- 単語ごとのハイライト、行単位の切り替え、間奏カウントダウン、KTV 時計同期。
- 緊急非表示は Elitesand Pro の要素だけを隠し、配信画面全体を覆いません。
- OBS の歌詞・セットリストソースの接続状態をリアルタイム表示。
- 設定変更は即時同期され、OBS URL を貼り直す必要はありません。

#### ライブセットリスト

- 歌唱済み、現在歌唱中、次に歌う曲を表示します。
- セッションの曲とタイムスタンプを自動記録し、YouTube チャプターとしてコピーできます。
- 画面隅のリスト表示とフルスクリーンシーン用レイアウトに対応。
- 複数テーマと40項目以上の外観設定。
- OBS Browser Source のサイズに応じてレイアウトを自動調整します。
- 長い曲名やアーティスト名でも重要情報が押しつぶされないよう自動で表示領域を配分します。
- 複数の配信セッションを作成、保存、切り替えできます。

#### Twitch 連携

- Client Secret が不要な Twitch Device Code Flow ログイン。
- Twitch の実際の配信開始時刻に基づいてライブセットリストセッションを自動作成します。
- チャットのリクエストコマンドと YouTube リンク解析。
- リクエストはまず承認待ち領域に入り、配信者が承認した後にのみダウンロードされるため、未承認曲が正式プレイリストを汚しません。
- 取り込み失敗は再試行でき、期限切れや拒否されたリクエストはキャンセルできます。
- チャンネルポイントによる曲リクエスト、必要なテキスト入力、正常完了、失敗時返金。
- リクエスト制限、曲の長さ、重複曲、ユーザーごとの上限、公平な受付セッション。
- 視聴者は自分のリクエストを確認・キャンセルでき、モデレーターはチャットから管理できます。
- 成功、失敗、待機、拒否の返信文をカスタマイズできます。
- Twitch の再接続、リクエスト永続化、アプリ再起動後の復元。
- 未知の EventSub やチャット fragment は安全に無視され、全体の処理を中断しません。

#### 操作と安全性

- スマートフォンリモコン：再生、曲切り替え、進行位置、キー変更、歌詞ソース、テンプレート、プリセット操作。
- Stream Deck HTTP API：`/api/deck/:action`。
- 任意の PIN 保護により同一 LAN 上の端末からの誤操作を防止し、OBS 表示ソースには影響しません。
- 読み取り専用／書き込み可能な操作権限とリクエストサイズ制限。
- 状態バージョン、破損バックアップ、自動復旧、データ移行、ロールバック。
- 複数起動と接続競合の保護。
- 詳細ログ、エラー表示、yt-dlp／FFmpeg のヘルスチェック。

#### 多言語インターフェース

現在の対応言語：

- 繁体字中国語
- English
- 日本語
- 한국어
- 简体中文

主要なデスクトップ操作、Twitch 状態、エラーメッセージ、認証フロー、動的な数値書式はローカライズ済みです。未翻訳の文字列は繁体字中国語へフォールバックします。

### インストール方法

#### 一般ユーザー

GitHub Releases から最新の Windows Installer をダウンロードしてください。`v0.9.9` では Portable も利用できますが、`v0.9.9.1` 以降は Portable 版を提供しません。

- **Installer**：セットアッププログラムを実行し、ウィザードに従ってインストールします。
- **Portable**：展開して直接起動できます。Node.js、yt-dlp、FFmpeg を別途インストールする必要はありません。

インストーラーは現在、商用コード署名を行っていないため、Windows SmartScreen の警告が表示される場合があります。実行前にダウンロード元と SHA-256 チェックサムを確認してください。

PowerShell での確認例：

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.9.exe" -Algorithm SHA256
```

### OBS 設定

1. Elitesand Pro で「歌詞 URL」または「セットリスト URL」をコピーします。
2. OBS に「ブラウザ」ソースを追加します。
3. URL を貼り付けてサイズを設定します。歌詞は通常、1920×1080 など配信キャンバスと同じサイズを推奨します。
4. 設定変更は即時同期されます。OBS に古い内容が残る場合は、ソースを右クリックしてキャッシュを更新してください。

よく使う URL：

| URL | 用途 |
|---|---|
| `/` | デスクトップ操作画面 |
| `/controller` | スマートフォンリモコン |
| `/display` | OBS 動的歌詞 |
| `/setlist` | OBS ライブセットリスト |

### 安全なアップデート

安全な差分更新では、GitHub Release 内の次の完全一致ファイル名のみを受け付けます：

- `update.zip`
- `update.zip.sha256`

アップデーターは SHA-256、ZIP 内のパスとサイズ、ファイル許可リスト、manifest、依存関係、lockfile 構造を検証します。`data/`、`downloads/`、`logs/`、設定、認証データ、Twitch token、PIN、ユーザーメディアは差分更新で上書きされません。

依存関係やパッケージ構成に互換性がない場合、アプリは完全版インストーラーのダウンロードを要求します。旧 `v0.9.x` では Portable が提供される場合がありますが、`v0.9.9.1` 以降は提供されません。

### ライセンス

Elitesand Pro は [Elitesand Pro ライセンス](LICENSE) を採用しています。個人・商用の配信／演出で無料利用でき、外部へ配布しない私的な改造も許可されています。原版または改造版を再配布するには書面による許可が必要です。

第三者コンポーネントはそれぞれの原ライセンスに従って使用しています。詳細は [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) を参照してください。楽曲、歌詞、カバー画像、その他メディアの権利は本プロジェクトのライセンスには含まれません。

---

## 한국어

### 릴리스 상태

**최신 안정 버전: `v0.9.9.1`**

`v0.9.9.1`은 앞으로 2주 동안 안정성 검증 버전으로 운영됩니다. 이 기간에는 원칙적으로 새로운 기능 추가나 일반 업데이트를 진행하지 않으며, 필요한 중대한 문제만 처리합니다. 2주 동안 실제 방송 및 사용 환경 검증을 완료한 뒤 **`v1.0.0` 정식 안정 버전**을 출시할 예정입니다.

**배포 형식 변경:** `v0.9.9`은 Windows Installer와 Portable을 모두 제공하지만, **`v0.9.9.1`부터는 Windows Installer만 제공하며 Portable 버전은 더 이상 배포하지 않습니다**.

**이번 업그레이드 권장 사항(필수 아님):** Portable 사용자는 `v0.9.9` 단계에서 Installer 버전으로 전환하고, 설치 버전에서 데이터가 정상적으로 불러와지는지 확인한 뒤 기존 Portable 사용을 중단하는 것을 권장합니다. 이전 전에 프로그램을 완전히 종료하고 `data/`와 `downloads/`를 백업하세요. 미디어 라이브러리 이동 기능을 이미 사용했다면 `downloads/` 대신 설정에 표시되는 `Elitesand Pro Media` 폴더를 백업하세요. `data/`에는 재생목록, 설정, 가사 캐시, 인증 정보, Twitch 상태, PIN 상태가 포함되며, 미디어 폴더에는 노래, 커버 이미지, 가사 파일이 포함됩니다. `logs/`는 이전에 영향을 주지 않으므로 백업하지 않아도 됩니다.

> [!WARNING]
> `v0.7.1`~`v0.7.3`의 기존 업데이터는 버전을 건너뛰는 업그레이드를 안전하게 완료할 수 없습니다. 또한 `v0.9.2`에서는 Electron 데스크톱 프레임워크와 설치/패키징 구조를 포함한 프레임워크 수준의 변경이 도입되었습니다. **`v0.9.2`보다 이전 버전에서 업그레이드할 경우 전체 Installer 또는 Portable 버전을 다시 다운로드해 설치해야 하며 증분 업데이트를 사용할 수 없습니다.** 먼저 기존 폴더와 사용자 데이터 백업을 보관하세요. `v0.9.2` 이상을 전체 설치한 뒤에는 호환되는 향후 버전에서 프로그램 안내에 따라 안전한 증분 업데이트를 사용할 수 있습니다.

### 제품 개요

Elitesand Pro는 VTuber, 노래 방송 스트리머, 라이브 공연자를 위해 설계된 Windows 데스크톱 도구입니다. 곡 관리, 가사 검색, 동기화 재생, OBS 동적 가사, 라이브 세트리스트, Twitch 신청곡 흐름을 하나의 로컬 애플리케이션에 통합합니다.

프로그램은 로컬에서 실행되며 OBS는 Browser Source를 통해 투명 배경의 가사와 세트리스트 화면을 불러옵니다. 데스크톱 제어판, 휴대폰 리모컨, OBS 표시 소스는 실시간으로 동기화됩니다.

### 사용 방법

1. GitHub Releases에서 최신 Windows Installer를 다운로드합니다. `v0.9.9.1`에서는 Portable도 다운로드할 수 있지만, `v0.9.9.1`부터 Portable 버전은 더 이상 제공하지 않습니다.
2. Elitesand Pro를 실행하고 최초 사용 안내에 따라 yt-dlp, FFmpeg, 네트워크, 버전 확인을 완료합니다.
3. YouTube 링크, 재생목록 또는 로컬 오디오 파일을 가져온 뒤 곡명, 아티스트, 가사 소스를 확인합니다.
4. 가사 설정에서 애니메이션 템플릿, 글꼴, 색상, 위치, 프리셋을 선택합니다.
5. “가사 URL”과 “세트리스트 URL”을 복사해 각각 OBS Browser Source에 추가합니다.
6. 시청자 신청곡이 필요하면 Twitch를 연결하고 채팅 명령어 또는 채널 포인트 보상 및 제한을 설정합니다.
7. 방송 중에는 데스크톱 제어판, 휴대폰 리모컨, Stream Deck으로 재생, 곡 전환, 시간 오프셋, 긴급 숨기기를 제어할 수 있습니다.
8. 방송 종료 후 세션을 저장하고 세트리스트를 내보낸 뒤 YouTube 챕터 타임스탬프를 복사할 수 있습니다.

> 처음 사용할 때는 실제 방송에 투입하기 전에 테스트 장면에서 한 곡의 가져오기, 가사 동기화, OBS 표시, Twitch 신청곡 흐름을 끝까지 테스트하는 것을 권장합니다.

### 주요 기능

#### 곡 가져오기 및 재생

- YouTube 단일 영상 또는 재생목록 링크를 붙여 넣으면 오디오 다운로드, 아티스트/곡명 인식, 가사 검색, 커버 이미지 가져오기를 자동으로 수행합니다.
- MP3, FLAC, WAV, M4A, OGG 등의 로컬 오디오 파일을 드래그 앤 드롭으로 가져올 수 있습니다.
- 가져오기 전에 영상 길이, 유형, 중복 항목을 확인해 음악이 아닌 콘텐츠를 실수로 다운로드할 위험을 줄입니다.
- 단일 가져오기 큐, 재생목록 일괄 작업, 취소, 재시도, 작업 상태 관리.
- 재생, 일시정지, 이전 곡, 다음 곡, 진행 위치 드래그, 미니 플레이어.
- 곡마다 ±12 반음 키 변경, 0.5x~1.5x 속도 변경, 시간 오프셋을 개별 저장할 수 있습니다.
- SoundTouch/WSOLA 기반 고품질 키 및 속도 변경 처리를 내장합니다.
- 재생목록 드래그 정렬, 곡 정보 편집, 목록 가져오기/내보내기, 전체 삭제 확인.
- 미디어 라이브러리가 사용한 곡, 재생 횟수, 가사, 시간 보정, 재생 설정을 자동 저장합니다.

#### 가사 검색 및 처리

- 여러 소스를 병렬 검색: BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase 등.
- 최적의 가사를 자동 매칭하며 필요하면 소스를 직접 선택할 수 있습니다.
- 단어 동기화, 줄 동기화, LRC, KRC, TTML, SRT, 일반 텍스트 가사를 지원합니다.
- 가사를 직접 붙여 넣거나 줄별 타임라인 편집기로 각 줄의 시간을 수정할 수 있습니다.
- “첫 줄 맞추기” 기능으로 전체 가사 시간을 한 번에 이동할 수 있습니다.
- 일본어/한국어 로마자, 중국어 병음, 일부 중국어 발음/동음 보조 표시.
- 병음과 원본 시간 데이터를 손상하지 않고 간체자를 번체자로 표시 변환합니다.
- 소스에 포함된 불필요한 제작 정보, 스튜디오명, 버전 표기, 잘못된 제목을 정리합니다.
- 가사 소스 캐시, 상태 확인, 실패 재시도, 소스 폴백 처리.

#### OBS 동적 가사

6가지 가사 연출 템플릿을 내장합니다:

- Classic Overlay
- Pulse
- Facet
- Aura
- KTV
- Vertical Flow

각 템플릿별로 독립 저장 가능:

- 글꼴, 글자 크기, 색상, 외곽선, 투명도
- 위치, 간격, 정렬, 표시 범위
- 애니메이션 강도 및 전환 효과
- 이름이 지정된 프리셋

기타 기능:

- OBS용 투명 배경 Browser Source.
- 단어별 하이라이트, 줄 전환, 간주 카운트다운, KTV 시계 동기화.
- 긴급 숨기기는 Elitesand Pro 요소만 숨기며 방송 화면 전체를 가리지 않습니다.
- OBS 가사 및 세트리스트 소스의 연결 상태를 실시간으로 표시합니다.
- 설정 변경은 즉시 동기화되므로 OBS URL을 다시 붙여 넣을 필요가 없습니다.

#### 라이브 세트리스트

- 이미 부른 곡, 현재 곡, 다음 곡을 표시합니다.
- 세션 곡과 타임스탬프를 자동 기록하며 YouTube 챕터 형식으로 복사할 수 있습니다.
- 화면 모서리 목록과 전체 화면 장면 레이아웃을 지원합니다.
- 다양한 테마와 40개 이상의 외형 설정.
- OBS Browser Source 크기에 맞춰 레이아웃을 자동 조정합니다.
- 긴 곡명과 아티스트명도 중요 정보가 눌리지 않도록 공간을 자동 배분합니다.
- 서로 다른 라이브 세션을 생성, 저장, 전환할 수 있습니다.

#### Twitch 연동

- Client Secret이 필요 없는 Twitch Device Code Flow 로그인.
- Twitch의 실제 방송 시작 시간을 기준으로 라이브 세트리스트 세션을 자동 생성합니다.
- 채팅 신청곡 명령어와 YouTube 링크 분석.
- 신청곡은 먼저 승인 대기 영역에 들어가며 스트리머가 승인한 뒤에만 다운로드되어 승인되지 않은 곡이 정식 재생목록을 오염시키지 않습니다.
- 가져오기 실패는 재시도할 수 있고, 만료되거나 거절된 요청은 취소할 수 있습니다.
- 채널 포인트 신청곡, 필수 텍스트 입력, 성공 완료, 실패 시 환불.
- 신청 제한, 곡 길이, 중복 곡, 사용자별 할당량, 공정 요청 세션.
- 시청자는 자신의 요청을 조회하고 취소할 수 있으며 관리자는 채팅에서 관리할 수 있습니다.
- 성공, 실패, 대기, 거절 응답을 사용자 지정할 수 있습니다.
- Twitch 재연결, 요청 영속화, 프로그램 재시작 후 복구.
- 알 수 없는 EventSub 이벤트나 채팅 fragment는 전체 흐름을 중단하지 않고 안전하게 무시됩니다.

#### 제어 및 안전

- 휴대폰 리모컨: 재생, 곡 전환, 진행 위치, 키 변경, 가사 소스, 템플릿, 프리셋 제어.
- Stream Deck HTTP API: `/api/deck/:action`.
- 선택적 PIN 보호로 같은 로컬 네트워크의 장치가 실수로 조작하는 것을 방지하며 OBS 표시 소스에는 영향을 주지 않습니다.
- 읽기 전용/쓰기 가능 제어 권한 및 요청 크기 제한.
- 상태 버전 관리, 손상 백업, 자동 복구, 데이터 이전, 롤백.
- 다중 실행 및 연결 충돌 보호.
- 상세 로그, 오류 메시지, yt-dlp/FFmpeg 상태 확인.

#### 다국어 인터페이스

현재 지원 언어:

- 繁體中文
- English
- 日本語
- 한국어
- 简体中文

주요 데스크톱 작업, Twitch 상태, 오류 메시지, 인증 흐름, 동적 숫자 형식은 현지화되어 있습니다. 번역되지 않은 문자열은 번체 중국어로 대체됩니다.

### 설치 방법

#### 일반 사용자

GitHub Releases에서 최신 Windows Installer를 다운로드하세요. `v0.9.9`에서는 Portable을 계속 다운로드할 수 있지만, `v0.9.9.1`부터는 Portable 버전을 제공하지 않습니다.

- **Installer**: 설치 프로그램을 실행하고 마법사에 따라 설치를 완료합니다.
- **Portable**: 압축을 풀고 바로 실행할 수 있으며 Node.js, yt-dlp, FFmpeg를 별도로 설치할 필요가 없습니다.

현재 설치 패키지는 상용 코드 서명이 되어 있지 않아 Windows SmartScreen 경고가 표시될 수 있습니다. 실행 전에 다운로드 출처와 SHA-256 체크섬을 확인하세요.

PowerShell 확인 예시:

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.9.exe" -Algorithm SHA256
```

### OBS 설정

1. Elitesand Pro에서 “가사 URL” 또는 “세트리스트 URL”을 복사합니다.
2. OBS에 “브라우저” 소스를 추가합니다.
3. URL을 붙여 넣고 크기를 설정합니다. 가사는 일반적으로 1920×1080 같은 방송 캔버스 크기를 권장합니다.
4. 설정 변경은 즉시 동기화됩니다. OBS에 이전 내용이 계속 표시되면 소스를 우클릭해 캐시를 새로고침하세요.

자주 사용하는 URL:

| URL | 용도 |
|---|---|
| `/` | 데스크톱 제어판 |
| `/controller` | 휴대폰 리모컨 |
| `/display` | OBS 동적 가사 |
| `/setlist` | OBS 라이브 세트리스트 |

### 안전 업데이트

안전한 증분 업데이트는 GitHub Release에서 이름이 정확히 일치하는 다음 파일만 허용합니다:

- `update.zip`
- `update.zip.sha256`

업데이터는 SHA-256, ZIP 경로와 크기, 파일 허용 목록, manifest, 의존성, lockfile 구조를 검증합니다. `data/`, `downloads/`, `logs/`, 설정, 인증 데이터, Twitch token, PIN, 사용자 미디어는 증분 업데이트로 덮어쓰지 않습니다.

의존성이나 패키징 구조가 호환되지 않으면 프로그램이 전체 설치 패키지 다운로드를 요구합니다. 이전 `v0.9.x` 버전은 Portable을 제공할 수 있지만 `v0.9.9.1`부터는 제공하지 않습니다.

### 라이선스

Elitesand Pro는 [Elitesand Pro 라이선스](LICENSE)를 사용합니다. 개인 및 상업 방송/공연에서 무료로 사용할 수 있고 외부에 배포하지 않는 개인용 수정도 허용됩니다. 원본 또는 수정 버전을 재배포하려면 서면 허가가 필요합니다.

서드파티 구성 요소는 각 원래 라이선스에 따라 사용됩니다. 자세한 내용은 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)를 확인하세요. 곡, 가사, 커버 이미지 및 기타 미디어의 권리는 이 프로젝트의 라이선스에 포함되지 않습니다.

---

## 简体中文

### 版本状态

**最新稳定版：`v0.9.9.1`**

`v0.9.9.1` 将作为接下来两周的稳定验证版本，期间原则上不再新增功能或发布常规更新，只处理必要的重大问题。完成两周实际直播与使用场景验证后，预计发布 **`v1.0.0` 正式稳定版**。

**发行形式调整：** `v0.9.9` 仍提供 Windows Installer 与 Portable；自 **`v0.9.9.1` 起只提供 Windows Installer，不再发布 Portable 便携版**。

**本次升级建议（非强制）：** 建议 Portable 用户在 `v0.9.9` 就改用 Installer，先确认安装版数据正常，再停用旧便携版。迁移前请完全关闭程序并备份 `data/` 与 `downloads/`；若已使用媒体库迁移功能，则备份设置中显示的 `Elitesand Pro Media` 文件夹来替代 `downloads/`。`data/` 包含播放列表、设置、歌词缓存、授权、Twitch 与 PIN 状态；媒体文件夹包含歌曲、封面与歌词文件。`logs/` 不影响迁移，可不备份。

> [!WARNING]
> `v0.7.1`～`v0.7.3` 的旧更新器无法安全完成跨版本升级。另外由于 `v0.9.2` 引入 Electron 桌面框架与安装／封装架构等框架级更新，**从任何早于 `v0.9.2` 的版本升级时，都必须重新下载并安装完整 Installer 或 Portable 版本，不能使用增量更新**。请先保留旧文件夹与用户数据备份；完成 `v0.9.2` 或之后版本的完整安装后，未来兼容版本才可按照程序提示使用安全增量更新。

### 产品定位

Elitesand Pro 是为 VTuber、歌回主播与直播演出者设计的 Windows 桌面工具。它将歌曲管理、歌词搜索、同步播放、OBS 动态歌词、直播歌单与 Twitch 点歌流程整合在同一套本地应用程序中。

程序在本地运行，OBS 通过 Browser Source 加载透明歌词与歌单画面；桌面控制台、手机遥控器与 OBS 显示来源会实时同步。

### 使用说明

1. 从 GitHub Releases 下载最新 Windows Installer。`v0.9.9.1` 仍可下载 Portable；自 `v0.9.9.1` 起不再提供便携版。
2. 启动 Elitesand Pro，按照首次使用引导完成 yt-dlp、FFmpeg、网络与版本检查。
3. 导入 YouTube 链接、播放列表或本地音频文件，确认歌名、歌手与歌词来源。
4. 在歌词设置中选择动画模板、字体、颜色、位置与预设。
5. 复制“歌词网址”与“歌单网址”，分别加入 OBS Browser Source。
6. 需要观众点歌时，连接 Twitch，设置聊天室命令或频道点数奖励与限制。
7. 直播中可使用桌面控制台、手机遥控器或 Stream Deck 控制播放、切歌、时间偏移与紧急隐藏。
8. 收播后可保存场次、导出歌单，并复制 YouTube 章节时间戳。

> 初次使用建议先用测试场景完成一首歌曲的导入、歌词同步、OBS 显示与 Twitch 点歌流程，再投入正式直播。

### 主要功能

#### 歌曲导入与播放

- 粘贴 YouTube 单曲或播放列表链接，自动下载音频、识别歌手／歌名、搜索歌词并获取封面。
- 支持 MP3、FLAC、WAV、M4A、OGG 等本地音频拖放导入。
- 导入前检查视频时长、类型与重复项目，降低误下载非音乐内容的风险。
- 单一导入队列、播放列表批量任务、取消、重试与任务状态管理。
- 播放、暂停、上一首、下一首、进度拖动与迷你播放器。
- 每首歌可独立保存 ±12 半音变调、0.5x～1.5x 变速与时间偏移。
- 内置 SoundTouch／WSOLA 高质量变调与变速处理。
- 播放列表拖动排序、歌曲信息编辑、列表导入／导出与清空确认。
- 媒体库自动保存已使用歌曲、播放次数、歌词、时间校正与播放设置。

#### 歌词搜索与处理

- 多来源并行搜索：BetterLyrics、Apple Music、酷狗、QQ Music、LRCLIB、网易云等。
- 自动匹配最佳歌词，也可手动选择来源。
- 支持逐字、逐句、LRC、KRC、TTML、SRT 与纯文本歌词。
- 可直接粘贴歌词，或使用逐行时间轴编辑器修正每句时间。
- 一键“对齐第一句”整体平移歌词时间。
- 日文／韩文罗马拼音、中文汉语拼音与部分中文谐音显示。
- 简体转繁体显示，不破坏拼音与原始时间数据。
- 清理来源中的多余制作信息、工作室名称、版本备注与错误标题。
- 歌词来源缓存、健康状态、失败重试与来源降级处理。

#### OBS 动态歌词

内置六种歌词演出模板：

- 经典叠层
- Pulse
- Facet
- Aura
- KTV
- 直书句流

每个模板可独立保存：

- 字体、字号、颜色、描边与透明度
- 位置、间距、对齐、显示范围
- 动画强度与切换效果
- 命名预设

其他能力：

- OBS 透明背景 Browser Source。
- 逐字扫光、逐句切换、间奏倒计时与 KTV 时钟同步。
- 紧急隐藏只隐藏 Elitesand Pro 元素，不遮盖整个直播画面。
- OBS 歌词与歌单来源连接状态实时显示。
- 修改设置后实时同步，不需要重新粘贴 OBS 网址。

#### 直播歌单

- 显示已唱、正在唱与接下来的歌曲。
- 自动记录场次歌曲与时间戳，可复制为 YouTube 章节。
- 支持角落列表与全屏场景版式。
- 多种主题与 40 项以上外观设置。
- 根据 OBS Browser Source 尺寸自动调整版面。
- 长歌名与长歌手名称会自动分配空间，避免重要信息被挤压。
- 可创建、保存与切换不同直播场次。

#### Twitch 集成

- Twitch Device Code Flow 登录，不需要 Client Secret。
- 根据 Twitch 实际开播时间自动创建直播歌单场次。
- 聊天室点歌命令与 YouTube 链接解析。
- 点歌先进入待确认区，由主播确认后才下载，不会直接污染正式歌单。
- 导入失败可重试，超时或拒绝可取消。
- 频道点数兑换点歌、必要文字输入、成功完成与失败退款。
- 点歌限制、歌曲长度、重复歌曲、用户名额与公平工作阶段。
- 观众可查询、自行取消，管理员可通过聊天室管理。
- 自定义成功、失败、等待与拒绝回复。
- Twitch 断线重连、请求持久化与程序重启后恢复。
- 未知 EventSub 或聊天 fragment 会安全忽略，不中断整体流程。

#### 控制与安全

- 手机遥控器：播放、切歌、进度、变调、歌词来源、模板与预设控制。
- Stream Deck HTTP API：`/api/deck/:action`。
- 可选 PIN 保护，避免同一局域网设备误操作；OBS 显示来源不受影响。
- 只读／可写控制权限与请求大小限制。
- 状态版本、损坏备份、自动恢复、数据迁移与回滚。
- 多实例与连接冲突保护。
- 详细日志、错误提示、yt-dlp／FFmpeg 健康检查。

#### 多语言界面

程序目前支持：

- 繁體中文
- English
- 日本語
- 한국어
- 简体中文

主要桌面操作、Twitch 状态、错误消息、授权流程与动态数字格式都已纳入本地化；缺少字符串时会回退至繁体中文。

### 安装方式

#### 一般用户

请从 GitHub Releases 下载最新的 Windows Installer。`v0.9.9` 仍可下载 Portable；自 `v0.9.9.1` 起不再提供便携版。

- **Installer**：运行安装程序并按照向导完成安装。
- **Portable**：解压后直接运行启动文件，不需要另外安装 Node.js、yt-dlp 或 FFmpeg。

安装包目前未进行商业代码签名，Windows SmartScreen 可能显示警告。请确认下载来源与 SHA-256 校验值后再运行。

PowerShell 验证示例：

```powershell
Get-FileHash ".\Elitesand Pro Setup 0.9.9.exe" -Algorithm SHA256
```

### OBS 设置

1. 在 Elitesand Pro 复制“歌词网址”或“歌单网址”。
2. OBS 新增“浏览器”来源。
3. 粘贴网址并设置尺寸；歌词通常建议使用直播画布尺寸，例如 1920×1080。
4. 设置修改后会实时同步。如果 OBS 仍显示旧内容，请右键点击来源并刷新缓存。

常用网址：

| 网址 | 用途 |
|---|---|
| `/` | 桌面控制面板 |
| `/controller` | 手机遥控器 |
| `/display` | OBS 动态歌词 |
| `/setlist` | OBS 直播歌单 |

### 安全更新

安全增量更新只接受 GitHub Release 中名称完全相符的：

- `update.zip`
- `update.zip.sha256`

更新器会验证 SHA-256、ZIP 路径与大小、文件白名单、manifest、依赖与 lockfile 结构。`data/`、`downloads/`、`logs/`、设置、授权数据、Twitch token、PIN 与用户媒体不会被增量更新覆盖。

如果依赖或封装结构不兼容，程序会要求下载完整安装包；旧版 `v0.9.x` 仍可能提供 Portable，但从 `v0.9.9.1` 起不再提供。

### 授权

Elitesand Pro 采用 [Elitesand Pro 授权条款](LICENSE)：可免费用于个人与商业直播／演出，允许私人且不对外散布的自用修改；未经书面同意不得重新散布原版或修改版。

第三方组件按其原授权使用，详见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。歌曲、歌词、封面及其他媒体权利不包含在本项目授权内。
