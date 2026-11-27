// Unit tests for the pure modules (quotas, common, parsers, weather-data, sky-palette), run in a fresh VM context.
// Usage: node --test unit.test.mjs   (EXT env var picks the extension copy, default ../ext)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const EXT = path.resolve(process.env.EXT || new URL('../ext', import.meta.url).pathname);
const load = (...files) => {
  const ctx = vm.createContext({ console, atob: (s) => Buffer.from(s, 'base64').toString('binary'), URL, URLSearchParams });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
  return ctx.Headroom;
};
const AM = load('src/core/quotas.js', 'src/core/common.js', 'src/core/parsers.js', 'src/core/weather-data.js', 'src/core/sky-palette.js');
const NOW = Date.parse('2026-11-26T10:00:00Z');

test('manifest content bundle matches AM.CONTENT_BUNDLE and every file exists', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const iso = m.content_scripts.find((c) => !c.world);
  assert.deepEqual(iso.js, [...AM.CONTENT_BUNDLE]);
  for (const f of [...iso.js, ...AM.WEATHER_FILES, 'src/inject.js', m.background.service_worker, m.options_page]) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  // the two content-script entries must cover exactly the same sites, and host_permissions too
  const [a, b] = m.content_scripts.map((c) => [...c.matches].sort().join());
  assert.equal(a, b);
  assert.equal(a, [...m.host_permissions].sort().join());
});

test('every built-in provider host is covered by the manifest', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  for (const p of AM.PROVIDERS) for (const h of p.hosts) assert.ok(m.host_permissions.includes(`https://${h}/*`), h);
});

test('pctOf / toTime / formatDuration basics', () => {
  assert.equal(AM.pctOf({ pct: 140 }), 100);
  assert.equal(AM.pctOf({ used: 3, limit: 4 }), 75);
  assert.equal(AM.pctOf({ remaining: 1, limit: 4 }), 75);
  assert.equal(AM.pctOf({ remaining: 5 }), null);
  assert.equal(AM.toTime('30', 'rel', NOW), NOW + 30000);
  assert.equal(AM.toTime(1.8e9, undefined, NOW), 1.8e12);
  assert.equal(AM.toTime('nope'), undefined);
  assert.equal(AM.formatDuration(90 * 60e3), '1h 30m');
  assert.equal(AM.formatDuration(-1), 'now');
});

test('parseReset handles relative, 12h and 24h text', () => {
  assert.equal(AM.parseReset('try again in 3 hours', NOW), NOW + 3 * 3600e3);
  const t = new Date(AM.parseReset('resets at 5:30 p.m.', NOW));
  assert.equal(t.getHours(), 17); assert.equal(t.getMinutes(), 30);
  assert.ok(AM.parseReset('resets at 17:00', NOW) > NOW);
  assert.equal(AM.parseReset('no time here', NOW), undefined);
});

test('findLimits pulls Grok and Perplexity style counters', () => {
  const g = AM.findLimits({ remainingQueries: 7, totalQueries: 10, windowSizeSeconds: 86400, waitTimeSeconds: 60 }, { label: 'grok-4', now: NOW });
  assert.equal(g.length, 1);
  assert.equal(g[0].label, 'grok-4'); assert.equal(g[0].used, 3); assert.equal(g[0].resetAt, NOW + 60000);
  const p = AM.findLimits({ remaining_pro: 5, remaining_research: 2 });
  assert.equal(p.map((m) => m.label).sort().join(), 'Pro,Research');
});

test('primaryMeter prefers the shortest window, then a blocked one', () => {
  const s = { id: 'five_hour', label: 'Session (5h)', pct: 20 };
  const w = { id: 'seven_day', label: 'Weekly', pct: 60 };
  assert.equal(AM.primaryMeter([w, s]).id, 'five_hour');
  assert.equal(AM.primaryMeter([w, s, { id: 'x', label: 'Weekly · Opus', pct: 100, secondary: true }]).id, 'five_hour');
  assert.equal(AM.primaryMeter([{ ...w, pct: 100 }, s]).id, 'seven_day');
});

