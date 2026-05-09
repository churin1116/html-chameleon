/*
 * Chameleon Chrome extension — popup logic
 * Picks a theme, saves to chrome.storage, applies to the active tab.
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

  // Apply to active tab right away (cross-tab content scripts will handle the rest).
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
          } catch (e) { /* CSP / non-injectable URL */ }
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

document.querySelectorAll('.preset').forEach(b => {
  b.addEventListener('click', () => setTheme(b.dataset.mode));
});

(async () => {
  const current = await getCurrent();
  highlight(current.mode);
})();
