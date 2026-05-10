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
  var BUILTIN_THEMES = [
    'light', 'dark', 'sunset', 'forest', 'midnight',
    'ocean', 'rose', 'slate', 'lavender', 'mint', 'claude',
    'graphite', 'nocturne'
  ];
  // 'system' is a meta-mode: it resolves to light/dark via prefers-color-scheme
  // at apply-time. 'custom' is a meta-mode for user-defined palettes — the
  // extension resolves a palette id into the actual variable overrides before
  // dispatch, so theme.js just sees `{ mode: 'custom', custom: {...} }`.
  // Neither has a CSS block of its own.
  var VALID_MODES = BUILTIN_THEMES.concat(['system', 'custom']);
  // Style is the orthogonal axis (fonts, radius, shadows). Independent of mode.
  var VALID_STYLES = ['default', 'editorial', 'mono'];

  function resolveMode(mode) {
    if (mode === 'system') {
      return (window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    return mode;
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var root = document.documentElement;

    if (theme.mode === 'custom') {
      // No CSS block backs 'custom'; the inline custom: {...} overrides win
      // anyway. Setting the attribute lets devtools / debugging show "custom".
      root.setAttribute('data-theme', 'custom');
    } else if (theme.mode && VALID_MODES.indexOf(theme.mode) !== -1) {
      var actualMode = resolveMode(theme.mode);
      if (BUILTIN_THEMES.indexOf(actualMode) !== -1) {
        root.setAttribute('data-theme', actualMode);
      }
    }

    if (theme.style && VALID_STYLES.indexOf(theme.style) !== -1) {
      root.setAttribute('data-style', theme.style);
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

  // The default theme is the page's expressed intent, falling back to the OS.
  // Authors hint via <html data-theme="..." data-style="..."> — these win over
  // OS detection but lose to any stored user choice. Once the reader picks a
  // theme via the extension, that choice becomes sticky across all Chameleon
  // pages and the page-declared defaults stop mattering.
  function defaultTheme() {
    var root = document.documentElement;
    var theme = {};

    var pageMode = root.getAttribute('data-theme');
    if (pageMode && VALID_MODES.indexOf(pageMode) !== -1) {
      theme.mode = pageMode;
    } else {
      // Default to the meta-mode 'system' so the page stays in lockstep with
      // the OS preference (resolveMode resolves to 'light'/'dark' at apply
      // time, and the matchMedia listener re-applies on OS flips). This also
      // matches the extension popup's default which already shows "System".
      theme.mode = 'system';
    }

    var pageStyle = root.getAttribute('data-style');
    if (pageStyle && VALID_STYLES.indexOf(pageStyle) !== -1) {
      theme.style = pageStyle;
    }

    return theme;
  }

  function setTheme(theme) {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    } catch (e) { /* storage unavailable */ }
  }

  // Mark the document as Chameleon-aware so the Chrome extension can detect us
  // even if the author forgot the <meta name="chameleon"> tag.
  try { document.documentElement.setAttribute('data-chameleon', 'v1'); } catch (e) {}

  // Apply ASAP — runs synchronously on script eval to prevent FOUC.
  applyTheme(readStored() || defaultTheme());

  // Cross-tab + extension sync.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    try {
      applyTheme(e.newValue ? JSON.parse(e.newValue) : defaultTheme());
    } catch (err) { /* ignore */ }
  });

  // Follow OS preference for two cases:
  //   1) user is on 'system' mode → re-resolve light/dark when OS flips
  //   2) user has no stored preference → follow OS as the default
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var listener = function (ev) {
      var stored = readStored();
      if (stored && stored.mode === 'system') {
        applyTheme(stored);
      } else if (!stored) {
        applyTheme(defaultTheme());
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }

  // Convenience helpers that merge with stored state instead of replacing
  // (so changing mode preserves style and vice versa).
  function setMode(mode) {
    var current = readStored() || defaultTheme();
    current.mode = mode;
    setTheme(current);
  }
  function setStyle(style) {
    var current = readStored() || defaultTheme();
    current.style = style;
    setTheme(current);
  }

  // Public API.
  window.Chameleon = {
    version: '1.4.0',
    presets: BUILTIN_THEMES.slice(),
    modes: VALID_MODES.slice(),
    styles: VALID_STYLES.slice(),
    setTheme: setTheme,
    setMode: setMode,
    setStyle: setStyle,
    getTheme: function () { return readStored() || defaultTheme(); },
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      applyTheme(defaultTheme());
    }
  };

  // Bridge for the Chrome extension (and any other page-context caller).
  // The extension content script lives in an isolated world and cannot directly
  // touch window.Chameleon, but DOM events cross the world boundary cleanly —
  // and unlike inline <script> injection, they are not blocked by CSP.
  window.addEventListener('chameleon:apply-theme', function (e) {
    if (e && e.detail && typeof e.detail === 'object') {
      setTheme(e.detail);
    }
  });
})();
