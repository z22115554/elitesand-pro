'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadState, loadDisplay, loadPlaylist } = require('./helpers/runtime-audit-fixtures');

test('speed changes preserve the clock at the old rate and use the new slope afterward', () => {
  const display = loadDisplay();
  display.emit('state:sync', { isPlaying: true, currentTime: 10, serverTimestamp: 100000, playbackRate: 1 });
  display.advance(200);
  display.emit('speed:update', 1.5);
  assert.equal(display.clock(), 10200);
  display.advance(200);
  assert.equal(display.clock(), 10500);
  display.emit('speed:update', 0.5);
  assert.equal(display.clock(), 10500);
  display.advance(200);
  assert.equal(display.clock(), 10600);
  display.emit('speed:update', 0.5);
  assert.equal(display.clock(), 10600);
  display.emit('speed:update', 99);
  assert.equal(display.clock(), 10600);
  display.advance(100);
  assert.equal(display.clock(), 10750);
});

test('paused and invalid speed updates do not advance or poison the display clock', () => {
  const display = loadDisplay();
  display.emit('state:sync', { isPlaying: false, currentTime: 10, serverTimestamp: 100000, playbackRate: 1 });
  display.advance(200);
  for (const rate of [1.5, 0.5, NaN, Infinity, '1.2', undefined]) display.emit('speed:update', rate);
  assert.equal(display.clock(), 10000);
  display.emit('state:sync', { isPlaying: true, currentTime: 10, serverTimestamp: 100000, playbackRate: 1 });
  for (const rate of [NaN, Infinity, '1.2']) display.emit('speed:update', rate);
  display.advance(100);
  assert.equal(display.clock(), 10100);
});

test('broadcast shares one snapshot and keeps read-only media fields redacted', () => {
  const fixture = loadState();
  const { state, emitted } = fixture;
  state.playState.playlist = Array.from({ length: 20 }, (_, i) => ({
    id: `track-${i}`, entryId: `entry-${i}`, title: `Song ${i}`,
    filename: `private-${i}.mp3`, url: 'https://example.test/private',
    originalName: 'private.mp3', cover: 'https://example.test/cover',
    lyrics: '[00:01]words', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: 'words' }],
  }));
  state.playState.currentTrack = state.playState.playlist[0];
  state.broadcastState(); // First diagnostic sample intentionally checks eight legacy tracks.
  emitted.length = 0;
  fixture.resetAudioCalls();
  state.broadcastState();
  assert.equal(fixture.audioCalls(), 21, 'one summary per track and one complete current track');
  assert.equal(emitted.length, 2);
  const control = emitted.find(item => item.room === 'access:control').payload;
  const readOnly = emitted.find(item => item.room === 'access:read-only').payload;
  assert.equal(control.playlist.length, 20);
  assert.equal(control.currentTrack.filename, 'private-0.mp3');
  assert.equal(control.currentTrack.lyrics, '[00:01]words');
  assert.equal(readOnly.playlist.length, 0);
  for (const field of ['filename', 'url', 'cover', 'originalName', 'audioAvailable', 'audioMissing']) {
    assert.equal(Object.hasOwn(readOnly.currentTrack, field), false, field);
  }
  assert.equal(readOnly.currentTrack.lyrics, control.currentTrack.lyrics);
  assert.equal(readOnly.serverTimestamp, control.serverTimestamp);
  assert.notEqual(readOnly.currentTrack, control.currentTrack);
  assert.equal(state.getStateSyncMetrics().lastBytes, Buffer.byteLength(JSON.stringify(control)));
  assert.deepEqual(JSON.parse(JSON.stringify(state.getReadOnlyState())), JSON.parse(JSON.stringify(readOnly)));
});

test('playlist summaries keep manual lyrics, offsets and duplicate entry identities', () => {
  const { state } = loadState();
  const track = { id: 'same', title: 'Song', lyrics: 'old', lyricsType: 'txt', privateMetadata: 'kept on current' };
  state.playState.playlist = [{ ...track, entryId: 'a' }, { ...track, entryId: 'b' }];
  state.manualLyricsCache.set('same', { lyrics: '[00:01]manual', lyricsType: 'lrc', parsedLyrics: [] });
  state.trackOffsets.set('same', 250);
  state.playState.currentTrack = state.playState.playlist[1];
  const payload = state.getPublicState();
  assert.deepEqual(Array.from(payload.playlist, item => item.entryId), ['a', 'b']);
  assert.ok(payload.playlist.every(item => item.hasLyrics && item.manualLyrics && item.offset === 250));
  assert.ok(payload.playlist.every(item => !Object.hasOwn(item, 'lyrics') && !Object.hasOwn(item, 'privateMetadata')));
  assert.equal(payload.currentTrack.lyrics, '[00:01]manual');
  assert.equal(payload.currentTrack.privateMetadata, 'kept on current');
});

test('playlist filter and selection counters agree while hidden selections and current track change', () => {
  const ui = loadPlaylist();
  ui.state.playlist = [
    { id: 'same', entryId: 'a', title: 'ＡＢＣ', artist: '歌手', hasLyrics: true },
    { id: 'same', entryId: 'b', title: 'ABC', artist: '歌手', audioMissing: true },
    { id: 'third', entryId: 'c', title: 'Other', artist: 'Other', hasLyrics: true },
  ];
  ui.state.currentTrackIndex = 0;
  ui.state.playedEntryIds = new Set(['a']);
  ui.setSelectionMode(true);
  ui.filter('abc');
  assert.deepEqual(ui.dom.playlist.children.map(node => node.hidden), [false, false, true]);
  ui.toggleVisibleTrackSelection();
  assert.equal(JSON.parse(ui.dom.playlistSelectionCount.textContent).count, 1);
  assert.equal(JSON.parse(ui.dom.btnPlaylistSelectVisible.textContent).key, 'playlist.deselectVisible');
  ui.filter('other');
  assert.equal(JSON.parse(ui.dom.playlistSelectionCount.textContent).count, 1, 'hidden selections still count');
  ui.toggleVisibleTrackSelection();
  assert.equal(JSON.parse(ui.dom.playlistSelectionCount.textContent).count, 2);
  ui.state.currentTrackIndex = 1;
  ui.renderPlaylist();
  assert.equal(JSON.parse(ui.dom.playlistSelectionCount.textContent).count, 1, 'new current song is excluded');
  for (const [mode, visible] of [['played', [true, false, false]], ['upcoming', [false, false, true]],
    ['missing-audio', [false, true, false]], ['no-lyrics', [false, true, false]]]) {
    ui.filter('', mode);
    assert.deepEqual(ui.dom.playlist.children.map(node => !node.hidden), visible, mode);
  }
  ui.state.playlist = [];
  ui.renderPlaylist();
  assert.equal(JSON.parse(ui.dom.playlistSelectionCount.textContent).count, 0);
  assert.equal(ui.dom.btnPlaylistSelectVisible.disabled, true);
});
