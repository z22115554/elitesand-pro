'use strict';

/*
 * P2 R2-2 integration probe.
 *
 * Uses the Engine.IO WebSocket wire protocol directly so the repository does
 * not need a test-only socket.io-client dependency.  The child receives an
 * isolated data directory from run-tests.js; it never reads or writes the
 * user's real state.json or downloads directory.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dataDir = path.resolve(process.argv[3] || path.join(root, '.matrix-data'));
process.env.PORT = '0';
process.env.ELITESAND_DATA_DIR = dataDir;

const RESULT_MARKER = '__STATE_SYNC_MATRIX__';
const EVENT_TIMEOUT_MS = 8000;

function fail(message) {
  throw new Error(message);
}

function assert(value, message) {
  if (!value) fail(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFixtureState() {
  const lines = Array.from({ length: 24 }, (_, index) => {
    const text = `matrix lyric ${index + 1} ${'text '.repeat(72)}`;
    return {
      time: index * 4000,
      endTime: index * 4000 + 3500,
      text,
      phonetic: `phonetic ${index + 1} ${'sound '.repeat(44)}`,
      xieyin: `xieyin ${index + 1} ${'字音 '.repeat(44)}`,
    };
  });
  const lyrics = lines.map((line) => {
    const seconds = Math.floor(line.time / 1000);
    return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]${line.text}`;
  }).join('\n');
  const playlist = Array.from({ length: 500 }, (_, index) => ({
    id: `matrix-${index}`,
    title: `P2 matrix song ${index + 1}`,
    artist: 'Elitesand integration fixture',
    duration: 240,
    filename: `matrix-${index}.mp3`,
    url: `https://example.test/watch/${index}`,
    cover: `https://example.test/cover/${index}.jpg`,
    originalName: `matrix-${index}.original.mp3`,
    lyrics,
    lyricsType: 'lrc',
    parsedLyrics: lines,
  }));
  return {
    schemaVersion: 2,
    savedAt: Date.now(),
    playlist,
    style: 'cute',
    romanizationMode: 'original',
    showRomanization: false,
    metronomeEnabled: true,
    trackOffsets: {},
    manualLyrics: {},
  };
}

function seedState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(buildFixtureState()), 'utf8');
}

class WireClient {
  constructor(url, clientType, pin = '') {
    this.url = url;
    this.clientType = clientType;
    this.pin = pin;
    this.socket = null;
    this.events = new Map();
    this.waiters = new Map();
    this.connected = false;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${this.clientType} WebSocket connection timed out`)), EVENT_TIMEOUT_MS);
      this.socket = new WebSocket(this.url);
      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`${this.clientType} WebSocket error: ${error.message}`));
      });
      this.socket.on('message', (raw) => {
        try {
          this.receive(String(raw));
          if (this.connected) {
            clearTimeout(timeout);
            resolve(this);
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.socket.on('close', () => { this.closed = true; });
    });
  }

  receive(packet) {
    // Engine.IO heartbeat: reply at wire level without involving Socket.IO.
    if (packet === '2') {
      this.sendRaw('3');
      return;
    }
    // Engine.IO open packet.  Socket.IO middleware reads auth from the first
    // CONNECT packet, before the application-level client:type event.
    if (packet.startsWith('0')) {
      this.sendRaw(`40${JSON.stringify({ clientType: this.clientType, pin: this.pin })}`);
      return;
    }
    if (packet.startsWith('40')) {
      this.connected = true;
      this.send('client:type', this.clientType);
      return;
    }
    if (!packet.startsWith('42')) return;
    const parsed = JSON.parse(packet.slice(2));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return;
    this.emit(parsed[0], parsed[1]);
  }

  emit(event, payload) {
    const values = this.events.get(event) || [];
    values.push(payload);
    this.events.set(event, values);
    const waiters = this.waiters.get(event) || [];
    this.waiters.set(event, []);
    for (const waiter of waiters) waiter.resolve(payload);
  }

  sendRaw(packet) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(packet);
  }

  send(event, payload) {
    this.sendRaw(`42${JSON.stringify([event, payload])}`);
  }

  eventCount(event) {
    return (this.events.get(event) || []).length;
  }

  waitFor(event, { after = 0, predicate = () => true } = {}) {
    const values = this.events.get(event) || [];
    for (let index = after; index < values.length; index++) {
      if (predicate(values[index])) return Promise.resolve(values[index]);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiters = this.waiters.get(event) || [];
        this.waiters.set(event, waiters.filter((waiter) => waiter.resolve !== resolve));
        reject(new Error(`${this.clientType} did not receive ${event} within ${EVENT_TIMEOUT_MS}ms`));
      }, EVENT_TIMEOUT_MS);
      const waiter = {
        resolve: (payload) => {
          clearTimeout(timeout);
          if (predicate(payload)) resolve(payload);
          else this.waitFor(event, { after: this.eventCount(event), predicate }).then(resolve, reject);
        },
      };
      const waiters = this.waiters.get(event) || [];
      waiters.push(waiter);
      this.waiters.set(event, waiters);
    });
  }

  async close() {
    if (!this.socket || this.closed) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      this.socket.once('close', () => { clearTimeout(timer); resolve(); });
      this.socket.close();
    });
  }
}

const READ_ONLY_TRACK_FIELDS = ['filename', 'url', 'cover', 'originalName', 'audioAvailable', 'audioMissing'];

function validatePublicState(payload, label, { readOnly = false } = {}) {
  assert(payload && typeof payload === 'object', `${label}: state payload is missing`);
  assert(Array.isArray(payload.playlist) && payload.playlist.length === 500, `${label}: playlist must contain 500 tracks`);
  assert(payload.playlist.every((track) =>
    !Object.prototype.hasOwnProperty.call(track, 'lyrics') &&
    !Object.prototype.hasOwnProperty.call(track, 'parsedLyrics') &&
    track.hasLyrics === true
  ), `${label}: playlist summaries must omit lyric bodies`);
  const tracks = [...payload.playlist, payload.currentTrack].filter(Boolean);
  if (readOnly) {
    assert(tracks.every((track) => READ_ONLY_TRACK_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(track, field))),
      `${label}: read-only payload must not expose media paths, sources, or availability`);
  } else {
    assert(tracks.every((track) => track.filename && track.url && track.cover),
      `${label}: control payload must retain media details for playback and library management`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert(bytes < 1024 * 1024, `${label}: public state payload is ${bytes} bytes, expected below 1 MiB`);
  return bytes;
}

function validatePlaylistUpdate(payload, label, { readOnly = false } = {}) {
  assert(Array.isArray(payload) && payload.length === 500, `${label}: playlist update must contain 500 tracks`);
  if (readOnly) {
    assert(payload.every((track) => READ_ONLY_TRACK_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(track, field))),
      `${label}: read-only playlist update must not expose media details`);
  } else {
    assert(payload.every((track) => track.filename && track.url && track.cover),
      `${label}: control playlist update must retain media details`);
  }
}

async function run() {
  seedState();
  const authStore = require(path.join(root, 'server', 'services', 'auth-store'));
  const pin = 'matrix-test-pin';
  if (!authStore.setPin(pin).ok) fail('failed to seed matrix control PIN');
  const { server, io, gracefulShutdown } = require(path.join(root, 'server', 'index'));
  const clients = [];
  let exitCode = 0;
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
    const byType = {};
    for (const type of ['controller', 'remote', 'display', 'display-spout', 'setlist']) {
      const client = new WireClient(url, type, type === 'controller' || type === 'remote' ? pin : '');
      clients.push(client);
      byType[type] = await client.connect();
    }

    const initialController = await byType.controller.waitFor('state:sync');
    const initialRemote = await byType.remote.waitFor('state:sync');
    const initialDisplay = await byType.display.waitFor('state:recovery');
    const initialSpoutDisplay = await byType['display-spout'].waitFor('state:recovery');
    const initialSetlist = await byType.setlist.waitFor('state:sync');
    await byType.setlist.waitFor('setlist:update');
    const clientCounts = await byType.controller.waitFor('client:counts', { predicate: (counts) => counts?.total === 4 });
    assert(clientCounts.displays === 1, 'display-spout must not inflate the OBS display connection count');

    const initialBytes = {
      controller: validatePublicState(initialController, 'controller initial sync'),
      remote: validatePublicState(initialRemote, 'remote initial sync'),
      display: validatePublicState(initialDisplay, 'display initial recovery', { readOnly: true }),
      'display-spout': validatePublicState(initialSpoutDisplay, 'display-spout initial recovery', { readOnly: true }),
      setlist: validatePublicState(initialSetlist, 'setlist initial sync', { readOnly: true }),
    };
    assert(initialBytes.controller === initialBytes.remote, 'control clients must receive identical initial state');
    assert(initialBytes.display === initialBytes['display-spout'] && initialBytes.display === initialBytes.setlist,
      'read-only clients must receive identical initial state');
    assert(initialBytes.controller > initialBytes.display, 'read-only initial state must omit media details');

    // High-frequency visual settings use their explicit Socket contract rather
    // than resending a 500-song state snapshot to every client.
    const styleCounts = Object.fromEntries(Object.entries(byType).map(([type, client]) => [type, client.eventCount('style:change')]));
    byType.controller.send('style:change', 'matrix');
    const styleUpdates = await Promise.all(Object.entries(byType).map(async ([type, client]) => [
      type,
      await client.waitFor('style:change', { after: styleCounts[type] }),
    ]));
    for (const [type, style] of styleUpdates) {
      assert(style === 'matrix', `${type} must receive the direct style update`);
    }

    // A playlist mutation remains a full-state boundary. Validate the room
    // split and compact payload for that authoritative broadcast.
    const syncCounts = Object.fromEntries(Object.entries(byType).map(([type, client]) => [type, client.eventCount('state:sync')]));
    const playlistCounts = Object.fromEntries(Object.entries(byType).map(([type, client]) => [type, client.eventCount('playlist:update')]));
    byType.controller.send('playlist:update', initialController.playlist);
    const [synced, playlistUpdates] = await Promise.all([
      Promise.all(Object.entries(byType).map(async ([type, client]) => [
        type,
        await client.waitFor('state:sync', { after: syncCounts[type] }),
      ])),
      Promise.all(Object.entries(byType).map(async ([type, client]) => [
        type,
        await client.waitFor('playlist:update', { after: playlistCounts[type] }),
      ])),
    ]);
    const broadcastBytes = Object.fromEntries(synced.map(([type, payload]) => [
      type,
      validatePublicState(payload, `${type} playlist broadcast sync`, { readOnly: type === 'display' || type === 'display-spout' || type === 'setlist' }),
    ]));
    assert(broadcastBytes.controller === broadcastBytes.remote, 'control clients must receive identical broadcast state');
    assert(broadcastBytes.display === broadcastBytes['display-spout'] && broadcastBytes.display === broadcastBytes.setlist,
      'read-only clients must receive identical broadcast state');
    assert(broadcastBytes.controller > broadcastBytes.display, 'read-only broadcast state must omit media details');

    for (const [type, payload] of playlistUpdates) {
      validatePlaylistUpdate(payload, `${type} playlist update`, { readOnly: type === 'display' || type === 'display-spout' || type === 'setlist' });
    }

    // Display must be able to re-request its full recovery state without a
    // controller action, and setlist must be able to refresh independently.
    const recoveryCount = byType.display.eventCount('state:recovery');
    byType.display.send('state:request', null);
    const recovery = await byType.display.waitFor('state:recovery', { after: recoveryCount });
    const recoveryBytes = validatePublicState(recovery, 'display requested recovery', { readOnly: true });
    const setlistCount = byType.setlist.eventCount('setlist:update');
    byType.setlist.send('setlist:get', null);
    const setlist = await byType.setlist.waitFor('setlist:update', { after: setlistCount });
    assert(Array.isArray(setlist?.upcoming) && setlist.upcoming.length === 500, 'setlist refresh must contain all queued songs');

    process.stdout.write(`${RESULT_MARKER}${JSON.stringify({
      ok: true,
      roles: Object.keys(byType),
      playlistLength: initialController.playlist.length,
      initialBytes,
      broadcastBytes,
      recoveryBytes,
    })}\n`);
  } catch (error) {
    exitCode = 1;
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ ok: false, error: error.message })}\n`);
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
    try { io.close(); } catch (_) { /* best effort */ }
    // index.js owns timers from Twitch/update services, so use its shutdown
    // path instead of leaving this test child alive after the socket closes.
    await wait(20);
    gracefulShutdown({ reason: 'state-sync-matrix-test', exitCode });
  }
}

run().catch((error) => {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exit(1);
});
