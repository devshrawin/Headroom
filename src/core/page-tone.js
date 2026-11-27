// Page colours, read the way the browser paints them. Shared by the meter (so it matches the page, not the OS
// theme) and by the weather sky (to recognise the page's own colour on headers and composer strips).
// DOM only, no chrome.* calls.
(() => {
  const AM = globalThis.Headroom;
  const cache = new Map();
  let ctx2d = null;
  const SENTINEL = 'rgba(1, 2, 3, 0)';

  // Any CSS colour (rgb(), hsl(), oklch(), color(srgb …), named) → [r, g, b, a] (0..255, alpha 0..1), or null.
  // Modern sites write colours in oklch / color-mix, and getComputedStyle hands those back unconverted,
  // so a plain rgb() regex misses them. A 1×1 canvas converts anything the browser understands.
  AM.cssRGBA = (css) => {
    css = String(css || '').trim();
    if (!css) return null;
    if (cache.has(css)) return cache.get(css);
    let out = null;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(css);
    if (m) out = [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[5] ? +m[4] / 100 : +m[4]];
    else if (css === 'transparent') out = [0, 0, 0, 0];
    else {
      try {
        if (!ctx2d) {
          const c = document.createElement('canvas');
          c.width = c.height = 1;
          ctx2d = c.getContext('2d', { willReadFrequently: true });
        }
        ctx2d.fillStyle = SENTINEL;
        ctx2d.fillStyle = css;
        if (ctx2d.fillStyle !== SENTINEL || /^rgba\(\s*1,\s*2,\s*3,\s*0\s*\)$/.test(css)) {
          ctx2d.globalCompositeOperation = 'copy';
          ctx2d.fillRect(0, 0, 1, 1);
          const d = ctx2d.getImageData(0, 0, 1, 1).data;
          out = [d[0], d[1], d[2], d[3] / 255];
        }
      } catch { out = null; }
    }
    if (cache.size > 400) cache.clear();
    cache.set(css, out);
    return out;
  };

  // Relative luminance 0..1 of an opaque-enough colour, else null.
  AM.cssLuma = (css) => {
    const c = AM.cssRGBA(css);
    if (!c || c[3] < 0.5) return null;
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  };

  // Two colours that read as the same paint (alpha ignored): max channel difference within tol.
  AM.sameColour = (a, b, tol = 10) => !!a && !!b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

  // Is the page itself dark? Its own background first, then its declared theme, then its text colour, then the OS.
  // ignoreNight: skip the "our night flip is on" short-circuit (used when re-reading the page's real theme).
  AM.pageIsDark = (ignoreNight) => {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const l = AM.cssLuma(getComputedStyle(el).backgroundColor);
      if (l !== null) return l < 0.45;
    }
    const root = document.documentElement;
    if (!ignoreNight && root.hasAttribute('data-hr-night')) return false; // our own light-text rule is on: the page underneath is light
    const cs = getComputedStyle(root).colorScheme || '';
    if (/\bdark\b/.test(cs) && !/\blight\b/.test(cs)) return true;
    if (/(^|\s)dark(\s|$)/.test(root.getAttribute('class') || '') || /dark/i.test(root.getAttribute('data-theme') || root.getAttribute('data-color-mode') || '')) return true;
    if (document.body) {
      const tl = AM.cssLuma(getComputedStyle(document.body).color); // light text means a dark page
      if (tl !== null) return tl > 0.6;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  // What the visitor sees: 'dark' or 'light'. Our night flip (the sky inverts a light page at night) counts as dark.
  AM.pageTone = () => {
    try {
      if (document.documentElement.hasAttribute('data-hr-night')) return 'dark';
      return AM.pageIsDark(true) ? 'dark' : 'light';
    } catch { return null; }
  };
})();
