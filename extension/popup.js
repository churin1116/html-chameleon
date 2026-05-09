/*
 * Chameleon Chrome extension — popup logic.
 *
 * On open: check whether the active tab declares Chameleon (meta / link / data
 * attribute). Toggle the "not detected" notice accordingly. The picker still
 * works on non-Chameleon pages — the chosen theme persists for the next
 * Chameleon-aware page the user visits.
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

document.querySelectorAll('.preset').forEach(b => {
  b.addEventListener('click', () => setTheme(b.dataset.mode));
});

(async () => {
  const [detected, current] = await Promise.all([
    checkActiveTabDetection(),
    getCurrent()
  ]);

  document.getElementById('not-detected-notice').hidden = detected;
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
