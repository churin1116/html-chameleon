/*
 * Chameleon Chrome extension — options page (manage favorite themes).
 *
 * The dropdown picker (popup + floating palette) is filtered to the user's
 * favorited themes. This page is the single source of truth for that list.
 * Stored as chrome.storage.local['chameleon-favorites'] = [<theme-id>, ...].
 */
const FAVORITES_KEY = 'chameleon-favorites';

const ALL_THEMES = [
  { id: 'light',    label: 'Light',    gradient: 'linear-gradient(135deg, #ffffff 50%, #2563eb 50%)' },
  { id: 'dark',     label: 'Dark',     gradient: 'linear-gradient(135deg, #0a0a0a 50%, #60a5fa 50%)' },
  { id: 'sunset',   label: 'Sunset',   gradient: 'linear-gradient(135deg, #fff7ed 50%, #ea580c 50%)' },
  { id: 'forest',   label: 'Forest',   gradient: 'linear-gradient(135deg, #f0fdf4 50%, #15803d 50%)' },
  { id: 'midnight', label: 'Midnight', gradient: 'linear-gradient(135deg, #030712 50%, #a78bfa 50%)' },
  { id: 'ocean',    label: 'Ocean',    gradient: 'linear-gradient(135deg, #f0f9ff 50%, #0284c7 50%)' },
  { id: 'rose',     label: 'Rose',     gradient: 'linear-gradient(135deg, #fff1f2 50%, #e11d48 50%)' },
  { id: 'slate',    label: 'Slate',    gradient: 'linear-gradient(135deg, #f8fafc 50%, #475569 50%)' },
  { id: 'lavender', label: 'Lavender', gradient: 'linear-gradient(135deg, #faf5ff 50%, #9333ea 50%)' },
  { id: 'mint',     label: 'Mint',     gradient: 'linear-gradient(135deg, #f0fdfa 50%, #0d9488 50%)' },
];

const DEFAULT_FAVORITES = ['light', 'dark', 'sunset', 'forest', 'midnight'];

async function getFavorites() {
  const data = await chrome.storage.local.get(FAVORITES_KEY);
  const stored = data[FAVORITES_KEY];
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.filter(id => ALL_THEMES.some(t => t.id === id));
  }
  return DEFAULT_FAVORITES.slice();
}

async function saveFavorites(favs) {
  await chrome.storage.local.set({ [FAVORITES_KEY]: favs });
}

function render(favorites) {
  const list = document.getElementById('theme-list');
  list.innerHTML = ALL_THEMES.map(t => {
    const fav = favorites.includes(t.id);
    const star = `<svg class="theme-row__star" width="20" height="20" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
    return `
      <button class="theme-row" type="button" role="listitem" data-id="${t.id}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${t.label} — ${fav ? 'favorited' : 'not favorited'}">
        <span class="theme-row__swatch" style="background: ${t.gradient};" aria-hidden="true"></span>
        <span class="theme-row__name">${t.label}</span>
        ${star}
      </button>
    `;
  }).join('');

  list.querySelectorAll('.theme-row').forEach(row => {
    row.addEventListener('click', () => onToggle(row));
  });

  document.getElementById('counter').textContent =
    `${favorites.length} of ${ALL_THEMES.length} favorited`;
}

async function onToggle(row) {
  const id = row.dataset.id;
  let favs = await getFavorites();
  const wasFav = favs.includes(id);

  if (wasFav) {
    if (favs.length === 1) {
      // Don't allow zero favorites — shake instead.
      row.classList.remove('--shake');
      void row.offsetWidth; // force reflow
      row.classList.add('--shake');
      return;
    }
    favs = favs.filter(x => x !== id);
  } else {
    favs = [...favs, id];
  }

  await saveFavorites(favs);
  render(favs);
}

(async () => {
  const favs = await getFavorites();
  render(favs);
})();
