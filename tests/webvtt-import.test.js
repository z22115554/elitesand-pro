'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVtt, autoParseLyrics } = require('../server/services/lrc-parser.js');

test('basic 3-cue WebVTT file with hours parses times, durations and text', () => {
  const vtt = [
    'WEBVTT',
    '',
    '01:00:00.000 --> 01:00:02.500',
    'First line',
    '',
    '01:00:03.000 --> 01:00:05.000',
    'Second line',
    '',
    '01:00:05.500 --> 01:00:08.000',
    'Third line',
    '',
  ].join('\n');
  const { lines, offset } = parseVtt(vtt);
  assert.equal(offset, 0);
  assert.deepEqual(lines, [
    { time: 3600000, duration: 2500, text: 'First line', phonetic: '', words: [] },
    { time: 3603000, duration: 2000, text: 'Second line', phonetic: '', words: [] },
    { time: 3605500, duration: 2500, text: 'Third line', phonetic: '', words: [] },
  ]);
});

test('MM:SS.mmm timing without hours, identifier lines and cue settings are handled', () => {
  const vtt = [
    'WEBVTT',
    '',
    'cue-a',
    '00:01.000 --> 00:03.000 align:start position:10%',
    'Hello world',
    '',
    '2',
    '00:04.000 --> 00:06.000 line:90%',
    'Bye',
    '',
  ].join('\n');
  const { lines } = parseVtt(vtt);
  assert.deepEqual(lines.map(l => [l.time, l.duration, l.text]), [
    [1000, 2000, 'Hello world'],
    [4000, 2000, 'Bye'],
  ]);
});

test('NOTE, STYLE and REGION blocks are skipped', () => {
  const vtt = [
    'WEBVTT',
    '',
    'NOTE this is a comment --> with an arrow',
    'still a note',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'REGION',
    'id:fred',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'Real cue',
    '',
  ].join('\n');
  const { lines } = parseVtt(vtt);
  assert.deepEqual(lines.map(l => l.text), ['Real cue']);
});

test('voice and class tags are stripped and entities decoded', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:02.000',
    '<v Singer><c.yellow>Hello</c> &amp; <c>bye</c></v>',
    '',
    '00:00:03.000 --> 00:00:04.000',
    '<00:00:03.200>a &lt;b&gt; &nbsp;c &amp;lt;',
    '',
  ].join('\n');
  const { lines } = parseVtt(vtt);
  assert.deepEqual(lines.map(l => l.text), ['Hello & bye', 'a <b>  c &lt;']);
});

test('BOM before WEBVTT header is handled', () => {
  const vtt = '﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nWith BOM\n';
  const { lines } = parseVtt(vtt);
  assert.deepEqual(lines.map(l => l.text), ['With BOM']);

  const auto = autoParseLyrics(vtt);
  assert.equal(auto.type, 'vtt');
  assert.deepEqual(auto.lines.map(l => l.text), ['With BOM']);
});

test('autoParseLyrics returns type vtt for WebVTT input', () => {
  const vtt = 'WEBVTT Kind: captions\n\n00:00:01.000 --> 00:00:02.000\nLine one\n\n00:00:02.500 --> 00:00:04.000\nLine two\n';
  const result = autoParseLyrics(vtt);
  assert.equal(result.type, 'vtt');
  assert.equal(result.offset, 0);
  assert.deepEqual(result.lines.map(l => l.text), ['Line one', 'Line two']);
});

test('an existing SRT sample still returns type srt', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:02,500',
    'Sample first',
    '',
    '2',
    '00:00:03,000 --> 00:00:04,000',
    'Sample second',
    '',
  ].join('\n');
  const result = autoParseLyrics(srt);
  assert.equal(result.type, 'srt');
  assert.deepEqual(result.lines.map(l => l.text), ['Sample first', 'Sample second']);
});
