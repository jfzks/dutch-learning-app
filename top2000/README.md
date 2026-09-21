# Dutch 2000 — frequency flashcards

Spaced-repetition flashcards for the 2,000 most frequent Dutch words, for an
English speaker. Plain HTML, CSS and JavaScript — no build step, no backend, no
login. Progress lives in the browser and can be exported as a JSON file.

This is a separate app from the one in `../app/`, which drills the vocabulary
from your course wordlists. Neither reads the other's data.

## How to run it

**Serve the folder** (recommended — this is how new batches are picked up
automatically):

```bash
python3 -m http.server 8000 --directory top2000
# then open http://localhost:8000/
```

**Or double-click `index.html`.** Browsers block `fetch()` of local files, so in
that case the app falls back to `data/bundle.js`, a generated copy of the batch
files. Re-run `tools/bundle_batches.py` after changing any batch, or the
double-click version will show the old words.

Deployed, it lives at `<your GitHub Pages URL>/top2000/` — see
`.github/workflows/pages.yml`. On a phone, "Add to Home Screen" installs it and
it works offline.

## Using it

- **Today** — how many reviews are due and how many new words are left, and the
  button that starts the session. Reviews come first, then new words in
  frequency order.
- Tap a card (or press **Space**) to flip it. The back shows the translation,
  the grammar forms and an example sentence with its translation.
- Rate the card: **Again / Hard / Good / Easy** (keys **1**–**4**). Each button
  shows when the word will come back.
- **🔊** speaks the Dutch with the browser's Dutch voice — one button for the
  word (top-right of the card), one for the example sentence. In English → Dutch
  mode the word button only appears after the flip. With no Dutch voice
  installed the app still tries `nl-NL` and says so in Settings.
- **Stats** — words learned, in learning, due today, streak, and progress toward
  2,000.
- **Settings** — new words per day (default 15), review cap, direction
  (NL → EN, EN → NL or mixed), batch selection, voice and speed, theme, and
  export / import / reset.

Keyboard: **Space** or **Enter** flips (and rates *Good* on a flipped card),
**1**–**4** rate, **Esc** ends the session.

### Scheduling

An SM-2 variant. Each word keeps an easiness factor (1.3–2.8, starting at 2.5)
and an interval in whole days:

| Rating | First time | Second time | Later | Easiness |
|---|---|---|---|---|
| Again | same session | same session | same session | −0.20 |
| Hard | 1 day | interval × 1.2 | interval × 1.2 | −0.15 |
| Good | 2 days | 4 days | interval × EF | — |
| Easy | 4 days | 7 days | interval × EF × 1.3 | +0.15 |

*Again* puts the card back about five cards later in the same session and resets
its interval. Intervals are capped at a year. Overdue reviews are never lost —
they queue up, oldest first, limited by the daily review cap.

Batches unlock in order: the next one opens once the current one has been
started. Settings → Batches switches to manual picking within what's unlocked.

### Your progress

Everything is stored under the single `localStorage` key `dutch-top2000-v1`, in
this browser only. Storage is wrapped in `try`/`catch` throughout — in private
mode or with storage blocked the app still runs for the session and shows a
warning. **Export a backup** before switching device or clearing site data;
import replaces the current progress after a confirmation.

## Adding the next batch

Words are split into files of 100, in frequency order:

```
data/batch-01.json     words 1–100
data/batch-02.json     words 101–200
…
```

Drop in `data/batch-02.json` and the app finds it — it asks for each numbered
file in turn until one is missing, so **no code changes are needed**. Then:

```bash
python3 top2000/tools/bundle_batches.py    # only needed for the file:// version
```

`rank` is the word's identity in your saved progress, so don't renumber words
that already exist — append new ranks instead.

### File format

```json
{
  "batch": 2,
  "range": [101, 200],
  "title": "Words 101–200",
  "words": [ … ]
}
```

Every word has `rank`, `dutch`, `english`, `type`
(`verb` | `noun` | `adjective` | `other`), an `example` with `nl` and `en`, and
an optional `note` (a grammar hint shown under the forms). What goes in `forms`
depends on `type`:

**verb** — present tense for the four persons, past singular/plural, and the
perfect *with its auxiliary* (`heeft …` or `is …`). Use `null` for a verb with
no perfect, such as *zullen*.

```json
{
  "rank": 4,
  "dutch": "zijn",
  "english": "to be",
  "type": "verb",
  "note": "Most irregular verb in Dutch. Also means 'his': zijn fiets.",
  "forms": {
    "present": { "ik": "ben", "jij": "bent", "hij": "is", "wij": "zijn" },
    "past": { "singular": "was", "plural": "waren" },
    "perfect": "is geweest"
  },
  "example": { "nl": "Ik ben moe, maar hij is nog wakker.", "en": "I am tired, but he is still awake." }
}
```

**noun** — article and plural. The article is shown on the front of the card
(`de man`) and coloured on the back.

```json
{
  "rank": 78,
  "dutch": "kind",
  "english": "child",
  "type": "noun",
  "forms": { "article": "het", "plural": "kinderen" },
  "example": { "nl": "Het kind speelt in de tuin.", "en": "The child is playing in the garden." }
}
```

**adjective** — the inflected `-e` form and two short uses, one with a de-word
and one with a het-word.

```json
{
  "rank": 71,
  "dutch": "groot",
  "english": "big, large",
  "type": "adjective",
  "forms": { "inflected": "grote", "examples": ["een grote stad", "een groot huis"] },
  "example": { "nl": "Amsterdam is een grote stad.", "en": "Amsterdam is a big city." }
}
```

**other** — function words, adverbs, pronouns, conjunctions. No `forms`; put the
grammar in `note`.

```json
{
  "rank": 64,
  "dutch": "omdat",
  "english": "because",
  "type": "other",
  "note": "Subordinating: the verb moves to the end of the clause.",
  "example": { "nl": "Ik blijf thuis omdat ik ziek ben.", "en": "I'm staying at home because I'm ill." }
}
```

## What's where

| File | What it does |
|---|---|
| `index.html` | Shell; loads the scripts in order (plain `<script>`, so `file://` works) |
| `styles.css` | Tokens on `:root`, dark mode from the system setting or the Theme picker |
| `js/storage.js` | The one localStorage key, sanitising, export/import/reset |
| `js/srs.js` | Scheduling, day maths, streaks |
| `js/data.js` | Batch discovery (fetch, or `bundle.js` on `file://`), batch unlocking |
| `js/speech.js` | Dutch voice selection and speaking |
| `js/ui.js` | Shell, navigation, Today / Stats / Settings |
| `js/study.js` | The session queue and the card itself |
| `js/app.js` | Boot |
| `sw.js` | Offline cache; pages and word data are network-first, so new batches appear |
| `tools/bundle_batches.py` | Regenerates `data/bundle.js` from the batch files |

One 404 in the browser console per load is expected: it's how the app finds the
end of the batch list.
