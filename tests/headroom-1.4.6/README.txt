Headroom 1.4.6 regression tests (browser tests use Playwright with Chromium; Python 3 + Pillow for the pixel tests)

Pass the folder that contains the extension's manifest.json:

  node --test unit.test.mjs                    (set EXT=<extension folder>)  16 unit tests
  sh run-all.sh <extension folder>             unit tests + 5 browser scenarios (e2e.mjs)
  python3 plates.py <extension folder>         13 ways a plate/frame can be painted around the message box,
                                               measured at rest, 0.2 s and 2.2 s after scrolling, and for flicker
  python3 ink_behaviour.py <extension folder>  text colour on hover, streaming, pseudo-element cards, theme switch
  python3 sky_lab.py <extension folder>        70 states (7 weathers x 5 times x light/dark page): worst text
                                               contrast on the sky and sky colourfulness (add --quick for 24)

results/ holds the runs behind the 1.4.6 release: lab145 vs lab146 (sky lab), plates145 vs plates146, ink146.
headroom-1.4.5-to-1.4.6.patch is the exact source diff.

--- Notes from the repository (added when the tests were imported, 27 Nov 2026) ---
These files are kept exactly as delivered. Python is blocked on the owner's machine, so the repository runs Node ports of two
of the Python suites as part of its own end-to-end loop:
  plates.py         ->  e2e/plates.mjs   (all 13 variants, same measurements and thresholds)
  ink_behaviour.py  ->  e2e/ink.mjs      (same ten checks)
  sky_lab.py        ->  not ported; run it with Python 3 + Pillow where available (results/lab14[56].json show the last run)
The delivered e2e.mjs, unit.test.mjs and run-all.sh are the audit harness the repository already has in e2e/ (e2e.mjs there also
has the stricter "weather off restores the page" checks from this delivery). Run everything with:  cd e2e && node run-all.mjs
