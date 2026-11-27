# Changelog

All notable changes to Headroom (called AI Meter before 1.0.0). Versions follow `manifest.json`.

## 1.5.0 — 2026-11-27

### Added
- **Fluid background.** Settings → Weather → **Background** now chooses between the real-weather sky and a dark fluid simulation: coloured smoke that swirls, glows and follows your cursor (and drifts on its own when the cursor is idle). It needs no place or forecast. The fluid draws on its own canvas above the sky canvas; the existing sky code keeps doing the rest for it (clearing the page backdrops and the plate around the message box, picking white text, the frosted-strips option, putting the page back exactly when it is switched off). The sky shader itself does not draw while the fluid is on. Sky strength dims the fluid toward the page colour. If the fluid cannot start (no WebGL2 or float textures) the weather sky is used instead.
- The fluid is a trimmed port of Pavel Dobryakov's WebGL Fluid Simulation (MIT licence; the notice is kept in `src/core/fluid-sim.js` and `THIRD_PARTY_NOTICES.md`), lighter than the original (128 / 512 simulation and dye resolution, 12 pressure iterations, 30 frames a second, the same resolution governor as the sky), with no control panel, no audio, no network. It pauses in hidden tabs, and with reduced motion it shows a single still frame and ignores the cursor. The renderer is injected only when the fluid is chosen, so there is no new permission.
- New setting `weatherStyle` ('sky' by default, or 'fluid'), included in export and import.

## 1.4.6 — 2026-11-27

From an external fix round on 1.4.5 (three files changed: `src/core/weather-sky.js`, `src/options/options.js`, `manifest.json`; no permission changes). See section 8 of `docs/audit-2026-11-26/report.md` and the imported tests in `tests/headroom-1.4.6/`.

### Fixed
- The white plate or frame around the message box is gone. A new "halo" pass finds the message box (the outermost rounded, painted ancestor of the textarea or contenteditable, if it is composer-sized) and switches off the background, border and box-shadow of the elements that hug it (its ancestors no more than 72 px wider on each side, their wide square children, and whatever sits just outside it), plus the box's own `::before`/`::after` and outlines of 4 px or more. The marks are set before any paint appears, so a frame that only shows on scroll or on focus is already off. It runs every 1.5 s and on the next animation frame after a scroll or focus event.
- The on-screen pass reads fresh styles every time; before, its cache missed `:focus-within` and scroll-state paint.
- A rounded `::before`/`::after` card is no longer cleared as a page-coloured strip.
- Sky strength is now blended inside the shader toward the page colour, and the canvas is always at opacity 1.

### Changed
- The sky is vivid again and text stays readable by choosing the text colour, not by washing the sky out. Removed: the white wash (`uLift`, `uVeil`), the night fade, the brightness and saturation filters on the canvas, and the night page inversion (`data-hr-night`, "pure" mode). A new shader stage works in OKLab: chroma boost (x1.4, up to x2.2 for near-greys), gamut mapping that only reduces chroma (hue never shifts), and a lightness band chosen by the text colour (dark text keeps the sky at L >= .64, white text at L <= .50, with a 0.10 knee). Stars, the sun and moon discs and the lightning bolt are drawn after the band.
- Automatic text colour: the sky picks dark or white text, whichever needs the smaller lightness change (sampled at the top, middle and horizon, including clouds, fog and Sky strength; a switch needs a 0.02 margin held for 2.5 s) and writes it as `data-hr-ink` on `<html>`. Elements with their own paint ("islands": background alpha >= .5, a background image or gradient, or a painted `::before`/`::after`) keep the site's colours, found in the first scan and then through a MutationObserver and pointer, focus and transition events (hover backgrounds). Turning the sky off removes every mark and every pinned colour.
- Settings → Sky strength has a new description: text stays readable at any setting.

## 1.4.5 — 2026-11-26

