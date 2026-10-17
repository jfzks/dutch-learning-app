/* Progress storage — everything the app remembers lives in one localStorage key.
   Every read and write is wrapped in try/catch: if storage is missing, full or
   blocked (Safari private mode), the app falls back to an in-memory store and
   keeps working for the session. */

'use strict';

(function (T2K) {
  const KEY = 'dutch-top2000-v1';
  const SCHEMA = 1;
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const LOG_MAX = 2000;         // ratings kept in the rolling review log
  const TOTAL_GOAL = 2000;      // the target vocabulary size, for the progress bar
  const HISTORY_DAYS = 400;     // per-day review counts kept before trimming

  const DEFAULT_SETTINGS = {
    newPerDay: 15,
    maxReviews: 120,        // 0 = no limit
    direction: 'nl-en',     // 'nl-en' | 'en-nl' | 'mixed'
    theme: 'auto',          // 'auto' | 'light' | 'dark'
    batches: null,          // null = automatic (frequency order); else [1, 2, …]
    unlockedThrough: 0,     // batches up to here are open, however far you've got
    extraSize: 20,          // cards in a "keep going" run (10–100, in tens)
    mixHard: 0,             // hard words shuffled into each daily session (0 = off)
    autoSpeak: false,       // speak the Dutch automatically when a card flips
    voiceURI: null,         // chosen Dutch voice, if the device has several
    speechRate: 0.9,
  };

  // Settings that follow you between devices. The rest — theme, voice, speed —
  // depend on the device, so each one keeps its own.
  const SYNCED_SETTINGS = ['newPerDay', 'maxReviews', 'direction', 'batches',
    'unlockedThrough', 'extraSize', 'mixHard'];

  function emptyState() {
    return {
      schema: SCHEMA,
      settingsAt: 0,                                // when a synced setting last changed
      settings: Object.assign({}, DEFAULT_SETTINGS),
      cards: {},                                    // rank → scheduling state
      log: [],                                      // recent ratings, newest last
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
    const time = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : 0);
    state.settingsAt = time(raw.settingsAt);
    state.settings.newPerDay = num(s.newPerDay, 0, 200, DEFAULT_SETTINGS.newPerDay);
    state.settings.maxReviews = num(s.maxReviews, 0, 999, DEFAULT_SETTINGS.maxReviews);
    state.settings.direction = ['nl-en', 'en-nl', 'mixed'].includes(s.direction) ? s.direction : 'nl-en';
    state.settings.theme = ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto';
    state.settings.batches = Array.isArray(s.batches)
      ? s.batches.filter(n => typeof n === 'number' && n > 0).sort((a, b) => a - b)
      : null;
    state.settings.unlockedThrough = num(s.unlockedThrough, 0, 999, 0);
    state.settings.extraSize =
      Math.round(num(s.extraSize, 10, 100, DEFAULT_SETTINGS.extraSize) / 10) * 10;
    state.settings.mixHard = Math.round(num(s.mixHard, 0, 20, 0) / 5) * 5;
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
        // Rating tallies — missing in backups made before they existed.
        hard: num(c.hard, 0, 9999, 0),
        good: num(c.good, 0, 9999, 0),
        easy: num(c.easy, 0, 9999, 0),
        lastRating: RATINGS.includes(c.lastRating) ? c.lastRating : null,
      };
      if (time(c.at)) state.cards[rank].at = time(c.at);
    }

    if (Array.isArray(raw.log)) {
      for (const e of raw.log.slice(-LOG_MAX)) {
        if (!e || typeof e !== 'object') continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day) || !RATINGS.includes(e.rating)) continue;
        const entry = {
          day: e.day,
          rank: num(e.rank, 1, 99999, 0),
          dutch: typeof e.dutch === 'string' ? e.dutch.slice(0, 60) : '',
          rating: e.rating,
        };
        if (time(e.at)) entry.at = time(e.at);
        state.log.push(entry);
      }
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

  const syncedSnapshot = (settings) =>
    JSON.stringify(SYNCED_SETTINGS.map(k => settings[k]));

  // ---- merging two copies of the progress (sync, and importing a backup) ----
  //
  // Nothing is ever thrown away: every word either side has started survives,
  // and for a word both sides have, the copy rated most recently decides the
  // schedule. Counts take the larger side rather than adding up, because the
  // usual case is the same history seen twice (you studied on one device, the
  // other already pulled it) — adding would double it.

  // The copy rated last. Compare the day first so cards rated before `at`
  // existed still order sensibly, then the exact time, then how often seen.
  function newerCard(a, b) {
    if ((a.last || '') !== (b.last || '')) return (a.last || '') > (b.last || '') ? a : b;
    if ((a.at || 0) !== (b.at || 0)) return (a.at || 0) > (b.at || 0) ? a : b;
    return (b.seen || 0) > (a.seen || 0) ? b : a;
  }

  // Log entries carry the time they were made, which identifies them. Older
  // entries have no time: those are numbered by how many identical ones follow
  // them, which stays stable as the log is trimmed at the front.
  function logKeys(log) {
    const keys = new Array(log.length);
    const seen = {};
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.at) { keys[i] = `t${e.at}|${e.rank}|${e.rating}`; continue; }
      const base = `d${e.day}|${e.rank}|${e.rating}`;
      seen[base] = (seen[base] || 0) + 1;
      keys[i] = `${base}#${seen[base]}`;
    }
    return keys;
  }

  // Consecutive study days ending on `lastDay`, read from the per-day history.
  function runFromHistory(history, lastDay) {
    const srs = T2K.srs;
    if (!lastDay || !srs) return 0;
    let run = 0;
    for (let day = lastDay; history[day] && history[day].reviews > 0; day = srs.addDays(day, -1)) run++;
    return run;
  }

  function merge(localRaw, remoteRaw) {
    const local = sanitize(localRaw);
    const remote = sanitize(remoteRaw);
    const out = emptyState();

    // Settings: the synced ones come from whichever side changed them last;
    // unlocked batches never close again; device settings stay as they are here.
    const newer = remote.settingsAt > local.settingsAt ? remote : local;
    out.settings = Object.assign({}, local.settings);
    for (const k of SYNCED_SETTINGS) out.settings[k] = newer.settings[k];
    out.settings.unlockedThrough = Math.max(local.settings.unlockedThrough, remote.settings.unlockedThrough);
    out.settingsAt = Math.max(local.settingsAt, remote.settingsAt);

    for (const rank of new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)])) {
      const a = local.cards[rank], b = remote.cards[rank];
      if (!a || !b) { out.cards[rank] = a || b; continue; }
      const card = Object.assign({}, newerCard(a, b));
      for (const k of ['seen', 'lapses', 'hard', 'good', 'easy']) card[k] = Math.max(a[k], b[k]);
      out.cards[rank] = card;
    }

    const byKey = new Map();
    for (const list of [local.log, remote.log]) {
      const keys = logKeys(list);
      list.forEach((e, i) => { if (!byKey.has(keys[i])) byKey.set(keys[i], e); });
    }
    out.log = Array.from(byKey.values())
      .sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : (x.at || 0) - (y.at || 0)))
      .slice(-LOG_MAX);

    // The merged log is exact where the counters can only take the larger side,
    // so where both devices studied on the same day, the log's count wins.
    const logged = {};
    for (const e of out.log) logged[e.day] = (logged[e.day] || 0) + 1;

    for (const day of new Set([...Object.keys(local.history), ...Object.keys(remote.history)])) {
      const a = local.history[day] || { reviews: 0, new: 0 };
      const b = remote.history[day] || { reviews: 0, new: 0 };
      out.history[day] = {
        reviews: Math.max(a.reviews, b.reviews, logged[day] || 0),
        new: Math.max(a.new, b.new),
      };
    }

    const dl = local.daily, dr = remote.daily;
    if (dl.date === dr.date) {
      out.daily = { date: dl.date, new: Math.max(dl.new, dr.new), reviews: Math.max(dl.reviews, dr.reviews) };
    } else {
      out.daily = Object.assign({}, (dr.date || '') > (dl.date || '') ? dr : dl);
    }
    if (out.daily.date) out.daily.reviews = Math.max(out.daily.reviews, logged[out.daily.date] || 0);

    const sl = local.streak, sr = remote.streak;
    const later = (sr.lastDay || '') > (sl.lastDay || '') ||
      (sr.lastDay === sl.lastDay && sr.current > sl.current) ? sr : sl;
    out.streak = {
      current: Math.max(later.current, runFromHistory(out.history, later.lastDay)),
      best: 0,
      lastDay: later.lastDay,
    };
    out.streak.best = Math.max(sl.best, sr.best, out.streak.current);

    // Each side's total, plus the ratings in the merged log that side hadn't
    // seen — exact unless the log has hit its cap, and then never too high.
    const plusUnseen = (side) => side.totals.reviews + Math.max(0, out.log.length - side.log.length);
    out.totals.reviews = Math.max(plusUnseen(local), plusUnseen(remote));
    trimHistory(out);
    return out;
  }

  const store = {
    TOTAL_GOAL,
    SCHEMA,
    available: false,
    state: emptyState(),
    onSave: null,           // set by sync.js: told whenever progress is written
    settingsSnap: null,     // the synced settings as last saved, to spot changes

    load() {
      this.available = storageWorks();
      let raw = null;
      try {
        raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      } catch (e) {
        raw = null;    // corrupt value — start fresh rather than refuse to run
      }
      this.state = sanitize(raw);
      this.settingsSnap = syncedSnapshot(this.state.settings);
      return this.state;
    },

    save() {
      // Stamp a change to a synced setting, so the newest choice wins a merge.
      const snap = syncedSnapshot(this.state.settings);
      if (this.settingsSnap !== null && snap !== this.settingsSnap) this.state.settingsAt = Date.now();
      this.settingsSnap = snap;
      if (this.onSave) this.onSave();
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
      this.settingsSnap = syncedSnapshot(this.state.settings);
      this.save();
      return this.state;
    },

    // Fold another copy of the progress into this one — what sync and import
    // both do. Returns true if anything here changed.
    mergeIn(rawState) {
      const before = JSON.stringify(this.state);
      this.state = merge(this.state, rawState);
      this.settingsSnap = syncedSnapshot(this.state.settings);
      const changed = JSON.stringify(this.state) !== before;
      if (changed) this.save();
      return changed;
    },

    reset() {
      this.state = emptyState();
      this.settingsSnap = syncedSnapshot(this.state.settings);
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
  T2K.mergeProgress = merge;
  T2K.sanitizeProgress = sanitize;
  T2K.SYNCED_SETTINGS = SYNCED_SETTINGS;
  T2K.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(window.T2K = window.T2K || {});
