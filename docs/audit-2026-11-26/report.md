# Headroom 1.4.3: end-to-end audit, fixes and recommendations

**Audited build:** `headroom-1.4.3.zip` (30 files, about 4,800 lines)
**Fixed build:** `headroom-1.4.4-fixed.zip` (version bumped to 1.4.4)
**Also delivered:** `headroom-1.4.3-to-1.4.4.patch` (unified diff), `headroom-test-harness.zip` (all tests and fixtures used here), `headroom-before-after.png`
**Date:** 26 Nov 2026

---

## 1. Summary

| | 1.4.3 (before) | 1.4.4 (after) |
|---|---|---|
| Header strip with weather on (your screenshot 1) | stays opaque | sky shows through |
| Composer strip with weather on (your screenshot 2) | side panels opaque, only the centre column cleared | whole strip cleared, input box keeps its own colour |
| Plate behind the input (screenshot 1) | opaque square behind the rounded box | cleared |
| Meter on a light page with the OS in dark mode | dark/black bar and panel | light bar and panel that match the page |
| Composer cleared on a 4,000-message chat | still opaque 7 s after load (cleared by 17 s) | cleared at the first check (≤ 4 s after load) |
| Usage + full-chat downloads after 3 Sky-strength changes | 3 + 3 per open tab | 0 + 0 |
| A message sent on a site that wraps `fetch` (Sentry style) | counted **2×** | counted 1× |
| Settings page left open while the bar is dragged | wrote the old bar position back | keeps the new position |
| `/api/organizations` lookups at start-up | 2 | 1 |
| Unit tests (16) / end-to-end scenarios (5) | 16/16 pass · 4 visual or behaviour bugs reproduced | 16/16 pass · 5/5 scenarios green |

The data parsers (Claude, ChatGPT/Codex, Gemini, Grok gRPC, Kimi, Perplexity), settings validation, import/export, message validation and redaction are solid: every unit test against them passed on the original code. The real defects were in the **weather sky's page clearing**, the **meter's theming**, the **network hook**, and the **refresh/settings plumbing**.

---

## 2. How I tested

### 2.1 Static review
I read every file: the manifest, the service worker, the MAIN-world hook (`inject.js`), the isolated content script, all 11 core modules, all 7 adapters, the options page and the welcome page. I traced data flow (page hook → content script → service worker → storage → tabs) and every trust boundary.

### 2.2 Unit tests (`unit.test.mjs`, Node's built-in test runner)
The pure modules (`quotas.js`, `common.js`, `parsers.js`, `weather-data.js`, `sky-palette.js`) are loaded into a fresh VM context. There are 16 tests:

- The manifest's content-script list equals `AM.CONTENT_BUNDLE`, every referenced file exists, both content-script entries and `host_permissions` cover the same sites, and every built-in provider host is covered.
- `pctOf`, `toTime`, `formatDuration` and `parseReset` (relative, 12-hour with "p.m.", 24-hour).
- `findLimits` on Grok-shaped and Perplexity-shaped JSON, `primaryMeter` choice rules, and `countMeters` rolling windows.
- `validateUsageMessage` and `validateInjectMessage` reject bad input and strip extra fields. `redact` masks emails, bearer tokens, JWTs and UUIDs.
- `mergeSettings` cleaning, an export/import round trip (the place is never exported), and import rejecting bad regexes.
- Provider parsers: Codex windows, a Gemini `batchexecute` frame, Kimi balances, a hand-built gRPC-web frame for Grok and the gRPC error trailer.
- `claudeChatStats` follows the current branch, ignores thinking blocks, and computes the cached cost.
- Weather: WMO mapping, India monsoon and southern-hemisphere seasons, forecast parsing, sky state.
- The sky palette gives finite uniforms for **every season × weather × half-hour**, including polar day (rise = set) and junk (NaN) sun times.

### 2.3 End-to-end tests in real Chromium (`e2e.mjs`)
- Playwright 1.63 starts Chromium (new headless, SwiftShader WebGL) with the **unpacked extension loaded**.
- Requests to `https://claude.ai/*` are answered locally, so the real content scripts inject exactly as on the live site:
  - A mock chat page **rebuilt from your two screenshots**. It has a header that is an ordinary flex child painted in the page colour at 85% with a blur, a scrolling conversation, a full-width composer strip that is *not* pinned, a centred sticky composer column, a square plate behind a rounded input, white tool cards, and a `role=dialog` menu.
  - The page colour is written in `oklch()`, as modern design systems do. Chrome reports it back unconverted.
  - A mock usage API (`/api/organizations`, `/usage`, conversation endpoint) that also counts the requests.
- Settings are written from the extension's own service worker: a place, forced rain at noon, and the debug log on.
- Checks after load, scroll, and the scenario steps:
  - **Backdrops:** the computed background alpha of the header, outer strip, inner column, plate, input, tool card and dialog.
  - **Meter colour:** the colour of the meter's track inside its shadow root, and its tone class.
  - **Network churn:** the usage and conversation requests that three Sky-strength changes trigger.
  - **Double counting:** the site wraps `fetch` after load (Sentry style), sends one message, and the test counts how many send requests the debug log recorded.
  - **Stability:** how often elements get marked and unmarked over 4.5 s of steady state (must be 0, which means no flicker).
  - **Theme toggle:** the page switches to a dark theme mid-session. The strips must be judged again against the new colour, and the meter must follow.
  - **Drag:** the bar is dragged from the top edge to the left edge, then the stored setting and the displayed edge are checked.
  - **Settings page:** with the page open, the bar position is changed elsewhere, then *Notifications* is toggled on the page. The stored bar position must survive.
  - **Fetch semantics:** `Request` objects, rejected fetches, a `this` binding and nested wrappers.
  - **Weather off:** the canvas, the marks, the stylesheet and the root style must all be removed.
  - **Cost:** script/layout/style time per second on a 4,000-message chat (Chrome DevTools Protocol metrics plus a CPU profile).
