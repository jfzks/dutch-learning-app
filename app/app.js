/* Dutch learning tool — single-file vanilla JS app.
   Reads window.DATA (built by extraction/build_data_js.py) and renders drills. */

'use strict';

// ---------- utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, children = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) {}
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
};
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const normalize = (s) => (s || '').toLowerCase().normalize('NFC').replace(/[’']/g, "'").replace(/\s+/g, ' ').replace(/[.,!?;:]+\s*$/, '').trim();

// ---------- localStorage state ----------
const STORE_KEY = 'dutch-app-v1';
const defaultState = {
  srs: {},          // id -> { box: 0..5, last: ts, fails: 0 }
  recent_mistakes: [], // ids
  history: [],      // { ts, drill, correct, total }
  custom: { words: [], sentences: [], grammar: {} },
  prefs: { dir: 'nl-en', voice: '' },
  flags: [],        // see flagItem()
};
let state = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // shallow merge with defaults so older saved state still loads
      const merged = Object.assign({}, defaultState, parsed);
      if (!Array.isArray(merged.flags)) merged.flags = [];
      return merged;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(defaultState));
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// ---------- SRS ----------
// Simple Leitner: 6 boxes, intervals 0/1/2/4/8/16 days.
const BOX_INTERVAL_MS = [0, 1, 2, 4, 8, 16].map(d => d * 24 * 3600 * 1000);
function srsItem(id) {
  return state.srs[id] = state.srs[id] || { box: 0, last: 0, fails: 0 };
}
function srsRecord(id, correct) {
  const it = srsItem(id);
  it.last = Date.now();
  if (correct) {
    it.box = Math.min(5, it.box + 1);
  } else {
    it.box = Math.max(0, it.box - 1);
    it.fails = (it.fails || 0) + 1;
    state.recent_mistakes = [id, ...state.recent_mistakes.filter(x => x !== id)].slice(0, 200);
  }
  saveState();
}
function srsDue(id) {
  const it = state.srs[id];
  if (!it) return true;
  return Date.now() - it.last >= BOX_INTERVAL_MS[it.box];
}

// ---------- data access ----------
const DATA = window.DATA;

function allWords({ topics = null, includeCustom = true } = {}) {
  const out = [];
  for (const [topic, list] of Object.entries(DATA.words)) {
    if (topics && !topics.includes(topic)) continue;
    out.push(...list);
  }
  if (includeCustom) out.push(...(state.custom.words || []));
  return out;
}
function allVerbs() { return DATA.verbs.irregular || []; }
function allSentences({ tags = null, includeCustom = true } = {}) {
  let out = (DATA.sentences || []).slice();
  if (includeCustom) out = out.concat(state.custom.sentences || []);
  if (tags && tags.length) {
    const set = new Set(tags);
    out = out.filter(s => (s.tags || []).some(t => set.has(t)));
  }
  return out;
}
function grammarTopic(id) { return DATA.grammar[id] || null; }
function allGrammarTopics() { return Object.values(DATA.grammar); }

// ---------- verb gloss helper ----------
// Returns the English meaning for a Dutch infinitive.
// Priority: irregular.json 'en' field (base-verb meaning, e.g. "to go") first,
// then word-list verb entries as fallback (e.g. "lijkt (lijken) | seems / appears").
// Results are memoised; exposed on window so all drills share one cache.
const _verbGlossCache = {};
function glossForVerb(infinitive) {
  if (infinitive in _verbGlossCache) return _verbGlossCache[infinitive];
  const inf = (infinitive || '').toLowerCase();
  // 1. Check irregular verbs list (has base-verb English after recent update)
  for (const v of allVerbs()) {
    if (v.infinitive && v.infinitive.toLowerCase() === inf && v.en) {
      _verbGlossCache[infinitive] = v.en;
      return v.en;
    }
  }
  // 2. Fall back to word-list verb entries (conjugated-form translations)
  for (const w of allWords({ includeCustom: false })) {
    if (w.pos === 'verb' && w.infinitive && w.infinitive.toLowerCase() === inf && w.en) {
      _verbGlossCache[infinitive] = w.en;
      return w.en;
    }
  }
  _verbGlossCache[infinitive] = null;
  return null;
}
window.glossForVerb = glossForVerb;

// ---------- routing ----------
const routes = {};
function route(name, fn) { routes[name] = fn; }
function go(name, params = {}) {
  history.replaceState({ name, params }, '', '#' + name);
  $$('header nav button').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  const main = $('#main');
  main.innerHTML = '';
  (routes[name] || routes.home)(main, params);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => {
  const name = location.hash.replace(/^#/, '') || 'home';
  if (routes[name]) go(name);
});

// ============================================================
// HOME
// ============================================================
route('home', (main) => {
  // Mastery summary
  const total = Object.keys(state.srs).length;
  const mastered = Object.values(state.srs).filter(it => it.box >= 4).length;
  const today = new Date().toDateString();
  const sessionsToday = state.history.filter(h => new Date(h.ts).toDateString() === today).length;

  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Hallo! 🇳🇱'),
    el('p', { class: 'muted' }, `${total} items seen, ${mastered} mastered (box 4+). ${sessionsToday} sessions today.`),
  ]));

  // Drill picker
  const filterCard = el('div', { class: 'card' });
  filterCard.append(el('h2', {}, 'Pick a drill'));
  filterCard.append(el('h3', {}, 'Topics — wordlists'));
  filterCard.append(el('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 6px' } },
    'Filters: Flashcards, Translate (vocab part), De-het, Make a sentence. Leave empty for all.'));
  const wlRow = el('div', { class: 'row' });
  const wlSelected = new Set();
  for (const key of Object.keys(DATA.words).sort()) {
    const count = DATA.words[key].length;
    const c = el('span', { class: 'chip', onclick: () => { c.classList.toggle('on'); wlSelected.has(key) ? wlSelected.delete(key) : wlSelected.add(key); } }, `${key.replace('woordenlijst-', 'WL ')} (${count})`);
    wlRow.append(c);
  }
  filterCard.append(wlRow);

  filterCard.append(el('h3', { style: { marginTop: '16px' } }, 'Topics — grammar'));
  filterCard.append(el('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 6px' } },
    'Filters: Word-order, Cloze, Dictation, Translate (grammar examples). Leave empty for all.'));
  const grRow = el('div', { class: 'row' });
  const grSelected = new Set();
  for (const t of allGrammarTopics()) {
    const c = el('span', { class: 'chip', onclick: () => { c.classList.toggle('on'); grSelected.has(t.id) ? grSelected.delete(t.id) : grSelected.add(t.id); } }, t.title);
    grRow.append(c);
  }
  filterCard.append(grRow);

  main.append(filterCard);

  // Drill grid
  const drillCard = el('div', { class: 'card' });
  drillCard.append(el('h2', {}, 'Drills'));
  const grid = el('div', { class: 'drill-grid' });
  const drills = [
    { id: 'flashcards-nl-en', name: 'Flashcards NL→EN', desc: 'Tap to flip; rate yourself.' },
    { id: 'flashcards-en-nl', name: 'Flashcards EN→NL', desc: 'Tap to flip; rate yourself.' },
    { id: 'translate-en-nl', name: 'Translate EN→NL', desc: 'Type the Dutch translation.' },
    { id: 'translate-nl-en', name: 'Translate NL→EN', desc: 'Type the English translation.' },
    { id: 'de-het', name: 'De of het?', desc: 'Pick the right article.' },
    { id: 'conjugate', name: 'Verb forms', desc: 'Past + participle + aux for one verb at a time.' },
    { id: 'pingpong-perfectum', name: 'Pingpongen — perfectum', desc: 'Rewrite present in the perfect.' },
    { id: 'pingpong-imperfectum', name: 'Pingpongen — imperfectum', desc: 'Rewrite present in the simple past.' },
    { id: 'word-order', name: 'Word-order builder', desc: 'Drag tiles to form the sentence.' },
    { id: 'cloze', name: 'Cloze (invultekst)', desc: 'Fill in the missing word.' },
    { id: 'dictation', name: 'Dictation', desc: 'Listen, then type.' },
    { id: 'make-sentence', name: 'Make a sentence', desc: 'Use the given words in a sentence.' },
    { id: 'mixed', name: 'Mixed quiz', desc: 'A bit of everything.' },
    { id: 'review-mistakes', name: 'Review mistakes', desc: 'Items you recently got wrong.' },
  ];
  drills.forEach(d => {
    grid.append(el('div', { class: 'drill-card', onclick: () => go(d.id, { wl: [...wlSelected], gr: [...grSelected] }) }, [
      el('div', { class: 'name' }, d.name),
      el('div', { class: 'desc' }, d.desc),
    ]));
  });
  drillCard.append(grid);
  main.append(drillCard);

  // Mastery breakdown by topic
  const masteryCard = el('div', { class: 'card' });
  masteryCard.append(el('h2', {}, 'Mastery by wordlist'));
  for (const key of Object.keys(DATA.words).sort()) {
    const list = DATA.words[key];
    const seen = list.filter(w => state.srs[w.id]).length;
    const mas = list.filter(w => state.srs[w.id] && state.srs[w.id].box >= 4).length;
    const pct = list.length ? Math.round(100 * mas / list.length) : 0;
    const row = el('div', { style: { margin: '8px 0' } }, [
      el('div', { class: 'progress' }, [
        el('div', { style: { width: '120px' } }, key.replace('woordenlijst-', 'WL ')),
        el('div', { class: 'bar' }, [el('div', { style: { width: pct + '%' } })]),
        el('div', {}, `${mas}/${list.length} • seen ${seen}`),
      ]),
    ]);
    masteryCard.append(row);
  }
  main.append(masteryCard);
});

