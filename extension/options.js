/*
 * Chameleon Chrome extension — options page (manage favorite themes).
 *
 * The dropdown picker (popup + floating palette) is filtered to the user's
 * favorited themes. This page is the single source of truth for that list.
 * Stored as chrome.storage.local['chameleon-favorites'] = [<theme-id>, ...].
 */
const FAVORITES_KEY = 'chameleon-favorites';
const PROJECT_KEY_PREFIX = 'chameleon-project:';

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
  { id: 'claude',   label: 'Claude',   gradient: 'linear-gradient(135deg, #faf9f5 50%, #d97757 50%)' },
  { id: 'graphite', label: 'Graphite', gradient: 'linear-gradient(135deg, #0b0c0d 50%, #14b8a6 50%)' },
  { id: 'nocturne', label: 'Nocturne', gradient: 'linear-gradient(135deg, #0a0d12 50%, #54acbf 50%)' },
];

const DEFAULT_FAVORITES = ['light', 'dark', 'sunset', 'forest', 'midnight', 'claude'];

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

// ---------- API key + approve-before-apply settings ----------
const API_KEY_KEY = 'chameleon-api-key';
const APPROVE_KEY = 'chameleon-approve-before-apply';

async function loadSettings() {
  const data = await chrome.storage.local.get([API_KEY_KEY, APPROVE_KEY]);
  const input = document.getElementById('api-key-input');
  const status = document.getElementById('api-key-status');
  const approve = document.getElementById('approve-input');
  if (input && data[API_KEY_KEY]) {
    input.value = data[API_KEY_KEY];
    if (status) status.textContent = 'saved';
  }
  if (approve) {
    // Default to true (approve before apply) when not set
    approve.checked = data[APPROVE_KEY] !== false;
  }
}

document.getElementById('api-key-save')?.addEventListener('click', async () => {
  const input = document.getElementById('api-key-input');
  const status = document.getElementById('api-key-status');
  const value = (input?.value || '').trim();
  if (!value) {
    if (status) status.textContent = '(empty)';
    return;
  }
  if (!value.startsWith('sk-ant-')) {
    if (status) status.textContent = "doesn't look like an Anthropic key";
    return;
  }
  await chrome.storage.local.set({ [API_KEY_KEY]: value });
  if (status) {
    status.textContent = 'saved ✓';
    setTimeout(() => { status.textContent = 'saved'; }, 1500);
  }
});

document.getElementById('approve-input')?.addEventListener('change', async e => {
  await chrome.storage.local.set({ [APPROVE_KEY]: e.target.checked });
});

/* ----------------------------------------------------------------
   Per-project overrides — read all chameleon-project:* entries from
   chrome.storage.sync, render as a deletable list. Each row shows the
   project tag, a tiny swatch derived from the saved palette/preset,
   and a "Reset" button that removes the override (the project then
   falls back to the page-declared <html data-theme>).
   ---------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function getAllProjectOverrides() {
  return new Promise(resolve => {
    chrome.storage.sync.get(null, items => {
      const out = {};
      Object.keys(items || {}).forEach(k => {
        if (k.startsWith(PROJECT_KEY_PREFIX)) {
          out[k.slice(PROJECT_KEY_PREFIX.length)] = items[k];
        }
      });
      resolve(out);
    });
  });
}

function projectThemeLabel(theme) {
  if (!theme) return '—';
  if (theme.mode === 'custom' && theme.customId) return 'custom · ' + theme.customId.slice(0, 8);
  return theme.mode || '—';
}

async function renderProjects() {
  const list = document.getElementById('project-list');
  const empty = document.getElementById('project-empty');
  if (!list) return;
  const overrides = await getAllProjectOverrides();
  const ids = Object.keys(overrides).sort();
  if (ids.length === 0) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  // Get palettes to derive swatch colours for custom-mode entries
  const palettesData = await chrome.storage.local.get('chameleon-custom-palettes');
  const palettes = palettesData['chameleon-custom-palettes'] || {};
  // Map each built-in mode to a swatch gradient (matches PRESETS in content.js)
  const BUILTIN_GRADIENTS = {
    light:    'linear-gradient(135deg, #ffffff 50%, #2563eb 50%)',
    dark:     'linear-gradient(135deg, #0a0a0a 50%, #60a5fa 50%)',
    sunset:   'linear-gradient(135deg, #fff7ed 50%, #ea580c 50%)',
    forest:   'linear-gradient(135deg, #f0fdf4 50%, #15803d 50%)',
    midnight: 'linear-gradient(135deg, #030712 50%, #a78bfa 50%)',
    ocean:    'linear-gradient(135deg, #f0f9ff 50%, #0284c7 50%)',
    rose:     'linear-gradient(135deg, #fff1f2 50%, #e11d48 50%)',
    slate:    'linear-gradient(135deg, #f8fafc 50%, #475569 50%)',
    lavender: 'linear-gradient(135deg, #faf5ff 50%, #9333ea 50%)',
    mint:     'linear-gradient(135deg, #f0fdfa 50%, #0d9488 50%)',
    claude:   'linear-gradient(135deg, #faf9f5 50%, #d97757 50%)',
    graphite: 'linear-gradient(135deg, #0b0c0d 50%, #14b8a6 50%)',
    nocturne: 'linear-gradient(135deg, #0a0d12 50%, #54acbf 50%)',
  };
  list.innerHTML = ids.map(name => {
    const t = overrides[name];
    let grad = BUILTIN_GRADIENTS[t.mode] || 'linear-gradient(135deg, #888 50%, #444 50%)';
    if (t.mode === 'custom' && t.customId && palettes[t.customId]) {
      const v = palettes[t.customId].vars || {};
      grad = `linear-gradient(135deg, ${v.canvas || '#fff'} 50%, ${v.primary || '#000'} 50%)`;
    }
    return `
      <li class="project-row" role="listitem">
        <span class="project-row__swatch" style="background: ${grad};" aria-hidden="true"></span>
        <span class="project-row__name">${escapeHtml(name)}</span>
        <span class="project-row__theme">${escapeHtml(projectThemeLabel(t))}</span>
        <button class="project-row__delete" type="button" data-project="${escapeHtml(name)}">Reset</button>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.project-row__delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.project;
      if (!confirm(`Reset per-project override for "${name}"? The project will fall back to its page-declared default.`)) return;
      await chrome.storage.sync.remove(PROJECT_KEY_PREFIX + name);
      await renderProjects();
    });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (Object.keys(changes).some(k => k.startsWith(PROJECT_KEY_PREFIX))) {
      renderProjects();
    }
  }
});

(async () => {
  const favs = await getFavorites();
  render(favs);
  await renderProjects();
  await loadSettings();
})();
