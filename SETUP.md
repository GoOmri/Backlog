# Backlog setup

About 15 minutes, once. After that the site works on your phone and PC.

## 1. Get a RAWG key
1. Go to https://rawg.io/apidocs and sign up (free).
2. Copy your API key.
3. Paste it into `config.js` as `RAWG_KEY`.

## 2. Create the Firebase project (sync + Google sign-in)
1. Go to https://console.firebase.google.com with your personal Google account and click **Create a project**. Name it `backlog`. Google Analytics can be off.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. **Build → Firestore Database → Create database.** Pick the location `eur3 (europe-west)` and start in **production mode**.
4. In Firestore open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**. This makes sure only you can read your list.
5. **Project settings (gear icon) → General → Your apps → Web (</>)**. Name it `backlog`, no hosting. Copy the `apiKey`, `authDomain`, `projectId` and `appId` values into `FIREBASE` in `config.js`.

## 3. Put it on GitHub Pages
1. On GitHub create a new repository called `backlog` (public; Pages is free for public repos).
2. **Add file → Upload files** and drag in all files from this folder: `index.html`, `app.js`, `style.css`, `config.js`, `firestore.rules`, `SETUP.md`. Commit.
3. **Settings → Pages → Source: Deploy from a branch → Branch: main / root → Save.** After a minute the site is live at `https://YOUR-USERNAME.github.io/backlog/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `YOUR-USERNAME.github.io`.

## 4. Move your games over
1. In the old Backlog on claude.ai tap **Export** and save `backlog-export.json`.
2. Open the new site, sign in with Google, tap **Import** and pick that file.
3. Covers, genres, tags, Metacritic and play time load in the background (about 6 games a second). You can keep using the app meanwhile.
4. Games RAWG couldn't find get a **No match** label. Filter by **Needs a match**, open one, and search for the right title.

## Notes
- The RAWG key and the Firebase config are visible to anyone who opens the page's source. That's how browser apps work and is fine here: the Firestore rules decide who can read data, and the free RAWG key only allows reading game info.
- On your phone, open the site and use **Add to Home Screen** so it opens like an app.
