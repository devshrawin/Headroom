# Chrome Web Store listing: Headroom

Everything below is written to paste into the Chrome Web Store developer dashboard. Facts come from the code and the README; if the code changes, update this file with it.

## Store fields

| Field | Value |
|---|---|
| Name | Headroom: AI usage limit and weather |
| Category | Productivity |
| Language | English |
| Package version | 2.0.0 |
| Privacy policy URL | `https://github.com/devshrawin/Headroom/blob/main/docs/privacy.md` (no GitHub Pages needed: the repo is public, so GitHub shows `docs/privacy.md` as a page. It must be merged to `main` first, or it shows the old policy. Open it in a private window to check it loads without signing in) |
| Support URL | `https://github.com/devshrawin/Headroom/issues` |
| Homepage URL | `https://github.com/devshrawin/Headroom` |

## Short description (max 132 characters)

> See your AI usage limit as a thin bar on the chat sites you use, with the live weather as a sky behind the chat.

(about 110 characters. This is also the `description` in `manifest.json`. No product names on purpose: the Web Store rejects lists of brand names as keyword stuffing.)

## Long description

No lists of product or company names (the store rejected version 1.2.6 for that). Plain text, paste as is.

> Headroom does two things on the AI chat sites you use: it shows how much of your usage limit is left, and it puts the real weather behind your chat.
>
> Your limit, as a thin bar. A slim bar runs along the edge of the page and fills as you use your limit. Drag it to the top, bottom, left or right edge, wherever it bothers you least. Point at it for the percentage and when it resets, click it for the details. Shapes as well as colours show the level, so it reads without colour.
>
> The real weather, behind your chat. Choose where you are (use your location, or type a city) and the page gets a living sky that follows the real weather and the real hour: sun, moon and stars, moving clouds, rain, snow, fog, lightning and falling leaves in autumn. It never blocks the page or your clicks, you can turn it off with one click, and you can lower its strength if text is hard to read.
>
> Real numbers where the site provides them. Where a site shows your usage, Headroom reads those figures from your own logged-in tab. Where it does not, Headroom counts your messages against limits you set yourself.
>
> It works on the most popular AI chat sites, and you can add any other site in Settings. Headroom asks permission for that one site only.
>
> Also included
> • Toolbar badge with the current percentage
> • Optional desktop notifications at 75, 90 and 100 percent, and when a limit resets
> • Chat length and a rough cost for your next message, where the site allows it
> • A clear message when usage cannot be read, with a one-click copy of the debug details
> • A short first-run guide
> • Export and import of your settings, so custom limits are never lost
> • Keyboard support: Tab to the bar, Enter to open it
>
> Private by design
> Everything stays on your machine. There is no server of ours, no account and no analytics. Usage requests go from your own logged-in tab to the site's own servers, exactly as its settings page would send them. Message text is never stored. The one other request is for the weather, only if you turn it on: the rounded coordinates of the place you choose (about 1 km) go to the free Open-Meteo weather service to ask for the forecast. If you type a city name to choose the place, that name goes to the free Open-Meteo geocoding service to find it. See the privacy policy for the details.
>
> Headroom is an independent project and is not affiliated with, endorsed by or sponsored by any of the AI services it works with. All product names belong to their owners.

## Single-purpose statement

> Headroom makes the AI chat websites you use more informative at a glance. It shows how much of your usage limit remains (a bar along the page edge, a toolbar badge, and optional threshold notifications), and it shows the real weather for a place you choose as a background sky on those same sites (or, if you prefer, a dark fluid animation that follows your cursor).

## Permission justifications

Paste each into the matching box on the **Privacy practices** tab.

### `storage`
Saves your settings (estimate limits, notification thresholds, added sites, the weather options and the place you chose, rounded to about 1 km), the latest usage numbers for each provider, a short list of send timestamps used for message counting, and the opt-in debug log. All in `chrome.storage.local`. Nothing is synced or sent anywhere.

### `alarms`
Schedules timers for the moment a limit resets, so Headroom can tell you "your limit has reset" and clear the old warning state. When the weather is turned on, it also schedules a refresh of the forecast every 20 minutes. Nothing else runs in the background, and the forecast refresh stops when the weather is turned off.

### `notifications`
Shows the optional desktop notifications when a meter crosses 75, 90 or 100 percent, and when a limit resets. Turn off in Settings. Notifications contain only the provider name, the meter name and the percentage.

### `scripting`
Used for two things only: (1) registering the content scripts for sites you add yourself in Settings, on the permission you grant for that one site, and (2) loading the weather sky's code into a page only when the weather is switched on. No remote code is ever fetched or run.

### Host permissions (the provider sites)
Each host below gets the content script and the page-world hook so Headroom can read that provider's own usage data from your logged-in tab. The extension does not run on any other site unless you add it.

| Host | Why it is needed |
|---|---|
| `https://claude.ai/*` | Read `/api/organizations/{org}/usage` (session and weekly usage) and the open chat's length |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | Count sends; read Codex usage from `/backend-api/wham/usage`; chat length |
| `https://gemini.google.com/*` | Read the usage figures behind gemini.google.com/usage; count prompts; chat length |
| `https://grok.com/*` | Read `/rest/rate-limits` (remaining queries per model); detect sends |
| `https://www.perplexity.ai/*`, `https://perplexity.ai/*` | Read `/rest/rate-limit/all` (remaining Pro searches, research, labs) |
| `https://www.kimi.com/*`, `https://kimi.com/*` | Read the membership balance from Kimi's subscription call |
| `https://chat.deepseek.com/*` | Detect sends so they can be counted (the site shows no usage) |
| `https://chat.qwen.ai/*` | Detect sends so they can be counted |
| `https://chat.mistral.ai/*` | Detect sends so they can be counted |
| `https://copilot.microsoft.com/*`, `https://copilot.com/*`, `https://www.copilot.com/*` | Detect sends so they can be counted (Copilot moved from copilot.microsoft.com to copilot.com) |
| `https://www.meta.ai/*`, `https://meta.ai/*` | Detect sends so they can be counted |
| `https://poe.com/*` | Detect sends so they can be counted |

