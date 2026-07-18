# Elitesand Pro

**Language / 語言**：[English](#english) ・ [繁體中文](#繁體中文)

---

## English

Latest stable release: `v0.8.0`

> [!WARNING]
> **The built-in updater in v0.7.1–v0.7.3 cannot safely complete this upgrade — do not use "Update Now" from inside those versions.**
>
> Download the full `v0.8.0` Portable build instead, close Elitesand Pro, and unzip it fresh (keep a copy of your old folder first). Anyone already on `v0.7.3-p0-hotfix.1` or later can use the safe online updater directly.

A dynamic lyrics tool for VTubers / singing streamers. It drops lyric animations and a live setlist into OBS as **transparent overlays**, driven live from a desktop control panel or a phone remote: play, skip, resync timing, transpose/tempo, switch templates, emergency-hide.

Pure Node.js + vanilla HTML/CSS/JS — no framework, no bundler. OBS's browser source loads the page directly; edits take effect immediately.

### Lyrics
- **Automatic multi-source lookup**: searches six sources in parallel by title/artist (LRCLIB, NetEase, Kugou, QQ Music, the Apple Music family) and picks the best match automatically; you can also open "Choose Source" to compare candidates, or paste LRC/SRT/plain text directly
- **Line-level (LRC) and word-level (KRC)**: the playlist tags each song as "word-synced", "line-synced", "plain text", or "no lyrics"
- **Seven selectable lyric animation templates**: Classic Overlay, Pulse, Facet, Drift, Aura, KTV, Vertical Flow — each template **remembers its own** font/color/position settings independently, and named presets can be saved and applied with one click.
- **Romanization**: Japanese and Korean lyrics can show romaji and a Mandarin phonetic approximation; Chinese lyrics show Hanyu Pinyin (no phonetic approximation)
- **Simplified → Traditional conversion**: Simplified Chinese lyrics can be auto-displayed in Traditional (only the original text is converted; pinyin/phonetics are untouched)
- **Timing correction**: one-click "Align First Line" shifts the whole song; the line-by-line timeline editor fine-tunes individual lines that drift
- **Emergency hide**: one click hides the lyrics overlay during a live stream (only hides its own element — never covers your whole scene)

### Playback
- **YouTube import**: paste a link to auto-download audio + fetch lyrics + fetch cover art; supports both single videos and whole-playlist batch import; downloaded files are auto-named `Artist - Title.mp3` for easy organizing
- **Local audio files**: drag and drop MP3/FLAC/WAV/M4A/OGG to import directly
- **Transpose & tempo**: ±12 semitones, 0.5x–1.5x, remembered per song; built-in high-quality pitch engine (SoundTouch/WSOLA)
- **Playlist**: drag-to-reorder, edit title/artist, export/import named playlists, one-click clear (with confirmation)
- **Media library**: every song you've played is recorded automatically, including play count and remembered lyrics/pitch settings, with one-click re-add to the playlist
- **Mini player**: playback controls and a draggable progress bar stay visible at the top even while you're on another tab
- **Lyric source order**: defaults to BetterLyrics → Apple Music → Kugou → QQ Music → LRCLIB, with NetEase as a last resort; Kugou/QQ Music titles, credits, studio, and release info are cleaned up before display

### Live Setlist
- A standalone OBS overlay showing "sung / now playing / up next"; a session auto-starts/stops with your stream and records the night's songs and timestamps
- **Twitch auto-session / song requests**: a session auto-starts using Twitch's actual stream-start time; when a viewer types `!request <YouTube link>` it does **not** auto-download — it's listed on a dedicated "Song Requests" confirmation page in the sidebar. The streamer must click "Confirm Download" before it's added to the playlist (or reject it), so the home page doesn't get flooded with requests; chat only gets a reply once the result is known. Failed imports can be retried; unhandled requests auto-cancel after 30 minutes. A song is never added as an unplayable placeholder if its audio failed to download — the request is kept around for a retry instead.
- Multiple layout styles (corner-list style and full-screen scene style) × multiple themes, 40+ adjustable appearance options; each scene-style layout has independent settings
- The OBS URL never changes — switching layout/theme syncs automatically, no need to re-paste the URL
- One-click copy of YouTube chapter timestamps after the stream ends

### Control & Safety
- **Phone remote**: play/skip/transpose/choose-lyrics, and can switch all seven templates, position, motion intensity, and saved presets in sync with the desktop panel
- **OBS connection status**: the panel's top-right corner shows live whether the lyrics/setlist sources are actually connected
- **PIN protection (optional)**: the server is open on your local network; set a PIN to stop other devices on the same Wi-Fi from touching it by accident — OBS's own display sources are always exempt and never get disconnected by the PIN
- **Stream Deck**: an HTTP endpoint (`/api/deck/:action`) can be bound to actions like play, skip, or emergency-hide

### Install & Run

Requirements: Node.js 18+. YouTube import also needs [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) (on your PATH).

```bash
npm install
npm start
```

Open `http://localhost:3000` for the control panel. First run opens an onboarding walkthrough automatically and checks WebSocket, yt-dlp, FFmpeg, and the current version; you can reopen it later from the sidebar's "Help" button.

### Common URLs

| URL | Purpose |
|---|---|
| `/` | Desktop control panel (phones are redirected to the remote automatically) |
| `/controller` | Phone remote |
| `/display` | Lyrics source for OBS (transparent background) |
| `/setlist` | Live setlist source for OBS (transparent background) |

### Adding to OBS

1. Click "Lyrics URL" in the panel's top-right corner to copy it (or copy it from the settings page)
2. In OBS: Sources → "+" → "Browser" → paste the URL; set width/height to match your stream canvas (e.g. 1920×1080)
3. Same for the setlist ("Setlist URL" in the top-right); the corner-list style works at a smaller size, the full-screen scene style should be 16:9 full-canvas
4. Any setting you change in the panel afterward reflects in OBS immediately; if something looks stuck, right-click the source in OBS and choose "Refresh cache of current page"

### Configuration

`server/config.js` (not version-controlled — configure per machine; the app runs fine without this file):

- `port`: server port (default 3000)
- `cacheDays` / `maxCacheEntries`: how long/how many lyric cache entries are kept
- `updateCheckRepo`: defaults to `z22115554/elitesand-pro` (including public test pre-releases) and shows a direct download prompt when a new version is out; point it at your own fork or set it to an empty string to disable
- `twitchClientId`: Elitesand Pro ships with a public Client ID, so most users don't need to configure anything — just click "Connect Twitch" under General Settings → Twitch Live/Chat Requests to open the Twitch login/authorization page. Advanced users can override it with their own Client ID.
  The Twitch console can keep the redirect URL `http://localhost:3000/auth/twitch/callback`, but the public client actually uses the Device Code Flow; **no Client Secret is needed, and never share your token with anyone.**
- `twitchRequestCommand`: the chat command for song requests, default `!request`; a YouTube link must currently follow the command for the shared import queue to stay safe.

### Safe Online Updates

Since `v0.7.3-p0-hotfix.1`, incremental updates run through a separate updater process: the main app only downloads, verifies, and stages the update, then shuts down gracefully after replying to the frontend; an external updater waits for the old process to exit, then backs up, atomically swaps files, rolls back on failure, and restarts the app.

Updates only accept two exactly-named assets from a GitHub Release:

- `update.zip`
- `update.zip.sha256`

The update flow verifies SHA-256, zip paths and sizes, a file whitelist, the manifest, and the dependency/lockfile structure. `data/`, `downloads/`, `logs/`, settings, auth data, Twitch tokens, PIN/auth state, and your media are never touched by an incremental update.

Because the updater built into `v0.7.1`–`v0.7.3` can't safely complete an upgrade and can't be rescued by a remote asset, the following upgrades require downloading the full Portable build:

### Portable Build

- `v0.7.1 → v0.7.2`
- `v0.7.2 → v0.7.3`
- `v0.7.3 → v0.7.5`

Once you're on `v0.7.5` or later, subsequent compatible versions can use the new safe incremental updater. If the dependency or lockfile structure changes, the UI will also require the full Portable build.

#### Building an incremental update package

Use the `app` directory of the previously published Portable build as the baseline:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-update.ps1 -BaselineRoot "C:\path\to\previous-portable\app"
```

Produces `dist/releases/v<version>/update/update.zip` and a matching `update.zip.sha256` containing only 64 hex characters. The filenames stay exact because those are the two assets uploaded to the GitHub Release; their versioned parent directory prevents a later build from replacing an earlier update. `-SkipBaselineCheck` is for local testing only and should never be used for a real release.

### Remote Announcements

The app reads `announcement.json` from a fixed HTTPS URL, supporting:

- `info`: a bottom-right toast, logged on the settings page
- `warning`: a persistent top banner
- `critical`: an unmissable centered modal
- effective/expiry times, version ranges, show-once, and dismissibility
- `disableIncrementalUpdate` / `showFullDownloadOnly` safety actions

Announcement content is only shown after server-side schema validation, and the frontend always renders it as plain text nodes; on connection failure it falls back to the local cache, and an expired announcement won't reappear even offline. The `announcement.json` at the repo root is a publishing example, disabled by default — check the version range and expiry before enabling it.

### Packaging

```powershell
npm run package:portable
npm run package:update -- -BaselineRoot "C:\path\to\previous-portable\app"
```

Produces `Elitesand-Pro-v<version>-portable.zip` under `dist/releases/v<version>/portable/`, bundling the Node runtime and all dependencies. The current public build ships with yt-dlp and FFmpeg/ffprobe by default, and includes an exact FFmpeg source snapshot, the GPLv3 license, and build info under `licenses/ffmpeg/`; to build a version without FFmpeg, run `tools/build-portable.ps1 -WithoutFfmpeg`. After unzipping, double-click `Start Elitesand Pro.cmd` to run it — nothing else needs to be installed. The build also produces a matching `.sha256`; the launcher itself must stay plain CMD, ASCII, no BOM. It's unsigned, so a Windows SmartScreen warning is expected (More info → Run anyway).

### License

Elitesand Pro is distributed under the [Elitesand Pro License](LICENSE): **free to use** (including personal and commercial streaming/performance), but **redistribution or modification requires written permission**. Third-party components keep their own licenses — see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Rights to songs, lyrics, cover art, and other media are not covered by this project's license.

### Development

```bash
npm run dev    # auto-restart via node --watch
npm test       # unit tests (lyrics parsing, romanization, persistence, etc.)
```

### FAQ

- **A setting changed in the panel isn't showing up in OBS**: right-click the browser source and choose "Refresh cache of current page" — OBS stubbornly caches the old page
- **Garbled Chinese titles from YouTube import**: the app already forces UTF-8 handling; if it still happens, your yt-dlp is probably outdated — update it and restart the server
- **Imported a song but can't find it**: check the "Playlist" first; if it's not there, check whether the "Media Library" already has the same song
- **No lyrics found at all**: make sure the title/artist are correct (use the ✎ edit button in the playlist to fix them), then try "Choose Source" again; if still nothing, use "Paste Lyrics" to add them manually
- **Why does a YouTube video warn that it is non-music, too long, or too short?**: the app checks type and duration before downloading to prevent accidental imports. Choose "Skip" when it is not a song; only disable all import-risk warnings if you want future warnings to continue automatically
- **Will removing a song from the playlist erase my corrections?**: no. Adding the same track back restores its saved manual lyrics and timing offset; removing it only affects the current playlist, not the media-library file
- **A Twitch request failed or I restarted the app**: unprocessed requests (until expiry) and retryable failures remain in the Requests page so the streamer can retry or reject them later
- **The app closed for an online update but did not reopen**: wait about a minute, then start Elitesand Pro normally. A failed update does not intentionally remove your playlist, settings, or downloaded media; do not run two copies while updating
- **Port 3000 already in use**: change `port` in `server/config.js`
- **Audio quality after transposing**: the built-in SoundTouch pitch engine is high quality, but large pitch shifts can still sound a bit artificial — that's expected; re-play the song after changing the transpose

> **Note**: this README is currently the only translated document; the in-app UI itself (control panel, remote, settings) is Traditional Chinese only for now. Full UI localization (English included) is planned for a future release — see the project's internal roadmap.

---

## 繁體中文

最新穩定版：`v0.8.0`

> [!WARNING]
> **v0.7.1～v0.7.3 內建的更新器無法安全完成這次升級，請勿使用「立即線上更新」。**
>
> 請下載 `v0.8.0` 完整可攜版，關閉 Elitesand Pro 後解壓縮使用。建議先保留原資料夾副本。
> 已安裝 `v0.7.3-p0-hotfix.1` 或之後版本者可直接使用安全線上更新。

VTuber／唱歌直播主用的動態歌詞演出工具。把歌詞動畫和直播歌單以**透明疊加層**放進 OBS，
用桌面控制面板或手機遙控器即時操作：播放、切歌、對時間軸、變調變速、換模板、緊急隱藏。

純 Node.js + 原生 HTML/CSS/JS，無框架、無打包工具——OBS 瀏覽器來源直接吃網頁，改完即時生效。

### 主要功能

#### 歌詞
- **多來源自動抓歌詞**：依歌名／歌手並行搜尋六個來源（LRCLIB、網易雲、酷狗、QQ、Apple Music 系），
  自動挑最合適的版本；也可手動開「選擇來源」比較候選，或直接貼上 LRC／SRT／純文字
- **逐句（LRC）與逐字（KRC）**：播放清單會標示每首歌目前是「逐字」「逐句」「純文字」或「無歌詞」
- **七種可選歌詞動畫模板**：經典疊層、星砂流光、折光階梯、斜拍告白、潮汐心景、霓彩伴唱、直書句流；
  每個模板**獨立記憶**自己的字體／顏色／位置設定，並可保存具名預設一鍵切換。
- **拼音／諧音**：日文、韓文歌詞可顯示羅馬拼音與中文諧音；中文歌顯示漢語拼音（不做諧音）
- **簡轉繁**：簡體歌詞可自動顯示為繁體（只轉原文，拼音／諧音不動）
- **時間軸校正**：整首平移用「對齊第一句」一鍵校正；個別句子拖拍用「逐行時間軸編輯器」微調
- **緊急隱藏**：直播中一鍵隱藏歌詞畫面（只隱藏自家元素，不會蓋到你的直播場景）

#### 播放
- **YouTube 匯入**：貼網址自動下載音訊＋抓歌詞＋抓封面；支援單曲與整份播放清單批次匯入；
  下載檔自動命名為「歌手 - 歌名.mp3」方便整理
- **本機音檔**：拖曳 MP3／FLAC／WAV／M4A／OGG 直接匯入
- **變調變速**：±12 半音、0.5x–1.5x，每首歌獨立記憶；內建高品質變調引擎（SoundTouch／WSOLA）
- **播放清單**：拖曳排序、編輯歌名／歌手、匯出／匯入具名清單、一鍵清除（含確認）
- **媒體庫**：唱過的歌自動記錄，含播放次數與歌詞／變調記憶，一鍵重新加入清單
- **迷你播放器**：切到其他分頁時頂部仍有播放控制與可拖曳進度條
- **歌詞來源**：預設依 BetterLyrics → Apple Music → 酷狗 → QQ → LRCLIB 搜尋，網易作最後備援；
  酷狗／QQ 的標題、製作人員、工作室與發行資訊會在顯示前統一清洗

#### 直播歌單（Setlist）
- 獨立的 OBS 疊加層，顯示「已唱／正在唱／接下來」；開台／收台記錄本場曲目與時間點
- **Twitch 自動開台／點歌**：以 Twitch 的實際開台時間自動開始 session；觀眾輸入
  `!點歌 <YouTube 連結>` 不會自動下載，而是列在側欄的「點歌」獨立確認頁。主播按「確認下載」才加入
  播放清單（可拒絕），避免首頁被請求塞滿；結果才回覆聊天室。匯入失敗可重試，30 分鐘未處理會自動取消。
  音檔未下載成功時絕不會加入不可播放的空項目；會保留請求供重試。
- 多種版型（角落清單型與全畫面場景型）× 多主題，外觀 40+ 項可調，場景版每個版型獨立設定
- OBS 網址固定不變，換版型／主題自動同步，不用重貼網址
- 收播後一鍵複製 YouTube 章節時間戳

#### 控制與安全
- **手機遙控器**：播放／切歌／調 Key／選歌詞，並可同步切換七種模板、位置、動態強度與已保存預設
- **OBS 連線狀態**：面板右上角即時顯示歌詞／歌單來源是否已連上
- **PIN 保護（選用）**：伺服器對區網開放，可設 PIN 防止同 Wi-Fi 裝置誤觸；
  OBS 顯示來源永遠豁免，不會因 PIN 斷線
- **Stream Deck**：HTTP 指令端點（`/api/deck/:action`）可綁定播放／切歌／緊急隱藏等動作

### 安裝與執行

需求：Node.js 18+；要用 YouTube 匯入功能需另裝 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 與
[ffmpeg](https://ffmpeg.org/)（放進 PATH）。

```bash
npm install
npm start
```

打開 `http://localhost:3000` 就是控制面板。第一次使用會主動開啟新手引導，並檢查
WebSocket、yt-dlp、FFmpeg 與目前版本；之後仍可從側欄「教學」再次開啟。

### 常用網址

| 網址 | 用途 |
|---|---|
| `/` | 桌面控制面板（手機打開會自動轉到遙控器） |
| `/controller` | 手機遙控器 |
| `/display` | 貼進 OBS 的歌詞來源（透明背景） |
| `/setlist` | 貼進 OBS 的直播歌單來源（透明背景） |

### 接進 OBS

1. 面板右上角按「歌詞網址」複製（或到設定頁複製）
2. OBS 來源列表 →「＋」→「瀏覽器」→ 貼上網址，寬高建議設成直播畫布大小（如 1920×1080）
3. 歌單同理（右上角「歌單網址」）；角落清單版可用較窄尺寸，全畫面場景版建議 16:9 滿版
4. 之後在面板改任何設定都會即時反映到 OBS；若覺得「改了沒變」，對來源右鍵「重新整理快取」

### 設定檔

`server/config.js`（不進版控，每台機器各自設定；沒有此檔也能啟動）：

- `port`：伺服器埠號（預設 3000）
- `cacheDays`／`maxCacheEntries`：歌詞快取保留天數與筆數
- `updateCheckRepo`：預設追蹤 `z22115554/elitesand-pro`（含公開測試 prerelease），有新版時顯示直接下載提示；可改成自己的 fork 或設空字串停用
- `twitchClientId`：Elitesand Pro 已內建公開 Client ID，一般使用者不需設定。只要在「一般設定 → Twitch 開台／聊天室點歌」按「連接 Twitch」，就會直接開啟 Twitch 登入／授權頁；進階使用者才可用自己的 Client ID 覆蓋。
  Console 可保留 Redirect URL `http://localhost:3000/auth/twitch/callback`，但公開用戶端實際採 Device Code Flow；**不需要 Client Secret，也不要把 token 貼給任何人**。
- `twitchRequestCommand`：聊天室點歌命令，預設 `!點歌`；目前命令後必須附 YouTube 連結，才能安全使用既有單一匯入佇列。

### 安全線上更新

從 `v0.7.3-p0-hotfix.1` 起，增量更新改由獨立 updater 完成：主程式只下載、驗證與建立 staging，
回應前端後優雅關閉；外部 updater 等待原程序結束，再備份、原子替換、失敗回滾並重新啟動。

更新只接受 GitHub Release 中名稱完全相符的兩個資產：

- `update.zip`
- `update.zip.sha256`

更新流程會驗證 SHA-256、ZIP 路徑與大小、檔案白名單、manifest，以及相依套件與 lockfile
結構。`data/`、`downloads/`、`logs/`、設定、授權資料、Twitch token、PIN/auth 狀態與
使用者媒體都不會被增量更新覆蓋。

由於 `v0.7.1`～`v0.7.3` 內建的 updater 無法安全完成升級，且無法靠遠端資產補救。以下升級必須下載
完整 Portable 版本：

### 可攜版

- `v0.7.1 → v0.7.2`
- `v0.7.2 → v0.7.3`
- `v0.7.3 → v0.7.5`

安裝 `v0.7.5` 後，後續相容版本才可使用新的安全增量更新。若相依套件或 lockfile 結構改變，介面也會要求改用完整 Portable 版本。

#### 建立增量更新包

應以「上一個已發布 Portable 的 `app` 目錄」作為基準：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-update.ps1 -BaselineRoot "C:\path\to\previous-portable\app"
```

輸出為 `dist/releases/v<版本>/update/update.zip` 與同資料夾下、只含 64 個十六進位字元的 `update.zip.sha256`。檔名仍固定，因為上傳到 GitHub Release 的就是這兩個資產；但版本資料夾會保留，後續版本不會覆蓋舊更新包。`-SkipBaselineCheck` 僅供本機檢查，不應用於正式 Release。

### 遠端公告

程式會從固定 HTTPS 網址讀取 `announcement.json`，並支援：

- `info`：右下角提示與設定頁紀錄
- `warning`：頂部固定警告列
- `critical`：不可忽略的中央警告卡
- 生效時間、到期時間、版本範圍、只顯示一次與可否關閉
- `disableIncrementalUpdate`、`showFullDownloadOnly` 安全動作

公告內容經伺服器端 schema 驗證後才會顯示，前端一律以文字節點渲染；連線失敗時使用本機快取，過期公告即使離線也不會再次出現。根目錄的 `announcement.json` 是發布範例，預設停用，啟用前應確認版本範圍與到期日。

### 打包

```powershell
npm run package:portable
npm run package:update -- -BaselineRoot "C:\path\to\previous-portable\app"
```

會在 `dist/releases/v<版本>/portable/` 產生 `Elitesand-Pro-v<版本>-portable.zip`——內含 Node 執行檔與所有依賴。
目前公開包預設隨附 yt-dlp、FFmpeg／ffprobe，並在 `licenses/ffmpeg/`
附精確 FFmpeg source snapshot、GPLv3 與 build 資訊；若要建立不含 FFmpeg 的分離版，執行
`tools/build-portable.ps1 -WithoutFfmpeg`。解壓後雙擊 `Start Elitesand Pro.cmd`
即可使用，對方不用裝任何東西。建置同時產生同名 `.sha256`；啟動器必須維持純 CMD、
ASCII、無 BOM。未簽章，Windows SmartScreen 警告屬正常（更多資訊 → 仍要執行）。

### 授權

Elitesand Pro 採 [Elitesand Pro 授權條款](LICENSE)：**免費使用**（含個人與商業直播／演出），
但**未經書面同意不得重新散布或改作**。第三方元件維持各自授權，詳見
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)；歌曲、歌詞、封面與其他媒體權利不包含在本專案授權內。

### 開發

```bash
npm run dev    # node --watch 自動重啟
npm test       # 單元測試（歌詞解析／羅馬化／持久化等）
```

### 常見問題

- **OBS 裡改了設定卻沒變**：對瀏覽器來源按右鍵「重新整理快取」，OBS 會頑固快取舊版頁面
- **YouTube 匯入的中文標題亂碼**：程式已強制 UTF-8 處理；若仍發生，多半是 yt-dlp 版本過舊，更新後重開伺服器
- **匯入後找不到歌**：先看「播放清單」，沒有的話看「媒體庫」是否已有同一首
- **歌詞完全找不到**：先確認歌名／歌手正確（清單上的 ✎ 可修正），再重新「選擇來源」；還是沒有就「貼上歌詞」手動補
- **為什麼 YouTube 影片會警告非音樂、太長或太短？**：程式會先檢查類型和時長，避免誤匯入；不適合就略過，只有確定之後所有匯入風險警告都要直接繼續時才關閉警告
- **移除播放清單後，手動歌詞和時間偏移會不見嗎？**：不會。同一首歌加回時會恢復記憶；移除只影響目前歌單，不會刪除媒體庫檔案
- **Twitch 點歌失敗或重開程式後怎麼辦？**：待確認（未逾時）或可重試的請求仍會留在「點歌」頁，可在之後重試或拒絕
- **線上更新關掉程式卻沒自動回來？**：等約一分鐘後用平常方式重新開啟 Elitesand Pro；更新失敗不會主動清除歌單、設定或下載檔，更新時不要同時開兩份程式
- **3000 埠被占用**：改 `server/config.js` 的 `port`
- **變調後音質**：內建 SoundTouch 高品質變調引擎，大幅變調仍可能有些許人工感屬正常；調整變調後建議重新播放該首

> **備註**：目前只有這份 README 有英文版；程式本身的畫面（控制面板、遙控器、設定頁）暫時仍只有繁體中文。完整 UI 英文化（i18n）已列入未來版本規劃，尚未開始。
