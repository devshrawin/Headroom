import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadBackground, makeStorage } from './chrome-stub.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const AM = (() => {
  const ctx = vm.createContext({ console, Date, encodeURIComponent });
  for (const f of ['src/core/quotas.js', 'src/core/common.js', 'src/core/weather-data.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.Headroom;
})();
const W = AM.WEATHER;
const plain = (v) => JSON.parse(JSON.stringify(v));

const forecast = (over = {}) => ({
  utc_offset_seconds: 19800,
  current: { time: '2026-11-23T10:45', temperature_2m: 27.3, weather_code: 0, cloud_cover: 0, wind_speed_10m: 9.1, wind_direction_10m: 81, is_day: 1, precipitation: 0, ...over },
  daily: { sunrise: ['2026-11-23T06:40'], sunset: ['2026-11-23T17:55'] },
});

test('weather codes map to the right condition; a "clear" code with lots of cloud is not clear', () => {
  const cases = [[0, 'clear'], [1, 'clear'], [2, 'partly'], [3, 'overcast'], [45, 'fog'], [48, 'fog'], [53, 'drizzle'], [61, 'rain'], [65, 'rain'], [81, 'rain'], [73, 'snow'], [86, 'snow'], [95, 'storm'], [99, 'storm'], [123, 'partly']];
  for (const [code, want] of cases) assert.equal(W.wmoToWeather(code), want, 'code ' + code);
  assert.equal(W.wmoToWeather(0, 90), 'overcast');
  assert.equal(W.wmoToWeather(0, 40), 'partly');
  assert.equal(W.wmoToWeather(0, 5), 'clear');
  assert.equal(W.wmoToWeather(61, 5), 'rain', 'only a clear code is second-guessed');
});

test('seasons: India has monsoon, the tropics have wet and dry, the south flips, the temperate north has four', () => {
  assert.equal(W.seasonFor(23, 72.5, 6), 'monsoon'); // Ahmedabad in July
  assert.equal(W.seasonFor(23, 72.5, 3), 'summer');
  assert.equal(W.seasonFor(23, 72.5, 9), 'autumn');
  assert.equal(W.seasonFor(23, 72.5, 0), 'winter');
  assert.equal(W.seasonFor(48.8, 2.3, 3), 'spring'); // Paris in April
  assert.equal(W.seasonFor(48.8, 2.3, 9), 'autumn');
  assert.equal(W.seasonFor(48.8, 2.3, 0), 'winter');
  assert.equal(W.seasonFor(-33.9, 151.2, 0), 'summer'); // Sydney in January
  assert.equal(W.seasonFor(-33.9, 151.2, 6), 'winter');
  assert.equal(W.seasonFor(1.3, 103.8, 6), 'monsoon'); // near the equator: wet or dry
});

test('a forecast is parsed into the small record we keep, coordinates rounded; garbage is refused', () => {
  const d = plain(W.parseForecast(forecast(), 23.025791, 72.587265));
  assert.equal(d.lat, 23.03);
  assert.equal(d.lon, 72.59);
  assert.equal(d.code, 0);
  assert.equal(d.temp, 27.3);
  assert.equal(d.rise, 6 + 40 / 60);
  assert.equal(d.set, 17 + 55 / 60);
  assert.equal(d.utcOffset, 19800);
  for (const bad of [null, 'x', 5, {}, { current: null }, { current: {} }, { current: { weather_code: 'sun' } }]) assert.equal(W.parseForecast(bad, 1, 2), null);
  const wild = W.parseForecast(forecast({ temperature_2m: 9999, wind_speed_10m: -5, cloud_cover: 500 }), 1, 2);
  assert.equal(wild.temp, 60, 'out-of-range numbers are clamped');
  assert.equal(wild.windKmh, 0);
  assert.equal(wild.cloud, 100);
});

test('the forecast URL carries only the rounded coordinates; a city search URL is encoded', () => {
  const u = AM.weatherUrl(23.025791, 72.587265);
  assert.match(u, /latitude=23\.03&longitude=72\.59/);
  assert.ok(u.startsWith('https://api.open-meteo.com/'));
  assert.doesNotMatch(u, /23\.025|72\.587/);
  assert.equal(AM.geocodeUrl('São Paulo & co').includes('S%C3%A3o%20Paulo%20%26%20co'), true);
  assert.ok(AM.geocodeUrl('x').startsWith('https://geocoding-api.open-meteo.com/'));
});

