/*
 * Chameleon Chrome extension — content script (ISOLATED world).
 *
 * 1) document_start: tell the page about the persisted theme via a CustomEvent
 *    on `window` ('chameleon:apply-theme'). theme.js listens for this and
 *    drives setTheme(). DOM events cross the isolated/main world boundary
 *    cleanly and are not subject to the page's CSP, unlike inline-script
 *    injection.
 * 2) DOMContentLoaded: detect whether this page declares Chameleon. If yes,
 *    inject a floating theme palette into the configured corner of the page.
 *    Either way, report the result to the background service worker so the
 *    toolbar badge reflects it.
 *
 * Detection layers (any one is sufficient):
 *   - <meta name="chameleon" ...>          (strongest, explicit declaration)
 *   - <link href*="html-chameleon">        (catches anyone using the hosted CSS)
 *   - <html data-chameleon>                (set automatically by theme.js)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'chameleon-theme';
  const POSITION_KEY = 'chameleon-position';
  const FAVORITES_KEY = 'chameleon-favorites';
  const PALETTES_KEY = 'chameleon-custom-palettes';
  const PROJECT_KEY_PREFIX = 'chameleon-project:';
  const RAIL_ID = '__chameleon-rail';

  // Read the page's <meta name="chameleon-project" content="..."> declaration.
  // Pages that opt in get their colour preference (mode + customId) stored
  // under chrome.storage.sync at chameleon-project:<sanitised-key> — durable
  // against file moves (the tag travels with the file) and synced across
  // Chrome installs on the same Google account. Pages without the tag fall
  // back to the existing global chameleon-theme storage.
  function readProjectKey() {
    try {
      const meta = document.querySelector('meta[name="chameleon-project"]');
      if (!meta) return null;
      const raw = (meta.getAttribute('content') || '').trim();
      // Sanitise: allow alnum / hyphen / underscore / dot, max 64 chars.
      const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64);
      return cleaned || null;
    } catch (e) { return null; }
  }
  let CURRENT_PROJECT_KEY = null; // computed once at injection

  function escapeText(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  const STYLE_ID = '__chameleon-rail-style';
  const VALID_POSITIONS = ['tl', 'tr', 'bl', 'br'];
  const DEFAULT_POSITION = 'tr';
  const DEFAULT_FAVORITES = ['light', 'dark', 'sunset', 'forest', 'midnight', 'claude'];

  const PRESETS = [
    // 'system' is a meta-mode: theme.js resolves it to light/dark via
    // prefers-color-scheme. The half-white/half-black swatch hints at "auto".
    // 'system' is always shown regardless of favorites.
    { mode: 'system',   label: 'System',   gradient: 'linear-gradient(135deg, #ffffff 50%, #0a0a0a 50%)' },
    { mode: 'light',    label: 'Light',    gradient: 'linear-gradient(135deg, #ffffff 50%, #2563eb 50%)' },
    { mode: 'dark',     label: 'Dark',     gradient: 'linear-gradient(135deg, #0a0a0a 50%, #60a5fa 50%)' },
    { mode: 'sunset',   label: 'Sunset',   gradient: 'linear-gradient(135deg, #fff7ed 50%, #ea580c 50%)' },
    { mode: 'forest',   label: 'Forest',   gradient: 'linear-gradient(135deg, #f0fdf4 50%, #15803d 50%)' },
    { mode: 'midnight', label: 'Midnight', gradient: 'linear-gradient(135deg, #030712 50%, #a78bfa 50%)' },
    { mode: 'ocean',    label: 'Ocean',    gradient: 'linear-gradient(135deg, #f0f9ff 50%, #0284c7 50%)' },
    { mode: 'rose',     label: 'Rose',     gradient: 'linear-gradient(135deg, #fff1f2 50%, #e11d48 50%)' },
    { mode: 'slate',    label: 'Slate',    gradient: 'linear-gradient(135deg, #f8fafc 50%, #475569 50%)' },
    { mode: 'lavender', label: 'Lavender', gradient: 'linear-gradient(135deg, #faf5ff 50%, #9333ea 50%)' },
    { mode: 'mint',     label: 'Mint',     gradient: 'linear-gradient(135deg, #f0fdfa 50%, #0d9488 50%)' },
    { mode: 'claude',   label: 'Claude',   gradient: 'linear-gradient(135deg, #faf9f5 50%, #d97757 50%)' },
    { mode: 'graphite', label: 'Graphite', gradient: 'linear-gradient(135deg, #0b0c0d 50%, #14b8a6 50%)' },
    { mode: 'nocturne', label: 'Nocturne', gradient: 'linear-gradient(135deg, #0a0d12 50%, #54acbf 50%)' },
  ];

  // Style axis — orthogonal to PRESETS. Each renders "Aa" in its own font as
  // an inline preview so the user can compare typefaces before choosing.
  const STYLES = [
    { id: 'default',   label: 'Default',   font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' },
    { id: 'editorial', label: 'Editorial', font: 'ui-serif, "Charter", Georgia, "Times New Roman", serif' },
    { id: 'mono',      label: 'Mono',      font: 'ui-monospace, "SF Mono", "JetBrains Mono", monospace' },
  ];

  /* ----------------------------------------------------------------
     Project-aware storage helpers — read/write the user's preference
     against the right backing store depending on whether the page
     declares a chameleon-project tag.
     ---------------------------------------------------------------- */
  function getActiveTheme(cb) {
    chrome.storage.local.get(STORAGE_KEY, function (local) {
      const globalTheme = (local[STORAGE_KEY] && typeof local[STORAGE_KEY] === 'object') ? local[STORAGE_KEY] : {};
      if (CURRENT_PROJECT_KEY) {
        const k = PROJECT_KEY_PREFIX + CURRENT_PROJECT_KEY;
        chrome.storage.sync.get(k, function (sync) {
          const projectTheme = sync[k];
          if (projectTheme && typeof projectTheme === 'object') {
            // Per-project mode/customId override; global style preserved.
            cb(Object.assign({}, globalTheme, projectTheme));
          } else {
            // Tagged page with no per-project pref → inherit global.
            cb(globalTheme);
          }
        });
      } else {
        cb(globalTheme);
      }
    });
  }

  function patchActiveTheme(patch) {
    // patch may carry mode, customId, style. style ALWAYS goes to global;
    // mode/customId go to per-project storage when on a tagged page.
    chrome.storage.local.get(STORAGE_KEY, function (local) {
      const globalTheme = (local[STORAGE_KEY] && typeof local[STORAGE_KEY] === 'object')
        ? Object.assign({}, local[STORAGE_KEY]) : {};

      if ('style' in patch && patch.style !== undefined) {
        globalTheme.style = patch.style;
      }

      const isColorPatch = ('mode' in patch) || ('customId' in patch);
      if (CURRENT_PROJECT_KEY && isColorPatch) {
        const k = PROJECT_KEY_PREFIX + CURRENT_PROJECT_KEY;
        chrome.storage.sync.get(k, function (sync) {
          const existing = (sync[k] && typeof sync[k] === 'object') ? Object.assign({}, sync[k]) : {};
          if ('mode' in patch) existing.mode = patch.mode;
          if ('customId' in patch) {
            if (patch.customId === undefined || patch.customId === null) {
              delete existing.customId;
            } else {
              existing.customId = patch.customId;
            }
          } else if (patch.mode && patch.mode !== 'custom') {
            // Switching to a built-in mode clears stale customId.
            delete existing.customId;
          }
          chrome.storage.sync.set({ [k]: existing });
          if ('style' in patch) chrome.storage.local.set({ [STORAGE_KEY]: globalTheme });
        });
      } else {
        // Untagged page (or style-only patch): write everything to global.
        if ('mode' in patch) globalTheme.mode = patch.mode;
        if ('customId' in patch) {
          if (patch.customId === undefined || patch.customId === null) {
            delete globalTheme.customId;
          } else {
            globalTheme.customId = patch.customId;
          }
        } else if (patch.mode && patch.mode !== 'custom') {
          delete globalTheme.customId;
        }
        chrome.storage.local.set({ [STORAGE_KEY]: globalTheme });
      }
    });
  }

  // ---------- Apply theme via CustomEvent (CSP-safe; no inline script injection) ----------
  // For mode === 'custom' we resolve the palette id into the actual variable
  // overrides before dispatch — theme.js never needs to know about palette
  // storage; it just receives `{ mode: 'custom', custom: {...} }`.
  function resolveTheme(theme, cb) {
    if (theme && theme.mode === 'custom' && theme.customId) {
      chrome.storage.local.get(PALETTES_KEY, function (data) {
        const palettes = data[PALETTES_KEY] || {};
        const palette = palettes[theme.customId];
        if (palette && palette.vars) {
          cb(Object.assign({}, theme, { custom: palette.vars }));
        } else {
          // Palette was deleted — fall back gracefully to the previously-set base.
          cb(Object.assign({}, theme, { mode: 'claude', custom: undefined }));
        }
      });
    } else {
      cb(theme);
    }
  }

  function applyToPage(theme) {
    resolveTheme(theme, function (resolved) {
      function fire() {
        try {
          window.dispatchEvent(new CustomEvent('chameleon:apply-theme', { detail: resolved }));
        } catch (e) { /* swallow */ }
      }
      fire();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fire, { once: true });
      }
    });
  }

  // Resolve project key once at script start (before first apply).
  CURRENT_PROJECT_KEY = readProjectKey();

  // 1) Apply persisted theme as early as possible — project-aware.
  getActiveTheme(function (theme) {
    if (theme && typeof theme === 'object' && Object.keys(theme).length > 0) {
      applyToPage(theme);
    }
  });

  // 2) Listen for storage changes (theme + rail position + favorites + per-project).
  chrome.storage.onChanged.addListener(function (changes, area) {
    // Per-project entries live under chrome.storage.sync.
    if (area === 'sync') {
      if (CURRENT_PROJECT_KEY) {
        const k = PROJECT_KEY_PREFIX + CURRENT_PROJECT_KEY;
        if (changes[k]) {
          getActiveTheme(function (next) {
            if (next && typeof next === 'object') {
              applyToPage(next);
              syncPaletteState(next);
            }
          });
        }
      }
      return;
    }
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      // Global change — only re-apply on this page if the page is untagged
      // (tagged pages are driven by per-project storage). Style is global
      // though, so even on tagged pages a style change should re-apply.
      getActiveTheme(function (next) {
        if (next && typeof next === 'object') {
          applyToPage(next);
          syncPaletteState(next);
        }
      });
    }
    if (changes[POSITION_KEY]) {
      const pos = changes[POSITION_KEY].newValue;
      if (VALID_POSITIONS.indexOf(pos) !== -1) {
        applyPositionToRail(pos);
      }
    }
    if (changes[FAVORITES_KEY]) {
      const favs = changes[FAVORITES_KEY].newValue;
      applyFavorites(Array.isArray(favs) && favs.length ? favs : DEFAULT_FAVORITES);
    }
    if (changes[PALETTES_KEY]) {
      // Re-render the custom-palette section of the rail so adds / renames /
      // deletes show up immediately on already-open tabs.
      rebuildCustomSection(changes[PALETTES_KEY].newValue || {});
      // If the active palette is the one that just changed, re-resolve & apply.
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        const t = data[STORAGE_KEY];
        if (t && t.mode === 'custom') applyToPage(t);
      });
    }
  });

  // ---------- Floating palette injection (only on detected pages) ----------
  function injectPalette() {
    if (document.getElementById(RAIL_ID)) return;
    if (!document.body) return;

    chrome.storage.local.get([POSITION_KEY, STORAGE_KEY, FAVORITES_KEY, PALETTES_KEY], function (data) {
      const pos = VALID_POSITIONS.indexOf(data[POSITION_KEY]) !== -1
        ? data[POSITION_KEY] : DEFAULT_POSITION;
      const theme = (data[STORAGE_KEY] && typeof data[STORAGE_KEY] === 'object')
        ? data[STORAGE_KEY] : { mode: 'light' };
      const favorites = (Array.isArray(data[FAVORITES_KEY]) && data[FAVORITES_KEY].length)
        ? data[FAVORITES_KEY] : DEFAULT_FAVORITES;
      const palettes = (data[PALETTES_KEY] && typeof data[PALETTES_KEY] === 'object')
        ? data[PALETTES_KEY] : {};
      buildRail(pos, theme, favorites, palettes);
    });
  }

  function buildRail(initialPos, initialTheme, initialFavorites, initialPalettes) {
    if (document.getElementById(RAIL_ID)) return;

    // Inject style tag (page CSS variables with safe fallbacks)
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = stylesheet();
      document.head.appendChild(style);
    }

    // Build markup — color (mode) section
    const items = PRESETS.map(p => `
      <button class="__cm-item" data-mode="${p.mode}" role="option" aria-selected="false" type="button">
        <span class="__cm-item-swatch" style="background: ${p.gradient};" aria-hidden="true"></span>
        <span class="__cm-item-name">${p.label}</span>
        <svg class="__cm-item-check" width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.2 L4 7.2 L8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `).join('');

    // Style section
    const styleItems = STYLES.map(s => `
      <button class="__cm-item __cm-style-item" data-style="${s.id}" role="option" aria-selected="false" type="button">
        <span class="__cm-style-preview" style="font-family: ${s.font};" aria-hidden="true">Aa</span>
        <span class="__cm-item-name">${s.label}</span>
        <svg class="__cm-item-check" width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.2 L4 7.2 L8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `).join('');

    const rail = document.createElement('div');
    rail.id = RAIL_ID;
    rail.classList.add('__cm-pos-' + initialPos);
    rail.innerHTML = `
      <button class="__cm-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Chameleon theme">
        <span class="__cm-swatch" aria-hidden="true"></span>
        <svg class="__cm-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 L5 6.5 L7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="__cm-menu" role="listbox" hidden>
        ${CURRENT_PROJECT_KEY ? `
          <div class="__cm-project-banner" role="note" aria-label="Editing per-project preference">
            <svg class="__cm-project-pin" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 1.5l2 4.5 4.5.6-3.3 3.1.8 4.6L8 12l-4 2.3.8-4.6L1.5 6.6 6 6z" fill="currentColor"/>
            </svg>
            <span class="__cm-project-label">project · ${escapeText(CURRENT_PROJECT_KEY)}</span>
          </div>
          <div class="__cm-divider" role="separator"></div>
        ` : ''}
        ${items}
        <div class="__cm-divider __cm-divider-custom" role="separator" data-custom-divider hidden></div>
        <div class="__cm-custom-section" data-custom-section></div>
        <div class="__cm-divider" role="separator"></div>
        ${styleItems}
        <div class="__cm-divider" role="separator"></div>
        <button class="__cm-action" data-action="manage" type="button">
          <svg class="__cm-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <span class="__cm-action-name">Manage themes</span>
        </button>
        <button class="__cm-action" data-action="customize" type="button">
          <svg class="__cm-action-icon __cm-action-icon-customize" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 3a9 9 0 0 1 0 18c-1.7 0-2-1-1.5-1.7.6-.7 1-1.5.5-2.3-.5-.7-1.7-.4-2.3-.2C7.5 17.4 6 16 6 14.4c0-.9.7-1.6 1.7-1.6 1 0 1.6-.7 1.6-1.4 0-.9-1-1-1-2 0-1 1-1.7 2.2-1.7 1 0 1.5.5 2.5.5"/>
          </svg>
          <span class="__cm-action-name">Customize palette</span>
        </button>
        ${isLocalFile() ? `
        <button class="__cm-action __cm-action-chat" data-action="chat" type="button">
          <svg class="__cm-action-icon __cm-action-icon-chat" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 1 1-2.6-5.9L21 4v7l-7 0"/>
            <circle cx="9" cy="13" r="0.7" fill="currentColor"/>
            <circle cx="13" cy="13" r="0.7" fill="currentColor"/>
            <circle cx="17" cy="13" r="0.7" fill="currentColor"/>
          </svg>
          <span class="__cm-action-name">Chat with AI</span>
        </button>
        ` : ''}
        <button class="__cm-settings-toggle" type="button" aria-expanded="false" aria-controls="__cm-position-panel">
          <svg class="__cm-settings-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="2" width="12" height="12" rx="2"/>
            <circle cx="11.5" cy="11.5" r="1.6" fill="currentColor" stroke="none"/>
          </svg>
          <span class="__cm-settings-name">Position</span>
          <svg class="__cm-settings-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 4 L5 6.5 L7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="__cm-position-panel" id="__cm-position-panel" hidden>
          <div class="__cm-position-grid" role="group" aria-label="Rail position">
            <button class="__cm-pos-cell" data-pos="tl" type="button" aria-label="Top left"></button>
            <button class="__cm-pos-cell" data-pos="tr" type="button" aria-label="Top right"></button>
            <button class="__cm-pos-cell" data-pos="bl" type="button" aria-label="Bottom left"></button>
            <button class="__cm-pos-cell" data-pos="br" type="button" aria-label="Bottom right"></button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(rail);

    // Wire up handlers
    const trigger = rail.querySelector('.__cm-trigger');
    const menu = rail.querySelector('.__cm-menu');
    const settingsToggle = rail.querySelector('.__cm-settings-toggle');
    const positionPanel = rail.querySelector('.__cm-position-panel');

    function close() {
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      settingsToggle.setAttribute('aria-expanded', 'false');
      positionPanel.hidden = true;
    }
    function open() {
      trigger.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    }

    trigger.addEventListener('click', e => {
      e.stopPropagation();
      if (trigger.getAttribute('aria-expanded') === 'true') close(); else open();
    });

    // Color (mode) clicks. Routes through patchActiveTheme so tagged pages
    // save to chrome.storage.sync[chameleon-project:<key>], untagged pages
    // save to the global chameleon-theme. Menu stays open after click.
    rail.querySelectorAll('.__cm-item[data-mode]').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        patchActiveTheme({ mode: item.dataset.mode });
      });
    });

    // Style clicks — style is *always* a global setting, even on tagged
    // pages, so the writes land in local chameleon-theme.style.
    rail.querySelectorAll('.__cm-item[data-style]').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        patchActiveTheme({ style: item.dataset.style });
      });
    });

    settingsToggle.addEventListener('click', e => {
      e.stopPropagation();
      const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
      settingsToggle.setAttribute('aria-expanded', !expanded);
      positionPanel.hidden = expanded;
    });

    rail.querySelectorAll('[data-action="manage"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: 'chameleon:open-options' });
        } catch (err) { /* extension may have been reloaded */ }
        close();
      });
    });

    rail.querySelectorAll('[data-action="customize"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: 'chameleon:open-customize' });
        } catch (err) { /* extension may have been reloaded */ }
        close();
      });
    });

    rail.querySelectorAll('[data-action="chat"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: 'chameleon:open-chat' });
        } catch (err) { /* swallow */ }
        close();
      });
    });

    rail.querySelectorAll('.__cm-pos-cell').forEach(cell => {
      cell.addEventListener('click', e => {
        e.stopPropagation();
        const pos = cell.dataset.pos;
        if (VALID_POSITIONS.indexOf(pos) === -1) return;
        chrome.storage.local.set({ [POSITION_KEY]: pos });
        // Apply locally immediately too (so the move feels instant even before
        // onChanged lands)
        applyPositionToRail(pos);
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
    syncPaletteState(initialTheme);
    syncPositionCells(initialPos);
    applyFavorites(initialFavorites || DEFAULT_FAVORITES);
    rebuildCustomSection(initialPalettes || {});
  }

  /* ----------------------------------------------------------------
     Custom palette section in the rail menu — renders one item per
     saved palette. Re-rendered when chrome.storage.local[PALETTES_KEY]
     changes (palette added / renamed / deleted from the customize page).
     ---------------------------------------------------------------- */
  function rebuildCustomSection(palettes) {
    const container = document.querySelector('#' + RAIL_ID + ' [data-custom-section]');
    const divider = document.querySelector('#' + RAIL_ID + ' [data-custom-divider]');
    if (!container) return;
    const ids = Object.keys(palettes || {}).sort(function (a, b) {
      return (palettes[b].updatedAt || 0) - (palettes[a].updatedAt || 0);
    });
    if (ids.length === 0) {
      container.innerHTML = '';
      if (divider) divider.hidden = true;
      return;
    }
    if (divider) divider.hidden = false;
    container.innerHTML = ids.map(function (id) {
      const p = palettes[id];
      const canvas = (p.vars && p.vars.canvas) || '#ffffff';
      const primary = (p.vars && p.vars.primary) || '#000000';
      const grad = 'linear-gradient(135deg, ' + canvas + ' 50%, ' + primary + ' 50%)';
      const safeName = String(p.name || 'Untitled').replace(/[<>"&]/g, function (c) {
        return ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c];
      });
      return '<button class="__cm-item" data-mode="custom" data-custom-id="' + id +
             '" role="option" aria-selected="false" type="button">' +
             '<span class="__cm-item-swatch" style="background: ' + grad + ';" aria-hidden="true"></span>' +
             '<span class="__cm-item-name">' + safeName + '</span>' +
             '<svg class="__cm-item-check" width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">' +
             '<path d="M2 5.2 L4 7.2 L8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
             '</svg></button>';
    }).join('');

    // Wire click handlers for the new items. Same stay-open behaviour as
    // built-in mode/style selection — outside-click closes the menu. Routed
    // through patchActiveTheme for project-aware storage.
    container.querySelectorAll('.__cm-item[data-custom-id]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        patchActiveTheme({ mode: 'custom', customId: item.dataset.customId });
      });
    });

    // Refresh selection state for new items if active theme is one of these
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const t = data[STORAGE_KEY] || {};
      syncPaletteState(t);
    });
  }

  function applyFavorites(favorites) {
    const favSet = {};
    favorites.forEach(id => { favSet[id] = true; });
    document.querySelectorAll('#' + RAIL_ID + ' .__cm-item[data-mode]').forEach(item => {
      const mode = item.dataset.mode;
      // 'system' is always visible regardless of favorites.
      const visible = mode === 'system' || favSet[mode];
      item.classList.toggle('__cm-hidden', !visible);
    });
  }

  function applyPositionToRail(pos) {
    const rail = document.getElementById(RAIL_ID);
    if (!rail) return;
    VALID_POSITIONS.forEach(p => rail.classList.remove('__cm-pos-' + p));
    rail.classList.add('__cm-pos-' + pos);
    syncPositionCells(pos);
  }

  function syncPositionCells(pos) {
    document.querySelectorAll('#' + RAIL_ID + ' .__cm-pos-cell').forEach(cell => {
      cell.classList.toggle('active', cell.dataset.pos === pos);
    });
  }

  function syncPaletteState(theme) {
    if (!theme) return;
    const rail = document.getElementById(RAIL_ID);
    if (rail) {
      rail.classList.toggle('__cm-mode-system', theme.mode === 'system');
    }
    // Color axis
    const mode = theme.mode || 'system';
    const activeCustomId = mode === 'custom' ? (theme.customId || null) : null;
    document.querySelectorAll('#' + RAIL_ID + ' .__cm-item[data-mode]').forEach(item => {
      let selected;
      if (item.dataset.mode === 'custom') {
        // Custom items disambiguate by id, not just mode
        selected = (mode === 'custom' && item.dataset.customId === activeCustomId);
      } else {
        selected = (item.dataset.mode === mode);
      }
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    // Style axis
    const style = theme.style || 'default';
    document.querySelectorAll('#' + RAIL_ID + ' .__cm-item[data-style]').forEach(item => {
      item.setAttribute('aria-selected', item.dataset.style === style ? 'true' : 'false');
    });
  }

  function stylesheet() {
    return `
      #${RAIL_ID} {
        position: fixed !important;
        z-index: 2147483600 !important;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif !important;
        font-size: 14px !important;
        line-height: 1 !important;
        color: var(--text, #0a0a0a) !important;
      }
      #${RAIL_ID} *, #${RAIL_ID} *::before, #${RAIL_ID} *::after { box-sizing: border-box !important; }

      #${RAIL_ID}.__cm-pos-tl { top: 16px !important; left: 16px !important; right: auto !important; bottom: auto !important; }
      #${RAIL_ID}.__cm-pos-tr { top: 16px !important; right: 16px !important; left: auto !important; bottom: auto !important; }
      #${RAIL_ID}.__cm-pos-bl { bottom: 16px !important; left: 16px !important; right: auto !important; top: auto !important; }
      #${RAIL_ID}.__cm-pos-br { bottom: 16px !important; right: 16px !important; left: auto !important; top: auto !important; }

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
      #${RAIL_ID}.__cm-mode-system .__cm-swatch {
        background: linear-gradient(135deg, #ffffff 50%, #0a0a0a 50%) !important;
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
        animation: __cm-fade-down 0.16s ease !important;
      }
      .__cm-menu[hidden] { display: none !important; }

      /* Top corners → menu drops down */
      #${RAIL_ID}.__cm-pos-tl .__cm-menu,
      #${RAIL_ID}.__cm-pos-tr .__cm-menu {
        top: calc(100% + 8px) !important;
        bottom: auto !important;
        animation: __cm-fade-down 0.16s ease !important;
      }
      /* Bottom corners → menu drops up */
      #${RAIL_ID}.__cm-pos-bl .__cm-menu,
      #${RAIL_ID}.__cm-pos-br .__cm-menu {
        bottom: calc(100% + 8px) !important;
        top: auto !important;
        animation: __cm-fade-up 0.16s ease !important;
      }
      /* Left corners → menu align left */
      #${RAIL_ID}.__cm-pos-tl .__cm-menu,
      #${RAIL_ID}.__cm-pos-bl .__cm-menu {
        left: 0 !important;
        right: auto !important;
      }
      /* Right corners → menu align right */
      #${RAIL_ID}.__cm-pos-tr .__cm-menu,
      #${RAIL_ID}.__cm-pos-br .__cm-menu {
        right: 0 !important;
        left: auto !important;
      }

      @keyframes __cm-fade-down {
        from { opacity: 0; transform: translateY(-6px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes __cm-fade-up {
        from { opacity: 0; transform: translateY(6px) scale(0.97); }
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
      .__cm-style-preview {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 18px !important;
        height: 18px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        color: var(--text, #0a0a0a) !important;
        flex-shrink: 0 !important;
        line-height: 1 !important;
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
      .__cm-item.__cm-hidden { display: none !important; }

      .__cm-divider {
        height: 1px !important;
        background: var(--border-subtle, #f0f0f0) !important;
        margin: 5px 6px !important;
      }

      .__cm-settings-toggle,
      .__cm-action {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 7px 10px !important;
        margin: 0 !important;
        background: transparent !important;
        border: 0 !important;
        border-radius: 9px !important;
        font-family: inherit !important;
        font-size: 12px !important;
        color: var(--text-muted, #525252) !important;
        cursor: pointer !important;
        text-align: left !important;
        width: 100% !important;
      }
      .__cm-settings-toggle:hover,
      .__cm-action:hover { background: var(--surface-2, #f4f4f5) !important; color: var(--text, #0a0a0a) !important; }
      .__cm-action-icon { color: #facc15 !important; flex-shrink: 0 !important; }
      .__cm-action-icon-chat { color: var(--primary, #2563eb) !important; }
      .__cm-action-icon-customize { color: var(--accent, #ec4899) !important; }

      .__cm-project-banner {
        display: flex !important;
        align-items: center !important;
        gap: 7px !important;
        padding: 7px 11px 6px !important;
        margin: 0 !important;
        font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace !important;
        font-size: 11px !important;
        letter-spacing: 0.04em !important;
        color: var(--primary, #2563eb) !important;
      }
      .__cm-project-pin { color: inherit !important; flex-shrink: 0 !important; }
      .__cm-project-label {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 220px !important;
      }
      .__cm-divider-custom { display: none !important; }
      .__cm-divider-custom:not([hidden]) { display: block !important; }
      .__cm-action-name { flex: 1 !important; }
      .__cm-settings-icon { flex-shrink: 0 !important; }
      .__cm-settings-name { flex: 1 !important; }
      .__cm-settings-chevron {
        color: inherit !important;
        transition: transform 0.2s ease !important;
        flex-shrink: 0 !important;
      }
      .__cm-settings-toggle[aria-expanded="true"] .__cm-settings-chevron {
        transform: rotate(180deg) !important;
      }

      .__cm-position-panel {
        padding: 6px 8px 4px !important;
      }
      .__cm-position-panel[hidden] { display: none !important; }
      .__cm-position-grid {
        position: relative !important;
        width: 100% !important;
        height: 70px !important;
        background: var(--surface-2, #f4f4f5) !important;
        border: 1px solid var(--border, #e4e4e7) !important;
        border-radius: 8px !important;
      }
      .__cm-pos-cell {
        position: absolute !important;
        width: 14px !important;
        height: 14px !important;
        border: 1.5px solid var(--border-strong, #a1a1aa) !important;
        background: var(--surface, #fafafa) !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        padding: 0 !important;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease !important;
      }
      .__cm-pos-cell:hover {
        border-color: var(--primary, #2563eb) !important;
        transform: scale(1.15) !important;
      }
      .__cm-pos-cell.active {
        background: var(--primary, #2563eb) !important;
        border-color: var(--primary, #2563eb) !important;
      }
      .__cm-pos-cell[data-pos="tl"] { top: 6px !important; left: 6px !important; }
      .__cm-pos-cell[data-pos="tr"] { top: 6px !important; right: 6px !important; }
      .__cm-pos-cell[data-pos="bl"] { bottom: 6px !important; left: 6px !important; }
      .__cm-pos-cell[data-pos="br"] { bottom: 6px !important; right: 6px !important; }
    `;
  }

  function isLocalFile() {
    return location.protocol === 'file:';
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

  // Page-side scripts (e.g. an "Manage themes" button on basic.html) can
  // request the options page via this CustomEvent. The actual openOptionsPage
  // call must happen in the background service worker.
  window.addEventListener('chameleon:open-options', function () {
    try {
      chrome.runtime.sendMessage({ type: 'chameleon:open-options' });
    } catch (e) { /* extension may have been reloaded */ }
  });

})();
