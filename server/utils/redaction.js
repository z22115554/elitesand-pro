'use strict';

/**
 * 敏感資料清理 — 診斷包與問題回報共用的唯一實作。
 *
 * 原本只存在於 services/diagnostic-bundle.js；問題回報（server/services/feedback-report.js）
 * 需要同一套規則，所以抽到這裡。**不要再寫第二份 redactor**：兩邊規則一旦分岔，
 * 就會出現「診斷包乾淨但回報外洩」這種最難發現的情況。
 *
 * 設計取捨（改規則前先讀）：
 * - 清理不足會外洩，過度清理會讓回報變成沒有情報價值的一堆 [redacted]。所以每條規則
 *   都要有對應的「反向測試」：一般歌名、YouTube 網址、yt-dlp 錯誤訊息不得被吃掉。
 * - 路徑分三種處理：系統目錄（Program Files／Windows）本身不是隱私，原樣保留；
 *   使用者家目錄換成 %USERPROFILE%，保留 AppData 之後的結構供除錯；其餘磁碟路徑
 *   （例如使用者自己命名的專案資料夾）才整段換掉。
 * - 路徑比對只吃到空白為止，不再像舊版那樣吃掉整行——否則
 *   「failed to read C:\a\b.mp3 because ENOENT」會連錯誤原因一起消失。
 */

// 已知的系統目錄：出現在日誌裡不構成隱私，保留原樣才看得出是哪種安裝環境。
const SYSTEM_PATH_PREFIXES = [
  /[A-Za-z]:[\\/]Program Files \(x86\)[\\/]/gi,
  /[A-Za-z]:[\\/]Program Files[\\/]/gi,
  /[A-Za-z]:[\\/]Windows[\\/]/gi,
];
const SYSTEM_PATH_PLACEHOLDER = '\u0000SYSPATH';

// query string 中會帶憑證的參數名。刻意不含 v/list/t/index 等 YouTube 一般參數。
const SENSITIVE_QUERY_KEYS = 'access_token|refresh_token|id_token|token|api_?key|apikey|client_secret|secret|password|passwd|pwd|pin|auth|session|signature|sig|code';

function redactDiagnosticText(value) {
  let text = String(value == null ? '' : value);

  // ─── 憑證 ───
  text = text
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [redacted]')
    // 值的字元集刻意排除 &，否則 "access_token=x&page=2" 會連後面的參數一起吃掉。
    .replace(/((?:access|refresh|id)_?token["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[redacted]')
    // 負向前瞻讓 "Authorization: Bearer xxx" 交給上一條處理，不會被重複改寫成 Authorization=[redacted] [redacted]
    .replace(/\b(client_secret|authorization|password|passwd|pwd|api[_-]?key)\s*[:=]\s*["']?(?!Bearer\b|OAuth\b|\[redacted)[^\s,"'}&]+/gi, '$1=[redacted]')
    .replace(/\bPIN\s*[:=]\s*\d+/gi, 'PIN: [redacted]')
    // JWT：三段 base64url。以 eyJ 開頭（'{"' 的 base64），一般文字不會誤中。
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-jwt]')
    // Cookie／Set-Cookie 整行值
    .replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi, '$1: [redacted]')
    // Twitch 已授權頻道（頻道名等同使用者身分）
    .replace(/(Twitch\s+\u5DF2\u6388\u6B0A\u983B\u9053[\uFF1A:]\s*)[^\r\n]+/g, '$1[redacted]');

  // ─── URL query 中的憑證 ───
  // 只換值不換整個網址，才看得出是打到哪個服務出問題。
  text = text.replace(
    new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS})=)[^&\\s"']+`, 'gi'),
    '$1[redacted]'
  );

  // ─── email ───
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]');

  // ─── 路徑 ───
  // 先把系統目錄藏起來，避免被後面的通用規則吃掉。
  const systemPaths = [];
  SYSTEM_PATH_PREFIXES.forEach((pattern) => {
    text = text.replace(pattern, (match) => {
      systemPaths.push(match);
      return `${SYSTEM_PATH_PLACEHOLDER}${systemPaths.length - 1}\u0000`;
    });
  });
  // 使用者家目錄：保留家目錄之後的結構（AppData\Roaming\Elitesand Pro\... 是有用的除錯資訊）
  text = text.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\r\n]+/gi, '%USERPROFILE%');
  // 其餘磁碟路徑：使用者可能用個人化名稱命名資料夾，整段換掉，但只吃到空白為止。
  text = text.replace(/\b[A-Za-z]:[\\/][^\s"'<>|]*/g, '[local-path]');
  text = text.replace(
    new RegExp(`${SYSTEM_PATH_PLACEHOLDER}(\\d+)\\u0000`, 'g'),
    (_match, index) => systemPaths[Number(index)]
  );

  return text;
}

function redactValue(value, depth = 0) {
  if (depth > 8) return '[omitted]';
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:token|secret|authorization|password|passwd|pwd|pin|cookie|api[_-]?key)/i.test(key)
        ? '[redacted]'
        : redactValue(item, depth + 1),
    ]));
  }
  return value;
}

module.exports = { redactDiagnosticText, redactValue };