- Five scenarios run in a loop (`run-all.sh`):
  - light page + dark OS (your setup)
  - dark page + light OS
  - plain `rgb()` page
  - weather off
  - 4,000-message chat

Each fix was followed by a full re-run until every scenario was green. The same loop on the original build reproduced the bugs (results are in `results-orig.txt` and `results-fixed.txt` inside the harness zip).

### 2.4 Test results, original vs fixed (light page, dark OS)

```
                       1.4.3 (orig)                      1.4.4 (fixed)
header alpha           0.85 (opaque band)                0 (cleared)
composer outer alpha   1    (opaque sides)               0
composer inner alpha   0                                  0
plate alpha            1    (opaque square)               0
input / tool card      1 / 1 (kept)                       1 / 1 (kept)
dialog                 1 (kept)                           1 (kept)
meter track colour     rgb(44,40,61)  dark on light page  rgb(232,229,242) light
churn usage/chat       3 / 3                              0 / 0
sends logged           2                                  1
options stale write    meterStyle reverted to bar-left    bar-right kept
after dark toggle      header/outer/plate still painted   all cleared, meter tone-dark
mark flips (4.5 s)     0                                  0
```

---

## 3. Findings and fixes

Severity: **High** = visible breakage or wrong numbers; **Medium** = wasted network, CPU or data loss in some flows; **Low** = edge-case races, polish and hygiene.

### H1. Header and composer strip stay opaque when the weather sky is on (your screenshots). FIXED

**Symptom:** the sky shows everywhere except the header band (screenshot 1) and the strip around the message box. In screenshot 2 only the centre column was cleared, so two opaque side panels remained. Screenshot 1 also showed a square plate wider than the rounded input.

**Root causes** (`src/core/weather-sky.js`, original lines 388–449):
1. **Only "pinned" bands were cleared.** `bandShape()` required the element (or an ancestor up to 3 levels up) to be `position: fixed/sticky` *and* to touch the very top or bottom of the window. Claude's header and its full-width composer strip are ordinary flex children of the app shell, so they never qualified. Only the inner sticky column did, which is exactly the "cleared centre, opaque sides" pattern in screenshot 2. The plate behind the input does not touch the bottom edge, so it never qualified either (screenshot 1).
2. **Frosted headers were ignored.** `isBacking()` only accepted backgrounds with alpha ≥ 0.9. A header painted in the page colour at 80–90% with `backdrop-filter: blur()` (a common pattern) was skipped.
3. **Colour parsing assumed `rgb()`.** Chrome returns `oklch(...)`, `color(srgb r g b / a)` or `color-mix` results unconverted in `getComputedStyle`. `alphaOf()` split on spaces and read the *blue channel* as the alpha for `color(srgb …)`. `pageIsDark()` used an `rgb()`-only regex and fell through to weaker guesses.
4. **Slow on long chats.** The clearing pass walked `body.querySelectorAll('*')` in 4 ms slices from the top of the document, and the composer is at the end. On a 4,000-message mock chat the composer was still opaque 7 s after load (cleared only by about 17 s).

**What I did:**
- **New `src/core/page-tone.js`** (loaded in the content bundle and the custom-site bundle):
  - `AM.cssRGBA()` converts **any** CSS colour (`rgb`, `hsl`, `oklch`, `color()`, named) through a cached 1×1 canvas.
  - It also adds `AM.sameColour()`, `AM.pageIsDark()` and `AM.pageTone()`.
- **A new "page-tinted strip" rule** in `visit()`. An element is cleared when it is:
  - wide (≥ 40% of the window) and between 16 px and 85% of the window tall,
  - square-cornered (cards, bubbles and inputs are rounded and keep their own paint),
  - not inside a dialog, menu, tooltip or alert,
  - painted in **the page's own colour** at alpha ≥ 0.5, or with a gradient fade whose stops use that colour (`::before`/`::after` included).

  The principle: anything painted in the page colour is page backdrop, so once the page shows the sky it must go too, wherever it sits. The old pinned-band and full-screen rules are kept.
- **The page colour is read at mount.** When `<body>`/`<html>` carry none, it is learned from the first full-screen backdrop. **It is re-read on theme changes:** strips cleared for the old colour are judged again.
- **Tinted strips are re-validated by shape only.** Their colour can't be re-read while they are cleared, so a strip that becomes rounded, narrow, or part of an overlay gets its paint back.
- **Visible-first pass:** each tick runs `elementsFromPoint()` on a 5×9 grid that includes the edges. This covers the header, the composer and the backdrops in about 45 hit tests. It also runs while a long full walk is still in progress. The full walk now runs every third tick, or at once on resize, night-flip or theme change.
- **Scan cache:** an element whose classes, style length and size are unchanged is not re-read. Its position counts only near the top and bottom edges, so scrolling a long chat no longer invalidates everything.

