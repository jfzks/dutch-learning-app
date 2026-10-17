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

  // A short message at the bottom of the screen, optionally with one button
  // (Undo) — which keeps it up a little longer, so there's time to press it.
  function toast(message, action) {
    const old = $('#toast');
    if (old) old.remove();
    const t = el('div', { id: 'toast', role: 'status' }, message);
    if (action) {
      t.append(el('button', {
        class: 'toast-btn',
        onclick: () => { t.remove(); action.onclick(); },
      }, action.label));
    }
    document.body.append(t);
    const stay = action ? 5000 : 2600;
    setTimeout(() => t.classList.add('out'), stay);
    setTimeout(() => t.remove(), stay + 500);
  }

  // ---------- counts shared by Today and Stats ----------
  function summary() {
    const today = srs.dayKey();
    const state = store.state;
    const cards = state.cards;
    let started = 0, known = 0, learning = 0, due = 0;

    for (const w of deck.words) {
      const c = cards[w.rank];
      if (!c) continue;
      started++;
      if (c.known) { known++; continue; }
      learning++;
      if (c.due <= today) due++;
    }

    srs.rollDay(state, today);
    return {
      today, started, known, learning, due,
      hard: T2K.study.hardWords().length,
      unseen: deck.words.length - started,
      loaded: deck.words.length,
      streak: srs.currentStreak(state, today),
      best: state.streak.best || 0,
      reviewsToday: state.daily.reviews,
      totalReviews: state.totals.reviews,
    };
  }

  // Two-part bar toward the goal: known words, then the ones being learned.
  function goalBar(s) {
    const pct = (n) => Math.max(0, Math.min(100, n / store.TOTAL_GOAL * 100)) + '%';
    return el('div', { class: 'meter' }, [
      el('div', { class: 'meter-track' }, [
        el('div', { class: 'meter-fill', style: { width: pct(s.known) } }),
        el('div', { class: 'meter-fill soft', style: { width: pct(s.learning) } }),
      ]),
      el('div', { class: 'meter-label' },
        `${s.known} known · ${s.learning} learning · ${store.TOTAL_GOAL - s.started} not started`),
    ]);
  }

  function statTile(value, label, tone) {
    return el('div', { class: 'tile' + (tone ? ' ' + tone : '') }, [
      el('div', { class: 'tile-value' }, String(value)),
      el('div', { class: 'tile-label' }, label),
    ]);
  }

  // "10 new · 6 hard · 4 review" — what a session of this size would hold.
  function planLine(p) {
    const parts = [];
    if (p.fresh.length) parts.push(`${p.fresh.length} new`);
    if (p.hard.length) parts.push(`${p.hard.length} hard`);
    if (p.due.length) parts.push(`${p.due.length} review`);
    return parts.join(' · ');
  }

  // ---------- Today ----------
  function renderToday(main) {
    const s = summary();
    const st = store.state.settings;

    if (!store.available) {
      main.append(el('div', { class: 'banner' }, [
        el('strong', {}, 'Progress can’t be saved in this browser. '),
        'Private mode or blocked storage — the session works, but export before you close the tab.',
      ]));
    }
    main.append(syncBanner() || el('div', { id: 'sync-banner' }));

    const card = el('section', { class: 'card' });
    card.append(el('h2', {}, 'Practice'));

    if (!T2K.study.plan(100).total) {
      card.append(el('p', { class: 'done-note' },
        '🎉 Every word is known. Bring some back from Stats if you want to keep practising.'));
      main.append(card);
    } else {
      // One choice: how many cards. The line under it says what they'll be,
      // and the button starts them.
      const readout = el('div', { class: 'size-value' });
      const breakdown = el('p', { class: 'plan-line' });
      const button = el('button', { class: 'btn big', onclick: () => T2K.study.start() });
      const draw = () => {
        const p = T2K.study.plan(st.sessionSize);
        readout.textContent = String(st.sessionSize);
        breakdown.textContent = planLine(p);
        button.textContent = `Start — ${p.total} card${p.total === 1 ? '' : 's'}`;
      };
      const slider = el('input', {
        type: 'range', min: '10', max: '100', step: '10', value: String(st.sessionSize),
        class: 'size-slider', 'aria-label': 'Cards in this session',
        oninput: (e) => { st.sessionSize = Number(e.target.value); draw(); },
        onchange: () => store.save(),         // save once the drag ends
      });
      card.append(el('div', { class: 'setting-label' }, 'How many cards?'));
      card.append(el('div', { class: 'size-row' }, [slider, readout]));
      card.append(breakdown);
      card.append(button);
      card.append(el('p', { class: 'muted hint' },
        'New words in frequency order, then your hard words, then words due for a review. ' +
        '“Know it” retires a word for good.'));
      draw();
      main.append(card);
    }

    const prog = el('section', { class: 'card' });
    prog.append(el('h3', {}, 'Progress'));
    prog.append(goalBar(s));
    prog.append(el('div', { class: 'streak-line' },
      s.streak > 0
        ? `🔥 ${s.streak}-day streak${s.best > s.streak ? ` · best ${s.best}` : ''}`
        : (s.best ? `No streak today · best ${s.best} days` : 'Rate your first card to start a streak.')));
    main.append(prog);
  }

  // ---------- Stats ----------
  function wordRow(w, detail, action) {
    return el('div', { class: 'row' }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          T2K.headword(w),
          el('span', { class: 'chip soft' }, '#' + w.rank),
        ]),
        el('div', { class: 'muted small' }, detail),
      ]),
      action || null,
    ]);
  }

  function renderStats(main) {
    const s = summary();
    const state = store.state;

    const card = el('section', { class: 'card' });
    card.append(el('h2', {}, 'Stats'));
    card.append(el('div', { class: 'tiles' }, [
      statTile(s.known, 'known'),
      statTile(s.learning, 'learning'),
      statTile(s.hard, 'hard'),
      statTile(s.due, 'due for review'),
      statTile(s.streak, 'day streak'),
      statTile(s.totalReviews, 'cards rated'),
    ]));
    main.append(card);

    const goal = el('section', { class: 'card' });
    goal.append(el('h3', {}, `Toward ${store.TOTAL_GOAL} words`));
    goal.append(goalBar(s));
    goal.append(el('p', { class: 'muted small' },
      `Best streak: ${s.best} day${s.best === 1 ? '' : 's'} · ${s.reviewsToday} cards today.`));
    main.append(goal);

    // --- what you pressed ---
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
        statTile(tally.easy, 'know it'),
      ]));
      ratings.append(el('p', { class: 'muted small' },
        `Your last ${state.log.length} rating${state.log.length === 1 ? '' : 's'}.`));
    } else {
      ratings.append(el('p', { class: 'muted small' }, 'Nothing rated yet — the log fills as you study.'));
    }
    main.append(ratings);

    // --- the words that keep coming back ---
    const hard = T2K.study.hardWords();
    const hardCard = el('section', { class: 'card' });
    hardCard.append(el('h3', {}, `Hard words (${hard.length})`));
    if (hard.length) {
      for (const w of hard.slice(0, 10)) {
        const c = state.cards[w.rank];
        hardCard.append(wordRow(w, `${w.english} · ${c.lapses || 0}× again, ${c.hard || 0}× hard`));
      }
      if (hard.length > 10) hardCard.append(el('p', { class: 'muted small' }, `…and ${hard.length - 10} more.`));
      hardCard.append(el('p', { class: 'muted small' },
        'They come back in every session until you’ve got them right a few times.'));
    } else {
      hardCard.append(el('p', { class: 'muted small' }, 'None right now. Words you rate Again or Hard show up here.'));
    }
    main.append(hardCard);

    // --- retired words, and a way back for each ---
    const known = T2K.study.knownWords();
    const knownCard = el('section', { class: 'card' });
    knownCard.append(el('h3', {}, `Known words (${known.length})`));
    if (!known.length) {
      knownCard.append(el('p', { class: 'muted small' }, 'Words you mark “Know it” are listed here and never shown again.'));
    } else {
      const list = el('div', { class: 'known-list' });
      const drawList = (all) => {
        list.innerHTML = '';
        for (const w of all ? known : known.slice(0, 12)) {
          list.append(wordRow(w, w.english, el('button', {
            class: 'btn secondary small-btn',
            onclick: () => {
              state.cards[w.rank] = srs.restore(state.cards[w.rank], srs.dayKey());
              store.save();
              toast(`“${T2K.headword(w)}” is back in practice.`);
              refresh();
            },
          }, 'Bring back')));
        }
        if (!all && known.length > 12) {
          list.append(el('button', { class: 'btn secondary', onclick: () => drawList(true) },
            `Show all ${known.length}`));
        }
      };
      drawList(false);
      knownCard.append(list);
    }
    main.append(knownCard);
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

    // --- cards ---
    const session = el('section', { class: 'card' });
    session.append(el('h2', {}, 'Settings'));
    session.append(settingRow('Direction',
      segmented([['nl-en', 'NL → EN'], ['en-nl', 'EN → NL'], ['mixed', 'Mixed']], st.direction,
        v => { st.direction = v; save(); refresh(); }),
      'Which side of the card you see first.'));
    main.append(session);

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
      `${deck.words.length} words, loaded from data/batch-NN.json` +
      (deck.mode === 'bundle' ? ' (offline bundle).' : '.')));
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
        'Syncs when the app opens, after each session, when you switch away from it, ' +
        'and every few minutes while it’s open. ' +
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
    statTile,
  };
})(window.T2K = window.T2K || {});
