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

## Design quality

The contract above keeps the page *themable*. This section keeps it from looking like
generic AI output. **Read this before writing the first byte of HTML.**

If the user is asking for anything that should "look good" — a report, a dashboard, a
landing page, an artifact they'll show someone — first invoke the **`frontend-design`**
skill mentally for aesthetic direction (tone, typography, spatial composition,
distinctive details). Then translate every aesthetic decision into Chameleon
variables/classes. The two skills compose: frontend-design picks the *what*,
Chameleon enforces the *how*.

### 1. Direction first, palette second

Before touching the keyboard, pick **one** direction and commit:

- *Editorial / paper* — restrained, serif headings, generous whitespace, mono captions. Pairs with `claude` + `editorial`. (See the reference implementation below — this is the safe default.)
- *Quiet utility* — dense data, sans, lots of `--surface-2` rows, mono numbers. Pairs with `light`/`slate` + `default`.
- *Moody / atmospheric* — dark canvas, single accent, ample negative space. Pairs with `midnight`/`dark` + `default`.
- *Terminal / report* — `mono` style, ASCII rules, no rounded corners. Pairs with anything + `mono`.

You are not picking a palette — Chameleon already has those. You are picking which
*part of the contract* to lean on (serif vs sans, dense vs airy, accent-heavy vs
restrained). One direction, executed precisely, beats three half-applied vibes.

### 2. Typography rhythm

Define a small scale up front in the custom `<style>` and reuse it. This is what
keeps editorial pages from feeling like a wall of `font-size: 16px`:

```css
.t-display { font-family: var(--font-serif); font-size: 40px; line-height: 1.1; font-weight: 500; letter-spacing: -0.01em; }
.t-h1      { font-family: var(--font-serif); font-size: 28px; line-height: 1.2; font-weight: 500; letter-spacing: -0.01em; }
.t-h2      { font-family: var(--font-serif); font-size: 22px; line-height: 1.3; font-weight: 500; }
.t-body    { font-family: var(--font-sans);  font-size: 15px; line-height: 1.55; }
.t-small   { font-family: var(--font-sans);  font-size: 13px; line-height: 1.5; color: var(--text-muted); }
.t-caption { font-family: var(--font-mono);  font-size: 11px; line-height: 1.4; color: var(--text-subtle); letter-spacing: 0.06em; text-transform: uppercase; }
```

- Serif for display/h1/h2 only when `data-style="editorial"`. Otherwise lean on the page's `--font-sans`.
- Mono captions/eyebrows are the cheapest "this was designed" signal on a page. Use them.
- Body 14–16px, line-height 1.5–1.6. Don't go below 13 except for captions.

### 3. Spatial composition

