/*
 * Chameleon Chrome extension — table-of-contents sidebar (ISOLATED world,
 * top frame only; loaded before content.js, which owns the on/off toggle).
 *
 * Lists the page's h2/h3 in a panel docked to the right edge and pushes the
 * page left by the panel's width. Works on:
 *   - a Chameleon page read directly (the document itself),
 *   - html-editor's WYSIWYG view (.tiptap.prose-canvas),
 *   - html-editor's preview of other files (a same-origin srcdoc iframe).
 * The list follows edits (MutationObserver, debounced), highlights the
 * section being read, and scrolls to a heading on click — switching a
 * Chameleon .tabs panel or opening a <details> first when the heading is
 * hidden inside one.
 *
 * Exposes self.__chameleonToc = { setOpen(bool) }.
 */
(function () {
  'use strict';

  const PANEL_ID = '__chameleon-toc';
  const STYLE_ID = '__chameleon-toc-style';
  const OPEN_ATTR = 'data-chameleon-toc';
  const WIDTH = 260;
  const SPY_OFFSET = 96; // px from the viewport top that counts as "reading"
  const IGNORE = '#__chameleon-rail, #' + PANEL_ID + ', nav[data-toc]';

  let panel = null;
  let list = null;
  let source = null; // { root, doc, frame }
  let entries = []; // { el, level, text }
  let signature = '';
  let isOpen = false;
  let onClose = null;
  let topObserver = null;
  let frameObserver = null;
  let refreshTimer = 0;
  let spyFrame = 0;
  let pinned = null; // heading just jumped to; stays active while on screen

  // ---------- Where the headings live ----------
  // html-editor keeps views mounted while hidden, so only visible ones count.
  function resolveSource() {
    const tiptap = Array.from(document.querySelectorAll('.tiptap.prose-canvas')).find(visible);
    if (tiptap) return { root: tiptap, doc: document, frame: null };
    for (const frame of document.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      let doc = null;
      try { doc = frame.contentDocument; } catch (e) { /* cross-origin */ }
      if (doc && doc.body && doc.querySelector('meta[name="chameleon"]')) {
        return { root: doc.body, doc: doc, frame: frame };
      }
    }
    return { root: document.body, doc: document, frame: null };
  }

  function collect(root) {
    return Array.from(root.querySelectorAll('h2, h3'))
      .filter(function (h) { return !h.closest(IGNORE) && h.textContent.trim(); })
      .map(function (h) {
        return { el: h, level: h.tagName === 'H2' ? 2 : 3, text: h.textContent.trim().replace(/\s+/g, ' ') };
      });
  }

  // ---------- Panel ----------
  function ensurePanel() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = stylesheet();
      (document.head || document.documentElement).appendChild(style);
    }
    if (panel && panel.isConnected) return;
    panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', '目次');
    panel.innerHTML =
      '<div class="__cm-toc-head">' +
        '<span class="__cm-toc-title">目次</span>' +
        '<button class="__cm-toc-close" type="button" aria-label="目次サイドバーを閉じる">' +
          '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<ol class="__cm-toc-list"></ol>' +
      '<p class="__cm-toc-empty">見出し (h2 / h3) がありません</p>';
    list = panel.querySelector('.__cm-toc-list');
    panel.querySelector('.__cm-toc-close').addEventListener('click', function () {
      if (onClose) onClose(); else setOpen(false);
    });
    list.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-index]');
      if (!btn) return;
      const entry = entries[+btn.dataset.index];
      if (!entry) return;
      // Near the end of a page the heading can't reach the top, so the
      // position rule alone would leave an earlier entry highlighted.
      pinned = entry.el;
      reveal(entry.el);
      spy(); // the jump may not scroll at all (heading already in view)
    });
    document.body.appendChild(panel);
  }

  function render() {
    const next = entries.map(function (e) { return e.level + ':' + e.text; }).join('\n');
    if (next === signature) return;
    signature = next;
    list.innerHTML = '';
    entries.forEach(function (e, i) {
      const li = document.createElement('li');
      li.className = '__cm-toc-h' + e.level;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.index = String(i);
      btn.textContent = e.text;
      btn.title = e.text;
      li.appendChild(btn);
      list.appendChild(li);
    });
    panel.classList.toggle('__cm-toc-is-empty', entries.length === 0);
  }

  // ---------- Following the document ----------
  function refresh() {
    refreshTimer = 0;
    if (!isOpen) return;
    const next = resolveSource();
    if (!source || next.root !== source.root) {
      source = next;
      watchFrame();
    }
    entries = collect(source.root);
    render();
    spy();
  }

  function scheduleRefresh() {
    if (!refreshTimer) refreshTimer = setTimeout(refresh, 250);
  }

  function outsidePanel(records) {
    return records.some(function (r) {
      const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      return !t || !t.closest('#' + PANEL_ID);
    });
  }

  function watchFrame() {
    if (frameObserver) { frameObserver.disconnect(); frameObserver = null; }
    if (!source.frame) return;
    frameObserver = new MutationObserver(scheduleRefresh);
    frameObserver.observe(source.doc.documentElement, { childList: true, subtree: true, characterData: true });
    source.doc.addEventListener('scroll', onScroll, true);
  }

  function onScroll() {
    if (!spyFrame) spyFrame = requestAnimationFrame(spy);
  }

  function onFrameLoad(e) {
    if (e.target && e.target.tagName === 'IFRAME') {
      source = null; // the srcdoc was replaced — re-resolve against the new document
      scheduleRefresh();
    }
  }

  function visible(el) {
    return el.getClientRects().length > 0;
  }

  function spy() {
    spyFrame = 0;
    if (!isOpen || !list) return;
    let active = -1;
    if (pinned) {
      const view = pinned.ownerDocument.defaultView || window;
      const r = pinned.isConnected && visible(pinned) ? pinned.getBoundingClientRect() : null;
      if (r && r.bottom > 0 && r.top < view.innerHeight) {
        active = entries.findIndex(function (e) { return e.el === pinned; });
      } else {
        pinned = null;
      }
    }
    if (active === -1) {
      for (let i = 0; i < entries.length; i++) {
        const el = entries[i].el;
        if (!el.isConnected || !visible(el)) continue;
        if (el.getBoundingClientRect().top <= SPY_OFFSET) active = i;
        else break;
      }
    }
    if (active === -1) {
      active = entries.findIndex(function (e) { return e.el.isConnected && visible(e.el); });
    }
    const buttons = list.querySelectorAll('button[data-index]');
    buttons.forEach(function (b) {
      b.classList.toggle('__cm-toc-active', +b.dataset.index === active);
    });
    const current = buttons[active];
    if (current) {
      // Keep the highlighted entry in view without scrolling the page.
      const top = current.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - current.offsetHeight) {
        list.scrollTop = top - list.clientHeight / 3;
      }
    }
  }

  // Scroll to a heading, first un-hiding it if it sits in an inactive
  // Chameleon tab panel or a closed <details>.
  function reveal(el) {
    const tabPanel = el.closest('.tab-panel');
    const tabs = tabPanel && tabPanel.closest('.tabs');
    if (tabs) {
      const panels = Array.from(tabPanel.parentElement.children).filter(function (c) {
        return c.classList.contains('tab-panel');
      });
      const radios = Array.from(tabs.children).filter(function (c) {
        return c.matches('input[type="radio"]');
      });
      const radio = radios[panels.indexOf(tabPanel)];
      // .checked is a property, never serialized — safe even while editing.
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // `open` is an attribute: in an editable document (html-editor's TipTap
    // view, or its designMode preview) it would be saved into the file, so
    // folds are only opened when merely reading.
    if (!el.isContentEditable) {
      for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
        d.open = true;
      }
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Open / close ----------
  function setOpen(open) {
    open = !!open;
    if (open === isOpen) return;
    isOpen = open;
    const html = document.documentElement;
    if (open) {
      if (!document.body) return;
      ensurePanel();
      html.setAttribute(OPEN_ATTR, '');
      source = null;
      signature = '';
      topObserver = new MutationObserver(function (records) {
        if (outsidePanel(records)) scheduleRefresh();
      });
      topObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('load', onFrameLoad, true);
      window.addEventListener('resize', onScroll);
      refresh();
    } else {
      html.removeAttribute(OPEN_ATTR);
      if (topObserver) { topObserver.disconnect(); topObserver = null; }
      if (frameObserver) { frameObserver.disconnect(); frameObserver = null; }
      if (source && source.frame) source.doc.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('load', onFrameLoad, true);
      window.removeEventListener('resize', onScroll);
      clearTimeout(refreshTimer);
      refreshTimer = 0;
      source = null;
      entries = [];
    }
  }

  function stylesheet() {
    const P = '#' + PANEL_ID;
    return `
      html[${OPEN_ATTR}] { padding-right: ${WIDTH}px !important; }
      ${P} { display: none !important; }
      html[${OPEN_ATTR}] ${P} {
        display: flex !important;
        flex-direction: column !important;
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: ${WIDTH}px !important;
        z-index: 2147483500 !important;
        box-sizing: border-box !important;
        padding: 18px 10px 18px 14px !important;
        background: var(--surface, #fafafa) !important;
        border-left: 1px solid var(--border-subtle, #f0f0f0) !important;
        color: var(--text, #0a0a0a) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", system-ui, sans-serif !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
      }
      /* Leave room for the palette trigger when it sits top-right. */
      html[data-cm-rail-pos="tr"] ${P} { padding-top: 64px !important; }
      ${P} *, ${P} *::before, ${P} *::after { box-sizing: border-box !important; }
      ${P} .__cm-toc-head {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 0 4px 10px 8px !important;
        margin: 0 !important;
      }
      ${P} .__cm-toc-title {
        font-size: 11px !important;
        font-weight: 600 !important;
        letter-spacing: 0.08em !important;
        color: var(--text-subtle, #a1a1aa) !important;
      }
      ${P} .__cm-toc-close {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 24px !important;
        height: 24px !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        border-radius: 6px !important;
        background: transparent !important;
        color: var(--text-subtle, #a1a1aa) !important;
        cursor: pointer !important;
      }
      ${P} .__cm-toc-close:hover { background: var(--surface-2, #f4f4f5) !important; color: var(--text, #0a0a0a) !important; }
      ${P} .__cm-toc-list {
        list-style: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow-y: auto !important;
        flex: 1 1 auto !important;
      }
      ${P} .__cm-toc-list li { margin: 0 !important; padding: 0 !important; list-style: none !important; }
      ${P} .__cm-toc-list button {
        display: block !important;
        width: 100% !important;
        margin: 1px 0 !important;
        padding: 5px 8px !important;
        border: 0 !important;
        border-left: 2px solid transparent !important;
        border-radius: 0 6px 6px 0 !important;
        background: transparent !important;
        color: var(--text-muted, #525252) !important;
        font: inherit !important;
        text-align: left !important;
        cursor: pointer !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      ${P} .__cm-toc-h2 button { font-weight: 500 !important; }
      ${P} .__cm-toc-h3 button { padding-left: 22px !important; font-size: 12px !important; }
      ${P} .__cm-toc-list button:hover { background: var(--surface-2, #f4f4f5) !important; color: var(--text, #0a0a0a) !important; }
      ${P} .__cm-toc-list button.__cm-toc-active {
        color: var(--primary, #2563eb) !important;
        border-left-color: var(--primary, #2563eb) !important;
        background: color-mix(in srgb, var(--primary, #2563eb) 7%, transparent) !important;
      }
      ${P} .__cm-toc-empty { display: none !important; }
      ${P}.__cm-toc-is-empty .__cm-toc-empty {
        display: block !important;
        margin: 4px 8px !important;
        color: var(--text-subtle, #a1a1aa) !important;
        font-size: 12px !important;
      }
    `;
  }

  self.__chameleonToc = {
    setOpen: setOpen,
    // content.js routes the panel's close button through storage so every
    // tab (and the menu's toggle) stays in sync.
    setOnClose: function (fn) { onClose = fn; },
  };
})();
