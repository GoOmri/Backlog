# Backlog — notes for Claude

Personal game curator for Omri (PS5, Steam + Steam Deck, Epic, itch.io). Live: https://goomri.github.io/Backlog/

## Rules
- Token-conscious: ask before big changes; make targeted edits (grep → sed/python replace), don't read whole files.
- At most one live check per change, and only when asked. Default: push and let Omri test on his phone.
- Never commit keys. Secrets live only in Cloudflare (worker) and GitHub secrets (deploy).
- Low text, artsy/indie look, dark theme, purple accent #A78BFA, white line icons (`ic(name)`).
- Spacing 4/8/16/24/32/48; type 32/20/15/13/11; radii 8/12/16.

## Files
- `app.js` — the whole client (ES module). Firebase auth + Firestore `users/{uid}/games/{id}`.
- `style.css` — base styles plus appended override blocks (append fixes at the end).
- `config.js` — worker URL + public Firebase config.
- `worker/worker.js` — Cloudflare Worker `backlog-api` (KV binding `KV`, daily cron). Auto-deploys on push via `.github/workflows/deploy-worker.yml`. The site deploys via GitHub Pages on push.
- `.github/workflows/probe.yml` — one-off live check of the worker (dispatch with `gh api`, then read the job logs).

## Tabs (app.js)
- **Play** `homeHTML()` — owned games only. Carousel = pinned owned games (`upNextGames`), then rows: MV's you own, 2D platformers, Couch co-op platformers, Puzzle-platformers, 3D games for you, Leaving PS Plus.
- **Find** `discoverHTML()` → `findPins()` (carousel of pinned wishlist games), then `findExtrasHTML()` (On sale from your wishlist with a See all link, then rows from `/finds`: Metroidvanias you haven't played (top rated + not owned), 2D platformers, Hidden gems, Puzzle co-op, Couch co-op platformers, Narrative, Mystery, Cozy, Zelda-likes, You missed these, Classics), then `radarHTML()` (Coming soon on PS5 / Steam), then "Because you liked…".
- **Library** `shelfHTML()` with sidebar filters. **Diary**. **Wishlist** view = tab `wish`.
- Game page: `pageShell` + `editSheet(id)` (owned/wishlist) or `previewSheet(x)` (not in list: pin, heart, 👎). Ownership line: green Owned + platform chips / red Not owned.
- Background queue `runQueue`: match → backfill → checkDeck → checkSteamTags → covers → prices.

## Worker routes (worker.js)
/match /search /game /info /grids /logos /discover /steam /steamwish /prices (ITAD, PC only) /psplus /upcoming /deck /couch /topmv /finds /steamtags /steamrev /achievements /achrarity /trophies /rarity
- `/finds`: Steam tag searches (`SEARCHES`), quality bar (85%+ & 300+ reviews, or 92%+ & 40+ = gem), taste via Steam tags (`LIKE` / `DISLIKE`), mapped to IGDB via external_games, Steam prices (IL). KV cache key `findsN` (now finds11) — bump N when the output shape changes.
- IGDB text `search` is broken; use name lookups (`name ~ "x"`).

## Taste (for ranking)
Loves: metroidvanias, 2D/puzzle/precision platformers (Hollow Knight, Ori, Celeste), hand-drawn or good pixel art, narrative, mystery, cozy, Zelda-likes. Heavy combat only if the game is great. Couch co-op with his wife: puzzle co-op and co-op platformers. Prefers games from 2008 on, but keeps a Classics row. Wants hidden gems kept.

## Open ideas
- PS Store prices (would need scraping; ITAD has none).
- Find caches /finds, /upcoming, /discover in localStorage (c:finds, c:upcoming, c:disc) and refreshes in the background.
- Couch co-op night, studio follow, monthly recap.
