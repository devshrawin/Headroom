import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Regression tests for the weather-sky fixes that need no DOM or WebGL (the DOM behaviour is covered by e2e/e2e.mjs --bigislands etc.)
const src = readFileSync(new URL('../src/core/weather-sky.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext('globalThis.Headroom = {}', ctx);
vm.runInContext(src, ctx, { filename: 'weather-sky.js' });
const WS = ctx.Headroom.WeatherSky;

test('island queue: more than one frame of work is never dropped', () => {
  const q = WS.makeBatchQueue();
  const items = Array.from({ length: 15000 }, (_, i) => ({ i }));
  for (const x of items) q.add(x);
  const done = new Set();
  let frames = 0;
  while (q.size) { frames++; q.drain(6000, (x) => { done.add(x); return true; }); assert.ok(frames < 10); }
  assert.equal(frames, 3, '15000 items at 6000 per frame take three frames');
  assert.equal(done.size, 15000, 'every queued element was handled');
});

test('island queue: the time budget stops a frame early and keeps the rest', () => {
  const q = WS.makeBatchQueue();
  for (let i = 0; i < 1000; i++) q.add({ i });
  let calls = 0;
  const n = q.drain(6000, () => true, null, () => ++calls < 3); // budget runs out at the third check
  assert.ok(n > 0 && n < 1000);
  assert.equal(q.size, 1000 - n);
});

test('island queue: detached elements are skipped and not counted; deep entries queue their descendants once', () => {
  const q = WS.makeBatchQueue();
  const root = { id: 'root', kids: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  q.add({ id: 'gone', gone: true });
  q.add(root, true);
  const seen = [];
  const n = q.drain(100, (x) => { if (x.gone) return false; seen.push(x.id); return true; }, (x) => x.kids || []);
  assert.deepEqual(seen, ['root', 'a', 'b', 'c']);
  assert.equal(n, 4);
  assert.equal(q.size, 0);
  q.add(root, false); // the deep flag is not remembered after it was used
  const again = []; q.drain(100, (x) => { again.push(x.id); return true; }, (x) => x.kids || []);
  assert.deepEqual(again, ['root']);
});

test('island queue: a huge deep subtree is spread over frames, with no loss and no duplicates', () => {
  const q = WS.makeBatchQueue();
  const kids = Array.from({ length: 20000 }, (_, i) => ({ i }));
  q.add({ kids }, true);
  const seen = new Set(); let frames = 0, total = 0;
  while (q.size) { frames++; total += q.drain(6000, (x) => { seen.add(x); return true; }, (x) => x.kids || []); }
  assert.equal(total, 20001);
  assert.equal(seen.size, 20001);
  assert.ok(frames >= 4);
});

test('halo: content blocks are recognised, empty plates are not', () => {
  const el = (tagName, text) => ({ tagName, childNodes: text == null ? [] : [{ nodeType: 3, nodeValue: text }] });
  for (const t of ['TABLE', 'TR', 'TD', 'HR', 'BLOCKQUOTE', 'CODE', 'PRE', 'P', 'LI', 'H2', 'IMG']) assert.equal(WS.isContentBlock(el(t)), true, t);
  assert.equal(WS.isContentBlock(el('DIV', 'some text')), true, 'a div with text of its own');
  assert.equal(WS.isContentBlock(el('SPAN', 'x')), true);
  assert.equal(WS.isContentBlock(el('DIV')), false, 'an empty plate');
  assert.equal(WS.isContentBlock(el('DIV', '  \n ')), false, 'whitespace only');
  assert.equal(WS.isContentBlock({ tagName: 'DIV', childNodes: [{ nodeType: 1 }] }), false, 'child elements alone are not text');
});

test('ink band: off until the page text has taken the ink, then eases in', () => {
  let k = 0;
  for (let i = 0; i < 100; i++) k = WS.bandStep(k, false, .2, false);
  assert.equal(k, 0, 'stays at 0 while data-hr-ink is not set');
  k = WS.bandStep(k, true, .2, false);
  assert.ok(k > 0 && k < 1, 'eases in, does not jump');
  for (let i = 0; i < 60; i++) k = WS.bandStep(k, true, .2, false);
  assert.ok(k > .99);
  assert.equal(WS.bandStep(0, true, .2, true), 1, 'reduced motion: at once');
  assert.equal(WS.bandStep(NaN, false, .2, false), 0);
});

test('forced colours / more contrast: no sky', () => {
  const win = (on) => ({ matchMedia: (q) => ({ matches: on.includes(q) }) });
  assert.equal(WS.plainLook(win([])), false);
  assert.equal(WS.plainLook(win(['(forced-colors: active)'])), true);
  assert.equal(WS.plainLook(win(['(prefers-contrast: more)'])), true);
  assert.equal(WS.plainLook({}), false, 'no matchMedia: not plain');
});

test('mount returns null under forced colours before touching the page', () => {
  const touched = [];
  const doc = { createElement: () => { touched.push('createElement'); return {}; } };
  const c2 = vm.createContext({ console, document: doc, window: { matchMedia: (q) => ({ matches: q.includes('forced-colors') }) } });
  vm.runInContext('globalThis.Headroom = {}', c2);
  vm.runInContext(src, c2, { filename: 'weather-sky.js' });
  assert.equal(c2.Headroom.WeatherSky.mount({}), null);
  assert.deepEqual(touched, []);
});

test('theme read: skipped when the signature is unchanged, and at most once a second', () => {
  const g = WS.readGate;
  assert.equal(g('a', 'a', 5000, 0, 1000, false), -1, 'same signature: skip');
  assert.equal(g('b', 'a', 5000, 0, 1000, false), 0, 'changed, long ago: run now');
  assert.equal(g('b', 'a', 5300, 5000, 1000, false), 700, 'changed 300 ms after the last read: wait the rest of the second');
  assert.equal(g('a', 'a', 5300, 5000, 1000, true), 700, 'forced (system scheme flip) still honours the cap');
  assert.equal(g('b', 'a', 1, -Infinity, 1000, false), 0, 'the first read is never delayed');
});
