/* Spaced repetition — a small SM-2 variant.
   Each word keeps {ef, ivl, reps, lapses, due, last, seen}. Ratings are
   'again' | 'hard' | 'good' | 'easy'; intervals are whole days and dates are
   local 'YYYY-MM-DD' strings so they sort and compare as plain text. */

'use strict';

(function (T2K) {
  const MIN_EF = 1.3, MAX_EF = 2.8, MAX_IVL = 365;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Whole days between two day keys. Rounding absorbs daylight-saving hours.
  function dayDiff(from, to) {
    return Math.round((fromKey(to) - fromKey(from)) / 86400000);
  }

  function addDays(key, n) {
    const d = fromKey(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  function fresh(today) {
    return { ef: 2.5, ivl: 0, reps: 0, lapses: 0, due: today, last: null, seen: 0 };
  }

  // The interval a rating would produce, in days. 0 means "again today".
  function nextInterval(card, rating) {
    const c = card || { ef: 2.5, ivl: 0, reps: 0 };
    const ef = c.ef || 2.5;
    const ivl = c.ivl || 0;
    const reps = c.reps || 0;
    // The first two intervals are fixed steps; after that the easiness factor
    // takes over. Each button gives a visibly different date, which is the
    // point of having four of them.
    if (rating === 'again') return 0;
    if (rating === 'hard') return reps === 0 ? 1 : clamp(Math.round(Math.max(ivl, 1) * 1.2), 1, MAX_IVL);
    if (rating === 'easy') {
      if (reps === 0) return 4;
      if (reps === 1) return 7;
      return clamp(Math.round(Math.max(ivl, 1) * ef * 1.3), 1, MAX_IVL);
    }
    // 'good'
    if (reps === 0) return 2;
    if (reps === 1) return 4;
    return clamp(Math.round(Math.max(ivl, 1) * ef), 1, MAX_IVL);
  }

  // Apply a rating, returning the new card state. 'again' keeps the card due
  // today — the session re-queues it a few cards later.
  function review(card, rating, today) {
    const c = Object.assign(fresh(today), card || {});
    const ivl = nextInterval(c, rating);
    let ef = c.ef;

    if (rating === 'again') {
      ef -= 0.20;
      c.lapses += 1;
      c.reps = 0;
      c.ivl = 0;
      c.due = today;
    } else {
      if (rating === 'hard') ef -= 0.15;
      if (rating === 'easy') ef += 0.15;
      c.reps += 1;
      c.ivl = ivl;
      c.due = addDays(today, ivl);
    }

    c.ef = Math.round(clamp(ef, MIN_EF, MAX_EF) * 100) / 100;
    c.last = today;
    c.seen += 1;
    return c;
  }

  // "now" / "1 d" / "3 wk" — the little label under each rating button.
  function intervalLabel(days) {
    if (!days) return 'now';
    if (days === 1) return '1 d';
    if (days < 21) return days + ' d';
    if (days < 60) return Math.round(days / 7) + ' wk';
    if (days < 365) return Math.round(days / 30) + ' mo';
    return Math.round(days / 365 * 10) / 10 + ' yr';
  }

  // ---- daily counters + streak -------------------------------------------

  function rollDay(state, today) {
    if (state.daily.date !== today) state.daily = { date: today, new: 0, reviews: 0 };
  }

  function noteReview(state, today, wasNew) {
    rollDay(state, today);
    state.daily.reviews += 1;
    if (wasNew) state.daily.new += 1;
    state.totals.reviews += 1;

    const h = state.history[today] || { reviews: 0, new: 0 };
    h.reviews += 1;
    if (wasNew) h.new += 1;
    state.history[today] = h;

    const st = state.streak;
    if (st.lastDay !== today) {
      st.current = st.lastDay && dayDiff(st.lastDay, today) === 1 ? st.current + 1 : 1;
      st.lastDay = today;
      st.best = Math.max(st.best || 0, st.current);
    }
  }

  // A streak stays alive on the day after the last study day; older than that
  // and it has been broken.
  function currentStreak(state, today) {
    const st = state.streak;
    if (!st.lastDay) return 0;
    const gap = dayDiff(st.lastDay, today);
    return gap === 0 || gap === 1 ? st.current : 0;
  }

  T2K.srs = {
    dayKey, dayDiff, addDays, fresh, review, nextInterval, intervalLabel,
    rollDay, noteReview, currentStreak,
    RATINGS: ['again', 'hard', 'good', 'easy'],
  };
})(window.T2K = window.T2K || {});
