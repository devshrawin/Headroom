// Renders the koi pond demo to an mp4, frame by frame (30 fps, deterministic), with a click at 6 s.
//   node tools/pond-preview/render.mjs [seconds] [out.mp4]
// Needs Chrome and ffmpeg on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SECONDS = Number(process.argv[2] || 14);
const OUT = process.argv[3] || 'koi-pond-demo.mp4';
const FPS = 30;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const page = pathToFileURL(fileURLToPath(new URL('./index.html', import.meta.url))).href + '?manual';
const frames = mkdtempSync(join(tmpdir(), 'pond-frames-'));
const profile = mkdtempSync(join(tmpdir(), 'pond-profile-'));
const port = 9466;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
try {
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (tabs.length) break; } catch { await sleep(250); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiters = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } };
  const call = (method, params = {}) => new Promise((res) => { const my = ++id; waiters.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: page });
  await sleep(1500);
  const total = SECONDS * FPS;
  for (let f = 0; f < total; f++) {
    const poke = f === 6 * FPS ? 'window.__pond.poke(640, 330);' : '';
    await call('Runtime.evaluate', { expression: `${poke}window.__pond.advance(1/${FPS});` });
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    writeFileSync(join(frames, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'));
  }
  ws.close();
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%05d.jpg'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  console.log(r.status === 0 ? `wrote ${OUT}` : 'ffmpeg failed');
} finally {
  chrome.kill();
}
