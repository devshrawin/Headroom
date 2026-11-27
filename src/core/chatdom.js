// Per-chat stats read from the page's own rendered messages — works signed in or out, no API calls.
(() => {
  const AM = globalThis.Headroom;

  // cfg: { selector, ratio (tokens per char), systemTokens?, next?(tokens) → tokens, note? }
  //
  // The character count is kept incrementally: a MutationObserver marks only the messages that changed (a streaming reply
  // changes one message, not the whole chat), and only those are re-read. Every 4 s the stats are recomputed from the cached
  // per-message lengths, which costs nothing when nothing changed. Without a MutationObserver it falls back to re-reading
  // every message each time.
  AM.watchDomChat = (ctx, cfg) => {
    let lastKey = '';
    const lens = new WeakMap(); // message node → its text length
    const dirty = new Set(); // message nodes whose text changed since they were last read
    let all = true; // true: re-read everything (first run, or no observer)

    const messageOf = (n) => {
      try {
        const el = n && n.nodeType === 1 ? n : n && n.parentElement;
        return el && el.closest ? el.closest(cfg.selector) : null;
      } catch { return null; }
    };
    const onMutations = (records) => {
      for (const r of records) {
        const m = messageOf(r.target);
        if (m) dirty.add(m); // text typed or streamed into a message
        if (r.type === 'childList') {
          for (const n of r.addedNodes || []) {
            const inner = messageOf(n);
            if (inner) dirty.add(inner);
            else if (n.nodeType === 1 && n.querySelectorAll) for (const x of n.querySelectorAll(cfg.selector)) dirty.add(x); // a whole message (or list of them) appeared
          }
        }
      }
    };
    let mo = null;
    try {
      if (typeof MutationObserver === 'function' && document.body) {
        mo = new MutationObserver(onMutations);
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    } catch { mo = null; }
    if (mo) (AM.onShutdown = AM.onShutdown || []).push(() => { try { mo.disconnect(); } catch {} });

    const run = () => {
      if (!ctx.visible()) return;
      const nodes = document.querySelectorAll(cfg.selector);
      if (!nodes.length) {
        if (lastKey !== 'none') {
          lastKey = 'none';
          ctx.setChat(null);
        }
        return;
      }
      let chars = 0;
      for (const n of nodes) {
        let len = lens.get(n);
        if (len === undefined || all || dirty.has(n)) { len = (n.textContent || '').length; lens.set(n, len); }
        chars += len;
      }
      dirty.clear();
      all = !mo;
      const tokens = Math.ceil(chars * cfg.ratio) + (cfg.systemTokens || 0);
      const key = `${location.pathname}:${nodes.length}:${tokens}`;
      if (key === lastKey) return;
      lastKey = key;
      ctx.setChat({
        tokens,
        messages: nodes.length,
        nextCost: cfg.next ? cfg.next(tokens) : undefined,
        note: cfg.note,
      });
    };
    run();
    AM.every(run, 4000);
  };
})();
