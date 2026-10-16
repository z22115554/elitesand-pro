'use strict';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const REMIND_THREE_DAYS = 'remind-three-days';

// Closing the dialog is the same as Later: no persisted reminder deadline.
function optionalUpdateChoice(response) {
  if (response === 0) return 'accept';
  return response === 2 ? REMIND_THREE_DAYS : 'defer';
}

function recordUpdateReminder({ choice, targetVersion, deferStore, nowMs = Date.now() }) {
  if (choice === REMIND_THREE_DAYS) {
    return deferStore?.setDeferUntil?.(targetVersion, nowMs + THREE_DAYS_MS) ?? false;
  }
  return deferStore?.clearDefer?.(targetVersion) ?? false;
}

module.exports = { THREE_DAYS_MS, REMIND_THREE_DAYS, optionalUpdateChoice, recordUpdateReminder };
