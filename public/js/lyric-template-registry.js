/**
 * Elitesand Pro 歌詞排版模板註冊表 (Template Registry)
 *
 * 「排版模板」是獨立於「動畫風格」(styles.js/StylePresets) 的另一個維度：
 * 風格＝進出場的手感（彈跳/搖滾/柔美…），模板＝畫面的版面配置（經典疊層/海報捲軸…）。
 *
 * 新增模板只需呼叫 LyricTemplates.register({...})，karaoke.js 透過 setTemplate() 切換。
 * 每個模板實作以下生命週期方法（皆為選填，缺少的方法視為無操作）：
 *
 *   id            - 模板識別字（唯一）
 *   label         - 顯示名稱（面板 UI 用）
 *   mount(containerEl, ctx)   - 一次性建立自己的 DOM，掛進 containerEl
 *   destroy()                - 清空自己的 DOM、殺掉自己名下的 tween/spring
 *   onLyricsLoaded(parsedLyrics, ctx) - 新歌詞載入時
 *   onLineChange(prevIndex, newIndex, ctx) - 換行（離散事件）：進出場編排
 *   onFrame(adjustedTimeMs, ctx)           - 每幀（連續）：填色/彈簧/發光
 *   onSeek(timeMs, ctx)                    - 倒帶/大跳轉：重置畫面到指定時間
 *   onSettings(settings, ctx)              - lyricSettings 有更新時（可選）
 *
 * ctx 由 karaoke.js 在呼叫時提供，內容見 karaoke.js 的 buildTemplateContext()。
 */
const LyricTemplates = (() => {
  const registry = new Map();
  const DEFAULT_ID = 'classic';

  function register(template) {
    if (!template || !template.id) {
      console.warn('[LyricTemplates] 註冊模板缺少 id');
      return;
    }
    registry.set(template.id, template);
  }

  function get(id) {
    return registry.get(id) || registry.get(DEFAULT_ID) || null;
  }

  function list() {
    return Array.from(registry.values()).map((t) => ({ id: t.id, label: t.label || t.id }));
  }

  function has(id) {
    return registry.has(id);
  }

  return {
    register,
    get,
    list,
    has,
    DEFAULT: DEFAULT_ID,
  };
})();
