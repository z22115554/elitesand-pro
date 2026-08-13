/**
 * PIN 存取控制的登入/管理端點。
 * 刻意不套用 require-pin middleware（這裡本身就是登入/改密碼流程）。
 */
const express = require('express');
const router = express.Router();
const authStore = require('../services/auth-store');
const rateLimiter = require('../services/auth-rate-limiter');
const { createLogger } = require('../utils/logger');

const log = createLogger('Auth');

function clientKey(req) {
  return `http:${req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'}`;
}

function rejectIfLimited(req, res) {
  const result = rateLimiter.status(clientKey(req));
  if (result.allowed) return false;
  res.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  res.status(429).json({ ok: false, message: 'PIN 嘗試次數過多，請稍後再試' });
  return true;
}

function recordAuthResult(req, ok) {
  if (ok) rateLimiter.reset(clientKey(req));
  else rateLimiter.recordFailure(clientKey(req));
}

// 讓前端知道要不要顯示 PIN 輸入框
router.get('/status', (req, res) => {
  res.json({ hasPin: authStore.hasPin() });
});

// 驗證 PIN（用於：面板/遙控器連線前的登入 modal）
router.post('/verify', (req, res) => {
  if (rejectIfLimited(req, res)) return;
  const { pin } = req.body || {};
  if (authStore.verifyPin(pin)) {
    recordAuthResult(req, true);
    res.json({ ok: true });
  } else {
    recordAuthResult(req, false);
    res.status(401).json({ ok: false, message: 'PIN 不正確' });
  }
});

// 設定或更改 PIN。首次設定 currentPin 可留空；已有 PIN 時必須帶對的 currentPin。
router.post('/set', (req, res) => {
  if (rejectIfLimited(req, res)) return;
  const { newPin, currentPin } = req.body || {};
  const result = authStore.setPin(newPin, currentPin);
  if (result.ok) {
    recordAuthResult(req, true);
    log.info('PIN 設定/更新成功');
    res.json(result);
  } else {
    if (authStore.hasPin()) recordAuthResult(req, false);
    res.status(400).json(result);
  }
});

// 關閉 PIN 保護（需先驗證目前的 PIN）
router.post('/clear', (req, res) => {
  if (rejectIfLimited(req, res)) return;
  const { currentPin } = req.body || {};
  const result = authStore.clearPin(currentPin);
  if (result.ok) {
    recordAuthResult(req, true);
    log.info('PIN 保護已停用');
    res.json(result);
  } else {
    recordAuthResult(req, false);
    res.status(400).json(result);
  }
});

module.exports = router;
