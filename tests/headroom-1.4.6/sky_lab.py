"""Sky lab: how vivid is the sky, and how readable is the text on it, across weather x time of day x page theme.

For every state the extension is loaded into Chromium with the weather forced to that state (reduced motion, so the sky is a
still frame). Two screenshots are taken: the page as it is, and the same page with every glyph made invisible, which leaves
only what is behind the text. For each text sample, the worst-case WCAG contrast between its colour and the background
behind it (5th / 95th percentile of the background's luminance) is computed; for the open sky on the right, the mean OKLab
chroma (colourfulness) and lightness.

Usage: python3 -I sky_lab.py <extDir> [--out=<json>] [--shots=<dir>] [--quick]
"""
import json, math, os, sys, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(sys.argv[1])
opts = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[2:] if a.startswith('--'))
QUICK = 'quick' in opts
WEATHERS = ['clear', 'rain', 'storm', 'fog'] if QUICK else ['clear', 'partly', 'overcast', 'rain', 'storm', 'snow', 'fog']
TODS = [12.5, 18.6, 23] if QUICK else [9, 12.5, 17.3, 18.6, 23]
THEMES = {
    'light': {'PAGE_BG': 'rgb(248, 248, 252)', 'CARD_BG': '#ffffff', 'TEXT': '#1f1e1d', 'MUTED': '#73726c', 'LINK': '#2563eb'},
    'dark': {'PAGE_BG': 'rgb(31, 30, 29)', 'CARD_BG': '#2b2a27', 'TEXT': '#eeeeec', 'MUTED': '#a3a29c', 'LINK': '#7aa2f7'},
}
SAMPLES = ['hdr', 'sideCur', 'sideMuted', 'thinking', 'p1', 'p2', 'link', 'p3', 'auto', 'model', 'bubble', 'card', 'edit']
ON_SKY = {'hdr', 'sideCur', 'sideMuted', 'thinking', 'p1', 'p2', 'link', 'p3', 'auto', 'model'}  # the rest sit on their own background
TEMPLATE = open(os.path.join(HERE, 'fixtures', 'sky.html'), encoding='utf-8').read()


def lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rel_lum(rgb):
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])


def oklab(rgb):
    r, g, b = (lin(x) for x in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def contrast(a, b):
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def parse_rgb(css):
    nums = [float(x) for x in css[css.index('(') + 1:css.index(')')].replace(',', ' ').replace('/', ' ').split()]
    return nums[:3]


def bg_lums(img, r):
    px = img.load()
    x0, y0, x1, y1 = int(r['l']) + 1, int(r['t']) + 1, int(r['r']) - 1, int(r['b']) - 1
    vals = []
    for y in range(max(0, y0), min(img.height, y1), 2):
        for x in range(max(0, x0), min(img.width, x1), 2):
            vals.append(rel_lum(px[x, y]))
    vals.sort()
    return vals


def pct(vals, p):
    return vals[min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))] if vals else 0.0


def sky_stats(img, box):
    px = img.load()
    Ls, Cs = [], []
    for y in range(box[1], box[3], 6):
        for x in range(box[0], box[2], 6):
            L, a, b = oklab(px[x, y])
            Ls.append(L); Cs.append(math.hypot(a, b))
    n = max(1, len(Ls))
    return {'L': round(sum(Ls) / n, 3), 'C': round(sum(Cs) / n, 4), 'Cmax': round(max(Cs) if Cs else 0, 4)}


