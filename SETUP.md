# Backlog setup

Site: https://goomri.github.io/Backlog/ (Firebase sync is already set up.)

## Cloudflare Worker (game data service)
Your keys stay in Cloudflare as secrets. Never put them in this repo, because it is public.

1. dash.cloudflare.com → **Storage & Databases → KV → Create** → name it `backlog-kv`.
2. **Compute (Workers) → Create → Start with Hello World** → name it `backlog-api` → **Deploy**.
3. **Edit code** → delete everything → paste all of `worker/worker.js` → **Deploy**.
4. Worker **Settings → Bindings → Add → KV namespace**: variable name `KV`, namespace `backlog-kv` → **Deploy**.
5. Worker **Settings → Variables and Secrets → Add**, type **Secret**, one each:
   `TWITCH_ID`, `TWITCH_SECRET`, `SGDB_KEY`, `STEAM_KEY`, `STEAM_ID`, `ITAD_KEY` → **Deploy**.
6. Worker **Settings → Trigger events → Add → Cron trigger** → `0 6 * * *` (daily PS Plus check).
7. Copy the Worker address (`https://backlog-api.<something>.workers.dev`).
8. On GitHub open `config.js` → pencil icon → paste the address between the quotes of `API` (no slash at the end) → **Commit changes**. The site updates within a minute or two.

## Test it
Open `<worker address>/match` in the browser: it should say **Forbidden**. That means it's live and only answers your site.
Then open the site, sign in, and covers start loading at the top.

## Notes
- PC prices come from IsThereAnyDeal. PS Store prices aren't available to apps.
- "Leaving PS Plus" reads news articles (Push Square, KitGuru) and checks which of your PS Plus games they mention, so treat it as a heads-up.
- Firestore rules are in `firestore.rules`; paste them in Firebase → Firestore → Rules if you change them.
