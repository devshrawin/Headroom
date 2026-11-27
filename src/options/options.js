// Headroom settings: one page at a time, everything saves as you change it.
const AM = globalThis.Headroom;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
let S;
let page = 'weather';
let query = '';

// ---------- pages ----------
const IC = {
  sun: 'M8 10.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5 M8 1.5v1.5 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1',
  gauge: 'M2.8 11.5a5.5 5.5 0 1 1 10.4 0 M8 9l2.2-2.2',
  sliders: 'M3 4h10 M3 8h10 M3 12h10 M6 2.5v3 M10 6.5v3 M5 10.5v3',
  bell: 'M4 11.5h8l-1-1.5V7a3 3 0 0 0-6 0v3z M6.5 13a1.5 1.5 0 0 0 3 0',
  globe: 'M8 14a6 6 0 1 0 0-12a6 6 0 1 0 0 12 M2 8h12 M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14C6.3 12.2 5.5 10.2 5.5 8S6.3 3.8 8 2',
  box: 'M2.5 5.5l5.5-3 5.5 3v5l-5.5 3-5.5-3z M2.5 5.5L8 8.5l5.5-3 M8 8.5v5',
  help: 'M8 14a6 6 0 1 0 0-12a6 6 0 1 0 0 12 M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3 M8 11.2h.01',
  search: 'M7 12a5 5 0 1 0 0-10a5 5 0 1 0 0 10 M10.6 10.6L14 14',
  chev: 'M6 4l4 4-4 4',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="${IC[n]}"></path></svg>`;
const PAGES = [
  { id: 'weather', label: 'Weather', icon: 'sun', title: 'Weather', desc: 'The real weather as a living sky behind your AI chat.' },
  { id: 'meter', label: 'Meter', icon: 'gauge', title: 'Meter', desc: 'The thin usage bar along the edge of the page.' },
  { id: 'limits', label: 'Limits', icon: 'sliders', title: 'Estimate limits', desc: 'For sites that show no usage, Headroom counts your messages against limits you set.' },
  { id: 'alerts', label: 'Notifications', icon: 'bell', title: 'Notifications', desc: 'Desktop alerts as a limit fills up and when it resets.' },
  { id: 'sites', label: 'Other AI sites', icon: 'globe', title: 'Other AI sites', desc: 'Add any AI chat site that is not built in.' },
  { id: 'data', label: 'Backup and data', icon: 'box', title: 'Backup and data', desc: 'Export your settings, bring them back, or start fresh.' },
  { id: 'help', label: 'Help and debug', icon: 'help', title: 'Help and debug', desc: 'Version, privacy, and the debug log for when a number looks wrong.' },
];
const INDEX = [
  ['Show the weather', 'weather'], ['Your place and location', 'weather'], ['City search', 'weather'], ['Temperature units', 'weather'], ['Sky strength', 'weather'],
  ['Try a look: weather, season, time of day', 'weather'], ['Show the meter', 'meter'], ['Meter position: top, bottom, left or right', 'meter'], ['Chat length and cache details', 'meter'],
  ['Estimate limits and rules', 'limits'], ['Notification thresholds', 'alerts'], ['Desktop notifications', 'alerts'], ['Add a site', 'sites'],
  ['Export settings', 'data'], ['Import settings', 'data'], ['Restore defaults', 'data'], ['Clear usage data', 'data'], ['Debug log', 'help'], ['Privacy policy', 'help'],
];

// ---------- saving ----------
let saveTimer = 0, statusTimer = 0;
// What this page last wrote, in a key-order-independent form, so its own writes are told apart from changes made elsewhere.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const written = [];
const remember = (v) => { written.push(canon(v)); if (written.length > 20) written.shift(); };
function status(msg, ms = 2600) {
  const el = $('#saved');
  el.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = 'All changes saved'; }, ms);
}
function save() {
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Saving…';
  saveTimer = setTimeout(async () => {
    S = AM.mergeSettings(S);
    remember(S);
    await chrome.storage.local.set({ settings: S });
    status('All changes saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 4000);
  }, 300);
}
async function saveNow() {
  clearTimeout(saveTimer);
  S = AM.mergeSettings(S);
  remember(S);
  await chrome.storage.local.set({ settings: S });
}

// ---------- row helpers ----------
const row = (title, desc, control) => `<div class="set-row"><div class="set-l"><div class="set-t">${title}</div>${desc ? `<div class="set-d">${desc}</div>` : ''}</div><div class="set-c">${control}</div></div>`;
const sw = (k, label, on) => `<label class="sw"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span class="tr"></span><span>${esc(label)}</span></label>`;
const seg = (k, opts, cur, label) => `<div class="seg" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}>${opts.map(([v, l]) => `<label><input type="radio" name="${k}" data-k="${k}" value="${esc(v)}" ${v === cur ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

// ---------- weather ----------
const TODS = [['live', 'Live'], ['6.4', 'Dawn'], ['9', 'Morning'], ['12.5', 'Noon'], ['17.3', 'Golden hour'], ['18.4', 'Sunset'], ['23', 'Night']];
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
}
async function weatherPage() {
  const got = await chrome.storage.local.get(['weather.data', 'weather.error']);
  const data = got['weather.data'] || null, err = got['weather.error'] || null;
  const place = S.weatherPlace;
  const d = data ? AM.WEATHER.describe(data, S.weatherUnits, null) : null;
  const f = S.weatherForce || {};
  const W = AM.WEATHER.WEATHERS, SE = AM.WEATHER.SEASONS;
  const placeHtml = place
    ? `<span class="pill-st ok"><span class="dot"></span>${esc(place.name || 'Your place')}</span> <span class="muted">${place.lat}, ${place.lon}</span>`
    : `<span class="pill-st warn"><span class="dot"></span>Not set yet</span>`;
  const now = d
    ? `<div class="big">${esc(d.temp)} <span style="font-size:18px">${esc(d.label)}</span></div><div class="muted">${esc(d.season)} · wind ${d.wind} km/h · updated ${ago(data.t)}</div>`
    : `<div class="muted">${place ? 'No weather yet. It loads in a moment, or press refresh.' : 'Choose a place first.'}</div>`;
  return `
  <h1 class="page-h">Weather</h1><p class="page-d">${PAGES[0].desc}</p>
  <section class="card">
    ${row('Show the weather', 'A background behind the chat on the AI sites you use. It never blocks the page or your clicks.', sw('weather', 'On', S.weather))}
    ${row('Background', 'The real weather as a living sky, or a dark fluid that swirls and follows your cursor (it needs no place).', seg('weatherStyle', [['sky', 'Weather sky'], ['fluid', 'Fluid']], S.weatherStyle, 'Background style'))}
    ${row('Your place', 'Where the weather is for. Pick one of the two ways.', `
      <div>${placeHtml}</div>
      <div class="row"><button class="btn primary" type="button" data-act="locate">Use my location</button><span class="muted">asks Chrome once</span></div>
      <div class="row"><input class="wide" id="city" type="search" placeholder="or type a city, then press Enter" aria-label="City"><button class="btn" type="button" data-act="search">Search</button></div>
      <div id="found" class="results" hidden></div>
      <div id="wmsg" class="muted" role="status"></div>`)}
    ${row('Right now', 'Refreshed every 20 minutes in the background.', `${now}${err ? `<div class="note warn">Could not reach the weather service: ${esc(err.error)}</div>` : ''}<div class="row"><button class="btn sm" type="button" data-act="refresh" ${place ? '' : 'disabled'}>Refresh now</button></div>`)}
    ${row('Frosted strips', 'Blur the page behind the header and the strip around the message box, so text scrolling under them stays hidden while the sky still shows. Off by default.', sw('frostedStrips', 'On', S.frostedStrips))}
    ${row('Units', '', seg('weatherUnits', [['c', '°C'], ['f', '°F']], S.weatherUnits, 'Temperature units'))}
    ${row('Sky strength', 'How strongly the sky shows through the page. Text on the sky switches between dark and white on its own, so it stays readable at any setting.', `<input type="range" min="20" max="100" step="5" value="${Math.round(S.weatherStrength * 100)}" data-k="weatherStrength" data-div="100" aria-label="Sky strength"><div class="muted" id="strv">${Math.round(S.weatherStrength * 100)}%</div>`)}
  </section>
  <section class="card">
    <div class="card-h">Try a look</div>
    ${row('Weather and time', 'See any weather, season or hour on your pages, for testing. Live shows the real thing.', `
      <div class="row">${sel('f-w', [['live', 'Live weather'], ...Object.keys(W).map((k) => [k, W[k].label])], f.weather || 'live')}${sel('f-s', [['live', 'Live season'], ...Object.keys(SE).map((k) => [k, SE[k].label])], f.season || 'live')}${sel('f-t', TODS, typeof f.tod === 'number' ? String(f.tod) : 'live')}</div>
      <div class="row"><button class="btn sm" type="button" data-act="live">Back to live</button></div>`)}
  </section>
  <section class="card">
    ${row('What leaves your computer', '', `<div class="note">Only the <b>rounded coordinates</b> of the place you choose (about 1&nbsp;km) go to <b>open-meteo.com</b>, a free weather service, to ask for the forecast. Your location is never sent anywhere else, never tied to who you are, and the place is not part of exported settings. If you type a city name, that text is sent to Open-Meteo's free geocoding service to find the place. Turn the weather off and nothing is sent.</div>`)}
  </section>`;
}

async function setPlace(p) {
  S.weatherPlace = { name: p.name, lat: p.lat, lon: p.lon };
  S.weather = true;
  await saveNow();
  $('#wmsg') && ($('#wmsg').textContent = 'Place saved. Loading the weather…');
  try { await chrome.runtime.sendMessage({ type: 'headroom:weatherNow' }); } catch {}
  status('Place saved');
  render();
}
function useLocation() {
  // An extension page asks for the location with Chrome's normal location prompt, so no manifest permission is needed.
  // (Look #wmsg up again on each update: render() may replace it.)
  const say = (t) => { const m = $('#wmsg'); if (m) m.textContent = t; };
  if (!navigator.geolocation) return say('This browser cannot give a location. Type a city instead.');
  say('Asking Chrome for your location… look for a prompt near the address bar.');
  try {
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ name: 'Your location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (e) => say(e && e.code === 1
        ? 'Chrome did not give access. Allow location for this page (the icon at the left of the address bar), or type a city instead.'
        : 'Location was not available (' + ((e && e.message) || 'unknown reason') + '). Check that Windows location is on, or type a city instead.'),
      { timeout: 20000, maximumAge: 600000 });
  } catch (e) { say('Location failed (' + ((e && e.message) || e) + '). Type a city instead.'); }
}
async function searchCity() {
  const q = ($('#city') && $('#city').value || '').trim();
  const msg = $('#wmsg');
  if (!q) { if (msg) msg.textContent = 'Type a city name.'; return; }
  if (msg) msg.textContent = 'Searching…';
  try {
    const j = await (await fetch(AM.geocodeUrl(q))).json();
    const list = (j && j.results) || [];
    const box = $('#found');
    if (!list.length) { if (msg) msg.textContent = 'No city found. Try another spelling.'; if (box) box.hidden = true; return; }
    if (msg) msg.textContent = '';
    box.hidden = false;
    box.innerHTML = list.slice(0, 5).map((r, i) => `<button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span class="muted">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></button>`).join('');
    box._list = list;
  } catch (e) { if (msg) msg.textContent = 'Search failed: ' + e.message; }
}
function pickForce() {
  const w = $('#f-w').value, s = $('#f-s').value, t = $('#f-t').value;
  const out = {};
  if (w !== 'live') out.weather = w;
  if (s !== 'live') out.season = s;
  if (t !== 'live') out.tod = Number(t);
  S.weatherForce = Object.keys(out).length ? out : null;
  save();
}

// ---------- meter, alerts ----------
function meterPage() {
  return `<h1 class="page-h">Meter</h1><p class="page-d">${PAGES[1].desc}</p>
  <section class="card">
    ${row('Show the meter', 'Point at the bar for the percentage and when it resets, click it for the details.', sw('widget', 'On', S.widget))}
    ${row('Position', 'Which edge of the page the bar sits on. You can also drag the bar to another edge.', seg('meterStyle', [['bar-top', 'Top'], ['bar-bottom', 'Bottom'], ['bar-left', 'Left'], ['bar-right', 'Right']], S.meterStyle, 'Bar position'))}
    ${row('Chat details', 'Show the length of the open chat, the cache timer and the cost of your next message in the details panel (Claude, ChatGPT, Gemini).', sw('chatStats', 'On', S.chatStats))}
  </section>`;
}
function alertsPage() {
  return `<h1 class="page-h">Notifications</h1><p class="page-d">${PAGES[3].desc}</p>
  <section class="card">
    ${row('Desktop notifications', 'A notice when a limit crosses a threshold, and when it resets. They contain only the service, the meter and the percentage.', sw('notify', 'On', S.notify))}
    ${row('Thresholds', 'Percent used, separated by commas.', `<input class="wide" type="text" data-k="thresholds" value="${esc(S.thresholds.join(', '))}" aria-label="Notification thresholds in percent">`)}
  </section>`;
}

// ---------- limits ----------
const editable = () => [
  ...AM.PROVIDERS.filter((p) => p.id !== 'claude').map((p) => ({ id: p.id, name: `${p.name}: ${p.source}` })),
  ...S.customSites.map((s) => ({ id: 'site:' + s.host, name: `${s.host}: estimate` })),
];
function limitsPage() {
  const blocks = editable().map(({ id, name }) => {
    const rules = S.quotas[id] || AM.defaultQuotasFor(id, S);
    return `<div class="prov" data-provider="${esc(id)}"><h3>${esc(name)}</h3><div class="tbl-wrap"><table class="tbl" aria-label="${esc(name)} estimate rules">
      <thead><tr><th>Label</th><th>Model pattern (regex)</th><th>Limit</th><th>Window (h)</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>
      ${rules.map((r) => ruleRow(r)).join('')}
      </tbody></table></div><div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-add-rule="${esc(id)}">+ Add rule</button></div></div>`;
  }).join('');
  return `<h1 class="page-h">Estimate limits</h1><p class="page-d">${PAGES[2].desc} These are published figures that change often: set them to match your plan.</p><section class="card" id="quotas">${blocks}</section>`;
}
function ruleRow(r) {
  return `<tr data-id="${esc(r.id)}"><td><input type="text" data-f="label" value="${esc(r.label)}" aria-label="${esc(r.label)} label"></td><td><input type="text" data-f="pattern" value="${esc(r.pattern)}" aria-label="${esc(r.label)} model pattern"></td><td class="num"><input type="number" min="0" data-f="limit" value="${esc(r.limit)}" aria-label="${esc(r.label)} limit"></td><td class="num"><input type="number" min="0.1" step="0.5" data-f="windowHours" value="${esc(r.windowHours)}" aria-label="${esc(r.label)} window in hours"></td><td><button class="x" type="button" data-del-rule title="Remove rule" aria-label="Remove ${esc(r.label)}">×</button></td></tr>`;
}
function readQuotas() {
  const quotas = {};
  for (const box of document.querySelectorAll('#quotas .prov')) {
    const rules = [];
    for (const tr of box.querySelectorAll('tr[data-id]')) {
      const get = (f) => tr.querySelector(`[data-f="${f}"]`).value;
      const pattern = get('pattern') || '.*';
      try { new RegExp(pattern); } catch { throw new Error(`"${pattern}" is not a valid pattern`); }
      rules.push({ id: tr.dataset.id, label: get('label') || 'Rule', pattern, limit: Math.max(0, Number(get('limit')) || 0), windowHours: Math.max(0.1, Number(get('windowHours')) || 24) });
    }
    quotas[box.dataset.provider] = rules;
  }
  return quotas;
}

// ---------- other sites ----------
const scriptIds = (host) => ['headroom-main-' + host, 'headroom-iso-' + host];
function sitesPage() {
  const list = S.customSites.length
    ? `<ul class="sites">${S.customSites.map((s) => `<li><b>${esc(s.host)}</b><span class="muted">${s.limit ? `${s.limit} per ${s.windowHours}h` : `counting, ${s.windowHours}h window`}</span><button class="x" type="button" data-rm-site="${esc(s.host)}" title="Remove site" aria-label="Remove ${esc(s.host)}">×</button></li>`).join('')}</ul>`
    : '<div class="muted">No extra sites yet.</div>';
  return `<h1 class="page-h">Other AI sites</h1><p class="page-d">${PAGES[4].desc} Chrome asks for access to <b>that one site only</b>.</p>
  <section class="card">
    ${row('Your sites', '', list)}
    ${row('Add a site', 'Headroom counts your sends there and watches for the site\'s own limit notices.', `
      <input class="wide" id="siteHost" type="text" placeholder="chat.example.com" aria-label="Site address">
      <div class="row"><input class="num" id="siteLimit" type="number" min="0" placeholder="Limit" aria-label="Limit"><input class="num" id="siteWindow" type="number" min="0.1" step="0.5" placeholder="Hours" aria-label="Window in hours"><button class="btn primary" type="button" data-act="addSite">Add site</button></div>
      <div class="muted" id="smsg" role="status"></div>`)}
  </section>`;
}
async function addSite() {
  const host = $('#siteHost').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  const msg = (t) => { $('#smsg').textContent = t; };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return msg('Enter a hostname like chat.example.com');
  if (AM.providerForHost(host, S)) return msg(`${host} is already tracked.`);
  const granted = await chrome.permissions.request({ origins: [`https://${host}/*`] }); // first await: still a user gesture
  if (!granted) return msg('Chrome access to that site was not granted.');
  try {
    await chrome.scripting.unregisterContentScripts({ ids: scriptIds(host) }).catch(() => {});
    await chrome.scripting.registerContentScripts(AM.siteScripts(host));
  } catch (e) { return msg('Could not register: ' + e.message); }
  S.customSites = [...S.customSites, { host, limit: Math.max(0, Number($('#siteLimit').value) || 0), windowHours: Math.max(0.1, Number($('#siteWindow').value) || 24) }];
  await saveNow();
  status(`Added ${host}. Reload its tab to start tracking.`, 6000);
  render();
}
async function removeSite(host) {
  await chrome.scripting.unregisterContentScripts({ ids: scriptIds(host) }).catch(() => {});
  await chrome.permissions.remove({ origins: [`https://${host}/*`] }).catch(() => {});
  const quotas = { ...S.quotas };
  delete quotas['site:' + host];
  S.quotas = quotas;
  S.customSites = S.customSites.filter((s) => s.host !== host);
  await saveNow();
  await chrome.storage.local.remove(['usage.site:' + host, 'events.site:' + host]);
  status(`Removed ${host}.`);
  render();
}

// ---------- backup and data ----------
function dataPage() {
  return `<h1 class="page-h">Backup and data</h1><p class="page-d">${PAGES[5].desc}</p>
  <section class="card">
    ${row('Back up your settings', 'A file with your limits, thresholds and meter and weather options. Never usage data, the debug log, or your weather place.', `<div class="row"><button class="btn" type="button" data-act="export">Export settings</button><button class="btn" type="button" data-act="import">Import settings</button></div>`)}
    ${row('Restore defaults', 'Puts every setting back as it was on install. Your added sites stay.', `<div><button class="btn" type="button" data-act="defaults">Restore defaults</button></div>`)}
    ${row('Clear usage data', 'Forgets the usage numbers, message counts and alert history. Settings stay.', `<div><button class="btn danger" type="button" data-act="clearData">Clear usage data</button></div>`)}
  </section>`;
}
async function doImport(file) {
  const parsed = AM.parseImport(await file.text());
  if (!parsed.ok) return status(parsed.error, 8000);
  if (!confirm('Replace your current settings with the ones in this file? Your usage numbers are not touched.')) return;
  const have = new Set(S.customSites.map((x) => x.host));
  const skipped = [];
  const sites = [...S.customSites];
  for (const site of parsed.sites) {
    if (have.has(site.host)) continue;
    if (await chrome.permissions.contains({ origins: ['https://' + site.host + '/*'] })) sites.push(site); else skipped.push(site.host);
  }
  S = AM.mergeSettings({ ...S, ...parsed.settings, quotas: { ...S.quotas, ...(parsed.settings.quotas || {}) }, customSites: sites, weatherPlace: S.weatherPlace });
  await saveNow();
  status(skipped.length ? 'Imported. Add these sites again to track them: ' + skipped.join(', ') : 'Settings imported.', skipped.length ? 12000 : 4000);
  render();
}

// ---------- help ----------
async function helpPage() {
  const { 'debug.log': log = [] } = await chrome.storage.local.get('debug.log');
  const text = log.length ? log.map((e) => `${new Date(e.t).toLocaleTimeString()}  ${e.provider}  ${e.kind}  ${e.method || ''} ${e.status || ''}  ${e.url}${e.body ? '\n    ' + e.body : ''}`).join('\n') : 'Nothing logged yet.';
  return `<h1 class="page-h">Help and debug</h1><p class="page-d">${PAGES[6].desc}</p>
  <section class="card">
    ${row('Version', '', `<div>Headroom ${esc(chrome.runtime.getManifest().version)}</div>`)}
    ${row('Privacy', 'Everything stays on your computer. No account, no server, message text is never stored.', `<div><a href="https://github.com/devshrawin/Headroom/blob/main/docs/privacy.md" target="_blank" rel="noopener noreferrer">Read the privacy policy</a></div>`)}
    ${row('Debug log', 'Records the shape of the usage requests (never message text) so a wrong number can be traced. Off by default.', `${sw('debug', 'Record the debug log', S.debug)}<pre class="log" id="log">${esc(text)}</pre><div class="row"><button class="btn sm" type="button" data-act="copyLog">Copy</button><button class="btn sm" type="button" data-act="clearLog">Clear</button></div>`)}
  </section>
  <p class="muted">Headroom is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI, Google, xAI, Perplexity, Moonshot AI, DeepSeek, Alibaba, Mistral AI, Microsoft, Meta or Quora. Names are trademarks of their owners.</p>`;
}

// ---------- shell ----------
function navHtml() {
  const q = query.trim().toLowerCase();
  return `<div class="search">${ic('search')}<input id="nav-q" type="search" placeholder="Search settings" aria-label="Search settings" value="${esc(query)}"></div>` +
    PAGES.map((p) => `<a href="#${p.id}" ${page === p.id && !q ? 'aria-current="page"' : ''}>${ic(p.icon)}${esc(p.label)}</a>`).join('');
}
function resultsHtml() {
  const q = query.trim().toLowerCase();
  const hits = INDEX.filter(([t, id]) => (t + ' ' + id).toLowerCase().includes(q));
  return `<h1 class="page-h">Results for “${esc(query)}”</h1><p class="page-d">${hits.length} setting${hits.length === 1 ? '' : 's'} match.</p><section class="card">${hits.map(([t, id]) => `<a class="lrow" href="#${id}" data-result="${id}">${ic(PAGES.find((p) => p.id === id).icon)}<span style="flex:1">${esc(t)}<br><span class="muted">${esc(PAGES.find((p) => p.id === id).label)}</span></span>${ic('chev')}</a>`).join('') || '<div class="set-row"><div class="muted">Nothing matches. Try “weather”, “limit” or “bar”.</div></div>'}</section>`;
}
async function render() {
  const keepSearch = document.activeElement && document.activeElement.id === 'nav-q' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  $('#nav').innerHTML = navHtml();
  if (keepSearch) { const n = $('#nav-q'); n.focus(); n.setSelectionRange(...keepSearch); }
  const pages = { weather: weatherPage, meter: meterPage, limits: limitsPage, alerts: alertsPage, sites: sitesPage, data: dataPage, help: helpPage };
  main.innerHTML = query.trim() ? resultsHtml() : await pages[page]();
}
function go(id) { query = ''; page = PAGES.some((p) => p.id === id) ? id : 'weather'; history.replaceState(null, '', '#' + page); render(); scrollTo(0, 0); }

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const a = e.target.closest('.nav a[href^="#"], a[data-result]');
  if (a) { e.preventDefault(); return go(a.getAttribute('href').slice(1)); }
  const pick = e.target.closest('[data-pick]');
  if (pick) { const box = $('#found'); const r = box._list[+pick.dataset.pick]; return setPlace({ name: r.name + (r.country ? ', ' + r.country : ''), lat: r.latitude, lon: r.longitude }); }
  const rm = e.target.closest('[data-rm-site]');
  if (rm) return removeSite(rm.dataset.rmSite);
  const delRule = e.target.closest('[data-del-rule]');
  if (delRule) { delRule.closest('tr').remove(); return commitQuotas(); }
  const addRule = e.target.closest('[data-add-rule]');
  if (addRule) {
    const tbody = addRule.closest('.prov').querySelector('tbody');
    tbody.insertAdjacentHTML('beforeend', ruleRow({ id: 'rule-' + Date.now(), label: 'New rule', pattern: '', limit: 0, windowHours: 24 }));
    return commitQuotas();
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  switch (act.dataset.act) {
    case 'locate': return useLocation();
    case 'search': return searchCity();
    case 'refresh': { status('Refreshing…'); try { await chrome.runtime.sendMessage({ type: 'headroom:weatherNow' }); } catch {} return render(); }
    case 'live': S.weatherForce = null; await saveNow(); status('Showing the live weather'); return render();
    case 'addSite': return addSite();
    case 'export': {
      const file = AM.buildExport(S, chrome.runtime.getManifest().version);
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'headroom-settings-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return status('Settings exported.');
    }
    case 'import': return $('#importFile').click();
    case 'defaults': S = { ...AM.mergeSettings(null), customSites: S.customSites, weatherPlace: S.weatherPlace }; await saveNow(); status('Defaults restored.'); return render();
    case 'clearData': {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => /^(usage|events)\./.test(k) || k === 'notified'));
      return status('Usage data cleared.');
    }
    case 'copyLog': await navigator.clipboard.writeText($('#log').textContent); return status('Log copied.');
    case 'clearLog': await chrome.storage.local.remove('debug.log'); return render();
  }
});
$('#importFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) doImport(f); });

function commitQuotas() {
  try { S.quotas = { ...S.quotas, ...readQuotas() }; save(); } catch (err) { status(err.message, 6000); }
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('#quotas') && t.dataset.f) return commitQuotas();
  if (t.id === 'f-w' || t.id === 'f-s' || t.id === 'f-t') return pickForce();
  const k = t.dataset && t.dataset.k;
  if (!k) return;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (t.type === 'range') v = Number(t.value) / Number(t.dataset.div || 1);
  else if (k === 'thresholds') {
    const list = t.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0 && n <= 100);
    v = list.length ? list : AM.DEFAULT_SETTINGS.thresholds;
    t.value = v.join(', ');
  } else v = t.value;
  S[k] = v;
  save();
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.k === 'weatherStrength') {
    $('#strv').textContent = t.value + '%';
    S.weatherStrength = Number(t.value) / 100;
    save();
  } else if (t.id === 'nav-q') { query = t.value; render(); }
  else if (t.closest && t.closest('#quotas') && t.dataset.f) commitQuotas();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'city') { e.preventDefault(); searchCity(); } });
