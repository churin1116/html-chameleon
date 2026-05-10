/*
 * Chameleon Chrome extension — customize page logic.
 *
 * Manages a list of named user-defined palettes stored as
 * chrome.storage.local['chameleon-custom-palettes'] = { id: { name, vars }, ... }
 *
 * Auto-saves edits. "Apply this palette" sets chrome.storage.local['chameleon-theme']
 * to { mode: 'custom', customId, style }, which content.js resolves into actual
 * CSS variable overrides for every Chameleon-aware page.
 *
 * Bulk paste accepts a `:root { --canvas: #...; ... }` block (or any CSS-ish
 * substring with `--name: value;` declarations) and populates all 23 fields.
 *
 * The AI prompt button copies a templated prompt that asks an LLM to emit a
 * complete 23-variable Chameleon palette in a paste-ready format.
 */
'use strict';

const PALETTES_KEY = 'chameleon-custom-palettes';
const ACTIVE_KEY   = 'chameleon-theme';

/* ----------------------------------------------------------------
   The 23 contract variables, grouped for the editor UI.
   The default values are the Claude theme — used as the seed for
   any new palette so users start from a known-good place.
   ---------------------------------------------------------------- */
const GROUPS = [
  {
    title: 'Surface',
    vars: [
      { key: 'canvas',     label: '--canvas',     default: '#faf9f5' },
      { key: 'surface',    label: '--surface',    default: '#ffffff' },
      { key: 'surface-2',  label: '--surface-2',  default: '#f0eee6' },
    ],
  },
  {
    title: 'Text',
    vars: [
      { key: 'text',         label: '--text',         default: '#141413' },
      { key: 'text-muted',   label: '--text-muted',   default: '#3d3d3a' },
      { key: 'text-subtle',  label: '--text-subtle',  default: '#87867f' },
    ],
  },
  {
    title: 'Brand',
    vars: [
      { key: 'primary',      label: '--primary',      default: '#d97757' },
      { key: 'on-primary',   label: '--on-primary',   default: '#ffffff' },
      { key: 'secondary',    label: '--secondary',    default: '#788c5d' },
      { key: 'on-secondary', label: '--on-secondary', default: '#ffffff' },
      { key: 'accent',       label: '--accent',       default: '#e3dacc' },
      { key: 'on-accent',    label: '--on-accent',    default: '#141413' },
    ],
  },
  {
    title: 'Borders',
    vars: [
      { key: 'border',         label: '--border',         default: '#d1cfc5' },
      { key: 'border-subtle',  label: '--border-subtle',  default: '#f0eee6' },
      { key: 'border-strong',  label: '--border-strong',  default: '#87867f' },
    ],
  },
  {
    title: 'States',
    vars: [
      { key: 'success',     label: '--success',     default: '#788c5d' },
      { key: 'on-success',  label: '--on-success',  default: '#ffffff' },
      { key: 'warning',     label: '--warning',     default: '#c78e3f' },
      { key: 'on-warning',  label: '--on-warning',  default: '#ffffff' },
      { key: 'danger',      label: '--danger',      default: '#b04a4a' },
      { key: 'on-danger',   label: '--on-danger',   default: '#ffffff' },
      { key: 'info',        label: '--info',        default: '#5c7ca3' },
      { key: 'on-info',     label: '--on-info',     default: '#ffffff' },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap(g => g.vars.map(v => v.key));

function defaultVars() {
  const out = {};
  GROUPS.forEach(g => g.vars.forEach(v => { out[v.key] = v.default; }));
  return out;
}

function newId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function isHex(s) {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

/* ----------------------------------------------------------------
   Storage helpers
   ---------------------------------------------------------------- */
async function getPalettes() {
  const data = await chrome.storage.local.get(PALETTES_KEY);
  const stored = data[PALETTES_KEY];
  return (stored && typeof stored === 'object') ? stored : {};
}
async function savePalettes(palettes) {
  await chrome.storage.local.set({ [PALETTES_KEY]: palettes });
}
async function getActive() {
  const data = await chrome.storage.local.get(ACTIVE_KEY);
  return data[ACTIVE_KEY] || {};
}

/* ----------------------------------------------------------------
   Editor state
   ---------------------------------------------------------------- */
let palettes = {};
let selectedId = null;
let saveTimer = null;

/* ----------------------------------------------------------------
   Rendering — sidebar list
   ---------------------------------------------------------------- */
async function renderSidebar() {
  const list = document.getElementById('palette-list');
  const empty = document.getElementById('empty-hint');
  const ids = Object.keys(palettes).sort((a, b) => (palettes[b].updatedAt || 0) - (palettes[a].updatedAt || 0));
  const active = await getActive();
  const activeId = active.mode === 'custom' ? active.customId : null;

  if (ids.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    document.getElementById('editor').hidden = true;
    document.getElementById('welcome').hidden = false;
    return;
  }

  empty.hidden = true;
  document.getElementById('welcome').hidden = true;
  document.getElementById('editor').hidden = false;

  list.innerHTML = ids.map(id => {
    const p = palettes[id];
    const isSel = id === selectedId;
    const isAct = id === activeId;
    const swatch = `linear-gradient(135deg, ${p.vars.canvas || '#fff'} 50%, ${p.vars.primary || '#000'} 50%)`;
    return `
      <li class="palette-item" data-id="${id}" role="option" aria-selected="${isSel ? 'true' : 'false'}" tabindex="0">
        <span class="palette-item__swatch" style="background: ${swatch};" aria-hidden="true"></span>
        <span class="palette-item__name">${escapeHtml(p.name || 'Untitled')}</span>
        ${isAct ? '<span class="palette-item__active-mark">ACTIVE</span>' : ''}
      </li>
    `;
  }).join('');

  list.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => selectPalette(el.dataset.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPalette(el.dataset.id); }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ----------------------------------------------------------------
   Rendering — editor (groups + var rows)
   ---------------------------------------------------------------- */
function renderEditor() {
  if (!selectedId || !palettes[selectedId]) {
    document.getElementById('editor').hidden = true;
    document.getElementById('welcome').hidden = false;
    return;
  }
  const p = palettes[selectedId];
  document.getElementById('palette-name').value = p.name || '';

  const groupsEl = document.getElementById('groups');
  groupsEl.innerHTML = GROUPS.map(g => `
    <div class="group">
      <h3 class="group__title">${g.title}</h3>
      ${g.vars.map(v => {
        const val = p.vars[v.key] || v.default;
        return `
          <div class="var-row">
            <input class="var-row__color" type="color" data-key="${v.key}" value="${normalizeForInput(val)}" aria-label="${v.label} color picker">
            <span class="var-row__name">${v.label}</span>
            <input class="var-row__hex" type="text" data-key="${v.key}" value="${val}" maxlength="9" spellcheck="false" aria-label="${v.label} hex value">
          </div>
        `;
      }).join('')}
    </div>
  `).join('');

  groupsEl.querySelectorAll('.var-row__color').forEach(input => {
    input.addEventListener('input', e => onVarChange(input.dataset.key, e.target.value));
  });
  groupsEl.querySelectorAll('.var-row__hex').forEach(input => {
    input.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (isHex(v)) {
        e.target.classList.remove('is-invalid');
        onVarChange(input.dataset.key, v);
      } else if (v.length === 0) {
        e.target.classList.remove('is-invalid');
      } else {
        e.target.classList.add('is-invalid');
      }
    });
  });

  applyPaletteToPreview(p.vars);
}

/* The native <input type="color"> requires #rrggbb (6-digit) — strip alpha if any. */
function normalizeForInput(hex) {
  if (!isHex(hex)) return '#000000';
  if (hex.length === 4) {
    // #abc → #aabbcc
    return '#' + hex.slice(1).split('').map(c => c + c).join('');
  }
  return hex.slice(0, 7);
}

/* ----------------------------------------------------------------
   Editing actions
   ---------------------------------------------------------------- */
function onVarChange(key, value) {
  const p = palettes[selectedId];
  if (!p) return;
  p.vars[key] = value;
  // Sync color picker / hex input with each other
  document.querySelectorAll(`.var-row__color[data-key="${key}"]`).forEach(el => {
    if (el.value.toLowerCase() !== normalizeForInput(value).toLowerCase()) {
      el.value = normalizeForInput(value);
    }
  });
  document.querySelectorAll(`.var-row__hex[data-key="${key}"]`).forEach(el => {
    if (el.value.toLowerCase() !== value.toLowerCase()) el.value = value;
  });
  applyPaletteToPreview(p.vars);
  scheduleSave();

  // Update sidebar swatch (canvas / primary changes affect the swatch gradient)
  if (key === 'canvas' || key === 'primary') {
    renderSidebar();
  }
}

function applyPaletteToPreview(vars) {
  // Scope the override to the preview card by setting CSS variables on it.
  const preview = document.getElementById('preview-card');
  if (!preview) return;
  ALL_KEYS.forEach(k => {
    if (vars[k]) preview.style.setProperty('--' + k, vars[k]);
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!selectedId) return;
    palettes[selectedId].updatedAt = Date.now();
    await savePalettes(palettes);
    // If this palette is currently active, re-apply so changes take effect on every tab.
    const active = await getActive();
    if (active.mode === 'custom' && active.customId === selectedId) {
      await applyPalette(selectedId, /* updateActive */ false);
    }
  }, 250);
}

document.getElementById('palette-name').addEventListener('input', e => {
  if (!selectedId) return;
  palettes[selectedId].name = e.target.value;
  scheduleSave();
  // Update sidebar item label without full re-render to preserve focus
  const sidebarItem = document.querySelector(`.palette-item[data-id="${selectedId}"] .palette-item__name`);
  if (sidebarItem) sidebarItem.textContent = e.target.value || 'Untitled';
});

/* ----------------------------------------------------------------
   CRUD
   ---------------------------------------------------------------- */
async function createPalette(seedVars) {
  const id = newId();
  const seedCount = Object.keys(palettes).length;
  palettes[id] = {
    name: seedCount === 0 ? 'My palette' : `My palette ${seedCount + 1}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    vars: seedVars || defaultVars(),
  };
  await savePalettes(palettes);
  selectedId = id;
  await renderSidebar();
  renderEditor();
  document.getElementById('palette-name').focus();
  document.getElementById('palette-name').select();
}

async function selectPalette(id) {
  if (!palettes[id]) return;
  selectedId = id;
  await renderSidebar();
  renderEditor();
}

async function duplicatePalette() {
  if (!selectedId) return;
  const src = palettes[selectedId];
  await createPalette({ ...src.vars });
  palettes[selectedId].name = (src.name || 'Untitled') + ' (copy)';
  await savePalettes(palettes);
  await renderSidebar();
  renderEditor();
}

async function deletePalette() {
  if (!selectedId) return;
  const p = palettes[selectedId];
  if (!confirm(`Delete palette "${p.name || 'Untitled'}"? This cannot be undone.`)) return;
  delete palettes[selectedId];
  await savePalettes(palettes);

  // If this was the active palette, fall back to claude.
  const active = await getActive();
  if (active.mode === 'custom' && active.customId === selectedId) {
    await chrome.storage.local.set({ [ACTIVE_KEY]: { mode: 'claude', style: active.style || 'default' } });
  }

  const remaining = Object.keys(palettes);
  selectedId = remaining[0] || null;
  await renderSidebar();
  if (selectedId) renderEditor();
  else document.getElementById('welcome').hidden = false;
}

async function applyPalette(id, updateActive = true) {
  if (!palettes[id]) return;
  if (updateActive) {
    const active = await getActive();
    await chrome.storage.local.set({
      [ACTIVE_KEY]: {
        mode: 'custom',
        customId: id,
        style: active.style || 'default',
      },
    });
  }
  await renderSidebar();
  setStatus(`Applied "${palettes[id].name}". All Chameleon pages will repaint.`, 'success');
}

function setStatus(msg, kind) {
  const el = document.getElementById('editor-status');
  el.textContent = msg;
  el.classList.remove('text-success', 'text-danger', 'text-subtle');
  if (kind === 'success') el.classList.add('text-success');
  else if (kind === 'error') el.classList.add('text-danger');
  else el.classList.add('text-subtle');
}

/* ----------------------------------------------------------------
   Bulk paste — extract `--name: value;` pairs from any CSS-ish text
   ---------------------------------------------------------------- */
function parseCss(text) {
  // Match `--key: value;` pairs anywhere in the input, lenient about wrappers.
  const re = /--([a-zA-Z][a-zA-Z0-9-]*)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;?/g;
  const found = {};
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const val = m[2];
    if (ALL_KEYS.includes(key) && isHex(val)) {
      found[key] = val;
    }
  }
  return found;
}

document.getElementById('btn-apply-css').addEventListener('click', () => {
  if (!selectedId) {
    feedback('Create or select a palette first.', 'error');
    return;
  }
  const text = document.getElementById('bulk-textarea').value;
  const found = parseCss(text);
  const n = Object.keys(found).length;
  if (n === 0) {
    feedback('No matching variables found. Expected --canvas, --primary, etc. as hex values.', 'error');
    return;
  }
  Object.entries(found).forEach(([k, v]) => onVarChange(k, v));
  // Re-render the editor so the new values populate inputs visually
  renderEditor();
  const missing = ALL_KEYS.filter(k => !(k in found));
  if (missing.length === 0) {
    feedback(`Applied all 23 variables ✓`, 'success');
  } else {
    feedback(`Applied ${n} of 23. Missing: ${missing.join(', ')} (kept previous values)`, 'success');
  }
});

document.getElementById('btn-export-css').addEventListener('click', async () => {
  if (!selectedId) return;
  const css = buildCssBlock(palettes[selectedId]);
  try {
    await navigator.clipboard.writeText(css);
    feedback('CSS copied to clipboard ✓', 'success');
  } catch (e) {
    feedback('Clipboard access denied — copy manually from the textarea below.', 'error');
    document.getElementById('bulk-textarea').value = css;
  }
});

function buildCssBlock(palette) {
  const lines = ALL_KEYS.map(k => `  --${k}: ${palette.vars[k] || '#000000'};`).join('\n');
  return `/* ${palette.name || 'Untitled'} — generated by Chameleon Customize */\n:root {\n${lines}\n}\n`;
}

function feedback(msg, kind) {
  const el = document.getElementById('bulk-feedback');
  el.textContent = msg;
  el.classList.remove('is-success', 'is-error');
  if (kind === 'success') el.classList.add('is-success');
  else if (kind === 'error') el.classList.add('is-error');
}

/* ----------------------------------------------------------------
   AI prompt template — copy-to-clipboard
   ---------------------------------------------------------------- */
const AI_PROMPT = `Generate a Chameleon theme palette as a CSS variable block.

OUTPUT FORMAT — return ONLY a fenced \`\`\`css code block in exactly this shape (all 23 variables required, lowercase hex):

\`\`\`css
:root {
  --canvas: #RRGGBB;        /* page background */
  --surface: #RRGGBB;       /* primary card / panel surface */
  --surface-2: #RRGGBB;     /* nested or elevated surface */

  --text: #RRGGBB;          /* primary body text */
  --text-muted: #RRGGBB;    /* secondary text */
  --text-subtle: #RRGGBB;   /* tertiary / metadata text */

  --primary: #RRGGBB;       /* brand color, main CTAs */
  --on-primary: #RRGGBB;    /* readable text on --primary */
  --secondary: #RRGGBB;     /* secondary brand */
  --on-secondary: #RRGGBB;  /* readable text on --secondary */
  --accent: #RRGGBB;        /* accent / highlight surface */
  --on-accent: #RRGGBB;     /* readable text on --accent */

  --border: #RRGGBB;        /* default borders */
  --border-subtle: #RRGGBB; /* very faint dividers */
  --border-strong: #RRGGBB; /* prominent borders */

  --success: #RRGGBB;       /* success state */
  --on-success: #RRGGBB;
  --warning: #RRGGBB;       /* warning state */
  --on-warning: #RRGGBB;
  --danger: #RRGGBB;        /* error / destructive */
  --on-danger: #RRGGBB;
  --info: #RRGGBB;          /* informational */
  --on-info: #RRGGBB;
}
\`\`\`

CONSTRAINTS:
- Cohesive palette — all 23 colors must feel like they belong together
- WCAG AA contrast minimum: --text on --canvas, --text on --surface, each --on-X on its --X
- --on-primary / --on-secondary / --on-accent / --on-success / --on-warning / --on-danger / --on-info are typically white or very light tints, OR very dark when the underlying role is light
- --surface and --surface-2 should be subtle variants of --canvas
- --text-muted and --text-subtle should be muted relatives of --text

PALETTE BRIEF (replace this line with your description):
"A warm, editorial palette inspired by mid-century paperback covers — terracotta primary, deep slate text, ivory paper background"

Return only the css block. No prose, no explanation.`;

document.getElementById('btn-copy-prompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(AI_PROMPT);
    feedback('AI prompt copied — paste into Claude / ChatGPT, then paste the resulting CSS back into the textarea above.', 'success');
  } catch (e) {
    feedback('Clipboard access denied. The prompt is shown in the textarea — copy it manually.', 'error');
    document.getElementById('bulk-textarea').value = AI_PROMPT;
  }
});

/* ----------------------------------------------------------------
   Top-level button wiring
   ---------------------------------------------------------------- */
document.getElementById('btn-new').addEventListener('click', () => createPalette());
document.getElementById('btn-new-welcome').addEventListener('click', () => createPalette());
document.getElementById('btn-duplicate').addEventListener('click', () => duplicatePalette());
document.getElementById('btn-delete').addEventListener('click', () => deletePalette());
document.getElementById('btn-apply').addEventListener('click', () => selectedId && applyPalette(selectedId));

/* React to active-theme changes from elsewhere (popup / floating rail) */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[ACTIVE_KEY]) renderSidebar();
  if (changes[PALETTES_KEY]) {
    palettes = changes[PALETTES_KEY].newValue || {};
    renderSidebar();
    if (selectedId && palettes[selectedId]) renderEditor();
  }
});

/* ----------------------------------------------------------------
   Boot
   ---------------------------------------------------------------- */
(async () => {
  palettes = await getPalettes();
  const ids = Object.keys(palettes);
  if (ids.length > 0) {
    // Prefer the currently-active one if any
    const active = await getActive();
    selectedId = (active.mode === 'custom' && active.customId && palettes[active.customId])
      ? active.customId
      : ids.sort((a, b) => (palettes[b].updatedAt || 0) - (palettes[a].updatedAt || 0))[0];
  }
  await renderSidebar();
  if (selectedId) renderEditor();
})();
