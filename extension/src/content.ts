import {
  EXTENSION_SOURCE,
  INTERCEPTOR_SOURCE,
  OverridesMap,
  XRayTabState,
} from './shared/types';

const pendingRequests = new Map<string, (payload: unknown) => void>();

function sendToPage(type: string, payload?: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve(null);
    }, 2000);

    pendingRequests.set(requestId, (res) => {
      window.clearTimeout(timer);
      resolve(res);
    });

    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type,
        payload,
        requestId,
      },
      '*'
    );
  });
}

// Sync persisted per-origin overrides from chrome.storage.local to page interceptor on startup
const originKey = `overrides:${window.location.origin}`;
chrome.storage.local.get(originKey, (result) => {
  const saved = result[originKey] as OverridesMap | undefined;
  if (saved && Object.keys(saved).length > 0) {
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        type: 'SYNC_OVERRIDES',
        payload: saved,
      },
      '*'
    );
  }
});

// Listen for messages from MAIN-world interceptor
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== INTERCEPTOR_SOURCE) {
    return;
  }

  const { type, payload, requestId } = event.data as {
    type: string;
    payload?: unknown;
    requestId?: string;
  };

  if (type === 'RESPONSE' && requestId && pendingRequests.has(requestId)) {
    const cb = pendingRequests.get(requestId)!;
    pendingRequests.delete(requestId);
    cb(payload);
    return;
  }

  if (type === 'STATE_UPDATE') {
    const state = payload as XRayTabState;
    void chrome.runtime.sendMessage({
      type: 'XRAY_STATE_UPDATE',
      state,
    });
  }
});

// Listen for messages from background / popup / devtools panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'GET_STATE') {
    void sendToPage('GET_STATE').then((state) => {
      sendResponse({ state });
    });
    return true;
  }

  if (message.type === 'SET_OVERRIDES') {
    const overrides = (message.overrides || {}) as OverridesMap;
    void chrome.storage.local.set({ [originKey]: overrides });
    void sendToPage('SET_OVERRIDES', overrides).then((result) => {
      sendResponse(result ?? { ok: true });
    });
    return true;
  }

  if (message.type === 'REFRESH_FLAGS') {
    void sendToPage('REFRESH_FLAGS').then((result) => {
      sendResponse(result ?? { ok: false, liveRefreshed: false });
    });
    return true;
  }

  return false;
});
