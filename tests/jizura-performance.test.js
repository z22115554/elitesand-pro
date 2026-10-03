'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadEngine() {
  const context = { window: {}, console, Intl };
  let metricWidth = 50;
  const makeCanvas = () => {
    const canvas = { width: 2, height: 2 };
    const ctx = new Proxy({
      canvas,
      measureText: () => ({ width: metricWidth }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }, { get: (o, k) => k in o ? o[k] : () => {} });
    canvas.getContext = () => ctx;
    return canvas;
  };
  context.document = { createElement: makeCanvas };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/vendor/jizura/jizura-engine.js'), 'utf8'), context);
  return { J: context.window.J, makeCanvas, setMetricWidth: n => { metricWidth = n; } };
}

test('text runs reuse widths across animated sizes while layouts remain independent', () => {
  const { J } = loadEngine();
  let calls = 0;
  const adv = J.metrics.adv.bind(J.metrics);
  J.metrics.adv = (...args) => { calls++; return adv(...args); };
  const item = { text: 'ABC', font: 'gothic_bold', size: 20, align: 'left' };
  const first = J.layoutText(item);
  assert.equal(first.W, 30);
  assert.equal(calls, 3);
  first[0].x = -999; first.pop();
  const bigger = J.layoutText({ ...item, size: 40, track: 0.1 });
  assert.equal(bigger.W, 68);
  assert.equal(bigger.length, 3);
  assert.equal(bigger[0].x, 10);
  assert.equal(calls, 3, 'changing size/tracking must not repeat metric queries');
  const moved = J.layoutText({ ...item, align: 'right' });
  assert.equal(moved[0].x, -25);
  assert.equal(calls, 3);
});

test('font readiness, language, typesetting, and vertical writing invalidate/select correct runs', () => {
  const { J, setMetricWidth } = loadEngine();
  const item = { text: 'AB', font: 'gothic_bold', size: 20 };
  assert.equal(J.layoutText(item).W, 20);
  setMetricWidth(100); J.metrics.clear();
  assert.equal(J.layoutText(item).W, 40);
  J.setTypeset(true);
  assert.equal(J.layoutText(item).W, 43.2);
  J.setTypeset(false); setMetricWidth(75); J.setLang('zh-Hant');
  assert.equal(J.layoutText(item).W, 30);
  const vertical = J.layoutText({ ...item, text: '中A', vertical: true });
  assert.equal(vertical.H, 35);
  assert.equal(vertical[0].r90, false);
  assert.equal(vertical[1].r90, true);
  assert.equal(J.layoutText({ ...item, text: '中A' }).W, 30);
});

test('text-run cache is bounded by entry count, glyph count and individual run size', () => {
  const { J } = loadEngine();
  let calls = 0;
  J.metrics.adv = () => { calls++; return 1; };
  const item = text => ({ text, size: 20, font: 'gothic_bold' });
  J.layoutText(item('old'));
  for (let i = 0; i < 256; i++) J.layoutText(item('line' + i));
  calls = 0; J.layoutText(item('old')); assert.equal(calls, 3);
  J.clearTextLayouts();
  const large = 'x'.repeat(510);
  J.layoutText(item(large + '00'));
  for (let i = 1; i <= 16; i++) J.layoutText(item(large + String(i).padStart(2, '0')));
  calls = 0; J.layoutText(item(large + '00')); assert.equal(calls, 512);
  const huge = 'x'.repeat(513);
  calls = 0; J.layoutText(item(huge)); J.layoutText(item(huge)); assert.equal(calls, 1026);
});

function effectProbe() {
  const { J, makeCanvas } = loadEngine();
  const renderer = new J.Renderer();
  const ctx = makeCanvas().getContext('2d');
  let drawn = [], masks = 0;
  J.FXE.probe = { draw: (ctx, ev) => drawn.push(ev.id) };
  renderer.alphaGuard = () => { masks++; return { begin() {}, end() {} }; };
  const plan = { events: [], fps: 24, fx: {}, style: { glow: 0 } };
  return { plan, render(t) {
    drawn = []; masks = 0;
    renderer.post(ctx, plan, t, t, 0, { bg: '#000000' }, 1, { transparent: true, fast: true }, false);
    return { drawn, masks };
  } };
}

test('event window retains overlapping/long effects, frame-minimum duration, order and backward seeks', () => {
  const { plan, render } = effectProbe();
  plan.events = [
    { id: 0, type: 'probe', t: -1, dur: 12 },
    { id: 1, type: 'probe', t: 1, dur: 0 },
    { id: 2, type: 'probe', t: 2, dur: 1 },
    { id: 3, type: 'probe', t: 2, dur: 7 },
    { id: 4, type: 'probe', t: 9, dur: 0.4 },
  ];
  for (const t of [0, 1, 1 + 1 / 24 - 1e-8, 1 + 1 / 24, 2, 3, 8.5, 10, 12, 0, 2.5]) {
    const expected = plan.events.filter(ev => t >= ev.t && t < ev.t + Math.max(ev.dur, 1 / plan.fps)).map(ev => ev.id);
    const actual = render(t);
    assert.deepEqual(actual.drawn, expected, 't=' + t);
    assert.equal(actual.masks, expected.length ? 1 : 0);
  }
});

test('event index refreshes after array replacement, resize or fps change and handles unsorted input', () => {
  const { plan, render } = effectProbe();
  plan.events = [{ id: 1, type: 'probe', t: 1, dur: 0 }];
  assert.deepEqual(render(1.05).drawn, []);
  plan.fps = 10; assert.deepEqual(render(1.05).drawn, [1]);
  plan.events = [{ id: 2, type: 'probe', t: 2, dur: 1 }];
  assert.deepEqual(render(2.5).drawn, [2]);
  plan.events.push({ id: 3, type: 'probe', t: 2.4, dur: 1 });
  assert.deepEqual(render(2.5).drawn, [2, 3]);
  plan.events = [plan.events[1], plan.events[0]];
  assert.deepEqual(render(2.5).drawn, [3, 2]);
  plan.events = []; assert.deepEqual(render(2.5), { drawn: [], masks: 0 });
});

test('warmed event lookup skips expired history on long songs', () => {
  const { plan, render } = effectProbe();
  let reads = 0;
  plan.events = Array.from({ length: 10000 }, (_, i) => ({
    id: i, type: 'probe', get t() { reads++; return i; }, dur: 0.1,
  }));
  render(9500.01); reads = 0;
  assert.deepEqual(render(9998.01).drawn, [9998]);
  assert(reads < 30, 'must not read thousands of expired events per frame');
});
