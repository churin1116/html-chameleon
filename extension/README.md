# Chameleon — Chrome extension (v1 stub)

Manifest V3 extension that picks a theme and broadcasts it to every Chameleon-themed
HTML page open in your browser.

## Install (development mode)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select this `extension/` directory

## How it works

1. **popup.html / popup.js** — UI for picking one of the 5 built-in themes. On click, writes to `chrome.storage.local["chameleon-theme"]` and runs a script in the active tab to apply immediately. On open, runs detection on the active tab and shows a "not detected" notice if the page doesn't declare Chameleon.
2. **content.js** — runs at `document_start` on every page. Reads the persisted theme from `chrome.storage` and injects an inline script that writes to the page's `localStorage`, where `theme.js` picks it up. After `DOMContentLoaded`, runs detection and reports the result to the background service worker.
3. **background.js** — receives detection messages and sets a per-tab toolbar badge ("ON" in Chameleon green) so the user can tell at a glance which tabs the extension is active on.
4. **chrome.storage.onChanged** — when the popup updates the theme, content scripts in every tab receive the change and propagate it.

## Detection signals

The extension considers a page to be Chameleon-aware if any of these are present:

| Signal | Where | Set by |
| --- | --- | --- |
| `<meta name="chameleon" content="v1">` | `<head>` | Skill (generate mode), authors |
| `<link rel="stylesheet" href="*html-chameleon*">` | `<head>` | Anyone using the GitHub Pages CSS |
| `<html data-chameleon="v1">` | document root | `theme.js` at load time |

The badge stays empty on pages that match none of these.

## Known limitations (v1 stub)

- **No icons.** Chrome shows the default puzzle-piece icon. Add 16/48/128 PNGs to enable a real icon. *(Phase 3.)*
- **CSP-strict pages.** Pages with a `script-src` that disallows `'unsafe-inline'` will reject the injected `<script>` tag. The popup-driven `chrome.scripting.executeScript` path uses MAIN-world isolation and works in more cases — for those pages, the user can re-pick the theme in the popup while that tab is active.
- **No custom-color UI.** v1 ships only the 5 presets. Custom variable overrides via `Chameleon.setTheme({ custom: {...} })` work programmatically but are not exposed in the popup yet.
- **No `chrome.storage.sync`.** Settings persist locally per browser. Cross-device sync comes in Phase 3.
- **No per-site override.** All sites use the same theme. Per-origin overrides come in Phase 3.

## File layout

```
extension/
├── manifest.json   ← MV3 manifest, permissions, content_scripts
├── popup.html      ← Settings UI
├── popup.css
├── popup.js        ← Picker logic + active-tab injection
├── content.js      ← Cross-page theme propagation
└── README.md       ← this file
```