Contains the whole external audit of 1.4.3 (its fixes were built as an unpublished 1.4.4) and the follow-up recommendations. See `docs/audit-2026-11-26/report.md`.

### Fixed
- The weather sky now clears the header and the whole strip around the message box on claude.ai, not only the centre column. Anything painted in the page's own colour, in any colour syntax (`rgb`, `oklch`, `color()`, `hsl`), counts as page backdrop. Rounded inputs, cards, menus and dialogs keep their own paint. A visible-first pass clears the composer within seconds even on a 4,000-message chat.
- The bar and its panel follow the page's own light or dark theme, not the operating system's (a dark bar on a light page is gone). New `src/core/page-tone.js`.
- A message is counted once on sites that wrap `fetch` after load (a re-entrancy guard in the page hook).
- Changing any setting no longer makes every AI tab re-download usage and the whole chat; the Claude chat is fetched only when the chat changes or after a send; one shared organisation lookup.
- The Settings page no longer writes stale values back over changes made elsewhere (for example a bar you just dragged).
- The Help page's debug log refreshes at most every 2 seconds and never while you type. Identical usage reports are no longer re-sent (a 5-minute heartbeat keeps them fresh).
- After an extension reload an orphaned copy now also stops its sky and its banner watcher. Custom sites pick up an updated script list on install, update and start-up.
- The bar no longer snaps back for a moment after a drag; the meter mounts once even if it is switched off before the page loads; "1 msgs" reads "1 msg".
- A 429 only shows "Rate limited" when it comes from a provider's own send or usage endpoints, not from a feature-flag or telemetry call.
- Kimi: a missing sign-in cookie reads "Sign in to Kimi", not "Can't read usage".
- `parseReset` understands weekday names and "tomorrow" ("resets Monday 9 AM").
- The debug "shape" capture no longer treats every `*.co.uk` (or `*.com.au`, `*.co.jp`) site as the same site.
- The privacy links in Settings and the welcome page now point at the policy URL the store listing uses (the GitHub Pages address was never published).
- Welcome art draws the bar on the top edge, the default; step 4 says to pick a place (the weather is on by default).
- `minimum_chrome_version` 111.

### Removed
- Dead code left over from the toolbar popup and an unused event bus: `AM.splitMeters`, `AM.cardSource`, `AM.sortEntries`, `AM.isStale`, `AM.STALE_MS`, `AM.fmtTokens`, `AM.bus` and `AM.emit` (nothing listened to the `'send'` and `'limit'` events), together with their tests. Smaller scripts in every page.

### Added
- Settings → Weather → **Frosted strips** (off by default): the cleared header and composer strips blur what is behind them, so scrolling text stays hidden while the sky shows. A strip that holds a menu or dialog is left unfrosted.
- Clicking a limit alert focuses that service's open tab, or opens it.
- The sky's quality governor has hysteresis: after it steps the resolution down it will not step back up for 30 seconds, and stepping up needs frames averaging under 18 ms, so a borderline GPU no longer bounces between sizes.
- Chat length is counted incrementally with a MutationObserver instead of re-reading the whole chat every 4 seconds.
- `AM.every()` replaces the override of the global `setInterval`; shutting down an orphaned copy still stops every job.
- An end-to-end harness (`e2e/`): the unpacked extension in real Chromium against a mocked claude.ai, with CI (`.github/workflows/ci.yml`).

## 1.4.3 — 2026-11-25

### Changed
- The bar now starts at the top of the page by default (it is called Headroom, after all). If you already picked an edge, or dragged the bar, nothing changes for you; anyone can still choose any edge in Settings → Meter or by dragging.

### Fixed
- "Use my location" now works: it no longer asks for an optional `geolocation` permission (Chrome refused it: "Only permissions specified in the manifest may be requested"), it uses Chrome's normal location prompt instead, so the extension declares one fewer permission. It also always says what it is doing: it shows a message straight away, reports a refused or unanswered Chrome permission request (it used to stay silent), and gives the actual reason when the location lookup fails.

