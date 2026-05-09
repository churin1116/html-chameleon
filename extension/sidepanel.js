/*
 * Chameleon Chrome extension — side panel chat.
 *
 * Edits the user's local HTML file via Claude API. The flow:
 *   1. Read the current file via content-script fetch (same-origin file://)
 *   2. Stream a Claude response with the HTML in a cached system block
 *   3. Extract the proposed full HTML from the response
 *   4. On Apply: prompt for a writable file handle (one OS picker per session),
 *      then save via FileSystem Access API and reload the tab
 */

const API_KEY_KEY = 'chameleon-api-key';
const APPROVE_KEY = 'chameleon-approve-before-apply';

const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 16000;

const SYSTEM_INSTRUCTIONS = `You are an HTML editor assistant for the Chameleon project. The user is viewing an HTML file in their browser and wants to modify it. The current full file is provided in the next system block.

When the user requests a change:
1. Give a brief one-or-two-sentence explanation of what you'll change.
2. Return the COMPLETE updated HTML wrapped in a single \`\`\`html ... \`\`\` code block. Always emit the full file, not a diff or partial snippet.

Rules:
- Preserve <meta name="chameleon">, the theme.css <link>, the theme.js <script>, and any data-theme / data-style / data-chameleon attributes on <html> unless the user explicitly asks you to remove them.
- Make the smallest surgical edit that satisfies the request — do not rewrite or reorganise unrelated parts.
- If the user is just asking a question or no change is needed, answer briefly and DO NOT include a code block.
- Do not include any commentary outside the brief explanation and the code block.`;

// State
let apiKey = '';
let approveBeforeApply = true;
let currentHTML = '';
let currentFileURL = '';
let currentFileName = '';
let fileHandle = null; // FileSystemFileHandle, populated on first save
let activeTabId = null;
let chatHistory = []; // [{role, content}]
let isStreaming = false;

const elements = {
  settingsToggle: document.getElementById('settings-toggle'),
  settingsBody: document.getElementById('settings-body'),
  apiKeyField: document.getElementById('api-key-field'),
  apiKeyMeta: document.getElementById('api-key-meta'),
  approveField: document.getElementById('approve-field'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  messages: document.getElementById('messages'),
  emptyState: document.getElementById('empty-state'),
  hintText: document.getElementById('hint-text'),
  composerInput: document.getElementById('composer-input'),
  composerSend: document.getElementById('composer-send'),
};

// ---------- Settings ----------

async function loadSettings() {
  const data = await chrome.storage.local.get([API_KEY_KEY, APPROVE_KEY]);
  apiKey = data[API_KEY_KEY] || '';
  approveBeforeApply = data[APPROVE_KEY] !== false; // default true

  if (apiKey) {
    elements.apiKeyField.value = apiKey;
    elements.apiKeyMeta.textContent = '';
  } else {
    elements.apiKeyMeta.textContent = 'required to chat';
  }
  elements.approveField.checked = approveBeforeApply;
  updateSendEnabled();
}

elements.apiKeyField.addEventListener('change', async () => {
  const value = elements.apiKeyField.value.trim();
  if (!value) return;
  if (!value.startsWith('sk-ant-')) {
    elements.apiKeyMeta.textContent = "doesn't look like an Anthropic key";
    return;
  }
  await chrome.storage.local.set({ [API_KEY_KEY]: value });
  apiKey = value;
  elements.apiKeyMeta.textContent = 'saved ✓';
  setTimeout(() => { elements.apiKeyMeta.textContent = ''; }, 1500);
  updateSendEnabled();
});

elements.approveField.addEventListener('change', async () => {
  approveBeforeApply = elements.approveField.checked;
  await chrome.storage.local.set({ [APPROVE_KEY]: approveBeforeApply });
});

elements.settingsToggle.addEventListener('click', () => {
  const expanded = elements.settingsToggle.getAttribute('aria-expanded') === 'true';
  elements.settingsToggle.setAttribute('aria-expanded', !expanded);
  elements.settingsBody.hidden = expanded;
});

// React to changes from the options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[API_KEY_KEY]) {
    apiKey = changes[API_KEY_KEY].newValue || '';
    if (apiKey && elements.apiKeyField.value !== apiKey) {
      elements.apiKeyField.value = apiKey;
    }
    updateSendEnabled();
  }
  if (changes[APPROVE_KEY]) {
    approveBeforeApply = changes[APPROVE_KEY].newValue !== false;
    elements.approveField.checked = approveBeforeApply;
  }
});

