/*!
 * Chameleon v1 — theme loader
 * https://github.com/churin1116/html-chameleon
 * MIT License
 *
 * Loads any persisted theme from localStorage, falls back to system
 * prefers-color-scheme, listens for cross-tab + extension updates,
 * and exposes window.Chameleon for runtime control.
 *
 * Place in <head> WITHOUT `defer` to avoid FOUC:
 *   <script src="https://churin1116.github.io/html-chameleon/v1/theme.js"></script>
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'chameleon-theme';
  var VALID_PRESETS = ['light', 'dark', 'sunset', 'forest', 'midnight'];

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var root = document.documentElement;

    if (theme.mode && VALID_PRESETS.indexOf(theme.mode) !== -1) {
      root.setAttribute('data-theme', theme.mode);
    }

    // Clear previous custom-variable overrides before applying new ones.
    var prevKeys = root.dataset.chameleonCustom;
    if (prevKeys) {
      prevKeys.split(',').forEach(function (k) {
        root.style.removeProperty('--' + k);
      });
      delete root.dataset.chameleonCustom;
    }

    if (theme.custom && typeof theme.custom === 'object') {
      var keys = Object.keys(theme.custom);
      keys.forEach(function (k) {
        var v = theme.custom[k];
        if (typeof v === 'string') root.style.setProperty('--' + k, v);
      });
      if (keys.length) root.dataset.chameleonCustom = keys.join(',');
    }
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* corrupt or unavailable */ }
    return null;
  }

  function defaultTheme() {
    var prefersDark = !!(window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    return { mode: prefersDark ? 'dark' : 'light' };
  }

  function setTheme(theme) {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    } catch (e) { /* storage unavailable */ }
  }

  // Apply ASAP — runs synchronously on script eval to prevent FOUC.
  applyTheme(readStored() || defaultTheme());

  // Cross-tab + extension sync.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    try {
      applyTheme(e.newValue ? JSON.parse(e.newValue) : defaultTheme());
    } catch (err) { /* ignore */ }
  });

  // Follow OS preference if user hasn't explicitly chosen.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var listener = function (ev) {
      if (!readStored()) {
        applyTheme({ mode: ev.matches ? 'dark' : 'light' });
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }

  // Public API.
  window.Chameleon = {
    version: '1.0.0',
    presets: VALID_PRESETS.slice(),
    setTheme: setTheme,
    getTheme: function () { return readStored() || defaultTheme(); },
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      applyTheme(defaultTheme());
    }
  };
})();
