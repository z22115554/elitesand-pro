'use strict';

// The 2026 campaigns are permanently retired. Keep their archived modules and
// user data for inspection, but do not load their stores, timers or UI at boot.
function retiredEvent(endsAt) {
  return Object.freeze({ isActive: () => false, snapshot: () => ({ endsAt, donations: [] }) });
}
const moonEvent = retiredEvent('2026-09-30T16:00:00.000Z');
const halloweenEvent = retiredEvent('2026-11-07T16:00:00.000Z');

function registerEnded(prefix, names) {
  return (_io, socket) => {
    if (socket.clientType !== 'controller') return;
    for (const name of names) {
      socket.on(`${prefix}:${name}`, (_data, ack) => {
        if (typeof ack === 'function') ack({ ok: false, inactive: true });
      });
    }
  };
}
const base = ['get', 'config', 'donate', 'edit', 'remove', 'clear', 'credits', 'celebrate'];
const registerMoonEventHandlers = registerEnded('moon', base);
const registerHalloweenEventHandlers = registerEnded('halloween', [...base,
  'fx:get', 'fx:settings', 'fx:reset', 'raffle:draw', 'raffle:clear',
  'cauldron:get', 'cauldron:settings', 'cauldron:brew', 'cauldron:reset', 'cauldron:potion',
  'cauldron:clear-votes', 'cauldron:sync', 'cauldron:remove-rewards',
]);

module.exports = { moonEvent, halloweenEvent, registerMoonEventHandlers, registerHalloweenEventHandlers };
