/*
 * Chameleon Chrome extension — content script (ISOLATED world).
 *
 * 1) document_start: write the persisted theme into the page's localStorage so
 *    theme.js picks it up before first paint (FOUC-free).
 * 2) DOMContentLoaded: detect whether this page declares Chameleon. If yes,
 *    inject a floating theme palette into the top-right corner. Either way,
 *    report the result to the background service worker so the toolbar badge
 *    reflects it.
 *
 * Detection layers (any one is sufficient):
 *   - <meta name="chameleon" ...>          (strongest, explicit declaration)
 *   - <link href*="html-chameleon">        (catches anyone using the hosted CSS)
 *   - <html data-chameleon>                (set automatically by theme.js)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'chameleon-theme';
  const RAIL_ID = '__chameleon-rail';
  const STYLE_ID = '__chameleon-rail-style';

  const PRESETS = [
    { mode: 'light',    label: 'Light',    gradient: 'linear-gradient(135deg, #ffffff 50%, #2563eb 50%)' },
    { mode: 'dark',     label: 'Dark',     gradient: 'linear-gradient(135deg, #0a0a0a 50%, #60a5fa 50%)' },
    { mode: 'sunset',   label: 'Sunset',   gradient: 'linear-gradient(135deg, #fff7ed 50%, #ea580c 50%)' },
    { mode: 'forest',   label: 'Forest',   gradient: 'linear-gradient(135deg, #f0fdf4 50%, #15803d 50%)' },
    { mode: 'midnight', label: 'Midnight', gradient: 'linear-gradient(135deg, #030712 50%, #a78bfa 50%)' },
  ];

  // ---------- Inject script into MAIN world to update page localStorage ----------
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

  // 2) Listen for storage changes (from popup OR floating palette OR other tabs).
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    if (next && typeof next === 'object') {
      injectInPage(JSON.stringify(next));
      syncPaletteState(next);
    }
  });

  // ---------- Floating palette injection (only on detected pages) ----------
  function injectPalette() {
    if (document.getElementById(RAIL_ID)) return;
    if (!document.body) return; // safety

    // Inject style tag (uses page's CSS variables, falls back to safe defaults)
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${RAIL_ID} {
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        z-index: 2147483600 !important;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif !important;
        font-size: 14px !important;
        line-height: 1 !important;
        color: var(--text, #0a0a0a) !important;
      }
      #${RAIL_ID} *, #${RAIL_ID} *::before, #${RAIL_ID} *::after { box-sizing: border-box !important; }
      .__cm-trigger {
        display: inline-flex !important;
        align-items: center !important;
        gap: 7px !important;
        padding: 7px 10px !important;
        margin: 0 !important;
        background: var(--surface, #fafafa) !important;
        color: var(--text, #0a0a0a) !important;
        border: 1px solid var(--border, #e4e4e7) !important;
        border-radius: 999px !important;
        font-family: inherit !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1) !important;
        transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease !important;
      }
      .__cm-trigger:hover { border-color: var(--border-strong, #a1a1aa) !important; background: var(--surface-2, #f4f4f5) !important; }
      .__cm-trigger[aria-expanded="true"] {
        border-color: var(--primary, #2563eb) !important;
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.18) !important;
      }
      .__cm-swatch {
        width: 18px !important;
        height: 18px !important;
        border-radius: 50% !important;
        flex-shrink: 0 !important;
        background: linear-gradient(135deg, var(--canvas, #fff) 50%, var(--primary, #2563eb) 50%) !important;
      }
      .__cm-chevron {
        color: var(--text-muted, #525252) !important;
        transition: transform 0.2s ease !important;
        flex-shrink: 0 !important;
      }
      .__cm-trigger[aria-expanded="true"] .__cm-chevron {
        transform: rotate(180deg) !important;
        color: var(--primary, #2563eb) !important;
      }
      .__cm-menu {
        position: absolute !important;
        top: calc(100% + 8px) !important;
        right: 0 !important;
        min-width: 180px !important;
        background: var(--surface, #fafafa) !important;
        border: 1px solid var(--border, #e4e4e7) !important;
        border-radius: 14px !important;
        padding: 5px !important;
        margin: 0 !important;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08) !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 1px !important;
        animation: __cm-fade 0.16s ease !important;
      }
      .__cm-menu[hidden] { display: none !important; }
      @keyframes __cm-fade {
        from { opacity: 0; transform: translateY(-6px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .__cm-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 8px 10px !important;
        margin: 0 !important;
        background: transparent !important;
        border: 0 !important;
        border-radius: 9px !important;
        font-family: inherit !important;
        font-size: 13px !important;
        color: var(--text, #0a0a0a) !important;
        cursor: pointer !important;
        text-align: left !important;
        width: 100% !important;
        transition: background 0.1s ease !important;
      }
      .__cm-item:hover { background: var(--surface-2, #f4f4f5) !important; }
      .__cm-item-swatch {
        width: 18px !important;
        height: 18px !important;
        border-radius: 50% !important;
        flex-shrink: 0 !important;
      }
      .__cm-item-name { flex: 1 !important; }
      .__cm-item-check {
        color: var(--primary, #2563eb) !important;
        opacity: 0 !important;
        transition: opacity 0.12s ease !important;
        flex-shrink: 0 !important;
      }
      .__cm-item[aria-selected="true"] .__cm-item-check { opacity: 1 !important; }
      .__cm-item[aria-selected="true"] {
        color: var(--primary, #2563eb) !important;
        font-weight: 600 !important;
      }
    `;
    document.head.appendChild(style);

    // Build markup
    const items = PRESETS.map(p => `
      <button class="__cm-item" data-mode="${p.mode}" role="option" aria-selected="false" type="button">
        <span class="__cm-item-swatch" style="background: ${p.gradient};" aria-hidden="true"></span>
        <span class="__cm-item-name">${p.label}</span>
        <svg class="__cm-item-check" width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.2 L4 7.2 L8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `).join('');

    const rail = document.createElement('div');
    rail.id = RAIL_ID;
    rail.innerHTML = `
      <button class="__cm-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Chameleon theme">
        <span class="__cm-swatch" aria-hidden="true"></span>
        <svg class="__cm-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 L5 6.5 L7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="__cm-menu" role="listbox" hidden>${items}</div>
    `;
    document.body.appendChild(rail);

    // Wire up handlers
    const trigger = rail.querySelector('.__cm-trigger');
    const menu = rail.querySelector('.__cm-menu');

    function close() { trigger.setAttribute('aria-expanded', 'false'); menu.hidden = true; }
    function open()  { trigger.setAttribute('aria-expanded', 'true');  menu.hidden = false; }

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      if (trigger.getAttribute('aria-expanded') === 'true') close(); else open();
    });

    rail.querySelectorAll('.__cm-item').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        const mode = item.dataset.mode;
        chrome.storage.local.set({ [STORAGE_KEY]: { mode } });
        close();
      });
    });

    document.addEventListener('click', e => {
      if (!rail.contains(e.target)) close();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });

    // Initial state
    chrome.storage.local.get(STORAGE_KEY, data => {
      syncPaletteState(data[STORAGE_KEY] || { mode: 'light' });
    });
  }

  function syncPaletteState(theme) {
    if (!theme || !theme.mode) return;
    document.querySelectorAll(`#${RAIL_ID} .__cm-item`).forEach(item => {
      item.setAttribute('aria-selected', item.dataset.mode === theme.mode ? 'true' : 'false');
    });
  }

  // ---------- Detection ----------
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
    } catch (e) { /* extension may have been reloaded */ }
    if (result.detected) {
      injectPalette();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', report);
  } else {
    report();
  }
})();
