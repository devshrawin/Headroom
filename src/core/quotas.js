// Provider registry, default estimate rules and settings. No chrome.* or DOM access here.
// Estimate rules are matched top-down against the model name seen in each send; first match wins.
(() => {
  const AM = (globalThis.Headroom = globalThis.Headroom || { adapters: [] });

  // source: what kind of number we can get. 'real' = provider-reported, 'estimate' = local counting.
  AM.PROVIDERS = [
    { id: 'claude', name: 'Claude', hosts: ['claude.ai'], source: 'real' },
    { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], source: 'estimate + real (Codex)' },
    { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], source: 'real' },
    { id: 'grok', name: 'Grok', hosts: ['grok.com'], source: 'real' },
    { id: 'perplexity', name: 'Perplexity', hosts: ['perplexity.ai'], source: 'real' },
    { id: 'kimi', name: 'Kimi', hosts: ['kimi.com'], source: 'real' },
    { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], source: 'estimate' },
    { id: 'qwen', name: 'Qwen', hosts: ['chat.qwen.ai'], source: 'estimate' },
    { id: 'mistral', name: 'Le Chat', hosts: ['chat.mistral.ai'], source: 'estimate' },
    { id: 'copilot', name: 'Copilot', hosts: ['copilot.microsoft.com', 'copilot.com'], source: 'estimate' },
    { id: 'meta', name: 'Meta AI', hosts: ['meta.ai'], source: 'estimate' },
    { id: 'poe', name: 'Poe', hosts: ['poe.com'], source: 'estimate' },
  ];

  // Must match the isolated-world content_scripts list in manifest.json (checked by tests).
  AM.CONTENT_BUNDLE = [
    'src/core/quotas.js',
    'src/core/common.js',
    'src/core/parsers.js',
    'src/core/store.js',
    'src/core/banner.js',
    'src/core/weather-data.js',
    'src/core/widget.js',
    'src/core/chatdom.js',
    'src/adapters/claude.js',
    'src/adapters/chatgpt.js',
    'src/adapters/gemini.js',
    'src/adapters/grok.js',
    'src/adapters/perplexity.js',
    'src/adapters/kimi.js',
    'src/adapters/generic.js',
    'src/content.js',
  ];

  // The weather sky is injected into a tab only when the weather is switched on (see content.js / background.js).
  AM.WEATHER_FILES = ['src/core/weather-sky.js'];

  AM.siteScripts = (host) => {
    const matches = [`https://${host}/*`];
    return [
      { id: 'headroom-main-' + host, matches, js: ['src/inject.js'], world: 'MAIN', runAt: 'document_start' },
      { id: 'headroom-iso-' + host, matches, js: AM.CONTENT_BUNDLE, runAt: 'document_start' },
    ];
  };

  const hostMatches =(host, h) => host === h || host.endsWith('.' + h);

  AM.customSiteFor = (host, settings) =>
    ((settings && settings.customSites) || []).find((s) => hostMatches(host, s.host));

  AM.providerForHost = (host, settings) => {
    const p = AM.PROVIDERS.find((x) => x.hosts.some((h) => hostMatches(host, h)));
    if (p) return p;
    const s = AM.customSiteFor(host, settings);
    return s ? { id: 'site:' + s.host, name: s.name || s.host, hosts: [s.host], source: 'estimate', custom: true } : undefined;
  };

  const count = (label, limit = 0, windowHours = 24) => [{ id: 'messages', label, pattern: '.*', limit, windowHours }];

  // Published limits as of 2026-09; they change often, so every rule is editable in settings.
  AM.DEFAULT_QUOTAS = {
    chatgpt: [
      { id: 'thinking', label: 'Thinking', pattern: 'thinking|^o\\d|-t-', limit: 3000, windowHours: 168 },
      { id: 'messages', label: 'Messages', pattern: '.*', limit: 160, windowHours: 3 },
    ],
    gemini: count('Prompts'),
    grok: count('Messages', 0, 168),
    perplexity: count('Queries'),
    kimi: count('Messages'),
    deepseek: count('Messages'),
    qwen: count('Messages'),
    mistral: count('Messages', 25, 24),
    copilot: count('Messages'),
    meta: count('Messages'),
    poe: count('Messages'),
  };

  AM.defaultQuotasFor = (id, settings) => {
    if (AM.DEFAULT_QUOTAS[id]) return AM.DEFAULT_QUOTAS[id];
    if (id.startsWith('site:')) {
      const s = ((settings && settings.customSites) || []).find((x) => 'site:' + x.host === id);
      if (s) return count('Messages', s.limit || 0, s.windowHours || 24);
    }
    return [];
  };

  AM.DEFAULT_SETTINGS = {
    widget: true,
    chatStats: true,
    meterStyle: 'bar-bottom', // 'bar-bottom' | 'bar-top' | 'bar-left' | 'bar-right': a thin bar along that edge of the page
    notify: true,
    thresholds: [75, 90, 100],
    debug: false,
    weather: true, // the weather sky behind the page (needs a place, see weatherPlace)
    weatherPlace: null, // { name, lat, lon }: where the weather is for, coordinates rounded to two decimals
    weatherUnits: 'c', // 'c' | 'f'
    weatherStrength: 1, // 0.2 .. 1: how strongly the sky shows through the page
    weatherForce: null, // Settings → "Try a look": { weather?, season?, tod? } instead of the real thing
    quotas: AM.DEFAULT_QUOTAS,
    customSites: [],
  };

  const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
  const cleanSites = (list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x.host === 'string' && HOST_RE.test(x.host) && x.host.length <= 253);
  const cleanThresholds = (list) => {
    const t = Array.isArray(list) ? list.filter((n) => typeof n === 'number' && isFinite(n) && n > 0 && n <= 100) : [];
    return t.length ? t : AM.DEFAULT_SETTINGS.thresholds;
  };

  const cleanPlace = (p) => {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { name: typeof p.name === 'string' ? p.name.slice(0, 80) : '', lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
  };
  const WEATHER_KEYS = ['clear', 'partly', 'overcast', 'drizzle', 'rain', 'storm', 'snow', 'fog'];
  const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter', 'monsoon'];
  const cleanForce = (f) => {
    if (!f || typeof f !== 'object') return null;
    const out = {};
    if (WEATHER_KEYS.includes(f.weather)) out.weather = f.weather;
    if (SEASON_KEYS.includes(f.season)) out.season = f.season;
    if (typeof f.tod === 'number' && isFinite(f.tod) && f.tod >= 0 && f.tod < 24) out.tod = f.tod;
    return Object.keys(out).length ? out : null;
  };

  AM.mergeSettings = (s) => ({
    ...AM.DEFAULT_SETTINGS,
    ...(s || {}),
    quotas: { ...AM.DEFAULT_QUOTAS, ...((s && s.quotas) || {}) },
    meterStyle: s && ['bar-top', 'bar-left', 'bar-right'].includes(s.meterStyle) ? s.meterStyle : 'bar-bottom',
    weather: !(s && s.weather === false),
    weatherPlace: cleanPlace(s && s.weatherPlace),
    weatherUnits: s && s.weatherUnits === 'f' ? 'f' : 'c',
    weatherStrength: typeof (s && s.weatherStrength) === 'number' && isFinite(s.weatherStrength) ? Math.min(1, Math.max(0.2, s.weatherStrength)) : 1,
    weatherForce: cleanForce(s && s.weatherForce),
    thresholds: cleanThresholds(s && s.thresholds),
    customSites: cleanSites(s && s.customSites),
  });
})();
