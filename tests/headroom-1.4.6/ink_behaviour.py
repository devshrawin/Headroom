"""Behaviour of the automatic text colour (ink) over time: hover, streaming replies, pseudo-element cards, a theme switch.

Light page, clear night (white ink). Checks, each with its WCAG contrast against the element's own background:
  hover      a sidebar row that only gets a white background under the pointer must not keep white text while hovered,
             and must get the ink back when the pointer leaves
  stream     a reply streamed in (text chunks, then a new white card and a code block) must show readable text in the
             first frames; script cost while streaming is reported
  pseudo     a card drawn by ::before keeps the site's text colour
  theme      the page switches to its dark theme: cards keep readable text afterwards
Usage: python3 -I ink_behaviour.py <extDir>
"""
import json, os, sys, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(sys.argv[1])
html = open(os.path.join(HERE, 'fixtures', 'sky.html'), encoding='utf-8').read()
for k, v in {'PAGE_BG': 'rgb(248, 248, 252)', 'CARD_BG': '#ffffff', 'TEXT': '#1f1e1d', 'MUTED': '#73726c', 'LINK': '#2563eb'}.items():
    html = html.replace(k, v)

CONTRAST_JS = """(id) => { const e = typeof id === 'string' ? document.getElementById(id) : id;
  const lum = (c) => { const n = c.match(/[\\d.]+/g).map(Number); const f = (x) => { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return { L: .2126 * f(n[0]) + .7152 * f(n[1]) + .0722 * f(n[2]), a: n.length > 3 ? n[3] : 1 }; };
  // the background behind the text: the nearest painted ancestor (own fill, or a ::before / ::after card)
  let bg = null;
  for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
    for (const s of [getComputedStyle(a), getComputedStyle(a, '::before')]) { const b = lum(s.backgroundColor); if (b.a >= .5 && (s === getComputedStyle(a) || s.content !== 'none')) { bg = b.L; break; } }
    if (bg != null) break;
  }
  const t = lum(getComputedStyle(e).color).L;
  return { color: getComputedStyle(e).color, contrast: bg == null ? null : +((Math.max(t, bg) + .05) / (Math.min(t, bg) + .05)).toFixed(2) }; }"""

out = {}
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='hr-ink-'), headless=True, channel='chromium', viewport={'width': 1600, 'height': 900},
        reduced_motion='reduce', args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx.route('https://api.open-meteo.com/**', lambda r: r.fulfill(status=503, body=''))
    ctx.route('https://claude.ai/**', lambda r: r.fulfill(status=404, body='{}') if '/api/' in r.request.url else r.fulfill(content_type='text/html', body=html))
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    sw.evaluate("""async () => chrome.storage.local.set({ settings: { weatherPlace: { name: 'X', lat: 48.85, lon: 2.35 }, weatherForce: { weather: 'clear', season: 'summer', tod: 23 } } })""")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('https://claude.ai/chat/x')
    page.wait_for_timeout(4000)
    out['ink'] = page.evaluate("() => document.documentElement.getAttribute('data-hr-ink')")
    out['restingRow'] = page.evaluate(CONTRAST_JS, 'hov')               # on the sky: no painted ancestor -> contrast null, colour = ink
    box = page.evaluate("() => { const r = document.getElementById('hov').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; }")
    page.mouse.move(box[0], box[1])
    page.wait_for_timeout(450)
    out['hovered'] = page.evaluate(CONTRAST_JS, 'hov')
    page.mouse.move(1500, 500)
    page.wait_for_timeout(450)
    out['unhovered'] = page.evaluate(CONTRAST_JS, 'hov')
    out['pseudo'] = page.evaluate(CONTRAST_JS, 'pcard')
    # a reply streams in: text chunks every 30 ms for 3 s, then a new card and a code block; read the card's text colour two frames later
    cdp = ctx.new_cdp_session(page)
    cdp.send('Performance.enable')
    m0 = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
    out['stream'] = page.evaluate("""async (cjs) => {
      const contrastOf = eval(cjs);
      const col = document.querySelector('.col');
      const p = document.createElement('p'); col.appendChild(p);
      for (let i = 0; i < 100; i++) { p.append(document.createTextNode('token' + i + ' ')); await new Promise((r) => setTimeout(r, 30)); }
      const card = document.createElement('div'); card.className = 'card'; card.textContent = 'A new card streamed in';
      const pre = document.createElement('pre'); pre.textContent = 'print("hello")';
      col.append(card, pre);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { streamedText: contrastOf(p), newCard: contrastOf(card), newCode: contrastOf(pre) };
    }""", CONTRAST_JS)
    m1 = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
    out['streamCost'] = {'scriptMs': round((m1['ScriptDuration'] - m0['ScriptDuration']) * 1000, 1), 'styleMs': round((m1['RecalcStyleDuration'] - m0['RecalcStyleDuration']) * 1000, 1), 'layoutMs': round((m1['LayoutDuration'] - m0['LayoutDuration']) * 1000, 1)}
    # the page switches to its dark theme
    page.evaluate("""() => { const r = document.documentElement.style; r.setProperty('--bg', 'rgb(31, 30, 29)'); r.setProperty('--card', '#2b2a27'); r.setProperty('--text', '#eeeeec'); r.setProperty('--muted', '#a3a29c'); document.documentElement.classList.add('dark'); }""")
    page.wait_for_timeout(2500)
    out['themeCard'] = page.evaluate(CONTRAST_JS, 'card')
    out['themeBubble'] = page.evaluate(CONTRAST_JS, 'bubble')
    out['themeBox'] = page.evaluate(CONTRAST_JS, 'edit')
    out['errors'] = errors
    ctx.close()

checks = {
    'ink is white at night': out['ink'] == 'light',
    'resting row uses the ink': out['restingRow']['color'] == 'rgb(254, 254, 253)',
    'hovered row readable (>= 4.5)': (out['hovered']['contrast'] or 0) >= 4.5,
    'row gets the ink back': out['unhovered']['color'] == 'rgb(254, 254, 253)',
    'pseudo-element card readable': (out['pseudo']['contrast'] or 0) >= 4.5,
    'streamed text uses the ink': out['stream']['streamedText']['color'] == 'rgb(254, 254, 253)',
    'new card readable in its first frames': (out['stream']['newCard']['contrast'] or 0) >= 4.5,
    'new code block readable': (out['stream']['newCode']['contrast'] or 0) >= 4.5,
    'after a theme switch, cards readable': all((out[k]['contrast'] or 0) >= 4.5 for k in ('themeCard', 'themeBubble', 'themeBox')),
    'no page errors': not out['errors'],
}
print(json.dumps({'checks': checks, 'pass': all(checks.values()), 'detail': out}))