test('the sky state: the hour is the hour AT the place, wind blows the clouds the other way, a preview overrides the real thing', () => {
  const d = W.parseForecast(forecast({ wind_direction_10m: 270, wind_speed_10m: 20 }), 23, 72.5);
  // 2026-11-23 05:00 UTC is 10:30 in India (UTC+5:30)
  const at = Date.UTC(2026, 10, 23, 5, 0);
  const st = W.skyState(d, at, null);
  assert.equal(st.tod, 10.5);
  assert.equal(st.live, true);
  assert.equal(st.weather, 'clear');
  assert.equal(st.season, 'autumn', 'late November in India is post-monsoon');
  assert.ok(st.windX > 0.4 && st.windX < 0.6, 'a west wind (from 270) moves the clouds east');
  const f = W.skyState(d, at, { weather: 'storm', tod: 22 });
  assert.equal(f.weather, 'storm');
  assert.equal(f.tod, 22);
  assert.equal(f.live, false);
  assert.equal(f.season, 'autumn', 'what is not overridden stays real');
  const none = W.skyState(null, at, null);
  assert.equal(none.weather, 'clear');
});

test('skyState seasonForced is true only when a valid season is forced', () => {
  const at = Date.UTC(2026, 10, 23, 5, 0);
  assert.equal(W.skyState(null, at, null).seasonForced, false);
  assert.equal(W.skyState(null, at, { weather: 'clear' }).seasonForced, false);
  assert.equal(W.skyState(null, at, { tod: 23 }).seasonForced, false);
  assert.equal(W.skyState(null, at, { season: 'monsoon' }).seasonForced, true);
  assert.equal(W.skyState(null, at, { season: 'bogus' }).seasonForced, false);
});

test('describe: a short line for Settings, in the chosen units', () => {
  const d = W.parseForecast(forecast({ temperature_2m: 20 }), 23, 72.5);
  assert.equal(W.describe(d, 'c').temp, '20°C');
  assert.equal(W.describe(d, 'f').temp, '68°F');
  assert.equal(W.describe(null, 'c'), null);
});

// ---- the background script ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('background: refreshWeather fetches the chosen place, stores the parsed record, and clears an old error', async () => {
  const storage = makeStorage({ settings: { weather: true, weatherPlace: { name: 'Home', lat: 23.025791, lon: 72.587265 } }, 'weather.error': { error: 'old', t: 1 } });
  const urls = [];
  const bg = loadBackground({ storage, fetch: async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => forecast() }; } });
  const replies = [];
  const [fn] = bg.listeners.message;
  assert.equal(fn({ type: 'headroom:weatherNow' }, {}, (r) => replies.push(r)), true);
  await sleep(30);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /latitude=23\.03&longitude=72\.59/);
  assert.equal(replies[0].ok, true);
  assert.equal(storage.data['weather.data'].code, 0);
  assert.equal('weather.error' in storage.data, false);
});

test('background: a failing or odd response is kept as an error, never as weather', async () => {
  const place = { name: 'Home', lat: 1, lon: 2 };
  for (const make of [
    () => async () => ({ ok: false, status: 429, json: async () => ({}) }),
    () => async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }),
    () => async () => { throw new Error('offline'); },
  ]) {
    const storage = makeStorage({ settings: { weather: true, weatherPlace: place } });
    const bg = loadBackground({ storage, fetch: make() });
    const replies = [];
    bg.listeners.message[0]({ type: 'headroom:weatherNow' }, {}, (r) => replies.push(r));
    await sleep(30);
    assert.equal(replies[0].ok, false);
    assert.equal('weather.data' in storage.data, false);
    assert.ok(storage.data['weather.error'] && storage.data['weather.error'].error);
  }
});

test('background: with the weather off or no place, nothing is fetched and stored data is dropped', async () => {
  for (const settings of [{ weather: false, weatherPlace: { name: 'Home', lat: 1, lon: 2 } }, { weather: true, weatherPlace: null }]) {
    const storage = makeStorage({ settings, 'weather.data': { code: 1 } });
    let called = 0;
    const bg = loadBackground({ storage, fetch: async () => { called++; return { ok: true, json: async () => forecast() }; } });
    bg.listeners.message[0]({ type: 'headroom:weatherNow' }, {}, () => {});
    await sleep(30);
    assert.equal(called, 0, 'no request');
    assert.equal('weather.data' in storage.data, false);
  }
});

