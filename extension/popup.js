/*
 * Chameleon Chrome extension — popup logic.
 *
 * On open: check whether the active tab declares Chameleon (meta / link / data
 * attribute), and whether the extension is allowed to run on file:// URLs when
 * the active tab is a local file. Toggle the matching notice. The pickers
 * always work — chosen mode and style persist independently for any future
 * Chameleon-aware page.
 *
 * Theme list is filtered to the user's favorites (managed on the options
 * page). 'system' is always visible regardless of favorites.
 */
const STORAGE_KEY = 'chameleon-theme';
const FAVORITES_KEY = 'chameleon-favorites';
const PALETTES_KEY = 'chameleon-custom-palettes';
const VALID_MODES  = ['system', 'light', 'dark', 'sunset', 'forest', 'midnight', 'ocean', 'rose', 'slate', 'lavender', 'mint', 'claude', 'graphite', 'nocturne', 'custom'];
const VALID_STYLES = ['default', 'editorial', 'mono'];
const DEFAULT_FAVORITES = ['light', 'dark', 'sunset', 'forest', 'midnight', 'claude'];

async function getCurrent() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  return (stored && typeof stored === 'object') ? stored : { mode: 'system', style: 'default' };
}

async function getFavorites() {
  const data = await chrome.storage.local.get(FAVORITES_KEY);
  const stored = data[FAVORITES_KEY];
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return DEFAULT_FAVORITES.slice();
}

async function getPalettes() {
  const data = await chrome.storage.local.get(PALETTES_KEY);
  return (data[PALETTES_KEY] && typeof data[PALETTES_KEY] === 'object') ? data[PALETTES_KEY] : {};
}

/* For mode === 'custom', resolve the palette id into the actual variable
   overrides before sending to the page — page-side theme.js doesn't know
   about the palettes store, only `{ mode, custom: {...} }`. */
async function resolveTheme(theme) {
  if (theme && theme.mode === 'custom' && theme.customId) {
    const palettes = await getPalettes();
    const palette = palettes[theme.customId];
    if (palette && palette.vars) {
      return Object.assign({}, theme, { custom: palette.vars });
    }
  }
  return theme;
}

async function applyToActiveTab(theme) {
  try {
    const resolved = await resolveTheme(theme);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [resolved],
      func: (t) => {
        try {
          localStorage.setItem('chameleon-theme', JSON.stringify(t));
          if (window.Chameleon && typeof window.Chameleon.setTheme === 'function') {
            window.Chameleon.setTheme(t);
          }
        } catch (e) { /* CSP / non-injectable */ }
      }
    });
  } catch (e) { /* tab may be chrome:// etc. */ }
}

async function setMode(mode, customId) {
  if (!VALID_MODES.includes(mode)) return;
  const current = await getCurrent();
  current.mode = mode;
  if (mode === 'custom' && customId) {
    current.customId = customId;
  } else {
    delete current.customId;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: current });
  await applyToActiveTab(current);
  highlight(current);
}

async function setStyle(style) {
  if (!VALID_STYLES.includes(style)) return;
  const current = await getCurrent();
  current.style = style;
  await chrome.storage.local.set({ [STORAGE_KEY]: current });
  await applyToActiveTab(current);
  highlight(current);
}