## 1.4.2 — 2026-11-25

### Changed
- Reset times are shown as a clock time instead of a countdown: "resets at 5:23 PM", "tomorrow 9:00 AM", "Fri 9:00 AM", or a date when it is over a week away. Uses your computer's own time format and time zone.

## 1.4.1 — 2026-11-25

### Changed
- The welcome page is now a short visual walkthrough (five picture cards: the bar, click for details, drag to any edge, the live sky, what real / estimate / banner mean) instead of paragraphs of text.
- The toolbar popup is removed. The toolbar icon still shows the usage percentage as a badge, and clicking it opens Settings; everything else lives on the page bar and its details panel.

### Added
- The on-page details panel has a close (✕) button in its header, next to Escape and clicking the bar.

## 1.4.0 — 2026-11-25

### Changed
- The sky is redesigned: a colour-rich sky dome with real dusk and dawn gradients, a Milky Way with layered stars, a phased moon with a halo, sculpted clouds lit from the sun's side, high cirrus, a heavier overcast deck, layered rain, snow and fog, lightning, diamond dust in winter, and petals and leaves by season. A calm reading area in the middle of the window keeps text readable. Colours are decided by a new `sky-palette.js` from the real hour, sunrise and sunset, weather and season; the shader only draws.
- Clouds now drift about five times faster (always a gentle drift, more in real wind) and their edges slowly change shape, so the sky is alive rather than a still picture. Cirrus and the overcast deck drift too.
- The sky is drawn at up to 1.5x pixel density, and steps its resolution down by itself on a slow graphics card.

### Fixed
- Pale strips behind composers are cleared only when they are fixed or sticky strips stuck to the top or bottom edge with square corners (and never inside dialogs, menus or tooltips); wide in-flow content that merely scrolls past the edge is left alone.
- Hidden tabs wait until shown before creating the sky.
- Text over the sky stays readable by gently veiling only the middle reading column of the sky (the edges keep their full colour); on light pages a dark sky (storm, overcast, deep blue) is also eased toward white across the whole window, so grey sidebar and header text stays readable.
- Resizing the window no longer flashes a black frame, and detached page parts no longer stay transparent.
- Theme detection updates when the site changes theme.
- When the graphics context is lost, the page is restored and the sky is retried up to 3 times, 5 seconds apart.
- A settings change at noon no longer flips the page dark.
- Resizing and state changes with reduced motion on now redraw at once.
- Picture images are no longer inverted three times at night.
- Scan work is spread out and no longer stops after 6000 elements.
- Polar day and polar night no longer break the sky.
- Tropical clear days no longer show rain unless a season is forced in Settings (picking only a weather or an hour does not trigger it).
- The bar drag is captured, so it works over frames and with touch.
- Escape closes the panel from anywhere in it.
- Lightning is a single, softer flash.
- The day-time sky is dimmed and veiled so text stays readable.

### Removed
- Unused weather target code.

## 1.3.0 — 2026-11-24

### Fixed
- Night on a light page is now the real night sky with the whole page flipped to a dark look (invert plus hue-rotate; photos, video and canvases are flipped back). It is skipped on pages that scroll as a whole, where a body filter would move fixed parts; those keep the soft dusk.
- The sky is drawn at the screen's real pixels (capped near 3.4 million) instead of at most 1440 px wide, so stars, moon and rain stay crisp on big and high-DPI screens.
- A dark-theme page whose background is painted on an inner element (ChatGPT dark) was read as light and got the washed-out sky; the page's theme and text colour are now checked too.

### Added
- A settings gear at the bottom-left of the details panel opens Headroom Settings.
- Drag the bar to any screen edge (top, bottom, left or right). It snaps to the nearest edge as you drag and remembers the choice. Left and right give a vertical bar that fills upward, with the panel beside it. Settings has the same four choices.

