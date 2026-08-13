/**
 * HTTP 端的 PIN 保護 middleware。
 *
 * 只套用在「會改動狀態／觸發下載處理」的路由（上傳、YouTube 匯入、歌詞搜尋/貼上、
 * Stream Deck 指令）。刻意不做成全域 /api/* 攔截：封面圖／字體清單／健康檢查等
 * 唯讀端點若被擋，<img src>／<audio src> 這類原生請求無法附加自訂標頭會直接壞掉。
 *
 * PIN 可用 HTTP Header `X-Pin`、query string `?pin=`、或 body.pin 三種方式提供
 * （query 版本是特意留給 Stream Deck「開啟網址」這種無法自訂標頭的呼叫方式用）。
 * 未設定 PIN 時完全不擋，行為與加這個功能前一致。
 */

const authStore = require('../services/auth-store');
const rateLimiter = require('../services/auth-rate-limiter');

function requirePin(req, res, next) {
  if (!authStore.hasPin()) return next();
  const key = `protected:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  const limit = rateLimiter.status(key);
  if (!limit.allowed) {
    res.set('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
    return res.status(429).json({ error: 'PIN 嘗試次數過多，請稍後再試', code: 'PIN_RATE_LIMITED' });
  }
  const pin = req.headers['x-pin'] || req.query.pin || (req.body && req.body.pin);
  if (authStore.verifyPin(pin)) { rateLimiter.reset(key); return next(); }
  rateLimiter.recordFailure(key);
  res.status(401).json({ error: '需要正確的 PIN 才能執行此操作', code: 'PIN_REQUIRED' });
}

module.exports = requirePin;
