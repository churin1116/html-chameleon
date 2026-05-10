# Generate mode — prompt template

When the user asks for a new themable HTML artifact, produce a single self-contained file
that uses the Chameleon contract.

## Required structure

```html
<!DOCTYPE html>
<html lang="<lang>" data-theme="light" data-style="default">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="chameleon" content="v1">
  <title><title></title>
  <link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
  <script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
  <style>
    /* Layout / spacing / typography ONLY — no colors here */
  </style>
</head>
<body class="bg-canvas">
  <!-- Use Chameleon utility classes -->
</body>
</html>
```

The `<meta name="chameleon" content="v1">` tag is **mandatory** in generate mode.
The Chrome extension uses it to detect whether a page should be themable, and
displays a "not detected" notice on pages that lack it.

## Page-declared defaults (`data-theme` / `data-style`)

`<html data-theme="..." data-style="...">` declares the artifact's **preferred
initial appearance**. theme.js applies this on first visit when the reader has
no stored preference yet. Once the reader picks any theme/style via the Chrome
extension, that choice becomes sticky across all Chameleon pages and the
page-declared defaults stop applying.

- Pick the `data-theme` that best fits the artifact's purpose: `claude` for
  warm/editorial Anthropic-feeling pages, `midnight` for moody decks, `forest`
  for calm/natural pages, etc. — see `theme/v1/theme.css` for the full list.
- Pick the `data-style` that fits the typographic feel: `default` (sans),
  `editorial` (serif headings + paper-like cards), `mono` (terminal/ASCII).
- When uncertain, default to `data-theme="light" data-style="default"`.

## Rules

1. **Colors only via classes or variables.** Never write `color: #...`, `background: rgb(...)`, etc. Use:
   - Utility classes: `bg-primary`, `text-muted`, `border`, etc.
   - Or CSS variables in custom styles: `color: var(--primary)`, `background: var(--surface)`
2. **Layout/spacing in custom `<style>`** is fine. Padding, gaps, grid, flex, font-sizes are all theme-independent.
3. **No frameworks alongside.** Don't pull in Tailwind, Bootstrap, etc. unless explicitly asked.
4. **Default to `data-theme="light"`** on the `<html>` element. Theme.js reads `prefers-color-scheme` and overrides if needed.
5. **No theme picker UI** unless the user is building an example/demo. The Chrome extension owns the runtime picker.

## Prefer these patterns

- **Cards**: `<div class="card">` (already styled — surface bg, border, padding)
- **Buttons**: `<button class="btn btn-primary">`, `btn-secondary`, `btn-ghost`
- **Alerts**: `<div class="alert alert-success">`, `alert-warning`, `alert-danger`
- **Pills/tags**: `<span class="pill">`
- **Section dividers**: `<hr>` (uses `--border` automatically)
- **Code blocks**: wrap in `<pre>` with custom layout styles, use `var(--surface-2)` background

## When the design needs more

- For state tints (e.g., a soft success bg), use `color-mix()`:
  ```css
  background: color-mix(in srgb, var(--success) 12%, var(--canvas));
  ```
- For shadows, use `color-mix()` with `--text` for theme-aware shadows:
  ```css
  box-shadow: 0 4px 12px color-mix(in srgb, var(--text) 10%, transparent);
  ```

## Final self-check before emitting

- [ ] `<meta name="chameleon" content="v1">` is in the `<head>`.
- [ ] No hardcoded hex/rgb in markup or custom CSS (except theme presets if defining one).
- [ ] `<link>` and `<script>` for theme.css/js are in `<head>`, theme.js without `defer`.
- [ ] `<html>` has both `data-theme` and `data-style` set (page-declared defaults — chosen to fit the artifact, or `light`/`default` when in doubt).
- [ ] Custom `<style>` only contains layout/spacing/typography (no colors).
- [ ] Body uses `bg-canvas` (or another `bg-*` variant).
