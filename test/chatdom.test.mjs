import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A tiny fake page: message nodes with text, a querySelectorAll that returns them, and a MutationObserver we can fire by hand.
function setup() {
  const messages = [];
  let reads = 0; // how many times a message's text was read (the expensive part)
  const mk = (text) => {
    const m = { nodeType: 1, _t: text, closest: (s) => (s === '.msg' ? m : null), parentElement: null };
    Object.defineProperty(m, 'textContent', { get() { reads++; return m._t; } });
    return m;
  };
  let observerCb = null;
  const doc = { body: {}, querySelectorAll: () => messages.slice() };
  const chats = [];
  const timers = [];
  const sandbox = {
    console, document: doc, location: { pathname: '/chat/1' },
    MutationObserver: class { constructor(cb) { observerCb = cb; } observe() {} disconnect() {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.Headroom = {}', ctx);
  vm.runInContext(readFileSync(new URL('../src/core/chatdom.js', import.meta.url), 'utf8'), ctx, { filename: 'chatdom.js' });
  const AM = ctx.Headroom;
  AM.every = (fn) => timers.push(fn);
  const c = { visible: () => true, setChat: (v) => chats.push(v) };
  return {
    messages, mk, chats, AM, c, doc,
    start: () => AM.watchDomChat(c, { selector: '.msg', ratio: 0.25 }),
    tick: () => timers.forEach((f) => f()),
    mutate: (records) => observerCb(records),
    reads: () => reads, resetReads: () => { reads = 0; },
  };
}

test('chat stats: tokens come from the message text, and a message is re-read only when it changed', () => {
  const t = setup();
  t.messages.push(t.mk('a'.repeat(400)), t.mk('b'.repeat(400)), t.mk('c'.repeat(400)));
  t.start();
  assert.equal(t.chats.at(-1).tokens, 300);
  assert.equal(t.chats.at(-1).messages, 3);
  assert.equal(t.reads(), 3, 'every message is read once at the start');
  t.resetReads();
  t.tick(); t.tick();
  assert.equal(t.reads(), 0, 'nothing changed: no message is read again');
  // the last message streams more text
  t.messages[2]._t += 'd'.repeat(400);
  t.mutate([{ type: 'characterData', target: { nodeType: 3, parentElement: t.messages[2] }, addedNodes: [] }]);
  t.tick();
  assert.equal(t.reads(), 1, 'only the changed message is read');
  assert.equal(t.chats.at(-1).tokens, 400);
});

test('chat stats: a new message is counted, a removed one is dropped, and no chat reports null', () => {
  const t = setup();
  t.messages.push(t.mk('x'.repeat(400)));
  t.start();
  assert.equal(t.chats.at(-1).messages, 1);
  const m2 = t.mk('y'.repeat(400));
  t.messages.push(m2);
  t.mutate([{ type: 'childList', target: {}, addedNodes: [m2] }]);
  t.tick();
  assert.equal(t.chats.at(-1).messages, 2);
  assert.equal(t.chats.at(-1).tokens, 200);
  t.messages.shift();
  t.mutate([{ type: 'childList', target: {}, addedNodes: [], removedNodes: [] }]);
  t.tick();
  assert.equal(t.chats.at(-1).messages, 1);
  assert.equal(t.chats.at(-1).tokens, 100);
  t.messages.length = 0;
  t.tick();
  assert.equal(t.chats.at(-1), null);
});

test('chat stats: without a MutationObserver it still works (re-reads every time)', () => {
  const t = setup();
  t.messages.push(t.mk('z'.repeat(400)));
  const ctx = vm.createContext({ console, document: t.doc, location: { pathname: '/c' } }); // no MutationObserver here
  vm.runInContext('globalThis.Headroom = {}', ctx);
  vm.runInContext(readFileSync(new URL('../src/core/chatdom.js', import.meta.url), 'utf8'), ctx);
  const out = [], timers = [];
  ctx.Headroom.every = (f) => timers.push(f);
  ctx.Headroom.watchDomChat({ visible: () => true, setChat: (v) => out.push(v) }, { selector: '.msg', ratio: 0.25 });
  t.messages[0]._t += 'q'.repeat(400);
  timers.forEach((f) => f());
  assert.equal(out.at(-1).tokens, 200, 'picks up the change with no observer');
});