test('background: loadWeather is refused without a sender tab, and injects only the sky renderer otherwise', async () => {
  const bg = loadBackground();
  const replies = [];
  const [fn] = bg.listeners.message;
  assert.equal(fn({ type: 'headroom:loadWeather' }, {}, (r) => replies.push(r)), undefined);
  assert.equal(replies[0].ok, false);
  assert.equal(fn({ type: 'headroom:loadWeather' }, { tab: { id: 3 }, frameId: 0 }, (r) => replies.push(r)), true);
  await bg.settle();
  assert.equal(replies[1].ok, true);
  assert.equal(bg.executed.length, 1);
  assert.equal(JSON.stringify(bg.executed[0].files), JSON.stringify(['src/core/sky-palette.js', 'src/core/weather-sky.js']));
  // the fluid look adds its renderer; anything else a page-side script might send still gets only the sky (the lists are fixed here)
  fn({ type: 'headroom:loadWeather', style: 'fluid' }, { tab: { id: 3 }, frameId: 0 }, (r) => replies.push(r));
  fn({ type: 'headroom:loadWeather', style: 'src/evil.js' }, { tab: { id: 3 }, frameId: 0 }, (r) => replies.push(r));
  await bg.settle();
  assert.equal(JSON.stringify(bg.executed[1].files), JSON.stringify(['src/core/sky-palette.js', 'src/core/weather-sky.js', 'src/core/fluid-sim.js']));
  assert.equal(JSON.stringify(bg.executed[2].files), JSON.stringify(['src/core/sky-palette.js', 'src/core/weather-sky.js']));
});

test('background: a 20-minute alarm is created when a place is saved, and the weather is fetched at once', async () => {
  const storage = makeStorage({ settings: { weather: false } });
  let called = 0;
  const bg = loadBackground({ storage, fetch: async () => { called++; return { ok: true, json: async () => forecast() }; } });
  const next = { weather: true, weatherPlace: { name: 'Home', lat: 1, lon: 2 } };
  storage.data.settings = next; // storage already holds the new value when the change event fires
  bg.listeners.storageChanged.forEach((fn) => fn({ settings: { oldValue: { weather: false }, newValue: next } }, 'local'));
  await sleep(40);
  assert.ok(bg.alarms.some((a) => a.name === 'weather|refresh' && a.periodInMinutes === 20), 'the alarm exists');
  assert.equal(called, 1);
});

