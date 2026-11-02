// Level glyphs and source tags for the extension's own pages (popup). The on-page meter has its own copy in widget.js,
// because it runs inside the content-script bundle. Shapes: ok = filled dot, close = half dot, critical = triangle,
// empty = square, unknown = dashed ring, problem = ring with "!", hollow = a stale "ok".
(() => {
  const AM = globalThis.AIMeter;
  const NS = 'http://www.w3.org/2000/svg';
  const CUR = 'currentColor';
  const node = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const svg = (cls, w, h, vb, kids) => {
    const s = node('svg', { viewBox: vb, 'aria-hidden': 'true' });
    if (cls) s.setAttribute('class', cls);
    if (w) { s.setAttribute('width', w); s.setAttribute('height', h); }
    kids.forEach((k) => s.append(k));
    return s;
  };
  const SHAPES = {
    ok: () => [node('circle', { cx: 6, cy: 6, r: 5, fill: CUR })],
    hollow: () => [node('circle', { cx: 6, cy: 6, r: 5, fill: 'none', stroke: CUR, 'stroke-width': 1.6 })],
    close: () => [node('circle', { cx: 6, cy: 6, r: 4.6, fill: 'none', stroke: CUR, 'stroke-width': 1.6 }), node('path', { d: 'M6 1.4a4.6 4.6 0 0 1 0 9.2z', fill: CUR })],
    crit: () => [node('path', { d: 'M6 .8 11.4 10.6H.6z', fill: CUR })],
    empty: () => [node('rect', { x: 1.2, y: 1.2, width: 9.6, height: 9.6, rx: 1.6, fill: CUR })],
    unk: () => [node('circle', { cx: 6, cy: 6, r: 4.6, fill: 'none', stroke: CUR, 'stroke-width': 1.6, 'stroke-dasharray': '2.4 2' })],
    problem: () => [node('circle', { cx: 6, cy: 6, r: 4.8, fill: 'none', stroke: CUR, 'stroke-width': 1.5 }),
      node('path', { d: 'M6 3.3v3.4', stroke: CUR, 'stroke-width': 1.6, 'stroke-linecap': 'round' }), node('circle', { cx: 6, cy: 8.7, r: 0.9, fill: CUR })],
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  AM.glyphs = {
    // a 12 px level glyph inside a span coloured by level (lv-ok, lv-close, lv-crit, lv-empty, lv-unk)
    glyph(kind, level) {
      const b = el('span', 'glyph lv-' + (level || 'unk'));
      b.setAttribute('aria-hidden', 'true');
      b.append(svg('g', null, null, '0 0 12 12', SHAPES[kind]()));
      return b;
    },
    // real = solid chip with a tick, estimate = dashed chip with "≈", banner = flagged chip
    tag(source) {
      if (source === 'real') {
        const t = el('span', 'tag t-real');
        t.append(svg(null, 9, 9, '0 0 10 10', [node('path', { d: 'M1.5 5.2 4 7.6 8.6 2.6', fill: 'none', stroke: CUR, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })]), 'real');
        return t;
      }
      if (source === 'estimate') return el('span', 'tag t-est', '≈ estimate');
      if (source === 'banner') {
        const t = el('span', 'tag t-ban');
        t.append(svg(null, 9, 9, '0 0 10 10', [node('path', { d: 'M2 1v8.4', stroke: CUR, 'stroke-width': 1.4, 'stroke-linecap': 'round' }), node('path', { d: 'M2.6 1.2h5.6L6.9 3.3l1.3 2.1H2.6z', fill: CUR })]), 'banner');
        return t;
      }
      return null;
    },
  };
})();
