/* Sync across devices through a secret GitHub gist.

   You paste a GitHub token that may only touch gists. The app keeps one file,
   dutch-top2000-progress.json, in a secret gist on your account: the first
   device to connect creates it, and every other device given the same token
   finds it. Each sync pulls that file, merges it into the progress here (see
   merge() in storage.js — nothing either side has done is lost) and pushes the
   result back if it changed anything.

   The gist API has no "only if nobody else wrote" check, so a push can
   overwrite a push another device made a moment earlier. Pulling and merging
   right before every push keeps that window to a second or two, and because a
   merge never loses anything, the next sync from the other device puts back
   whatever it was missing.

   The token and gist id live under their own localStorage key, so they're
   never part of an exported backup. */

'use strict';

(function (T2K) {
  const { store } = T2K;
  const KEY = 'dutch-top2000-sync';
  const FILE = 'dutch-top2000-progress.json';
  const API = 'https://api.github.com';
  const PUSH_DELAY = 20000;     // quiet time after a change before it's sent
  const RESUME_GAP = 60000;     // pull again on returning to the app, at most this often
  const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Dutch%202000%20sync';

  let config = readConfig();    // { token, gistId, gistUrl, lastSync, error }
  let running = null;           // the sync in progress, if any
  let again = false;            // another sync was asked for while one ran
  let timer = null;             // a pending push after local changes
  let merging = false;
  const listeners = [];

  function readConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      return c && typeof c === 'object' ? c : {};
    } catch (e) {
      return {};
    }
  }

  function writeConfig() {
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {}
  }

  function notify(what) {
    for (const fn of listeners) {
      try { fn(what); } catch (e) { console.warn(e); }
    }
  }

  function fail(kind, message) {
    const e = new Error(message);
    e.kind = kind;
    return e;
  }

  async function api(path, { method = 'GET', body, token } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',      // GitHub allows caching these; we always want the latest
        headers: Object.assign(
          { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + (token || config.token) },
          body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw fail('offline', 'Offline — progress will sync when you’re back online.');
    }
    if (res.ok) return res.json();
    if (res.status === 401) {
      throw fail('auth', 'GitHub didn’t accept the token — it may have expired or been revoked.');
    }
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw fail('rate', 'GitHub’s rate limit was hit — sync will try again later.');
    }
    if (res.status === 403) {
      throw fail('scope', 'The token isn’t allowed to use gists. Create one with the “gist” scope ticked.');
    }
    if (res.status === 404) {
      throw fail('missing', 'The sync gist wasn’t found — it may have been deleted on GitHub.');
    }
    throw fail('http', `GitHub answered ${res.status}. Sync will try again later.`);
  }

  // Key order doesn't matter to the meaning; sort it so equal progress compares
  // equal. Device-only settings (theme, voice) are left out: they differ by
  // design, and on their own shouldn't cause a push.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
      return out;
    }
    return value;
  }

  function contentKey(state) {
    const s = T2K.sanitizeProgress(state);
    const settings = {};
    for (const k of T2K.SYNCED_SETTINGS) settings[k] = s.settings[k];
    return JSON.stringify(canonical(Object.assign({}, s, { settings })));
  }

  function fileContent() {
    return JSON.stringify(store.exportPayload());
  }

  // The progress stored in the gist, or null if the file isn't there.
  async function pull() {
    const gist = await api('/gists/' + encodeURIComponent(config.gistId));
    if (gist.html_url) config.gistUrl = gist.html_url;
    const file = gist.files && gist.files[FILE];
    if (!file) return null;
    let text = file.content;
    // Files over 1 MB come back cut short; the full text is at raw_url.
    if (file.truncated || typeof text !== 'string') {
      try {
        const res = await fetch(file.raw_url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
      } catch (e) {
        throw fail('offline', 'Couldn’t download the progress file from the gist. Sync will try again.');
      }
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      // Never overwrite something we can't read — it might be the only copy.
      throw fail('corrupt', 'The progress file in your gist isn’t valid JSON, so it was left alone. ' +
        'Fix or delete it on GitHub, then sync again.');
    }
    return obj && obj.data && typeof obj.data === 'object' ? obj.data : obj;
  }

  async function push() {
    await api('/gists/' + encodeURIComponent(config.gistId), {
      method: 'PATCH',
      body: { files: { [FILE]: { content: fileContent() } } },
    });
  }

  async function syncOnce() {
    const remote = await pull();
    merging = true;
    let changed;
    try {
      changed = remote ? store.mergeIn(remote) : false;
    } finally {
      merging = false;
    }
    if (!remote || contentKey(remote) !== contentKey(store.state)) await push();
    return changed;
  }

  // Pull, merge, push. Calls made while one is running fold into one more run.
  function sync() {
    if (!connected()) return Promise.resolve(false);
    clearTimeout(timer);
    timer = null;
    if (running) { again = true; return running; }

    const mine = config;
    running = (async () => {
      let changed = false;
      notify('busy');
      try {
        do {
          again = false;
          if (await syncOnce()) changed = true;
        } while (again);
        mine.lastSync = Date.now();
        mine.error = null;
      } catch (e) {
        mine.error = { kind: e.kind || 'http', message: e.message || 'Sync failed.', at: Date.now() };
      }
      running = null;
      if (config === mine) writeConfig();     // unless disconnected meanwhile
      if (changed) notify('changed');
      notify('status');
      return changed;
    })();
    return running;
  }

  // A change was saved here: send it once things have been quiet for a bit.
  function schedule() {
    if (!connected() || merging) return;
    clearTimeout(timer);
    timer = setTimeout(sync, PUSH_DELAY);
  }

  // Send a pending change now — at the end of a session, or as the app is put away.
  function flush() {
    if (timer) sync();
  }

  function connected() {
    return !!(config.token && config.gistId);
  }

  // Find the gist an earlier device made, or make one. Lists every gist on the
  // account (secret ones included, with this token) looking for our file.
  async function findGist(token) {
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`, { token });
      const hit = Array.isArray(list) && list.find(g => g.files && g.files[FILE]);
      if (hit) return hit;
      if (!Array.isArray(list) || list.length < 100) return null;
    }
    return null;
  }

  // Throws only if the token can't reach a gist at all; once connected, a
  // failed first sync shows up in status() like any other.
  async function connect(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) throw fail('auth', 'Paste the token from GitHub first.');
    let gist = await findGist(token);
    const created = !gist;
    if (!gist) {
      gist = await api('/gists', {
        method: 'POST',
        token,
        body: {
          description: 'Dutch 2000 flashcards — progress, kept in sync by the app',
          public: false,
          files: { [FILE]: { content: fileContent() } },
        },
      });
    }
    config = { token, gistId: gist.id, gistUrl: gist.html_url || null, lastSync: null, error: null };
    writeConfig();
    await sync();
    return { created };
  }

  // Forget the token on this device. The gist, and the progress here, stay.
  function disconnect() {
    clearTimeout(timer);
    timer = null;
    config = {};
    try { localStorage.removeItem(KEY); } catch (e) {}
    notify('status');
  }

  function status() {
    return {
      connected: connected(),
      busy: !!running,
      lastSync: config.lastSync || null,
      error: config.error || null,
      gistUrl: config.gistUrl || null,
    };
  }

  // Called once the app has loaded: sync now, and from then on whenever the
  // app is opened again, put away, or comes back online.
  function start() {
    store.onSave = schedule;
    document.addEventListener('visibilitychange', () => {
      if (!connected()) return;
      if (document.visibilityState === 'hidden') flush();
      else if (!running && Date.now() - (config.lastSync || 0) > RESUME_GAP) sync();
    });
    window.addEventListener('online', () => { if (connected()) sync(); });
    return sync();
  }

  T2K.sync = {
    TOKEN_URL, FILE,
    start, sync, flush, connect, disconnect, status, connected,
    onChange(fn) { listeners.push(fn); },
  };
})(window.T2K = window.T2K || {});
