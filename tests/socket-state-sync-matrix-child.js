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
    lyrics,
    lyricsType: 'lrc',
    parsedLyrics: lines,
  }));
  return {
    schemaVersion: 1,
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
  constructor(url, clientType) {
    this.url = url;
    this.clientType = clientType;
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
      this.sendRaw(`40${JSON.stringify({ clientType: this.clientType })}`);
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

function validatePublicState(payload, label) {
  assert(payload && typeof payload === 'object', `${label}: state payload is missing`);
  assert(Array.isArray(payload.playlist) && payload.playlist.length === 500, `${label}: playlist must contain 500 tracks`);
  assert(payload.playlist.every((track) =>
    !Object.prototype.hasOwnProperty.call(track, 'lyrics') &&
    !Object.prototype.hasOwnProperty.call(track, 'parsedLyrics') &&
    track.hasLyrics === true
  ), `${label}: playlist summaries must omit lyric bodies`);
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert(bytes < 1024 * 1024, `${label}: public state payload is ${bytes} bytes, expected below 1 MiB`);
  return bytes;
}

async function run() {
  seedState();
  const { server, io, gracefulShutdown } = require(path.join(root, 'server', 'index'));
  const clients = [];
  let exitCode = 0;
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const url = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
    const byType = {};
    for (const type of ['controller', 'remote', 'display', 'setlist']) {
      const client = new WireClient(url, type);
      clients.push(client);
      byType[type] = await client.connect();
    }

    const initialController = await byType.controller.waitFor('state:sync');
    const initialRemote = await byType.remote.waitFor('state:sync');
    const initialDisplay = await byType.display.waitFor('state:recovery');
    const initialSetlist = await byType.setlist.waitFor('state:sync');
    await byType.setlist.waitFor('setlist:update');
    await byType.controller.waitFor('client:counts', { predicate: (counts) => counts?.total === 4 });

    const initialBytes = [
      validatePublicState(initialController, 'controller initial sync'),
      validatePublicState(initialRemote, 'remote initial sync'),
      validatePublicState(initialDisplay, 'display initial recovery'),
      validatePublicState(initialSetlist, 'setlist initial sync'),
    ];
    assert(new Set(initialBytes).size === 1, 'all four clients must receive the same initial public-state payload');

    // Force a normal server broadcast after all four roles are connected.
    const syncCounts = Object.fromEntries(Object.entries(byType).map(([type, client]) => [type, client.eventCount('state:sync')]));
    byType.controller.send('style:change', 'matrix');
    const synced = await Promise.all(Object.entries(byType).map(async ([type, client]) => {
      const payload = await client.waitFor('state:sync', { after: syncCounts[type] });
      return [type, payload];
    }));
    const broadcastBytes = synced.map(([type, payload]) => validatePublicState(payload, `${type} broadcast sync`));
    assert(new Set(broadcastBytes).size === 1, 'all four clients must receive identical broadcast payload sizes');

    // Display must be able to re-request its full recovery state without a
    // controller action, and setlist must be able to refresh independently.
    const recoveryCount = byType.display.eventCount('state:recovery');
    byType.display.send('state:request', null);
    const recovery = await byType.display.waitFor('state:recovery', { after: recoveryCount });
    const recoveryBytes = validatePublicState(recovery, 'display requested recovery');
    const setlistCount = byType.setlist.eventCount('setlist:update');
    byType.setlist.send('setlist:get', null);
    const setlist = await byType.setlist.waitFor('setlist:update', { after: setlistCount });
    assert(Array.isArray(setlist?.upcoming) && setlist.upcoming.length === 500, 'setlist refresh must contain all queued songs');

    process.stdout.write(`${RESULT_MARKER}${JSON.stringify({
      ok: true,
      roles: Object.keys(byType),
      playlistLength: initialController.playlist.length,
      initialBytes: initialBytes[0],
      broadcastBytes: broadcastBytes[0],
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