// ============================================================
// FLASHCARDS
// ============================================================
function flashcardSession(direction /* 'nl-en' or 'en-nl' */) {
  return (main, params) => {
    const pool = filterWords(params).filter(w => w.nl && w.en);
    if (!pool.length) return showEmpty(main);
    const cards = shuffle(pickDueFirst(pool, 'id', 30));
    runFlashcards(main, cards, direction);
  };
}
function pickDueFirst(items, idKey, n) {
  const due = items.filter(it => srsDue(it[idKey]));
  const rest = items.filter(it => !srsDue(it[idKey]));
  return shuffle(due).slice(0, n).concat(shuffle(rest).slice(0, Math.max(0, n - due.length)));
}
function runFlashcards(main, cards, direction) {
  let i = 0; let correct = 0;
  const nextCard = () => {
    if (i >= cards.length) return finishSession(main, 'flashcards-' + direction, correct, cards.length);
    const w = cards[i];
    const front = direction === 'nl-en' ? w.nl : w.en;
    const back  = direction === 'nl-en' ? w.en : w.nl;
    const article = w.article ? `${w.article} ` : '';
    const frontStr = direction === 'nl-en' ? (article + (w.nl.startsWith(article) ? w.nl.slice(article.length) : w.nl)) : front;
    main.innerHTML = '';
    setFlagContext({ drill: 'flashcards-' + direction, itemKind: 'word', itemId: w.id, snapshot: w });
    progressHeader(main, i, cards.length, correct);
    let flipped = false;
    const card = el('div', { class: 'flashcard' });
    const fill = () => {
      card.innerHTML = '';
      if (!flipped) {
        card.append(el('div', {}, direction === 'nl-en'
          ? (w.article ? el('span', {}, [el('span', { class: 'article' }, w.article + ' '), w.nl.replace(new RegExp('^' + w.article + ' ', 'i'), '')]) : w.nl)
          : w.en));
        card.append(el('div', { class: 'hint' }, 'tap to flip'));
      } else {
        card.append(el('div', {}, direction === 'nl-en' ? w.en : (w.article ? el('span', {}, [el('span', { class: 'article' }, w.article + ' '), w.nl.replace(new RegExp('^' + w.article + ' ', 'i'), '')]) : w.nl)));
        if (w.source) card.append(el('div', { class: 'hint' }, w.source));
      }
    };
    fill();
    card.addEventListener('click', () => { flipped = !flipped; fill(); });
    main.append(card);
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', onclick: () => { srsRecord(w.id, false); correct += 0; i++; nextCard(); } }, 'Again'),
      el('button', { class: 'btn secondary', onclick: () => { srsRecord(w.id, true); i++; nextCard(); } }, 'Hard'),
      el('button', { class: 'btn', onclick: () => { srsRecord(w.id, true); correct++; i++; nextCard(); } }, 'Got it'),
      el('button', { class: 'btn secondary', style:{ marginLeft: 'auto' }, onclick: () => speak(w.nl) }, '🔊'),
    ]));
  };
  nextCard();
}
route('flashcards-nl-en', flashcardSession('nl-en'));
route('flashcards-en-nl', flashcardSession('en-nl'));

// ============================================================
// TRANSLATE (typed)
// ============================================================
function translateSession(direction) {
  return (main, params) => {
    // Translate now mixes whole sentences (curated top-100 + grammar examples) with vocab words.
    // Sentences first so the user actually translates conversational phrases, not isolated words.
    const sentencePool = filterSentencesForTranslate(params);
    const wordPool = filterWords(params).filter(w => w.nl && w.en);
    const wordItems = shuffle(pickDueFirst(wordPool, 'id', 8)).map(w => ({ kind: 'word', item: w }));
    const sentenceItems = sentencePool.slice(0, 12).map(s => ({ kind: 'sentence', item: s }));
    const items = shuffle(sentenceItems.concat(wordItems));
    if (!items.length) return showEmpty(main);
    runTranslate(main, items, direction);
  };
}
function filterSentencesForTranslate(params) {
  // Pool = curated conversational sentences + grammar examples (both have NL+EN pairs).
  // If grammar topics are selected, restrict grammar examples to those; conversational
  // sentences are unaffected by topic chips (they're general-purpose).
  let pairs = [];
  for (const sc of (DATA.conversational || [])) {
    if (sc.nl && sc.en) pairs.push({ id: sc.id, nl: sc.nl, en: sc.en, tags: sc.tags || [], source: sc.source || 'Conversational' });
  }
  for (const t of allGrammarTopics()) {
    if (params.gr && params.gr.length && !params.gr.includes(t.id)) continue;
    for (const ex of (t.examples || [])) {
      if (ex.nl && ex.en) pairs.push({ id: 's_g_' + (ex.nl.length + ex.en.length) + '_' + ex.nl.slice(0,8), nl: ex.nl, en: ex.en, tags: ex.tags || [], source: t.title });
    }
  }
  return shuffle(pairs);
}
function runTranslate(main, items, direction) {
  let i = 0, correct = 0;
  const next = () => {
    if (i >= items.length) return finishSession(main, 'translate-' + direction, correct, items.length);
    const cur = items[i];
    const w = cur.item;
    const isSentence = cur.kind === 'sentence';
    const promptText = direction === 'en-nl' ? w.en : w.nl;
    const answerText = direction === 'en-nl' ? w.nl : w.en;
    main.innerHTML = '';
    setFlagContext({ drill: 'translate-' + direction, itemKind: isSentence ? 'sentence' : 'word', itemId: w.id, snapshot: w, grammarTopicId: w.grammarTopicId });
    progressHeader(main, i, items.length, correct);
    main.append(el('div', { class: 'prompt' }, [
      el('div', {}, promptText),
      el('small', {}, isSentence ? 'sentence' : 'word'),
    ]));
    const input = el('input', { type: 'text', autofocus: true, autocomplete: 'off', spellcheck: 'false' });
    main.append(input);
    const fb = el('div');
    main.append(fb);
    const submit = () => {
      const ans = input.value;
      const acceptable = expandAcceptable(answerText);
      const ok = acceptable.some(a => normalize(a) === normalize(ans));
      const close = !ok && acceptable.some(a => editDist(normalize(a), normalize(ans)) <= 2);
      srsRecord(w.id, ok);
      if (ok) correct++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok ? '✓ ' + answerText : (close ? `Almost — ${answerText}` : `Answer: ${answerText}`)));
      if (isSentence && w.tags && w.tags.length) {
        fb.append(el('div', { style: { marginTop: '6px' } }, w.tags.map(t => el('span', { class: 'tag' }, t))));
      }
      input.disabled = true;
      const nextBtn = el('button', { class: 'btn', onclick: () => { i++; next(); }, autofocus: true }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nextBtn]));
      setTimeout(() => nextBtn.focus(), 0);
    };
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: submit }, 'Check'),
      el('button', { class: 'btn secondary', onclick: () => { srsRecord(w.id, false); i++; next(); } }, 'Skip'),
    ]));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 0);
  };
  next();
}
function expandAcceptable(s) {
  // Split on " / " or "," and accept any.
  return s.split(/\s*\/\s*|,\s+/).map(x => x.trim()).filter(Boolean);
}
function editDist(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0)));
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}
route('translate-en-nl', translateSession('en-nl'));
route('translate-nl-en', translateSession('nl-en'));

