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
- **Keep going** — when the day's reviews and new words are done, the Today
  screen (and the end-of-session summary) offers five ways to carry on, with a
  slider on top that sets how big the run is: anywhere from 10 to 100 cards, in
  tens, 20 by default. **Start batch N now** opens the next hundred words today
  and starts that many of them; **+N new words** introduces more from the batch
  you're on, scheduled as normal; **drill N hard words** shuffles together the
  words you've been rating Again or Hard; **review N ahead** pulls forward the
  cards due soonest, each one rescheduled from today; **practice N words** is a shuffled
  look at words you've started that scores nothing and changes no schedule —
  there are no rating buttons, just *Next word*. Each option shows what it can
  actually give you, so it reads "practice 30 words" if that's all you've
  started. The same number lives in Settings as **Keep-going size**.
- **Stats** — words learned, in learning, due today, streak, progress toward
  2,000, what you've been pressing (again / hard / good / easy), and the words
  giving you the most trouble, with a button to drill them.
- **Settings** — new words per day (default 15), hard words mixed into each
  session, keep-going size, review cap, direction (NL → EN, EN → NL or mixed),
  batch selection, voice and speed, theme, and export / import / reset.

Keyboard: **Space** or **Enter** flips (and rates *Good* on a flipped card, or
moves on in a practice run), **1**–**4** rate, **Esc** ends the session.

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

### Hard words

Every rating is kept twice over. Each word carries a tally of how often you
pressed each button (`lapses`, `hard`, `good`, `easy`, plus the last one), and
the last 2,000 ratings go into a rolling log of `{day, rank, dutch, rating}`.
Both live in the same record as the scheduling, so they travel in a backup and
cost you nothing in position or unlocked batches.

From that comes a difficulty score: an *Again* counts 2, a *Hard* counts 1, and
getting the word right chips away at it — two Goods, or one Easy, cancel a Hard.
A word you've recovered on therefore drops off the hard list instead of being
branded difficult for ever. Anything still above zero is a "hard word", and
there are two ways to meet them again:

- **Drill N hard words** in the Keep going list (and on the Stats screen) —
  worst first, shuffled, rated and rescheduled like any other review.
- **Settings → Mix in hard words** (off by default, up to 20) shuffles that many
  hard words into every daily session, among the reviews and before the new
  words. The Today screen counts them, so the number on the button is the number
  of cards you'll actually see.

Studying ahead is deliberate rather than accidental: extra new words and early
reviews only happen when you pick them, and because an early review is scheduled
from the day you do it, a card reviewed before it was due comes back a little
sooner than it would have. Practice runs avoid that entirely by writing nothing.

Batches unlock in order: the next one opens once the current one has been
started. You don't have to wait for that, though — **Start batch N now** on the
Today screen, or tapping any locked batch in Settings → Batches, opens it
immediately and makes it the source of new words from then on. Earlier words
aren't abandoned: everything you've already started keeps coming back for
review, and switching Settings → Batches back to **Automatic** resumes
introducing words in strict frequency order, picking up exactly where the
earlier batch left off.

### Your progress

Everything is stored under the single `localStorage` key `dutch-top2000-v1`, in
this browser only. Storage is wrapped in `try`/`catch` throughout — in private
mode or with storage blocked the app still runs for the session and shows a
warning. **Export a backup** before switching device or clearing site data;
import replaces the current progress after a confirmation.

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
| `js/storage.js` | The one localStorage key, sanitising, export/import/reset |
| `js/srs.js` | Scheduling, day maths, streaks |
| `js/data.js` | Batch discovery (fetch, or `bundle.js` on `file://`), batch unlocking |
| `js/speech.js` | Dutch voice selection and speaking |
| `js/ui.js` | Shell, navigation, Today / Stats / Settings |
| `js/study.js` | The session queue and the card itself |
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