- **Container width**: 720–980px for editorial pages. 1100–1280px for dashboards. Never 100vw text.
- **Vertical rhythm**: section gaps in multiples of 8 (32 / 48 / 64). Inside a section, 8/12/16/20.
- **Eyebrows + `<hr>`**: open each section with a mono-uppercase eyebrow, then `<hr>` (Chameleon's auto-styled rule), then the heading. Birchline-style. Cheap, distinctive.
- **Whitespace > dividers**: prefer breathing room over visible borders. Use `--border-subtle` not `--border` for in-card dividers.

### 4. Restraint over noise

Default posture is **calm**. Add atmosphere only when the content invites it.

- **Cards**: 1px `--border` on `--surface`. No drop shadow by default. Editorial cards live and die by border weight + interior padding (18–24px), not by elevation.
- **Borders**: 1px is plenty. 1.5–2px only on hero/structural elements. Avoid 3px+.
- **Radius**: 8–12px for cards, 6px for buttons/inputs, 999px for pills/badges. Don't mix four different radii on one screen.
- **Accents are scarce**: `--primary` shows up 1–2 times per viewport (CTA, one badge). Beyond that, use `--text-muted` or `--text-subtle`.
- **Soft tints** for callouts, status rows, subtle backgrounds — use `color-mix`:
  ```css
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
  ```

### 5. Motion

- Hover: color/border shifts at 120–150ms ease. **No `transform` lifts** unless the page's whole personality is playful.
- Focus: 2–3px soft outline using `color-mix(var(--primary), 18%, transparent)`. Never the browser default.
- Page-load reveals, scroll-triggered animations, parallax: only when explicitly asked. They almost always feel AI-slop on a static report.

### 6. Anti-patterns — the AI-slop checklist

If the page contains any of these, stop and reconsider:

- 🚫 **Glassmorphism** (`backdrop-filter: blur`, semi-transparent white over a gradient) — read as "AI default" instantly.
- 🚫 **Purple/blue gradient backgrounds** — `linear-gradient(135deg, #0f172a, #312e81, ...)` is the single most overused AI aesthetic.
- 🚫 **Glowing accent on dark** with neon halo / box-shadow.
- 🚫 **`transform: translateY(-2px)` on every card hover** — the AI tell of 2024–2025.
- 🚫 **Inter / Roboto / system-ui as the headline font** when an editorial direction was picked.
- 🚫 **"Welcome to ..." h1 + lorem ipsum body + three identical feature cards.**
- 🚫 **Emojis as the only visual element** (decorating headings, bullet points). Use sparingly, for content meaning, not decoration.
- 🚫 **Centering everything**. Left-align body text. Center only display headers and short callouts.
- 🚫 **One card style copy-pasted N times** — vary card density / hierarchy when content varies.

### 7. When in doubt, copy the reference below

The reference implementation in the next section covers ~80% of "report / dashboard /
artifact" cases. Start from it and remove what you don't need rather than building up
from a blank page.

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

## Reference implementation

A self-contained editorial report template. Copy as a starting point; delete the sections
you don't need. Every visual decision routes through Chameleon — switching theme/style
via the Chrome extension repaints the whole page consistently.

```html
<!doctype html>
<html lang="en" data-theme="claude" data-style="editorial">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="chameleon" content="v1">
<title>Q3 Review — Birchline</title>
<link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
<script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 56px 24px 96px;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 920px; margin: 0 auto; }

  /* Type scale — define once, reuse everywhere. */
  .t-eyebrow { font-family: var(--font-mono); font-size: 11px; line-height: 1.4; color: var(--text-subtle); letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 6px; }
  .t-display { font-family: var(--font-serif); font-size: 40px; line-height: 1.1; font-weight: 500; letter-spacing: -0.01em; margin: 0 0 8px; }
  .t-h2      { font-family: var(--font-serif); font-size: 24px; line-height: 1.3; font-weight: 500; margin: 0 0 8px; }
  .t-lead    { font-size: 17px; line-height: 1.55; color: var(--text-muted); margin: 0; max-width: 56ch; }
  .t-caption { font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); letter-spacing: 0.06em; text-transform: uppercase; }

  header.page-header { margin-bottom: 56px; }

  section { margin-bottom: 56px; }
  section > hr { margin: 12px 0 24px; }

  /* Stat row — mono captions over serif numbers. */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
  .stat { padding: 18px 20px; }
  .stat .label { font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px; }
  .stat .value { font-family: var(--font-serif); font-size: 30px; font-weight: 500; line-height: 1; letter-spacing: -0.01em; margin: 0; }
  .stat .delta { font-family: var(--font-mono); font-size: 12px; margin-top: 8px; }

  /* Card grid for items. */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  article.card.note { display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; }
  article.card.note .h { font-size: 15px; font-weight: 500; line-height: 1.45; }
  article.card.note .meta { display: flex; gap: 14px; font-size: 12px; color: var(--text-subtle); }
  article.card.note .meta .key { font-family: var(--font-mono); font-size: 11px; opacity: 0.7; margin-right: 4px; }

  /* Callout — soft tint via color-mix. */
  .callout { padding: 16px 18px; border-radius: 12px; border: 1px solid; }
  .callout.success { background: color-mix(in srgb, var(--success) 10%, transparent); border-color: color-mix(in srgb, var(--success) 30%, transparent); color: var(--success); }
  .callout.warning { background: color-mix(in srgb, var(--warning) 10%, transparent); border-color: color-mix(in srgb, var(--warning) 30%, transparent); color: var(--warning); }

  /* Footer — quiet, mono, full-width hairline. */
  footer.page-footer { margin-top: 80px; padding-top: 16px; border-top: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle); display: flex; justify-content: space-between; }
</style>
</head>
<body class="bg-canvas text-base">
<div class="page">

  <header class="page-header">
    <p class="t-eyebrow">QUARTERLY · INTERNAL</p>
    <h1 class="t-display">Q3 review</h1>
    <p class="t-lead">A short narrative of what shipped, what slipped, and what we're betting on next.
      Numbers below are point-in-time; the dashboard is the source of truth.</p>
  </header>

  <section>
    <p class="t-eyebrow">Numbers</p>
    <hr>
    <div class="stats">
      <div class="card stat">
        <p class="label">Active users</p>
        <p class="value">12,489</p>
        <p class="delta text-success">▲ 12.4% vs Q2</p>
      </div>
      <div class="card stat">
        <p class="label">Conversion</p>
        <p class="value">3.21%</p>
        <p class="delta text-warning">▼ 0.3% vs Q2</p>
      </div>
      <div class="card stat">
        <p class="label">Revenue</p>
        <p class="value">$148k</p>
        <p class="delta text-success">▲ 6.8% vs Q2</p>
      </div>
      <div class="card stat">
        <p class="label">Churn</p>
        <p class="value">1.04%</p>
        <p class="delta text-danger">▲ 0.2% vs Q2</p>
      </div>
    </div>
  </section>

  <section>
    <p class="t-eyebrow">Highlights</p>
    <hr>
    <div class="grid">
      <article class="card note">
        <div class="h">Onboarding rewrite shipped</div>
        <div class="meta"><span><span class="key">owner</span>kana</span><span><span class="key">date</span>2026-09-02</span></div>
      </article>
      <article class="card note">
        <div class="h">Payment processor migration complete</div>
        <div class="meta"><span><span class="key">owner</span>ren</span><span><span class="key">date</span>2026-09-14</span></div>
      </article>
      <article class="card note">
        <div class="h">New self-serve plan tier</div>
        <div class="meta"><span><span class="key">owner</span>aoi</span><span><span class="key">date</span>2026-09-22</span></div>
      </article>
    </div>
  </section>

  <section>
    <p class="t-eyebrow">Notes</p>
    <hr>
    <div style="display: grid; gap: 10px;">
      <div class="callout success">All services nominal — no incidents in 14 days.</div>
      <div class="callout warning">Cache hit rate trending below target — investigate before EOQ.</div>
    </div>
  </section>

  <footer class="page-footer">
    <span>Generated 2026-10-01</span>
    <span>Themed by Chameleon</span>
  </footer>

</div>
</body>
</html>
```

### Why this template works

- **Eyebrow + `<hr>` + heading** is the load-bearing pattern. It signals "designed" before any content arrives.
- **Mono for labels/captions, serif for numbers and headlines, sans for body.** Three voices, never crossed.
- **Cards have no shadow.** Just `--surface` on `--canvas` with a 1px `--border`. The composition does the work, not the elevation.
- **Stats use serif for the number** — small detail, large effect. Sans/mono numbers read as dashboard; serif reads as report.
- **Callouts use `color-mix` for soft tints** — they survive every theme switch (claude/dark/midnight) because they're derived from the semantic state colors, not literal hex.
- **Footer is a thin mono row** — closes the page without competing for attention.

If the user asked for a darker / moodier report, swap `data-theme="claude"` to
`midnight` and the entire page repaints — no other changes needed. That's the
contract paying for itself.

## Final self-check before emitting

- [ ] `<meta name="chameleon" content="v1">` is in the `<head>`.
- [ ] No hardcoded hex/rgb in markup or custom CSS (except theme presets if defining one).
- [ ] `<link>` and `<script>` for theme.css/js are in `<head>`, theme.js without `defer`.
- [ ] `<html>` has both `data-theme` and `data-style` set (page-declared defaults — chosen to fit the artifact, or `light`/`default` when in doubt).
- [ ] Custom `<style>` only contains layout/spacing/typography (no colors).
- [ ] Body uses `bg-canvas` (or another `bg-*` variant).
- [ ] At least one **eyebrow** label appears (mono uppercase) — or the page has a clear stylistic reason to omit it.
- [ ] No glassmorphism, no purple/blue gradient bg, no `translateY(-Xpx)` hover lift. (See § Anti-patterns.)
- [ ] Typography scale defined once, reused — not ad-hoc `font-size:` everywhere.
- [ ] Container `max-width` set (≤980px editorial / ≤1280px dashboard) — not 100vw text.
