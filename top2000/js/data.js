/* Word data — discovery and loading.

   Batches live in data/batch-01.json, batch-02.json, … Nothing lists them:
   the app just asks for the next number until one is missing, so dropping a new
   file into data/ is all it takes to extend the deck.

   Over http(s) the files are fetched. Opened straight from disk (file://)
   browsers refuse to fetch local JSON, so we fall back to data/bundle.js —
   a generated script holding the same batches, which a <script> tag may load
   from disk. Regenerate it with tools/bundle_batches.py. */

'use strict';

(function (T2K) {
  const MAX_BATCHES = 40;       // 2,000 words at 100 per batch, with headroom
  const PATH = (n) => `data/batch-${String(n).padStart(2, '0')}.json`;

  function loadBundle() {
    if (window.T2K_BUNDLE) return Promise.resolve(window.T2K_BUNDLE);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/bundle.js';
      s.onload = () => resolve(window.T2K_BUNDLE || null);
      s.onerror = () => reject(new Error('bundle.js not found'));
      document.head.appendChild(s);
    });
  }

  async function fetchBatch(n) {
    const res = await fetch(PATH(n), { cache: 'no-cache' });
    if (!res.ok) return null;                  // 404 = we've reached the end
    return res.json();
  }

  // A word's identity for scheduling is its rank; these helpers shape it for
  // display.
  function headword(w) {
    return w.type === 'noun' && w.forms && w.forms.article
      ? `${w.forms.article} ${w.dutch}`
      : w.dutch;
  }

  function batchOf(rank) {
    return Math.floor((rank - 1) / 100) + 1;
  }

  const deck = {
    mode: 'fetch',        // 'fetch' | 'bundle'
    words: [],            // every loaded word, sorted by rank
    batches: [],          // [{ batch, range, title, words: [...] }]
    byRank: new Map(),
    rankBatch: new Map(), // rank → batch number

    async load() {
      let source = null;
      try {
        // Probe batch 1 first: on file:// this throws and sends us to the bundle.
        const first = await fetchBatch(1);
        if (first) {
          source = { kind: 'fetch', first };
        } else {
          throw new Error('batch-01.json missing');
        }
      } catch (e) {
        const bundle = await loadBundle().catch(() => null);
        if (!bundle) throw new Error('No word data found.');
        source = { kind: 'bundle', bundle };
      }

      const batches = [];
      if (source.kind === 'fetch') {
        this.mode = 'fetch';
        batches.push(source.first);
        for (let n = 2; n <= MAX_BATCHES; n++) {
          let b = null;
          try {
            b = await fetchBatch(n);
          } catch (e) {
            b = null;
          }
          if (!b) break;
          batches.push(b);
        }
      } else {
        this.mode = 'bundle';
        for (let n = 1; n <= MAX_BATCHES; n++) {
          const b = source.bundle[n] || source.bundle[String(n)];
          if (!b) break;
          batches.push(b);
        }
      }

      this.batches = batches
        .filter(b => b && Array.isArray(b.words))
        .map(b => ({
          batch: b.batch,
          range: b.range || [Math.min(...b.words.map(w => w.rank)), Math.max(...b.words.map(w => w.rank))],
          title: b.title || `Words ${b.range ? b.range[0] + '–' + b.range[1] : ''}`,
          words: b.words.slice().sort((a, b2) => a.rank - b2.rank),
        }))
        .sort((a, b) => a.batch - b.batch);

      this.words = this.batches.flatMap(b => b.words).sort((a, b) => a.rank - b.rank);
      this.byRank = new Map(this.words.map(w => [w.rank, w]));
      this.rankBatch = new Map();
      for (const b of this.batches) {
        for (const w of b.words) this.rankBatch.set(w.rank, b.batch);
      }
      return this;
    },

    batchByNumber(n) {
      return this.batches.find(b => b.batch === n) || null;
    },

    // Which batch file a word came from — read from the loaded data rather than
    // assumed from the rank, so batches of other sizes still work.
    batchNumberOf(rank) {
      const n = this.rankBatch.get(rank);
      return n === undefined ? batchOf(rank) : n;
    },

    // A batch is unlocked once the one before it has been started — at least
    // one of its words has been introduced. Batch 1 is always open.
    unlockedBatches(cards) {
      const out = [];
      for (const b of this.batches) {
        if (b.batch === this.batches[0].batch) { out.push(b.batch); continue; }
        const prev = this.batchByNumber(b.batch - 1);
        const started = prev && prev.words.some(w => cards[w.rank]);
        if (!started) break;
        out.push(b.batch);
      }
      return out;
    },

    // Which batches new words may come from: the manual pick if there is one
    // (never beyond what's unlocked), otherwise everything unlocked.
    activeBatches(state) {
      const unlocked = this.unlockedBatches(state.cards);
      const chosen = state.settings.batches;
      if (!chosen || !chosen.length) return unlocked;
      const picked = chosen.filter(n => unlocked.includes(n));
      return picked.length ? picked : unlocked.slice(0, 1);
    },
  };

  T2K.deck = deck;
  T2K.headword = headword;
  T2K.batchOf = batchOf;
})(window.T2K = window.T2K || {});
