'use strict';
const { getPracticeHistoryService, PracticeHistoryError } = require('../services/practice-history');
function createPracticeFeedbackRouter(options = {}) {
  const express = options.express || require('express');
  const router = express.Router();
  let instance = options.historyService;
  const service = new Proxy({}, { get(_target, method) { return (...args) => {
    instance ||= getPracticeHistoryService(); return instance[method](...args);
  }; } });
  const requirePin = options.requirePin || require('../middleware/require-pin');
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const handle = operation => (req, res) => {
    try { res.json({ ok: true, ...operation(req) }); }
    catch (error) { const known = error instanceof PracticeHistoryError;
      res.status(known ? error.status : 500).json({ ok: false, code: known ? error.code : 'PRACTICE_HISTORY_FAILED', error: known ? error.message : '練唱紀錄處理失敗。' }); }
  };
  router.get('/takes', requirePin, handle(req => service.list(req.query.trackId)));
  router.get('/takes/:id', requirePin, handle(req => service.get(req.params.id)));
  router.post('/takes', requirePin, handle(req => service.save(req.body)));
  router.delete('/takes/:id', requirePin, handle(req => service.remove(req.params.id)));
  router.get('/challenge-settings', requirePin, handle(() => service.getSettings()));
  router.patch('/challenge-settings', requirePin, handle(req => service.updateSettings(req.body)));
  router.get('/challenges', requirePin, handle(req => service.getChallenge(req.query.trackId)));
  router.post('/challenges', requirePin, handle(req => service.createChallenge(req.body)));
  router.delete('/challenges/:id', requirePin, handle(req => service.clearChallenge(req.params.id)));
  router.historyService = service;
  return router;
}
module.exports = { createPracticeFeedbackRouter };
