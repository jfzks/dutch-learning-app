# Dutch 2000 — frequency flashcards

Spaced-repetition flashcards for the 2,000 most frequent Dutch words, for an
English speaker. All 2,000 are here, in twenty batches of a hundred: verbs with
their conjugations, nouns with article and plural, adjectives with the inflected
form, and an example sentence with translation for every single word. Plain
HTML, CSS and JavaScript — no build step, no backend, no login. Progress lives
in the browser and can be exported as a JSON file.

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

- **Today** has one choice and one button: **how many cards** (a slider, 10 to
  100 in tens, remembered between sessions), and **Start**. The line under the
  slider says what you'll get — *10 new · 5 hard · 5 review*.
- Tap a card (or press **Space**) to flip it. The back shows the translation,
  the grammar forms and an example sentence with its translation.
- Rate the card: **Again / Hard / Good / Know it** (keys **1**–**4**). The
  first three show when the word comes back; **Know it** retires the word for
  good. A toast offers **Undo** for a few seconds in case of a mis-tap.
- **🔊** speaks the Dutch with the browser's Dutch voice — one button for the
  word (top-right of the card), one for the example sentence. In English → Dutch
  mode the word button only appears after the flip. With no Dutch voice
  installed the app still tries `nl-NL` and says so in Settings.
- When a session ends, **Another N** starts the next one at the same size.
- **Stats** — known, learning, hard, due, streak, progress toward 2,000, what
  you've been pressing, your hard words, and your known words, each with a
  **Bring back** button.
- **Settings** — direction (NL → EN, EN → NL or mixed), voice and speed, theme,
  sync across devices, and export / import / reset.

Keyboard: **Space** or **Enter** flips (and rates *Good* on a flipped card),
**1**–**4** rate, **Esc** ends the session.

### What goes into a session

Three kinds of card, filled in this order for the number you picked:

1. **New words**, in frequency order — at least half the session while there
   are any left. There are no batches to unlock and no daily limit: the next
   unseen word is simply the most frequent one you haven't had yet.
2. **Hard words** — anything your ratings say is still giving you trouble
   (below), worst first, and ones you haven't already seen today before ones
   you have. They keep coming back, session after session, until you've got
   them right a few times.
3. **Reviews** — words you rated Good that the schedule says are due again.
   This is what makes a Good word stick; without it, one Good would retire a
   word just as Know it does.

If one kind runs short the others fill the gap, so a session is always the size
you asked for until there's nothing left. Reviews and hard words are shuffled,
and the new words are spread evenly through them. Words you marked **Know it**
never appear.

### Scheduling

An SM-2 variant. Each word keeps an easiness factor (1.3–2.8, starting at 2.5)
and an interval in whole days:

| Rating | First time | Second time | Later | Easiness |
|---|---|---|---|---|
| Again | same session | same session | same session | −0.20 |
| Hard | 1 day | interval × 1.2 | interval × 1.2 | −0.15 |
| Good | 2 days | 4 days | interval × EF | — |
| Know it | retired | retired | retired | +0.15 |

*Again* puts the card back about five cards later in the same session and resets
its interval. Intervals are capped at a year. Overdue reviews are never lost —
they wait, most overdue first, for the next session with room for them.

### Hard words

Every rating is kept twice over. Each word carries a tally of how often you
pressed each button (`lapses`, `hard`, `good`, `easy`, plus the last one), and
the last 2,000 ratings go into a rolling log of `{day, rank, dutch, rating}`.

From that comes a difficulty score: an *Again* counts 2, a *Hard* counts 1, and
getting the word right chips away at it — two Goods cancel a Hard. A word you've
recovered on therefore drops off the hard list instead of being branded
difficult for ever. Anything still above zero is a hard word.

### Known words

**Know it** sets `known: true` on the word and it's out of rotation from then
on. Words you'd rated *Easy* last, before this existed, count as known too.
Stats → **Known words** lists them all; **Bring back** puts one back into
practice, due straight away, with its history intact.

### Your progress

Everything is stored under the single `localStorage` key `dutch-top2000-v1`, in
this browser. Storage is wrapped in `try`/`catch` throughout — in private mode
or with storage blocked the app still runs for the session and shows a warning.
**Export a backup** now and then; **import** merges a backup into what's here
(see below), so it can't wipe out newer progress.

### Sync across devices

Settings → **Sync across devices** keeps your phone and laptop in step through
a secret gist on your GitHub account. There's no server of ours involved: the
app talks to the GitHub API directly from your browser.

