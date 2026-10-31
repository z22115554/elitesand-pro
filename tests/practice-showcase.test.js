'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Showcase = require('../public/js/practice/practice-showcase');

function element() {
  let text = '';
  return { children: [], hidden: true, className: '', ownerDocument: { createElement: () => element() },
    get textContent() { return text + this.children.map((c) => c.textContent).join(''); },
    set textContent(value) { text = value; this.children.length = 0; }, appendChild(child) { this.children.push(child); } };
}
const recap = { takeId: 'a', trackId: 'track', personalBest: true, previousDelta: 2.5, bestScore: 92,
  challenge: { requester: '<img src=x onerror=alert(1)>', targetScore: 90, achieved: false, rank: 1, participationCount: 4 } };

test('showcase uses text nodes, bounds names, does not invent missing rank, and clears absent summaries', () => {
  const el = element(); Showcase.render(el, recap);
  assert.equal(el.hidden, false); assert.match(el.textContent, /刷新個人紀錄/); assert.match(el.textContent, /\+2.5/);
  assert.match(el.textContent, /本機挑戰排名 第 1 名/); assert.match(el.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.ok(el.children.every((c) => c.children.length === 0), 'requester markup remains a string');
  Showcase.render(el, { challenge: { targetScore: 80 } });
  assert.equal(el.textContent, '目標分數 80.0'); assert.doesNotMatch(el.textContent, /排名|參與/);
  Showcase.render(el, null); assert.equal(el.hidden, true); assert.equal(el.textContent, '');
});

test('showcase passes formatted data to translations as text and does not manipulate result animations', () => {
  const el = element(); el.className = 'res-static';
  Showcase.render(el, { personalBest: true, previousDelta: -1 }, (key, vars) => key.endsWith('personalBest') ? '<b>record</b>' : `diff ${vars.score}`);
  assert.equal(el.textContent, '<b>record</b>diff -1.0'); assert.equal(el.className, 'res-static');
  assert.equal(el.children[0].textContent, '<b>record</b>');
});

function sourceHarness() {
  const showcase = element(), card = { hidden: true }, root = { querySelector: () => showcase, classList: { toggle() {}, remove() {} } };
  let onMessage, result = false, style = true;
  const receives = [];
  const engine = { receive(message) {
    receives.push(message);
    if (message.type === 'frame' && message.score) result = !!message.score.result;
    if (message.type === 'style') style = message.style.result;
    if (message.type === 'song' || message.type === 'seek' || message.type === 'clear') result = false;
    card.hidden = !result || !style;
  } };
  const context = { document: { getElementById: () => root }, window: {}, PracticeShowcase: Showcase,
    PracticeEngine: { createPracticeEngine: () => engine }, SocketClient: { init() {}, on(event, fn) { onMessage = fn; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/practice-overlay.js'), 'utf8'), context);
  return { showcase, card, receives, send: (message) => onMessage(message) };
}

test('OBS handles either recap/result order, obeys existing result visibility, and never replays result for recap updates', () => {
  for (const recapFirst of [true, false]) {
    const h = sourceHarness(); h.send({ type: 'song', song: { key: 'guide', trackId: 'track' } });
    const messages = [{ type: 'recap', recap }, { type: 'frame', score: { result: { score: 92 } } }];
    for (const message of recapFirst ? messages : messages.slice().reverse()) h.send(message);
    assert.equal(h.showcase.hidden, false); assert.equal(h.card.hidden, false);
    const before = h.receives.length; h.send({ type: 'recap', recap });
    assert.equal(h.receives.length, before, 'recap must not call engine or restart its result animation');
    h.send({ type: 'style', style: { result: false } }); assert.equal(h.card.hidden, true);
    h.send({ type: 'recap', recap }); assert.equal(h.card.hidden, true);
    h.send({ type: 'style', style: { result: true } }); assert.equal(h.card.hidden, false);
    h.send({ type: 'seek', offset: 0 }); assert.equal(h.showcase.hidden, true);
    h.send({ type: 'song', song: { key: 'new', trackId: 'new-track' } });
    h.send({ type: 'recap', recap }); assert.equal(h.showcase.hidden, true);
    h.send({ type: 'clear' }); h.send({ type: 'recap', recap }); assert.equal(h.showcase.hidden, true);
  }
});
