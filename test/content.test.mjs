import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeDocument } from './dom-stub.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const quotas = (() => {
  const c = vm.createContext({ console });
  vm.runInContext(read('src/core/quotas.js'), c);
  return c.Headroom;
})();

// Runs the real content-script bundle (exactly the manifest's file order) on a fake page at `host`.
async function loadContent(host, { settings, top = true, beforeContent, hidden = false, stored: extraStored } = {}) {
  const document = makeDocument();
  document.hidden = hidden;
  document.documentElement = { innerHTML: '', lang: 'en', appendChild: (n) => document.body.appendChild(n) };
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.cookie = '';
  const sent = [];
  const onMessage = [];
  const onChanged = [];
  const stored = { ...(settings ? { settings } : {}), ...(extraStored || {}) };
  const sandbox = {
    console: { ...console, warn() {}, log() {}, debug() {} },
    document, Date, URL, URLSearchParams, JSON, Promise, Math, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
    location: { hostname: host, origin: 'https://' + host, pathname: '/', href: `https://${host}/` },
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    MutationObserver: class { observe() {} disconnect() {} },
    EventTarget, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: () => null, setItem() {} }, navigator: {},
    fetch: async () => { throw new Error('offline'); },
    btoa, atob,
    chrome: {
      runtime: {
        id: 'ext', getManifest: () => ({ version: '1.0.0' }), getURL: (p) => p,
        sendMessage: (m) => { sent.push(m); return Promise.resolve(); },
        onMessage: { addListener: (fn) => onMessage.push(fn) },
      },
      storage: {
        local: { get: async (k) => (typeof k === 'string' ? (k in stored ? { [k]: stored[k] } : {}) : { ...stored }), set: async (o) => Object.assign(stored, o) },
        onChanged: { addListener: (fn) => onChanged.push(fn) },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (!top) sandbox.window = { ...sandbox, top: {} };
  const ctx = vm.createContext(sandbox);
  if (top) vm.runInContext('window.top = window', ctx);
  const files = ['src/core/quotas.js', ...quotas.CONTENT_BUNDLE.filter((f) => f !== 'src/core/quotas.js')];
  const unique = [...new Set(files)];
  for (const f of unique) {
    if (f === 'src/content.js' && beforeContent) beforeContent(ctx.Headroom);
    vm.runInContext(read(f), ctx, { filename: f });
  }
  await new Promise((r) => setTimeout(r, 30));
  const usage = () => sent.filter((m) => m.type === 'headroom:usage');
  return { AM: ctx.Headroom, sent, usage, onMessage, onChanged, stored, document, ctx };
}

test('every built-in provider host gets its own adapter', async () => {
  for (const p of quotas.PROVIDERS) {
    for (const h of p.hosts) {
      const c = await loadContent(h);
      assert.ok(c.usage().length > 0, `${h}: no usage message sent`);
      assert.equal(c.usage()[0].provider, p.id, `${h} should use the ${p.id} adapter`);
    }
  }
});

test('a subdomain of a provider host uses that provider', async () => {
  const c = await loadContent('beta.claude.ai');
  assert.equal(c.usage()[0].provider, 'claude');
});

test('an unrelated site gets no adapter: nothing is sent and no bar is mounted', async () => {
  const c = await loadContent('example.org');
  assert.equal(c.sent.length, 0);
  assert.equal(c.document.body.children.length, 0);
});

test('a look-alike host does not match (claude.ai.evil.test, notclaude.ai)', async () => {
  for (const h of ['claude.ai.evil.test', 'notclaude.ai', 'evilchatgpt.com']) {
    const c = await loadContent(h);
    assert.equal(c.usage().length, 0, h);
  }
});

test('a user-added site gets the counting adapter under a site: id with its own name', async () => {
  const settings = { customSites: [{ host: 'chat.example.test', name: 'Example Chat', limit: 40, windowHours: 5 }] };
  const c = await loadContent('chat.example.test', { settings });
  const u = c.usage().at(-1);
  assert.equal(u.provider, 'site:chat.example.test');
  assert.equal(u.name, 'Example Chat');
  assert.equal(u.meters[0].limit, 40, 'the limit set for the site is used');
  assert.equal(u.meters[0].windowHours, 5);
});

test('a user-added site is ignored if it is not in settings', async () => {
  const c = await loadContent('chat.example.test', { settings: { customSites: [{ host: 'other.test' }] } });
  assert.equal(c.usage().length, 0);
});

test('a named provider wins over a user-added site with the same host', async () => {
  const c = await loadContent('claude.ai', { settings: { customSites: [{ host: 'claude.ai', name: 'Mine' }] } });
  assert.equal(c.usage()[0].provider, 'claude');
});

test('the manifest, quotas.js and the adapters agree on which hosts exist', async () => {
  const c = await loadContent('claude.ai');
  const named = c.AM.adapters.flatMap((a) => a.hosts || []);
  for (const p of quotas.PROVIDERS) {
    if (!['claude', 'chatgpt', 'gemini', 'grok', 'perplexity', 'kimi'].includes(p.id)) continue;
    assert.ok(p.hosts.every((h) => named.includes(h)), `${p.id}: adapter hosts ${JSON.stringify(named)} miss ${p.hosts}`);
  }
});

test('the refresh message from the popup is answered', async () => {
  const c = await loadContent('claude.ai');
  assert.equal(c.onMessage.length > 0, true);
  let replied;
  const keep = c.onMessage.map((fn) => fn({ type: 'headroom:refresh' }, {}, (r) => { replied = r; }));
  assert.ok(keep.includes(true), 'async reply is kept open');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(JSON.parse(JSON.stringify(replied)), { ok: true });
});

test('a settings change re-applies without reloading the page', async () => {
  const c = await loadContent('claude.ai');
  const before = c.usage().length;
  c.onChanged.forEach((fn) => fn({ settings: { newValue: { widget: false } } }, 'local'));
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(c.usage().length > before, 'publishes again after a settings change');
});

// ---------- hardening: one broken adapter must not break the bar ----------

const brokenAdapter = (over) => (AM) => {
  AM.adapterFor = () => ({ id: 'broken', name: 'Broken', hosts: [], init() {}, ...over });
};

test("an adapter whose init throws still gets a bar and a visible can't-read-usage problem", async () => {
  const c = await loadContent('broken.example', { beforeContent: brokenAdapter({ init() { throw new Error('boom'); } }) });
  assert.ok(c.usage().length > 0, 'the report still goes out');
  const last = c.usage().at(-1);
  assert.equal(last.problem && last.problem.kind, 'error');
});

test('an adapter whose refresh throws (sync or async) is contained: the request is still answered', async () => {
  for (const refresh of [() => { throw new Error('sync'); }, async () => { throw new Error('async'); }]) {
    const c = await loadContent('broken.example', { beforeContent: brokenAdapter({ refresh }) });
    let replied = null;
    c.onMessage.forEach((fn) => fn({ type: 'headroom:refresh' }, {}, (r) => { replied = r; }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(replied && replied.ok, true);
    c.onChanged.forEach((fn) => fn({ settings: { newValue: {} } }, 'local')); // a settings change must not throw either
  }
});

test('weather: a hidden tab does not mount the sky until it becomes visible', async () => {
  let mounts = 0;
  const fakeSky = { destroy() {}, setStrength() {}, setState() {} };
  const opts = {
    settings: { weather: true, weatherPlace: { lat: 28.6, lon: 77.2, name: 'Test' }, weatherForce: { weather: 'clear' } },
    stored: {},
    beforeContent: (AM) => { AM.WeatherSky = { mount: () => { mounts++; return fakeSky; } }; },
  };
  const hiddenPage = await loadContent('claude.ai', { ...opts, hidden: true });
  assert.equal(mounts, 0, 'no mount while hidden');
  const fns = hiddenPage.document.listeners.visibilitychange || [];
  assert.ok(fns.length >= 1, 'a visibilitychange listener waits for the tab to be shown');
  hiddenPage.document.hidden = false;
  fns.forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(mounts, 1, 'mounts once the tab is visible');
});
