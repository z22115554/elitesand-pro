'use strict';

// Live reliability evidence is intentionally memory-only.  It records connection
// timing and counts, never song metadata, request text, client addresses, socket
// ids, credentials, or any other stream content.  A user may reset it before a
// broadcast and choose to include the resulting summary in a diagnostic export.

const TRACKED_CLIENT_TYPES = Object.freeze(['controller', 'remote', 'display', 'setlist']);
const OBS_CLIENT_TYPES = new Set(['display', 'setlist']);

function emptyRole() {
  return {
    connections: 0,
    reconnects: 0,
    disconnects: 0,
    completedConnectedMs: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
  };
}

function createRuntimeEvidence({ now = () => Date.now() } = {}) {
  const sockets = new Map();
  let startedAt = now();
  let roles = Object.fromEntries(TRACKED_CLIENT_TYPES.map((type) => [type, emptyRole()]));
  let obs = {
    displaySeen: false,
    setlistSeen: false,
    bothSourcesSeen: false,
    bothSourcesConnectedAt: null,
    completedBothSourcesMs: 0,
    interruptions: 0,
    lastInterruptedAt: null,
  };
  let twitch = {
    observed: false,
    configured: false,
    authorized: false,
    connected: false,
    connections: 0,
    reconnects: 0,
    disconnects: 0,
    completedConnectedMs: 0,
    connectedAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    connectionState: 'unknown',
    subscriptionState: 'unknown',
  };

  function activeCount(type) {
    let count = 0;
    for (const socket of sockets.values()) if (socket.clientType === type) count += 1;
    return count;
  }

  function reconcileObsPair(timestamp) {
    const bothConnected = activeCount('display') > 0 && activeCount('setlist') > 0;
    if (bothConnected && obs.bothSourcesConnectedAt == null) {
      obs.bothSourcesConnectedAt = timestamp;
      obs.bothSourcesSeen = true;
    } else if (!bothConnected && obs.bothSourcesConnectedAt != null) {
      obs.completedBothSourcesMs += Math.max(0, timestamp - obs.bothSourcesConnectedAt);
      obs.bothSourcesConnectedAt = null;
      obs.interruptions += 1;
      obs.lastInterruptedAt = timestamp;
    }
  }

  function recordSocketConnected({ socketId, clientType, timestamp = now() } = {}) {
    if (!TRACKED_CLIENT_TYPES.includes(clientType) || !socketId || sockets.has(socketId)) return false;
    const role = roles[clientType];
    // A second simultaneously connected controller/remote is not a reconnect.
    // Count a reconnect only after that role has actually disconnected at least once.
    role.reconnects += role.disconnects > 0 ? 1 : 0;
    role.connections += 1;
    role.lastConnectedAt = timestamp;
    sockets.set(socketId, { clientType, connectedAt: timestamp });
    if (OBS_CLIENT_TYPES.has(clientType)) obs[`${clientType}Seen`] = true;
    reconcileObsPair(timestamp);
    return true;
  }

  function recordSocketDisconnected({ socketId, timestamp = now() } = {}) {
    const socket = sockets.get(socketId);
    if (!socket) return false;
    sockets.delete(socketId);
    const role = roles[socket.clientType];
    role.disconnects += 1;
    role.completedConnectedMs += Math.max(0, timestamp - socket.connectedAt);
    role.lastDisconnectedAt = timestamp;
    reconcileObsPair(timestamp);
    return true;
  }

  function recordTwitchStatus(status = {}, timestamp = now()) {
    const connected = !!status.connected;
    const wasConnected = twitch.connected;
    twitch.observed = true;
    twitch.configured = !!status.configured;
    twitch.authorized = !!status.authorized;
    twitch.connectionState = String(status.connectionState || 'unknown').slice(0, 64);
    twitch.subscriptionState = String(status.subscriptionState || 'unknown').slice(0, 64);
    twitch.lastConnectedAt = Number.isFinite(status.lastConnectedAt) && status.lastConnectedAt > 0
      ? status.lastConnectedAt : twitch.lastConnectedAt;
    twitch.lastDisconnectedAt = Number.isFinite(status.lastDisconnectedAt) && status.lastDisconnectedAt > 0
      ? status.lastDisconnectedAt : twitch.lastDisconnectedAt;

    if (!wasConnected && connected) {
      twitch.reconnects += twitch.connections > 0 ? 1 : 0;
      twitch.connections += 1;
      twitch.connectedAt = Number.isFinite(status.lastConnectedAt) && status.lastConnectedAt > 0
        ? status.lastConnectedAt : timestamp;
    } else if (wasConnected && !connected) {
      twitch.disconnects += 1;
      twitch.completedConnectedMs += Math.max(0, timestamp - (twitch.connectedAt || timestamp));
      twitch.connectedAt = null;
      twitch.lastDisconnectedAt = Number.isFinite(status.lastDisconnectedAt) && status.lastDisconnectedAt > 0
        ? status.lastDisconnectedAt : timestamp;
    }
    twitch.connected = connected;
  }

  function roleSnapshot(type, timestamp) {
    const role = roles[type];
    let activeConnectedMs = 0;
    for (const socket of sockets.values()) {
      if (socket.clientType === type) activeConnectedMs += Math.max(0, timestamp - socket.connectedAt);
    }
    return {
      connections: role.connections,
      reconnects: role.reconnects,
      disconnects: role.disconnects,
      activeConnections: activeCount(type),
      connectedMs: role.completedConnectedMs + activeConnectedMs,
      lastConnectedAt: role.lastConnectedAt,
      lastDisconnectedAt: role.lastDisconnectedAt,
    };
  }

  function getSnapshot(timestamp = now()) {
    const bothSourcesConnectedMs = obs.completedBothSourcesMs
      + (obs.bothSourcesConnectedAt == null ? 0 : Math.max(0, timestamp - obs.bothSourcesConnectedAt));
    const twitchConnectedMs = twitch.completedConnectedMs
      + (twitch.connectedAt == null ? 0 : Math.max(0, timestamp - twitch.connectedAt));
    return {
      schemaVersion: 1,
      startedAt,
      generatedAt: timestamp,
      observedMs: Math.max(0, timestamp - startedAt),
      privacy: 'memory-only connection timing and counts; no song, chat, address, credential, or socket-id data',
      clients: Object.fromEntries(TRACKED_CLIENT_TYPES.map((type) => [type, roleSnapshot(type, timestamp)])),
      obs: {
        displaySeen: obs.displaySeen,
        setlistSeen: obs.setlistSeen,
        bothSourcesSeen: obs.bothSourcesSeen,
        bothSourcesConnected: obs.bothSourcesConnectedAt != null,
        bothSourcesConnectedMs,
        interruptions: obs.interruptions,
        lastInterruptedAt: obs.lastInterruptedAt,
      },
      twitch: {
        observed: twitch.observed,
        configured: twitch.configured,
        authorized: twitch.authorized,
        connected: twitch.connected,
        connections: twitch.connections,
        reconnects: twitch.reconnects,
        disconnects: twitch.disconnects,
        connectedMs: twitchConnectedMs,
        lastConnectedAt: twitch.lastConnectedAt,
        lastDisconnectedAt: twitch.lastDisconnectedAt,
        connectionState: twitch.connectionState,
        subscriptionState: twitch.subscriptionState,
      },
    };
  }

  function reset(timestamp = now()) {
    startedAt = timestamp;
    roles = Object.fromEntries(TRACKED_CLIENT_TYPES.map((type) => [type, emptyRole()]));
    for (const socket of sockets.values()) {
      socket.connectedAt = timestamp;
      const role = roles[socket.clientType];
      role.connections += 1;
      role.lastConnectedAt = timestamp;
    }
    obs = {
      displaySeen: activeCount('display') > 0,
      setlistSeen: activeCount('setlist') > 0,
      bothSourcesSeen: false,
      bothSourcesConnectedAt: null,
      completedBothSourcesMs: 0,
      interruptions: 0,
      lastInterruptedAt: null,
    };
    reconcileObsPair(timestamp);
    twitch = {
      observed: twitch.observed,
      configured: twitch.configured,
      authorized: twitch.authorized,
      connected: twitch.connected,
      connections: twitch.connected ? 1 : 0,
      reconnects: 0,
      disconnects: 0,
      completedConnectedMs: 0,
      connectedAt: twitch.connected ? timestamp : null,
      lastConnectedAt: twitch.connected ? timestamp : twitch.lastConnectedAt,
      lastDisconnectedAt: twitch.lastDisconnectedAt,
      connectionState: twitch.connectionState,
      subscriptionState: twitch.subscriptionState,
    };
    return getSnapshot(timestamp);
  }

  return { recordSocketConnected, recordSocketDisconnected, recordTwitchStatus, getSnapshot, reset };
}

const runtimeEvidence = createRuntimeEvidence();

module.exports = { TRACKED_CLIENT_TYPES, createRuntimeEvidence, ...runtimeEvidence };
