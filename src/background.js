importScripts('core/quotas.js', 'core/common.js', 'core/weather-data.js');

const AM = globalThis.Headroom;
const COLORS = { low: '#16a34a', mid: '#d97706', high: '#dc2626', none: '#78716c' };
const ICON = chrome.runtime.getURL('icons/icon128.png');

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return AM.mergeSettings(settings);
}

function setBadge(tabId, meters) {
  const top = AM.primaryMeter(meters);
  const pct = top ? AM.pctOf(top) : null;
  const text = pct != null ? String(Math.round(pct)) : top ? '•' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[AM.level(pct)] }).catch(() => {});
}

async function checkThresholds(entry, settings) {
  const { notified = {} } = await chrome.storage.local.get('notified');
  const thresholds = [...settings.thresholds].sort((a, b) => a - b);
  let changed = false;

  for (const m of entry.meters) {
    const pct = AM.pctOf(m);
    if (pct == null) continue;
    const key = `${entry.provider}|${m.id}`;
    const prev = notified[key] || 0;
    const reached = thresholds.filter((t) => pct >= t).pop() || 0;
    if (reached < prev) {
      notified[key] = reached;
      changed = true;
    } else if (reached > prev) {
      notified[key] = reached;
      changed = true;
      const reset = AM.resetText(m);
      chrome.notifications.create(`headroom|${key}|${reached}|${Date.now()}`, {
        type: 'basic',
        iconUrl: ICON,
        title: `${entry.name}: ${m.label} at ${Math.round(pct)}%`,
        message: reset ? reset[0].toUpperCase() + reset.slice(1) : 'Usage limit getting close.',
        priority: reached >= 100 ? 2 : 1,
      });
    }
    if (pct >= 90 && m.resetAt && m.resetAt > Date.now() + 30e3) {
      chrome.alarms.create(['reset', entry.provider, m.id, entry.name, m.label].map(encodeURIComponent).join('|'), { when: m.resetAt });
    }
  }
  if (changed) await chrome.storage.local.set({ notified });
}

let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'headroom:loadWeather') {
    // The weather sky's renderer, injected into the asking frame like the rest of the content scripts.
    if (!sender.tab || sender.tab.id == null) { sendResponse({ ok: false, error: 'no tab' }); return; }
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: AM.WEATHER_FILES })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg && msg.type === 'headroom:openSettings') {
    // The on-page panel's gear: content scripts cannot open the options page themselves.
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'headroom:weatherNow') {
    // The Settings page just chose a place: fetch now instead of waiting for the next alarm.
    refreshWeather().then((r) => sendResponse(r)).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (!msg || msg.type !== 'headroom:usage') return;
  const report = AM.validateUsageMessage(msg);
  if (!report) { console.warn('[Headroom] ignored a malformed usage report'); return; }
  // One at a time: two tabs reporting together would otherwise both read "notified" before either wrote it back.
  queue = queue.then(async () => {
    const entry = { provider: report.provider, name: report.name, meters: report.meters, problem: report.problem, updatedAt: Date.now() };
    await chrome.storage.local.set({ ['usage.' + report.provider]: entry });
    if (sender.tab && sender.tab.id != null) setBadge(sender.tab.id, entry.meters);
    const settings = await getSettings();
    if (settings.notify) await checkThresholds(entry, settings);
  }).catch((e) => console.warn('[Headroom]', e));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith('reset|')) return;
  const [, provider, id, name, label] = alarm.name.split('|').map(decodeURIComponent);
  queue = queue.then(async () => {
    const settings = await getSettings();
    const { notified = {} } = await chrome.storage.local.get('notified');
    delete notified[`${provider}|${id}`];
    await chrome.storage.local.set({ notified });
    if (!settings.notify) return;
    chrome.notifications.create(`headroom|reset|${provider}|${id}|${Date.now()}`, {
      type: 'basic',
      iconUrl: ICON,
      title: `${name}: ${label} has reset`,
      message: 'You should be good to go again.',
    });
  }).catch((e) => console.warn('[Headroom]', e));
});

// ---- weather: one fetch every 20 minutes, kept in storage, read by every tab ----
// Only the rounded coordinates of the chosen place go to the weather service (Open-Meteo), nothing else.
const WEATHER_ALARM = 'weather|refresh';
async function refreshWeather() {
  const settings = await getSettings();
  const place = settings.weatherPlace;
  if (!settings.weather || !place) { await chrome.storage.local.remove(['weather.data', 'weather.error']); return { ok: false, error: 'off' }; }
  try {
    const res = await fetch(AM.weatherUrl(place.lat, place.lon));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = AM.WEATHER.parseForecast(await res.json(), place.lat, place.lon);
    if (!data) throw new Error('the weather service sent something unexpected');
    await chrome.storage.local.set({ 'weather.data': data });
    await chrome.storage.local.remove('weather.error');
    return { ok: true, data };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 160);
    await chrome.storage.local.set({ 'weather.error': { error, t: Date.now() } });
    return { ok: false, error };
  }
}
async function syncWeatherAlarm() {
  const settings = await getSettings();
  if (settings.weather && settings.weatherPlace) {
    const existing = await chrome.alarms.get(WEATHER_ALARM);
    if (!existing) chrome.alarms.create(WEATHER_ALARM, { periodInMinutes: 20, delayInMinutes: 1 });
  } else await chrome.alarms.clear(WEATHER_ALARM);
}
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === WEATHER_ALARM) refreshWeather().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const a = AM.mergeSettings(changes.settings.oldValue), b = AM.mergeSettings(changes.settings.newValue);
  const samePlace = JSON.stringify(a.weatherPlace) === JSON.stringify(b.weatherPlace);
  if (a.weather !== b.weather || !samePlace) syncWeatherAlarm().then(() => (b.weather && b.weatherPlace ? refreshWeather() : undefined)).catch(() => {});
});

// Keep dynamic content scripts for user-added sites in step with settings (they can be dropped on update).
async function syncSites() {
  const settings = await getSettings();
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  for (const site of settings.customSites) {
    const origins = [`https://${site.host}/*`];
    if (!(await chrome.permissions.contains({ origins }))) continue;
    const missing = AM.siteScripts(site.host).filter((s) => !registered.has(s.id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing).catch((e) => console.warn('[Headroom]', e));
  }
}
chrome.runtime.onInstalled.addListener((details) => {
  syncSites().catch(() => {});
  syncWeatherAlarm().catch(() => {});
  // First install only (not updates): show the short "how it works" page.
  if (details && details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { syncSites().catch(() => {}); syncWeatherAlarm().catch(() => {}); refreshWeather().catch(() => {}); });

// No popup: the toolbar icon only carries the percentage badge; clicking it opens Settings.
chrome.action.onClicked.addListener(() => { chrome.runtime.openOptionsPage().catch(() => {}); });

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const provider = tab.url && AM.providerForHost(new URL(tab.url).hostname, await getSettings());
    if (!provider) return;
    const key = 'usage.' + provider.id;
    const got = await chrome.storage.local.get(key);
    if (got[key]) setBadge(tabId, got[key].meters);
  } catch {}
});