test('the sky palette and the shader agree on every uniform', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/weather-sky.js', import.meta.url), 'utf8');
  const frag = src.slice(src.indexOf('const FRAG = `'), src.indexOf('`;', src.indexOf('const FRAG = `')));
  const g = { Headroom: {} }; g.globalThis = g;
  vm.runInNewContext(readFileSync(new URL('../src/core/sky-palette.js', import.meta.url), 'utf8'), g);
  const PAL = g.Headroom.SKYPAL;
  assert.ok(PAL && PAL.uniforms);
  const declared = new Set([...frag.matchAll(/uniform\s+(?:float|vec2|vec3)\s+([^;]+);/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  const fromPalette = new Set(Object.keys(PAL.uniforms({ season: 'summer', weather: 'rain', hour: 12 })));
  // set by the sky script itself
  // (1.4.6 removed uVeil and uLift, the white wash; it added uInk, uVivid, uPage and uMix for the ink-safe sky)
  const own = ['uRes', 'uTime', 'uShift', 'uFlash', 'uFlashX', 'uBolt', 'uInk', 'uVivid', 'uPage', 'uMix'];
  for (const gone of ['uVeil', 'uLift']) assert.ok(!declared.has(gone) && !src.includes("'" + gone + "'"), gone + ' was the white wash and must stay removed');
  for (const u of fromPalette) assert.ok(declared.has(u), 'palette sets ' + u + ' but the shader has no such uniform');
  for (const u of declared) assert.ok(fromPalette.has(u) || own.includes(u), 'the shader needs ' + u + ' but nothing sets it');
  for (const u of own) assert.ok(src.includes("'" + u + "'") || src.includes('U.' + u), 'weather-sky.js never sets ' + u);
  // every season x weather x hour gives finite numbers (no NaN reaching the GPU)
  for (const season of ['spring', 'summer', 'autumn', 'winter', 'monsoon']) for (const weather of ['clear', 'partly', 'overcast', 'drizzle', 'rain', 'storm', 'snow', 'fog']) for (let h = 0; h < 24; h += 1.5) {
    const u = PAL.uniforms({ season, weather, hour: h, rise: 6.2, set: 18.3 });
    for (const [k, v] of Object.entries(u)) for (const n of [].concat(v)) assert.ok(Number.isFinite(n), season + ' ' + weather + ' ' + h + ' ' + k + ' = ' + n);
  }
});

// ---- the sky palette: sun path and mood ----

const PAL = (() => {
  const g = { Headroom: {} }; g.globalThis = g;
  vm.runInNewContext(read('src/core/sky-palette.js'), g);
  return g.Headroom.SKYPAL;
})();

test('sky palette: night before sunrise and after sunset, day at solar noon, sun below the horizon at midnight', () => {
  const rise = 7, set = 17.5; // a winter day: later dawn, earlier dusk than any default
  assert.ok(PAL.sky('summer', 3, rise, set).wN > 0.9, 'deep night well before sunrise');
  assert.ok(PAL.sky('summer', 22, rise, set).wN > 0.9, 'night well after sunset');
  assert.ok(PAL.sky('summer', (rise + set) / 2, rise, set).wD > 0.9, 'day at solar noon');
  assert.ok(PAL.sky('summer', 0, rise, set).e < 0, 'the sun is below the horizon at midnight');
  assert.ok(PAL.sky('summer', (rise + set) / 2, rise, set).e > 0.9, 'and high at noon');
});

test('sky palette: passing the real sunrise and sunset moves dawn compared to the default', () => {
  const [defRise] = PAL.SUNPATH.summer; // 5.7
  const hour = 6.5;
  const byDefault = PAL.sky('summer', hour);
  const lateRise = PAL.sky('summer', hour, 7.5, 18);
  assert.ok(byDefault.e > 0 && byDefault.sunUp > 0.5, 'with the default sunrise (' + defRise + ') the sun is already up at 6:30');
  assert.ok(lateRise.e < 0, 'with a real sunrise at 7:30 it is still below the horizon');
  assert.ok(lateRise.wN > byDefault.wN, 'so the night weight is higher');
  assert.deepEqual(plain(PAL.sky('summer', hour, null, null)), plain(byDefault), 'null falls back to the default');
});

test('sky palette: a storm flashes lightning and pours, clear summer noon is dry, a clear monsoon day keeps the rainy mood', () => {
  const storm = PAL.uniforms({ season: 'summer', weather: 'storm', hour: 14 });
  assert.equal(storm.uBolt, 1);
  assert.ok(storm.uRain > 0.9, 'storm rain ' + storm.uRain);
  const clear = PAL.uniforms({ season: 'summer', weather: 'clear', hour: 12 });
  assert.equal(clear.uRain, 0);
  assert.equal(clear.uSnow, 0);
  assert.equal(clear.uBolt, 0);
  const monsoon = PAL.uniforms({ season: 'monsoon', weather: 'clear', hour: 12, seasonMood: true });
  assert.ok(monsoon.uRain > 0, 'monsoon rain ' + monsoon.uRain);
  assert.ok(PAL.uniforms({ season: 'monsoon', weather: 'auto', hour: 12 }).uRain > 0, 'auto weather keeps the monsoon mood');
  const snow = PAL.uniforms({ season: 'winter', weather: 'snow', hour: 12 });
  assert.ok(snow.uSnow > 0 && snow.uRain === 0, 'snow falls as snow only');
});

test('sky palette: live clear weather in monsoon season (Nairobi, Singapore) stays clear and dry', () => {
  const u = PAL.uniforms({ season: 'monsoon', weather: 'clear', hour: 12 });
  assert.equal(u.uRain, 0);
  assert.ok(u.uCover < 0.2, 'normal clear cover ' + u.uCover);
});

test('sky palette: unusable sunrise/sunset (polar day or night, junk) falls back to defaults and stays finite', () => {
  for (const [rise, set] of [[0, 0], [12, 12], [20, 6], [NaN, 18], [6, Infinity], [0, 24]]) for (const hour of [0, 6, 12, 18, 23.5]) {
    const u = PAL.uniforms({ season: 'summer', weather: 'clear', hour, rise, set });
    for (const [k, v] of Object.entries(u)) for (const n of [].concat(v)) assert.ok(Number.isFinite(n), rise + '/' + set + ' h' + hour + ' ' + k + ' = ' + n);
  }
  assert.deepEqual(plain(PAL.sky('summer', 9, 12, 12)), plain(PAL.sky('summer', 9)));
});

test('parseForecast: equal or unusable sunrise and sunset become null so the palette uses its defaults', () => {
  const polar = { current: { weather_code: 0 }, daily: { sunrise: ['2026-06-21T00:00'], sunset: ['2026-06-21T00:00'] } };
  const d = W.parseForecast(polar, 78, 15);
  assert.equal(d.rise, null);
  assert.equal(d.set, null);
  const st = W.skyState(d, Date.UTC(2026, 5, 21, 12), null);
  assert.equal(st.rise, null);
  assert.equal(st.set, null);
});
