'use strict';

const path = require('path');
const { createJsonStore } = require('./json-store');
const { dataDir } = require('../utils/app-paths');

module.exports = createJsonStore({
  file: path.join(dataDir, 'twitch-refund-retries.json'),
  label: 'Twitch 退款重試',
  defaultValue: () => [],
  serialize: (refunds) => ({ refunds }),
  deserialize: (document) => document.refunds,
  validate: (document) => Array.isArray(document.refunds)
    && document.refunds.every((item) => item?.redemption?.id && item.redemption.rewardId),
});