**Verified:** all four strips are cleared in all five scenarios; the input, tool cards and the dialog keep their paint. Mark/unmark flicker in steady state is 0. The dark-theme toggle re-clears correctly. On the 4,000-message chat the composer is cleared by the first check (4 s or less after load). Steady-state script cost is about 8–9 ms/s versus about 6 ms/s before (well under 1% of a core), and most of the profile is the WebGL frame loop shared by both builds. Turning the weather off restores everything (no marks, no sheet, root style back to empty).

**Trade-off:** with the composer strip cleared, conversation text that scrolls *under* the composer now shows through around the input. 1.4.3 already did this in the centre column. See recommendation R1 for a frosted-glass option.

### H2. The meter uses the OS theme, not the page's (dark bar on light claude.ai). FIXED

**Symptom:** in both screenshots the bar along the top is near-black with white notch gaps on a light page. Your OS is in dark mode, but claude.ai is in its light theme.

**Root cause:** `src/core/widget.js` (original lines 20–26) switched every token through `@media (prefers-color-scheme: dark)`.

**Fix:**
- The dark tokens are now applied by a `tone-dark` class that follows `AM.pageTone()`. That reads the page's background (any colour syntax), then its declared theme, then its text colour, and only then the OS.
- The weather sky's night flip (which inverts a light page) counts as dark.
- The tone is re-read on every render, on OS theme change, and whenever the sky flips night mode or detects a page theme change (`AM.widget.retone()`).
- The OS media query remains the fallback when the page's tone can't be read.
- Also fixed: `--hr-chip` (close-button background) was never defined.

**Verified:**
- light page + dark OS: light track `rgb(232,229,242)`, class `tone-light`
- dark page + light OS: dark track, class `tone-dark`
- mid-session switch to a dark theme: the meter switches to `tone-dark`
- panel screenshot checked visually

### H3. One message is counted twice on sites that wrap `fetch` after load. FIXED

**Root cause:** `src/inject.js` (original lines 110–151) wraps `window.fetch` at start-up and, every 2 s, re-wraps whatever the page installed. Sentry, Datadog and many apps wrap `fetch` *after* load by wrapping the current function, which is Headroom's. Headroom then wraps their wrapper, so every call passes through two Headroom wrappers and each one posts a `request`.

**Impact:** estimate counters (Gemini, Grok, Kimi, custom sites) double-count sends. Claude's "send" handling fires twice.

**Fix:** a re-entrancy guard. The outermost wrapper reports the call, and inner wrappers called synchronously within it pass straight through. Fetch behaviour is unchanged.

**Verified:** the e2e test (a Sentry-style wrapper plus one POST) logged 2 sends before and 1 after. A dedicated check confirms `Request` objects, rejections (`TypeError`), `fetch.call(window, …)` and nested wrappers still behave.

### M1. Any settings change made every AI tab re-fetch usage and the whole chat. FIXED

**Root cause:** in `src/content.js` (original lines 258–268), every `settings` change in storage called `applyWeather()` and `refreshAdapter()`. Dragging the bar, moving the Sky-strength slider (a save every 300 ms while dragging), or toggling notifications therefore made every open Claude tab call `/usage` and download the full conversation.

**Fix:** the sky is restarted only when `weather`, `weatherPlace`, `weatherStrength` or `weatherForce` changes. The adapter is refreshed only when `quotas` or `customSites` changes. Everything else just re-publishes.

**Verified:** 3 strength changes gave 3 usage + 3 conversation requests before, 0 + 0 after.

### M2. The Claude adapter downloaded the whole conversation every minute. FIXED

**Root cause:** in `src/adapters/claude.js` (original lines 155–157 and 196–197), `refresh()` (every 60 s and on every tab focus) also called `refreshChat()`. That fetches `chat_conversations/{id}?tree=True&render_all_tools=true`, which for long chats is megabytes, per tab, per minute.

**Fix:**
- The chat is fetched when the open chat changes, 5 s and 45 s after a send, and when the tab comes back after more than 5 minutes away.
- `claudeChatStats()` now also returns `cachedCost`. The panel switches "Next message" from the cached cost to the full cost by itself when the cache expires, so it no longer needs a refetch to stay correct.
- `orgId()` now shares one in-flight lookup (2 `/api/organizations` calls at start-up became 1).

**Verified:** request counters in every scenario: usage 1, conversation 1, orgs 1 during the run. The unit test covers `cachedCost`.

### M3. The Settings page wrote stale values back. FIXED

**Root cause:** `src/options/options.js` loads settings once into `S` and saves the whole object on every change. With Settings open, if the bar was dragged to another edge or the weather was turned off from the on-page panel, the next change on the Settings page wrote the old values back.

**Fix:**
- The page now listens for settings changes made elsewhere and takes over only the keys that changed there. Its own writes are recognised by key-order-independent signatures, so a fast slider isn't overwritten by its own older save.
- It re-renders, unless you are typing in a text field.

**Verified:** the e2e test (position changed to the right edge elsewhere, then *Notifications* toggled in Settings) stored `bar-left` (wrong) before and `bar-right` after.

### M4. The Help page re-rendered on every debug-log write. FIXED
With debug on, a busy site writes the log several times a second. The Help page rebuilt itself each time, stealing focus and resetting scroll. It now refreshes at most every 2 s and never while you type.