## 1.2.8 — 2026-11-24

### Fixed
- With the bar on top, the details panel now opens downward from it (it opened upward and ran off the screen). The panel scrolls if the window is short.
- The usage bar is now attached to the page root instead of `<body>`, so a site that shifts or transforms its body (seen on ChatGPT, where the top bar sat below the screen edge) can no longer offset it.

## 1.2.7 — 2026-11-23

### Changed
- Store listing: the Chrome Web Store rejected 1.2.6 for keyword stuffing (lists of product and company names). The summary and description no longer list brand names; the description is plain prose, and the trademark line is short. Extension code is unchanged.

## 1.2.6 — 2026-11-23

### Changed
- **New logo**: a crescent moon over a usage bar on deep plum, no blue. Drawn as a vector and rendered at each toolbar size, so the 16 px icon is crisp. Options and the generator are in `docs/logo-options/` and `tools/logo-options/`.

## 1.2.5 — 2026-11-23

### Fixed
- White page, no sky, on sites that paint their colour on the body (Gemini and others): the body itself was skipped by the 1.2.4 scan, so it covered the sky. It is now checked too. Verified on real Gemini.

## 1.2.4 — 2026-11-23

### Fixed
- ChatGPT still showed white bars: the header, sidebar and bottom strip are layers that clicks pass through, which the 1.2.3 lookup could not see. The whole page is now scanned for full-width, full-height and screen-sized backgrounds, fades drawn by ::before and ::after included, and one stylesheet (removed when the weather is off) clears them. Nothing is edited inline any more.

## 1.2.3 — 2026-11-23

### Fixed
- On ChatGPT and similar sites the header, sidebar and composer strip kept opaque or gradient backgrounds and showed as white bars over the sky. Full-width and full-height bars (and their fade gradients) are now cleared too, and restored when the weather is turned off.

### Changed
- Crisper sky: drawn at up to 1440 px wide instead of 960, shown at full strength by default (was 80%), and the dark-page dimming is lighter.

## 1.2.2 — 2026-11-23

### Changed
- **New logo**: a sky with a cloud and sun and the usage bar (concept 8 of the redesign sheet, wordmark removed so it reads at 16 px).
- **The sky now sits behind the page**, not on top of it. While the weather is on, the page's own full-screen backgrounds are made transparent (and put back when it is off), so photos, text and panels are never tinted or covered. In the dark it is dimmed for readability.
- Clicking the page no longer does anything to the sky (the 1.2.1 click ripple and gust are gone).

## 1.2.1 — 2026-11-23

### Fixed
- The weather sky was invisible on light pages (soft-light does nothing on white). Light pages now use a multiply tint that eases down at night; dark pages keep soft-light.
- Clicking the page now does something you can see: a soft ring pushes the clouds, rain, snow and leaves aside, and the wind carries them smoothly instead of making them jump.

### Changed
- Settings: full-height left sidebar (brand, search, pages, guide link, save status) and each setting has its control on the right.

## 1.2.0 — 2026-11-23

Headroom becomes a usage bar plus a live weather sky. Iris, the pill and the animated themes are gone.

### Added
- **Live weather behind the chat.** Settings → Weather: choose your place with **Use my location** (Chrome asks once) or by typing a city. Every AI site then gets a luminous sky that follows the real weather and the real hour: a gradient that follows the real sun and moon (from the real sunrise and sunset), stars at night, soft volumetric clouds lit from the sun's side and moved by the real wind, fine rain, snow, fog banks, lightning that flashes inside the clouds, falling leaves in autumn and petals in spring. India has a monsoon, not four temperate seasons. One WebGL shader, no images, no downloads; blended into the page with soft-light so the page keeps its own contrast; never blocks the page or your clicks (pointer-events: none); about 30 frames a second at low resolution; pauses in a hidden tab; still for reduced motion; injected only when the weather is on.
- The background script asks Open-Meteo (free, no key, no account) for the forecast every 20 minutes and keeps it in storage, so tabs never fetch anything. Only the place's coordinates, rounded to two decimals (about 1 km), are sent. The place stays on your computer and is never part of a settings backup.
- **Sky strength** slider, **Units** (°C or °F), and **Try a look**: show any weather, season or hour on your pages for testing, then **Back to live**.
- **Turn off weather** (and **Turn on weather**) button in the details panel on the page.
- New optional `geolocation` permission, asked only when you press **Use my location**.

