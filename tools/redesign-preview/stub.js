(() => {
  const now = Date.now();
  const store = {
    settings: window.__SETTINGS__ || { weatherPlace: { name: 'Kochi, India', lat: 9.93, lon: 76.26 }, weatherBackground: window.__BG__ || 'sky' },
    'weather.data': { t: now - 6 * 60000, lat: 9.93, lon: 76.26, utcOffset: 19800, temp: 28.4, code: 2, cloud: 40, windKmh: 12, windDir: 250, precip: 0, rise: 6.3, set: 18.1 },
    'debug.log': [],
  };
  const listeners = [];
  const local = {
    async get(k) { if (k == null) return { ...store }; const ks = Array.isArray(k) ? k : [k]; const o = {}; for (const x of ks) if (x in store) o[x] = store[x]; return o; },
    async set(o) { const c = {}; for (const [k, v] of Object.entries(o)) { c[k] = { oldValue: store[k], newValue: v }; store[k] = v; } listeners.forEach((f) => f(c, 'local')); },
    async remove(k) { for (const x of [].concat(k)) delete store[x]; },
  };
  window.chrome = {
    storage: { local, onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { getManifest: () => ({ version: '1.4.6' }), sendMessage: async () => {} },
    permissions: { request: async () => true, contains: async () => true, remove: async () => true },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
})();