// ============================================================
// DE / HET
// ============================================================
route('de-het', (main, params) => {
  const nouns = filterWords(params).filter(w => w.pos === 'noun' && (w.article === 'de' || w.article === 'het'));
  if (!nouns.length) return showEmpty(main);
  const cards = shuffle(pickDueFirst(nouns, 'id', 25));
  let i = 0, correct = 0;
  const next = () => {
    if (i >= cards.length) return finishSession(main, 'de-het', correct, cards.length);
    const w = cards[i];
    const noun = w.nl.replace(/^(de|het)\s+/i, '');
    main.innerHTML = '';
    setFlagContext({ drill: 'de-het', itemKind: 'word', itemId: w.id, snapshot: w });
    progressHeader(main, i, cards.length, correct);
    main.append(el('div', { class: 'prompt' }, [
      el('div', {}, '___ ' + noun),
      el('small', {}, w.en),
    ]));
    const fb = el('div');
    const choose = (choice) => {
      const ok = choice === w.article;
      srsRecord(w.id, ok);
      if (ok) correct++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok ? '✓ ' + w.article + ' ' + noun : `It's ${w.article} ${noun}`));
      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx]));
      setTimeout(() => nx.focus(), 0);
    };
    main.append(el('div', { class: 'btn-row', style: { justifyContent: 'center' } }, [
      el('button', { class: 'btn', onclick: () => choose('de') }, 'de'),
      el('button', { class: 'btn', onclick: () => choose('het') }, 'het'),
    ]));
    main.append(fb);
  };
  next();
});

// ============================================================
// CONJUGATE — one verb per card, asks for the three principal parts:
//   past_singular, past_participle, auxiliary (heb / ben / both).
// Variant tolerance: past_singular accepts any '/'-separated form
// (e.g. "wilde/wou"); auxiliary accepts whichever side(s) of "heb/ben" apply,
// and "both" is always accepted for verbs with two valid auxiliaries.
// ============================================================
function _auxCanonical(auxField) {
  // Returns "heb", "ben", or "both" for "heb", "ben", "heb/ben", "ben/heb".
  const s = (auxField || '').toLowerCase();
  if (s.includes('/')) return 'both';
  return s.includes('ben') ? 'ben' : 'heb';
}
function _pastAcceptable(pastField) {
  // Returns an array of acceptable past-singular forms.
  return (pastField || '').toLowerCase().split('/').map(s => s.trim()).filter(Boolean);
}
route('conjugate', (main, params) => {
  const verbs = allVerbs().filter(v => v.past_singular && v.participle && v.aux);
  if (!verbs.length) return showEmpty(main);
  // Show 12 cards per session — one verb each.
  const items = shuffle(verbs.slice()).slice(0, 12);
  let i = 0, correct = 0;
  const next = () => {
    if (i >= items.length) return finishSession(main, 'conjugate', correct, items.length);
    const v = items[i];
    const correctAux = _auxCanonical(v.aux);
    const correctPasts = _pastAcceptable(v.past_singular);
    const correctParticiple = normalize(v.participle);
    const meaning = glossForVerb(v.infinitive) || v.en || v.infinitive;

    main.innerHTML = '';
    setFlagContext({ drill: 'conjugate', itemKind: 'verb', itemId: v.id,
      snapshot: { ...v, expected: `${v.past_singular} / ${v.participle} / ${v.aux}` } });
    progressHeader(main, i, items.length, correct);

    // Big infinitive + meaning header
    main.append(el('div', { class: 'prompt' }, [
      el('div', { style: { fontSize: '22px', fontWeight: '600' } }, v.infinitive),
      el('small', {}, meaning),
    ]));

    // Past singular input
    const pastLabel = el('label', { style: { display: 'block', marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } },
      'Simple past  (ik / hij / zij ___ )');
    const pastInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    main.append(pastLabel);
    main.append(pastInput);

    // Past participle input
    const partLabel = el('label', { style: { display: 'block', marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } },
      'Past participle  (heb / ben ___ )');
    const partInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    main.append(partLabel);
    main.append(partInput);

    // Auxiliary chips
    const auxLabel = el('label', { style: { display: 'block', marginTop: '12px', fontSize: '13px', color: 'var(--muted)' } },
      'Auxiliary verb');
    main.append(auxLabel);
    let auxChoice = null;
    const auxRow = el('div', { class: 'row', style: { marginTop: '4px' } });
    const auxChips = {};
    ['heb', 'ben', 'both'].forEach(opt => {
      const chip = el('span', { class: 'chip', onclick: () => {
        auxChoice = opt;
        Object.values(auxChips).forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
      } }, opt);
      auxChips[opt] = chip;
      auxRow.append(chip);
    });
    main.append(auxRow);

    const fb = el('div');
    main.append(fb);

    const submit = () => {
      const pastAns = normalize(pastInput.value);
      const partAns = normalize(partInput.value);
      const pastOK = correctPasts.includes(pastAns);
      const partOK = partAns === correctParticiple;
      // Auxiliary matching: if correct is "both", any single value or "both" is acceptable.
      // If correct is "heb" or "ben", only that one (or "both", since "both" implies the user
      // knows it works) — but to be strict, require exact match.
      let auxOK = false;
      if (auxChoice) {
        if (correctAux === 'both') auxOK = true; // any selection accepts (user is on safe side)
        else auxOK = (auxChoice === correctAux);
      }

      const allOK = pastOK && partOK && auxOK;
      srsRecord('verb_' + v.infinitive + '_card', allOK);
      if (allOK) correct++;

      // Render per-part feedback
      fb.innerHTML = '';
      const lines = el('div', { class: 'feedback ' + (allOK ? 'good' : 'bad') });
      const mkLine = (label, ans, ok, expected) => {
        const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '2px 0' } }, [
          el('span', {}, label),
          el('span', { style: { fontFamily: 'monospace' } },
            ok ? `${ans} ✓` : `${ans || '—'} ✗ → ${expected}`),
        ]);
        lines.append(row);
      };
      mkLine('Past:', pastAns, pastOK, correctPasts.join(' / '));
      mkLine('Participle:', partAns, partOK, v.participle);
      mkLine('Auxiliary:', auxChoice || '—', auxOK, correctAux === 'both' ? 'heb / ben' : correctAux);
      fb.append(lines);

      // Extras: past plural + meaning recap
      const extras = el('div', { class: 'muted', style: { marginTop: '8px', fontSize: '13px', lineHeight: '1.5' } }, [
        v.past_plural ? el('div', {}, `Past plural (wij): ${v.past_plural}`) : null,
        el('div', {}, `${v.infinitive} — ${meaning}`),
      ].filter(Boolean));
      fb.append(extras);

      // Disable inputs and chips
      pastInput.disabled = true;
      partInput.disabled = true;
      Object.values(auxChips).forEach(c => c.style.pointerEvents = 'none');

      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx]));
      setTimeout(() => nx.focus(), 0);
    };

    // Enter on the past field → focus participle; enter on participle → submit
    pastInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); partInput.focus(); } });
    partInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    main.append(el('div', { class: 'btn-row', style: { marginTop: '12px' } },
      [el('button', { class: 'btn', onclick: submit }, 'Check')]));

    setTimeout(() => pastInput.focus(), 0);
  };
  next();
});