### M5. Identical usage reports hammered the service worker. FIXED
`publish()` sent `headroom:usage` on every publish, including chat-length ticks every 4 s. Each message rewrote storage and woke the storage listener in every tab. Reports are now sent only when meters or the problem change, plus a 5-minute heartbeat so the badge and "updated" time stay fresh.

### L1. An orphaned copy kept the sky running after an extension reload or update. FIXED
`AM.shutdown()` removed the meter but not the weather canvas or the banner `MutationObserver`. After a reload, the old copy in an open tab kept animating and kept the page cleared, with no way to turn it off short of reloading the tab. A small `AM.onShutdown` hook list now destroys the sky and disconnects the observer (`store.js`, `content.js`, `banner.js`).

### L2. Added sites could keep running an outdated script list. FIXED
`syncSites()` in `background.js` only registered *missing* scripts. After an update that changed the bundle (as this one does with `page-tone.js`), existing registrations kept the old file list. Registrations whose list differs are now replaced on install, update and start-up.

### L3. The bar could snap back after a drag. FIXED (defensive, not reproduced)
Between dropping the bar and the saved setting coming back from storage, a usage report carrying the old settings would move the bar back to its old edge for a moment. The widget now keeps the dragged position for up to 3 s until storage confirms it.

### L4. Meter mount before `<body>` exists. FIXED
Every update before the body existed added another `DOMContentLoaded` listener. If the meter was switched off before load, a pending listener could still mount it. Now there is a single listener, and it uses the latest settings.

### L5. Panel polish. FIXED
"1 msgs" now reads "1 msg", and the "Next message" label no longer wraps onto two lines.

### L6. Privacy-policy links disagree, and neither loaded. PARTLY FIXED
Settings linked `devshrawin.github.io/Headroom/privacy` and the welcome page linked `/headroom/privacy`. GitHub Pages paths are case-sensitive, and **both returned a client error when fetched during this audit**. Both now use the same lowercase URL. **You still need to publish the page (or correct the URL).** A Chrome Web Store listing needs a working privacy policy.

### L7. Welcome copy was out of date. FIXED (copy only)
Step 4 said "Turn on Weather", but the weather is on by default and only needs a place. It now says to pick a place, and that it can be switched off in Settings or from the bar's panel.

### L8. Manifest hygiene. FIXED
Added `"minimum_chrome_version": "111"`: MAIN-world content scripts and CSS Color 4 in canvas need it. Bumped the version to 1.4.4.

### L9. Dead code. FIXED (safe deletions only)
Removed `AM.WEATHER_HOSTS` (`weather-data.js`), `AM.siteId` (`content.js`) and `AM.lastLimitEl` (`banner.js`): they were assigned but never read. Larger deletions are listed in R6 so you can check them against your own tests.

---

## 4. Recommendations (not implemented): what to change, update or delete, and where

