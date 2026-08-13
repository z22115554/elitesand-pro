'use strict';

// Socket.IO broadcasts are split after a client has declared its fixed access
// role. The fallback keeps small unit-test doubles (which only implement
// io.emit) compatible while production Socket.IO receives the scoped event.
const CONTROL_ROOM = 'access:control';
const READ_ONLY_ROOM = 'access:read-only';

function emitToControlClients(io, event, payload) {
  if (io && typeof io.to === 'function') {
    io.to(CONTROL_ROOM).emit(event, payload);
    return;
  }
  io.emit(event, payload);
}

function emitToAccessRooms(io, event, controlPayload, readOnlyPayload) {
  if (io && typeof io.to === 'function') {
    io.to(CONTROL_ROOM).emit(event, controlPayload);
    io.to(READ_ONLY_ROOM).emit(event, readOnlyPayload);
    return;
  }
  io.emit(event, controlPayload);
}

module.exports = { CONTROL_ROOM, READ_ONLY_ROOM, emitToControlClients, emitToAccessRooms };
