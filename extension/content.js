/*
 * Chameleon Chrome extension — content script (ISOLATED world).
 * On every page, reads the persisted theme from chrome.storage and writes it
 * into the page's localStorage so theme.js picks it up.
 *
 * Uses script-tag injection because the ISOLATED world cannot directly access
 * the page's localStorage. Pages with strict CSP that disallow inline scripts
 * will fall back to whatever theme.js reads on its own.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'chameleon-theme';

  function injectInPage(themeJson) {
    try {
      const script = document.createElement('script');
      script.textContent = `
(function () {
  try {
    var t = ${themeJson};
    localStorage.setItem('chameleon-theme', JSON.stringify(t));
    if (window.Chameleon && typeof window.Chameleon.setTheme === 'function') {
      window.Chameleon.setTheme(t);
    }
  } catch (e) { /* swallow */ }
})();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) { /* swallow */ }
  }

  // 1) On load: pull current theme from extension storage and apply.
  chrome.storage.local.get(STORAGE_KEY, function (data) {
    const theme = data[STORAGE_KEY];
    if (theme && typeof theme === 'object') {
      injectInPage(JSON.stringify(theme));
    }
  });

  // 2) When popup updates the theme, broadcast to this tab too.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    if (next && typeof next === 'object') {
      injectInPage(JSON.stringify(next));
    }
  });
})();
