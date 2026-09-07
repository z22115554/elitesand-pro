<div align="center">

# Elitesand Pro

**為 VTuber 歌回與直播演出打造的本機歌詞演出系統**
*A local lyric-performance system for VTubers, singing streamers, and live performers*

**最新版本 / Latest：`v1.0.0`**  ·  Windows 專用 / Windows only  ·  [下載 / Download →](../../releases/latest)

繁體中文 · [English](#english) · [日本語](#日本語) · [한국어](#한국어) · [简体中文](#简体中文)

</div>

---

## 繁體中文

### 這是什麼

Elitesand Pro 把**歌曲匯入、歌詞搜尋、同步播放、OBS 動態歌詞、直播歌單、Twitch 點歌**整合進同一個 Windows 桌面程式。

程式在你自己的電腦上執行，OBS 透過 Browser Source 載入透明的歌詞與歌單畫面。桌面控制台、手機遙控器與 OBS 顯示來源之間即時同步——改一個設定，三邊同時更新，不需要重新貼網址。

### 快速開始

1. 從 [GitHub Releases](../../releases/latest) 下載 Windows Installer，關閉舊版後執行安裝。
2. 啟動程式，依首次使用引導完成 yt-dlp、FFmpeg、網路與版本檢查。
3. 貼上 YouTube 連結、播放清單或拖入本機音檔，確認歌名、歌手與歌詞來源。
4. 選一個歌詞模板，調字體、顏色、位置、動畫與預設。
5. 複製「歌詞網址」與「歌單網址」，分別貼進兩個 OBS Browser Source。
6. 需要觀眾點歌時連接 Twitch，設定聊天室指令或忠誠點數獎勵與限制。
7. 直播中用桌面控制台、手機遙控器或 Stream Deck 控制播放、切歌、時間偏移與緊急隱藏。
8. 收播後保存場次、匯出歌單，一鍵複製整場的 YouTube 章節時間戳。

> 第一次使用，建議先用測試場景把「一首歌」的匯入 → 歌詞同步 → OBS 顯示 → Twitch 點歌整條流程走過一遍，再上正式直播。

### 功能

#### 匯入與播放

- YouTube 單曲與播放清單：自動下載音訊、辨識歌手／歌名、搜尋歌詞、抓封面。
- 程式內 YouTube 搜尋，優先比對 YouTube Music。
- 本機音檔拖放匯入：MP3、FLAC、WAV、M4A、OGG。
- 匯入前檢查時長、類型與重複項，降低誤抓非音樂內容的機率。
- 單一下載佇列、批次工作、取消、重試與工作狀態管理。
- 每首歌獨立保存 ±12 半音變調、0.5×–1.5× 變速與時間偏移，內建 SoundTouch／WSOLA 高品質處理。
- 播放清單拖曳排序、歌曲資訊編輯、清單匯入／匯出。
- 媒體庫自動記住用過的歌曲、播放次數、歌詞、對時與播放設定。
- 可選「統一音量」：兩條播放鏈一起做響度標準化，切歌不忽大忽小。

#### 歌詞

- 多來源並行搜尋：BetterLyrics、Apple Music、酷狗、QQ音樂、LRCLIB、網易雲等，自動挑最佳、也可手選。
- 支援逐字、逐句、LRC、KRC、TTML、SRT 與純文字。
- 逐行時間軸編輯器，一鍵「對齊第一句」整體平移。
- 合唱聲部解析，KTV 模板據此自動上色。
- 每個歌詞來源各自記住時間偏移，換來源不用重新對時。
- 日文／韓文羅馬拼音、中文漢語拼音與部分諧音顯示。
- 對時歌詞自動簡轉繁，不破壞拼音與原始時間資料。
- 自動清洗來源裡的製作名單、工作室名稱、版本註記與錯置標題。

#### OBS 動態歌詞

十一種演出模板，各自獨立保存字體／字級／顏色／描邊／透明度、位置／間距／對齊／顯示範圍、動畫強度與具名預設：

| 模板 | 一句話 |
|---|---|
| 經典疊層 | 完整歌詞畫面，支援歷史行、拼音與諧音 |
| 星砂流光 / 折光階梯 / 潮汐心景 | 單句聚焦的三種節奏與氛圍 |
| 霓彩伴唱 | 固定雙行伴唱畫面，間奏與結尾可自訂字樣 |
| 直書句流 | 直行兩側錯落，唱過留殘影，可選四相漂字進場 |
| 紙帶逐字 | 紙帶展開後逐字填入，橫式或直式 |
| 虛實鏡書 | 左實心、右鏡像空心，中央保留人物空間 |
| 對話氣泡 | iMessage 風逐字打字，長間奏跳貼圖 |
| 跑馬燈牌 | LED 點陣燈牌，唱過的燈亮、沒唱的暗 |
| 風息成字 | 粒子隨風散開，再聚成正在唱的字；字幕尺度，可直書或左右分散 |

- OBS 透明背景 Browser Source，改設定即時同步。
- 逐字掃光、逐句切換、間奏倒數與時鐘同步。
- 緊急隱藏只藏 Elitesand Pro 自己的元素，不會用黑幕蓋掉整個直播畫面。
- 本機字型可直接載入使用，支援 `.ttc` 集合字型。
- 提詞機歌詞可加日文假名注音。

#### 直播歌單

- 已唱／正在唱／接下來，一目了然。
- 自動記錄場次歌曲與時間戳，可複製成 YouTube 章節。
- 十餘種版型（經典資訊、發車看板、手帳頁、底片邊條、夜間霓虹…），依 OBS Browser Source 尺寸自動排版。
- 長歌名與長歌手名自動分配空間，重要資訊不被擠掉。
- 可建立、保存與切換不同直播場次。

#### Twitch 點歌

- Device Code Flow 登入，不需要 Client Secret。
- 依 Twitch 實際開台時間自動建立場次。
- 聊天室指令與 YouTube 連結解析；點歌先進待確認區，主播確認後才下載，不直接污染正式歌單。
- 忠誠點數兌換點歌，含必填文字、完成、拒絕、逾時與自動退款。
- 點歌上限、歌曲長度、重複範圍、使用者名額與公平工作階段。
- 觀眾可自助查詢與取消，管理員可透過聊天室管理。
- 自訂成功／失敗／等待／拒絕回覆。
- 斷線重連、請求持久化、程式重啟後恢復。

#### AI 人聲分離（實驗性，預設關閉）

- 離線把歌曲分成純伴奏與純人聲，第一次使用會下載模型。
- NVIDIA 顯卡走 GPU 推論；非 NVIDIA 走 WebGPU 引擎；都不行時降級 CPU（較慢，但不會假裝很快）。
- 首頁「AI 伴奏」分頁可一次把整份歌單做成純伴奏。
- 雙路音訊：伴奏給 OBS、人聲留給自己監聽，或反過來。

> 實驗性功能，不建議在正式直播前才第一次啟用。

#### 控制、安全與資料

- 手機遙控器：播放、切歌、進度、變調、歌詞來源、模板與預設。
- Stream Deck HTTP API：`/api/deck/:action`。
- 可選 PIN 保護，避免同區網裝置誤觸；OBS 顯示來源不受影響。
- 唯讀／可寫權限與請求大小限制。
- 狀態版本化、損壞自動備份、恢復、資料遷移與回滾。
- 媒體檔存在安裝位置旁的「Elitesand Pro Media」資料夾；解除安裝預設保留資料，另提供完整清除。
- 詳細日誌、錯誤提示、yt-dlp／FFmpeg 健康檢查。

#### 多語言介面

繁體中文、English、日本語、한국어、简体中文。桌面操作、Twitch 狀態、錯誤訊息、授權流程與數字格式皆已本地化，缺字串時回退繁體中文。

### 安裝

從 [GitHub Releases](../../releases/latest) 下載 Windows Installer，關閉 Elitesand Pro 後執行安裝精靈。安裝為 per-user，不需要系統管理員權限。

安裝包目前**未做商業程式碼簽章**，Windows SmartScreen 首次執行會顯示藍色警告：

1. 點警告視窗的「**其他資訊**」
2. 再點「**仍要執行**」

請只從官方 GitHub Releases 下載，並核對隨附的 `.sha256`：

```powershell
Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"
```

### OBS 設定

1. 在 Elitesand Pro 複製「歌詞網址」或「歌單網址」。
2. OBS 新增「瀏覽器」來源。
3. 貼上網址，設定尺寸（歌詞建議用直播畫布尺寸，例如 1920×1080）。
4. 設定改動即時同步；若 OBS 仍是舊畫面，對來源按右鍵「重新整理快取」。

| 網址 | 用途 |
|---|---|
| `/` | 桌面控制面板（手機瀏覽器會自動導向 `/controller`） |
| `/controller` | 手機遙控器 |
| `/display` | OBS 動態歌詞 |
| `/setlist` | OBS 直播歌單 |

### 更新

Elitesand Pro 會在**啟動時檢查更新**，也可在「連線與系統 → 檢查更新」手動檢查。相容時可直接在程式內套用增量更新（會顯示下載與安裝進度）；不相容時引導你到 GitHub Releases 下載完整 Installer。安裝完整版前請關閉 Elitesand Pro。

### 隱私

Elitesand Pro 以本機優先。兩項預設開啟、可在設定關閉的匿名回饋：**社群歌詞偏移分享**（幫助其他人少對一次時）與**每日用量彙總**。兩者皆不含歌單、媒體或個人識別資料，並於 [EULA](EULA.txt) 明列。其餘任何上傳都需要你明確開啟。

### 授權

Elitesand Pro 是原始碼不公開的專有軟體（proprietary，非開源），採用 [Elitesand Pro 授權條款](LICENSE)：

- 可**免費**用於個人與商業直播／演出。
- 允許私人、不對外散布的自用修改。
- 未經書面同意，不得重新散布原版或修改版，也不得散布本專案自有的原始碼。
- 官方發布一律只透過本頁的 GitHub Releases。

第三方元件（含 SoundTouch 等 LGPL 元件）依其原授權使用，不受上述限制拘束，詳見 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。歌曲、歌詞、封面及其他媒體的權利不包含在本專案授權內。

---

## English

### What it is

Elitesand Pro combines **song import, lyrics lookup, synchronized playback, animated OBS lyrics, live setlists, and Twitch song requests** into a single Windows desktop application.

Everything runs on your own machine; OBS loads transparent lyrics and setlist overlays through Browser Sources. The desktop console, phone remote, and OBS sources stay in sync in real time — change one setting and all three update at once, with no need to re-paste URLs.

### Quick start

1. Download the Windows Installer from [GitHub Releases](../../releases/latest), close any old version, and run setup.
2. Launch the app and complete the first-run checks for yt-dlp, FFmpeg, networking, and version status.
3. Paste a YouTube link or playlist, or drag in a local audio file, then confirm title, artist, and lyrics source.
4. Pick a lyrics template and adjust fonts, colors, position, motion, and presets.
5. Copy the **Lyrics URL** and **Setlist URL** into two separate OBS Browser Sources.
6. Connect Twitch and configure chat commands or Channel Points rewards and limits when viewer requests are needed.
7. During the stream, control playback, skipping, timing offset, and emergency hide from the desktop, phone remote, or Stream Deck.
8. After the stream, save the session, export the setlist, and copy the full YouTube chapter timestamps in one click.

> Before your first production stream, run one song end to end — import → lyrics sync → OBS display → Twitch request — in a test session.

### Features

#### Import & playback

- YouTube single videos and playlists: audio download, artist/title detection, lyrics lookup, cover art.
- In-app YouTube search, biased toward YouTube Music matches.
- Local audio drag-and-drop: MP3, FLAC, WAV, M4A, OGG.
- Pre-import checks for duration, type, and duplicates.
- Single download queue, batch jobs, cancel, retry, and job-status management.
- Per-song ±12-semitone transpose, 0.5×–1.5× tempo, and timing offset via built-in SoundTouch/WSOLA.
- Playlist drag-reorder, song-info editing, list import/export.
- Media library remembers used songs, play counts, lyrics, timing, and playback settings.
- Optional loudness normalization across both playback chains, so tracks don't jump in volume.

#### Lyrics

- Parallel multi-source search: BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase, and fallbacks — best match auto-selected or chosen manually.
- Word-synced, line-synced, LRC, KRC, TTML, SRT, and plain text.
- Timeline editor with one-click "align first line" global shift.
- Choral-part parsing that drives KTV coloring.
- Per-source timing offset memory — switching sources keeps your sync.
- Japanese/Korean romanization, Mandarin pinyin, and partial phonetic hints.
- Simplified-to-Traditional display conversion that preserves pinyin and original timing.
- Automatic cleanup of credits, studio names, version tags, and swapped titles from source data.

#### Animated OBS lyrics

Eleven performance templates, each with independent style settings (font, size, color, stroke, opacity, position, spacing, alignment, range, motion intensity) and named presets:

| Template | In one line |
|---|---|
| Classic Overlay | Full lyric view with history lines, pinyin, and phonetic hints |
| Stardust Pulse / Prism Steps / Tidal Mindscape | Three single-line moods and rhythms |
| Neon KTV | Fixed two-line karaoke view with custom interlude/ending text |
| Vertical Verse Flow | Staggered vertical columns, sung lines leave a fading trail |
| Paper Strip | Strip unrolls, then fills in character by character — horizontal or vertical |
| Mirror | Solid original on the left, hollow mirrored text on the right, center kept clear |
| Typewriter | iMessage-style typing, sticker drop during long interludes |
| Light Board | LED dot-matrix sign — sung dots lit, the rest dark |
| Windborne Particles | Particles scatter in the wind, then gather into the sung line; subtitle scale, vertical or split-sides |

- Transparent Browser Sources with instant sync on setting changes.
- Word highlighting, line transitions, interlude countdowns, and clock sync.
- Emergency hide only hides Elitesand Pro's own elements — it never blacks out your whole scene.
- Load local font files directly, including `.ttc` collections.
- Optional furigana on prompter lyrics.

#### Live setlist

- Sung / now playing / up next at a glance.
- Automatic session logging with timestamps, exportable as YouTube chapters.
- A dozen-plus layouts (Classic Info, Departure Board, Notebook Page, Filmstrip, Night Neon, …) that lay themselves out to the OBS Browser Source size.
- Long titles and artist names get their own space so key info isn't squeezed out.
- Create, save, and switch between stream sessions.

#### Twitch song requests

- Device Code Flow login — no Client Secret required.
- Sessions created automatically from Twitch's actual stream-start time.
- Chat commands and YouTube link parsing; requests land in an approval queue and download only after the host confirms.
- Channel Points requests with required text input, completion, rejection, timeout, and automatic refund.
- Request caps, song length, duplicate scope, per-viewer quotas, and fair sessions.
- Viewers self-query and self-cancel; moderators manage from chat.
- Custom success / failure / waiting / rejection replies.
- Reconnect, request persistence, and recovery across app restarts.

#### AI vocal separation (experimental, off by default)

- Offline split into instrumental-only and vocal-only; a model downloads on first use.
- NVIDIA GPUs use GPU inference; other GPUs use a WebGPU engine; otherwise it falls back to CPU (slower, and honest about it).
- The home "AI instrumental" tab can process a whole setlist at once.
- Dual audio routing: instrumental to OBS, vocals to your monitor, or the reverse.

> Experimental — don't enable it for the first time right before a live stream.

#### Control, safety & data

- Phone remote: playback, skip, seek, transpose, lyrics source, template, and presets.
- Stream Deck HTTP API: `/api/deck/:action`.
- Optional PIN protection against stray LAN devices; OBS display sources are exempt.
- Read-only / read-write roles and request size limits.
- Versioned state, corrupt-backup capture, recovery, migration, and rollback.
- Media lives in an "Elitesand Pro Media" folder beside the install location; uninstall keeps data by default and offers full cleanup.
- Detailed logs, error hints, yt-dlp/FFmpeg health checks.

#### Multi-language UI

Traditional Chinese, English, Japanese, Korean, Simplified Chinese. Desktop actions, Twitch status, error messages, licensing flow, and number formatting are all localized, falling back to Traditional Chinese for any missing string.

### Installation

Download the Windows Installer from [GitHub Releases](../../releases/latest), close Elitesand Pro, and run the setup wizard. Installation is per-user and does not require Administrator.

The build is **currently unsigned**, so Windows SmartScreen shows a blue warning on first run:

1. Click **More info**
2. Click **Run anyway**

Download only from the official GitHub Releases page and verify the bundled `.sha256`:

```powershell
Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"
```

### OBS setup

1. Copy the Lyrics URL or Setlist URL from Elitesand Pro.
2. Add an OBS **Browser** source.
3. Paste the URL and set the size (lyrics usually match your canvas, e.g. 1920×1080).
4. Changes sync immediately. If OBS shows stale content, right-click the source and refresh its cache.

| URL | Purpose |
|---|---|
| `/` | Desktop control panel (mobile browsers redirect to `/controller`) |
| `/controller` | Phone remote |
| `/display` | Animated lyrics overlay |
| `/setlist` | Live setlist overlay |

### Updates

Elitesand Pro **checks for updates on startup** and on demand from **Connection & System → Check for updates**. When compatible it applies an incremental update in-app (with download and install progress); otherwise it points you to the full Installer on GitHub Releases. Close Elitesand Pro before running a full installer.

### Privacy

Elitesand Pro is local-first. Two anonymous, on-by-default contributions can be turned off in settings: **community lyric-offset sharing** (so others sync less often) and **daily usage aggregation**. Neither includes setlists, media, or personal identifiers, and both are disclosed in the [EULA](EULA.txt). Any other upload requires you to opt in explicitly.

### License

Elitesand Pro is proprietary, closed-source software (not open source), under the [Elitesand Pro License](LICENSE):

- **Free** for personal and commercial streaming or performance.
- Private, non-distributed modifications are allowed.
- Redistributing the original or a modified build, or this project's own source code, requires written permission.
- Official releases are published only through the GitHub Releases page above.

Third-party components (including LGPL components such as SoundTouch) remain governed by their own licenses — see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Rights to songs, lyrics, cover art, and other media are not covered by this license.

---

## 日本語

### 概要

Elitesand Pro は、**楽曲の取り込み・歌詞検索・同期再生・OBS 用の動く歌詞・セットリスト・Twitch リクエスト**を一つの Windows デスクトップアプリに統合します。

処理はすべて自分の PC 上で行われ、OBS は Browser Source で透明な歌詞／セットリストを読み込みます。デスクトップ操作画面・スマホリモコン・OBS ソースはリアルタイムで同期し、設定を一つ変えれば三者が同時に更新されます（URL の貼り直しは不要）。

### クイックスタート

1. [GitHub Releases](../../releases/latest) から Windows Installer をダウンロードし、旧版を終了してからインストールします。
2. アプリを起動し、初回案内に従って yt-dlp・FFmpeg・ネットワーク・バージョンを確認します。
3. YouTube リンクやプレイリストを貼り付ける、またはローカル音源をドラッグし、曲名・アーティスト・歌詞ソースを確認します。
4. 歌詞テンプレートを選び、フォント・色・位置・動き・プリセットを調整します。
5. 「歌詞 URL」と「セットリスト URL」を別々の OBS Browser Source に追加します。
6. 視聴者リクエストが必要なら Twitch を接続し、チャットコマンドまたはチャンネルポイント報酬と制限を設定します。
7. 配信中はデスクトップ・スマホ・Stream Deck から再生／曲送り／タイミング／緊急非表示を操作します。
8. 配信後はセッションを保存し、セットリストと YouTube チャプターを出力します。

> 初回はテストセッションで「1 曲」を取り込み → 歌詞同期 → OBS 表示 → Twitch リクエストまで通してから本番へ。

### 機能

#### 取り込みと再生

- YouTube 単曲・プレイリストの音源、曲情報、カバー、歌詞の自動取得。
- アプリ内 YouTube 検索（YouTube Music を優先）。
- ローカル音源のドラッグ取り込み：MP3・FLAC・WAV・M4A・OGG。
- 取り込み前に長さ・種類・重複をチェック。
- ダウンロードキュー、バッチ処理、キャンセル、再試行、ジョブ状態管理。
- 曲ごとに ±12 半音のキー、0.5×–1.5× のテンポ、タイミングを保存（SoundTouch／WSOLA）。
- プレイリストの並べ替え、曲情報編集、リストの入出力。
- メディアライブラリが使用曲・再生回数・歌詞・タイミング・再生設定を記憶。
- 任意のラウドネス正規化（2 系統の再生チェーンを同時処理）。

#### 歌詞

- 複数ソース並行検索：BetterLyrics、Apple Music、Kugou、QQ Music、LRCLIB、NetEase ほか。自動選択・手動選択に対応。
- 単語同期・行同期・LRC・KRC・TTML・SRT・プレーンテキスト。
- タイムライン編集、「先頭行に合わせる」で全体シフト。
- 合唱パート解析（KTV の色分けに反映）。
- 歌詞ソースごとにタイミングを記憶。
- 日本語・韓国語のローマ字、中国語ピンイン、一部発音ヒント。
- 簡体字→繁体字の表示変換（ピンイン・元のタイミングは保持）。
- 制作クレジット・スタジオ名・版表記・入れ替わったタイトルの自動クリーニング。

#### OBS 動く歌詞

11 種類のテンプレート。フォント・サイズ・色・縁取り・不透明度・位置・間隔・整列・表示範囲・動きの強さを個別に保存し、名前付きプリセットも作成できます。

| テンプレート | ひとこと |
|---|---|
| クラシックオーバーレイ | 履歴行・ピンイン・発音ヒント対応の全体表示 |
| 星砂の流光 / 屈折の階段 / 潮汐の心景 | 単行フォーカスの 3 つの雰囲気 |
| ネオン KTV | 固定 2 行のカラオケ表示、間奏・エンディング文言をカスタム可 |
| 縦書き句流 | 左右に縦列が交錯、歌った行は残像を残す |
| ペーパーストリップ | 紙帯が展開してから 1 文字ずつ埋める（横／縦） |
| ミラー | 左に実体、右に中空の鏡像、中央は人物用に確保 |
| タイプライター | iMessage 風タイピング、長間奏にスタンプ |
| ライトボード | LED ドットマトリクス、歌った点は点灯、他は消灯 |
| 風が文字を結ぶ | 風に散った粒子が歌っている行へ集まる。字幕サイズ、縦組みや左右振り分けが可能 |

- 透明背景の Browser Source、設定変更を即時同期。
- 単語ハイライト、行切り替え、間奏カウントダウン、時計同期。
- 緊急非表示は Elitesand Pro の要素だけを隠し、シーン全体を黒く覆いません。
- ローカルフォントを直接読み込み（`.ttc` コレクション対応）。
- プロンプター歌詞にふりがなを付与可能。

#### セットリスト

- 歌った曲／再生中／次の曲がひと目で分かる。
- セッションを自動記録し、YouTube チャプターとして出力。
- 十数種類のレイアウト（定番情報、発車看板、手帳ページ、フィルムストリップ、ナイトネオン…）が OBS Browser Source のサイズに合わせて自動整形。
- 長い曲名・アーティスト名にも領域を確保。
- セッションの作成・保存・切り替え。

#### Twitch リクエスト

- Device Code Flow ログイン（Client Secret 不要）。
- Twitch の実際の配信開始時刻からセッションを自動生成。
- チャットコマンドと YouTube リンク解析。リクエストは承認待ちに入り、確認後にダウンロード。
- チャンネルポイントによるリクエスト（必須入力・完了・拒否・タイムアウト・自動返金）。
- 上限、曲の長さ、重複範囲、視聴者枠、公平セッション。
- 視聴者は自分で照会・キャンセル可能、モデレーターはチャットから管理。
- 成功／失敗／待機／拒否の返信をカスタム。
- 再接続、リクエスト永続化、アプリ再起動後の復元。

#### AI ボーカル分離（試験的・既定オフ）

- オフラインで伴奏のみ／ボーカルのみに分離（初回にモデルをダウンロード）。
- NVIDIA GPU は GPU 推論、それ以外は WebGPU エンジン、いずれも不可なら CPU にフォールバック（遅いが正直に表示）。
- ホームの「AI 伴奏」タブでセットリスト全体を一括処理。
- デュアル音声：伴奏を OBS、ボーカルを自分のモニターへ（逆も可）。

> 試験的機能です。本番配信の直前に初めて有効化しないでください。

#### 操作・安全・データ

- スマホリモコン：再生、曲送り、シーク、キー、歌詞ソース、テンプレート、プリセット。
- Stream Deck HTTP API：`/api/deck/:action`。
- 任意の PIN 保護（同一 LAN の誤操作対策、OBS 表示ソースは対象外）。
- 読み取り専用／読み書きの権限とリクエストサイズ制限。
- 状態のバージョン管理、破損バックアップ、復旧、移行、ロールバック。
- メディアはインストール先の隣の「Elitesand Pro Media」フォルダーに保存。アンインストールは既定でデータを保持し、完全削除も選べます。
- 詳細ログ、エラー案内、yt-dlp／FFmpeg のヘルスチェック。

#### 多言語 UI

繁体字中国語・英語・日本語・韓国語・簡体字中国語。主要操作、Twitch 状態、エラー、ライセンス手続き、数値書式を localize 済み。文字列が無い場合は繁体字中国語にフォールバック。

### インストール

[GitHub Releases](../../releases/latest) から Windows Installer をダウンロードし、Elitesand Pro を終了してからセットアップを実行します。インストールは per-user で、管理者権限は不要です。

現在の配布物は**コード署名されていない**ため、初回起動時に Windows SmartScreen の警告が表示されます：

1. 「**詳細情報**」をクリック
2. 「**実行**」をクリック

配布元は公式 GitHub Releases のみ。同梱の `.sha256` を照合してください：

```powershell
Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"
```

### OBS 設定

1. Elitesand Pro で「歌詞 URL」または「セットリスト URL」をコピー。
2. OBS に「ブラウザ」ソースを追加。
3. URL を貼り付け、サイズを設定（歌詞はキャンバスと同じ、例：1920×1080）。
4. 変更は即時同期。表示が古い場合はソースを右クリックしてキャッシュを更新。

| URL | 用途 |
|---|---|
| `/` | デスクトップ操作画面（スマホのブラウザは `/controller` に転送） |
| `/controller` | スマホリモコン |
| `/display` | 動く歌詞オーバーレイ |
| `/setlist` | セットリストオーバーレイ |

### アップデート

Elitesand Pro は**起動時にアップデートを確認**し、「接続とシステム → アップデートを確認」から手動でも確認できます。互換がある場合はアプリ内で差分アップデートを適用（ダウンロードとインストールの進行状況を表示）、互換が無い場合は GitHub Releases の完全版 Installer へ案内します。完全版を実行する前に Elitesand Pro を終了してください。

### プライバシー

Elitesand Pro はローカル優先です。既定でオン・設定でオフにできる匿名の貢献が 2 つあります：**コミュニティ歌詞オフセット共有**（他の人の対時作業を減らす）と**日次使用量集計**。いずれもセットリスト・メディア・個人識別情報を含まず、[EULA](EULA.txt) に明記されています。その他のアップロードは明示的なオプトインが必要です。

### ライセンス

Elitesand Pro はソース非公開のプロプライエタリソフトウェア（非オープンソース）で、[Elitesand Pro ライセンス](LICENSE)に従います：

- 個人・商用の配信／公演で**無料**。
- 非公開・非配布の個人改変は可。
- 原版または改変版、および本プロジェクト自身のソースコードの再配布には書面による許可が必要。
- 公式配布は上記の GitHub Releases のみ。

サードパーティコンポーネント（SoundTouch などの LGPL を含む）は各自のライセンスに従います — [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) を参照。楽曲・歌詞・カバー等の権利は本ライセンスの対象外です。

---

## 한국어

### 개요

Elitesand Pro는 **곡 가져오기, 가사 검색, 동기화 재생, OBS 동적 가사, 라이브 세트리스트, Twitch 신청곡**을 하나의 Windows 데스크톱 앱에 통합합니다.

모든 처리는 내 PC에서 이루어지며, OBS는 Browser Source로 투명한 가사·세트리스트를 불러옵니다. 데스크톱 콘솔·휴대폰 리모컨·OBS 소스는 실시간으로 동기화되어, 설정 하나만 바꿔도 셋이 동시에 갱신됩니다(URL 재입력 불필요).

### 빠른 시작

1. [GitHub Releases](../../releases/latest)에서 Windows Installer를 내려받고, 이전 버전을 종료한 뒤 설치합니다.
2. 앱을 실행하고 첫 실행 안내에 따라 yt-dlp, FFmpeg, 네트워크, 버전을 확인합니다.
3. YouTube 링크나 재생목록을 붙여넣거나 로컬 음원을 끌어다 놓고, 제목·아티스트·가사 소스를 확인합니다.
4. 가사 템플릿을 고르고 글꼴·색상·위치·모션·프리셋을 조정합니다.
5. **가사 URL**과 **세트리스트 URL**을 각각 별도의 OBS Browser Source에 추가합니다.
6. 시청자 신청곡이 필요하면 Twitch를 연결하고 채팅 명령 또는 채널 포인트 보상과 제한을 설정합니다.
7. 방송 중에는 데스크톱, 휴대폰, Stream Deck으로 재생·넘기기·타이밍·긴급 숨김을 제어합니다.
8. 방송 후 세션을 저장하고 세트리스트와 YouTube 챕터를 내보냅니다.

> 첫 방송 전에 테스트 세션에서 곡 하나를 가져오기 → 가사 동기화 → OBS 표시 → Twitch 신청곡까지 처음부터 끝까지 돌려 보세요.

### 기능

#### 가져오기와 재생

- YouTube 단일 영상·재생목록의 음원, 메타데이터, 커버, 가사 자동 가져오기.
- 앱 내 YouTube 검색(YouTube Music 우선).
- 로컬 음원 끌어다 놓기: MP3, FLAC, WAV, M4A, OGG.
- 가져오기 전 길이·유형·중복 검사.
- 다운로드 대기열, 배치 작업, 취소, 재시도, 작업 상태 관리.
- 곡별 ±12 반음 키, 0.5×–1.5× 속도, 타이밍 저장(SoundTouch/WSOLA).
- 재생목록 정렬, 곡 정보 편집, 목록 가져오기/내보내기.
- 미디어 라이브러리가 사용 곡, 재생 횟수, 가사, 타이밍, 재생 설정을 기억.
- 선택형 라우드니스 정규화(두 재생 체인 동시 처리).

#### 가사

- 다중 소스 병렬 검색: BetterLyrics, Apple Music, Kugou, QQ Music, LRCLIB, NetEase 등. 자동 선택·수동 선택 지원.
- 단어 동기화, 문장 동기화, LRC, KRC, TTML, SRT, 일반 텍스트.
- 타임라인 편집, "첫 줄 맞추기"로 전체 이동.
- 합창 파트 분석(KTV 색상에 반영).
- 가사 소스별 타이밍 기억.
- 일본어·한국어 로마자, 중국어 병음, 일부 발음 힌트.
- 간체→번체 표시 변환(병음·원본 타이밍 보존).
- 소스의 제작 크레딧, 스튜디오명, 버전 표기, 뒤바뀐 제목 자동 정리.

#### OBS 동적 가사

11가지 템플릿. 글꼴·크기·색상·외곽선·불투명도·위치·간격·정렬·표시 범위·모션 강도를 개별 저장하고 이름 있는 프리셋도 만들 수 있습니다.

| 템플릿 | 한 줄 |
|---|---|
| 클래식 오버레이 | 기록 줄·병음·발음 힌트 지원 전체 표시 |
| 스타더스트 펄스 / 굴절 계단 / 조수 심상 | 한 줄 집중형 세 가지 분위기 |
| 네온 KTV | 고정 2줄 노래방 화면, 간주·엔딩 문구 커스텀 |
| 세로쓰기 문장 흐름 | 좌우 세로 열이 교차, 부른 줄은 잔상 |
| 페이퍼 스트립 | 종이 띠가 펼쳐진 뒤 한 글자씩 채움(가로/세로) |
| 미러 | 왼쪽은 실체, 오른쪽은 속 빈 거울상, 가운데는 인물용 |
| 타자기 | iMessage 스타일 타이핑, 긴 간주에 스티커 |
| 라이트보드 | LED 도트 매트릭스, 부른 점은 켜지고 나머지는 꺼짐 |
| 바람 입자 글자 | 바람에 흩어진 입자가 부르는 줄로 모임; 자막 크기, 세로쓰기 또는 좌우 분산 |

- 투명 배경 Browser Source, 설정 변경 즉시 동기화.
- 단어 하이라이트, 줄 전환, 간주 카운트다운, 시계 동기화.
- 긴급 숨김은 Elitesand Pro 요소만 숨기며 장면 전체를 가리지 않습니다.
- 로컬 글꼴 파일 직접 로드(`.ttc` 컬렉션 지원).
- 프롬프터 가사에 후리가나 표시 가능.

#### 라이브 세트리스트

- 부른 곡 / 재생 중 / 다음 곡을 한눈에.
- 세션 자동 기록, YouTube 챕터로 내보내기.
- 십여 가지 레이아웃(클래식 정보, 출발 안내판, 다이어리 페이지, 필름 스트립, 나이트 네온…)이 OBS Browser Source 크기에 맞춰 자동 배치.
- 긴 제목·아티스트명에도 공간 확보.
- 세션 생성·저장·전환.

#### Twitch 신청곡

- Device Code Flow 로그인(Client Secret 불필요).
- Twitch 실제 방송 시작 시각으로 세션 자동 생성.
- 채팅 명령과 YouTube 링크 파싱. 신청은 승인 대기로 들어가고 확인 후 다운로드.
- 채널 포인트 신청곡(필수 입력, 완료, 거절, 시간 초과, 자동 환불).
- 상한, 곡 길이, 중복 범위, 시청자 한도, 공정 세션.
- 시청자는 직접 조회·취소, 모더레이터는 채팅에서 관리.
- 성공/실패/대기/거절 응답 커스텀.
- 재연결, 신청 영속화, 앱 재시작 후 복구.

#### AI 보컬 분리(실험적, 기본 꺼짐)

- 오프라인으로 반주 전용/보컬 전용 분리(최초 사용 시 모델 다운로드).
- NVIDIA GPU는 GPU 추론, 그 외에는 WebGPU 엔진, 둘 다 안 되면 CPU로 폴백(느리지만 정직하게 표시).
- 홈 "AI 반주" 탭에서 세트리스트 전체를 한 번에 처리.
- 듀얼 오디오: 반주는 OBS로, 보컬은 내 모니터로(반대도 가능).

> 실험적 기능입니다. 실제 방송 직전에 처음 켜지 마세요.

#### 제어·보안·데이터

- 휴대폰 리모컨: 재생, 넘기기, 탐색, 키, 가사 소스, 템플릿, 프리셋.
- Stream Deck HTTP API: `/api/deck/:action`.
- 선택형 PIN 보호(같은 LAN의 오조작 방지, OBS 표시 소스는 예외).
- 읽기 전용/읽기 쓰기 권한과 요청 크기 제한.
- 상태 버전 관리, 손상 백업, 복구, 마이그레이션, 롤백.
- 미디어는 설치 위치 옆 "Elitesand Pro Media" 폴더에 저장. 제거 시 기본적으로 데이터 유지, 완전 삭제도 선택 가능.
- 상세 로그, 오류 안내, yt-dlp/FFmpeg 상태 점검.

#### 다국어 UI

번체 중국어, 영어, 일본어, 한국어, 간체 중국어. 주요 조작, Twitch 상태, 오류 메시지, 라이선스 절차, 숫자 형식이 현지화되어 있으며 문자열이 없으면 번체 중국어로 폴백합니다.

### 설치

[GitHub Releases](../../releases/latest)에서 Windows Installer를 내려받고 Elitesand Pro를 종료한 뒤 설치 마법사를 실행합니다. 설치는 per-user이며 관리자 권한이 필요 없습니다.

현재 배포 파일은 **코드 서명이 없어** 첫 실행 시 Windows SmartScreen 경고가 표시됩니다:

1. **추가 정보** 클릭
2. **실행** 클릭

공식 GitHub Releases에서만 내려받고 동봉된 `.sha256`을 확인하세요:

```powershell
Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"
```

### OBS 설정

1. Elitesand Pro에서 가사 URL 또는 세트리스트 URL을 복사합니다.
2. OBS에 **브라우저** 소스를 추가합니다.
3. URL을 붙여넣고 크기를 설정합니다(가사는 보통 캔버스와 동일, 예: 1920×1080).
4. 변경은 즉시 동기화됩니다. 화면이 오래된 경우 소스를 우클릭해 캐시를 새로 고칩니다.

| URL | 용도 |
|---|---|
| `/` | 데스크톱 제어판(모바일 브라우저는 `/controller`로 이동) |
| `/controller` | 휴대폰 리모컨 |
| `/display` | 동적 가사 오버레이 |
| `/setlist` | 라이브 세트리스트 오버레이 |

### 업데이트

Elitesand Pro는 **시작할 때 업데이트를 확인**하며 "연결 및 시스템 → 업데이트 확인"에서 수동으로도 확인할 수 있습니다. 호환되면 앱 내에서 증분 업데이트를 적용하고(다운로드·설치 진행률 표시), 호환되지 않으면 GitHub Releases의 전체 Installer로 안내합니다. 전체 버전을 실행하기 전에 Elitesand Pro를 종료하세요.

### 개인정보

Elitesand Pro는 로컬 우선입니다. 기본으로 켜져 있고 설정에서 끌 수 있는 익명 기여가 두 가지 있습니다: **커뮤니티 가사 오프셋 공유**(다른 사람의 싱크 작업을 줄임)와 **일일 사용량 집계**. 둘 다 세트리스트, 미디어, 개인 식별 정보를 포함하지 않으며 [EULA](EULA.txt)에 명시되어 있습니다. 그 밖의 업로드는 명시적 옵트인이 필요합니다.

### 라이선스

Elitesand Pro는 소스 비공개 독점 소프트웨어(비오픈소스)로 [Elitesand Pro 라이선스](LICENSE)를 따릅니다:

- 개인 및 상업 방송·공연에 **무료**.
- 비공개·비배포 개인 수정 허용.
- 원본 또는 수정본, 그리고 이 프로젝트 자체의 소스 코드 재배포에는 서면 허가 필요.
- 공식 배포는 위 GitHub Releases로만.

서드파티 구성 요소(SoundTouch 등 LGPL 포함)는 각자의 라이선스를 따릅니다 — [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) 참고. 곡, 가사, 커버 등 미디어 권리는 이 라이선스에 포함되지 않습니다.

---

## 简体中文

### 这是什么

Elitesand Pro 把**歌曲导入、歌词搜索、同步播放、OBS 动态歌词、直播歌单、Twitch 点歌**整合进同一个 Windows 桌面程序。

程序在你自己的电脑上运行，OBS 通过 Browser Source 加载透明的歌词与歌单画面。桌面控制台、手机遥控器与 OBS 显示来源之间实时同步——改一个设置，三边同时更新，无需重新粘贴网址。

### 快速开始

1. 从 [GitHub Releases](../../releases/latest) 下载 Windows Installer，关闭旧版后运行安装。
2. 启动程序，按首次使用引导完成 yt-dlp、FFmpeg、网络与版本检查。
3. 粘贴 YouTube 链接、播放列表或拖入本地音频，确认歌名、歌手与歌词来源。
4. 选一个歌词模板，调字体、颜色、位置、动画与预设。
5. 复制「歌词网址」与「歌单网址」，分别粘贴进两个 OBS Browser Source。
6. 需要观众点歌时连接 Twitch，设置聊天室指令或忠诚点数奖励与限制。
7. 直播中用桌面控制台、手机遥控器或 Stream Deck 控制播放、切歌、时间偏移与紧急隐藏。
8. 收播后保存场次、导出歌单，一键复制整场的 YouTube 章节时间戳。

> 第一次使用，建议先用测试场景把「一首歌」的导入 → 歌词同步 → OBS 显示 → Twitch 点歌整条流程走一遍，再上正式直播。

### 功能

#### 导入与播放

- YouTube 单曲与播放列表：自动下载音频、识别歌手／歌名、搜索歌词、抓封面。
- 程序内 YouTube 搜索，优先匹配 YouTube Music。
- 本地音频拖放导入：MP3、FLAC、WAV、M4A、OGG。
- 导入前检查时长、类型与重复项。
- 单一下载队列、批量作业、取消、重试与作业状态管理。
- 每首歌独立保存 ±12 半音变调、0.5×–1.5× 变速与时间偏移，内置 SoundTouch／WSOLA。
- 播放列表拖拽排序、歌曲信息编辑、列表导入／导出。
- 媒体库自动记住用过的歌曲、播放次数、歌词、对时与播放设置。
- 可选「统一音量」：两条播放链一起做响度标准化。

#### 歌词

- 多来源并行搜索：BetterLyrics、Apple Music、酷狗、QQ音乐、LRCLIB、网易云等，自动挑最佳、也可手选。
- 支持逐字、逐句、LRC、KRC、TTML、SRT 与纯文本。
- 逐行时间轴编辑器，一键「对齐第一句」整体平移。
- 合唱声部解析，KTV 模板据此自动上色。
- 每个歌词来源各自记住时间偏移，换来源不用重新对时。
- 日文／韩文罗马音、中文拼音与部分谐音显示。
- 对时歌词自动简转繁，不破坏拼音与原始时间数据。
- 自动清洗来源里的制作名单、工作室名称、版本注记与错置标题。

#### OBS 动态歌词

十一种演出模板，各自独立保存字体／字级／颜色／描边／透明度、位置／间距／对齐／显示范围、动画强度与具名预设：

| 模板 | 一句话 |
|---|---|
| 经典叠层 | 完整歌词画面，支持历史行、拼音与谐音 |
| 星砂流光 / 折光阶梯 / 潮汐心景 | 单句聚焦的三种节奏与氛围 |
| 霓彩伴唱 | 固定双行伴唱画面，间奏与结尾可自定义字样 |
| 竖排句流 | 竖行两侧错落，唱过留残影，可选四相漂字进场 |
| 纸带逐字 | 纸带展开后逐字填入，横式或竖式 |
| 虚实镜书 | 左实心、右镜像空心，中央保留人物空间 |
| 对话气泡 | iMessage 风逐字打字，长间奏跳贴图 |
| 跑马灯牌 | LED 点阵灯牌，唱过的灯亮、没唱的暗 |
| 风息成字 | 粒子随风散开，再聚成正在唱的字；字幕尺度，可竖排或左右分散 |

- OBS 透明背景 Browser Source，改设置即时同步。
- 逐字扫光、逐句切换、间奏倒计时与时钟同步。
- 紧急隐藏只藏 Elitesand Pro 自己的元素，不会用黑幕盖掉整个直播画面。
- 本地字体可直接加载使用，支持 `.ttc` 集合字体。
- 提词机歌词可加日文假名注音。

#### 直播歌单

- 已唱／正在唱／接下来，一目了然。
- 自动记录场次歌曲与时间戳，可复制成 YouTube 章节。
- 十余种版型（经典信息、发车看板、手账页、底片边条、夜间霓虹…），依 OBS Browser Source 尺寸自动排版。
- 长歌名与长歌手名自动分配空间，重要信息不被挤掉。
- 可创建、保存与切换不同直播场次。

#### Twitch 点歌

- Device Code Flow 登录，不需要 Client Secret。
- 依 Twitch 实际开播时间自动创建场次。
- 聊天室指令与 YouTube 链接解析；点歌先进待确认区，主播确认后才下载，不直接污染正式歌单。
- 忠诚点数兑换点歌，含必填文字、完成、拒绝、超时与自动退款。
- 点歌上限、歌曲长度、重复范围、用户名额与公平工作阶段。
- 观众可自助查询与取消，管理员可通过聊天室管理。
- 自定义成功／失败／等待／拒绝回复。
- 断线重连、请求持久化、程序重启后恢复。

#### AI 人声分离（实验性，默认关闭）

- 离线把歌曲分成纯伴奏与纯人声，第一次使用会下载模型。
- NVIDIA 显卡走 GPU 推理；非 NVIDIA 走 WebGPU 引擎；都不行时降级 CPU（较慢，但不会假装很快）。
- 首页「AI 伴奏」分页可一次把整份歌单做成纯伴奏。
- 双路音频：伴奏给 OBS、人声留给自己监听，或反过来。

> 实验性功能，不建议在正式直播前才第一次启用。

#### 控制、安全与数据

- 手机遥控器：播放、切歌、进度、变调、歌词来源、模板与预设。
- Stream Deck HTTP API：`/api/deck/:action`。
- 可选 PIN 保护，避免同局域网设备误触；OBS 显示来源不受影响。
- 只读／可写权限与请求大小限制。
- 状态版本化、损坏自动备份、恢复、数据迁移与回滚。
- 媒体文件存在安装位置旁的「Elitesand Pro Media」文件夹；卸载默认保留数据，另提供完整清除。
- 详细日志、错误提示、yt-dlp／FFmpeg 健康检查。

#### 多语言界面

繁体中文、English、日本語、한국어、简体中文。桌面操作、Twitch 状态、错误消息、授权流程与数字格式皆已本地化，缺字符串时回退繁体中文。

### 安装

从 [GitHub Releases](../../releases/latest) 下载 Windows Installer，关闭 Elitesand Pro 后运行安装向导。安装为 per-user，不需要管理员权限。

安装包目前**未做商业代码签名**，Windows SmartScreen 首次运行会显示蓝色警告：

1. 点警告窗口的「**更多信息**」
2. 再点「**仍要运行**」

请只从官方 GitHub Releases 下载，并核对随附的 `.sha256`：

```powershell
Get-FileHash -Algorithm SHA256 "Elitesand Pro Setup 1.0.0.exe"
```

### OBS 设置

1. 在 Elitesand Pro 复制「歌词网址」或「歌单网址」。
2. OBS 新增「浏览器」来源。
3. 粘贴网址，设置尺寸（歌词建议用直播画布尺寸，例如 1920×1080）。
4. 设置改动即时同步；若 OBS 仍是旧画面，对来源右键「刷新缓存」。

| 网址 | 用途 |
|---|---|
| `/` | 桌面控制面板（手机浏览器会自动跳转 `/controller`） |
| `/controller` | 手机遥控器 |
| `/display` | OBS 动态歌词 |
| `/setlist` | OBS 直播歌单 |

### 更新

Elitesand Pro 会在**启动时检查更新**，也可在「连接与系统 → 检查更新」手动检查。兼容时可直接在程序内应用增量更新（会显示下载与安装进度）；不兼容时引导你到 GitHub Releases 下载完整 Installer。安装完整版前请关闭 Elitesand Pro。

### 隐私

Elitesand Pro 以本地优先。两项默认开启、可在设置关闭的匿名反馈：**社区歌词偏移分享**（帮助其他人少对一次时）与**每日用量汇总**。两者皆不含歌单、媒体或个人识别数据，并在 [EULA](EULA.txt) 明列。其余任何上传都需要你明确开启。

### 授权

Elitesand Pro 是源代码不公开的专有软件（proprietary，非开源），采用 [Elitesand Pro 授权条款](LICENSE)：

- 可**免费**用于个人与商业直播／演出。
- 允许私人、不对外分发的自用修改。
- 未经书面同意，不得重新分发原版或修改版，也不得分发本项目自有的源代码。
- 官方发布一律只通过本页的 GitHub Releases。

第三方组件（含 SoundTouch 等 LGPL 组件）依其原授权使用，不受上述限制约束，详见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。歌曲、歌词、封面及其他媒体的权利不包含在本项目授权内。
