/*
 * Chameleon Chrome extension — popup logic.
 *
 * On open: check whether the active tab declares Chameleon (meta / link / data
 * attribute), and whether the extension is allowed to run on file:// URLs when
 * the active tab is a local file. Toggle the matching notice. The pickers
 * always work — chosen mode and style persist independently for any future
 * Chameleon-aware page.
 */
const STORAGE_KEY = 'chameleon-theme';
const VALID_MODES  = ['system', 'light', 'dark', 'sunset', 'forest', 'midnight'];
const VALID_STYLES = ['default', 'editorial', 'mono'];

async function getCurrent() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  return (stored && typeof stored === 'object') ? stored : { mode: 'system', style: 'default' };
}

async function applyToActiveTab(theme) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [theme],
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

async function setMode(mode) {
  if (!VALID_MODES.includes(mode)) return;
  const current = await getCurrent();
  current.mode = mode;
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
  document.querySelectorAll('.preset[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.querySelectorAll('.preset[data-style]').forEach(b => {
    b.classList.toggle('active', b.dataset.style === style);
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

(async () => {
  const tab = await getActiveTab();
  const [detected, current, fileAccess] = await Promise.all([
    checkActiveTabDetection(),
    getCurrent(),
    checkFileAccess()
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
    statusPill.textContent = 'v1.1';
    statusPill.classList.remove('is-active');
  }

  highlight(current);
})();
