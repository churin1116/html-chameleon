/*
 * Chameleon Chrome extension — popup logic.
 *
 * On open: check whether the active tab declares Chameleon (meta / link / data
 * attribute), and whether the extension is allowed to run on file:// URLs when
 * the active tab is a local file. Toggles the matching notice. The picker
 * always works — chosen theme persists for any future Chameleon-aware page.
 */
const STORAGE_KEY = 'chameleon-theme';
const VALID_MODES = ['light', 'dark', 'sunset', 'forest', 'midnight'];

async function getCurrent() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || { mode: 'light' };
}

async function setTheme(mode) {
  if (!VALID_MODES.includes(mode)) return;
  const theme = { mode };

  await chrome.storage.local.set({ [STORAGE_KEY]: theme });

  // Apply to the active tab if it's injectable.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
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
    }
  } catch (e) { /* tab may be chrome:// etc. */ }

  highlight(mode);
}

function highlight(mode) {
  document.querySelectorAll('.preset').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
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

async function checkActiveTabDetection(tab) {
  if (!tab?.id) return false;
  try {
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
    // chrome://, file:// without permission, etc.
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

document.querySelectorAll('.preset').forEach(b => {
  b.addEventListener('click', () => setTheme(b.dataset.mode));
});

document.getElementById('open-settings-btn')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

(async () => {
  const tab = await getActiveTab();
  const [detected, current, fileAccess] = await Promise.all([
    checkActiveTabDetection(tab),
    getCurrent(),
    checkFileAccess()
  ]);

  const isFileUrl = !!(tab?.url && tab.url.startsWith('file://'));
  const showFileNotice = isFileUrl && !fileAccess;
  // Mutually exclusive: file-access issue is root cause, hide "not detected" if it's set
  const showNotDetectedNotice = !showFileNotice && !detected;

  document.getElementById('file-access-notice').hidden = !showFileNotice;
  document.getElementById('not-detected-notice').hidden = !showNotDetectedNotice;

  const statusPill = document.getElementById('status-pill');
  if (detected) {
    statusPill.textContent = 'on';
    statusPill.classList.add('is-active');
  } else {
    statusPill.textContent = 'v1.0';
    statusPill.classList.remove('is-active');
  }

  highlight(current.mode);
})();