### Changed
- **Settings redesigned**: one page at a time with a left nav and search (Weather, Meter, Limits, Notifications, Other AI sites, Backup and data, Help and debug), cards of rows with the label on the left and the control on the right, and everything saves as you change it. No more long scroll and no Save button.
- **The meter is the bar only**, at the bottom of the page by default (or the top). Point at it for the percentage and the reset time, click it or press Enter for the details. The chat length, cache timer and next-message cost are in the details panel. An old "pill" setting falls back to the bar at the bottom.
- The extension no longer exposes any web-accessible resources.

### Removed
- **Iris** (the cat), her sprites and engine, the page "trips", and the draggable pill.
- The earlier animated themes (koi pond, butterfly garden, firefly night, snowfall) and the living-background engine.

### Tests
- Weather data (codes, seasons, forecast parsing and clamping, sky state, targets), the background fetch (success, failure, off, alarm), the on-demand sky loader, the weather settings, the panel's weather button, and settings backups that never carry the place.

## 1.1.0 — 2026-11-19

### Added
- **Living background (Settings → Background).** Koi pond, Butterfly garden, Firefly night or Snowfall. The whole scene (water with real ripples that bend and glint when you click, a golden meadow, a twilight sky) is blended into the AI page, so it reads as sitting behind the text: multiply on light pages, screen on dark ones, switching on its own when the page's colours change. Koi are shaded with scales and soft-edged markings, butterflies are monarch, morpho, swallowtail and lilac and visit flowers, fireflies pulse and scatter on click. "Look" can be set to *Creatures only* instead. Off by default.
- **Snowfall theme.** Soft flakes at three depths with tumbling crystals, a drift that builds along the bottom of the window, and the same "drop to the first edge below" physics as Iris: snow settles as soft mounds on real surfaces (message bubbles, the message box, cards), and scrolling shakes it loose so it slides off and falls to the next ledge or the ground. A click is a gust of wind that knocks nearby snow off.
- **Stays off the text.** Creatures keep clear of the text on the page. The page is read line by line from the text itself, so it works whatever tags a site uses, and invisible and screen-reader-only text is ignored; inputs, buttons and embedded frames are avoided too. They only gather in clear space (the koi come to look at a click only where there is no text).
- **One-click on/off in the panel.** The Headroom panel has *Remove koi / butterflies / fireflies* (and *Bring back …*), so the background can go without a trip to Settings.
- It never blocks the page or your clicks (pointer-events: none), pauses when the tab is hidden, stays still if your system asks for reduced motion, falls back to creatures only without WebGL, and its code is loaded into a tab only when a theme is switched on. Nothing is downloaded or sent anywhere.
- The background setting is part of Export / Import settings.

### Tests
- Panel button (remove and bring back), Look setting, and settings validation for the new theme, the on-demand loader (refuses a missing tab or unknown theme), and a check that every theme file exists and is not part of the always-loaded bundle.

## 1.0.0 — 2026-10-31

First store-ready release.

