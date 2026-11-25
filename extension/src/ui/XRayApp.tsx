import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlagValue, OverridesMap, XRayFlag, XRayTabState } from '../shared/types';

type FilterKind = 'All' | 'Overridden' | 'Segment/Identity' | 'Enabled' | 'Disabled';

interface XRayAppProps {
  mode: 'popup' | 'panel';
  tabId: number | null;
}

function maskKey(key: string | null): string {
  if (!key) return '—';
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function formatValueForInput(value: FlagValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseInputValue(raw: string): FlagValue {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as FlagValue;
    } catch {
      return raw;
    }
  }
  return raw;
}

export default function XRayApp({ mode, tabId }: XRayAppProps) {
  const [state, setState] = useState<XRayTabState | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKind>('All');
  const [revealKey, setRevealKey] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (tabId === null) return;

    chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId }, (resp) => {
      if (resp?.state) {
        setState(resp.state as XRayTabState);
      }
    });

    const listener = (message: { type?: string; tabId?: number; state?: XRayTabState }) => {
      if (message.type === 'TAB_STATE_BROADCAST' && message.tabId === tabId && message.state) {
        setState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [tabId]);

  function flashStatus(msg: string) {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2500);
  }

  function applyOverrides(nextOverrides: OverridesMap, msg?: string) {
    if (tabId === null) return;
    chrome.runtime.sendMessage(
      { type: 'SET_TAB_OVERRIDES', tabId, overrides: nextOverrides },
      (resp) => {
        if (resp?.state) {
          setState(resp.state as XRayTabState);
        }
        if (msg) {
          flashStatus(
            resp?.liveRefreshed ? `${msg} (Live updated)` : `${msg} (Reload tab if needed)`
          );
        }
      }
    );
  }

  function handleToggleFlag(flag: XRayFlag) {
    const current = state?.overrides ?? {};
    const existing = current[flag.name] ?? {};
    const nextEnabled = !flag.enabled;

    const next: OverridesMap = {
      ...current,
      [flag.name]: {
        ...existing,
        enabled: nextEnabled,
      },
    };
    applyOverrides(next, `${flag.name} → ${nextEnabled}`);
  }

  function handleSaveValue(flag: XRayFlag) {
    const rawInput = draftValues[flag.name] ?? formatValueForInput(flag.value);
    const parsed = parseInputValue(rawInput);
    const current = state?.overrides ?? {};
    const existing = current[flag.name] ?? {};

    const next: OverridesMap = {
      ...current,
      [flag.name]: {
        ...existing,
        value: parsed,
      },
    };

    setDraftValues((prev) => {
      const copy = { ...prev };
      delete copy[flag.name];
      return copy;
    });

    applyOverrides(next, `Updated ${flag.name} value`);
  }

  function handleResetFlag(flagName: string) {
    const current = state?.overrides ?? {};
    const next = { ...current };
    delete next[flagName];
    setDraftValues((prev) => {
      const copy = { ...prev };
      delete copy[flagName];
      return copy;
    });
    applyOverrides(next, `Reset ${flagName}`);
  }

  function handleResetAll() {
    setDraftValues({});
    applyOverrides({}, 'All overrides cleared');
  }

  function handleRefreshOrReload() {
    if (tabId === null) return;
    if (state?.hasFlagsmithGlobal) {
      chrome.runtime.sendMessage({ type: 'REFRESH_TAB_FLAGS', tabId }, (resp) => {
        if (resp?.liveRefreshed) {
          flashStatus('Refreshed window.flagsmith.getFlags()');
        } else {
          chrome.runtime.sendMessage({ type: 'RELOAD_TAB', tabId });
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'RELOAD_TAB', tabId });
    }
  }

  function handleExportJson() {
    const overrides = state?.overrides ?? {};
    const blob = new Blob([JSON.stringify(overrides, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flagsmith-xray-overrides-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus('Exported overrides JSON');
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          applyOverrides(parsed as OverridesMap, 'Imported overrides JSON');
        } else {
          flashStatus('Invalid overrides JSON');
        }
      } catch {
        flashStatus('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const filteredFlags = useMemo(() => {
    const list = state?.flags ?? [];
    const q = search.trim().toLowerCase();

    return list.filter((flag) => {
      if (q && !flag.name.toLowerCase().includes(q)) return false;
      if (filter === 'Overridden') return flag.overridden;
      if (filter === 'Segment/Identity') return flag.source === 'Segment / Identity';
      if (filter === 'Enabled') return flag.enabled;
      if (filter === 'Disabled') return !flag.enabled;
      return true;
    });
  }, [state?.flags, search, filter]);

  const overrideCount = Object.keys(state?.overrides ?? {}).length;

  return (
    <div className={mode === 'popup' ? 'xray-popup' : 'xray-panel'}>
      <header className="xray-header">
        <div className="xray-title-row">
          <div className="xray-title">
            <span className={`xray-dot ${state ? '' : 'inactive'}`} />
            <span>Flagsmith X-Ray</span>
          </div>
          <div className="xray-actions-top">
            {statusMsg && <span className="toast">{statusMsg}</span>}
            <button type="button" className="btn" onClick={handleRefreshOrReload}>
              {state?.hasFlagsmithGlobal ? 'Refresh Flags' : 'Reload Tab'}
            </button>
          </div>
        </div>

        <div className="xray-meta-grid">
          <div className="xray-meta-item" title={state?.origin ?? ''}>
            <span>Origin:</span>
            <code>{state?.origin ?? '—'}</code>
          </div>
          <div className="xray-meta-item" title={state?.apiHost ?? ''}>
            <span>API Host:</span>
            <code>{state?.apiHost ?? '—'}</code>
          </div>
          <div className="xray-meta-item">
            <span>Env Key:</span>
            <code>{revealKey ? (state?.environmentKey ?? '—') : maskKey(state?.environmentKey ?? null)}</code>
            {state?.environmentKey && (
              <button
                type="button"
                className="btn"
                style={{ padding: '1px 5px', fontSize: 10 }}
                onClick={() => setRevealKey((v) => !v)}
              >
                {revealKey ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          <div className="xray-meta-item" title={JSON.stringify(state?.traits ?? {})}>
            <span>Identity:</span>
            <code>{state?.identity ?? 'anonymous'}</code>
          </div>
        </div>

        {state && Object.keys(state.traits).length > 0 && (
          <div className="xray-meta-item" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span>Traits:</span>
            <code>{JSON.stringify(state.traits)}</code>
          </div>
        )}
      </header>

      <div className="xray-toolbar">
        <div className="xray-search-row">
          <input
            type="text"
            className="xray-input"
            placeholder="Search flags by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="xray-filters">
          {(['All', 'Overridden', 'Segment/Identity', 'Enabled', 'Disabled'] as FilterKind[]).map(
            (kind) => (
              <button
                key={kind}
                type="button"
                className={`filter-pill ${filter === kind ? 'active' : ''}`}
                onClick={() => setFilter(kind)}
              >
                {kind}
              </button>
            )
          )}
        </div>
      </div>

      <main className="xray-list">
        {!state || state.flags.length === 0 ? (
          <div className="empty-state">
            <strong>No Flagsmith traffic intercepted yet.</strong>
            <br />
            Open a page using the Flagsmith SDK (or reload this tab) to inspect flags and apply local overrides.
          </div>
        ) : filteredFlags.length === 0 ? (
          <div className="empty-state">No flags match the current search/filter.</div>
        ) : (
          filteredFlags.map((flag) => {
            const draft = draftValues[flag.name];
            const inputVal = draft !== undefined ? draft : formatValueForInput(flag.value);
            const hasDraft = draft !== undefined && draft !== formatValueForInput(flag.value);

            const badgeClass =
              flag.source === 'Local Override'
                ? 'source-override'
                : flag.source === 'Segment / Identity'
                  ? 'source-segment'
                  : 'source-default';

            return (
              <div key={flag.name} className={`flag-card ${flag.overridden ? 'overridden' : ''}`}>
                <div className="flag-top">
                  <div className="flag-name-group">
                    <span className="flag-name">{flag.name}</span>
                    <span className="type-tag">{flag.type}</span>
                    <span className={`source-badge ${badgeClass}`}>{flag.source}</span>
                  </div>

                  <div className="flag-controls">
                    {flag.overridden && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleResetFlag(flag.name)}
                      >
                        Reset
                      </button>
                    )}
                    <label className="toggle" title={`Toggle ${flag.name}`}>
                      <input
                        type="checkbox"
                        checked={flag.enabled}
                        onChange={() => handleToggleFlag(flag)}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                </div>

                <div className="value-row">
                  <input
                    type="text"
                    className="value-input"
                    placeholder="Remote config value (string / number / JSON)"
                    value={inputVal}
                    onChange={(e) =>
                      setDraftValues((prev) => ({ ...prev, [flag.name]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveValue(flag);
                    }}
                  />
                  <button
                    type="button"
                    className={`btn ${hasDraft ? 'btn-primary' : ''}`}
                    onClick={() => handleSaveValue(flag)}
                  >
                    Apply
                  </button>
                </div>

                {flag.overridden && (
                  <div className="server-hint">
                    Server: enabled={String(flag.serverEnabled)}, value=
                    {flag.serverValue === null ? 'null' : JSON.stringify(flag.serverValue)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      <footer className="xray-footer">
        <div className="footer-group">
          <button
            type="button"
            className="btn btn-danger"
            disabled={overrideCount === 0}
            onClick={handleResetAll}
          >
            Reset All Overrides ({overrideCount})
          </button>
        </div>

        <div className="footer-group">
          <button type="button" className="btn" onClick={handleExportJson}>
            Export JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      </footer>
    </div>
  );
}
