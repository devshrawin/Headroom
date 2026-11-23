# Chrome Web Store listing: Headroom

Everything below is written to paste into the Chrome Web Store developer dashboard. Facts come from the code and the README; if the code changes, update this file with it.

## Store fields

| Field | Value |
|---|---|
| Name | Headroom: AI usage limit and weather |
| Category | Productivity |
| Language | English |
| Package version | 1.2.0 |
| Privacy policy URL | `https://devshrawin.github.io/Headroom/privacy` (publish `docs/privacy.md` with GitHub Pages: Settings → Pages → Deploy from branch → `main` / `/docs`) |
| Support URL | `https://github.com/devshrawin/Headroom/issues` |
| Homepage URL | `https://github.com/devshrawin/Headroom` |

## Short description (max 132 characters)

> See your AI usage limit as a thin bar, with the live weather as a sky behind the chat. Claude, ChatGPT, Gemini, Grok and more.

(about 125 characters. This is also the `description` in `manifest.json`.)

## Long description

> Headroom does two things on the AI chat sites you use: it shows how much of your usage limit is left, and it puts the real weather behind your chat.
>
> **Your limit, as a thin bar.** A slim bar runs along the bottom (or top) of the page and fills as you use your limit. Point at it for the percentage and when it resets, click it for the details. Shapes as well as colours show the level, so it reads without colour.
>
> **The real weather, behind your chat.** Choose where you are (use your location, or type a city) and the page gets a living sky that follows the real weather and the real hour: the sun, moon and stars, clouds that move with the real wind, rain, snow, fog, lightning, and falling leaves in autumn. It never blocks the page or your clicks, you can turn it off with one click, and you can lower its strength if text is hard to read.
>
> **Real numbers where the provider gives them**
> • Claude: session (5 hour) and weekly usage, with reset times
> • Gemini: 5 hour and weekly usage
> • Grok: your remaining chat queries per model
> • Perplexity: remaining Pro searches, research and labs
> • Kimi: your membership balance
> • ChatGPT: Codex usage windows, plus a message count for chat
>
> **Counted for the rest**
> DeepSeek, Qwen, Le Chat, Copilot, Meta AI and Poe do not show usage, so Headroom counts your sends against limits you set yourself.
>
> **Any other AI site**
> Add any site in Settings. Headroom asks for permission for that one site only.
>
> **Also included**
> • Live weather sky behind the chat (sun, moon, clouds, rain, snow, fog, lightning, falling leaves), one click to turn off
> • Toolbar badge with the current percentage
> • A popup with every provider in one place
> • Optional desktop notifications at 75, 90 and 100 percent, and when a limit resets
> • Chat length and a rough cost for your next message on Claude, ChatGPT and Gemini
> • A visible message when a provider's usage cannot be read, with a one-click copy of the debug details
> • A short first-run guide that explains the real / estimate / banner tags
> • Export and import your settings, so custom limits are never lost
> • Works from the keyboard: Tab to the meter, Enter to open it
>
> **Private by design**
> Everything stays on your machine. There is no server of ours, no account and no analytics. Usage requests go from your own logged-in tab to the provider's own site, exactly as its settings page would send them. Message text is never stored. The one other request is for the weather, only if you turn it on: the rounded coordinates of the place you choose (about 1 km) go to the free Open-Meteo weather service to ask for the forecast. See the privacy policy for the details.
>
> Headroom is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI, Google, xAI, Perplexity, Moonshot AI, DeepSeek, Alibaba, Mistral AI, Microsoft, Meta or Quora. Product and company names are trademarks of their respective owners and are used only to say which services Headroom works with.

## Single-purpose statement

> Headroom makes the AI chat websites you use more informative at a glance. It shows how much of your usage limit remains (a bar along the page edge, a toolbar badge and popup, and optional threshold notifications), and it shows the real weather for a place you choose as a background sky on those same sites.

## Permission justifications

Paste each into the matching box on the **Privacy practices** tab.

### `storage`
Saves your settings (estimate limits, notification thresholds, added sites, the weather options and the place you chose, rounded to about 1 km), the latest usage numbers for each provider, a short list of send timestamps used for message counting, and the opt-in debug log. All in `chrome.storage.local`. Nothing is synced or sent anywhere.

### `alarms`
Schedules a single alarm for the moment a limit resets, so Headroom can tell you "your limit has reset" and clear the old warning state. No polling, no background work beyond that.

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

### Remote code
**No.** All code ships in the package, including the weather sky (one shader, no images). Nothing is downloaded and executed.

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

## Screenshots

Chrome Web Store wants 1 to 5 screenshots at **1280 x 800** (or 640 x 400), plus an optional small promo tile (**440 x 280**) and marquee (**1400 x 560**).

Suggested set, all showing a neutral mock chat page with sample numbers so no account name, chat title or brand logo appears:

| # | What it shows | Caption |
|---|---|---|
| 1 | Clear day: sun, soft clouds, the usage bar along the bottom | Your AI limit, with the real weather behind it |
| 2 | Rain on a grey sky, the bar at 80% in amber | Rain outside, 80% used inside |
| 3 | Sunset and a night with stars (two halves) | The real hour, the real sun and moon |
| 4 | Settings → Weather: place, "Right now", sky strength, "Try a look" | Use your location or type a city |
| 5 | The details panel open, with "Turn off weather" | One click and the sky is gone |

The weather preview (`node tools/weather-preview/serve.mjs`, then http://localhost:8802) renders the sky for any weather, season and hour; capture the first three from it, the settings one from the real Settings page. Promo tile and marquee: the logo (`icons/icon128.png`), the name and "Limits, in sight." on the sky.

## Trademark disclaimer (use verbatim in the listing, README and privacy policy)

> Headroom is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI, Google, xAI, Perplexity, Moonshot AI, DeepSeek, Alibaba, Mistral AI, Microsoft, Meta or Quora. Claude, ChatGPT, Gemini, Grok, Perplexity, Kimi, DeepSeek, Qwen, Le Chat, Copilot, Meta AI and Poe, and all related names and logos, are trademarks of their respective owners. They are used here only to identify the services Headroom works with.

## Before you submit

- [ ] `manifest.json` and `package.json` both say 1.0.0
- [ ] Zip built with `npm run store-zip` (it refuses to build if versions disagree, a file is missing or something that should not ship is included)
- [ ] Privacy policy URL is live and loads without sign-in
- [ ] Single-purpose statement and every permission justification pasted
- [ ] Screenshots made as described under Screenshots (no personal data in any of them, no brand logos)
- [ ] Full steps and the list of things only you can do: `docs/store/submit-checklist.md`
- [ ] Reviewed the "Data usage" answers against the current dashboard wording