The `www.` and bare-domain entries are listed separately because Chrome match patterns do not cover both with one entry.

### Optional host permission `https://*/*`
Requested only when you click **Add site** in Settings for a specific site you want measured, and Chrome then asks for that one origin (for example `https://example-ai.com/*`). It is never granted up front and the extension does nothing on a site you have not added.

### Location (no permission in the manifest)
The **Use my location** button in Settings → Weather uses Chrome's normal location prompt, shown by Chrome itself. The position is read once, rounded to two decimals (about 1 km) straight away, and only the rounded value is kept. Typing a city never needs it, and the weather works without it.

### Remote code
**No.** All code ships in the package, including the weather sky (one shader, no images). Nothing is downloaded and executed.

### One-line justifications (paste-ready, for the Privacy practices tab)
Short versions of the sections above, for the single-line boxes. Every one is true of the 2.0.0 build.

| Permission | One line |
|---|---|
| `storage` | Saves your settings and the latest usage numbers on your computer so the bar can show them on every tab. |
| `alarms` | Times the "limit has reset" notice and, only while the weather is on, a forecast refresh every 20 minutes. |
| `notifications` | Optional desktop alerts when a limit crosses a threshold you set, or resets. Off with one switch in Settings. |
| `scripting` | Registers the content scripts for a site you add yourself, and loads the weather sky into a page only while the weather is on. All code ships in the package; nothing is downloaded. |
| Host permissions (the listed AI sites) | Lets the extension show your own usage on those sites by reading that site's own usage data from your logged-in tab. It does nothing on any other site. |
| Optional host permission `https://*/*` | Never granted up front. Asked for one site at a time, only when you click Add site for a site you want measured. |
| Remote code | No. Everything runs from the package. |

## Data usage answers (Privacy practices tab)

Suggested answers. Review them against the dashboard wording on the day you submit, because the questions change.

| Question | Answer |
|---|---|
| Personally identifiable information | No. Not collected |
| Health, financial, personal communications | No |
| Location | **Yes, approximate and optional.** Only if you turn the weather on: the place you choose (by typing a city, or by pressing **Use my location**, which Chrome asks you to allow). It is rounded to two decimals (about 1 km) straight away, kept on your device, and used only to ask the Open-Meteo weather service for the forecast. Never sold, never tied to who you are, not part of exported settings |
| Authentication information | Handled in memory only (the ChatGPT access token and the Kimi sign-in cookie), used only to call that same provider's usage endpoint, never stored and never sent to the developer or any third party. Disclose it if the dashboard asks about handling, not just collection |
| Website content | The extension reads the page only to measure chat length and to spot message sends. It keeps counts and timestamps, never message text. Sign-in, password, payment and similar requests are never read, and secret-looking fields are masked |
| Web history, user activity | No browsing history is read. It sees network calls made by the supported AI sites only |
| Sold to third parties / used for unrelated purposes / used for creditworthiness | No / No / No |
| Data leaves the device | Only if you turn the weather on: the rounded coordinates of your chosen place go to the free Open-Meteo weather service (`api.open-meteo.com`) to ask for the forecast, and a typed city name goes to its geocoding service. Nothing else leaves: usage requests go only to each provider's own site, from your own tab |

Tick all three **certifications** (limited use, no sale, no unrelated purpose).

## Images (ready to upload)

All made with the real extension (`node tools/store-shots/shots.mjs` rebuilds them) on a neutral mock chat page with sample numbers, so no account name, chat title or brand logo is on screen. They are in `docs/store/assets/`.

| File | Size | Caption to type in the dashboard |
|---|---|---|
| `1-clear-day.png` | 1280 x 800 | Your AI limit, with the real weather behind it |
| `2-rain-80-percent.png` | 1280 x 800 | Rain outside, 80% of your limit used inside |
| `3-sunset-details.png` | 1280 x 800 | Click the bar for the details, or turn the weather off in one click |
| `4-night-stars.png` | 1280 x 800 | The real hour: moon and stars after dark |
| `5-settings-weather.png` | 1280 x 800 | Use your location or type a city |
| `promo-tile-440x280.png` | 440 x 280 | Small promo tile (optional) |
| `marquee-1400x560.png` | 1400 x 560 | Marquee promo (optional) |

Upload 1 to 5 screenshots (the dashboard takes up to five) in that order, the small tile in "Small promo tile", the marquee in "Marquee promo tile". Re-run the script after any visual change so the images match the extension.

## Trademark note

The store description keeps only the short line at its end. The full list of company names stays out of it (it counted as keyword stuffing); the README and the privacy policy may keep their longer disclaimers.

## Before you submit

- [ ] `manifest.json` and `package.json` both say the version you are uploading (2.0.0)
- [ ] Zip built with `npm run store-zip`, upload `release/2026-11-27/headroom-2.0.0.zip`; tag the release `v2.0.0` (it refuses to build if versions disagree, a file is missing or something that should not ship is included)
- [ ] Privacy policy URL is live and loads without sign-in
- [ ] Single-purpose statement and every permission justification pasted
- [ ] Images uploaded from `docs/store/assets/` (5 screenshots, small tile, optional marquee)
- [ ] Full steps and the list of things only you can do: `docs/store/submit-checklist.md`
- [ ] Reviewed the "Data usage" answers against the current dashboard wording