// ============================================================
// PINGPONG perfectum / imperfectum
// ============================================================
function pingpongSession(targetTense /* 'perfectum' | 'imperfectum' */) {
  return (main) => {
    const verbs = allVerbs().filter(v => v.participle && v.aux && v.past_singular);
    const persons = ['ik', 'hij', 'wij'];
    const items = [];
    for (let k = 0; k < 12; k++) {
      const v = pick(verbs);
      const p = pick(persons);
      // Build a tiny present-tense sentence: "<person> <inf-stem-ish>"
      // For simplicity: prompt asks user to write target tense from infinitive + person.
      let expected;
      if (targetTense === 'perfectum') {
        const auxForms = { ik: v.aux.includes('ben') ? 'ben' : 'heb', hij: v.aux.includes('ben') ? 'is' : 'heeft', wij: v.aux.includes('ben') ? 'zijn' : 'hebben' };
        expected = `${p} ${auxForms[p]} ${v.participle}`;
      } else {
        expected = `${p} ${p === 'wij' ? v.past_plural : v.past_singular}`;
      }
      items.push({ verb: v, person: p, expected });
    }
    let i = 0, correct = 0;
    const next = () => {
      if (i >= items.length) return finishSession(main, 'pingpong-' + targetTense, correct, items.length);
      const it = items[i];
      main.innerHTML = '';
      setFlagContext({ drill: 'pingpong-' + targetTense, itemKind: 'verb', itemId: it.verb.id, snapshot: { ...it.verb, expected: it.expected, person: it.person } });
      progressHeader(main, i, items.length, correct);
      main.append(el('div', { class: 'prompt' }, [
        el('div', {}, `Rewrite in ${targetTense}: ${it.person} ${it.verb.infinitive} (now)`),
        el('small', {}, it.verb.infinitive),
      ]));
      const input = el('input', { type: 'text', autofocus: true, autocomplete: 'off', spellcheck: 'false' });
      const fb = el('div');
      const submit = () => {
        const ok = normalize(input.value) === normalize(it.expected);
        srsRecord('verb_' + it.verb.infinitive + '_' + targetTense, ok);
        if (ok) correct++;
        fb.innerHTML = '';
        const _pg = glossForVerb(it.verb.infinitive);
        const _pgGloss = _pg ? ` — (${_pg})` : el('em', {}, ` — (${it.verb.infinitive})`);
        fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, [ok ? '✓ ' + it.expected : `Answer: ${it.expected}`, _pgGloss]));
        const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
        fb.append(el('div', { class: 'btn-row' }, [nx])); setTimeout(() => nx.focus(), 0);
        input.disabled = true;
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      main.append(input);
      main.append(el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: submit }, 'Check')]));
      main.append(fb);
      setTimeout(() => input.focus(), 0);
    };
    next();
  };
}
route('pingpong-perfectum', pingpongSession('perfectum'));
route('pingpong-imperfectum', pingpongSession('imperfectum'));

// ============================================================
// WORD ORDER builder
// ============================================================
route('word-order', (main, params) => {
  // Pull sentences from grammar examples (have NL+EN pairs) of decent length.
  let pool = [];
  for (const t of allGrammarTopics()) {
    if (params.gr && params.gr.length && !params.gr.includes(t.id)) continue;
    for (const ex of (t.examples || [])) {
      const wc = ex.nl.split(/\s+/).length;
      if (wc >= 4 && wc <= 12) pool.push({ ...ex, source: t.title });
    }
  }
  if (!pool.length) return showEmpty(main);
  pool = shuffle(pool);
  let i = 0, correct = 0;
  const next = () => {
    if (i >= pool.length || i >= 12) return finishSession(main, 'word-order', correct, Math.min(12, pool.length));
    const ex = pool[i];
    const tokens = ex.nl.replace(/[.?!]$/, '').split(/\s+/);
    const shuffled = shuffle(tokens.slice());
    main.innerHTML = '';
    setFlagContext({ drill: 'word-order', itemKind: 'grammar-example', itemId: 's_g_' + ex.nl.slice(0, 16), snapshot: { nl: ex.nl, en: ex.en, tags: ex.tags || [], source: ex.source } });
    progressHeader(main, i, Math.min(12, pool.length), correct);
    main.append(el('div', { class: 'prompt' }, [
      el('div', {}, ex.en),
      el('small', {}, (ex.tags || []).join(' • ')),
    ]));
    const drop = el('div', { class: 'dropzone' });
    const bank = el('div', { class: 'dropzone' });
    const placed = [];
    const renderBank = () => {
      bank.innerHTML = '';
      shuffled.forEach((tok, idx) => {
        if (placed.includes(idx)) return;
        const t = el('span', { class: 'tile', onclick: () => { placed.push(idx); drop.append(t); t.classList.add('placed'); t.onclick = () => { placed.splice(placed.indexOf(idx), 1); t.classList.remove('placed'); renderBank(); }; } }, tok);
        bank.append(t);
      });
    };
    renderBank();
    main.append(drop);
    main.append(el('h3', {}, 'Word bank'));
    main.append(bank);
    const fb = el('div');
    const check = () => {
      const built = placed.map(idx => shuffled[idx]).join(' ');
      const target = tokens.join(' ');
      const ok = normalize(built) === normalize(target);
      srsRecord('sentence_' + ex.nl, ok);
      if (ok) correct++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok ? '✓ ' + ex.nl : `Answer: ${ex.nl}`));
      if (ex.en) fb.append(el('div', { class: 'muted', style: { marginTop: '4px' } }, ex.en));
      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx])); setTimeout(() => nx.focus(), 0);
    };
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: check }, 'Check'),
      el('button', { class: 'btn secondary', onclick: () => { placed.length = 0; renderBank(); drop.innerHTML = ''; } }, 'Reset'),
    ]));
    main.append(fb);
  };
  next();
});

// ============================================================
// CLOZE — fill the missing word
// ============================================================
route('cloze', (main, params) => {
  // build clozes from grammar examples + sentences with verbs
  let pool = [];
  for (const t of allGrammarTopics()) {
    for (const ex of (t.examples || [])) {
      const words = ex.nl.split(/\s+/);
      if (words.length < 5) continue;
      // pick a content word to blank: prefer participle, modal, or a long word
      let idx = -1;
      for (let i = 0; i < words.length; i++) {
        const w = words[i].toLowerCase().replace(/[.,?!]/g, '');
        if (/^ge[a-z]+(t|d|en)$/.test(w) || /^(heb|heeft|hebben|ben|bent|is|zijn|kan|kunnen|wil|willen|moet|moeten|mag|mogen|zal|zullen)$/.test(w)) { idx = i; break; }
      }
      if (idx === -1) idx = Math.floor(words.length / 2);
      const target = words[idx].replace(/[.,?!]/g, '');
      const sentenceWithBlank = words.map((w, j) => j === idx ? '___' : w).join(' ');
      pool.push({ id: 'c_' + ex.nl.slice(0,30), prompt: sentenceWithBlank, answer: target, en: ex.en, full: ex.nl, tags: ex.tags || [] });
    }
  }
  pool = shuffle(pool).slice(0, 15);
  if (!pool.length) return showEmpty(main);
  let i = 0, correct = 0;
  const next = () => {
    if (i >= pool.length) return finishSession(main, 'cloze', correct, pool.length);
    const it = pool[i];
    main.innerHTML = '';
    setFlagContext({ drill: 'cloze', itemKind: 'grammar-example', itemId: it.id, snapshot: { nl: it.full, en: it.en, tags: it.tags } });
    progressHeader(main, i, pool.length, correct);
    main.append(el('div', { class: 'prompt' }, [
      el('div', {}, it.prompt),
      el('small', {}, it.en),
    ]));
    const input = el('input', { type: 'text', autofocus: true, autocomplete: 'off', spellcheck: 'false' });
    const fb = el('div');
    const submit = () => {
      const ok = normalize(input.value) === normalize(it.answer);
      srsRecord(it.id, ok);
      if (ok) correct++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok ? '✓ ' + it.full : `Answer: ${it.answer} → ${it.full}`));
      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx])); setTimeout(() => nx.focus(), 0);
      input.disabled = true;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    main.append(input);
    main.append(el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: submit }, 'Check')]));
    main.append(fb);
    setTimeout(() => input.focus(), 0);
  };
  next();
});

// ============================================================
// DICTATION
// ============================================================
route('dictation', (main, params) => {
  const sentences = filterSentencesForTranslate(params).slice(0, 12);
  if (!sentences.length) return showEmpty(main);
  let i = 0, correct = 0;
  const next = () => {
    if (i >= sentences.length) return finishSession(main, 'dictation', correct, sentences.length);
    const s = sentences[i];
    main.innerHTML = '';
    setFlagContext({ drill: 'dictation', itemKind: s.id?.startsWith('s_g_') ? 'grammar-example' : 'sentence', itemId: s.id, snapshot: s });
    progressHeader(main, i, sentences.length, correct);
    main.append(el('div', { class: 'prompt' }, [
      el('button', { class: 'btn', onclick: () => speak(s.nl) }, '🔊 Play'),
      el('small', {}, 'Type what you hear'),
    ]));
    const input = el('input', { type: 'text', autofocus: true, autocomplete: 'off', spellcheck: 'false' });
    const fb = el('div');
    const submit = () => {
      const ok = normalize(input.value) === normalize(s.nl);
      srsRecord('dict_' + s.id, ok); if (ok) correct++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok ? '✓ ' + s.nl : `Answer: ${s.nl}`));
      fb.append(el('div', { class: 'muted', style: { marginTop: '4px' } }, s.en));
      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx])); setTimeout(() => nx.focus(), 0);
      input.disabled = true;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    main.append(input);
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => speak(s.nl) }, 'Replay'),
      el('button', { class: 'btn', onclick: submit }, 'Check'),
    ]));
    main.append(fb);
    setTimeout(() => { speak(s.nl); input.focus(); }, 200);
  };
  next();
});