test('validateUsageMessage rebuilds good reports and rejects bad ones', () => {
  const ok = AM.validateUsageMessage({ provider: 'claude', name: 'Claude', meters: [{ id: 'a', label: 'A', pct: 5, source: 'real', evil: 'x' }], problem: null });
  assert.equal(ok.meters[0].evil, undefined);
  assert.equal(AM.validateUsageMessage({ provider: 'c laude', name: 'x', meters: [] }), null);
  assert.equal(AM.validateUsageMessage({ provider: 'claude', name: 'C', meters: [{ id: 'a', label: 'A', pct: NaN }] }), null);
  assert.equal(AM.validateUsageMessage({ provider: 'claude', name: 'C', meters: [{ id: 'a', label: 'A', source: 'fake' }] }), null);
});

test('validateInjectMessage only lets well-formed messages through', () => {
  assert.equal(AM.validateInjectMessage({ kind: 'request', url: 'javascript:alert(1)', method: 'GET' }), null);
  assert.equal(AM.validateInjectMessage({ kind: 'response', url: 'https://x.y/', method: 'GET', status: 99 }), null);
  const r = AM.validateInjectMessage({ kind: 'response', url: 'https://x.y/', method: 'GET', status: 200, body: 'b', extra: 1 });
  assert.equal(r.extra, undefined); assert.equal(r.body, 'b');
});

test('redact masks emails, bearer tokens, JWTs, UUIDs', () => {
  const s = AM.redact('a@b.co Bearer abc.def eyJhbGciOi.eyJzdWIiOi.sig 11111111-2222-3333-4444-555555555555');
  assert.ok(!/a@b\.co|abc\.def|eyJ|1111/.test(s), s);
});

test('mergeSettings cleans bad stored values', () => {
  const s = AM.mergeSettings({ meterStyle: 'bar-diagonal', thresholds: [0, 50, 200, 'x'], weatherStrength: 9, weatherPlace: { lat: 999, lon: 0 }, customSites: [{ host: 'Bad Host' }, { host: 'chat.example.com' }] });
  assert.equal(s.meterStyle, 'bar-top');
  assert.deepEqual([...s.thresholds], [50]);
  assert.equal(s.weatherStrength, 1);
  assert.equal(s.weatherPlace, null);
  assert.equal(s.customSites.length, 1);
});

test('export / import round trip never carries the place, and import validates', () => {
  const s = AM.mergeSettings({ weatherPlace: { name: 'Home', lat: 1, lon: 2 }, thresholds: [60, 80] });
  const file = AM.buildExport(s, '9.9.9', new Date(NOW));
  assert.equal(file.settings.weatherPlace, undefined);
  const back = AM.parseImport(JSON.stringify(file));
  assert.equal(back.ok, true); assert.deepEqual([...back.settings.thresholds], [60, 80]);
  assert.equal(AM.parseImport('{"app":"other","settings":{}}').ok, false);
  const bad = AM.parseImport(JSON.stringify({ app: 'headroom', settings: { quotas: { __proto__x: [], chatgpt: [{ id: 'a', label: 'A', pattern: '(', limit: 1, windowHours: 1 }] } } }));
  assert.equal(bad.settings.quotas.chatgpt.length, 0);
});

test('countMeters counts rolling windows and the first match wins', () => {
  const ev = [{ t: NOW - 1e3, m: 'o3' }, { t: NOW - 2e3, m: 'gpt-5' }, { t: NOW - 5 * 3600e3, m: 'gpt-5' }];
  const m = AM.countMeters(ev, AM.DEFAULT_QUOTAS.chatgpt, NOW);
  assert.equal(m.find((x) => x.id === 'thinking').used, 1);
  assert.equal(m.find((x) => x.id === 'messages').used, 1); // the 5 h old one is outside the 3 h window
});

