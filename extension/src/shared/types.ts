export type FlagSource = 'Default' | 'Segment / Identity' | 'Local Override';

export type FlagValue = string | number | boolean | null;

export interface FlagOverride {
  enabled?: boolean;
  value?: FlagValue;
}

export type OverridesMap = Record<string, FlagOverride>;

export interface XRayFlag {
  name: string;
  type: string;
  enabled: boolean;
  value: FlagValue;
  serverEnabled: boolean;
  serverValue: FlagValue;
  baselineEnabled?: boolean;
  baselineValue?: FlagValue;
  source: FlagSource;
  overridden: boolean;
}

export interface XRayTrait {
  trait_key: string;
  trait_value: FlagValue;
}

export interface XRayTabState {
  origin: string;
  apiHost: string | null;
  apiBase: string | null;
  environmentKey: string | null;
  identity: string | null;
  traits: Record<string, FlagValue>;
  flags: XRayFlag[];
  overrides: OverridesMap;
  hasFlagsmithGlobal: boolean;
  lastUpdated: number;
}

export const INTERCEPTOR_SOURCE = 'flagsmith-xray-interceptor';
export const EXTENSION_SOURCE = 'flagsmith-xray-extension';
export const OVERRIDES_STORAGE_KEY = '__flagsmith_xray_overrides__';