Setting it up, once per device:

1. Tap **Create a GitHub token**. It opens GitHub's new-token page with only
   the `gist` scope ticked — leave it that way, so the token can touch your
   gists and nothing else. Pick an expiry, press **Generate token**, and copy
   it.
2. Paste it into the app and press **Connect**. The first device creates a
   secret gist holding one file, `dutch-top2000-progress.json`. On every other
   device, paste the **same token**: the app finds that gist and merges it with
   whatever is already on the device.

From then on it syncs by itself — when the app opens, comes back to the front
or gets focus, at the end of every session, when you switch away from it, every
three minutes while it's on screen, and 20 seconds after any other change. **Sync now** is there if you want it.

How the two copies are combined: every word either device has started is
kept, and for a word both have, the copy rated most recently decides its
schedule — including whether it's known. Every rating in the log is kept once.
Session size and direction follow whichever device changed them last; theme,
voice and speech speed stay per device. Merging never loses anything, so if two devices push at
nearly the same moment — the gist API has no way to refuse a stale write — the
next sync from either one puts the missing part back.

Good to know:

- A *secret* gist is unlisted, not private: anyone with its link could read
  your flashcard progress. Nothing else is in it.
- The token is stored in this browser under its own key
  (`dutch-top2000-sync`) and is never included in an exported backup or the
  gist.
- When the token expires, Today shows *Sync stopped*. Make a new one and
  connect again on each device; your progress and the gist are untouched.
- **Disconnect this device** forgets the token here. **Reset all progress**
  disconnects too, otherwise the gist would bring everything straight back;
  delete the gist on GitHub if you want that copy gone as well.
- Offline, the app just keeps going and syncs once you're back.
- On an iPhone, an app added to the Home Screen keeps its own storage, separate
  from Safari's. Connect sync in the one you actually use (or in both).
- If the file in the gist can't be read (edited by hand into invalid JSON, say)
  the app leaves it alone and says so, rather than overwriting it.

## Adding or changing a batch

Words are split into files of 100, in frequency order:

```
data/batch-01.json     words 1–100
data/batch-02.json     words 101–200
…
data/batch-20.json     words 1901–2000
```

Drop in `data/batch-21.json` and the app finds it — it asks for the numbered
files in turn (six at a time) until one is missing, so **no code changes are
needed**. After adding or editing any batch:

```bash
python3 top2000/tools/check_batches.py     # validates every batch
python3 top2000/tools/bundle_batches.py    # only needed for the file:// version
```

`check_batches.py` catches the mistakes that matter: a repeated rank or lemma, a
gap in the sequence, a verb missing a tense or with a perfect that has no
`heeft`/`is`, a noun without a `de`/`het` article, an adjective without its two
example uses.

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
(`de man`) and coloured on the back. Uncountable nouns take `"—"` as their
plural, which the card renders as "no plural (uncountable)".

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

**other** — function words, adverbs, pronouns, conjunctions, numbers. No
`forms`; put the grammar in `note`.

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
| `js/storage.js` | The one localStorage key, sanitising, export/import/reset, merging two copies of the progress |
| `js/sync.js` | Sync through a secret GitHub gist: connect, pull → merge → push |
| `js/srs.js` | Scheduling, day maths, streaks |
| `js/data.js` | Batch file discovery (fetch, or `bundle.js` on `file://`) |
| `js/speech.js` | Dutch voice selection and speaking |
| `js/ui.js` | Shell, navigation, Today / Stats / Settings |
| `js/study.js` | What goes into a session, and the card itself |
| `js/app.js` | Boot |
| `sw.js` | Offline cache. Everything is network-first and revalidated, so a release shows up on the next open; the cache is only the offline fallback |
| `tools/check_batches.py` | Validates the batch files |
| `tools/bundle_batches.py` | Regenerates `data/bundle.js` from the batch files |

One 404 in the browser console per load is expected: it's how the app finds the
end of the batch list.

## What's in the 2,000

474 verbs (every irregular one with its full forms), 881 nouns with article and
plural, 257 adjectives, and 388 function words, adverbs, numbers and fixed
expressions. The order is frequency-first — articles, pronouns and the
core verbs come before the everyday nouns, and the later batches shade into
vocabulary you meet once you can hold a conversation: work and study, health,
government paperwork, the environment, and a fair amount of thoroughly Dutch
material (pinnen, gezellig, meevallen, stroopwafel, bakfiets, Koningsdag).
