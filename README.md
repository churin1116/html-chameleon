<div align="center">

# Chameleon 🦎

**Themable HTML, without the boilerplate.**

<video src="https://github.com/user-attachments/assets/a614ebbc-151e-490b-98fc-6b4410f52c62" controls width="720"></video>

[Interactive design doc](https://churin1116.github.io/html-chameleon/docs/design.html) · [Examples](./examples) · [Skill](./skill) · [Chrome extension](./extension)

</div>

---

## Why?

Once Claude artifacts moved from a 30-line markdown file to a 200-line HTML one, every artifact started baking its own colors, its own dark-mode toggle, its own copy of "what looks good".

Chameleon is the smallest amount of structure that lets:

- one Skill stop reinventing the palette,
- one Chrome extension override every artifact's theme without touching the file,
- a future you read your own HTMLs in your own colors — three months later, on a different laptop, in a different mood.

The goal isn't dark mode. It's that **the artifact and the viewer are different people now** — the model writes the structure, you bring the taste.

## What's in the box

Three components, one shared theme contract.

| Folder | What it does |
| --- | --- |
| [`theme/v1/`](./theme/v1) | The contract: 23 CSS variables + Tailwind-shaped utility classes. Two static files served from GitHub Pages. |
| [`skill/`](./skill) | Claude Code Skill — generates new themed HTML, retrofits existing files via dry-run. |
| [`extension/`](./extension) | Chrome MV3 extension — picks a theme, writes localStorage, every Chameleon-themed artifact repaints. |
| [`examples/`](./examples) | Minimal pages demonstrating the contract. |
| [`docs/design.html`](./docs/design.html) | The interactive design spec. Also the live playground. |

## Quick start

### Make any HTML themable

```html
<!DOCTYPE html>
<html data-theme="light">
<head>
  <link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
  <script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
</head>
<body class="bg-canvas text-base">
  <div class="bg-surface border rounded" style="padding: 1rem;">
    <h1 class="text-primary">Hello, themed world</h1>
    <button class="btn btn-primary">Action</button>
  </div>
</body>
</html>
```

That's it. The page now responds to `data-theme="light|dark|sunset|forest|midnight"`, persists the user's choice via `localStorage`, and falls back to the system `prefers-color-scheme`.

### Use the Skill (Claude Code)

```
chameleon: make this HTML themable
```

The Skill scans inline styles, `<style>` blocks, and SVG `fill` attrs, proposes a color-to-role mapping, and shows a dry-run before touching anything. Confidence below 70% pauses for your sign-off.

### Install the Chrome extension

The `extension/` directory is a working MV3 stub. Load it from `chrome://extensions` in dev mode (Web Store distribution comes later).

## The contract

23 CSS variables, semantic names. Themes implement only these — never pixels:

- **Surface:** `--canvas`, `--surface`, `--surface-2`
- **Text:** `--text`, `--text-muted`, `--text-subtle`
- **Brand:** `--primary`, `--on-primary`, `--secondary`, `--on-secondary`, `--accent`, `--on-accent`
- **Borders:** `--border`, `--border-subtle`, `--border-strong`
- **States:** `--success`, `--on-success`, `--warning`, `--on-warning`, `--danger`, `--on-danger`, `--info`, `--on-info`

Thirteen built-in presets ship with v1: **Light · Dark · Sunset · Forest · Midnight · Ocean · Rose · Slate · Lavender · Mint · Claude · Graphite · Nocturne**. Defining a new preset is ~25 lines of CSS — PRs welcome.

Style is an orthogonal axis (`data-style`): **Default** (sans), **Editorial** (serif headings, paper-like cards), **Mono** (terminal/ASCII). Combine freely with any theme — e.g. `data-theme="claude" data-style="editorial"`.

Authors can declare their preferred initial appearance via `<html data-theme="..." data-style="...">` — these page-declared defaults apply on first visit and are overridden once the reader picks any theme via the extension (the reader's choice is sticky across all Chameleon pages thereafter).

Utility classes mirror Tailwind's mental model but resolve to the variables above:

```html
<div class="bg-surface border-subtle rounded">
  <span class="text-muted">muted text</span>
  <span class="eyebrow">section · 03</span>
  <button class="btn btn-primary">primary action</button>
  <button class="btn btn-danger">destructive</button>
  <span class="badge badge-success">shipped</span>
  <span class="badge badge-info">info</span>
  <div class="alert alert-info">heads-up</div>
  <div class="bg-warning-soft" style="padding: 8px 12px;">soft warning callout</div>
</div>
```

See [`theme/v1/theme.css`](./theme/v1/theme.css) for the full list — including soft-tint backgrounds (`bg-*-soft`), badge / button / alert variants for every semantic colour, and base styles for `<pre>`, `<code>`, `<kbd>`, `<a>`, `<hr>`.

## Versioning

The contract files live under `/theme/v1/`. A breaking change becomes `/theme/v2/`, never a silent regression of `/v1`. Existing HTMLs that pin to `/v1/theme.css` keep working forever.

## Contributing

This is built in the open and PRs are welcome — particularly:

- Theme presets (5 lines of CSS variable definitions)
- New utility classes that stay color-only
- Better SVG / illustration handling in the convert flow

See the [Open Questions section in the design doc](https://churin1116.github.io/html-chameleon/docs/design.html#open) for decisions still being worked through.

## License

MIT — see [LICENSE](./LICENSE).

---

<sub>Built by [@churin1116](https://github.com/churin1116) · powered by HTML, CSS variables, and the suspicion that we should be reading our own artifacts in our own colors.</sub>
