/* The study screen: builds the day's queue, shows one card at a time and
   hands each rating to the scheduler. */

'use strict';

(function (T2K) {
  const { store, srs, deck, speech } = T2K;
  const { $, el } = T2K.ui;

  const AGAIN_GAP = 5;        // how many cards later a lapsed card comes back

  const RATING_LABELS = {
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Easy',
  };

  let session = null;

  // ---------- queue ----------
  function buildQueue() {
    const today = srs.dayKey();
    const state = store.state;
    srs.rollDay(state, today);
    const cards = state.cards;

    const due = deck.words
      .filter(w => cards[w.rank] && cards[w.rank].due <= today)
      .sort((a, b) => {
        const ca = cards[a.rank], cb = cards[b.rank];
        if (ca.due !== cb.due) return ca.due < cb.due ? -1 : 1;   // oldest due first
        return a.rank - b.rank;
      });

    const cap = state.settings.maxReviews
      ? Math.max(0, state.settings.maxReviews - state.daily.reviews)
      : due.length;
    const reviews = due.slice(0, cap);

    const active = deck.activeBatches(state);
    const quota = Math.max(0, state.settings.newPerDay - state.daily.new);
    const fresh = deck.words
      .filter(w => !cards[w.rank] && active.includes(deck.batchNumberOf(w.rank)))
      .slice(0, quota);

    return reviews.map(w => ({ word: w, kind: 'review' }))
      .concat(fresh.map(w => ({ word: w, kind: 'new' })));
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
      block.append(el('div', { class: 'form-row' }, [
        el('div', { class: 'form-label' }, 'Plural'),
        el('div', { class: 'form-value' }, `de ${f.plural}`),
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
      el('span', { class: 'chip' }, item.kind === 'new' ? 'new word' : 'review'),
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
        const days = srs.nextInterval(state, rating);
        row.append(el('button', {
          class: 'rate-btn ' + rating,
          onclick: () => rate(rating),
        }, [
          el('span', { class: 'rate-label' }, RATING_LABELS[rating]),
          el('span', { class: 'rate-when' }, srs.intervalLabel(days)),
        ]));
      }
      main.append(row);
    }
  }

  function renderSummary(main) {
    document.body.classList.remove('studying');
    const s = T2K.ui.summary();
    const card = el('section', { class: 'card done' });
    card.append(el('div', { class: 'done-check' }, '✓'));
    card.append(el('h2', {}, 'Session finished'));
    card.append(el('p', { class: 'muted' },
      `${session.reviewed} card${session.reviewed === 1 ? '' : 's'} rated · ` +
      `${session.introduced} new word${session.introduced === 1 ? '' : 's'} introduced`));
    card.append(el('div', { class: 'tiles two' }, [
      T2K.ui.statTile(s.dueNow, 'still due'),
      T2K.ui.statTile(s.streak, 'day streak'),
    ]));
    const row = el('div', { class: 'btn-row center' });
    if (s.dueNow + s.newLeft > 0) {
      row.append(el('button', { class: 'btn', onclick: start }, 'Keep going'));
    }
    row.append(el('button', { class: 'btn secondary', onclick: exit }, 'Back to today'));
    card.append(row);
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
    srs.noteReview(store.state, today, wasNew);
    store.save();

    session.reviewed += 1;
    if (wasNew) session.introduced += 1;

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
    const queue = buildQueue();
    session = { queue, index: 0, flipped: false, reviewed: 0, introduced: 0 };
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    render();
  }

  T2K.study = { start, exit };
})(window.T2K = window.T2K || {});
