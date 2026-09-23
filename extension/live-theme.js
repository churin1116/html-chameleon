/*
 * Chameleon Chrome extension — live theme override (ISOLATED world).
 *
 * Runs in every frame, including about:srcdoc iframes (html-editor previews
 * files that way), unlike content.js whose palette belongs to the top frame.
 *
 * Baked pages carry the theme as of their last bake. The extension bundles the
 * current theme (theme-live.js — no async storage read) and swaps it in for
 * the page's <style data-chameleon-theme>: the baked block is disabled in
 * place (media="not all") and the bundled copy inserted right after it. That
 * is the cascade a rebake would produce, so the page's own later CSS (custom
 * [data-theme] palettes, .card tweaks, ...) still wins.
 *
 * MutationObserver callbacks are microtasks, so the swap lands in the same
 * parser task that inserted the <style> — before first paint.
 *
 * A page is swapped when it tracks our major ("^1" / legacy "v1"), is not
 * pinned to an exact version, and was baked with an older theme than we
 * bundle (same or newer → nothing to do). Pages without a baked block (hosted
 * <link> users) already get the latest.
 */
(function () {
  'use strict';

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
    return !baked || compareVersions(baked, ours) < 0;
  }

  // html-editor files saved before the prose typography moved into the theme
  // carry it in a later, unmarked <style> — sometimes alongside hand-added
  // rules (custom palettes), so the block can't just be disabled. Instead,
  // delete (via CSSOM — the markup is untouched) only the rules whose
  // selector the bundled theme now defines; left in place they would
  // override the newer bundled rules by source order.
  function ruleKey(rule) {
    if (rule.selectorText !== undefined) return 'S|' + rule.selectorText;
    if (rule.conditionText !== undefined && rule.cssRules) return 'M|' + rule.conditionText;
    return null;
  }

  function collectProseKeys(rules, into) {
    for (const r of rules) {
      const k = ruleKey(r);
      if (!k) continue;
      if (k.startsWith('S|.prose-canvas')) into.add(k);
      else if (k.startsWith('M|')) {
        const inner = new Set();
        collectProseKeys(r.cssRules, inner);
        inner.forEach(function (ik) { into.add(k + '>' + ik); });
      }
    }
    return into;
  }

  function pruneStale(list, known, prefix) {
    for (let i = list.cssRules.length - 1; i >= 0; i--) {
      const r = list.cssRules[i];
      const k = ruleKey(r);
      if (!k) continue;
      if (k.startsWith('M|')) {
        pruneStale(r, known, prefix + k + '>');
        if (r.cssRules.length === 0) list.deleteRule(i);
      } else if (known.has(prefix + k)) {
        list.deleteRule(i);
      }
    }
  }

  const pruned = new WeakSet();
  function pruneLegacyProse(liveSheet) {
    let known = null;
    document.querySelectorAll('head style:not([data-chameleon-theme]):not([id])').forEach(function (el) {
      if (pruned.has(el) || !el.sheet) return;
      pruned.add(el);
      const rules = Array.from(el.sheet.cssRules);
      const legacy = rules.some(function (r) {
        return r.selectorText === '.prose-canvas' && r.style && r.style.maxWidth === '760px';
      });
      if (!legacy) return;
      known = known || collectProseKeys(liveSheet.cssRules, new Set());
      pruneStale(el.sheet, known, '');
    });
  }

  function setupLiveTheme() {
    const live = self.__chameleonLive;
    if (!live || !live.css) return;
    let eligible = null; // unknown until <meta name="chameleon"> is parsed

    // Returns true once nothing is left to do.
    function step() {
      if (eligible === null) {
        const meta = document.querySelector('meta[name="chameleon"]');
        if (!meta) return false;
        eligible = liveEligible(meta, live);
      }
      if (!eligible) return true;
      let style = document.getElementById(LIVE_STYLE_ID);
      if (!style) {
        const baked = document.querySelector('style[data-chameleon-theme]');
        if (!baked) return false;
        baked.media = 'not all';
        style = document.createElement('style');
        style.id = LIVE_STYLE_ID;
        style.textContent = live.css;
        baked.after(style);
        document.documentElement.setAttribute(LIVE_ATTR, live.version);
      }
      if (style.sheet) pruneLegacyProse(style.sheet);
      return false; // a legacy prose block may still follow; stop at DOMContentLoaded
    }

    if (step()) return;
    const observer = new MutationObserver(function () {
      if (step()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () {
      step();
      observer.disconnect();
    }, { once: true });
  }

  try { setupLiveTheme(); } catch (e) { /* never break the page */ }
})();
