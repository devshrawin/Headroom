# Chrome Web Store: what only you can do

Prepared in Stage 5 (2026-10-31). Everything that can be done from the repo is done; the items below need your account, your browser, or your judgement. Tick them in order.

## 0. Blockers: do these before you submit

- [ ] **Check that "Headroom" is free for you.** It was chosen as the name; availability has not been checked. Search the Chrome Web Store for an existing "Headroom" extension, your trademark office's database, and the domain and GitHub names you want. If the Web Store title is taken, the store title can stay "Headroom: AI usage limit and weather" only if it is not a copy of another listing.

- [ ] **Confirm the real-number claims you can't see in code.** The listing says Headroom reads real numbers for Perplexity and Kimi (and ChatGPT's Codex usage). Those three have only been checked signed out, not signed in (`README.md`, "Verified live" says no). Either (a) load the unpacked extension in your Chrome, sign in, and check the bar against each site's own usage page, or (b) delete those lines from the long description in `docs/store/listing.md` so the store text only claims what is verified. Claude, Gemini and Grok are verified.
- [ ] **Try the exact build.** `chrome://extensions` → Developer mode → Load unpacked → pick the `Headroom` project folder (or unzip `release/<date>/headroom-<version>.zip` and load that folder: it is what the store will get). Open a supported site: the bar appears along the bottom, point at it, click it, drag it to another edge (top, left, right) and check it stays there, and click the settings gear in the details panel. Open Settings → Weather, use your location or type a city, and check the sky appears on the site and **Turn off weather** in the details panel removes it. Remove the extension and load it again: the welcome page should open once.
- [ ] **Weather checks you must do yourself.** (a) Press **Use my location** and confirm Chrome shows its location prompt and the place is saved. (b) Read Open-Meteo's terms (open-meteo.com/en/terms): the free API is for non-commercial use; if you ever charge for Headroom, get a plan. (c) **Single purpose:** the listing's single-purpose statement now covers both the meter and the weather. The Chrome Web Store can reject an extension whose features look unrelated; if the reviewer pushes back, the safe route is to publish the weather sky as its own extension.
- [ ] **Try Export / Import** in Settings: export, change a limit, import the file, check the limit came back.

## 1. One-time setup

- [ ] A Chrome Web Store developer account: <https://chrome.google.com/webstore/devconsole> (one-time registration fee, paid by you, and two-step verification on the Google account).
- [ ] **Privacy policy URL, no GitHub Pages needed.** The repo is public, so GitHub already serves the policy as a readable page: `https://github.com/devshrawin/Headroom/blob/main/docs/privacy.md`. Merge the release branch into `main` first (until then that address shows the old policy), then open it in a private window: it must load without signing in. Keep the repo public, or the store link breaks. If you ever make the repo private, publish `docs/privacy.md` somewhere public instead (GitHub Pages, a gist, or your own site).
- [ ] Merge the release branches into `main` (open the PRs, review, merge). The store upload should come from a commit that is on `main`.

## 2. Upload

- [ ] Build the zip: `npm run store-zip` (writes `release/<date>/headroom-<version>.zip`, for 1.4.7 that is `release/2026-11-27/headroom-1.4.7.zip`; it refuses to build if something is wrong).
- [ ] Dev console → **New item** (or the existing item's **Package** tab) → upload `release/2026-11-27/headroom-1.4.7.zip`.

## 3. Store listing tab

- [ ] Fill the fields from `docs/store/listing.md`: name, short description, long description, category (Productivity), language, support URL, homepage URL.
- [ ] Upload the images from `docs/store/assets/`: the five screenshots, the small promo tile and optionally the marquee. Captions are in `docs/store/listing.md` → Images. They already have no personal data and no brand logos.
- [ ] Icon: the 128 px icon in the package is used automatically.

## 4. Privacy practices tab

- [ ] Paste the **single-purpose statement**.
- [ ] Paste each **permission justification** (`storage`, `alarms`, `notifications`, `scripting`, the host permissions, the optional host permission, remote code = No).
- [ ] Answer the **data usage** questions using the table in the listing, **checking them against the dashboard's current wording** (the questions change). Tick all three certifications.
- [ ] Privacy policy URL: `https://github.com/devshrawin/Headroom/blob/main/docs/privacy.md`.

## 5. Distribution and submit

- [ ] Visibility: Public (or Unlisted for a first trial). Regions: all, unless you want to limit them.
- [ ] **Submit for review.** Review can take from a day to a few weeks. Broad host permissions (18 named sites, plus an optional one) can lengthen the review: if the reviewer asks, the justification table in the listing answers it.
- [ ] After approval: choose manual or automatic publish, then check the live listing page once.

## 6. After publishing

- [ ] Tag the release in git (`v1.4.7`) and add the store link to the README. I will not tag or publish anything without you saying so.
- [ ] Keep the "Verified live" column in the README honest as you check the remaining providers.

## Known small things (not blockers)

- The store images are captures of the real extension running on a neutral mock page with sample numbers, not of a live signed-in chat (that would show your account). Rebuild them with `node tools/store-shots/shots.mjs`.
- Desktop notifications could not be screenshotted outside the browser, so there is no notification image.