### Changed
- **Meter redesign.** The pill, panel and bar follow a new design: every usage level has its own shape as well as its colour (filled dot, half dot, triangle, square, dashed ring), so it reads in greyscale and for colour-blind users; deeper status colours that pass WCAG contrast; three source-tag shapes (solid with a tick for real, dashed with "≈" for estimate, flagged for banner); small gaps at 75% and 90% on every bar and striped fill from 90%; the reset time only shows from "close" up; the cache timer uses the accent colour with a clock; a hairline and soft shadow so the pill separates on dark and busy pages. The bar style shows a label chip in the middle on hover or focus and grows from 6 to 10 px. The toolbar popup, the settings page and the first-run guide use the same tokens, level glyphs and source-tag shapes, so every surface matches.
- **Renamed from AI Meter to Headroom.** New name in the extension, popup, settings, first-run guide, notifications, privacy policy, store listing and README. Internal identifiers were renamed too; old settings exports and the saved pill position still load.
- **New Iris art.** Redrawn sprite pack: clearer worried and stressed faces, a soft lavender edge so she stands out on white pages, and a smooth 12-frame walk cycle. Fur colour and size are matched across every pose.
- Popup is one collapsible line per service (0.9.2) with a lavender look and dark mode (0.9.1).

### Added
- **Bar style (experimental).** Settings → Meter style can show a thin full-width bar along the top or bottom of the page instead of the pill. It fills to your usage, shows the details when you point at it or focus it, and opens the same panel on click. No Iris in this style.
- **First-run guide.** A short page opens once on install: what Headroom reads, how to add a site, and what the real / estimate / banner tags mean. It is also linked from Settings.
- **Export and import settings.** Save your limits, thresholds and Iris options to a file and load them back. A backup holds settings only. Sites you added need Chrome's permission again, so you add them again after importing.
- `npm run store-zip` builds the Web Store zip and refuses to if something is wrong.

### Accessibility
- The pill is now a real button: focusable, named (it reads out the percentage and reset time), opens with Enter or Space, closes with Escape, and moves with Shift and the arrow keys. The panel is a labelled region and each bar is a progress bar.
- Text contrast raised to WCAG AA in light mode (links, amber text, REAL / EST tags, stale cards, cache timer). Focus rings everywhere. Animations stop under reduced-motion.
- Popup keeps keyboard focus across refreshes. Settings: every field is labelled, messages are announced, and the Iris options are disabled while she is at home. Review: `docs/a11y-review-2026-10-31.md`.

### Security
- Sign-in, password, OAuth, MFA, checkout and payment requests are never read by the page hook, and secret-looking fields (password, token, key, card number) are masked in any body it does forward. This matters on sites you add yourself.
- The debug log and "Copy debug log" mask emails, bearer tokens, JWTs, ids and long opaque strings.
- The service worker validates every usage report; stored settings (added sites, thresholds) and the pill position are sanitised on load.
- One broken site adapter can no longer stop the pill or the others: a failure now shows as "can't read usage here". Review: `docs/security-review-2026-10-31.md`.

### Fixed
- Two tabs reporting usage at the same moment could each fire the same threshold notification; usage and reset handling now run one at a time.
- A reset notification was lost or garbled when a provider name or limit label contained a `|`.

