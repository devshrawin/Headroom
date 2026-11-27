import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(new URL('../src/core/quotas.js', import.meta.url), 'utf8'), ctx, { filename: 'quotas.js' });
const AM = ctx.Headroom;

const covers = (patterns, host) => patterns.some((p) => {
  const m = p.match(/^https:\/\/([^/]+)\/\*$/);
  return m && (m[1] === host || m[1] === 'www.' + host);
});

test('every provider host is granted and has content scripts in the manifest', () => {
  const content = manifest.content_scripts.flatMap((c) => c.matches);
  for (const p of AM.PROVIDERS) {
    for (const h of p.hosts) {
      assert.ok(covers(manifest.host_permissions, h), `${p.id}: ${h} missing from host_permissions`);
      assert.ok(covers(content, h), `${p.id}: ${h} missing from content_scripts matches`);
    }
  }
});

test('Copilot is matched on its current address (copilot.microsoft.com now redirects to copilot.com)', () => {
  assert.equal(AM.providerForHost('copilot.com').id, 'copilot');
  assert.equal(AM.providerForHost('www.copilot.com').id, 'copilot');
  assert.equal(AM.providerForHost('copilot.microsoft.com').id, 'copilot');
});

test('every file the manifest points at exists (icons, options, background, content scripts)', () => {
  const files = new Set([
    manifest.background.service_worker, manifest.options_page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ]);
  for (const f of files) assert.ok(existsSync(new URL('../' + f, import.meta.url)), `${f} is missing`);
  assert.equal(manifest.web_accessible_resources, undefined, 'nothing is exposed to web pages');
  for (const f of AM.WEATHER_FILES) assert.ok(existsSync(new URL('../' + f, import.meta.url)), `${f} is missing`);
  for (const f of AM.WEATHER_FILES) assert.ok(!AM.CONTENT_BUNDLE.includes(f), `${f} is injected on demand, not always loaded`);
  for (const f of AM.FLUID_FILES) assert.ok(existsSync(new URL('../' + f, import.meta.url)), `${f} is missing`);
  assert.deepEqual(AM.FLUID_FILES.slice(0, AM.WEATHER_FILES.length), AM.WEATHER_FILES, 'the fluid look loads the sky files first (it borrows page handling from the sky)');
  assert.ok(AM.FLUID_FILES.includes('src/core/fluid-sim.js') && !AM.CONTENT_BUNDLE.includes('src/core/fluid-sim.js'), 'the fluid renderer is injected on demand, not always loaded');
});

