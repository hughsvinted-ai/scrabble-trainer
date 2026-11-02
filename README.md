# Scrabble Word Trainer

A phone-first web app (installable PWA) for memorising Scrabble word lists with spaced repetition.

**Study order** (new cards follow this priority, most probable racks first inside each set):

1. 2-letter words
2. 3-letter words
3. JQXZ 4-letter words
4. Three-vowel 4s
5. Q without U (up to 8 letters)
6. Top 100 7s by probability (the racks you're most likely to draw)
7. Top 100 8s by probability

Dictionaries: **Collins CSW21** (default) and **NWL2023**. Each keeps its own progress.

## Memorisation techniques used

- **Spaced repetition** (SM-2 style): 1 min → 10 min → 1 day → growing gaps; a miss resets the card.
- **Active recall on alphagrams**: you see the tiles and tap out every valid anagram.
- **Valid-or-phony drills**: real words mixed with near-miss phonies (and words valid only in the other dictionary). Missed real words get pulled forward for review.
- **Definitions and hooks** on every word, plus a list view grouped by letter for reading through.
- **Daily cap on new cards** so reviews never pile up.

Progress is stored on the device (localStorage). Use Settings → Export/Import for backups.

## Run locally

```bash
npm start   # http://localhost:3000
```

No dependencies. `server.js` is a tiny static server; the app lives in `public/`.

## Deploy on Railway

1. Railway → New Project → Deploy from GitHub repo → pick this repo.
2. Railway detects Node and runs `npm start` (see `railway.json`, health check `/health`).
3. Settings → Networking → **Generate Domain**.
4. Open that URL on your phone. On iPhone use Share → Add to Home Screen; on Android use menu → Install app.

## Updating word data / adding sets

Study sets are defined in `scripts/build-data.js` (`SETS` array). To add a set, add an entry
with a `select(word)` filter (or `top: N` for a top-N-by-probability list) and run:

```bash
npm run build:data
```

This downloads the full lists into `.cache/` (git-ignored) and writes the small study files to
`public/data/`. Bump `CACHE` in `public/sw.js` when you change app files so phones pick up the update.