addEventListener('hashchange', () => { if (location.hash.slice(1) !== page) go(location.hash.slice(1)); });
// Is the person typing in a field on this page? Then a re-render would wipe what they are typing: wait.
const typing = () => { const a = document.activeElement; return !!a && a.closest && a.closest('#main') && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|number)$/.test(a.type))); };
let logRenderT = 0;
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  // Settings changed somewhere else (the bar dragged to another edge, "Turn off weather" in the on-page panel, a second
  // Settings tab). Take over just the keys that changed there, so this page never writes an old value back on its next save.
  if (c.settings && S && !written.includes(canon(c.settings.newValue))) {
    const nv = c.settings.newValue || {}, ov = c.settings.oldValue || {};
    const keys = Object.keys(nv).filter((k) => JSON.stringify(nv[k]) !== JSON.stringify(ov[k]) && JSON.stringify(nv[k]) !== JSON.stringify(S[k]));
    if (keys.length) {
      for (const k of keys) S[k] = nv[k];
      S = AM.mergeSettings(S);
      if (!typing()) render();
    }
  }
  if ((c['weather.data'] || c['weather.error']) && page === 'weather' && !query && !typing()) render();
  // a busy site writes the debug log many times a second: refresh the view at most every 2 s
  if (c['debug.log'] && page === 'help' && !query && !logRenderT) {
    logRenderT = setTimeout(() => { logRenderT = 0; if (page === 'help' && !query && !typing() && $('#log')) render(); }, 2000);
  }
});

(async () => {
  const { settings: s } = await chrome.storage.local.get('settings');
  S = AM.mergeSettings(s);
  page = PAGES.some((p) => p.id === location.hash.slice(1)) ? location.hash.slice(1) : 'weather';
  render();
})();

try { $('#ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* preview */ }
