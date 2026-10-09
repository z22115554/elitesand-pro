/**
 * 中秋募資活動 socket 事件（moon:*），邏輯在 handlers/seasonal-event.js。
 */
const moonEvent = require('../../services/moon-event');
const { createSeasonalEventHandlers } = require('./seasonal-event');

module.exports = createSeasonalEventHandlers({ prefix: 'moon', service: moonEvent, endedError: '中秋活動已結束' });
