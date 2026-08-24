/* Dutch flashcards — single-file vanilla JS.
   Reads window.DATA.words (built by extraction/build_data_js.py) and drills a
   random batch of vocabulary as tap-to-flip cards. No accounts, no backend. */

'use strict';

// ---------- tiny DOM helper ----------
const $ = (sel, root = document) => root.querySelector(sel);
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

// ---------- data ----------
// Flatten every wordlist into one pool. Skip a handful of malformed entries
// from the source extraction (Dutch/English landed in the wrong column).
const WORDS = Object.values(window.DATA.words || {})
  .flat()
  .filter(w => w && w.nl && w.en && w.nl.trim().length > 1 && w.en.trim().length > 1);

const COUNTS = [10, 20, 30, 40, 50];

// ---------- preferences (count + direction) remembered per browser ----------
const PREFS_KEY = 'dutch-flashcards';
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { count: COUNTS.includes(p.count) ? p.count : 20,
             dir: p.dir === 'en-nl' ? 'en-nl' : 'nl-en' };
  } catch (e) {
    return { count: 20, dir: 'nl-en' };
  }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
}
let prefs = loadPrefs();

// ---------- Dutch text-to-speech (uses the browser's built-in voices) ----------
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'nl-NL';
  u.rate = 0.9;
  const dutch = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('nl'));
  if (dutch) u.voice = dutch;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};

// Render a Dutch head word, colouring a leading article (de/het).
function dutchNode(w) {
  if (w.article) {
    const rest = w.nl.replace(new RegExp('^' + w.article + '\\s+', 'i'), '');
    return el('span', {}, [el('span', { class: 'article' }, w.article + ' '), rest]);
  }
  return el('span', {}, w.nl);
}

// ============================================================
// START SCREEN — pick how many words, and which way round
// ============================================================
function renderStart() {
  const main = $('#main');
  main.innerHTML = '';

  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, 'Flashcards'));
  card.append(el('p', { class: 'muted', style: { marginTop: '-4px' } },
    `${WORDS.length} words in the deck. Pick a random batch to review.`));

  // Direction toggle
  card.append(el('h3', {}, 'Direction'));
  const dirRow = el('div', { class: 'seg' });
  const dirs = [['nl-en', '🇳🇱 Dutch → English'], ['en-nl', '🇬🇧 English → Dutch']];
  dirs.forEach(([val, label]) => {
    dirRow.append(el('button', {
      class: 'seg-btn' + (prefs.dir === val ? ' on' : ''),
      onclick: () => { prefs.dir = val; savePrefs(prefs); renderStart(); },
    }, label));
  });
  card.append(dirRow);

  // Count picker — tapping a number starts the session
  card.append(el('h3', { style: { marginTop: '20px' } }, 'How many words?'));
  const countRow = el('div', { class: 'count-grid' });
  COUNTS.forEach(n => {
    const disabled = WORDS.length === 0;
    countRow.append(el('button', {
      class: 'count-btn' + (prefs.count === n ? ' on' : ''),
      disabled,
      onclick: () => { prefs.count = n; savePrefs(prefs); startSession(n); },
    }, String(n)));
  });
  card.append(countRow);
  card.append(el('p', { class: 'muted hint-line' }, 'Tap a number to begin.'));

  main.append(card);
}

// ============================================================
// SESSION — flip through a shuffled batch
// ============================================================
function startSession(n) {
  const cards = shuffle(WORDS).slice(0, Math.min(n, WORDS.length));
  runSession(cards);
}

function runSession(cards) {
  const main = $('#main');
  let i = 0;
  let flipped = false;

  const render = () => {
    main.innerHTML = '';
    const w = cards[i];

    // Progress
    const bar = el('div', { class: 'progress' }, [
      el('div', {}, `${i + 1} / ${cards.length}`),
      el('div', { class: 'bar' }, [el('div', { style: { width: (100 * (i + 1) / cards.length) + '%' } })]),
      el('button', { class: 'link-btn', onclick: renderStart }, 'Exit'),
    ]);
    main.append(bar);

    // Card
    const frontIsDutch = prefs.dir === 'nl-en';
    const card = el('div', { class: 'flashcard' });
    const fill = () => {
      card.innerHTML = '';
      const showDutch = flipped ? !frontIsDutch : frontIsDutch;
      card.append(el('div', { class: 'face' }, showDutch ? dutchNode(w) : el('span', {}, w.en)));
      card.append(el('div', { class: 'hint' }, flipped ? (w.source || ' ') : 'tap to flip'));
    };
    fill();
    card.addEventListener('click', () => { flipped = !flipped; fill(); });
    main.append(card);

    // Controls
    main.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', disabled: i === 0, onclick: prev }, '‹ Prev'),
      el('button', { class: 'btn secondary', onclick: () => { flipped = !flipped; fill(); } }, 'Flip'),
      el('button', { class: 'btn secondary', title: 'Hear it in Dutch', onclick: () => speak(w.nl) }, '🔊'),
      el('button', { class: 'btn', onclick: next }, i === cards.length - 1 ? 'Finish' : 'Next ›'),
    ]));
  };

  const prev = () => { if (i > 0) { i--; flipped = false; render(); } };
  const next = () => {
    if (i < cards.length - 1) { i++; flipped = false; render(); }
    else renderDone(cards.length);
  };

  // Keyboard: ← / → to move, space or Enter to flip
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') { prev(); }
    else if (e.key === 'ArrowRight') { next(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipped = !flipped; render(); }
  };
  document.addEventListener('keydown', onKey);
  // Detach the handler once we leave the session.
  const detach = new MutationObserver(() => {
    if (!$('.flashcard')) { document.removeEventListener('keydown', onKey); detach.disconnect(); }
  });
  detach.observe($('#main'), { childList: true });

  render();
}

function renderDone(total) {
  const main = $('#main');
  main.innerHTML = '';
  const card = el('div', { class: 'card done' });
  card.append(el('div', { class: 'done-check' }, '✓'));
  card.append(el('h2', {}, `Done — ${total} card${total === 1 ? '' : 's'}`));
  card.append(el('div', { class: 'btn-row', style: { justifyContent: 'center' } }, [
    el('button', { class: 'btn', onclick: () => startSession(prefs.count) }, '↻ Shuffle again'),
    el('button', { class: 'btn secondary', onclick: renderStart }, 'Change count'),
  ]));
  main.append(card);
}

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', renderStart);
