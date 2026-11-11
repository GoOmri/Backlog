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
- `sw.js` — service worker, app shell cache.
- `config.js` — worker URL + public Firebase config.
- `worker/worker.js` — Cloudflare Worker `backlog-api` (KV binding `KV`, daily cron). Auto-deploys on push via `.github/workflows/deploy-worker.yml`. The site deploys via GitHub Pages on push.
- `.github/workflows/probe.yml` — one-off live check of the worker (dispatch with `gh api`, then read the job logs).

## Tabs (app.js)
- **Play** `homeHTML()` — owned games only. Carousel = pinned owned games (`upNextGames`), then rows: MV's you own, 2D platformers, Couch co-op platformers, Puzzle-platformers, 3D games for you, Leaving PS Plus.
- **Find** `discoverHTML()` → `findPins()` (carousel of pinned wishlist games), then `findExtrasHTML()` (On sale from your wishlist with a See all link, then rows from `/finds`: Metroidvanias you haven't played (top rated + not owned), 2D platformers, Hidden gems, Puzzle co-op, Couch co-op platformers, Narrative, Mystery, Cozy, Zelda-likes, You missed these, Classics), then `radarHTML()` (Coming soon on PS5 / Steam), then "Because you liked…".
- **Library** `shelfHTML()` with sidebar filters. **Diary**. **Wishlist** view = tab `wish`.
- Game page: `pageShell` + `editSheet(id)` (owned/wishlist) or `previewSheet(x)` (not in list: pin, heart, 👎). Ownership line: green Owned + platform chips / red Not owned.
- Background queue `runQueue`: match → backfill → checkDeck → checkSteamTags → covers → prices.

## Rendering
- `render()` rebuilds the tab's HTML string; on the same tab `patch(el, html)` applies only the differences (keys: data-key / data-edit / id). To update a small part, change the data and call `render()` (or `softRender()` for batched). `patch()` also works for any element, e.g. a sheet.

## Worker routes (worker.js)
/match /search /game /info /grids /logos /discover /steam /steamwish /prices (ITAD, PC only) /psplus /upcoming /deck /couch /topmv /finds /steamtags /steamrev /achievements /achrarity /trophies /rarity
- `/finds`: Steam tag searches (`SEARCHES`), quality bar (85%+ & 300+ reviews, or 92%+ & 40+ = gem), taste via Steam tags (`LIKE` / `DISLIKE`), mapped to IGDB via external_games, Steam prices (IL). KV cache key `findsN` (now finds11) — bump N when the output shape changes.
- KV is only for shared lists (finds, upcoming, psplus, topmv, trophies, tokens). No per-game KV caching (free tier = 1,000 writes/day); the client caches per-game data (localStorage gd5:/rev:, Firestore hero/logo). No hover prefetch.
- IGDB text `search` is broken; use name lookups (`name ~ "x"`).

## Taste (for ranking)
Loves: metroidvanias, 2D/puzzle/precision platformers (Hollow Knight, Ori, Celeste), hand-drawn or good pixel art, narrative, mystery, cozy, Zelda-likes. Heavy combat only if the game is great. Couch co-op with his wife: puzzle co-op and co-op platformers. Prefers games from 2008 on, but keeps a Classics row. Wants hidden gems kept.

## Done: optimization
1. ✅ DONE (softRender: snapshot redraws batched to one per 500ms, skipped while a page is open or app hidden). Fewer full redraws: Firestore onSnapshot calls render() on every change, and the background queue writes games one by one, so the whole tab (597 Library cards) redraws many times. Batch into one render per ~500ms; skip if the current tab isn't affected.
2. ✅ DONE (CHUNK=60, IntersectionObserver on #shelfMore; count kept across data redraws, reset on filter change). Library in chunks: render ~60 cards, add more on scroll.
3. ✅ DONE (`sw.js`: app files network-first with no-cache + 3s timeout → cache, so a push shows on next open; fonts/Firebase SDK cache-first; bump `V` to clear caches). Service worker: cache app shell (app.js, style.css, index.html, fonts) for instant open, update in background.
4. ✅ DONE (`heroSrc()` swaps to t_720p under 1000px, carousel + game page). Play carousel hero images: IGDB t_1080p → t_720p on phones.
Skip: style.css cleanup, bundling/minifying.

## Planned: curation rebuild (the algorithm is the project now)
Goal: open the app and quickly find a game to play now, especially couch co-op with his wife. Rows are views of ONE score.

What Omri dislikes is execution, not genre (2026-11-11):
- Padding/grind/level gates/paid time-skippers, yearly franchises (Assassin's Creed). But liked Fallout 4, Cyberpunk.
- Very long + cutscene-heavy (Expedition 33). Linear + text-heavy that breaks the action (Iconoclasts, even though MV).
- One mechanic stretched over a whole game (endless FPS) — but liked Doom 2016.
- Sports — but likes Rocket League. Strategy/CRPG rarely — but liked Frostpunk, Disco Elysium.
- Anime art/story is usually a no — but likes Persona 5. Judges by cover first: anime, cheap, basic, overdesigned human characters = no.
- Likes walking sims with puzzles; cinematic is fine.

A. Rows that show the wrong games (small, do first)
1. 2D platformers: "2D Platformer" in top ~5 Steam tags + IGDB side view. Drop Puzzle/Precision searches from this row.
2. Couch co-op platformers: "Platformer" must be a top tag.
3. Rule: rows only use a game's main tags (top ~5), never "anywhere in the list".

B. One taste score
4. DISLIKE list → "needs to be great": hack and slash, gore, roguelites, open world, FPS, sports, strategy, CRPG allowed if exceptional (lower bar than today's 94% & 10k).
5. Anime: strong penalty, beatable by exceptional.
6. Length: very long main story (IGDB time-to-beat) needs to be great.
7. Franchise fatigue: long-running series entries pushed down (IGDB franchises/collections).
8. Text-heavy: only "Visual Novel" / "Text-Based" penalised. Not "Cinematic", not walking sims.
9. Grind/monetisation: "Grinding", "Free to Play", "Massively Multiplayer" penalised.
10. Learn from his data: high-rated / finished / many Steam hours add weight to their main tags; dropped / low-rated subtract.
11. 👎 stays ONE tap, no reason picker. Silently lowers that game's main tags a bit.

C. Structure
12. ~4 rows instead of 11: For you, Hidden gems, Couch co-op, New & upcoming — all sorted by the score.
13. Short "why" on each card ("like Ori + Celeste").
14. Find includes PS5/PS4 games, not only Steam searches.

D. Other Find fixes
15. Wishlist sale row: only games added in the last year or pinned; 50%+ on the rest under See all.
16. PS Store link missing on PS4 games — likely matched to the PC IGDB entry. Need an example game.
17. Steam IL prices on every Find card (see Later).

Size: A, 15, 16 small. B + C = the real rebuild, medium–big, mostly worker `/finds` (bump findsN).

## Later
- Steam prices (IL) on every Find card and game page: new worker route /steamprice (appids → price_overview cc=il, KV cache 1 day).

## Open ideas
- PS Store prices (would need scraping; ITAD has none).
- Find caches /finds, /upcoming, /discover in localStorage (c:finds, c:upcoming, c:disc) and refreshes in the background.
- Couch co-op night, studio follow, monthly recap.
