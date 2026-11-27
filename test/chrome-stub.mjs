// Shared test helper (not a test): a stubbed `chrome.*` plus a loader for background.js, the MV3 service worker.
// Pass the same `storage` to a second load to simulate the worker restarting with its stored state intact.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

export function makeStorage(initial = {}) {
  const data = clone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = clone(v); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
  };
}

export function loadBackground({ storage = makeStorage(), contains = async () => true, registered = [], fetch = async () => ({ ok: false, status: 503, json: async () => ({}) }) } = {}) {
  const notifications = [];
  const alarms = [];
  const badges = [];
  const registeredScripts = [];
  const tabsCreated = [];
  const listeners = { message: [], alarm: [], installed: [], startup: [], activated: [], storageChanged: [], actionClicked: [], notificationClicked: [] };
  const tabsOpen = []; // tabs the fake browser has open: { id, url, windowId }
  const tabCalls = [];
  // a match pattern like https://claude.ai/* or https://*.claude.ai/* against a tab url
  const matches = (pattern, u) => {
    const hostPat = pattern.split('://')[1].split('/')[0];
    const host = new URL(u).hostname;
    return u.startsWith('https://') && (hostPat.startsWith('*.') ? host.endsWith(hostPat.slice(1)) : host === hostPat);
  };
  let optionsOpened = 0;
  const executed = [];
  const event = (name) => ({ addListener: (fn) => listeners[name].push(fn) });
  const chrome = {
    runtime: { getURL: (p) => 'chrome-extension://x/' + p, onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'), openOptionsPage: async () => { optionsOpened++; } },
    storage: { local: storage, onChanged: event('storageChanged') },
    notifications: { create: (id, opts) => { notifications.push({ id, ...opts }); }, clear: () => {}, onClicked: event('notificationClicked') },
    windows: { update: async (id, info) => { tabCalls.push({ windowUpdate: id, ...info }); } },
    alarms: { create: (name, info) => { alarms.push({ name, ...info }); }, get: async () => undefined, clear: async () => true, onAlarm: event('alarm') },
    action: {
      onClicked: event('actionClicked'),
      setBadgeText: async (o) => { badges.push({ text: o.text }); },
      setBadgeBackgroundColor: async (o) => { badges.push({ color: o.color }); },
    },
    tabs: { query: async ({ url }) => tabsOpen.filter((t) => (url || []).some((p) => matches(p, t.url))), update: async (id, info) => { tabCalls.push({ tabUpdate: id, ...info }); }, onActivated: event('activated'), get: async () => ({ url: 'https://claude.ai/chat' }), create: async (o) => { tabsCreated.push(o); } },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (s) => { registeredScripts.push(...s); },
      executeScript: async (o) => { executed.push(o); },
    },
    permissions: { contains },
  };
  const sandbox = { console: { ...console, warn() {} }, chrome, setTimeout, clearTimeout, URL, Date, fetch };
  const ctx = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => files.forEach((f) => vm.runInContext(read('src/' + f), ctx, { filename: f }));
  vm.runInContext(read('src/background.js'), ctx, { filename: 'background.js' });

  const settle = () => new Promise((r) => setTimeout(r, 10));
  return {
    AM: ctx.Headroom, tabsOpen, tabCalls, optionsOpened: () => optionsOpened, notifications, alarms, badges, registeredScripts, tabsCreated, listeners, storage, settle, executed,
    // what content.js sends after each refresh
    async usage(provider, name, meters, problem = null, sender = { tab: { id: 1 } }) {
      listeners.message.forEach((fn) => fn({ type: 'headroom:usage', provider, name, meters, problem }, sender, () => {}));
      await settle();
    },
    // two senders at the same moment, without waiting in between
    async usageTogether(provider, name, meters) {
      listeners.message.forEach((fn) => {
        fn({ type: 'headroom:usage', provider, name, meters }, { tab: { id: 1 } }, () => {});
        fn({ type: 'headroom:usage', provider, name, meters }, { tab: { id: 2 } }, () => {});
      });
      await settle();
    },
    async fireAlarm(name) { for (const fn of listeners.alarm) await fn({ name }); await settle(); },
  };
}
