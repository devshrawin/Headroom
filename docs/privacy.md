---
title: Headroom privacy policy
permalink: /privacy
---

# Headroom privacy policy

Effective 23 November 2026 · Applies to Headroom 1.2.0 and later (earlier versions: see the version history)

**In one paragraph:** Headroom runs entirely in your browser. It has no server, no account and no analytics, and it sends nothing to its developer or to any third party. It reads your usage from the AI sites you already use, from your own logged-in tab, and keeps the numbers on your machine. It never stores the text of your messages.

## What Headroom is

Headroom is a Chrome extension that shows how much of your usage limit is left on AI chat sites (Claude, ChatGPT, Gemini, Grok, Perplexity, Kimi, DeepSeek, Qwen, Le Chat, Copilot, Meta AI, Poe, and any site you add yourself). It draws a small meter on the page, a toolbar badge, and can show desktop notifications.

## What it reads, and why

| What | Where it comes from | What Headroom keeps | Leaves your device? |
|---|---|---|---|
| **Usage and limit figures** (percent used, remaining queries, reset times) | The provider's own usage endpoint, called from your tab; or the same response the site itself already receives | The latest numbers per provider, in `chrome.storage.local` | No |
| **That a message was sent, and which model** | The page's own network request (the request is observed, not changed) | A timestamp and the model name, to count messages. Never the text | No |
| **Chat length** (for the "This chat" figures) | The number of characters in the open conversation on the page | A character and message count only. Never the text | No |
| **Your settings** | You | Estimate limits, thresholds, added sites, the meter position, the weather options (on or off, units, strength), in `chrome.storage.local` | No |
| **A settings backup** (only if you ask for one) | You, with **Export settings** in Settings | A file the browser saves where you choose, holding your settings only: estimate limits, thresholds, meter and weather options and the addresses of sites you added. **Never the place you chose for the weather**, usage numbers, message counts or the debug log. Importing reads a file you pick, on your machine | No. Nothing is uploaded; the file stays wherever you put it |
| **The place for the weather** (only if you turn the weather on) | You, with **Use my location** (Chrome asks you once) or by typing a city in Settings → Weather | A place name and its coordinates **rounded to two decimals** (about 1 km), in `chrome.storage.local`. If you use your location, the exact position is read once and rounded straight away; it is not kept | **Yes, only the rounded coordinates, to the free Open-Meteo weather service (`api.open-meteo.com`), to ask for the forecast.** A city search sends the text you typed to `geocoding-api.open-meteo.com` |
| **The weather forecast** | Open-Meteo, asked by the background script every 20 minutes | The latest forecast (temperature, weather code, cloud cover, wind, sunrise and sunset) in `chrome.storage.local`; every tab reads it from there | The request leaves; the answer stays |
| **Debug log** (off by default) | The extension itself, only if you tick Debug | Key names and short model-like values of requests, full bodies only of usage and limit endpoints, and only the *shape* (keys and types) of anything else. Emails, tokens and long ids in it are masked. Stored locally, capped to the latest entries; clear it any time in Settings | No, unless you choose to copy and paste it yourself |

## How the page-world script works

To spot message sends and usage responses, Headroom injects a small script into the page itself (a "page-world" script, because a normal extension script cannot see the page's own network calls). It wraps `fetch`, `XMLHttpRequest` and `WebSocket.send` and mirrors what it sees to the extension over a private channel inside the page.

Being plain about what that means:

- It **sees** each request the page makes, including the body of a message you send, because that is where the model name is.
- Request and response bodies are held **in memory only for as long as it takes to read the model name or the usage figures**. Message text is **never written to storage**, never logged by the debug log, and never sent anywhere.
- The bodies of requests to, and responses from, sign-in, sign-up, password, OAuth, one-time-code, checkout, payment, session, token, account and profile endpoints are **never forwarded** to the extension at all.
- On any body that is forwarded, the values of fields that look secret (password, token, secret, key, card number, and similar) are masked before the extension sees them. This matters most on a site you add yourself.
- It only does anything on the sites listed above and on sites you add.
- It does not change, block or delay any request.

## Sign-in credentials

Headroom does not collect your password or ask you to sign in to anything. Two providers need a credential to answer a usage call, and Headroom uses the one your browser already holds:

- **ChatGPT:** the access token from the site's own `/api/auth/session` response is kept **in memory only** and sent only back to `chatgpt.com`, as the site's own usage request would.
- **Kimi:** the sign-in cookie that the Kimi web app itself reads is kept **in memory only** and sent only back to `kimi.com`.
- **Claude:** the organisation id from the site's `lastActiveOrg` cookie is used to build the usage URL on `claude.ai`.

These values are never written to storage, never put in the debug log and never sent to any other domain.

## First run

When you first install Headroom it opens a short "how it works" page. That page is part of the extension and loads nothing from the internet apart from a link to this policy that you can click.

## Where requests go

Usage requests go from **your tab to the provider's own domain**, the same place the site's settings page would send them. The only other request Headroom makes is the weather one, and only if you turn the weather on: the background script sends the rounded coordinates of the place you chose to Open-Meteo, a free weather service run by a third party, and reads the forecast back. Open-Meteo receives those coordinates and, as with any web request, your IP address; see its own privacy policy at open-meteo.com. Headroom sends nothing to any server run by its developer, and contains no analytics, advertising or tracking code. Turn the weather off in Settings and the request stops.

## Permissions

Each permission, and why the extension asks for it, is listed in the Chrome Web Store listing and in the repository (`docs/store/listing.md`). In short: `storage` for settings and the latest numbers, `alarms` for the reset notification, `notifications` for the optional alerts, `scripting` to register scripts for sites you add and to load the weather sky only when the weather is on, the optional `geolocation` permission only if you press **Use my location**, and host access to the listed provider sites. Access to any other site is optional and asked for one site at a time, when you click **Add site**.

## Your control

- Turn off notifications, the weather, the chat figures or the whole on-page meter in Settings (the weather also has a **Turn off weather** button on the page), and choose or change the place any time.
- Remove a site you added in Settings, which also revokes its permission.
- Tick or untick **Debug**, and **Clear log**, in Settings.
- Uninstalling the extension deletes everything it stored. Revoking the location permission in Chrome stops "Use my location"; typing a city never needs it.

## Sharing, sale and children

Headroom does not sell, rent or share any data, because it does not collect any off your device. It is not directed at children.

## Changes

If this policy changes, the new version is published at this address with a new effective date, and the change is listed in `CHANGELOG.md` in the repository.

## Contact

Open an issue at <https://github.com/devshrawin/Headroom/issues>.

## Not affiliated

Headroom is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI, Google, xAI, Perplexity, Moonshot AI, DeepSeek, Alibaba, Mistral AI, Microsoft, Meta or Quora. Claude, ChatGPT, Gemini, Grok, Perplexity, Kimi, DeepSeek, Qwen, Le Chat, Copilot, Meta AI and Poe, and all related names and logos, are trademarks of their respective owners. They are used here only to identify the services Headroom works with.