| # | Where | What | Why |
|---|---|---|---|
| R1 | `weather-sky.js`, the sheet built at mount | Add an optional **"frosted strips"** look: give cleared *edge strips* `backdrop-filter: blur(12px)` instead of nothing. | Text scrolling under the composer/header shows through the cleared strip. Blur keeps the sky but hides the text. It needs care: `backdrop-filter` makes the element a containing block for `position: fixed` children. Ship it behind a setting and test the model menu. |
| R2 | `weather-sky.js` `tick()` (quality governor) | Add hysteresis: after a step down, block step-ups for about 30 s and require an average under 18 ms. | Step-up (120 frames under 22 ms) and step-down (45 slow ticks) have no cooldown, so a borderline GPU can bounce between resolutions. Each switch reallocates the canvas (one profile run showed about 430 ms of time in `resize`). |
| R3 | `core/chatdom.js` | Replace the 4-second `textContent` sweep of every message with a `MutationObserver` that keeps a running character count. | On long ChatGPT/Gemini chats it re-reads the whole conversation text every 4 s. |
| R4 | `adapters/kimi.js` `refresh()` | When the `kimi-auth` cookie is missing, report `'signin'` instead of `'error'`. | Signed-out users currently see "Can't read usage". |
| R5 | `background.js` | Add `chrome.notifications.onClicked` to focus or open the provider's tab. | Clicking a limit alert currently does nothing. |
| R6 | `core/common.js` | **Delete** the popup-era helpers that nothing calls: `AM.splitMeters`, `AM.cardSource`, `AM.sortEntries`, `AM.isStale`, `AM.STALE_MS`, `AM.fmtTokens` (in `parsers.js`). In `store.js`, either delete `AM.bus`/`AM.emit` or wire them up (the `'send'` and `'limit'` events have no listeners). | Dead code still ships in every page's content scripts. Check your own test suite first, since some may be referenced there. |
| R7 | repo root | Add `.gitattributes` (`* text=auto eol=lf`) and normalise line endings. | 20 files are CRLF and the rest LF, which causes noisy diffs. (My fixes keep each file's original endings.) |
| R8 | `welcome/welcome.html` art | Draw the bar along the **top** in steps 1–4, which is the default (`.b-bottom` is used everywhere). | The guide shows a different default from what users get. |
| R9 | CI | Run `unit.test.mjs` and `run-all.sh` on every change, and keep a short **manual live-site checklist** (signed in, light/dark theme, long chat, drag, weather on/off) for Claude, ChatGPT and Gemini. | The DOM-dependent parts (sky clearing, banners, chat stats) can only be fully proven on the live sites. |
| R10 | `core/store.js` | Replace the global `setInterval` override with an explicit `AM.every(fn, ms)`. | Overriding a global in the isolated world works, but it is surprising and also affects the injected sky script. |
| R11 | `core/common.js` `parseReset()` | Parse weekday names ("resets Monday 9 AM"). | Today such text resolves to the next 9 AM, which can be days early. |
| R12 | `content.js` `handle()` (429 handling) | Limit the 429 → "Rate limited 100%" meter to each provider's send and usage endpoints. | A 429 from any non-noise endpoint (for example a feature flag service) shows the user as rate-limited for an hour. |
| R13 | `inject.js` `sameSite()` | Use a public-suffix-aware check, or compare against the provider's known hosts. | `split('.').slice(-2)` treats every `*.co.uk` site as the same site (only affects debug "shape" capture). |
| R14 | Store listing | Keep a one-line justification ready for `optional_host_permissions: https://*/*` and `scripting`. | Web Store review asks for it. It is only requested per site you add, which is fine. |

---

## 5. Files changed in 1.4.4

| File | Change |
|---|---|
| `manifest.json` | version 1.4.4, `minimum_chrome_version: 111`, `src/core/page-tone.js` added to the content bundle |
| `src/core/page-tone.js` | **new**: colour conversion for any CSS syntax, page tone, same-colour test |
| `src/core/quotas.js` | `CONTENT_BUNDLE` includes `page-tone.js` (it must match the manifest; the unit test checks this) |
| `src/core/weather-sky.js` | page-tinted strip rule, robust alpha/colour reading, visible-first pass, scan cache, theme re-evaluation, meter retone |
| `src/core/widget.js` | page-based tone, `--hr-chip`, drag snap-back guard, single `DOMContentLoaded` listener, switched-off race, cached/full next-message cost, text polish |
| `src/inject.js` | re-entrancy guard against double counting |
| `src/content.js` | targeted reactions to settings changes, deduplicated reports, shutdown hook for the sky, dead `AM.siteId` removed |
| `src/adapters/claude.js` | chat fetched only when needed, shared org lookup |
| `src/core/parsers.js` | `cachedCost` in chat stats |
| `src/core/store.js`, `src/core/banner.js` | `AM.onShutdown` hooks; observer disconnected; dead `AM.lastLimitEl` removed |
| `src/background.js` | stale custom-site registrations replaced |
| `src/options/options.js` | merges changes made elsewhere, ignores its own writes, throttles log refresh, privacy URL unified |
| `src/core/weather-data.js` | dead `AM.WEATHER_HOSTS` removed |
| `src/welcome/welcome.html` | step 4 copy |

The full diff is in `headroom-1.4.3-to-1.4.4.patch` (apply from the folder that contains the extension root, or just use the fixed zip).

---

## 6. Limits of this audit (please read)

- **No live claude.ai session.** I could not sign in to claude.ai from the test environment. The page-clearing fix was proven on a mock rebuilt from your screenshots, which reproduces both bugs exactly on 1.4.3. Claude's real DOM may differ in details, so please load the 1.4.4 zip unpacked (`chrome://extensions` → Developer mode → Load unpacked) and check the header and composer with the weather on. If any strip is still opaque, *Copy debug log* plus a screenshot is enough for me to adjust the rule.
- **Other providers.** ChatGPT, Gemini, Grok, Perplexity and Kimi were checked by code review and parser unit tests, not against their live sites.
- **Performance figures** come from headless Chromium with software WebGL (SwiftShader). Absolute numbers on your GPU will differ; use the before/after comparison, not the absolute values.
- **Privacy URL:** the "failed to load" result was a single fetch during the audit. Verify it in a browser.



---

## 7. Follow-up (1.4.5, 26 Nov 2026)

This section is written by the developer who took the audit over. The 1.4.4 fixes were applied unchanged to the repository (the audit's "1.4.3 original" matched the repository's 1.4.3 source file for file), then the recommendations were carried out. 1.4.4 itself was never published; everything ships as **1.4.5**.

### 7.1 What changed

| Item | Status | What was done | Test that covers it |
|---|---|---|---|
| H1-H3, M1-M5, L1-L9 | Done (applied from 1.4.4) | The audit's patch, with each file's line endings kept. Two repository tests were adjusted because the audit changed what they assert (see 7.3). | The audit's 16 unit tests, its 5 end-to-end scenarios, and the repository's own suite. |
| R1 Frosted strips | Done | New setting `frostedStrips`, off by default (Settings > Weather > Frosted strips). Cleared strips that touch the top or bottom edge get `backdrop-filter: blur(12px)`, through a `data-hr-frost` mark and a rule gated by `data-hr-frost-on` on the root. The rule is `:not(:has(<overlay selectors>))`, so a strip holding a menu, dialog, listbox or popover is left unfrosted at once (`backdrop-filter` would re-anchor its `position: fixed` children). | e2e scenario `frosted-strips`: off by default; on blurs only the header and the composer strips; a strip that holds a `role=menu` is not frosted; frost returns when it closes; off removes every blur. Unit: default, junk values, export/import round trip. |
| R2 Governor hysteresis | Done | The governor is now a pure factory (`AM.WeatherSky.makeGovernor`). After a step down, step-ups are blocked for 30 s and need an average frame gap under 18 ms. | 5 unit tests (slow GPU steps down; the cooldown blocks a step-up; 20 ms frames do not raise it; no oscillation across slow/fast rounds; a fast GPU never steps down and never exceeds 1). e2e `quality-settles`: over 12 s the canvas width never goes up and changes at most 3 times. |
| R12 429 scope | Done | `AM.isLimitEndpoint()` (common.js) lists each provider's send and usage endpoints; `handle()` uses it. | Unit test with the real endpoints of the providers (true) and flag, telemetry and title calls (false). |
| R4 Kimi sign-in | Done | A missing `kimi-auth` cookie reports `signin` ("Sign in to Kimi to see your balance."). | `problems.test.mjs` (updated). |
| R5 Alert click | Done | `chrome.notifications.onClicked` focuses the provider's open tab and window, else opens its home page. Works for threshold, reset and custom-site (`site:host`) alerts; ids that are not ours do nothing. No new permission: the existing host access covers `tabs.query` by URL. | `background.test.mjs` (focus, open, reset id shape, custom site, foreign id). |
| R3 Incremental chat count | Done | `chatdom.js` keeps a per-message length cache; a MutationObserver marks only changed messages (a streaming reply, a new message). Without an observer it falls back to the old full re-read. | New `chatdom.test.mjs`: only the changed message is re-read; new and removed messages; no chat gives null; no-observer fallback. |
| R11 Weekday resets | Done | `parseReset` handles day names (full and 3-letter) and "tomorrow"; a day with no time means the start of that day; words that merely contain `sat` or `mon` are not days. | `common.test.mjs`. |
| R13 Public suffixes | Done | `baseDomain()` in `inject.js`: three labels under a two-level suffix (`co.uk`, `com.au`, `co.jp`...). | `channel.test.mjs`: with the page on `app.example.co.uk`, `api.example.co.uk` and `example.co.uk` are the same site and `other.co.uk` is not. Fails on the old code. |
| R8 Welcome art | Done | All the pictures now draw the bar on the top edge; the drop zones are bottom, left and right. Checked visually. | `settings-io.test.mjs`: the art uses the top bar, no `b-bottom` is left, and the default position is top. |
| R10 `AM.every` | Done | `AM.every(fn, ms)` in `store.js` replaces the global `setInterval` override; adapters, chatdom and the widget use it. | `content.test.mjs`: jobs run while alive and do nothing after `AM.shutdown()`, even a tick queued before the shutdown. |
| R9 CI | Done | `.github/workflows/ci.yml`: `npm test`, then the e2e harness under `xvfb`. The harness lives in `e2e/` (Node only, no Python; its one dependency is Playwright, which is not part of the extension package). | Not run on GitHub yet (see 7.4). |
| R14 Store justifications | Done | One-line justifications for `storage`, `alarms`, `notifications`, `scripting`, the host permissions, the optional host permission and remote code, in `docs/store/listing.md`. `geolocation` is no longer declared (since 1.4.3). | n/a |
| Privacy URL | Done | Both in-extension links now use `https://github.com/devshrawin/Headroom/blob/main/docs/privacy.md`, the URL the store listing already uses (it returns 200; both `github.io` addresses return 404). | `settings-io.test.mjs`: every in-extension link equals the listing's URL and none points at `github.io`. |
| R7 Line endings | Done as its own commit after this work is merged | A `.gitattributes` with `* text=auto eol=lf` plus a renormalise. | n/a |
| R6 Unused helpers | Done: deleted (decision recorded in 7.5) | `AM.splitMeters`, `AM.cardSource`, `AM.sortEntries`, `AM.isStale`, `AM.STALE_MS`, `AM.fmtTokens`, `AM.bus`, `AM.emit` and the three emit calls removed. | Their 5 tests removed with them (repository suite 173 → 168); every other test, the audit tests and all 7 e2e scenarios still pass. |

### 7.2 Test results, before and after

| Suite | Before (1.4.3 plus the audit's 1.4.4) | After (1.4.5) |
|---|---|---|
| Repository unit tests (`npm test`) | 160 pass, 0 fail | 168 pass, 0 fail (173 before the R6 deletion removed 5 tests of deleted helpers) |
| Audit unit tests (`e2e/audit-unit.test.mjs`) | 16 / 16 | 16 / 16 |
| End-to-end scenarios (`e2e/run-all.mjs`) | 5 / 5 green | 7 / 7 green (adds `frosted-strips` and `quality-settles`) |
| Baseline in every scenario | errors `[]`, markFlips 0, churn 0 / 0, sendsLogged 1; header, composer-outer, composer-inner and plate alpha 0 with the weather on; input, tool card and dialog alpha 1; meter track light on light pages and dark on dark | unchanged |

`run-all.mjs` replaces the audit's `run-all.sh` (which used `python3` to format its output) and now fails the run when a baseline value changes, instead of only printing it.

### 7.3 Two repository tests that had to change

- `a settings change re-applies without reloading the page`: the audit's M5 fix stops identical usage reports from being re-sent, so the test now asserts that an unchanged report is not sent again.
- The forecast-URL test asserted on `AM.WEATHER_HOSTS`, which the audit removed as dead code; it now asserts the two Open-Meteo URLs directly.

### 7.4 Still open

- **Phase 1 live verification has not been done.** It needs a signed-in Chrome profile, which was not available to the developer. Everything above was proven on the mock page and in the unit tests. To close it: load the repository root (or `release/2026-11-26/headroom-1.4.5.zip`, unzipped) unpacked. On claude.ai, in the light and dark themes, with the OS in dark and in light mode, check that the header and the strip around the message box show the sky; the input, code blocks, cards, menus and dialogs keep their colour; nothing flickers while scrolling a long chat; the bar and panel match the page theme; the bar can be dragged to every edge and survives a reload with Settings open; turning the weather off from the panel and from Settings restores the page. Repeat quickly on chatgpt.com and gemini.google.com. If a strip stays opaque, use the panel's "Copy debug log", note the element's computed background, border-radius, size and position, and add that shape to `e2e/fixtures/claude.html`.
- The CI workflow has not run on GitHub yet; it needs one push to confirm that `xvfb-run` and `playwright install --with-deps` work on the runner.
- The e2e numbers come from software WebGL (SwiftShader), as in the audit; absolute timings on a real GPU will differ.
- The other providers are still verified by code review and parser tests only.

### 7.5 R6: decision (made by the developer, on the owner's instruction to decide)

**Decision: delete.** Reasons: the toolbar popup these helpers served was removed in 1.4.1, so nothing in the shipped extension calls them; they were still copied into every page's content scripts; the only things referencing them were their own unit tests (plus event emitters that nothing listened to); and the audit's search showed no other caller. Keeping dead code has a cost (every tab loads it, and tests keep it looking alive) and deleting it is recoverable from git history, so the risk is low.

What was removed: `AM.splitMeters`, `AM.cardSource`, `AM.sortEntries`, `AM.isStale`, `AM.STALE_MS` (core/common.js), `AM.fmtTokens` (core/parsers.js), `AM.bus`, `AM.emit` and the three `emit` calls in the Claude adapter, the banner watcher and the estimator (core/store.js). If a future popup or panel needs a multi-service overview again, restore them from the 1.4.0 commit.


---

## 8. Follow-up (1.4.6, 27 Nov 2026)

After 1.4.5 the owner still saw a pale square plate behind the message box on the live page. An external fix round produced 1.4.6 on top of 1.4.5; it changes three files (`src/core/weather-sky.js`, `src/options/options.js`, `manifest.json`), no permissions. The delivered `headroom-1.4.6.zip` was compared byte for byte with the repository's 1.4.5: only those three files differ, and the repository's own 1.4.5 additions (frosted strips, governor hysteresis, `AM.every`, the 429 scope and the rest) are all still there.

### 8.1 What 1.4.6 changed

- **The plate or frame around the message box.** A new halo pass finds the message box (the outermost rounded, painted ancestor of the textarea or contenteditable, if it is composer-sized) and switches off background, border and box-shadow on the elements that hug it: its ancestors no more than 72 px wider on each side, their wide square children, and whatever `elementsFromPoint` hits just outside it. It also switches off the box's own `::before`/`::after` and outlines of 4 px or more. The marks go on before any paint appears, so a frame that only shows on scroll or focus is already off. The pass runs every 1.5 s and in the next animation frame after scroll and focus events. The on-screen pass now reads fresh styles every time (it used to miss `:focus-within` and scroll-state paint), and a rounded `::before`/`::after` card is no longer cleared as a page-coloured strip.
- **A vivid sky that does not wash anything out.** Removed: the white wash (`uLift`, `uVeil`), the night fade, the brightness and saturation filters on the canvas, and the night page inversion (`data-hr-night`, "pure" mode). New shader stage `inkSafe()` in OKLab: chroma x1.4 (up to x2.2 for near-greys); gamut mapping that only reduces chroma, so hue never shifts; and a lightness band chosen by the text colour (dark text keeps the sky at L >= .64, white text at L <= .50, 0.10 knee). Stars, the sun and moon discs and the lightning bolt are drawn after the band. Sky strength is blended inside the shader toward the page colour (`uMix`, `uPage`); the canvas is always at opacity 1.
- **Automatic text colour.** `decideInk()` picks dark or white text, whichever needs the smaller lightness change to the sky (sampled at the top, middle and horizon, including clouds, fog and Sky strength; a switch needs a 0.02 margin held for 2.5 s) and writes `data-hr-ink` on `<html>`; a CSS rule then sets the text colour of non-island elements. Islands (`data-hr-island`) are elements with their own paint: background alpha >= .5, a background image or gradient, or a painted `::before`/`::after`. They keep the site's colours, found in the first scan and then through a MutationObserver and pointer, focus and transition events (hover backgrounds). An island that would inherit the forced colour gets its original colour pinned inline; the pin goes when it stops being an island and when the sky is switched off.
- `options.js`: a new description for Sky strength. `manifest.json`: version 1.4.6.

### 8.2 Test results

| Suite | Result |
|---|---|
| Repository unit tests (`npm test`) | 168 / 168 |
| Audit unit tests (`e2e/audit-unit.test.mjs`) | 16 / 16 |
| End-to-end scenarios (`e2e/run-all.mjs`) | 7 / 7, all baseline values unchanged |
| Plates and frames around the message box (`e2e/plates.mjs`, 13 variants, at rest, 0.2 s and 2.2 s after a scroll, and flicker) | 13 / 13 on 1.4.6. Run on the 1.4.5 build it fails (for example `fborder`); the delivery's own run of its Python original measured 2 / 13 on 1.4.5 |
| Text colour over time (`e2e/ink.mjs`: hover, streaming, pseudo-element cards, theme switch) | 10 / 10 |
| "Weather off restores the page" (marks, root attributes, pinned colours, canvas, sheet) | nothing left behind |
| Sky lab, 70 states (7 weathers x 5 times x light and dark page), from the delivered `results/lab14[56].json`; not re-run here because it is Python | worst text contrast on the sky 6.34 : 1, none below 4.5 (1.4.5: worst 1.00, 65 of 70 below 4.5). Mean sky chroma .0600 against .0323 |

Test changes: the "palette and shader agree on every uniform" test listed `uVeil` and `uLift`; it now lists the new uniforms (`uInk`, `uVivid`, `uPage`, `uMix`) and asserts that the two removed ones stay removed. No other test asserted the removed behaviour (nothing in the repository asserted canvas opacity or filters at night, `data-hr-night` or the "pure" inversion).

### 8.3 Notes

- The Python suites (`plates.py`, `ink_behaviour.py`) cannot run on the owner's machine (Python is blocked), so they were ported to Node (`e2e/plates.mjs`, `e2e/ink.mjs`) with the same measurements and thresholds, and both are part of `e2e/run-all.mjs` and so of CI. The originals, the patch, the fixtures and the results are kept as delivered in `tests/headroom-1.4.6/`. `sky_lab.py` is kept for a machine that has Python.
- One deliberate deviation in the ink port: the Python test looked once, 450 ms after the pointer moved, at the hover row. Under software WebGL the text colour sometimes needs about 0.8 s to follow the pointer (on a slow frame; it takes about 0.2 s otherwise), so the port polls for up to 2.5 s and reports how long it took (`hoverMs`, `unhoverMs`). The colour always corrected itself; the check still fails if it never does.
- Phase 1 (the live check on claude.ai, ChatGPT and Gemini) is still the owner's: header, message box (typing, scrolling), light and dark theme, day and night.

### 8.4 Review of the delivery before pushing (27 Nov 2026)

A second reviewer read the 1.4.5 to 1.4.6 change and the new test code. By the owner's instruction 1.4.6 is applied **as delivered**; the owner uploads the delivered zip after a live check, so the findings below are recorded here and **not fixed in the delivered `weather-sky.js`**. They are the first things to look at in a follow-up round.

Should fix in `src/core/weather-sky.js`:
1. **Island queue dropped above 6000 elements.** When more than 6000 elements are queued in one frame the loop stops and the rest of the queue is cleared; after the first scan the full walk no longer looks at islands, so those cards can keep the forced text colour (white on white at night). Suggested: keep the unprocessed elements queued and schedule another frame.
2. **Stale pins and a leak.** `data-hr-island` is removed in several places (about lines 504, 667, 673, 698) without un-pinning the element's text colour, and detached elements are never removed from the `pinned` map, which keeps whole old conversation trees alive after chat switches in a single-page app. Suggested: un-pin wherever the island mark is removed, and prune disconnected entries in `clearBackdrops`.
3. **The halo pass reaches into the conversation.** Its last step marks any element just outside the message box that is not rounded or interactive; once the plate is cleared that includes conversation content scrolling behind the composer (tables, rules, blockquotes, inline code), so their borders and backgrounds vanish near the composer and return as marks expire. Suggested: limit that step to elements outside the conversation's scroll container, or inside the composer's own subtree.
4. **The ink band applies before `data-hr-ink` is set.** During the first full walk, which can take seconds on a big chat, the site's own text sits on a sky banded for the other text colour. Suggested: keep the shader's ink at 0 until the ink is active. (This also shows in the e2e big-chat scenario, where `data-hr-ink` is still unset when the check runs.)

Worth knowing: `readDark` (any `<head>` child or `<html>`/`<body>` attribute change) un-pins and re-pins every island with the sheet toggled, a full style recalculation on chats with thousands of islands; a single text colour erases link colour (WCAG 1.4.1); nothing handles `forced-colors: active` or `prefers-contrast: more` (consider not mounting the sky there); the moon, sun and lightning are drawn after the lightness band, so white text over the moon disc can be hard to read; `__hrDeep` is set as a property on page nodes (a WeakSet would leave nothing behind). Dead `data-hr-night` reads remain in `core/page-tone.js` and `weather-sky.js` (nothing sets the attribute any more; harmless).

Privacy: only computed styles and geometry are read, no text content, and there is no network call. The 1.4.5 features in the same file (quality governor, frosted strips, shutdown path, exports) are all still in place and wired.

What to test on the live site first: claude.ai at night (white ink) on a long chat, then switch chats and look for white-on-white cards; scroll a table behind the composer; toggle the site's dark theme; stream a long code reply; turn the sky off and check that no `[style*=color]` is left on the page.

Changes made in the repository in response (test code only, nothing shipped): the "weather off restores the page" check now lives in `e2e/ink.mjs`, where the ink is active (it asserts that ink and islands existed first, then that no marks, root attributes, pinned colours or canvas remain); the earlier version in `e2e/run-all.mjs` could pass on nothing and was removed; `e2e/plates.mjs` and `e2e/ink.mjs` resolve the default extension path from the file and delete their temporary browser profile.
