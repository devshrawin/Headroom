# Headroom 1.4.6: Settings and Welcome redesign

Drop-in files for these paths: `src/options/options.html`, `options.css`, `options.js`, `src/welcome/welcome.html`, `welcome.css`.
Plain HTML, CSS and vanilla JS. No inline script, no remote assets, no new permissions or requests. System font stack only.

## Design rationale

**Type scale:** 12 / 13 / 14 (body) / 16 / 20, plus page titles at `clamp()` 24–32 px (Settings) and 30–56 px (Welcome).
**Spacing:** a 4 px base (4, 8, 12, 16, 20, 24, 32, 48). Card padding is 20 px. Grid gaps are 16, 20 or 24 px and grow with the column count.
**Theme:** the custom-property tokens are kept, with light and dark through `prefers-color-scheme`. `--text-3` was darkened so hint text passes 4.5:1. All text measures 4.5:1 or more in both themes.

### Settings

- **Shell:** a sticky 248 px sidebar (272 px from 1900 px) beside a fluid content area. The content is capped at 1840 px, or 2240 px from 3000 px wide, and centred.
- **Grid:** cards sit in a grid driven by container queries on `<main>`:
  - 1 column below 1000 px of content
  - 2 columns from 1000 px (about a 1340 px window)
  - 3 columns from 1700 px of content (about a 2000 px window)
- **Rows:** each card is also a container. From 500 px of card width a row puts the setting and its explanation on the left and the control on the right. Below that they stack. Descriptions are capped at 60ch and notes at 75ch.
- **Sidebar:** sections in three groups (Look, Usage, Manage). Each section shows a live one-line summary, for example "Weather sky · Kochi", "Top edge", "12 rules" or "At 75%, 90%, 100%". Below the list sit a privacy note, the saved status and the First-run guide link. On short windows the list scrolls on its own and the privacy note hides.
- **Under 720 px:** the sidebar becomes a header with a sideways-scrolling row of section pills.
- **Weather (the showpiece):** a hero card holds the master switch and the Background picker. The picker is two preview cards with CSS-drawn thumbnails. The selected state is shown by a filled radio, the word "Selected" and the border, so it never relies on colour alone.
  - The sky-only cards (Your place, Right now + Units, Try a look) hide when Fluid is chosen, and a short note takes their place.
  - Look (Sky strength, Frosted strips) applies to both backgrounds.
  - "Right now" has a small sky tile that follows the condition and day or night.
- **Other pages:**
  - Meter has a mini window showing the bar on the chosen edge. It is pure CSS through `:has()`.
  - Notifications shows a sample notice.
  - Limits shows one card per service. These cards go to 2 columns only when each has about 700 px.
  - The search results are grouped by section into the same cards.

### Welcome

- **Bands:** full-width bands (header, five steps, "You are set") with content capped at 1600 px.
- **Header:** the intro on the left and a "Five things to know" overview card on the right that links to each step. They stack below 1000 px.
- **Steps:** under 860 px the picture sits above the text. From 860 px they sit side by side and swap sides on every other step. Each step has "Step n of 5" and a "Next" link.
- **Pictures:** the mock windows are drawn at 240×140 and scaled with `zoom` by the width of their stage (1×, 1.3×, 1.6×, 2× or 2.4×).
- **Step 4:** shows Weather sky and Fluid together, with the bar on the top edge. It says the background is optional and links to Settings › Weather › Background.
- **"You are set":** Open Settings, Privacy policy and a one-line privacy statement.
- **Motion:** everything sits inside `prefers-reduced-motion: no-preference`, including smooth scrolling.

### What changes at each width

