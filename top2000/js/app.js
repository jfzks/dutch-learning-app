/* Boot: load progress, load the word batches, show the first screen. */

'use strict';

(function (T2K) {
  const { store, deck, ui, speech } = T2K;

  function fatal(message, detail) {
    const main = ui.$('#main');
    main.innerHTML = '';
    main.append(ui.el('section', { class: 'card' }, [
      ui.el('h2', {}, 'No word data'),
      ui.el('p', {}, message),
      detail ? ui.el('pre', { class: 'code' }, detail) : null,
    ]));
  }

  async function boot() {
    store.load();
    ui.applyTheme();

    // Keep the browser-chrome colour in step when the system flips to dark.
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => ui.applyTheme();
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    // Voices usually arrive after first paint; refresh Settings when they do.
    speech.onVoicesChanged(() => ui.refreshIfScreen('settings'));

    try {
      await deck.load();
    } catch (e) {
      fatal(
        'The word files couldn’t be loaded. Opening index.html straight from disk works only when ' +
        'data/bundle.js is present — otherwise serve the folder:',
        'python3 -m http.server 8000 --directory top2000\nthen open http://localhost:8000/'
      );
      return;
    }

    ui.go('today');
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.T2K = window.T2K || {});
