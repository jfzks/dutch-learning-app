/* The study screen: builds a session, shows one card at a time and hands each
   rating to the scheduler. */

'use strict';

(function (T2K) {
  const { store, srs, deck, speech } = T2K;
  const { $, el } = T2K.ui;

  const AGAIN_GAP = 5;        // how many cards later a lapsed card comes back

  const RATING_LABELS = {
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Know it',
  };

  const KIND_LABELS = {
    new: 'new word',
    hard: 'hard word',
    review: 'review',
  };

  let session = null;

  // ---------- what goes into a session ----------
  function sessionSize() {
    const n = store.state.settings.sessionSize;
    return typeof n === 'number' && n > 0 ? n : 20;
  }

  // Words still being learned: started, and not retired with "Know it".
  function isLearning(card) {
    return !!card && !card.known;
  }

  // The words that have fought back most: worst difficulty first, then the
  // lowest easiness factor as the tie-break. Known words never count.
  function hardWords() {
    const cards = store.state.cards;
    return deck.words
      .filter(w => isLearning(cards[w.rank]) && srs.difficulty(cards[w.rank]) > 0)
      .sort((a, b) => {
        const da = srs.difficulty(cards[a.rank]), db = srs.difficulty(cards[b.rank]);
        if (da !== db) return db - da;
        return (cards[a.rank].ef || 2.5) - (cards[b.rank].ef || 2.5);
      });
  }

  function knownWords() {
    const cards = store.state.cards;
    return deck.words.filter(w => cards[w.rank] && cards[w.rank].known);
  }

  // Which words a session of `size` cards would hold. New words come in
  // frequency order and get at least half the session while there are any;
  // the rest goes to hard words (any you haven't seen today first), then to
  // words the schedule says are due again. If one kind runs short, the other
  // fills the gap.
  function plan(size) {
    const today = srs.dayKey();
    const cards = store.state.cards;
    const fresh = deck.words.filter(w => !cards[w.rank]);

    const seenToday = (w) => (cards[w.rank].last === today ? 1 : 0);
    const hard = hardWords().sort((a, b) => seenToday(a) - seenToday(b));   // stable
    const isHard = new Set(hard.map(w => w.rank));
    const due = deck.words
      .filter(w => isLearning(cards[w.rank]) && cards[w.rank].due <= today && !isHard.has(w.rank))
      .sort((a, b) => {
        const ca = cards[a.rank], cb = cards[b.rank];
        if (ca.due !== cb.due) return ca.due < cb.due ? -1 : 1;     // most overdue first
        return a.rank - b.rank;
      });

    const pool = hard.concat(due);
    let newCount = Math.min(fresh.length, Math.max(Math.ceil(size / 2), size - pool.length));
    const reviewCount = Math.min(pool.length, size - newCount);
    newCount = Math.min(fresh.length, size - reviewCount);
    const reviews = pool.slice(0, reviewCount);

    return {
      fresh: fresh.slice(0, newCount),
      hard: reviews.filter(w => isHard.has(w.rank)),
      due: reviews.filter(w => !isHard.has(w.rank)),
      total: newCount + reviewCount,
    };
  }

  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The plan as a queue: reviews shuffled, new words spread evenly through
  // them in frequency order, so a session isn't all-new at the end.
  function buildQueue() {
    const p = plan(sessionSize());
    const reviews = shuffled(
      p.hard.map(w => ({ word: w, kind: 'hard' })).concat(p.due.map(w => ({ word: w, kind: 'review' }))));
    const fresh = p.fresh.map(w => ({ word: w, kind: 'new' }));
    const newTotal = fresh.length;
    const queue = [];
    let placed = 0;
    for (let i = 0; i < p.total; i++) {
      // By card i, about (i+1)/total of the new words should have appeared.
      const takeNew = placed < Math.round((i + 1) * newTotal / p.total);
      const item = takeNew ? fresh.shift() : reviews.shift() || fresh.shift();
      if (item.kind === 'new') placed++;
      queue.push(item);
    }
    return queue;
  }

  function directionFor(item) {
    if (item.dir) return item.dir;
    const setting = store.state.settings.direction;
    item.dir = setting === 'mixed' ? (Math.random() < 0.5 ? 'nl-en' : 'en-nl') : setting;
    return item.dir;
  }

  // ---------- pieces of a card ----------
  function dutchHead(word) {
    if (word.type === 'noun' && word.forms && word.forms.article) {
      return el('span', {}, [
        el('span', { class: 'article' }, word.forms.article + ' '),
        word.dutch,
      ]);
    }
    return el('span', {}, word.dutch);
  }

  // Speaker buttons swallow the click so they never flip the card. The one for
  // the head word sits in the card's corner, well away from the middle, so a
  // tap anywhere on the card itself still turns it over.
  function speakerButton(text, label, extraClass) {
    if (!speech.supported) return null;
    return el('button', {
      class: 'speak-btn' + (extraClass ? ' ' + extraClass : ''),
      'aria-label': label,
      title: label,
      onclick: (e) => { e.stopPropagation(); speech.speak(text, store.state.settings); },
    }, '🔊');
  }

  function formsBlock(word) {
    const f = word.forms;
    if (!f) return null;
    const block = el('div', { class: 'forms' });

    if (word.type === 'verb') {
      const p = f.present || {};
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Present'),
        el('div', { class: 'form-value' }, [
          el('span', {}, `ik ${p.ik}`), el('span', { class: 'sep' }, '·'),
          el('span', {}, `jij ${p.jij}`), el('span', { class: 'sep' }, '·'),
          el('span', {}, `hij/zij ${p.hij}`), el('span', { class: 'sep' }, '·'),
          el('span', {}, `wij ${p.wij}`),
        ]),
      ]));
      const past = f.past || {};
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Past'),
        el('div', { class: 'form-value' }, [
          el('span', {}, `${past.singular} (sing.)`), el('span', { class: 'sep' }, '·'),
          el('span', {}, `${past.plural} (plur.)`),
        ]),
      ]));
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Perfect'),
        el('div', { class: 'form-value' }, f.perfect || '— (no perfect tense)'),
      ]));
    } else if (word.type === 'noun') {
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Article'),
        el('div', { class: 'form-value' }, [el('span', { class: 'article' }, f.article), ' ' + word.dutch]),
      ]));
      // Uncountable nouns carry "—" as their plural in the data.
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Plural'),
        el('div', { class: 'form-value' },
          f.plural === '—' ? el('span', { class: 'muted' }, 'no plural (uncountable)') : `de ${f.plural}`),
      ]));
    } else if (word.type === 'adjective') {
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Inflected'),
        el('div', { class: 'form-value' }, f.inflected),
      ]));
      if (f.examples && f.examples.length) {
        block.append(el('div', { class: 'form-row' }, [
          el('div', { class: 'form-label' }, 'Use'),
          el('div', { class: 'form-value' }, f.examples.join('  /  ')),
        ]));
      }
    }
    return block.children.length ? block : null;
  }

  function exampleBlock(word) {
    return el('div', { class: 'example' }, [
      el('div', { class: 'example-nl' }, [
        el('span', {}, word.example.nl),
        speakerButton(word.example.nl, 'Hear the sentence'),
      ]),
      el('div', { class: 'example-en muted' }, word.example.en),
    ]);
  }

  // ---------- rendering ----------
  function render() {
    const main = $('#main');
    main.innerHTML = '';
    document.body.classList.add('studying');

    if (!session || session.index >= session.queue.length) return renderSummary(main);

    const item = session.queue[session.index];
    const word = item.word;
    const dir = directionFor(item);
    const showDutchFirst = dir === 'nl-en';
    const left = session.queue.length - session.index;
    const doneFraction = session.queue.length ? session.index / session.queue.length : 0;

    // Top bar: how much is left, and a way out.
    main.append(el('div', { class: 'study-top' }, [
      el('button', { class: 'icon-btn', 'aria-label': 'End session', onclick: exit }, '✕'),
      el('div', { class: 'meter-track slim' }, [
        el('div', { class: 'meter-fill', style: { width: (doneFraction * 100) + '%' } }),
      ]),
      el('div', { class: 'count-left' }, `${left} left`),
    ]));

    const card = el('div', {
      class: 'flashcard' + (session.flipped ? ' flipped' : ''),
      role: 'button',
      tabindex: '0',
      'aria-label': 'Flashcard — activate to flip',
      onclick: flip,
    });

    // Prompt side — stays visible after the flip so both languages are together.
    const prompt = el('div', { class: 'prompt' });
    prompt.append(el('div', { class: 'chips' }, [
      el('span', { class: 'chip' }, KIND_LABELS[item.kind] || 'review'),
      el('span', { class: 'chip soft' }, word.type),
      el('span', { class: 'chip soft' }, '#' + word.rank),
    ]));
    prompt.append(el('div', { class: 'face' }, [
      showDutchFirst ? dutchHead(word) : el('span', {}, word.english),
    ]));
    card.append(prompt);

    // The Dutch is only speakable once it's on screen: in English → Dutch mode
    // that's after the flip, so the answer isn't given away.
    if (showDutchFirst || session.flipped) {
      card.append(speakerButton(T2K.headword(word), 'Hear the Dutch word', 'corner'));
    }

    if (!session.flipped) {
      card.append(el('div', { class: 'hint' }, 'tap to flip'));
    } else {
      const back = el('div', { class: 'answer' });
      back.append(el('div', { class: 'face answer-face' }, [
        showDutchFirst ? el('span', {}, word.english) : dutchHead(word),
      ]));
      const forms = formsBlock(word);
      if (forms) back.append(forms);
      if (word.note) back.append(el('div', { class: 'note' }, word.note));
      back.append(exampleBlock(word));
      card.append(back);
    }
    main.append(card);

    // Controls
    if (!session.flipped) {
      main.append(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn big', onclick: flip }, 'Show answer'),
      ]));
    } else {
      const state = store.state.cards[word.rank] || null;
      const row = el('div', { class: 'rate-row' });
      for (const rating of srs.RATINGS) {
        row.append(el('button', {
          class: 'rate-btn ' + rating,
          onclick: () => rate(rating),
        }, [
          el('span', { class: 'rate-label' }, RATING_LABELS[rating]),
          el('span', { class: 'rate-when' },
            rating === 'easy' ? 'retire' : srs.intervalLabel(srs.nextInterval(state, rating))),
        ]));
      }
      main.append(row);
    }
  }

  function renderSummary(main) {
    document.body.classList.remove('studying');
    if (T2K.sync) T2K.sync.flush();          // the session's ratings go up now
    const s = T2K.ui.summary();
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const card = el('section', { class: 'card done' });
    card.append(el('div', { class: 'done-check' }, '✓'));
    card.append(el('h2', {}, 'Session finished'));
    card.append(el('p', { class: 'muted' }, [
      `${plural(session.reviewed, 'card')} · ${plural(session.introduced, 'new word')}`,
      session.known ? ` · ${session.known} now known` : '',
    ].join('')));
    card.append(el('div', { class: 'tiles two' }, [
      T2K.ui.statTile(s.known, 'words known'),
      T2K.ui.statTile(s.streak, 'day streak'),
    ]));
    const next = plan(sessionSize()).total;
    card.append(el('div', { class: 'btn-row center' }, [
      next ? el('button', { class: 'btn', onclick: () => start() }, `Another ${next}`) : null,
      el('button', { class: 'btn secondary', onclick: exit }, 'Back to today'),
    ]));
    main.append(card);
  }

  // ---------- actions ----------
  function flip() {
    if (!session || session.flipped) return;
    session.flipped = true;
    render();
    const word = session.queue[session.index].word;
    if (store.state.settings.autoSpeak) speech.speak(T2K.headword(word), store.state.settings);
  }

  function rate(rating) {
    if (!session || !session.flipped) return;
    const item = session.queue[session.index];
    const today = srs.dayKey();
    const rank = item.word.rank;
    const wasNew = !store.state.cards[rank];

    store.state.cards[rank] = srs.review(store.state.cards[rank], rating, today);
    srs.noteReview(store.state, today, wasNew, { rank, dutch: item.word.dutch, rating });
    store.save();

    session.reviewed += 1;
    if (wasNew) session.introduced += 1;

    // A mis-tap on "Know it" would retire a word for good; offer it back.
    if (rating === 'easy') {
      session.known += 1;
      const word = item.word;
      T2K.ui.toast(`“${T2K.headword(word)}” marked as known.`, {
        label: 'Undo',
        onclick: () => {
          store.state.cards[rank] = srs.restore(store.state.cards[rank], srs.dayKey());
          store.save();
          if (session) session.known = Math.max(0, session.known - 1);
          T2K.ui.toast(`“${T2K.headword(word)}” stays in practice.`);
        },
      });
    }

    // 'Again' puts the card back into the queue a few cards later.
    if (rating === 'again') {
      const at = Math.min(session.queue.length, session.index + 1 + AGAIN_GAP);
      session.queue.splice(at, 0, { word: item.word, kind: 'review', dir: item.dir });
    }

    session.index += 1;
    session.flipped = false;
    speech.stop();
    render();
  }

  function exit() {
    session = null;
    speech.stop();
    if (T2K.sync) T2K.sync.flush();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('studying');
    T2K.ui.go('today');
  }

  function onKey(e) {
    if (!session) return;
    if (e.key === 'Escape') { exit(); return; }
    if (session.index >= session.queue.length) return;   // on the summary screen
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!session.flipped) flip();
      else rate('good');
      return;
    }
    if (session.flipped && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      rate(srs.RATINGS[Number(e.key) - 1]);
    }
  }

  function start() {
    session = { queue: buildQueue(), index: 0, flipped: false, reviewed: 0, introduced: 0, known: 0 };
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    render();
  }

  // True from the first card to leaving the summary — sync doesn't redraw the
  // screen under you meanwhile; going back to Today shows anything it merged.
  function active() {
    return !!session;
  }

  T2K.study = { start, exit, active, plan, sessionSize, hardWords, knownWords };
})(window.T2K = window.T2K || {});
