---
name: chameleon
description: |
  Generate or retrofit HTML files to use the Chameleon theme contract — semantic
  CSS variables and Tailwind-shaped utility classes. Two modes: `generate` produces
  new themable HTML; `convert` retrofits existing files via dry-run color-to-role
  mapping.

  Triggers on: "make this themable", "chameleon-ify", "create a themable HTML",
  "apply the chameleon theme", "themable HTML artifact", "Chameleon", "html-chameleon".
user-invocable: true
arguments: "[generate|convert] <optional-file-path>"
---

# Chameleon Skill

This skill helps Claude generate or retrofit HTML to use the
[html-chameleon](https://github.com/churin1116/html-chameleon) theme contract.

## When to use

Activate when the user asks to:

- Create a themable HTML artifact / page / report
- Add dark mode support to existing HTML
- Refactor hardcoded colors out of an HTML file
- Make any HTML "respond to a theme picker"

## Pair with `frontend-design`

Chameleon enforces the *theming contract* — semantic variables, utility classes,
no hex literals. It does **not** automatically produce a *distinctive* design.
For anything the user wants to "look good" (reports, dashboards, landing pages,
artifacts they'll share), invoke the `frontend-design` skill first for aesthetic
direction (tone, typography, spatial composition, anti-AI-slop patterns), then
translate every decision into Chameleon variables and classes.

`prompts/generate.md` § Design quality distills the editorial-style patterns
(eyebrow + `<hr>` + serif heading, mono captions, paper cards with no shadow,
soft tints via `color-mix`) into a copy-pasteable reference implementation. Use
it as the default starting point.

## Two modes

### Mode 1: `generate` — new HTML

Default when the user is creating something new ("make me an HTML report",
"create an artifact for X", "build a dashboard").

Always emit:

```html
<!DOCTYPE html>
<html data-theme="light" data-style="default">
<head>
  <meta name="chameleon" content="v1">
  <link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
  <script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
  <!-- ... -->
</head>
<body class="bg-canvas">
  <!-- Use Chameleon utility classes throughout -->
</body>
</html>
```

The `<meta name="chameleon">` tag is **mandatory** — it's the strongest detection
signal the Chrome extension uses to decide whether to activate on a page. theme.js
also marks the document via `data-chameleon` at runtime, but the meta tag is
explicit, parses earlier, and survives even if theme.js is stripped or fails to
load.

`data-theme` and `data-style` on `<html>` are the **page-declared defaults** —
applied on first visit when the reader has no stored preference. Once the reader
picks any theme/style via the Chrome extension, that choice becomes sticky across
all Chameleon pages and the page-declared defaults stop applying. Pick values
that match the artifact's intent (e.g. `claude` + `editorial` for warm/serif
Anthropic-style pages).

For multi-file projects (a docs site, a roadmap, a dashboard split across many
HTMLs), add `<meta name="chameleon-project" content="<short-name>">` to every
file. The reader's theme pick is then stored per-project in `chrome.storage.sync`
(account-synced, file-move-resilient) instead of the global preference — the
project remembers its own theme separately from other Chameleon-aware pages.
Omit the tag for one-off artifacts that should share the global default.

Keep custom CSS minimal — color/border styles MUST go through the variables.
Layout, spacing, typography sizes are free game.

See [`prompts/generate.md`](./prompts/generate.md) for the full prompt template.

### Mode 2: `convert` — retrofit existing HTML

When given an existing HTML file with hardcoded colors:

1. **Scan** inline `style=""`, `<style>` blocks, and SVG `fill`/`stroke` attrs for color literals.
2. **Cluster** similar colors and **propose** role assignments (primary, surface, border, etc.) with confidence scores.
3. **Dry-run preview** — show the proposed mapping table. Do NOT touch the file yet.
4. **Wait for approval.** Anything below 70% confidence requires explicit user confirmation.
5. **Write changes**, leaving a `.original.html` backup alongside.
6. Respect `data-chameleon="ignore"` on any element — those colors stay untouched on every future pass.

See [`prompts/convert.md`](./prompts/convert.md) for the full prompt template.

## The contract

23 CSS variables across 5 categories. Themes implement only these:

| Category | Variables |
| --- | --- |
| Surface | `--canvas`, `--surface`, `--surface-2` |
| Text | `--text`, `--text-muted`, `--text-subtle` |
| Brand | `--primary`, `--on-primary`, `--secondary`, `--on-secondary`, `--accent`, `--on-accent` |
| Borders | `--border`, `--border-subtle`, `--border-strong` |
| States | `--success`, `--on-success`, `--warning`, `--on-warning`, `--danger`, `--on-danger`, `--info`, `--on-info` |

Utility classes (Tailwind-shaped):

- **Backgrounds**: `bg-canvas`, `bg-surface`, `bg-surface-2`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-success`, `bg-warning`, `bg-danger`, `bg-info`
- **Soft tints** (semantic background washes for callouts / highlight rows): `bg-primary-soft`, `bg-secondary-soft`, `bg-accent-soft`, `bg-success-soft`, `bg-warning-soft`, `bg-danger-soft`, `bg-info-soft`
- **Text**: `text-base`, `text-muted`, `text-subtle`, `text-primary`, `text-secondary`, `text-accent`, `text-success`, `text-warning`, `text-danger`, `text-info`, `text-on-primary`, `text-on-secondary`, `text-on-info`
- **Borders**: `border`, `border-subtle`, `border-strong`, `border-primary`
- **Radius**: `rounded`, `rounded-lg`, `rounded-full`
- **Editorial label**: `eyebrow` (small uppercase mono — recurring section-header pattern)
- **Components**:
  - `btn` + `btn-primary` / `btn-secondary` / `btn-ghost` / `btn-danger` / `btn-info` (hover via color-mix)
  - `alert` + `alert-success` / `alert-warning` / `alert-danger` / `alert-info`
  - `card`, `pill`
  - `badge` + `badge-neutral` / `badge-primary` / `badge-accent` / `badge-success` / `badge-warning` / `badge-danger` / `badge-info` / `badge-solid` (semantic status chips, distinct from neutral `pill`)
  - `details.fold` — **progressive disclosure for low-priority content** (rejected/`没` ideas, appendices, raw evidence). Native `<details>` collapsed **by default** (omit `open`); keep the content, just fold it. Shipped in v1; see `prompts/generate.md` § Progressive disclosure.
- **Structural patterns** (shipped in `theme/v1/theme.css` v1; usage in `prompts/generate.md` § Structural patterns / § Print): `.table` (the most re-implemented pattern, with `.row-em` / `.num` / `.k` cell helpers), `.stat-grid` (at-a-glance KPI strip), `.tabs` (pure-CSS, JS-free, position-based tabs via `:has()`; **opt-in `data-persist="<key>"`** makes theme.js remember the selected tab across reloads + navigation — FOUC-guarded, no per-page script), and a `@media print` block (ships sensible PDF defaults: expand folds/tabs, avoid mid-element breaks, 16mm margins).
- **Base elements** (auto-styled, no class needed): `<code>`, `<pre>`, `<kbd>`, `<samp>`, `<a>`, `<hr>`

## Built-in presets

**Color (`data-theme`):** `light` (default) · `dark` · `sunset` · `forest` · `midnight` · `ocean` · `rose` · `slate` · `lavender` · `mint` · `claude` · `graphite` · `nocturne`

**Style (`data-style`):** `default` (sans) · `editorial` (serif headings, paper-like cards) · `mono` (terminal/ASCII)

Color and style are orthogonal axes — combine freely (e.g. `claude` + `editorial`, `midnight` + `mono`). See [`theme/v1/theme.css`](../theme/v1/theme.css) for the full variable set per preset.

Switch at runtime via:

```js
Chameleon.setTheme({ mode: 'dark', style: 'editorial' });
```

Or with custom variable overrides:

```js
Chameleon.setTheme({
  mode: 'light',
  custom: { primary: '#ff0099', accent: '#00ffaa' }
});
```

## Don'ts

- Do NOT bake `<select>` theme pickers into every artifact unless asked — the
  Chrome extension owns the runtime UI. A picker is fine in *examples* and
  *demos*, not in production reports.
- Do NOT inline hex/rgb colors anywhere except in a `<style>` block defining a
  new theme preset (and even then, prefer adding it to `theme/v1/theme.css`
  upstream).
- Do NOT pull in Tailwind, Bootstrap, or any other framework alongside
  Chameleon — the classes will fight. Layer them only if the user explicitly
  opts in.

## Reference

- Live design doc: <https://churin1116.github.io/html-chameleon/docs/design.html>
- Source: <https://github.com/churin1116/html-chameleon>
- License: MIT
