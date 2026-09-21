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

  // ---------- Today ----------
  function renderToday(main) {
    const s = summary();

    if (!store.available) {
      main.append(el('div', { class: 'banner' }, [
        el('strong', {}, 'Progress can’t be saved in this browser. '),
        'Private mode or blocked storage — the session works, but export before you close the tab.',
      ]));
    }

    const card = el('section', { class: 'card' });
    card.append(el('h2', {}, 'Today'));

    const counts = el('div', { class: 'tiles two' }, [
      statTile(s.dueNow, s.dueNow === 1 ? 'review due' : 'reviews due'),
      statTile(s.newLeft, 'new words'),
    ]);
    card.append(counts);

    const total = s.dueNow + s.newLeft;
    if (total > 0) {
      card.append(el('button', { class: 'btn big', onclick: () => T2K.study.start() },
        `Start session — ${total} card${total === 1 ? '' : 's'}`));
      card.append(el('p', { class: 'muted hint' }, 'Reviews come first, then new words in frequency order.'));
    } else if (s.newAvailable === 0 && s.introduced >= s.loaded) {
      card.append(el('p', { class: 'done-note' }, '🎉 Every loaded word has been introduced. Add the next batch to data/ to keep going.'));
    } else {
      card.append(el('p', { class: 'done-note' }, '✓ Nothing due right now. Come back tomorrow, or raise “new words per day” in Settings.'));
      card.append(el('button', { class: 'btn secondary', onclick: () => go('settings') }, 'Open settings'));
    }
    main.append(card);

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

    const byBatch = el('section', { class: 'card' });
    byBatch.append(el('h3', {}, 'By batch'));
    const unlocked = deck.unlockedBatches(state.cards);
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
    const unlocked = deck.unlockedBatches(state.cards);
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
        disabled: auto || !isUnlocked,
        onclick: () => {
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
        el('span', { class: 'batch-mark' }, isUnlocked ? (picked ? '✓' : '') : '🔒'),
      ]));
    }
    batchCard.append(el('p', { class: 'muted small' },
      'A batch unlocks once the one before it has been started.'));
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

    // --- data ---
    const data = el('section', { class: 'card' });
    data.append(el('h3', {}, 'Your progress'));
    data.append(el('p', { class: 'muted small' },
      'Progress lives only in this browser. Export a backup before switching device or clearing site data.'));

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
            if (!confirm(`Replace your current progress with this backup (${count} words)? This can’t be undone.`)) return;
            store.replace(imported);
            applyTheme();
            refresh();
            toast(`Imported ${count} words.`);
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
        if (!confirm('Delete all progress — every schedule, streak and setting? This can’t be undone.')) return;
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

  T2K.ui = { $, el, go, refresh, refreshIfScreen, toast, summary, applyTheme, progressBar, statTile };
})(window.T2K = window.T2K || {});