### Tests
- New suites for the service worker (thresholds, reset, restart), the on-page widget (ok, estimate, can't-read, sign-in, chat stats, drag, Iris mood), content script host and adapter selection (including user-added sites) and Iris's state machine (alarm trips, falls and recovery, reduced motion, hidden tab, pick-up).

## 0.9.2 — 2026-10-28

### Changed
- **Popup is one line per service.** Each shows its status LED, name, and the limit closest to full with a mini bar; click to expand the full bars, counters and reset times. Cards you opened stay open across refreshes.

## 0.9.1 — 2026-10-28

### Changed
- **Popup redesign.** Pearl-lavender look to match the pill, with dark mode. Cards show a status LED, one source badge per card (real or est) instead of one per row, and sort fresh first, then closest to its limit. Percentage limits are compact bars; counter-only limits (e.g. "5 left") are chips, with extras folded behind "Show all N limits". Providers not updated for a day are dimmed and marked stale. Icon buttons, summary line, "+ Add site" link and a friendlier empty state.
- A reset time that has already passed now reads "reset due" / "frees up now" instead of "resets in now".
- Added `tools/popup-preview` (the real popup with a stubbed `chrome.*` and sample data) for looking at the popup in any browser.

## 0.9.0 — 2026-10-28

Pre-ship pass for the Chrome Web Store.

### Added
- **"Can't read usage here" and "Sign in to see limits" states.** When a provider's usage call fails or the parser finds nothing, the pill, panel and popup now say so (an error after 15 s so a slow page doesn't flash a warning, a definite sign-out at once) instead of a silent "—" or a wrong number. The panel and popup have a one-click **Copy debug log** button (provider, problem, meters and that provider's stored debug entries; never message text).
- Store paperwork: `docs/store/listing.md` (name, descriptions, single-purpose statement, justification for every permission and host, data-usage answers, screenshot shot list) and `docs/privacy.md` (standalone privacy policy).
- Trademark / non-affiliation disclaimer in the listing, README and privacy policy.
- Tests for the problem state, each adapter's failure path, Perplexity signed in and out, the page-world channel and the manifest.

### Changed
- **Perplexity signed out** now shows "Sign in to see limits" instead of "0 left" (it checks `/api/auth/session` first).
- **Page-world hook to content script channel** is now a private `MessageChannel` handed over in a `hello` that the page-world script swallows in the capture phase, instead of `window.postMessage`, which every script on the page can read and forge. Every message is schema-validated.
- Bodies of sign-in, session, token, account and profile requests are no longer forwarded to the extension at all (responses already were not).
- `web_accessible_resources` narrowed from `https://*/*` to the provider hosts.
- Iris's engine and sprites (`pet.js`, `iris-frames.js`, `walk8-frames.js`) load only when Iris is switched on, via `chrome.scripting`, instead of on every provider tab (about 47 KB less script per tab with Iris off). Sites you add yourself get the meter without Iris, since the sprites are no longer web-accessible to them.
- Debug log keeps adapter notes in their own slots so a chatty site can't push them out.

## 0.8.2 — 2026-10-27
- **Fixed Copilot:** `copilot.microsoft.com` now redirects to `copilot.com`, which the extension did not match, so it never ran there. Both addresses are supported.
- ChatGPT's header perch selector updated for its redesign.
- Added `tools/site-smoke` (inject the real scripts into a live page to smoke-test each site) and `docs/site-smoke-2026-10-27.md`.

## 0.8.1 — 2026-10-17
- **Fixed Grok:** real chat limits now come from `POST /rest/rate-limits` (remaining queries per model over a 24 h window, verified live). The Grok Build credit pool is shown only when it reports usage, so it no longer shows a made-up 0%.

## 0.8.0 — 2026-09-30
- Iris rests at the right end of the pill, clear of the chat box's send button, and returns there after every action.
- Pick Iris up by dragging her; drop her on the page and she runs back and jumps onto the pill.

## 0.7.0 — 2026-09-28
- Calmer Iris by default (energy setting), yarn-ball play, and a "Send Iris home" button in the panel.

## 0.6.0 — 2026-09-28
- Smooth single-clock animation engine and an 8-frame walk for Iris.

## 0.5.0 — 2026-09-28
- Iris trips onto the page: watches replies, greets new messages, reacts to limit alarms, falls when her perch moves.

## 0.4.0 — 2026-09-28
- Sprite-based Iris and a glossy capsule pill with a glowing LED.

## 0.3.0 — 2026-09-28
- Chat stats (length, cache timer, next-message cost) for Claude, ChatGPT and Gemini, and the first Iris.

## 0.2.0 — 2026-09-26
- Real usage for Gemini, Grok, ChatGPT Codex and Kimi; 12 sites; add any site in Settings; debug mode as endpoint discovery.

## 0.1.0 — 2026-09-26
- Initial AI Meter: usage-limit meters for 5 AI chat sites.
