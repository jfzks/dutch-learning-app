/* Dutch pronunciation via the Web Speech API.

   Voices load asynchronously in most browsers, so the list is refreshed on
   'voiceschanged'. We prefer an exact nl-NL voice, then any Dutch voice. With
   no Dutch voice installed we still speak with lang="nl-NL" — some platforms
   synthesise remotely — and the UI says the pronunciation may be off rather
   than hiding the button. */

'use strict';

(function (T2K) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const listeners = [];
  let voices = [];

  function refresh() {
    if (!supported) return;
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (e) {
      voices = [];
    }
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
  }

  if (supported) {
    refresh();
    try {
      window.speechSynthesis.addEventListener('voiceschanged', refresh);
    } catch (e) {
      window.speechSynthesis.onvoiceschanged = refresh;
    }
  }

  const speech = {
    supported,

    onVoicesChanged(fn) { listeners.push(fn); },

    dutchVoices() {
      return voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('nl'));
    },

    // The voice we'd use right now: the one picked in settings if it's still
    // installed, else nl-NL, else any Dutch voice, else null.
    pick(voiceURI) {
      const dutch = this.dutchVoices();
      if (voiceURI) {
        const chosen = dutch.find(v => v.voiceURI === voiceURI) || voices.find(v => v.voiceURI === voiceURI);
        if (chosen) return chosen;
      }
      return dutch.find(v => v.lang.toLowerCase() === 'nl-nl') || dutch[0] || null;
    },

    hasDutchVoice() {
      return this.dutchVoices().length > 0;
    },

    speak(text, settings) {
      if (!supported || !text) return false;
      const opts = settings || {};
      try {
        window.speechSynthesis.cancel();          // stop whatever is still talking
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'nl-NL';
        u.rate = opts.speechRate || 0.9;
        const voice = this.pick(opts.voiceURI);
        if (voice) u.voice = voice;
        window.speechSynthesis.speak(u);
        return true;
      } catch (e) {
        return false;
      }
    },

    stop() {
      if (!supported) return;
      try { window.speechSynthesis.cancel(); } catch (e) {}
    },
  };

  T2K.speech = speech;
})(window.T2K = window.T2K || {});
