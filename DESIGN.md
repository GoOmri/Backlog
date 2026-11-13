# Game Night — design rules

Read with NOTES.md before any visual change. New UI reuses what's here; if something new is truly needed, add it here in the same commit.

## Tokens (style.css `:root`) — never hardcode
- Colors: `--bg` page · `--surface` cards/sheets · `--raise` inputs, placeholders · `--line` borders · `--fg` text · `--dim` secondary text · `--accent` (purple) with `--accent-fg` on top.
- Status: `--good` owned/success · `--bad` errors, "Not owned", "Very hard" · `--warn` · `--gold` stars · `--heart` wishlist.
- Platforms: `--ps --psplus --steam --epic --itch --other`. Only for platform badges.
- Text sizes: `--t-xs` 12 · `--t-s` 14 · `--t-m` 16 · `--t-r` 17 · `--t-l` 20 · `--t-xl` 32. Nothing in between.
- Spacing: `--s1` 4 · `--s2` 8 · `--s3` 16 · `--s4` 24 · `--s5` 32 · `--s6` 48. Nothing in between.
- Radius: `--r-s` 8 small chips/badges/thumbs · `--r-m` 12 cards/media · `--r-l` 16 sheets. Pills (999px) only for chips and the main status button.
- Fonts: `--display` titles/headings · `--body` everything else · `--mono` counts only ("598 games") · Press Start 2P only for the brand/splash.
- Motion: `--d-fast/--d/--d-slow` with `--e-out`; no new durations.

## Text
- Weights: 400 body, 600 emphasis/labels. 700 only for the big page title.
- One-line UI text (card subtitle, chips, buttons, badges, list rows) never wraps: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` on a `min-width:0` child.
- Card titles max 2 lines; descriptions clamp (3 lines) with tap to expand.
- Never put two things in one flex row if either can be long; give the long one its own line instead of squeezing.
- Sentence case everywhere; no "!" in UI copy; numbers rounded.

## Layout
- Mobile first: design and check at 360px wide. Desktop is the same layout, wider.
- Side gutter `--gut` (16px+safe area). Nothing touches screen edges.
- Tap targets ≥ 44px tall (icon buttons 44×44).
- Rows of chips/buttons never wrap: they scroll sideways with a right-edge fade (tags) or shorten (labels → one word, secondary actions → 40–44px icon buttons on the right).
- Stacked rows of chips/buttons always have a gap (`--s2`) between rows.
- Grids: phone 3 columns for game cards, 2 max for anything with text.

## Components (reuse, don't invent variants)
- Card: cover (2:3, `--r-m`) → title → subtitle (tags, one line) → stars on their own line.
- Chip: filter/toggle, pill, `--raise` bg; active = `--accent` bg + `--accent-fg`.
- Badge (status word like OWNED / VERY HARD): small caps text, tinted bg of its status color, `--r-s`.
- Platform badge: filled = you own it there; outlined = available there, not owned. Never repeat the same platform as text next to it.
- Buttons: one filled `--accent` primary per view (the status button); others are outlined/ghost or 44px round icon buttons.
- Sheets: full-screen game page or bottom sheet; close top-right; actions at the bottom, primary on the right.

- Game page: header = title → year · developer (· Deck) → one tag line (`tagLine`, max 6, co-op once) → action row (status/“✓ Finished” · tap stars · spacer · icon buttons). Facts = 2-column tiles (`.ftile`: label, value, optional small line); a tile with no data isn't drawn.

## One piece of information, one place
- Don't show the same fact twice on a screen (e.g. owned platform as text and as a badge).
- Prefer a badge/icon over a sentence when it's a state; prefer text over an icon when it's an action.

## Before pushing a visual change
1. Mockup first (rule from NOTES.md).
2. Check at 360px: no wrapped labels, no overlaps, nothing touching edges.
3. Long title + many tags + 5 stars on a card still fits.
4. Only tokens used; no new hex, sizes or radii.
5. node --check, eslint no-undef, and the shadowing check (`no-shadow` for helpers like `key`, `list`, `all`).
