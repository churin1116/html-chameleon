/*
 * Chameleon Chrome extension — content script (ISOLATED world).
 *
 * 1) document_start: write the persisted theme into the page's localStorage so
 *    theme.js picks it up before first paint (FOUC-free).
 * 2) DOMContentLoaded: detect whether this page declares Chameleon. Report the
 *    result to the background service worker so the toolbar badge reflects it.
 *
 * Detection layers (any one is sufficient):
 *   - <meta name="chameleon" ...>          (strongest, explicit declaration)
 *   - <link href*="html-chameleon">        (catches anyone using the hosted CSS)
 *   - <html data-chameleon>                (set automatically by theme.js)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'chameleon-theme';

  function injectInPage(payloadJson) {
    try {
      const script = document.createElement('script');
      script.textContent = `
(function () {
  try {
    var t = ${payloadJson};
    localStorage.setItem('chameleon-theme', JSON.stringify(t));
    if (window.Chameleon && typeof window.Chameleon.setTheme === 'function') {
      window.Chameleon.setTheme(t);
    }
  } catch (e) {}
})();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) { /* swallow */ }
  }

  // 1) Apply persisted theme as early as possible.
  chrome.storage.local.get(STORAGE_KEY, function (data) {
    const theme = data[STORAGE_KEY];
    if (theme && typeof theme === 'object') {
      injectInPage(JSON.stringify(theme));
    }
  });

  // 2) Listen for changes from popup → propagate to current tab.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    if (next && typeof next === 'object') {
      injectInPage(JSON.stringify(next));
    }
  });

  // 3) Detection — runs after the head is parsed (theme.js will have set
  //    data-chameleon on <html> by then if the page uses the runtime).
  function detect() {
    if (document.querySelector('meta[name="chameleon"]')) {
      return { detected: true, signal: 'meta' };
    }
    if (document.querySelector('link[rel="stylesheet"][href*="html-chameleon"]')) {
      return { detected: true, signal: 'link' };
    }
    if (document.documentElement.hasAttribute('data-chameleon')) {
      return { detected: true, signal: 'data-attr' };
    }
    return { detected: false };
  }

  function report() {
    const result = detect();
    try {
      chrome.runtime.sendMessage({ type: 'chameleon:detection', ...result });
    } catch (e) { /* extension may have been reloaded — ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', report);
  } else {
    report();
  }
})();
