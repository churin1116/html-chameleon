# Chameleon — project notes

OSS theme contract for HTML artifacts (21 CSS variables + utility classes), distributed
via GitHub Pages, consumed by a Skill (authoring) and a Chrome extension (viewing).
Full interactive spec: [docs/design.html](docs/design.html).

## Architecture — three components, one contract

| Path | Role |
| --- | --- |
| `theme/v1/` | The contract. **`/v1/` paths are frozen forever**; breaking changes bump to `/v2/`. |
| `skill/` | Claude Code Skill (`generate` / `convert` modes). **Symlinked from `~/.claude/skills/chameleon`** — edits propagate instantly. |
| `extension/` | Chrome MV3. Detects Chameleon and injects a floating theme palette into the top-right of the page. |
| `examples/` | Minimal demos consuming the contract via the hosted CSS. |
| `docs/design.html` | Interactive spec / playground. |

## The 3 detection signals (must stay coherent)

The extension activates on any one of:

1. `<meta name="chameleon" content="v1">` — emitted by the Skill in both modes
2. `<link rel="stylesheet" href="*html-chameleon*">` — implicit when consumers use the hosted CSS
3. `<html data-chameleon="v1">` — set by `theme.js` at runtime

If you add / rename / remove a signal, **update all of** these files in the same commit:
`extension/content.js`, `extension/popup.js`, `extension/README.md`,
`skill/SKILL.md`, `skill/prompts/generate.md`, `skill/prompts/convert.md`.

## Hard rules

- **No hex / rgb literals** in code or markup. Allowed exceptions:
  - `[data-theme="…"]` blocks inside `theme/v1/theme.css` (defining a preset)
  - `PRESETS` array in `extension/content.js` and equivalent inline styles in
    `extension/popup.html` (swatch gradients must show fixed preset colors,
    independent of the page's current theme)
- **Top-right of detected pages belongs to the extension's floating palette.**
  Don't put fixed top-right UI in examples, demos, or Skill-generated artifacts —
  it will collide. Install CTAs go in the page flow.
- **`theme.js` loads in `<head>` WITHOUT `defer`** — synchronous eval prevents FOUC.
  The Skill prompts enforce this; don't "optimize" it.
- **`skill/SKILL.md` frontmatter `name: chameleon` is load-bearing** — the global
  symlink (`~/.claude/skills/chameleon`) and slash invocation (`/chameleon`) both
  rely on it. Renaming requires re-creating the symlink.
- **`.nojekyll` at repo root must stay** — bypasses Jekyll on GitHub Pages so binary
  assets and underscore-prefixed paths serve cleanly.

## Local development

| Action | How |
| --- | --- |
| Reload extension after editing `extension/*` | `chrome://extensions` → reload the Chameleon card |
| Verify Pages change | `git push` to `main` → wait ~30–60s → curl the URL |
| Skill prompt edit | Save the file; propagates instantly via symlink |
| Regenerate icons | `python3` with Pillow on `extension/icons/source.png`; see commit `d548e95` for the rounded-corners script |

## Frozen Pages URLs (don't break)

```
https://churin1116.github.io/html-chameleon/
├── theme/v1/theme.css         ← consumers reference this in <link>
├── theme/v1/theme.js          ← consumers reference this in <script>
├── docs/design.html           ← spec + playground
├── examples/{basic,dashboard}.html
└── favicon.ico                ← rounded primary; *-square.* originals preserved
```

External users embed the `theme/v1/*` URLs in their HTML. Renaming or moving these
breaks them silently — version up to `/theme/v2/` instead.

## Useful cross-references

- User-facing docs: [README.md](README.md)
- Extension specifics: [extension/README.md](extension/README.md)
- Generate-mode prompt: [skill/prompts/generate.md](skill/prompts/generate.md)
- Convert-mode prompt: [skill/prompts/convert.md](skill/prompts/convert.md)
- Open design questions: [docs/design.html#open](docs/design.html)