// ============================================================
// MAKE-A-SENTENCE — given words, write a sentence
// ============================================================
route('make-sentence', (main, params) => {
  const words = filterWords(params);
  if (words.length < 3) return showEmpty(main);
  // pick combinations
  const verbs = words.filter(w => w.pos === 'verb' || (w.infinitive));
  const otherWords = words.filter(w => w.pos !== 'verb');
  const timeExprs = ['vandaag', 'morgen', 'gisteren', 'volgende week', 'vorig jaar', 'vanavond', 'altijd', 'nooit'];
  const items = [];
  for (let k = 0; k < 8; k++) {
    const sel = [];
    if (verbs.length) sel.push(pick(verbs));
    while (sel.length < 2 && otherWords.length) {
      const w = pick(otherWords);
      if (!sel.includes(w)) sel.push(w);
    }
    sel.push({ nl: pick(timeExprs), en: '(time)', pos: 'time' });
    items.push(sel);
  }
  let i = 0, scored = 0;
  const next = () => {
    if (i >= items.length) return finishSession(main, 'make-sentence', scored, items.length);
    const sel = items[i];
    main.innerHTML = '';
    setFlagContext({ drill: 'make-sentence', itemKind: 'word', itemId: sel.map(w => w.id).filter(Boolean).join(','), snapshot: { words: sel.map(w => `${w.nl} (${w.en})`).join(', '), nl: sel.map(w => w.nl).join(' '), en: sel.map(w => w.en).join(' / ') } });
    progressHeader(main, i, items.length, scored);
    main.append(el('div', { class: 'prompt' }, [
      el('div', {}, sel.map(w => w.nl).join(' • ')),
      el('small', {}, sel.map(w => w.en || '').join(' / ')),
    ]));
    const ta = el('textarea', { rows: 3, autofocus: true, placeholder: 'Write a Dutch sentence using all the words…' });
    const fb = el('div');
    const check = () => {
      const sent = ta.value.toLowerCase();
      const missing = sel.filter(w => {
        const stems = (w.nl || '').toLowerCase().split(/\s+/).map(s => s.replace(/[.,?!]/g, '').replace(/^(de|het|een|zich)$/, ''));
        const stem = stems.find(s => s.length >= 3);
        return stem && !sent.includes(stem.slice(0, 4));
      });
      // crude V2 check: 2nd token is a verb-ish word (ends in -t, -en, or in known modals)
      const tokens = ta.value.replace(/[.,?!]/g, '').split(/\s+/).filter(Boolean);
      const v2ish = tokens.length >= 2 && /^(ben|bent|is|zijn|heb|hebt|heeft|hebben|kan|kunt|wil|wilt|moet|mag|zal|ga|gaat|spelen|gaat|loopt|werkt|woont|eet|drinkt|koopt|verkoopt|wordt|ziet|leest|schrijft|geeft|krijgt|maakt|leert|denkt|weet|vindt|begrijpt|spreekt|hoort|antwoordt|begint|stopt|opent|sluit|laat|brengt|haalt)$|t$|en$/.test(tokens[1]);
      const ok = missing.length === 0 && tokens.length >= 4;
      if (ok) scored++;
      fb.innerHTML = '';
      fb.append(el('div', { class: 'feedback ' + (ok ? 'good' : 'bad') }, ok
        ? '✓ Looks good! (heuristic check: all words used, length OK)'
        : (missing.length ? `Missing words: ${missing.map(w => w.nl).join(', ')}` : 'Try a longer sentence (≥ 4 words).')));
      if (!v2ish) fb.append(el('div', { class: 'muted', style: { marginTop: '4px' } }, 'Tip: in main clauses the verb should be in 2nd position.'));
      const nx = el('button', { class: 'btn', onclick: () => { i++; next(); } }, 'Next →');
      fb.append(el('div', { class: 'btn-row' }, [nx])); setTimeout(() => nx.focus(), 0);
    };
    main.append(ta);
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: check }, 'Check'),
      el('button', { class: 'btn secondary', onclick: () => { i++; next(); } }, 'Skip'),
    ]));
    main.append(fb);
  };
  next();
});

// ============================================================
// MIXED — random combination
// ============================================================
route('mixed', (main, params) => {
  const choices = ['flashcards-nl-en', 'translate-en-nl', 'translate-nl-en', 'de-het', 'conjugate', 'pingpong-perfectum', 'cloze', 'word-order'];
  const drill = pick(choices);
  go(drill, params);
});

// ============================================================
// REVIEW MISTAKES
// ============================================================
route('review-mistakes', (main) => {
  const ids = state.recent_mistakes.slice(0, 30);
  const wordsById = Object.fromEntries(allWords({}).map(w => [w.id, w]));
  const review = ids.map(id => wordsById[id]).filter(Boolean);
  if (!review.length) {
    main.append(el('div', { class: 'card' }, [el('h2', {}, 'Nothing to review!'), el('p', { class: 'muted' }, 'No recent mistakes — try a drill first.')]));
    return;
  }
  runFlashcards(main, review, 'nl-en');
});

// ============================================================
// FILTER helpers
// ============================================================
function filterWords(params) {
  if (params.wl && params.wl.length) return allWords({ topics: params.wl });
  return allWords({});
}

// ============================================================
// SESSION UI helpers
// ============================================================
// Drill-set flag context: drills call setFlagContext(...) before progressHeader.
let currentFlagContext = null;
function setFlagContext(ctx) { currentFlagContext = ctx; }

function progressHeader(main, i, total, correct) {
  main.append(el('div', { class: 'progress', style: { marginBottom: '12px' } }, [
    el('div', {}, `${i + 1} / ${total}`),
    el('div', { class: 'bar' }, [el('div', { style: { width: ((i / total) * 100) + '%' } })]),
    el('div', {}, `✓ ${correct}`),
    el('button', { class: 'btn secondary', style: { marginLeft: 'auto' }, title: 'Flag this item as incorrect', onclick: () => openFlagModal(currentFlagContext) }, '🚩 Flag'),
    el('button', { class: 'btn secondary', onclick: () => go('home') }, 'Quit'),
  ]));
}
function showEmpty(main) {
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'No matching items'),
    el('p', { class: 'muted' }, 'Try selecting more wordlists or grammar topics on the home page.'),
    el('button', { class: 'btn', onclick: () => go('home') }, 'Back'),
  ]));
}
function finishSession(main, drill, correct, total) {
  state.history.push({ ts: Date.now(), drill, correct, total });
  if (state.history.length > 200) state.history = state.history.slice(-200);
  saveState();
  const pct = total ? Math.round(100 * correct / total) : 0;
  main.innerHTML = '';
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Klaar! 🎉'),
    el('p', {}, `Score: ${correct} / ${total} (${pct}%)`),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => go(drill) }, 'Again'),
      el('button', { class: 'btn secondary', onclick: () => go('home') }, 'Home'),
      el('button', { class: 'btn secondary', onclick: () => go('review-mistakes') }, 'Review mistakes'),
    ]),
  ]));
}

// ============================================================
// SPEECH
// ============================================================
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'nl-NL';
  u.rate = 0.9;
  const voices = speechSynthesis.getVoices();
  const dutchVoice = voices.find(v => v.lang.startsWith('nl'));
  if (dutchVoice) u.voice = dutchVoice;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

