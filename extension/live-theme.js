/*
 * Chameleon Chrome extension — live theme override (ISOLATED world).
 *
 * Runs in every frame, including about:srcdoc iframes (html-editor previews
 * files that way), unlike content.js whose palette belongs to the top frame.
 */
(function () {
  'use strict';

  // Baked pages carry the theme as of their last bake. The extension bundles
  // the current theme (no async storage read) and, as soon as the parser
  // inserts <meta name="chameleon"> — observed from document_start, well
  // before first paint — injects it and enables it via
  // html[data-chameleon-live] (the gate every bundled selector carries) if the
  // page is eligible: tracks our major ("^1" / legacy "v1"), is not pinned to
  // an exact version, and was not baked with a newer theme than we bundle.
  // Pages without the meta tag (hosted <link> users) already get the latest.
  const LIVE_STYLE_ID = '__chameleon-live-theme';
  const LIVE_ATTR = 'data-chameleon-live';

  // "1.0.0" / "1.0.0-3-gabc1234" → [1, 0, 0, 3]
  function parseThemeVersion(v) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?/.exec(v || '');
    return m ? [+m[1], +m[2], +m[3], +(m[4] || 0)] : null;
  }

  function compareVersions(a, b) {
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  function liveEligible(meta, live) {
    const ours = parseThemeVersion(live.version);
    if (!ours) return false;
    const contract = (meta.getAttribute('content') || '').trim();
    const tracked = /^\^(\d+)$/.exec(contract) || /^v(\d+)$/.exec(contract);
    if (!tracked || +tracked[1] !== ours[0]) return false; // pinned or other major
    const baked = parseThemeVersion(meta.getAttribute('data-baked'));
    return !baked || compareVersions(baked, ours) <= 0;
  }

  function setupLiveTheme() {
    const live = self.__chameleonLive;
    if (!live || !live.css) return;

    function decide() {
      const meta = document.querySelector('meta[name="chameleon"]');
      if (!meta) return false;
      if (liveEligible(meta, live) && !document.getElementById(LIVE_STYLE_ID)) {
        const style = document.createElement('style');
        style.id = LIVE_STYLE_ID;
        style.textContent = live.css;
        (document.head || document.documentElement).appendChild(style);
        document.documentElement.setAttribute(LIVE_ATTR, live.version);
      }
      return true;
    }
    if (decide()) return;
    const observer = new MutationObserver(function () {
      if (decide()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // <meta> belongs in <head>; stop watching once parsing is done either way.
    document.addEventListener('DOMContentLoaded', function () { observer.disconnect(); }, { once: true });
  }

  try { setupLiveTheme(); } catch (e) { /* never break the page */ }
})();
