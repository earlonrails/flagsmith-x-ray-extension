import {
  EXTENSION_SOURCE,
  FlagOverride,
  FlagSource,
  FlagValue,
  INTERCEPTOR_SOURCE,
  OVERRIDES_STORAGE_KEY,
  OverridesMap,
  XRayFlag,
  XRayTabState,
} from './shared/types';

interface RawFlagItem {
  id?: number;
  feature?: {
    id?: number;
    name?: string;
    type?: string;
  };
  enabled?: boolean;
  feature_state_value?: FlagValue;
}

interface RawTraitItem {
  trait_key?: string;
  trait_value?: FlagValue;
}

interface RawIdentitiesResponse {
  flags?: RawFlagItem[];
  traits?: RawTraitItem[];
}

interface FlagsmithWindow extends Window {
  flagsmith?: {
    getFlags?: () => Promise<unknown> | unknown;
  };
  __FLAGSMITH_XRAY_INSTALLED__?: boolean;
}

const win = window as FlagsmithWindow;

if (!win.__FLAGSMITH_XRAY_INSTALLED__) {
  win.__FLAGSMITH_XRAY_INSTALLED__ = true;

  const nativeFetch = window.fetch.bind(window);
  const NativeXHR = window.XMLHttpRequest;

  const baselineCache = new Map<string, { fetchedAt: number; flags: Map<string, RawFlagItem> }>();

  let currentState: XRayTabState = {
    origin: window.location.origin,
    apiHost: null,
    apiBase: null,
    environmentKey: null,
    identity: null,
    traits: {},
    flags: [],
    overrides: readOverrides(),
    hasFlagsmithGlobal: Boolean(win.flagsmith),
    lastUpdated: Date.now(),
  };

  let lastServerRawFlags: RawFlagItem[] = [];
  let lastBaselineMap: Map<string, RawFlagItem> | null = null;

  function readOverrides(): OverridesMap {
    try {
      const raw = window.localStorage.getItem(OVERRIDES_STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as OverridesMap;
      }
    } catch {
      // Ignore storage access errors
    }
    return {};
  }

  function writeOverrides(overrides: OverridesMap): void {
    try {
      if (Object.keys(overrides).length === 0) {
        window.localStorage.removeItem(OVERRIDES_STORAGE_KEY);
      } else {
        window.localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
      }
    } catch {
      // Ignore storage access errors
    }
  }

  function matchFlagsmithUrl(rawUrl: string): { kind: 'flags' | 'identities'; apiBase: string; urlObj: URL } | null {
    try {
      const urlObj = new URL(rawUrl, window.location.href);
      const match = urlObj.pathname.match(/^(.*\/api\/v1\/)(flags|identities)\/?$/i);
      if (!match) return null;
      const apiBase = `${urlObj.origin}${match[1]}`;
      const kind = match[2].toLowerCase() === 'identities' ? 'identities' : 'flags';
      return { kind, apiBase, urlObj };
    } catch {
      return null;
    }
  }

  function extractHeader(headers: HeadersInit | undefined, name: string): string | null {
    if (!headers) return null;
    const lower = name.toLowerCase();
    if (headers instanceof Headers) {
      return headers.get(name) ?? headers.get(lower);
    }
    if (Array.isArray(headers)) {
      for (const [k, v] of headers) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    }
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  function normalizeValue(val: unknown): FlagValue {
    if (val === undefined) return null;
    if (val === null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      return val;
    }
    return JSON.stringify(val);
  }

  function valuesEqual(a: FlagValue, b: FlagValue): boolean {
    return (a ?? null) === (b ?? null);
  }

  async function getBaselineFlags(apiBase: string, envKey: string): Promise<Map<string, RawFlagItem> | null> {
    const cacheKey = `${apiBase}|${envKey}`;
    const cached = baselineCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 10_000) {
      return cached.flags;
    }

    try {
      const res = await nativeFetch(`${apiBase}flags/`, {
        method: 'GET',
        headers: {
          'X-Environment-Key': envKey,
        },
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return null;
      const map = new Map<string, RawFlagItem>();
      for (const item of data as RawFlagItem[]) {
        const name = item.feature?.name;
        if (name) map.set(name, item);
      }
      baselineCache.set(cacheKey, { fetchedAt: Date.now(), flags: map });
      return map;
    } catch {
      return null;
    }
  }

  function buildXRayFlags(
    rawFlags: RawFlagItem[],
    overrides: OverridesMap,
    baselineMap: Map<string, RawFlagItem> | null,
    hasIdentity: boolean
  ): XRayFlag[] {
    const result: XRayFlag[] = [];

    for (const item of rawFlags) {
      const name = item.feature?.name;
      if (!name) continue;

      const serverEnabled = Boolean(item.enabled);
      const serverValue = normalizeValue(item.feature_state_value);
      const override: FlagOverride | undefined = overrides[name];
      const overridden = Boolean(
        override && (override.enabled !== undefined || override.value !== undefined)
      );

      let baselineEnabled: boolean | undefined;
      let baselineValue: FlagValue | undefined;
      let baseSource: FlagSource = 'Default';

      if (hasIdentity && baselineMap) {
        const base = baselineMap.get(name);
        if (base) {
          baselineEnabled = Boolean(base.enabled);
          baselineValue = normalizeValue(base.feature_state_value);
          if (baselineEnabled !== serverEnabled || !valuesEqual(baselineValue, serverValue)) {
            baseSource = 'Segment / Identity';
          }
        } else {
          baseSource = 'Segment / Identity';
        }
      }

      const effectiveEnabled = override?.enabled !== undefined ? override.enabled : serverEnabled;
      const effectiveValue = override?.value !== undefined ? override.value : serverValue;

      result.push({
        name,
        type: item.feature?.type || 'STANDARD',
        enabled: effectiveEnabled,
        value: effectiveValue,
        serverEnabled,
        serverValue,
        baselineEnabled,
        baselineValue,
        source: overridden ? 'Local Override' : baseSource,
        overridden,
      });
    }

    return result;
  }

  function applyOverridesToRawFlags(rawFlags: RawFlagItem[], overrides: OverridesMap): RawFlagItem[] {
    return rawFlags.map((item) => {
      const name = item.feature?.name;
      if (!name || !overrides[name]) return item;
      const ov = overrides[name];
      return {
        ...item,
        enabled: ov.enabled !== undefined ? ov.enabled : item.enabled,
        feature_state_value: ov.value !== undefined ? ov.value : item.feature_state_value,
      };
    });
  }

  function emitState(): void {
    currentState = {
      ...currentState,
      hasFlagsmithGlobal: Boolean(win.flagsmith?.getFlags),
      lastUpdated: Date.now(),
    };
    window.postMessage(
      {
        source: INTERCEPTOR_SOURCE,
        type: 'STATE_UPDATE',
        payload: currentState,
      },
      '*'
    );
  }

  async function processFlagsmithPayload(
    kind: 'flags' | 'identities',
    apiBase: string,
    urlObj: URL,
    envKey: string | null,
    requestBodyText: string | null,
    parsedJson: unknown
  ): Promise<unknown> {
    const overrides = readOverrides();
    let rawFlags: RawFlagItem[] = [];
    let identity: string | null = null;
    const traits: Record<string, FlagValue> = {};

    if (kind === 'flags') {
      if (Array.isArray(parsedJson)) {
        rawFlags = parsedJson as RawFlagItem[];
      }
      lastBaselineMap = null;
    } else {
      const idPayload = parsedJson as RawIdentitiesResponse;
      rawFlags = Array.isArray(idPayload?.flags) ? idPayload.flags : [];

      // Extract identifier from query param or POST body
      identity = urlObj.searchParams.get('identifier');
      if (requestBodyText) {
        try {
          const reqObj = JSON.parse(requestBodyText) as {
            identifier?: string;
            traits?: RawTraitItem[];
          };
          if (reqObj.identifier) identity = reqObj.identifier;
          if (Array.isArray(reqObj.traits)) {
            for (const t of reqObj.traits) {
              if (t.trait_key) traits[t.trait_key] = normalizeValue(t.trait_value);
            }
          }
        } catch {
          // ignore non-JSON body
        }
      }

      if (Array.isArray(idPayload?.traits)) {
        for (const t of idPayload.traits) {
          if (t.trait_key) traits[t.trait_key] = normalizeValue(t.trait_value);
        }
      }

      if (envKey) {
        lastBaselineMap = await getBaselineFlags(apiBase, envKey);
      }
    }

    lastServerRawFlags = rawFlags;

    const xrayFlags = buildXRayFlags(
      rawFlags,
      overrides,
      lastBaselineMap,
      kind === 'identities'
    );

    currentState = {
      origin: window.location.origin,
      apiHost: urlObj.host,
      apiBase,
      environmentKey: envKey ?? currentState.environmentKey,
      identity,
      traits,
      flags: xrayFlags,
      overrides,
      hasFlagsmithGlobal: Boolean(win.flagsmith?.getFlags),
      lastUpdated: Date.now(),
    };

    emitState();

    // Patch response returned to Flagsmith SDK
    if (Object.keys(overrides).length === 0) {
      return parsedJson;
    }

    if (kind === 'flags' && Array.isArray(parsedJson)) {
      return applyOverridesToRawFlags(rawFlags, overrides);
    }

    if (kind === 'identities' && parsedJson && typeof parsedJson === 'object') {
      return {
        ...(parsedJson as Record<string, unknown>),
        flags: applyOverridesToRawFlags(rawFlags, overrides),
      };
    }

    return parsedJson;
  }

  // Patch window.fetch
  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const matched = matchFlagsmithUrl(rawUrl);
    if (!matched) {
      return nativeFetch(input, init);
    }

    let envKey = extractHeader(init?.headers, 'X-Environment-Key');
    if (!envKey && input instanceof Request) {
      envKey = input.headers.get('X-Environment-Key');
    }

    let reqBodyText: string | null = null;
    if (typeof init?.body === 'string') {
      reqBodyText = init.body;
    }

    const response = await nativeFetch(input, init);
    if (!response.ok) return response;

    try {
      const cloned = response.clone();
      const json: unknown = await cloned.json();
      const patchedJson = await processFlagsmithPayload(
        matched.kind,
        matched.apiBase,
        matched.urlObj,
        envKey,
        reqBodyText,
        json
      );

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.set('content-type', 'application/json');

      return new Response(JSON.stringify(patchedJson), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };

  // Patch XMLHttpRequest for apps/SDK versions using XHR
  class PatchedXHR extends NativeXHR {
    private _xrayUrl = '';
    private _xrayEnvKey: string | null = null;
    private _xrayBody: string | null = null;

    open(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ): void {
      this._xrayUrl = typeof url === 'string' ? url : url.toString();
      super.open(method, url, async ?? true, username ?? null, password ?? null);
    }

    setRequestHeader(name: string, value: string): void {
      if (name.toLowerCase() === 'x-environment-key') {
        this._xrayEnvKey = value;
      }
      super.setRequestHeader(name, value);
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (typeof body === 'string') {
        this._xrayBody = body;
      }

      const matched = matchFlagsmithUrl(this._xrayUrl);
      if (!matched) {
        super.send(body);
        return;
      }

      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
          try {
            const parsed: unknown = JSON.parse(super.responseText);
            void processFlagsmithPayload(
              matched.kind,
              matched.apiBase,
              matched.urlObj,
              this._xrayEnvKey,
              this._xrayBody,
              parsed
            ).then((patched) => {
              const patchedText = JSON.stringify(patched);
              Object.defineProperty(this, 'responseText', {
                configurable: true,
                get: () => patchedText,
              });
              Object.defineProperty(this, 'response', {
                configurable: true,
                get: () =>
                  this.responseType === 'json' ? patched : patchedText,
              });
            });
          } catch {
            // ignore parse errors
          }
        }
      });

      super.send(body);
    }
  }

  window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;

  // Listen for commands from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== EXTENSION_SOURCE) {
      return;
    }

    const { type, payload, requestId } = event.data as {
      type: string;
      payload?: unknown;
      requestId?: string;
    };

    if (type === 'GET_STATE') {
      window.postMessage(
        {
          source: INTERCEPTOR_SOURCE,
          type: 'RESPONSE',
          requestId,
          payload: {
            ...currentState,
            hasFlagsmithGlobal: Boolean(win.flagsmith?.getFlags),
          },
        },
        '*'
      );
      return;
    }

    if (type === 'SYNC_OVERRIDES') {
      const incoming = (payload as OverridesMap) || {};
      const existing = readOverrides();
      if (Object.keys(existing).length === 0 && Object.keys(incoming).length > 0) {
        writeOverrides(incoming);
        currentState.overrides = incoming;
      }
      return;
    }

    if (type === 'SET_OVERRIDES') {
      const nextOverrides = (payload as OverridesMap) || {};
      writeOverrides(nextOverrides);

      const flags = buildXRayFlags(
        lastServerRawFlags,
        nextOverrides,
        lastBaselineMap,
        Boolean(currentState.identity)
      );

      currentState = {
        ...currentState,
        overrides: nextOverrides,
        flags,
        hasFlagsmithGlobal: Boolean(win.flagsmith?.getFlags),
        lastUpdated: Date.now(),
      };
      emitState();

      // Trigger instant live refresh if window.flagsmith is exposed
      let liveRefreshed = false;
      if (win.flagsmith?.getFlags) {
        try {
          void win.flagsmith.getFlags();
          liveRefreshed = true;
        } catch {
          liveRefreshed = false;
        }
      }

      window.postMessage(
        {
          source: INTERCEPTOR_SOURCE,
          type: 'RESPONSE',
          requestId,
          payload: { ok: true, liveRefreshed, state: currentState },
        },
        '*'
      );
      return;
    }

    if (type === 'REFRESH_FLAGS') {
      let liveRefreshed = false;
      if (win.flagsmith?.getFlags) {
        try {
          void win.flagsmith.getFlags();
          liveRefreshed = true;
        } catch {
          liveRefreshed = false;
        }
      }
      window.postMessage(
        {
          source: INTERCEPTOR_SOURCE,
          type: 'RESPONSE',
          requestId,
          payload: { ok: true, liveRefreshed },
        },
        '*'
      );
    }
  });
}