test('provider parsers: ChatGPT, Gemini, Kimi, Grok', () => {
  const c = AM.parseChatGPTUsage({ rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_after_seconds: 60 }, secondary_window: { used_percent: 5, limit_window_seconds: 604800 } } });
  assert.equal(c.map((m) => m.label).join(), 'Codex · 5h,Codex · Weekly');
  const payload = JSON.stringify([null, [[3, 0.25, 1, [[1800000000, 0]]], [9, 0.5, 2, null]]]);
  const g = AM.parseGeminiUsage(")]}'\n123\n" + JSON.stringify([['wrb.fr', 'jSf9Qc', payload]]));
  assert.equal(g.meters.length, 2); assert.equal(g.meters[0].pct, 25); assert.equal(g.meters[0].resetAt, 1.8e12);
  assert.equal(AM.parseGeminiUsage('garbage').meters.length, 0);
  const k = AM.parseKimiUsage({ balances: [{ feature: 'FEATURE_OMNI', amountUsedRatio: 0.4 }] });
  assert.equal(k[0].label, 'Credits'); assert.equal(k[0].pct, 40);
  // Grok: message 1 { float field 1 = 37.5 }, gRPC-web framed
  const inner = Buffer.from([0x0d, ...new Uint8Array(new Float32Array([37.5]).buffer)]);
  const msg = Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
  const framed = Buffer.concat([Buffer.from([0, 0, 0, 0, msg.length]), msg]);
  const gr = AM.parseGrokCredits(new Uint8Array(framed), NOW);
  assert.equal(gr.meters[0].pct, 37.5);
  assert.equal(AM.parseGrokCredits(new Uint8Array([0x80, 0, 0, 0, 16, ...Buffer.from('grpc-status: 7\r\n')])).meters.length, 0);
});

test('claudeChatStats follows the current branch and exposes cached/full costs', () => {
  const conv = { current_leaf_message_uuid: 'c', chat_messages: [
    { uuid: 'a', content: [{ type: 'text', text: 'x'.repeat(1000) }], created_at: new Date(NOW - 60e3).toISOString() },
    { uuid: 'b', parent_message_uuid: 'a', content: [{ type: 'text', text: 'y'.repeat(100) }] },
    { uuid: 'c', parent_message_uuid: 'a', content: [{ type: 'thinking', text: 'zzzz' }, { type: 'text', text: 'w'.repeat(200) }], created_at: new Date(NOW - 60e3).toISOString() },
  ] };
  const s = AM.claudeChatStats(conv, NOW);
  assert.equal(s.messages, 2);
  assert.equal(s.tokens, 3200 + 350 + 70);
  assert.equal(s.nextCost, 70);
  if ('cachedCost' in s) assert.equal(s.cachedCost, 70);
});

test('weather: WMO mapping, seasons, forecast parsing, sky state', () => {
  const W = AM.WEATHER;
  assert.equal(W.wmoToWeather(0, 80), 'overcast');
  assert.equal(W.wmoToWeather(95), 'storm');
  assert.equal(W.seasonFor(23, 72, 6), 'monsoon'); // India, July
  assert.equal(W.seasonFor(-33, 151, 0), 'summer'); // Sydney, January
  const d = W.parseForecast({ utc_offset_seconds: 19800, current: { weather_code: 61, temperature_2m: 20 }, daily: { sunrise: ['2026-11-26T06:50'], sunset: ['2026-11-26T17:55'] } }, 23.0234, 72.5711);
  assert.equal(d.lat, 23.02); assert.equal(d.rise, 6 + 50 / 60);
  assert.equal(W.parseForecast({}), null);
  const st = W.skyState(d, Date.parse('2026-11-26T06:30:00Z'), null);
  assert.equal(st.weather, 'rain'); assert.equal(Math.round(st.tod), 12);
  assert.equal(W.skyState(d, NOW, { weather: 'snow', tod: 3 }).live, false);
});

test('sky palette never produces a non-finite uniform', () => {
  const P = AM.SKYPAL;
  for (const season of Object.keys(P.SKY)) for (const weather of [undefined, ...Object.keys(P.COND)]) for (let hour = 0; hour < 24; hour += 0.5) {
    for (const [rise, set] of [[undefined, undefined], [6, 18], [12, 12], [NaN, 3]]) {
      const u = P.uniforms({ season, weather, hour, rise, set });
      for (const [k, v] of Object.entries(u)) for (const x of [].concat(v)) assert.ok(Number.isFinite(x), `${season}/${weather}/${hour}/${rise}: ${k}`);
    }
  }
});