// ============================================================
// GRAMMAR REFERENCE
// ============================================================
route('grammar', (main) => {
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Grammar reference'),
    el('p', { class: 'muted' }, 'Quick lookup of rules from your course materials.'),
  ]));
  for (const t of allGrammarTopics()) {
    const c = el('div', { class: 'card' });
    c.append(el('h2', {}, t.title));
    if (t.summary) c.append(el('p', {}, t.summary));
    if (t.rules) {
      const ul = el('ul');
      t.rules.forEach(r => ul.append(el('li', {}, r)));
      c.append(ul);
    }
    if (t.auxiliary_table) {
      const tbl = el('table', { class: 'simple' });
      tbl.append(el('tr', {}, [el('th', {}, ''), el('th', {}, 'hebben'), el('th', {}, 'zijn')]));
      for (const [p, forms] of Object.entries(t.auxiliary_table)) {
        tbl.append(el('tr', {}, [el('td', {}, p), el('td', {}, forms.hebben), el('td', {}, forms.zijn)]));
      }
      c.append(tbl);
    }
    if (t.conjugation_examples) {
      for (const [verb, persons] of Object.entries(t.conjugation_examples)) {
        c.append(el('h3', {}, verb));
        const tbl = el('table', { class: 'simple' });
        for (const [p, s] of Object.entries(persons)) tbl.append(el('tr', {}, [el('td', {}, p), el('td', {}, s)]));
        c.append(tbl);
      }
    }
    if (t.vocabulary) {
      const tbl = el('table', { class: 'simple' });
      t.vocabulary.forEach(v => tbl.append(el('tr', {}, [el('td', {}, v.nl), el('td', {}, v.en)])));
      c.append(tbl);
    }
    if (t.common_reflexive_verbs) {
      const tbl = el('table', { class: 'simple' });
      t.common_reflexive_verbs.forEach(v => tbl.append(el('tr', {}, [el('td', {}, v.infinitive), el('td', {}, v.en)])));
      c.append(tbl);
    }
    if (t.common_separable_verbs) {
      c.append(el('p', {}, t.common_separable_verbs.join(', ')));
    }
    if (t.examples) {
      c.append(el('details', {}, [
        el('summary', {}, `Examples (${t.examples.length})`),
        el('table', { class: 'simple' }, t.examples.map(ex => el('tr', {}, [el('td', {}, ex.nl), el('td', {}, ex.en), el('td', {}, (ex.tags || []).join(', '))]))),
      ]));
    }
    main.append(c);
  }
});

// ============================================================
// VERBS reference
// ============================================================
route('verbs', (main) => {
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Irregular verbs'),
    el('p', { class: 'muted' }, `${allVerbs().length} irregular verbs from the eDHfA1 list.`),
  ]));
  const card = el('div', { class: 'card' });
  const tbl = el('table', { class: 'simple' });
  tbl.append(el('tr', {}, ['Infinitief', 'Imperfectum (sg)', 'Imperfectum (pl)', 'Perfectum', 'Aux'].map(h => el('th', {}, h))));
  allVerbs().forEach(v => tbl.append(el('tr', {}, [el('td', {}, v.infinitive), el('td', {}, v.past_singular || '–'), el('td', {}, v.past_plural || '–'), el('td', {}, v.participle || '–'), el('td', {}, v.aux || '')])));
  card.append(tbl);
  main.append(card);
});

// ============================================================
// ADD CONTENT
// ============================================================
route('add', (main) => {
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Add content'),
    el('p', { class: 'muted' }, 'Items added here are stored in your browser and merged with the course materials.'),
  ]));

  // Add word
  const wc = el('div', { class: 'card' });
  wc.append(el('h2', {}, 'Add a word'));
  const wnl = el('input', { type: 'text', placeholder: 'Dutch (e.g. de fiets)' });
  const wen = el('input', { type: 'text', placeholder: 'English' });
  const wtopic = el('input', { type: 'text', placeholder: 'Topic / tag (optional)' });
  wc.append(wnl); wc.append(el('div', { style: { height: '6px' } }));
  wc.append(wen); wc.append(el('div', { style: { height: '6px' } }));
  wc.append(wtopic);
  const wfb = el('div', { class: 'muted', style: { marginTop: '6px' } });
  wc.append(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', onclick: () => {
      const nl = wnl.value.trim(), en = wen.value.trim();
      if (!nl || !en) { wfb.textContent = 'Both Dutch and English required.'; return; }
      const m = nl.match(/^(de|het)\s+(.+)$/i);
      const entry = { id: 'w_custom_' + Date.now(), nl, en, topic: wtopic.value.trim() || 'custom', source: 'user-added' };
      if (m) { entry.pos = 'noun'; entry.article = m[1].toLowerCase(); entry.lemma = m[2]; }
      state.custom.words.push(entry);
      saveState();
      wfb.textContent = `Added: ${nl} → ${en}`;
      wnl.value = ''; wen.value = '';
    } }, 'Add word'),
  ]));
  wc.append(wfb);
  main.append(wc);

  // Add sentence
  const sc = el('div', { class: 'card' });
  sc.append(el('h2', {}, 'Add a sentence'));
  const snl = el('input', { type: 'text', placeholder: 'Dutch sentence' });
  const sen = el('input', { type: 'text', placeholder: 'English translation (optional)' });
  const stags = el('input', { type: 'text', placeholder: 'Tags (comma-separated)' });
  sc.append(snl); sc.append(el('div', { style: { height: '6px' } }));
  sc.append(sen); sc.append(el('div', { style: { height: '6px' } }));
  sc.append(stags);
  const sfb = el('div', { class: 'muted', style: { marginTop: '6px' } });
  sc.append(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', onclick: () => {
      const nl = snl.value.trim();
      if (!nl) { sfb.textContent = 'Dutch required.'; return; }
      state.custom.sentences.push({ id: 's_custom_' + Date.now(), nl, en: sen.value.trim(), tags: stags.value.split(',').map(t => t.trim()).filter(Boolean), source: 'user-added' });
      saveState();
      sfb.textContent = 'Added.';
      snl.value = ''; sen.value = ''; stags.value = '';
    } }, 'Add sentence'),
  ]));
  sc.append(sfb);
  main.append(sc);

  // Custom items list
  const cust = el('div', { class: 'card' });
  cust.append(el('h2', {}, `Your custom items (${state.custom.words.length} words, ${state.custom.sentences.length} sentences)`));
  state.custom.words.slice(-10).reverse().forEach(w => cust.append(el('div', {}, [
    el('span', {}, `${w.nl} — ${w.en} `),
    el('span', { class: 'muted' }, `[${w.topic}]`),
    el('button', { class: 'btn secondary', style: { marginLeft: '8px', padding: '2px 8px' }, onclick: () => {
      state.custom.words = state.custom.words.filter(x => x.id !== w.id); saveState(); go('add');
    } }, '×'),
  ])));
  state.custom.sentences.slice(-10).reverse().forEach(s => cust.append(el('div', {}, [
    el('span', {}, `${s.nl} — ${s.en || ''} `),
    el('span', { class: 'muted' }, `[${(s.tags || []).join(', ')}]`),
    el('button', { class: 'btn secondary', style: { marginLeft: '8px', padding: '2px 8px' }, onclick: () => {
      state.custom.sentences = state.custom.sentences.filter(x => x.id !== s.id); saveState(); go('add');
    } }, '×'),
  ])));
  main.append(cust);
});

// ============================================================
// IMPORT / EXPORT
// ============================================================
route('settings', (main) => {
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Backup & restore'),
    el('p', { class: 'muted' }, 'Your progress and custom items live in this browser only. Export to back them up.'),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dutch-progress-' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
      } }, 'Export progress + custom'),
      (() => {
        const inp = el('input', { type: 'file', accept: 'application/json', style: { display: 'none' }, onchange: (e) => {
          const f = e.target.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try {
              const obj = JSON.parse(r.result);
              if (confirm('Replace all current progress and custom items?')) {
                state = Object.assign({}, defaultState, obj); saveState(); go('home');
              }
            } catch (err) { alert('Invalid JSON'); }
          };
          r.readAsText(f);
        }});
        const btn = el('button', { class: 'btn secondary', onclick: () => inp.click() }, 'Import');
        return el('span', {}, [btn, inp]);
      })(),
      el('button', { class: 'btn secondary', onclick: () => { if (confirm('Reset all progress? Custom content also goes away.')) { state = JSON.parse(JSON.stringify(defaultState)); saveState(); go('home'); } } }, 'Reset everything'),
    ]),
  ]));

  // History
  const last10 = state.history.slice(-10).reverse();
  const hc = el('div', { class: 'card' });
  hc.append(el('h2', {}, 'Recent sessions'));
  if (!last10.length) hc.append(el('p', { class: 'muted' }, 'None yet.'));
  else {
    const tbl = el('table', { class: 'simple' });
    tbl.append(el('tr', {}, ['When', 'Drill', 'Score'].map(h => el('th', {}, h))));
    last10.forEach(h => tbl.append(el('tr', {}, [
      el('td', {}, new Date(h.ts).toLocaleString()),
      el('td', {}, h.drill),
      el('td', {}, `${h.correct} / ${h.total}`),
    ])));
    hc.append(tbl);
  }
  main.append(hc);
});

