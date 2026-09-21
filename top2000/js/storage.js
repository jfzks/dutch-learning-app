/* Progress storage — everything the app remembers lives in one localStorage key.
   Every read and write is wrapped in try/catch: if storage is missing, full or
   blocked (Safari private mode), the app falls back to an in-memory store and
   keeps working for the session. */

'use strict';

(function (T2K) {
  const KEY = 'dutch-top2000-v1';
  const SCHEMA = 1;
  const TOTAL_GOAL = 2000;      // the target vocabulary size, for the progress bar
  const HISTORY_DAYS = 400;     // per-day review counts kept before trimming

  const DEFAULT_SETTINGS = {
    newPerDay: 15,
    maxReviews: 120,        // 0 = no limit
    direction: 'nl-en',     // 'nl-en' | 'en-nl' | 'mixed'
    theme: 'auto',          // 'auto' | 'light' | 'dark'
    batches: null,          // null = automatic (frequency order); else [1, 2, …]
    autoSpeak: false,       // speak the Dutch automatically when a card flips
    voiceURI: null,         // chosen Dutch voice, if the device has several
    speechRate: 0.9,
  };

  function emptyState() {
    return {
      schema: SCHEMA,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      cards: {},                                    // rank → scheduling state
      daily: { date: null, new: 0, reviews: 0 },    // today's counters
      streak: { current: 0, best: 0, lastDay: null },
      history: {},                                  // 'YYYY-MM-DD' → {reviews, new}
      totals: { reviews: 0 },
    };
  }

  // Can we actually persist? Probe rather than trust the presence of the API.
  function storageWorks() {
    try {
      const probe = KEY + ':probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Fold a parsed blob onto a fresh state, dropping anything malformed. Used for
  // both the stored value and imported files, so a hand-edited backup can't
  // break the app.
  function sanitize(raw) {
    const state = emptyState();
    if (!raw || typeof raw !== 'object') return state;

    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const num = (v, lo, hi, dflt) =>
      (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : dflt;
    state.settings.newPerDay = num(s.newPerDay, 0, 200, DEFAULT_SETTINGS.newPerDay);
    state.settings.maxReviews = num(s.maxReviews, 0, 999, DEFAULT_SETTINGS.maxReviews);
    state.settings.direction = ['nl-en', 'en-nl', 'mixed'].includes(s.direction) ? s.direction : 'nl-en';
    state.settings.theme = ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto';
    state.settings.batches = Array.isArray(s.batches)
      ? s.batches.filter(n => typeof n === 'number' && n > 0).sort((a, b) => a - b)
      : null;
    state.settings.autoSpeak = !!s.autoSpeak;
    state.settings.voiceURI = typeof s.voiceURI === 'string' ? s.voiceURI : null;
    state.settings.speechRate = num(s.speechRate, 0.5, 1.5, DEFAULT_SETTINGS.speechRate);

    const cards = raw.cards && typeof raw.cards === 'object' ? raw.cards : {};
    for (const [rank, c] of Object.entries(cards)) {
      if (!c || typeof c !== 'object' || !/^\d+$/.test(rank)) continue;
      if (typeof c.due !== 'string') continue;
      state.cards[rank] = {
        ef: num(c.ef, 1.3, 2.8, 2.5),
        ivl: num(c.ivl, 0, 365, 0),
        reps: num(c.reps, 0, 9999, 0),
        lapses: num(c.lapses, 0, 9999, 0),
        due: c.due,
        last: typeof c.last === 'string' ? c.last : null,
        seen: num(c.seen, 0, 99999, 0),
      };
    }

    if (raw.daily && typeof raw.daily.date === 'string') {
      state.daily = {
        date: raw.daily.date,
        new: num(raw.daily.new, 0, 9999, 0),
        reviews: num(raw.daily.reviews, 0, 99999, 0),
      };
    }
    if (raw.streak && typeof raw.streak === 'object') {
      state.streak = {
        current: num(raw.streak.current, 0, 99999, 0),
        best: num(raw.streak.best, 0, 99999, 0),
        lastDay: typeof raw.streak.lastDay === 'string' ? raw.streak.lastDay : null,
      };
    }
    if (raw.history && typeof raw.history === 'object') {
      for (const [day, h] of Object.entries(raw.history)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !h || typeof h !== 'object') continue;
        state.history[day] = { reviews: num(h.reviews, 0, 99999, 0), new: num(h.new, 0, 9999, 0) };
      }
    }
    if (raw.totals && typeof raw.totals === 'object') {
      state.totals.reviews = num(raw.totals.reviews, 0, 9999999, 0);
    }
    return state;
  }

  function trimHistory(state) {
    const days = Object.keys(state.history).sort();
    for (const day of days.slice(0, Math.max(0, days.length - HISTORY_DAYS))) {
      delete state.history[day];
    }
  }

  const store = {
    TOTAL_GOAL,
    SCHEMA,
    available: false,
    state: emptyState(),

    load() {
      this.available = storageWorks();
      let raw = null;
      try {
        raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      } catch (e) {
        raw = null;    // corrupt value — start fresh rather than refuse to run
      }
      this.state = sanitize(raw);
      return this.state;
    },

    save() {
      if (!this.available) return false;
      try {
        trimHistory(this.state);
        localStorage.setItem(KEY, JSON.stringify(this.state));
        return true;
      } catch (e) {
        // Quota or a storage permission that changed mid-session: stop trying to
        // persist, but let the session carry on in memory.
        this.available = false;
        return false;
      }
    },

    replace(rawState) {
      this.state = sanitize(rawState);
      this.save();
      return this.state;
    },

    reset() {
      this.state = emptyState();
      try { localStorage.removeItem(KEY); } catch (e) {}
      return this.state;
    },

    // ---- export / import ----
    exportPayload() {
      return {
        app: 'dutch-top2000',
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        data: this.state,
      };
    },

    // Accepts either a full export file or a bare state object, so an older or
    // hand-made backup still imports. Throws with a readable message otherwise.
    parseImport(text) {
      let obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        throw new Error("That file isn't valid JSON.");
      }
      const body = obj && obj.data && typeof obj.data === 'object' ? obj.data : obj;
      if (!body || typeof body !== 'object' || (!body.cards && !body.settings)) {
        throw new Error("That doesn't look like a Dutch flashcards backup.");
      }
      return sanitize(body);
    },
  };

  T2K.store = store;
  T2K.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(window.T2K = window.T2K || {});
