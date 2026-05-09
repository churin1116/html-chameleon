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

## Two modes

### Mode 1: `generate` — new HTML

Default when the user is creating something new ("make me an HTML report",
"create an artifact for X", "build a dashboard").

Always emit:

```html
<!DOCTYPE html>
<html data-theme="light">
<head>
  <link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
  <script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
  <!-- ... -->
</head>
<body class="bg-canvas">
  <!-- Use Chameleon utility classes throughout -->
</body>
</html>
```

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

21 CSS variables across 5 categories. Themes implement only these:

| Category | Variables |
| --- | --- |
| Surface | `--canvas`, `--surface`, `--surface-2` |
| Text | `--text`, `--text-muted`, `--text-subtle` |
| Brand | `--primary`, `--on-primary`, `--secondary`, `--on-secondary`, `--accent`, `--on-accent` |
| Borders | `--border`, `--border-subtle`, `--border-strong` |
| States | `--success`, `--on-success`, `--warning`, `--on-warning`, `--danger`, `--on-danger` |

Utility classes (Tailwind-shaped):

- **Backgrounds**: `bg-canvas`, `bg-surface`, `bg-surface-2`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-success`, `bg-warning`, `bg-danger`
- **Text**: `text-base`, `text-muted`, `text-subtle`, `text-primary`, `text-secondary`, `text-accent`, `text-success`, `text-warning`, `text-danger`, `text-on-primary`, `text-on-secondary`
- **Borders**: `border`, `border-subtle`, `border-strong`, `border-primary`
- **Radius**: `rounded`, `rounded-lg`, `rounded-full`
- **Components**: `btn` + `btn-primary`/`btn-secondary`/`btn-ghost`, `alert` + `alert-success`/`alert-warning`/`alert-danger`, `card`, `pill`

## Built-in presets

`light` (default) · `dark` · `sunset` · `forest` · `midnight`

Switch at runtime via:

```js
Chameleon.setTheme({ mode: 'dark' });
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