// ============================================================
// FLAGS — modal, page, export, import-preview
// ============================================================
function genFlagId() {
  if (window.crypto && crypto.randomUUID) return 'f_' + crypto.randomUUID().slice(0, 8);
  return 'f_' + Math.random().toString(36).slice(2, 10);
}

function addFlag(flag) {
  state.flags.push(flag);
  saveState();
}

function fileForItem(ctx) {
  if (!ctx) return null;
  if (ctx.itemKind === 'word') {
    if (ctx.snapshot && ctx.snapshot.topic) return 'app/data/words/' + ctx.snapshot.topic + '.json';
    return 'app/data/words/_all.json';
  }
  if (ctx.itemKind === 'sentence') return 'app/data/sentences.json';
  if (ctx.itemKind === 'verb') return 'app/data/verbs/irregular.json';
  if (ctx.itemKind === 'grammar-example') return 'app/data/grammar/' + (ctx.grammarTopicId || 'unknown') + '.json';
  return null;
}

function openFlagModal(ctx) {
  if (!ctx) {
    alert('Nothing to flag here yet — wait until an item is shown.');
    return;
  }
  const overlay = el('div', { style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '50', padding: '20px' } });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const card = el('div', { class: 'card', style: { maxWidth: '520px', width: '100%', margin: '0', maxHeight: '90vh', overflow: 'auto' } });
  card.append(el('h2', {}, '🚩 Flag this item'));
  card.append(el('p', { class: 'muted', style: { marginTop: '0' } }, 'Send this to a backlog you can later feed into Claude for review.'));

  const snapBox = el('div', { style: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', fontSize: '13px', margin: '10px 0' } });
  snapBox.append(el('div', { class: 'muted', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em' } }, `${ctx.itemKind} · ${ctx.itemSource || ctx.snapshot?.source || ''}`));
  if (ctx.snapshot?.nl) snapBox.append(el('div', {}, ['NL: ', el('strong', {}, ctx.snapshot.nl)]));
  if (ctx.snapshot?.en) snapBox.append(el('div', {}, ['EN: ', el('strong', {}, ctx.snapshot.en)]));
  if (ctx.snapshot?.tags?.length) snapBox.append(el('div', { class: 'muted' }, 'tags: ' + ctx.snapshot.tags.join(', ')));
  card.append(snapBox);

  card.append(el('h3', {}, "What's wrong?"));
  const note = el('textarea', { rows: 3, placeholder: 'e.g. wrong translation, badly split, English instruction got captured as a sentence…' });
  card.append(note);

  card.append(el('h3', { style: { marginTop: '12px' } }, 'Suggested fix (optional)'));
  const sugNl = el('input', { type: 'text', placeholder: 'Corrected NL', value: ctx.snapshot?.nl || '' });
  const sugEn = el('input', { type: 'text', placeholder: 'Corrected EN', value: ctx.snapshot?.en || '' });
  card.append(sugNl); card.append(el('div', { style: { height: '6px' } }));
  card.append(sugEn);

  card.append(el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
    el('button', { class: 'btn', onclick: () => {
      const noteText = note.value.trim();
      if (!noteText) { note.focus(); note.style.borderColor = 'var(--bad)'; return; }
      const suggested = {};
      if (sugNl.value.trim() && sugNl.value.trim() !== (ctx.snapshot?.nl || '')) suggested.nl = sugNl.value.trim();
      if (sugEn.value.trim() && sugEn.value.trim() !== (ctx.snapshot?.en || '')) suggested.en = sugEn.value.trim();
      addFlag({
        id: genFlagId(),
        ts: Date.now(),
        drill: ctx.drill || (location.hash.replace(/^#/, '') || 'unknown'),
        itemKind: ctx.itemKind,
        itemId: ctx.itemId || null,
        itemSource: ctx.itemSource || ctx.snapshot?.source || '',
        file: fileForItem(ctx),
        snapshot: ctx.snapshot,
        note: noteText,
        suggested,
        status: 'open',
      });
      close();
      // tiny toast
      const toast = el('div', { style: { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: 'white', padding: '10px 16px', borderRadius: '8px', zIndex: '60', fontSize: '14px' } }, 'Flagged. See the Flags page to review.');
      document.body.append(toast);
      setTimeout(() => toast.remove(), 2000);
    } }, 'Save flag'),
    el('button', { class: 'btn secondary', onclick: close }, 'Cancel'),
  ]));

  overlay.append(card);
  document.body.append(overlay);
  setTimeout(() => note.focus(), 0);
}

route('flags', (main) => {
  const flags = state.flags || [];
  const counts = { open: 0, resolved: 0, dismissed: 0 };
  flags.forEach(f => counts[f.status] = (counts[f.status] || 0) + 1);

  main.append(el('div', { class: 'card' }, [
    el('h2', {}, '🚩 Flags'),
    el('p', { class: 'muted' }, `${counts.open || 0} open · ${counts.resolved || 0} resolved · ${counts.dismissed || 0} dismissed`),
    el('p', {}, 'Each flag captures an item you marked as incorrect. Export the open ones to send to Claude for review, then run the corrections script to apply fixes.'),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => exportFlagsForReview() }, '⇣ Export open flags for Claude'),
      (() => {
        const inp = el('input', { type: 'file', accept: 'application/json', style: { display: 'none' }, onchange: (e) => { if (e.target.files[0]) previewCorrections(e.target.files[0]); } });
        const btn = el('button', { class: 'btn secondary', onclick: () => inp.click() }, '⇡ Preview corrections.json');
        return el('span', {}, [btn, inp]);
      })(),
    ]),
  ]));

  // filter controls
  let filter = { kind: 'all', status: 'open' };
  const filterCard = el('div', { class: 'card' });
  filterCard.append(el('h3', {}, 'Filter'));
  const statusRow = el('div', { class: 'row' });
  ['open', 'resolved', 'dismissed', 'all'].forEach(s => {
    const c = el('span', { class: 'chip' + (s === filter.status ? ' on' : ''), onclick: () => { filter.status = s; render(); } }, s + (s !== 'all' ? ` (${counts[s] || 0})` : ` (${flags.length})`));
    statusRow.append(c);
  });
  filterCard.append(statusRow);
  main.append(filterCard);

  const listCard = el('div', { class: 'card' });
  main.append(listCard);

  const render = () => {
    // refresh chips
    Array.from(filterCard.querySelectorAll('.chip')).forEach(chip => {
      chip.classList.toggle('on', chip.textContent.startsWith(filter.status));
    });
    listCard.innerHTML = '';
    listCard.append(el('h3', {}, `${filter.status === 'all' ? 'All' : filter.status[0].toUpperCase() + filter.status.slice(1)} flags`));
    const matching = flags.filter(f => filter.status === 'all' || f.status === filter.status).sort((a, b) => b.ts - a.ts);
    if (!matching.length) { listCard.append(el('p', { class: 'muted' }, 'None.')); return; }
    matching.forEach(f => listCard.append(renderFlagRow(f, render)));
  };
  render();
});

