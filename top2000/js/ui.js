/* Shell, navigation and the Today / Stats / Settings screens.
   The study screen lives in study.js. */

'use strict';

(function (T2K) {
  const { store, srs, deck, speech } = T2K;

  // ---------- tiny DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  };

  function toast(message) {
    const old = $('#toast');
    if (old) old.remove();
    const t = el('div', { id: 'toast', role: 'status' }, message);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  // ---------- counts shared by Today and Stats ----------
  function summary() {
    const today = srs.dayKey();
    const state = store.state;
    const cards = state.cards;
    let introduced = 0, learning = 0, learned = 0, due = 0;

    for (const w of deck.words) {
      const c = cards[w.rank];
      if (!c) continue;
      introduced++;
      if (c.ivl >= 1) learned++; else learning++;
      if (c.due <= today) due++;
    }

    const active = deck.activeBatches(state);
    const newAvailable = deck.words.filter(
      w => !cards[w.rank] && active.includes(deck.batchNumberOf(w.rank))
    ).length;

    srs.rollDay(state, today);
    const newLeft = Math.min(newAvailable, Math.max(0, state.settings.newPerDay - state.daily.new));
    const reviewCap = state.settings.maxReviews
      ? Math.max(0, state.settings.maxReviews - state.daily.reviews)
      : Infinity;

    return {
      today, introduced, learning, learned,
      due, dueNow: Math.min(due, reviewCap),
      newAvailable, newLeft,
      loaded: deck.words.length,
      streak: srs.currentStreak(state, today),
      best: state.streak.best || 0,
      reviewsToday: state.daily.reviews,
      totalReviews: state.totals.reviews,
    };
  }

  function progressBar(fraction, label) {
    const pct = Math.max(0, Math.min(100, fraction * 100));
    return el('div', { class: 'meter' }, [
      el('div', { class: 'meter-track' }, [el('div', { class: 'meter-fill', style: { width: pct + '%' } })]),
      label ? el('div', { class: 'meter-label' }, label) : null,
    ]);
  }

  function statTile(value, label, tone) {
    return el('div', { class: 'tile' + (tone ? ' ' + tone : '') }, [
      el('div', { class: 'tile-value' }, String(value)),
      el('div', { class: 'tile-label' }, label),
    ]);
  }

  function optionButton(label, sub, onclick) {
    return el('button', { class: 'option-btn', onclick }, [
      el('span', { class: 'option-label' }, label),
      el('span', { class: 'option-sub' }, sub),
    ]);
  }

  // Open every batch up to n, and make n the one new words come from. The
  // automatic rule only ever opens the next batch once the current one has been
  // started; this is the deliberate "I'm moving on now" override.
  function unlockThrough(n, pin) {
    const st = store.state.settings;
    st.unlockedThrough = Math.max(st.unlockedThrough || 0, n);
    if (pin !== false) st.batches = [n];
    store.save();
  }

  // The batch to offer next: the one after whatever is currently feeding new
  // words — the manual pick if there is one, otherwise where the frequency
  // order has reached.
  function nextBatchToOpen(state) {
    if (deck.batches.length < 2) return null;
    const chosen = state.settings.batches;
    const base = chosen && chosen.length
      ? Math.max(...chosen)
      : currentBatchNumber(state);
    // Only offer the jump once the current batch is under way, so a brand-new
    // deck isn't inviting you to skip ahead before card one.
    const current = deck.batchByNumber(base);
    if (!current || !current.words.some(w => state.cards[w.rank])) return null;
    return deck.batchByNumber(base + 1);
  }

  // The ways to carry on once the day's reviews and new words are done. Shared
  // by the Today screen and the end-of-session summary.
  function extraOptions() {
    const avail = T2K.study.availability();
    const out = [];

    const next = nextBatchToOpen(store.state);
    if (next) {
      const take = Math.min(avail.size, next.words.length);
      out.push(optionButton(
        `Start batch ${next.batch} now`,
        `Opens words ${next.range[0]}–${next.range[1]} and starts ${take} of them. ` +
        'Everything you’ve started still comes back for review.',
        () => {
          unlockThrough(next.batch);
          toast(`Batch ${next.batch} unlocked — new words now come from ${next.range[0]}–${next.range[1]}.`);
          if (T2K.study.availability().extraNew > 0) T2K.study.start('extra-new');
          else refresh();
        }));
    }
    if (avail.extraNew > 0) {
      out.push(optionButton(
        `+ ${avail.extraNew} new word${avail.extraNew === 1 ? '' : 's'}`,
        'Tomorrow’s words, today. Scheduled as normal.',
        () => T2K.study.start('extra-new')));
    }
    if (avail.hard > 0) {
      out.push(optionButton(
        `Drill ${avail.hard} hard words`,
        'The ones you rated Again or Hard, shuffled. Rated and rescheduled as normal.',
        () => T2K.study.start('hard')));
    }
    if (avail.ahead > 0) {
      out.push(optionButton(
        `Review ${avail.ahead} ahead`,
        'Cards due soon, pulled forward. Each one reschedules from today.',
        () => T2K.study.start('ahead')));
    }
    if (avail.practice > 0) {
      out.push(optionButton(
        `Practice ${avail.practice} words`,
        'A shuffled look at words you’ve started. Nothing is scored.',
        () => T2K.study.start('practice')));
    }
    return out;
  }

  // The whole "keep going" block: a size slider over the options, which relabel
  // themselves as it moves. Used by Today and by the end-of-session summary.
  function fillExtras(container) {
    const st = store.state.settings;
    const readout = el('div', { class: 'size-value' }, `${st.extraSize} cards`);
    const list = el('div', { class: 'extras-list' });

    const draw = () => {
      list.innerHTML = '';
      for (const option of extraOptions()) list.append(option);
    };

    const slider = el('input', {
      type: 'range', min: '10', max: '100', step: '10', value: String(st.extraSize),
      class: 'size-slider', 'aria-label': 'Cards in a keep-going run',
      oninput: (e) => {
        st.extraSize = Number(e.target.value);
        readout.textContent = `${st.extraSize} cards`;
        draw();
      },
      onchange: () => store.save(),          // save once the drag ends
    });

    container.append(el('div', { class: 'size-row' }, [slider, readout]));
    draw();
    container.append(list);
  }

  // ---------- Today ----------
  function renderToday(main) {
    const s = summary();

    if (!store.available) {
      main.append(el('div', { class: 'banner' }, [
        el('strong', {}, 'Progress can’t be saved in this browser. '),
        'Private mode or blocked storage — the session works, but export before you close the tab.',
      ]));
    }
    main.append(syncBanner() || el('div', { id: 'sync-banner' }));

    const card = el('section', { class: 'card' });
    card.append(el('h2', {}, 'Today'));

    const counts = el('div', { class: 'tiles two' }, [
      statTile(s.dueNow, s.dueNow === 1 ? 'review due' : 'reviews due'),
      statTile(s.newLeft, 'new words'),
    ]);
    card.append(counts);

    const mixed = T2K.study.mixedHardCount();
    const total = s.dueNow + s.newLeft + mixed;
    if (total > 0) {
      card.append(el('button', { class: 'btn big', onclick: () => T2K.study.start() },
        `Start session — ${total} card${total === 1 ? '' : 's'}`));
      const mixedWord = `${mixed} hard word${mixed === 1 ? '' : 's'}`;
      card.append(el('p', { class: 'muted hint' },
        mixed === 0 ? 'Reviews come first, then new words in frequency order.'
          : s.dueNow + s.newLeft === 0 ? `${mixedWord} from your Again/Hard list.`
            : `Reviews first with ${mixedWord} shuffled in, then new words.`));
    } else if (s.newAvailable === 0 && s.introduced >= s.loaded) {
      card.append(el('p', { class: 'done-note' }, '🎉 Every loaded word has been introduced. Add the next batch to data/ to keep going.'));
    } else {
      card.append(el('p', { class: 'done-note' }, '✓ Nothing due right now — you’re done for today. Carry on below if you feel like it.'));
    }
    main.append(card);

    // Keep going: extra new words, early reviews, or a practice run — as many
    // cards as the slider asks for.
    const extras = el('section', { class: 'card' });
    extras.append(el('h3', {}, total > 0 ? 'Or go further' : 'Keep going'));
    if (extraOptions().length) {
      fillExtras(extras);
    } else {
      extras.append(el('p', { class: 'muted small' },
        'Nothing extra to do — every word in your batches has been started and none are scheduled yet.'));
    }
    main.append(extras);

    const prog = el('section', { class: 'card' });
    prog.append(el('h3', {}, 'Progress'));
    prog.append(progressBar(s.introduced / store.TOTAL_GOAL,
      `${s.introduced} of ${store.TOTAL_GOAL} words started · ${s.learned} learned`));
    prog.append(el('p', { class: 'muted small' },
      `${s.loaded} words loaded in ${deck.batches.length} batch${deck.batches.length === 1 ? '' : 'es'}.`));
    prog.append(el('div', { class: 'streak-line' },
      s.streak > 0
        ? `🔥 ${s.streak}-day streak${s.best > s.streak ? ` · best ${s.best}` : ''}`
        : (s.best ? `No streak today · best ${s.best} days` : 'Rate your first card to start a streak.')));
    main.append(prog);
  }

  // ---------- Stats ----------
  function renderStats(main) {
    const s = summary();
    const state = store.state;

    const card = el('section', { class: 'card' });
    card.append(el('h2', {}, 'Stats'));
    card.append(el('div', { class: 'tiles' }, [
      statTile(s.learned, 'learned'),
      statTile(s.learning, 'in learning'),
      statTile(s.due, 'due today'),
      statTile(s.streak, 'day streak'),
      statTile(s.reviewsToday, 'reviews today'),
      statTile(s.totalReviews, 'reviews total'),
    ]));
    main.append(card);

    const goal = el('section', { class: 'card' });
    goal.append(el('h3', {}, `Toward ${store.TOTAL_GOAL} words`));
    goal.append(progressBar(s.introduced / store.TOTAL_GOAL,
      `${s.introduced} started · ${s.learned} learned · ${store.TOTAL_GOAL - s.introduced} to go`));
    goal.append(el('p', { class: 'muted small' }, `Best streak: ${s.best} day${s.best === 1 ? '' : 's'}.`));
    main.append(goal);

    // --- what you pressed, and which words keep coming back ---
    const tally = { again: 0, hard: 0, good: 0, easy: 0 };
    for (const entry of state.log) {
      if (tally[entry.rating] !== undefined) tally[entry.rating] += 1;
    }
    const ratings = el('section', { class: 'card' });
    ratings.append(el('h3', {}, 'Ratings'));
    if (state.log.length) {
      ratings.append(el('div', { class: 'tiles four' }, [
        statTile(tally.again, 'again'),
        statTile(tally.hard, 'hard'),
        statTile(tally.good, 'good'),
        statTile(tally.easy, 'easy'),
      ]));
      ratings.append(el('p', { class: 'muted small' },
        `Your last ${state.log.length} rating${state.log.length === 1 ? '' : 's'}. ` +
        'The full log travels in an exported backup.'));
    } else {
      ratings.append(el('p', { class: 'muted small' }, 'Nothing rated yet — the log fills as you study.'));
    }
    main.append(ratings);

    const hard = T2K.study.hardWords();
    if (hard.length) {
      const hardCard = el('section', { class: 'card' });
      hardCard.append(el('h3', {}, 'Hardest words'));
      for (const w of hard.slice(0, 8)) {
        const c = state.cards[w.rank];
        hardCard.append(el('div', { class: 'row' }, [
          el('div', { class: 'row-main' }, [
            el('div', { class: 'row-title' }, [
              T2K.headword(w),
              el('span', { class: 'chip soft' }, '#' + w.rank),
            ]),
            el('div', { class: 'muted small' },
              `${w.english} · ${c.lapses || 0}× again, ${c.hard || 0}× hard`),
          ]),
        ]));
      }
      if (hard.length > 8) {
        hardCard.append(el('p', { class: 'muted small' }, `…and ${hard.length - 8} more.`));
      }
      hardCard.append(el('button', {
        class: 'btn secondary',
        onclick: () => T2K.study.start('hard'),
      }, `Drill ${T2K.study.availability().hard} hard words`));
      main.append(hardCard);
    }

    const byBatch = el('section', { class: 'card' });
    byBatch.append(el('h3', {}, 'By batch'));
    const unlocked = deck.unlockedBatches(state);
    const active = deck.activeBatches(state);
    for (const b of deck.batches) {
      const started = b.words.filter(w => state.cards[w.rank]).length;
      const learned = b.words.filter(w => state.cards[w.rank] && state.cards[w.rank].ivl >= 1).length;
      byBatch.append(el('div', { class: 'row' }, [
        el('div', { class: 'row-main' }, [
          el('div', { class: 'row-title' }, [
            `Batch ${b.batch} · ${b.range[0]}–${b.range[1]}`,
            !unlocked.includes(b.batch) ? el('span', { class: 'lock' }, '🔒') : null,
            active.includes(b.batch) && unlocked.includes(b.batch) ? el('span', { class: 'chip on' }, 'active') : null,
          ]),
          progressBar(started / b.words.length, `${started}/${b.words.length} started · ${learned} learned`),
        ]),
      ]));
    }
    main.append(byBatch);
  }

  // ---------- Settings ----------
  function stepper(value, { min, max, step, format, onChange }) {
    const out = el('div', { class: 'stepper' });
    const valueEl = el('div', { class: 'stepper-value' }, format ? format(value) : String(value));
    const bump = (delta) => {
      const next = Math.min(max, Math.max(min, value + delta));
      if (next === value) return;
      value = next;
      valueEl.textContent = format ? format(value) : String(value);
      onChange(value);
    };
    out.append(el('button', { class: 'step-btn', 'aria-label': 'less', onclick: () => bump(-step) }, '−'));
    out.append(valueEl);
    out.append(el('button', { class: 'step-btn', 'aria-label': 'more', onclick: () => bump(step) }, '+'));
    return out;
  }

  function segmented(options, current, onPick) {
    const row = el('div', { class: 'seg' });
    for (const [value, label] of options) {
      row.append(el('button', {
        class: 'seg-btn' + (current === value ? ' on' : ''),
        onclick: () => onPick(value),
      }, label));
    }
    return row;
  }

  // The batch the next unseen word sits in — where new cards are coming from.
  function currentBatchNumber(state) {
    const next = deck.words.find(w => !state.cards[w.rank]);
    if (next) return deck.batchNumberOf(next.rank);
    const last = deck.batches[deck.batches.length - 1];
    return last ? last.batch : 1;
  }

  function settingRow(label, control, hint) {
    return el('div', { class: 'setting' }, [
      el('div', { class: 'setting-text' }, [
        el('div', { class: 'setting-label' }, label),
        hint ? el('div', { class: 'muted small' }, hint) : null,
      ]),
      control,
    ]);
  }

  function renderSettings(main) {
    const state = store.state;
    const st = state.settings;
    const save = () => { store.save(); };

    // --- session ---
    const session = el('section', { class: 'card' });
    session.append(el('h2', {}, 'Settings'));
    session.append(el('h3', {}, 'Daily session'));
    session.append(settingRow('New words per day',
      stepper(st.newPerDay, {
        min: 0, max: 100, step: 5,
        onChange: v => { st.newPerDay = v; save(); },
      }),
      'Introduced in frequency order.'));
    session.append(settingRow('Mix in hard words',
      stepper(st.mixHard, {
        min: 0, max: 20, step: 5,
        format: v => (v === 0 ? 'off' : String(v)),
        onChange: v => { st.mixHard = v; save(); },
      }),
      'Words you rated Again or Hard, shuffled into each daily session.'));
    session.append(settingRow('Keep-going size',
      stepper(st.extraSize, {
        min: 10, max: 100, step: 10,
        onChange: v => { st.extraSize = v; save(); },
      }),
      'Cards in an extra run started from the Today screen.'));
    session.append(settingRow('Review cap per day',
      stepper(st.maxReviews, {
        min: 0, max: 400, step: 20,
        format: v => (v === 0 ? 'none' : String(v)),
        onChange: v => { st.maxReviews = v; save(); },
      }),
      'Overdue reviews roll over to the next day.'));
    session.append(settingRow('Direction',
      segmented([['nl-en', 'NL → EN'], ['en-nl', 'EN → NL'], ['mixed', 'Mixed']], st.direction,
        v => { st.direction = v; save(); refresh(); }),
      'Which side of the card you see first.'));
    main.append(session);

    // --- batches ---
    const batchCard = el('section', { class: 'card' });
    batchCard.append(el('h3', {}, 'Batches'));
    const unlocked = deck.unlockedBatches(state);
    const auto = !st.batches || !st.batches.length;
    batchCard.append(settingRow('Choose batches',
      segmented([['auto', 'Automatic'], ['manual', 'Manual']], auto ? 'auto' : 'manual',
        v => {
          // Switching to manual starts from the batch new words are coming from
          // now, which is the one you'd want to pin.
          st.batches = v === 'auto' ? null : [currentBatchNumber(state)];
          save();
          refresh();
        }),
      'Automatic walks the batches in order; manual lets you pick.'));

    for (const b of deck.batches) {
      const isUnlocked = unlocked.includes(b.batch);
      const picked = auto ? deck.activeBatches(state).includes(b.batch) : (st.batches || []).includes(b.batch);
      batchCard.append(el('button', {
        class: 'batch-row' + (picked ? ' on' : '') + (isUnlocked ? '' : ' locked'),
        // A locked row is always tappable — that's how you move on early.
        disabled: auto && isUnlocked,
        onclick: () => {
          if (!isUnlocked) {
            unlockThrough(b.batch);
            refresh();
            toast(`Batch ${b.batch} unlocked — new words now come from ${b.range[0]}–${b.range[1]}.`);
            return;
          }
          const set = new Set(st.batches || []);
          if (set.has(b.batch)) {
            // An empty list would silently mean "automatic" — keep one on.
            if (set.size === 1) { toast('Keep at least one batch selected.'); return; }
            set.delete(b.batch);
          } else {
            set.add(b.batch);
          }
          st.batches = Array.from(set).sort((x, y) => x - y);
          save();
          refresh();
        },
      }, [
        el('span', {}, `Batch ${b.batch} · words ${b.range[0]}–${b.range[1]}`),
        el('span', { class: 'batch-mark' }, isUnlocked ? (picked ? '✓' : '') : '🔒 unlock'),
      ]));
    }
    batchCard.append(el('p', { class: 'muted small' },
      'A batch unlocks once the one before it has been started — or tap a locked '
      + 'one to open it now and draw new words from it.'));
    main.append(batchCard);

    // --- speech ---
    const speechCard = el('section', { class: 'card' });
    speechCard.append(el('h3', {}, 'Pronunciation'));
    if (!speech.supported) {
      speechCard.append(el('p', { class: 'muted small' },
        'This browser has no speech synthesis, so the 🔊 buttons are hidden.'));
    } else {
      const dutch = speech.dutchVoices();
      const select = el('select', {
        class: 'select',
        onchange: (e) => { st.voiceURI = e.target.value || null; save(); },
      });
      select.append(el('option', { value: '' }, dutch.length ? 'Automatic (best Dutch voice)' : 'Default voice'));
      for (const v of dutch) {
        select.append(el('option', { value: v.voiceURI, selected: st.voiceURI === v.voiceURI },
          `${v.name} (${v.lang})`));
      }
      speechCard.append(settingRow('Dutch voice', select,
        dutch.length
          ? `${dutch.length} Dutch voice${dutch.length === 1 ? '' : 's'} available.`
          : 'No Dutch voice found on this device — speech may sound off. Add one in your system’s language settings.'));

      speechCard.append(settingRow('Speed',
        stepper(Math.round(st.speechRate * 10) / 10, {
          min: 0.5, max: 1.3, step: 0.1,
          format: v => v.toFixed(1) + '×',
          onChange: v => { st.speechRate = Math.round(v * 10) / 10; save(); },
        })));

      speechCard.append(settingRow('Speak on flip',
        segmented([[false, 'Off'], [true, 'On']], !!st.autoSpeak,
          v => { st.autoSpeak = v; save(); refresh(); }),
        'Say the Dutch word automatically when a card is turned over.'));

      speechCard.append(el('button', {
        class: 'btn secondary',
        onclick: () => speech.speak('Goedemorgen! Ik leer Nederlands.', st),
      }, '🔊 Test the voice'));
    }
    main.append(speechCard);

    // --- appearance ---
    const look = el('section', { class: 'card' });
    look.append(el('h3', {}, 'Appearance'));
    look.append(settingRow('Theme',
      segmented([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme,
        v => { st.theme = v; save(); applyTheme(); refresh(); }),
      'Auto follows your device setting.'));
    main.append(look);

    main.append(syncCard());

    // --- data ---
    const data = el('section', { class: 'card' });
    data.append(el('h3', {}, 'Your progress'));
    data.append(el('p', { class: 'muted small' }, T2K.sync.connected()
      ? 'Progress lives in this browser and in your sync gist. A backup file is still a good idea now and then.'
      : 'Progress lives only in this browser. Export a backup before switching device or clearing site data — or set up sync above.'));

    const fileInput = el('input', {
      type: 'file', accept: 'application/json,.json', class: 'hidden-file',
      onchange: (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const imported = store.parseImport(String(reader.result));
            const count = Object.keys(imported.cards).length;
            // Merging rather than replacing: with sync on, a replaced copy would
            // only be merged back with the gist anyway.
            if (!confirm(`Merge this backup (${count} words) into your progress? Words you’ve both got ` +
              'keep whichever was studied more recently; nothing here is lost.')) return;
            if (store.mergeIn(imported)) T2K.sync.sync();
            applyTheme();
            refresh();
            toast(`Merged ${count} words from the backup.`);
          } catch (err) {
            alert(err.message || 'Could not read that file.');
          }
        };
        reader.onerror = () => alert('Could not read that file.');
        reader.readAsText(file);
        e.target.value = '';
      },
    });

    data.append(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', onclick: exportProgress }, '⬇︎ Export backup'),
      el('button', { class: 'btn secondary', onclick: () => fileInput.click() }, '⬆︎ Import backup'),
    ]));
    data.append(fileInput);
    data.append(el('button', {
      class: 'btn danger',
      onclick: () => {
        const synced = T2K.sync.connected();
        if (!confirm('Delete all progress on this device — every schedule, streak and setting? This can’t be undone.' +
          (synced ? '\n\nThis device also stops syncing (otherwise the gist would bring it all back). ' +
            'The gist keeps its copy — delete it on GitHub to wipe that too.' : ''))) return;
        T2K.sync.disconnect();
        store.reset();
        applyTheme();
        refresh();
        toast('Progress reset.');
      },
    }, 'Reset all progress'));
    main.append(data);

    const about = el('section', { class: 'card' });
    about.append(el('h3', {}, 'About'));
    about.append(el('p', { class: 'muted small' },
      `Words load from data/batch-NN.json (${deck.mode === 'bundle' ? 'offline bundle' : 'fetched'}). ` +
      'Drop the next batch file into data/ and it appears here — no code changes.'));
    main.append(about);
  }

  // ---------- sync ----------
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  function syncLine(status) {
    if (status.busy) return el('div', { class: 'sync-line' }, '⟳ Syncing…');
    if (status.error) {
      return el('div', { class: 'sync-line ' + (status.error.kind === 'offline' ? '' : 'warn') }, [
        status.error.kind === 'offline' ? '☁︎ ' : '⚠︎ ',
        status.error.message,
        status.lastSync ? el('span', { class: 'muted' }, ` Last synced ${ago(status.lastSync)}.`) : null,
      ]);
    }
    return el('div', { class: 'sync-line ok' },
      status.lastSync ? `✓ Synced ${ago(status.lastSync)}` : '✓ Connected');
  }

  // Built as its own node so sync events can redraw just this card, without
  // re-rendering Settings and losing your scroll position.
  function syncCard() {
    const sync = T2K.sync;
    const status = sync.status();
    const card = el('section', { class: 'card', id: 'sync-card' });
    card.append(el('h3', {}, 'Sync across devices'));

    if (status.connected) {
      card.append(syncLine(status));
      card.append(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn secondary', disabled: status.busy, onclick: () => sync.sync() }, 'Sync now'),
        status.gistUrl
          ? el('a', { class: 'btn secondary', href: status.gistUrl, target: '_blank', rel: 'noopener' }, 'Open gist ↗')
          : null,
      ]));
      card.append(el('p', { class: 'muted small' },
        'Syncs when the app opens, after each session, and when you switch away from it. ' +
        'The token is kept on this device only — it’s never in an exported backup.'));
      card.append(el('button', {
        class: 'btn danger',
        onclick: () => {
          if (!confirm('Stop syncing on this device? Your progress stays here, and in the gist.')) return;
          sync.disconnect();
          toast('This device no longer syncs.');
        },
      }, 'Disconnect this device'));
      return card;
    }

    card.append(el('p', { class: 'muted small' },
      'Keep the same progress on your phone and your laptop. It’s saved as a secret gist on your ' +
      'GitHub account — unlisted, so only someone with its link can find it. Set up once per device:'));
    card.append(el('ol', { class: 'steps small' }, [
      el('li', {}, [
        el('a', { href: sync.TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Create a GitHub token'),
        ' — only “gist” should be ticked. Pick an expiry, press Generate token, and copy it.',
      ]),
      el('li', {}, 'Paste it below and connect. The first device creates the gist; on every other ' +
        'device use the same token and it finds the same gist.'),
    ]));

    const input = el('input', {
      type: 'password', class: 'text-input', placeholder: 'ghp_…', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'GitHub token',
    });
    const error = el('p', { class: 'sync-line warn', hidden: true });
    const button = el('button', {
      class: 'btn',
      onclick: async () => {
        button.disabled = true;
        button.textContent = 'Connecting…';
        error.hidden = true;
        try {
          const { created } = await sync.connect(input.value);
          toast(created ? 'Connected — your progress is now in a new secret gist.'
            : 'Connected — progress merged with the gist from your other device.');
          // Merged progress can change every screen; this redraw is the one
          // place the scroll jump is worth it.
          refresh();
        } catch (e) {
          error.textContent = e.message || 'Couldn’t connect.';
          error.hidden = false;
          button.disabled = false;
          button.textContent = 'Connect';
        }
      },
    }, 'Connect');
    card.append(el('div', { class: 'token-row' }, [input, button]));
    card.append(error);
    return card;
  }

  function onSyncEvent(what) {
    const studying = T2K.study && T2K.study.active();
    if (what === 'changed' && !studying) { refresh(); return; }
    const old = $('#sync-card');
    if (old) old.replaceWith(syncCard());
    const banner = $('#sync-banner');
    if (banner && what === 'status') banner.replaceWith(syncBanner() || el('div', { id: 'sync-banner' }));
  }

  // On Today, a problem that needs you (not just being offline) gets a banner.
  function syncBanner() {
    const status = T2K.sync.status();
    if (!status.connected || !status.error || ['offline', 'rate', 'http'].includes(status.error.kind)) return null;
    return el('div', { class: 'banner', id: 'sync-banner' }, [
      el('strong', {}, 'Sync stopped. '),
      status.error.message, ' ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('settings'); } }, 'Settings'),
    ]);
  }

  function exportProgress() {
    const payload = JSON.stringify(store.exportPayload(), null, 2);
    const name = `dutch-progress-${srs.dayKey()}.json`;
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup downloaded.');
    } catch (e) {
      // Some in-app browsers block downloads — offer the JSON to copy instead.
      const w = window.open('', '_blank');
      if (w) {
        w.document.title = name;
        w.document.body.textContent = payload;
        toast('Copy the JSON from the new tab.');
      } else {
        alert('Could not start the download. Check that pop-ups are allowed.');
      }
    }
  }

  // ---------- theme ----------
  function applyTheme() {
    const theme = store.state.settings.theme;
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const dark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#16181c' : '#f7f6f3');
  }

  // ---------- shell ----------
  const SCREENS = {
    today: { label: 'Today', icon: '◉', render: renderToday },
    stats: { label: 'Stats', icon: '▤', render: renderStats },
    settings: { label: 'Settings', icon: '⚙', render: renderSettings },
  };
  let current = 'today';

  function renderNav() {
    const nav = $('#nav');
    nav.innerHTML = '';
    for (const [key, screen] of Object.entries(SCREENS)) {
      nav.append(el('button', {
        class: 'nav-btn' + (current === key ? ' on' : ''),
        'aria-current': current === key ? 'page' : false,
        onclick: () => go(key),
      }, [
        el('span', { class: 'nav-icon' }, screen.icon),
        el('span', {}, screen.label),
      ]));
    }
  }

  function refresh() {
    const main = $('#main');
    main.innerHTML = '';
    document.body.classList.remove('studying');
    speech.stop();
    SCREENS[current].render(main);
    renderNav();
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function go(screen) {
    current = screen in SCREENS ? screen : 'today';
    refresh();
  }

  // Re-render only if that screen is the one on display — used when the browser
  // hands us its voice list late, so the picker in Settings fills itself in.
  function refreshIfScreen(screen) {
    if (current === screen && !document.body.classList.contains('studying')) refresh();
  }

  T2K.sync.onChange(onSyncEvent);

  T2K.ui = {
    $, el, go, refresh, refreshIfScreen, toast, summary, applyTheme,
    progressBar, statTile, extraOptions, fillExtras,
  };
})(window.T2K = window.T2K || {});
