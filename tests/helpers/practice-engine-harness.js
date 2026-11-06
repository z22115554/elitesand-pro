'use strict';
const path = require('node:path');
const Fx = require('../../public/js/practice/practice-fx');
const Scoring = require('../../public/js/practice/practice-scoring');

function loadEngine(sourceFile) {
  globalThis.PracticeScoring = Scoring;
  globalThis.PracticeFx = Fx;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.document = { createElement: () => fakeElement() };
  globalThis.window = { devicePixelRatio: 1 };
  const file = sourceFile || path.join(__dirname, '..', '..', 'public', 'js', 'practice', 'practice-engine.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return globalThis.PracticeEngine;
}

function fakeElement() {
  const classes = new Set();
  return {
    hidden: false, textContent: '', innerHTML: '', children: [], style: { setProperty() {} }, offsetWidth: 0,
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
    appendChild() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 50, right: 100 }),
  };
}

function fakeRoot() {
  const els = new Map();
  const canvas = { ...fakeElement(), clientWidth: 0, clientHeight: 0, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) };
  const root = fakeElement();
  root.style = { setProperty() {} };
  root.querySelector = (sel) => {
    const name = /data-ps="([^"]+)"/.exec(sel)[1];
    if (name === 'canvas') return canvas;
    if (!els.has(name)) els.set(name, fakeElement());
    return els.get(name);
  };
  return root;
}

module.exports = { loadEngine, fakeRoot };