// ---------- Tab + file context ----------

function setStatus(state, text) {
  elements.statusDot.className = `status-dot status-dot--${state}`;
  elements.statusText.textContent = text;
  elements.statusText.title = text;
}

async function loadActiveFile() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('error', 'No active tab.');
    return;
  }
  if (!tab.url || !tab.url.startsWith('file://')) {
    setStatus('error', 'Chat works only on local file:// pages.');
    return;
  }
  activeTabId = tab.id;
  currentFileURL = tab.url;
  try {
    currentFileName = decodeURIComponent(tab.url.split('/').pop() || 'file.html');
  } catch {
    currentFileName = 'file.html';
  }

  setStatus('working', `Reading ${currentFileName}…`);
  currentHTML = await readFileAsText(tab.url);
  if (currentHTML == null) {
    setStatus('error', "Couldn't read file. Check chrome://extensions → Chameleon → details → 'Allow access to file URLs'.");
    return;
  }
  setStatus('ready', `${currentFileName} — ${formatBytes(currentHTML.length)} loaded`);
  elements.hintText.textContent = `Editing ${currentFileName}`;
  updateSendEnabled();
}

async function readFileAsText(fileUrl) {
  // Side panel runs at chrome-extension:// origin and can fetch file:// URLs
  // directly when the extension has "Allow access to file URLs" enabled.
  // (Content scripts on file:// pages can't even fetch their own URL because
  // Chrome treats every file:// URL as a unique origin.)
  try {
    const r = await fetch(fileUrl);
    if (r.ok) return await r.text();
  } catch (e) {
    console.warn('[Chameleon] direct file fetch failed', e);
  }
  // Fallback: serialize the current DOM via chrome.scripting (in MAIN world).
  // This is lossy vs. source — theme.js will have already applied data-theme
  // and data-chameleon attributes — but it's better than nothing.
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      world: 'MAIN',
      func: () => '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    });
    if (typeof result?.result === 'string') return result.result;
  } catch (e) {
    console.warn('[Chameleon] DOM serialization fallback failed', e);
  }
  return null;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// React to user switching tabs while panel is open
chrome.tabs.onActivated.addListener(() => loadActiveFile());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' && tabId === activeTabId) loadActiveFile();
});

// ---------- Composer ----------

elements.composerInput.addEventListener('input', () => {
  // Auto-resize
  elements.composerInput.style.height = 'auto';
  elements.composerInput.style.height = Math.min(140, elements.composerInput.scrollHeight) + 'px';
  updateSendEnabled();
});

elements.composerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

elements.composerSend.addEventListener('click', sendMessage);

function updateSendEnabled() {
  const hasText = elements.composerInput.value.trim().length > 0;
  const ready = !!apiKey && !!currentHTML && !isStreaming;
  elements.composerSend.disabled = !(hasText && ready);
}

// ---------- Chat ----------

function hideEmptyState() {
  elements.emptyState.style.display = 'none';
}

function appendUserMessage(text) {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message message-user';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  elements.messages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function appendAssistantMessage() {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message message-assistant';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = '…';
  wrap.appendChild(bubble);
  elements.messages.appendChild(wrap);
  scrollToBottom();
  return { wrap, bubble };
}

