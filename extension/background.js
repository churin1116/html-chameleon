/*
 * Chameleon Chrome extension — background service worker (MV3).
 *
 * Owns per-tab badge state. Content scripts on each tab detect whether the page
 * declares Chameleon and report here; we set / clear the toolbar badge so the
 * user can tell at a glance whether the extension has anything to do on the
 * current page.
 *
 * MV3 service workers can be terminated when idle, so we don't hold critical
 * state in memory — popup re-runs detection on demand via chrome.scripting.
 */
const BADGE_TEXT = 'ON';
const BADGE_BG = '#84cc16'; // Chameleon green (lime-500)

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Detection result → toolbar badge
  if (msg?.type === 'chameleon:detection' && sender.tab?.id) {
    const tabId = sender.tab.id;
    if (msg.detected) {
      chrome.action.setBadgeText({ tabId, text: BADGE_TEXT });
      chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
      }
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
    return;
  }

  // Page-side request to open the favorites/options page (basic.html etc.).
  // Content scripts can't call chrome.runtime.openOptionsPage themselves;
  // the background service worker must do it.
  if (msg?.type === 'chameleon:open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
});

// Clear the badge while a tab is reloading / navigating so stale state doesn't
// leak into the new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});
