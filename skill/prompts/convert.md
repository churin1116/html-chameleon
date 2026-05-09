# Convert mode — prompt template

## Input routing — branch by file extension

The input file's extension determines the flow. **Decide based on the
extension alone — do NOT ask the user "what do you want to do?" up-front
when the extension is unambiguous.** The user already invoked `/chameleon`
on this file; that's intent enough.

| Extension | Flow | Section |
| --- | --- | --- |
| `.html` | Retrofit existing HTML (color mapping + dry-run) | "Workflow" below |
| `.md`   | Render Markdown to themed HTML (no color mapping needed) | "Markdown input" near the end |

Only call `AskUserQuestion` for clarification if:
- The file has no extension or an unrecognized one
- Inside one of the flows, an explicit decision step requires it (e.g., the source-disposition question after MD render, or a confidence-< 70% color mapping during HTML retrofit)

---

When given an existing HTML file with hardcoded colors, retrofit it to use Chameleon
WITHOUT writing the file in a single shot. Always dry-run first.

## Workflow

### Step 1 — Scan

Extract every color literal in the file:

- Inline `style="color: #..."` / `background: #...` / `border: 1px solid #...`
- `<style>` blocks: every `color:`, `background:`, `border-color:`, `box-shadow:` value
- SVG attributes: `fill="..."`, `stroke="..."`, `stop-color="..."`
- Computed via `var()` already? Skip — already themed.

Build a deduplicated list with usage counts.

### Step 2 — Cluster + propose roles

Group visually similar colors (within ~ΔE 5–10) and propose a Chameleon role for each cluster:

| Original color(s) | Usage hint | Proposed role | Confidence |
| --- | --- | --- | --- |
| `#1a1a2e` (12 uses) | most common dark, used as page bg | `--canvas` | 92% |
| `#e94560` (4 uses) | used on `<button>` and CTA `<a>` | `--primary` | 88% |
| `#0f3460` (2 uses) | used on `<h2>` color | `--secondary` | 64% |
| `#16213e` (3 uses) | used as `border-color` | `--border` | 58% |

**Confidence rubric:**

- **≥90%**: Color is on a structural element with obvious semantic role (page bg, primary button, etc.)
- **70–89%**: Role is plausible but element type is ambiguous
- **<70%**: Pause and ASK the user before mapping

### Step 3 — Dry-run preview

Show the proposed mapping table. Do NOT touch the file yet. Wait for the user to:

- Approve all
- Approve some, reject others
- Suggest different role assignments

### Step 4 — Apply

Once approved:

1. Save the original as `<filename>.original.html` (or `.bak.html`).
2. Replace each color literal with the corresponding Chameleon class or `var(--role)` reference.
3. Add `<meta name="chameleon" content="v1">` to `<head>` (mandatory — used by the Chrome extension to detect Chameleon-aware pages).
4. Add the `<link>` and `<script>` for theme.css / theme.js to `<head>`.
5. Add `data-theme="light"` to `<html>` if not present.
6. Print a summary: N colors converted, N classes added, N elements opted out via `data-chameleon="ignore"`.

## Replacement strategy

Prefer the most specific representation:

- Pure background → `class="bg-surface"` (drop the inline `background`)
- Pure text color → `class="text-muted"` (drop the inline `color`)
- Border → `class="border"` (drop the inline `border-color`, keep `border-width` if non-standard)
- Mixed inline (color + bg + radius) → keep `<style>` but change values to `var(--*)`

## Opt-outs

NEVER touch elements with:

- `data-chameleon="ignore"` — explicit user opt-out
- Brand-locked colors (logos, icons, illustrations) — heuristic: SVG paths inside elements with class containing "logo" or "icon"
- `<img>` with PNG/JPG sources (can't theme raster colors)

When in doubt, mark as `confidence: low` and ask.

## Reporting

After Step 4, output a summary block:

```
Chameleon retrofit summary
──────────────────────────
File:        report.html
Converted:   17 color literals → 6 roles
Added:       <link> + <script> in <head>, data-theme="light" on <html>
Opted out:   3 SVG illustrations (preserved)
Backup:      report.original.html
Open issues: 2 colors with confidence <70% (see review block above)
```

If any open issues remain, list them so the user can apply manual fixes.

## Markdown (`.md`) input — handle the source after conversion

When the input file has a `.md` extension, the themed HTML is written to a
sibling file (`<basename>.html`) and the source `.md` is NOT modified by the
conversion itself.

**Before reporting completion, always invoke the `AskUserQuestion` tool** to
let the user decide what happens to the source `.md`. Do not ask via
free-text confirmation — use the structured tool. Options:

| Option | Action |
| --- | --- |
| Keep as-is (recommended) | No-op — `.md` remains at its original path |
| Delete the original | Remove `<basename>.md` |
| Archive with date suffix | Rename `<basename>.md` → `<basename>_<YYYYMMDD>.md` (e.g., `notes.md` → `notes_20260509.md`) |

Use today's local date in `YYYYMMDD` format (8 digits, no separators). Apply
the user's choice immediately, and include the result in the summary
(`Source kept` / `Source deleted` / `Source archived as <filename>`).
