# Backlog — notes for Claude

## Mission (read first)
A short list of the best games I want to play next, owned or not, so picking the next one is easy.
- Only the best gets in. Everything on the list is a real option I'd be happy to start tonight.
- Up next is about 10 games (pinned, owned or wishlist). Short enough to see at a glance.
- I play 2–3 games at a time, and one is always with Sima.
- Owning a game doesn't put it on the list. The Library is storage; I promote games from it.
- Finding new games feeds the list. It isn't the point of the app. Find shows a little, not a lot: a few rows of 10, the rest behind See all.
- What I love: fun 2D/3D platformers with puzzles or combat, and unique games. Couch co-op is a big plus.
- Minimal. Low text, few screens, nothing I don't use.
Not the goal: tracking every game I own, a recommendation engine, price tracking.

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
- No cron (wrangler `crons = []`). ITAD_KEY secret is unused and can be deleted in Cloudflare.

## Tabs (app.js)
- **Play** `homeHTML()` — Up next carousel (pinned owned + wishlist, `upNextGames`) + Show all sheet + Wishlist link, then `ROWS` (Metroidvanias, 2D platformers, 3D platformers, Couch co-op, Unique) via `playRow()`: your Owned/Wishlist games (not finished, dropped or pinned) mixed with `/finds` picks, sorted by `quality()`, top 10 + See all sheet (`rowCache`). Then `radarHTML()` (Coming soon PS5 / Steam, top 10). No Find tab (old `disc` tab id falls back to Play). Unique = Find picks only (owned games have no tags for it). A game shows in one row only (earlier rows win).
- Backfill: `/info` also returns `avail` and, for Steam app ids, Steam review % (`steamPct`/`steamN`, via GetItems include_reviews) — owned games then rank by Steam % like finds. Couch finder (`/couch`) removed.
- **Library** `shelfHTML()` with sidebar filters. **Stats** (`diaryHTML()`, tab id `diary`). **Wishlist** view = tab `wish`.
- Game page: `pageShell` + `editSheet(id)` (owned/wishlist) or `previewSheet(x)` (not in list: pin, heart, 👎). Ownership line: green Owned + platform chips / red Not owned.
- Background queue `runQueue`: match → backfill → checkDeck → checkSteamTags → covers.

## Rendering
- `render()` rebuilds the tab's HTML string; on the same tab `patch(el, html)` applies only the differences (keys: data-key / data-edit / id). To update a small part, change the data and call `render()` (or `softRender()` for batched). `patch()` also works for any element, e.g. a sheet.

## Worker routes (worker.js)
/match /search /game /info /grids /logos /steam /steamwish /upcoming /deck /couch /topmv /finds /steamtags /steamrev /achievements /achrarity /trophies /rarity
- `/finds`: Steam tag searches (`SEARCHES`), quality bar (85%+ & 300+ reviews, or 92%+ & 40+ = gem), taste via Steam tags (`LIKE` / `DISLIKE`), mapped to IGDB via external_games, Steam prices (IL). KV cache key `findsN` (now finds14) — bump N when the output shape changes.
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

## Sift (`openSift()`)
Swipe mode, opened from the Up next bar on Play. Deck: wishlist → owned not yet sifted → finds from the Play rows (`rowCache`). Right/Keep = `sifted: true` (a find goes to the wishlist). Left/Not now = `notNow: true` (off Play rows + carousel, still in Library; a find is hidden as `nope`). Up next = pin. Previous undoes any step this session (stack in `sift.done`); batches of 20; closing resets.

## Plan: simplify (2026-11-11)
Decided: one Play tab (Find merged in), mixed purely by quality, Library = storage, Stats tab. Statuses: Wishlist / Owned / Finished / Dropped (Playing removed; stored "playing" reads as Owned).
0. ✅ Mission in NOTES.
1. ✅ Chop: prices + ITAD (/prices, sale badges/row, price check), Leaving PS Plus (/psplus, cron, tags), "Because you liked…" (/discover), Playing status; Diary tab renamed Stats.
2. ✅ Up next = Play carousel of pinned games (owned + wishlist), "Show all" opens a sheet. No limit.
3. ✅ Worker /finds (finds13): only 2D platformers, 3D platformers, couch co-op, unique (gems + Experimental/Surreal/Artistic tags) + coming soon (still /upcoming). `quality()` = Steam % pulled to 80 + critics ±3, IGDB fallback. Hard no's in top tags: Sports, F2P, MMO, Visual Novel. `slim()` now has `avail` (ps5/ps4/pc/switch/xbox). Find shows the 4 rows, top 10 each (See all comes in step 4).
4. ✅ One Play tab: Up next carousel, then rows 2D platformers / 3D platformers / Couch co-op / Unique / Coming soon — top 10 + See all, owned + found mixed by quality. Rows defined as one list so splitting back into Play + Find is a small change.
   Quality: Steam % (pulled toward average when few reviews) + small critics bonus; IGDB rating as fallback for PS-only. Owned games: Steam % only if already stored, no new lookups. Genre for owned games: IGDB genre + perspective (no Steam tag backfill). Rows skip Finished/Dropped.
5. ✅ Platform badges (`availBadges()`, `.plat.avail`; PS5 hides PS4; found/new games carry `avail` from slim()): owned (filled) vs available (outlined), Steam Deck next to Steam.
Old "curation rebuild" (taste score with many penalties) dropped: rules kept breaking on exceptions; quality decides.

## Later
- Steam prices (IL) on every Find card and game page: new worker route /steamprice (appids → price_overview cc=il, KV cache 1 day).

## Open ideas
- PS Store prices (would need scraping; ITAD has none).
- Find caches /finds, /upcoming, /discover in localStorage (c:finds, c:upcoming, c:disc) and refreshes in the background.
- Couch co-op night, studio follow, monthly recap.