function highlight(theme) {
  const mode = theme.mode || 'system';
  const style = theme.style || 'default';
  const customId = mode === 'custom' ? (theme.customId || null) : null;
  document.querySelectorAll('.preset[data-mode]').forEach(b => {
    if (b.dataset.mode === 'custom') {
      b.classList.toggle('active', mode === 'custom' && b.dataset.customId === customId);
    } else {
      b.classList.toggle('active', b.dataset.mode === mode);
    }
  });
  document.querySelectorAll('.preset[data-style]').forEach(b => {
    b.classList.toggle('active', b.dataset.style === style);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderCustomPalettes(palettes, currentTheme) {
  const container = document.getElementById('custom-palettes');
  if (!container) return;
  const ids = Object.keys(palettes).sort((a, b) => (palettes[b].updatedAt || 0) - (palettes[a].updatedAt || 0));
  if (ids.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  const activeCustomId = currentTheme.mode === 'custom' ? (currentTheme.customId || null) : null;
  container.innerHTML = `
    <div class="popup__divider" role="separator"></div>
    <div class="popup__sublabel">Your palettes</div>
    ${ids.map(id => {
      const p = palettes[id];
      const canvas = (p.vars && p.vars.canvas) || '#ffffff';
      const primary = (p.vars && p.vars.primary) || '#000000';
      const isActive = id === activeCustomId;
      return `
        <button class="preset ${isActive ? 'active' : ''}" data-mode="custom" data-custom-id="${id}" type="button">
          <span class="preset__swatch" style="background: linear-gradient(135deg, ${canvas} 50%, ${primary} 50%);"></span>
          <span class="preset__name">${escapeHtml(p.name || 'Untitled')}</span>
          <svg class="preset__check" width="11" height="11" viewBox="0 0 10 10"><path d="M2 5.2 L4 7.2 L8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      `;
    }).join('')}
  `;
  container.querySelectorAll('.preset[data-custom-id]').forEach(b => {
    b.addEventListener('click', () => setMode('custom', b.dataset.customId));
  });
}

function applyFavorites(favorites) {
  const favSet = new Set(favorites);
  document.querySelectorAll('.preset[data-mode]').forEach(b => {
    const mode = b.dataset.mode;
    // 'system' is always visible regardless of favorites
    const visible = mode === 'system' || favSet.has(mode);
    b.classList.toggle('preset--hidden', !visible);
  });
}

async function checkActiveTabDetection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return false;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!(
        document.querySelector('meta[name="chameleon"]') ||
        document.querySelector('link[rel="stylesheet"][href*="html-chameleon"]') ||
        document.documentElement.hasAttribute('data-chameleon')
      )
    });
    return !!(result && result.result);
  } catch (e) {
    return false;
  }
}

function checkFileAccess() {
  return new Promise(resolve => {
    if (!chrome.extension || typeof chrome.extension.isAllowedFileSchemeAccess !== 'function') {
      resolve(false);
      return;
    }
    try {
      chrome.extension.isAllowedFileSchemeAccess(allowed => resolve(!!allowed));
    } catch (e) {
      resolve(false);
    }
  });
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) {
    return null;
  }
}

document.querySelectorAll('.preset[data-mode]').forEach(b => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});
document.querySelectorAll('.preset[data-style]').forEach(b => {
  b.addEventListener('click', () => setStyle(b.dataset.style));
});

document.getElementById('open-settings-btn')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

document.getElementById('manage-themes-btn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('customize-palette-btn')?.addEventListener('click', () => {
  try {
    chrome.runtime.sendMessage({ type: 'chameleon:open-customize' });
  } catch (e) { /* extension may have been reloaded */ }
  window.close();
});

// Re-render visibility when favorites or custom palettes change in another context.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[FAVORITES_KEY]) {
    const favs = changes[FAVORITES_KEY].newValue;
    applyFavorites(Array.isArray(favs) && favs.length ? favs : DEFAULT_FAVORITES);
  }
  if (changes[PALETTES_KEY] || changes[STORAGE_KEY]) {
    const [palettes, current] = await Promise.all([getPalettes(), getCurrent()]);
    renderCustomPalettes(palettes, current);
    highlight(current);
  }
});

(async () => {
  const tab = await getActiveTab();
  const [detected, current, fileAccess, favorites, palettes] = await Promise.all([
    checkActiveTabDetection(),
    getCurrent(),
    checkFileAccess(),
    getFavorites(),
    getPalettes(),
  ]);

  const isFileUrl = !!(tab?.url && tab.url.startsWith('file://'));
  const showFileNotice = isFileUrl && !fileAccess;
  const showNotDetectedNotice = !showFileNotice && !detected;

  document.getElementById('file-access-notice').hidden = !showFileNotice;
  document.getElementById('not-detected-notice').hidden = !showNotDetectedNotice;

  const statusPill = document.getElementById('status-pill');
  if (detected) {
    statusPill.textContent = 'on';
    statusPill.classList.add('is-active');
  } else {
    statusPill.textContent = 'v1.4';
    statusPill.classList.remove('is-active');
  }

  applyFavorites(favorites);
  renderCustomPalettes(palettes, current);
  highlight(current);
})();
