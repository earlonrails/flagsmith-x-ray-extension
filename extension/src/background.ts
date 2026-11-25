import { OverridesMap, XRayTabState } from './shared/types';

const tabStates = new Map<number, XRayTabState>();

function updateBadge(tabId: number, state: XRayTabState | undefined): void {
  const count = state ? Object.keys(state.overrides || {}).length : 0;
  void chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : '',
  });
  if (count > 0) {
    void chrome.action.setBadgeBackgroundColor({
      tabId,
      color: '#f59e0b',
    });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'XRAY_STATE_UPDATE' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const state = message.state as XRayTabState;
    tabStates.set(tabId, state);
    updateBadge(tabId, state);
    // Broadcast to any open extension UI (popup / devtools panel)
    void chrome.runtime.sendMessage({
      type: 'TAB_STATE_BROADCAST',
      tabId,
      state,
    }).catch(() => {
      // No listeners open
    });
    return false;
  }

  if (message.type === 'GET_TAB_STATE') {
    const tabId = message.tabId as number;
    chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, (resp) => {
      if (chrome.runtime.lastError || !resp?.state) {
        sendResponse({ state: tabStates.get(tabId) ?? null });
      } else {
        const state = resp.state as XRayTabState;
        tabStates.set(tabId, state);
        updateBadge(tabId, state);
        sendResponse({ state });
      }
    });
    return true;
  }

  if (message.type === 'SET_TAB_OVERRIDES') {
    const tabId = message.tabId as number;
    const overrides = (message.overrides || {}) as OverridesMap;
    chrome.tabs.sendMessage(
      tabId,
      { type: 'SET_OVERRIDES', overrides },
      (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (resp?.state) {
          const state = resp.state as XRayTabState;
          tabStates.set(tabId, state);
          updateBadge(tabId, state);
        }
        sendResponse(resp ?? { ok: true });
      }
    );
    return true;
  }

  if (message.type === 'REFRESH_TAB_FLAGS') {
    const tabId = message.tabId as number;
    chrome.tabs.sendMessage(tabId, { type: 'REFRESH_FLAGS' }, (resp) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, liveRefreshed: false });
        return;
      }
      sendResponse(resp ?? { ok: false, liveRefreshed: false });
    });
    return true;
  }

  if (message.type === 'RELOAD_TAB') {
    const tabId = message.tabId as number;
    void chrome.tabs.reload(tabId);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