| Width | Settings | Welcome |
|---|---|---|
| 360–720 | top header with pills, 1 column, rows stacked | stacked steps, header stacked, pictures at 1× to 1.3× |
| 768 | sidebar, 1 column, rows stacked in narrow cards | stacked steps, pictures at about 1.6× |
| 1280 | 1 column, rows side by side | alternating rows |
| 1440 | 2 columns | alternating rows, header in 2 columns |
| 1920 | 2 wide columns | the same, pictures up to 2.4× |
| 2560 | 3 columns, capped | capped at 1600 px, full-width bands |
| 3440 | 3 columns, cap rises to 2240 px | the same |

## Markup hooks

**Unchanged:** every `data-k`, `data-act`, `data-div`, `data-f`, `data-pick`, `data-provider`, `data-add-rule`, `data-del-rule`, `data-rm-site` and `data-result`; every id (`#nav #main #saved #ver #importFile #city #found #wmsg #strv #quotas #log #siteHost #siteLimit #siteWindow #smsg #f-w #f-s #f-t #nav-q`); the radiogroup and switch semantics and aria-labels; and hash routing.

**Changed or added:**

1. **New key:** `data-k="weatherBackground"` on two radios (`name="weatherBackground"`, values `sky` and `fluid`) inside `role="radiogroup" aria-label="Background"`. The key is the constant `BG_KEY` in options.js. 1.4.6 has no key for this, so if your build uses another name, change that one line. Anything other than `fluid` counts as the sky.
2. **New wrapper:** `.wx[data-bg]` on the Weather page. The `change` handler updates it in place, and CSS hides `[data-sky-only]` or `[data-fluid-only]` cards from it.
3. **`#quotas`:** now a grid `<div>`, not a card. Each `.prov` is a `<section class="card prov">` with an `h2` (was `h3`). `#quotas .prov`, `tr[data-id]` and `closest('.prov').querySelector('tbody')` all still match.
4. **Sidebar markup:** inside `#nav` the links now sit in `.nav-list > .nav-g` groups, with `.nav-l` (label) and `.nav-s` (summary) spans. The `.nav a[href^="#"]` click delegate still matches.
5. **Try a look:** `#f-w`, `#f-s` and `#f-t` are now wrapped in visible `<label class="fld">` elements. They had no label before.
6. **Card and page headings:** pages render an `h1.page-h` inside `header.page-head`. Card titles are `h2.card-t`.
7. **Renamed row titles:** the Debug log row is titled "Recording" (the switch label is still "Record the debug log"). The Notifications card is titled "Alerts".
8. **New in options.html:** a `.side-priv` privacy note and a `.side-row` footer. `main` gets `tabindex="-1"`.
9. **Welcome:** step `<section>`s get ids `step1`–`step5` and the final band is `#done`. The `h2` ids `s1`–`s5` stay.

## options.js changes

All are marked `[redesign]` in the file; full diff in `options.js.diff`.

- **New:** `BG_KEY`, `bgOf()`, `head()`, `card()`, `grid()`, `BGS`, `thumb()`, `bgPicker()`, `GROUPS`, `EDGE`, `navStatus()`, `navListHtml()`, `refreshNav()`, `navFocus()`, `refocusNav()` and `revealCurrent()`.
- **Rewritten markup only:** the page functions (`weatherPage`, `meterPage`, `alertsPage`, `limitsPage`, `sitesPage`, `dataPage`, `helpPage`), plus `navHtml()` and `resultsHtml()`.
- **Small additions:**
  - `save()` and `saveNow()` call `refreshNav()`.
  - The `change` handler updates `.wx[data-bg]`.
  - `storage.onChanged` refreshes only the sidebar while you are typing.
  - `render()` keeps keyboard focus on the sidebar link.
  - New `INDEX` search entries: Background and Frosted strips.
- What each setting does, the storage keys and the network calls are unchanged.

## Still needed outside these files

The content script must read `weatherBackground` and draw the Fluid. Add `weatherBackground` to `buildExport`/`parseImport` in common.js and to `mergeSettings` in quotas.js if it should be exported and cleaned. The Help disclaimer and the Meter "Chat details" line still name AI companies, as in 1.4.6. Nothing new was added, but you may want to trim them for the Web Store.
