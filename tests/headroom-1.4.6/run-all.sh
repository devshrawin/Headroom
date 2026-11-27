#!/bin/sh
# Full regression loop: unit tests, then every e2e scenario. Usage: sh run-all.sh ../ext
EXT=${1:-../ext}
EXT=$EXT node --test unit.test.mjs 2>&1 | grep -E "^# (pass|fail)|^not ok"
s() { name=$1; shift; printf '%s: ' "$name"; timeout 240 node e2e.mjs $EXT --json "$@" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); k=[x for x in d if x not in ('ext','console','scheme')]; print(json.dumps({x:d[x] for x in k if x not in ('bg',)} | {'bg_alpha':{a:b['alpha'] for a,b in d.get('bg',{}).items()}}))"; }
s light-page-dark-os --toggle --drag --options --fetchsem
s dark-page-light-os --scheme=light --bg='#1f1e1d'
s rgb-page --bg='rgb(250, 249, 245)' --scheme=light
s weather-off --settings='{"weatherPlace":null}'
s big-chat --msgs=4000 --perf --off
