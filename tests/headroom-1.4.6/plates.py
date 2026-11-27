"""Pixel test for the pale plate / white frame around the message box.

Loads the unpacked extension into Chromium, serves fixtures/plates.html as claude.ai with each way of painting a plate or a
frame, focuses the message box, types, then scrolls the conversation up (which makes the page add its frame). Screenshot
pixels are compared: next to the rounded input (inside the plate / frame zone) the sky must look like the sky just outside
it, the container's faint side border must not show as a line, and the input, an open menu and a bordered button must keep
their own paint. Measured three times: at rest, 200 ms after the scroll (no flash), and 2.2 s after it.

Usage: python3 -I plates.py <extDir> [variant,variant,...] [--shots=<dir>]
Variants: bg, focus, pseudo, gradient, ring, outline, radius, fborder, fring, fside; append @far for an ivory page with a
white plate (far from the page colour, which defeats colour matching).
"""
import json, os, sys, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(sys.argv[1])
args = [a for a in sys.argv[2:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[2:] if a.startswith('--') and '=' in a)
ALL = ['bg', 'focus', 'pseudo', 'gradient', 'ring', 'outline', 'radius', 'fborder', 'fring', 'fside', 'bg@far', 'focus@far', 'fborder@far']
VARIANTS = args[0].split(',') if args else ALL
SHOTS = opts.get('shots')
TEMPLATE = open(os.path.join(HERE, 'fixtures', 'plates.html'), encoding='utf-8').read()
MSGS = ''.join(f'<div class="msg">Message {i}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</div>' for i in range(60))


def page_html(variant):
    far = variant.endswith('@far')
    page_bg, plate_bg = ('#efece3', '#ffffff') if far else ('rgb(248, 248, 252)', 'rgb(253, 253, 253)')
    return TEMPLATE.replace('PAGE_BG', page_bg).replace('PLATE_BG', plate_bg).replace('MSGS', MSGS)


def mean(img, x0, x1, y0, y1):
    px = img.load()
    n, acc = 0, [0, 0, 0]
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            p = px[x, y]
            acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; n += 1
    return [round(a / max(1, n), 1) for a in acc]


def delta(a, b):
    return round(max(abs(a[i] - b[i]) for i in range(3)), 1)


def measure(img, r, frame):
    cw, inp, menu, btn = r['cw'], r['inp'], r['menu'], r['btn']
    out = {}
    if frame:   # the 30 px frame zone beside the input, at its height and below it, against plain sky 45-70 px out
        y0, y1, yb0, yb1 = inp['t'] + 10, inp['b'] - 10, inp['b'] + 8, r['vh'] - 6
        out['left'] = delta(mean(img, inp['l'] - 26, inp['l'] - 6, y0, y1), mean(img, inp['l'] - 70, inp['l'] - 45, y0, y1))
        out['right'] = delta(mean(img, inp['r'] + 6, inp['r'] + 26, y0, y1), mean(img, inp['r'] + 45, inp['r'] + 70, y0, y1))
        out['below'] = delta(mean(img, inp['l'] - 26, inp['l'] - 6, yb0, yb1), mean(img, inp['l'] - 70, inp['l'] - 45, yb0, yb1))
    else:       # the plate: the 12 px band between the container's edge and the input, top 48 px of the container
        y0, y1 = cw['t'] + 10, cw['t'] + 40
        out['left'] = delta(mean(img, cw['l'] + 3, inp['l'] - 3, y0, y1), mean(img, cw['l'] - 16, cw['l'] - 6, y0, y1))
        out['right'] = delta(mean(img, inp['r'] + 3, cw['r'] - 3, y0, y1), mean(img, cw['r'] + 6, cw['r'] + 16, y0, y1))
        ly0, ly1 = cw['t'] + 70, cw['t'] + 105
        out['line'] = delta(mean(img, cw['l'], cw['l'] + 1, ly0, ly1), mean(img, cw['l'] - 8, cw['l'] - 3, ly0, ly1))
    out['input'] = min(mean(img, inp['l'] + 300, inp['l'] + 340, inp['t'] + 20, inp['b'] - 20))
    out['menu'] = min(mean(img, menu['l'] + 120, menu['l'] + 200, menu['t'] + 30, menu['b'] - 10))
    out['button'] = min(mean(img, btn['l'] + 4, btn['r'] - 4, btn['t'] + 2, btn['t'] + 4))   # top edge of the button: its own white fill
    clean = all(v < 8 for k, v in out.items() if k in ('left', 'right', 'below', 'line'))
    kept = out['input'] >= 250 and out['menu'] >= 250 and out['button'] >= 250
    out['ok'] = bool(clean and kept)
    return out


results = {}
with sync_playwright() as p:
    user = tempfile.mkdtemp(prefix='hr-plates-')
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
    sw.evaluate("""async () => chrome.storage.local.set({ settings: { weatherPlace: { name: 'X', lat: 23.02, lon: 72.57 }, weatherForce: { weather: 'rain', tod: 12 }, meterStyle: 'bar-top' } })""")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    rect_js = """() => { const b = (id) => { const x = document.getElementById(id).getBoundingClientRect(); return { l: x.left, t: x.top, r: x.right, b: x.bottom }; };
        return { cw: b('cwrap'), inp: b('input'), menu: b('menu'), btn: b('modelBtn'), vh: innerHeight, sky: !!document.querySelector('canvas[data-headroom]') }; }"""
    for v in VARIANTS:
        name = v.split('@')[0]
        frame = name in ('fborder', 'fring', 'fside')
        current['html'] = page_html(v)
        page.goto(f'https://claude.ai/new?v={name}')
        page.wait_for_timeout(3000)
        page.click('#edit')
        page.keyboard.type('s')
        page.wait_for_timeout(2600)
        res = {}
        for stage in ('rest', 'scroll+0.2s', 'scroll+2.2s'):
            if stage == 'scroll+0.2s':
                page.evaluate("() => { document.querySelector('.scroller').scrollTop = 0; }")
                page.wait_for_timeout(200)
            elif stage == 'scroll+2.2s':
                page.wait_for_timeout(2000)
            r = page.evaluate(rect_js)
            path = os.path.join(SHOTS or tempfile.gettempdir(), f'plate-{v.replace("@", "-")}-{stage.replace("+", "-")}.png')
            if SHOTS: os.makedirs(SHOTS, exist_ok=True)
            page.screenshot(path=path)
            m = measure(Image.open(path).convert('RGB'), r, frame)
            m['sky'] = r['sky']
            res[stage] = m
        # steady state: no mark may come and go (that would make the plate flicker every few seconds)
        res['flips'] = page.evaluate("""() => new Promise((done) => { let n = 0;
          const mo = new MutationObserver((rs) => { n += rs.filter((x) => /^data-hr-(sky|halo)/.test(x.attributeName || '')).length; });
          mo.observe(document.body, { attributes: true, subtree: true });
          setTimeout(() => { mo.disconnect(); done(n); }, 6500); })""")
        path = os.path.join(SHOTS or tempfile.gettempdir(), f'plate-{v.replace("@", "-")}-late.png')
        page.screenshot(path=path)
        m = measure(Image.open(path).convert('RGB'), page.evaluate(rect_js), frame)
        res['late'] = m
        res['ok'] = all(res[s]['ok'] and res[s].get('sky', True) for s in ('rest', 'scroll+0.2s', 'scroll+2.2s')) and m['ok'] and res['flips'] == 0
        results[v] = res
    ctx.close()
results['_errors'] = errors
results['_summary'] = {k: v['ok'] for k, v in results.items() if not k.startswith('_')}
print(json.dumps(results))