rows = []
with sync_playwright() as p:
    user = tempfile.mkdtemp(prefix='hr-skylab-')
    ctx = p.chromium.launch_persistent_context(user, headless=True, channel='chromium', viewport={'width': 1600, 'height': 900},
        reduced_motion='reduce', color_scheme='light',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    current = {'html': ''}

    def route(r):
        url = r.request.url
        if '/api/organizations/org1/usage' in url:
            return r.fulfill(json={'five_hour': {'utilization': 30, 'resets_at': None}})
        if url.endswith('/api/organizations'):
            return r.fulfill(json=[{'uuid': 'org1', 'capabilities': ['chat']}])
        if '/api/' in url:
            return r.fulfill(status=404, body='{}')
        return r.fulfill(content_type='text/html', body=current['html'])
    ctx.route('https://claude.ai/**', route)
    ctx.route('https://api.open-meteo.com/**', lambda r: r.fulfill(status=503, body=''))
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for theme, vars_ in THEMES.items():
        html = TEMPLATE
        for k, v in vars_.items():
            html = html.replace(k, v)
        current['html'] = html
        for w in WEATHERS:
            for tod in TODS:
                sw.evaluate("""async ([w, tod]) => chrome.storage.local.set({ settings: { weatherPlace: { name: 'X', lat: 48.85, lon: 2.35 }, weatherForce: { weather: w, season: 'summer', tod }, meterStyle: 'bar-top' } })""", [w, tod])
                page.goto('https://claude.ai/chat/11111111-2222-3333-4444-555555555555')
                page.wait_for_timeout(3800)
                info = page.evaluate("""(ids) => { const out = {}; for (const id of ids) { const e = document.getElementById(id);
                    // the text's own line boxes (not the element's box, which can reach under the bar or past the text)
                    const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((x) => x.width > 2 && x.height > 2);
                    const l = Math.min(...rs.map((x) => x.left)), t = Math.min(...rs.map((x) => x.top)), r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
                    out[id] = { l, t, r, b, color: getComputedStyle(e).color }; }
                    return { s: out, ink: document.documentElement.getAttribute('data-hr-ink') || '', sky: !!document.querySelector('canvas[data-headroom]') }; }""", SAMPLES)
                tag = f'{theme}-{w}-{tod}'
                a_path = os.path.join(tempfile.gettempdir(), f'skylab-{tag}-a.png')
                b_path = os.path.join(tempfile.gettempdir(), f'skylab-{tag}-b.png')
                page.screenshot(path=a_path)
                page.add_style_tag(content='*{-webkit-text-fill-color:transparent !important;text-shadow:none !important;caret-color:transparent !important}')
                page.wait_for_timeout(120)
                page.screenshot(path=b_path)
                if 'shots' in opts:
                    os.makedirs(opts['shots'], exist_ok=True)
                    Image.open(a_path).save(os.path.join(opts['shots'], f'{tag}.png'))
                img = Image.open(b_path).convert('RGB')
                worst_sky, worst_all, samples = 99.0, 99.0, {}
                for sid, r in info['s'].items():
                    tl = rel_lum(parse_rgb(r['color']))
                    vals = bg_lums(img, r)
                    # the worst background pixel for this text: the closest in luminance to the text's own (5th / 95th pct)
                    bg_worst = pct(vals, 0.05) if tl < 0.18 else pct(vals, 0.95)
                    c = round(contrast(tl, bg_worst), 2)
                    samples[sid] = c
                    worst_all = min(worst_all, c)
                    if sid in ON_SKY:
                        worst_sky = min(worst_sky, c)
                sky = sky_stats(img, (1100, 70, 1580, 760))
                rows.append({'theme': theme, 'weather': w, 'tod': tod, 'ink': info['ink'], 'sky': info['sky'], 'minContrastOnSky': worst_sky,
                             'minContrastAll': worst_all, 'skyL': sky['L'], 'skyC': sky['C'], 'skyCmax': sky['Cmax'], 'samples': samples})
    ctx.close()

summary = {
    'states': len(rows),
    'skyShown': sum(1 for r in rows if r['sky']),
    'contrastOnSky_min': min(r['minContrastOnSky'] for r in rows),
    'contrastOnSky_below4.5': sum(1 for r in rows if r['minContrastOnSky'] < 4.5),
    'contrastOnSky_below3': sum(1 for r in rows if r['minContrastOnSky'] < 3),
    'contrastOnSky_median': sorted(r['minContrastOnSky'] for r in rows)[len(rows) // 2],
    'skyChroma_mean': round(sum(r['skyC'] for r in rows) / len(rows), 4),
    'skyLightness_mean': round(sum(r['skyL'] for r in rows) / len(rows), 3),
    'errors': errors,
}
out = {'summary': summary, 'rows': rows}
if 'out' in opts:
    json.dump(out, open(opts['out'], 'w'), indent=1)
print(json.dumps(summary))