function renderFlagRow(f, refresh) {
  const row = el('div', { style: { borderBottom: '1px solid var(--border)', padding: '10px 0' } });
  row.append(el('div', {}, [
    el('span', { class: 'tag' }, f.status),
    el('span', { class: 'tag' }, f.itemKind),
    el('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '8px' } }, new Date(f.ts).toLocaleString()),
    f.file ? el('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '8px' } }, f.file) : null,
  ]));
  if (f.snapshot?.nl) row.append(el('div', {}, [el('span', { class: 'muted' }, 'NL: '), f.snapshot.nl]));
  if (f.snapshot?.en) row.append(el('div', {}, [el('span', { class: 'muted' }, 'EN: '), f.snapshot.en]));
  row.append(el('div', { style: { marginTop: '4px' } }, [el('span', { class: 'muted' }, 'Note: '), f.note]));
  if (f.suggested?.nl || f.suggested?.en) {
    row.append(el('div', { style: { marginTop: '4px', color: 'var(--good)' } }, [
      el('span', { class: 'muted' }, 'Suggested → '),
      f.suggested.nl ? `NL: ${f.suggested.nl}  ` : '',
      f.suggested.en ? `EN: ${f.suggested.en}` : '',
    ]));
  }
  row.append(el('div', { class: 'btn-row', style: { marginTop: '6px' } }, [
    el('button', { class: 'btn secondary', onclick: () => editFlag(f, refresh) }, '✏️ Edit'),
    f.status !== 'resolved' ? el('button', { class: 'btn secondary', onclick: () => { f.status = 'resolved'; saveState(); refresh(); } }, '✓ Resolve') : null,
    f.status !== 'dismissed' ? el('button', { class: 'btn secondary', onclick: () => { f.status = 'dismissed'; saveState(); refresh(); } }, '✕ Dismiss') : null,
    f.status !== 'open' ? el('button', { class: 'btn secondary', onclick: () => { f.status = 'open'; saveState(); refresh(); } }, '↺ Reopen') : null,
    el('button', { class: 'btn secondary', onclick: () => { if (confirm('Delete this flag?')) { state.flags = state.flags.filter(x => x.id !== f.id); saveState(); refresh(); } } }, '🗑 Delete'),
  ]));
  return row;
}

function editFlag(f, refresh) {
  const newNote = prompt('Edit note:', f.note);
  if (newNote === null) return;
  f.note = newNote.trim();
  const newNl = prompt('Suggested NL (blank to clear):', f.suggested?.nl || '');
  if (newNl !== null) {
    f.suggested = f.suggested || {};
    if (newNl.trim()) f.suggested.nl = newNl.trim(); else delete f.suggested.nl;
  }
  const newEn = prompt('Suggested EN (blank to clear):', f.suggested?.en || '');
  if (newEn !== null) {
    f.suggested = f.suggested || {};
    if (newEn.trim()) f.suggested.en = newEn.trim(); else delete f.suggested.en;
  }
  saveState(); refresh();
}

function exportFlagsForReview() {
  const open = state.flags.filter(f => f.status === 'open');
  if (!open.length) { alert('No open flags to export.'); return; }
  const date = new Date().toISOString().slice(0, 10);
  const json = open.map(f => ({
    flagId: f.id,
    itemKind: f.itemKind,
    itemId: f.itemId,
    file: f.file,
    snapshot: f.snapshot,
    note: f.note,
    suggested: f.suggested || {},
  }));
  downloadBlob(`flags-${date}.json`, JSON.stringify(json, null, 2), 'application/json');

  const md = buildReviewMarkdown(json, date);
  downloadBlob(`flags-${date}.md`, md, 'text/markdown');
}

function buildReviewMarkdown(flags, date) {
  const out = [];
  out.push(`# Flag review — ${date}`);
  out.push('');
  out.push(`There are ${flags.length} open flags from a Dutch learning app. Each flag points at an entry in one of the JSON data files. The files and their shapes:`);
  out.push('');
  out.push('- `app/data/words/woordenlijst-N.json` — array of `{ id, nl, en, topic, source, pos, article?, lemma?, plural?, infinitive?, reflexive?, separable? }`');
  out.push('- `app/data/sentences.json` — array of `{ id, nl, tags, source }` (no English translation)');
  out.push('- `app/data/verbs/irregular.json` — array of `{ id, infinitive, past_singular, past_plural, participle, aux }`');
  out.push('- `app/data/grammar/<topic>.json` — `{ id, title, summary, rules, examples: [{ nl, en, tags }], … }`');
  out.push('');
  out.push('For each flag below, please:');
  out.push('');
  out.push('1. Verify the issue (the user\'s note may be wrong; cross-check against your knowledge of Dutch).');
  out.push('2. Decide whether to **replace**, **delete**, or **add** an entry, OR mark `noop` if no change is needed.');
  out.push('3. Emit a single `corrections.json` file at the end. Schema:');
  out.push('');
  out.push('```json');
  out.push('[');
  out.push('  {');
  out.push('    "flagId": "f_xxxxxxxx",');
  out.push('    "file": "app/data/words/woordenlijst-11.json",');
  out.push('    "action": "replace",            // "replace" | "delete" | "add" | "noop"');
  out.push('    "match": { "id": "w_..." },     // OR { "nl": "...", "en": "..." } — must match an existing entry exactly');
  out.push('    "replace": { "nl": "...", "en": "...", "article": "het" }, // for "replace": shallow-merged into the matched entry');
  out.push('    "entry": { ... },               // for "add": the full new entry');
  out.push('    "rationale": "Why this change is correct."');
  out.push('  }');
  out.push(']');
  out.push('```');
  out.push('');
  out.push('Match by `id` whenever possible. The applier refuses to apply a correction whose `match` does not match exactly, so reruns are safe.');
  out.push('');
  out.push('---');
  out.push('');
  flags.forEach((f, i) => {
    out.push(`## Flag ${i + 1} — \`${f.flagId}\``);
    out.push('');
    out.push(`- **File:** \`${f.file || '(unknown)'}\``);
    out.push(`- **Kind:** ${f.itemKind}`);
    if (f.itemId) out.push(`- **id:** \`${f.itemId}\``);
    out.push(`- **Snapshot:**`);
    out.push('  ```json');
    out.push('  ' + JSON.stringify(f.snapshot, null, 2).split('\n').join('\n  '));
    out.push('  ```');
    out.push(`- **Note:** ${f.note}`);
    if (f.suggested && (f.suggested.nl || f.suggested.en)) {
      out.push(`- **User-suggested fix:**`);
      if (f.suggested.nl) out.push(`  - NL → \`${f.suggested.nl}\``);
      if (f.suggested.en) out.push(`  - EN → \`${f.suggested.en}\``);
    }
    out.push('');
  });
  return out.join('\n');
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
}

function previewCorrections(file) {
  const r = new FileReader();
  r.onload = () => {
    let arr;
    try { arr = JSON.parse(r.result); } catch (e) { alert('Invalid JSON'); return; }
    if (!Array.isArray(arr)) { alert('corrections.json must be an array'); return; }
    showCorrectionsPreview(arr);
  };
  r.readAsText(file);
}

function showCorrectionsPreview(arr) {
  const main = $('#main');
  main.innerHTML = '';
  main.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Corrections preview'),
    el('p', { class: 'muted' }, `${arr.length} correction(s) loaded. The browser cannot write to disk — review below, then run the script command.`),
  ]));
  const byFile = {};
  arr.forEach(c => { (byFile[c.file] = byFile[c.file] || []).push(c); });
  for (const [file, cs] of Object.entries(byFile)) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', {}, file + `  (${cs.length})`));
    cs.forEach(c => {
      const row = el('div', { style: { borderBottom: '1px solid var(--border)', padding: '8px 0' } });
      row.append(el('div', {}, [el('span', { class: 'tag' }, c.action || 'replace'), c.flagId ? el('span', { class: 'muted', style: { marginLeft: '6px', fontSize: '12px' } }, c.flagId) : null]));
      row.append(el('div', {}, ['Match: ', el('code', {}, JSON.stringify(c.match || {}))]));
      if (c.action === 'replace') row.append(el('div', { style: { color: 'var(--good)' } }, ['Replace with: ', el('code', {}, JSON.stringify(c.replace))]));
      if (c.action === 'add') row.append(el('div', { style: { color: 'var(--good)' } }, ['Add entry: ', el('code', {}, JSON.stringify(c.entry))]));
      if (c.action === 'delete') row.append(el('div', { style: { color: 'var(--bad)' } }, 'Delete'));
      if (c.rationale) row.append(el('div', { class: 'muted' }, '— ' + c.rationale));
      card.append(row);
    });
    main.append(card);
  }
  main.append(el('div', { class: 'card' }, [
    el('h3', {}, 'Apply'),
    el('p', {}, 'Save the corrections.json somewhere on disk, then in your terminal:'),
    el('pre', { style: { background: 'var(--bg)', padding: '10px', borderRadius: '6px', fontSize: '13px', overflow: 'auto' } }, 'cd "Dutch - learnings"\npython3 extraction/apply_corrections.py path/to/corrections.json'),
    el('p', {}, "After it succeeds, click below to mark the matching flags as resolved. (Open flags whose flagId appears in the corrections file will move to 'resolved'.)"),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => {
        const ids = new Set(arr.map(c => c.flagId).filter(Boolean));
        let n = 0;
        for (const f of state.flags) if (ids.has(f.id) && f.status === 'open') { f.status = 'resolved'; n++; }
        saveState();
        alert(`Marked ${n} flag(s) as resolved.`);
        go('flags');
      } }, 'Mark these flags resolved'),
      el('button', { class: 'btn secondary', onclick: () => go('flags') }, 'Back'),
    ]),
  ]));
}

// ============================================================
// BOOT
// ============================================================
function boot() {
  const initial = location.hash.replace(/^#/, '') || 'home';
  go(routes[initial] ? initial : 'home');
}
document.addEventListener('DOMContentLoaded', boot);