function appendErrorMessage(text) {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'message message-error';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  elements.messages.appendChild(wrap);
  scrollToBottom();
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function sendMessage() {
  if (elements.composerSend.disabled) return;
  const text = elements.composerInput.value.trim();
  if (!text) return;
  if (!apiKey) {
    appendErrorMessage('Set your Anthropic API key in settings (gear icon, top-right) to start chatting.');
    return;
  }
  if (!currentHTML) {
    appendErrorMessage('No HTML loaded. Open a local .html file and reload the side panel.');
    return;
  }

  appendUserMessage(text);
  elements.composerInput.value = '';
  elements.composerInput.style.height = 'auto';
  isStreaming = true;
  updateSendEnabled();

  const { bubble } = appendAssistantMessage();
  bubble.textContent = '';

  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: [
      { type: 'text', text: SYSTEM_INSTRUCTIONS },
      {
        type: 'text',
        text: `Current HTML file (${currentFileName}):\n\n\`\`\`html\n${currentHTML}\n\`\`\``,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [...chatHistory, { role: 'user', content: text }],
    stream: true,
  };

  let fullText = '';
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errMsg = `${response.status} ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody?.error?.message) errMsg = `${errBody.error.type || 'error'}: ${errBody.error.message}`;
      } catch {}
      bubble.parentElement.remove();
      appendErrorMessage(errMsg);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullText += event.delta.text;
            bubble.textContent = stripHtmlBlock(fullText) || '…working…';
            scrollToBottom();
          }
          // thinking_delta is ignored — adaptive thinking on Opus 4.7 returns
          // empty text by default, and the user doesn't need to see it
        } catch { /* swallow malformed event */ }
      }
    }
  } catch (e) {
    bubble.parentElement.remove();
    appendErrorMessage(`Network error: ${e.message}`);
    isStreaming = false;
    updateSendEnabled();
    return;
  }

  isStreaming = false;
  updateSendEnabled();

  // Update display + extract proposed HTML
  const newHTML = extractHtmlBlock(fullText);
  const displayText = stripHtmlBlock(fullText);
  if (displayText) {
    bubble.innerHTML = renderMarkdown(displayText);
  } else {
    bubble.textContent = '(no textual response)';
  }

  // Compact assistant turn for next request — drop the HTML
  chatHistory.push({ role: 'user', content: text });
  chatHistory.push({
    role: 'assistant',
    content: displayText + (newHTML ? '\n\n[proposed updated HTML omitted from history]' : ''),
  });

  if (newHTML) {
    if (approveBeforeApply) {
      attachApprovalActions(bubble.parentElement, newHTML);
    } else {
      // Auto-apply mode
      await applyChange(bubble.parentElement, newHTML, /*autoApplied=*/true);
    }
  }
}

function stripHtmlBlock(text) {
  return text.replace(/```html\s*\n[\s\S]*?\n```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function extractHtmlBlock(text) {
  const m = text.match(/```html\s*\n([\s\S]*?)\n```/);
  return m ? m[1] : null;
}

// Minimal markdown renderer for assistant bubbles. Handles the subset Claude
// reaches for in chat replies: bold, italic, inline code, fenced code blocks,
// bullet/numbered lists, headings, links, blockquotes, paragraphs.
// Escapes everything else so streamed model output can't inject HTML.
function renderMarkdown(text) {
  const escapeHTML = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Step 1: pull code blocks out before escaping so we can preserve raw text.
  const codeBlocks = [];
  let html = text.replace(/```(\w*)\s*\n([\s\S]*?)\n```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Step 2: pull inline code out for the same reason.
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Step 3: escape the rest. From here on, only well-formed tags we generate
  // will produce real HTML.
  html = escapeHTML(html);

  // Step 4: inline formatting. Bold first (longer match) so we don't eat
  // single-asterisk italics inside bold runs.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Step 5: block-level. Headings → ATX style on their own line.
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes (consecutive `> ` lines collapse into one).
  html = html.replace(/(?:^&gt; .+(?:\n|$))+/gm, match => {
    const inner = match.replace(/^&gt; /gm, '').trim();
    return `<blockquote>${inner.replace(/\n/g, '<br>')}</blockquote>\n`;
  });

  // Bullet lists.
  html = html.replace(/(?:^[-*] .+(?:\n|$))+/gm, match => {
    const items = match.trim().split('\n').map(l => l.replace(/^[-*] /, ''));
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });
  // Numbered lists.
  html = html.replace(/(?:^\d+\. .+(?:\n|$))+/gm, match => {
    const items = match.trim().split('\n').map(l => l.replace(/^\d+\. /, ''));
    return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
  });

  // Step 6: paragraphs. Anything that isn't already a block element gets
  // wrapped in <p>; single newlines inside become <br>.
  const blocks = html.split(/\n\n+/);
  html = blocks.map(b => {
    b = b.trim();
    if (!b) return '';
    if (/^<(h[1-6]|pre|ul|ol|blockquote|\x00CB)/.test(b)) return b;
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Step 7: re-insert code blocks / inline code with escaped contents.
  html = html.replace(/\x00CB(\d+)\x00/g, (_, i) => {
    const { lang, code } = codeBlocks[i];
    const langAttr = lang ? ` class="lang-${escapeHTML(lang)}"` : '';
    return `<pre><code${langAttr}>${escapeHTML(code)}</code></pre>`;
  });
  html = html.replace(/\x00IC(\d+)\x00/g, (_, i) => `<code>${escapeHTML(inlineCodes[i])}</code>`);

  return html;
}

function attachApprovalActions(messageEl, newHTML) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const apply = document.createElement('button');
  apply.className = 'message-action message-action--primary';
  apply.type = 'button';
  apply.textContent = 'Apply & Save';
  apply.addEventListener('click', () => applyChange(messageEl, newHTML, false));

  const discard = document.createElement('button');
  discard.className = 'message-action message-action--danger';
  discard.type = 'button';
  discard.textContent = 'Discard';
  discard.addEventListener('click', () => {
    actions.remove();
    const meta = document.createElement('div');
    meta.className = 'message-meta message-meta-discarded';
    meta.textContent = '✗ Discarded';
    messageEl.appendChild(meta);
  });

  actions.appendChild(apply);
  actions.appendChild(discard);
  messageEl.appendChild(actions);
  scrollToBottom();
}

async function applyChange(messageEl, newHTML, autoApplied) {
  // Remove any existing approval actions
  messageEl.querySelectorAll('.message-actions').forEach(el => el.remove());

  setStatus('working', 'Saving file…');

  try {
    if (!fileHandle) {
      // Prompt user to select the same file once. After this, saves are silent.
      try {
        [fileHandle] = await window.showOpenFilePicker({
          types: [{
            description: 'HTML files',
            accept: { 'text/html': ['.html', '.htm'] },
          }],
          excludeAcceptAllOption: false,
          multiple: false,
        });
      } catch (e) {
        // User cancelled the picker
        setStatus('ready', `${currentFileName} — pick cancelled, change not saved`);
        attachApprovalActions(messageEl, newHTML);
        return;
      }
      const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        fileHandle = null;
        setStatus('error', 'Write permission denied.');
        attachApprovalActions(messageEl, newHTML);
        return;
      }
    }

    const writable = await fileHandle.createWritable();
    await writable.write(newHTML);
    await writable.close();

    currentHTML = newHTML;

    // Reload the page to reflect the new file content
    if (activeTabId) {
      try { await chrome.tabs.reload(activeTabId); } catch {}
    }

    setStatus('ready', `${currentFileName} — saved ✓`);

    const meta = document.createElement('div');
    meta.className = 'message-meta message-meta-applied';
    meta.textContent = autoApplied ? '✓ Saved' : '✓ Applied & saved';
    messageEl.appendChild(meta);
  } catch (e) {
    setStatus('error', `Save failed: ${e.message}`);
    appendErrorMessage(`Couldn't save: ${e.message}`);
    if (!autoApplied) attachApprovalActions(messageEl, newHTML);
  }
}

// ---------- Init ----------

(async () => {
  await loadSettings();
  await loadActiveFile();

  if (!apiKey) {
    elements.settingsToggle.setAttribute('aria-expanded', 'true');
    elements.settingsBody.hidden = false;
  }
})();
