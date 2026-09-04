export interface MindMapV2FlagContext {
  pathname?: string;
  search?: string;
  isDevelopment?: boolean;
  environmentValue?: string;
}

const ENABLED_VALUES = new Set(['1', 'true', 'on', 'enabled']);
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

const parseOverride = (value: string | null | undefined): boolean | undefined => {
  if (value == null) return undefined;

  const normalized = value.trim().toLowerCase();
  if (ENABLED_VALUES.has(normalized)) return true;
  if (DISABLED_VALUES.has(normalized)) return false;
  return undefined;
};

export const resolveMindMapV2Flag = ({
  pathname: _pathname = '',
  search = '',
  isDevelopment: _isDevelopment = false,
  environmentValue,
}: MindMapV2FlagContext): boolean => {
  const queryOverride = parseOverride(new URLSearchParams(search).get('mindmapV2'));
  if (queryOverride !== undefined) return queryOverride;

  const environmentOverride = parseOverride(environmentValue);
  if (environmentOverride !== undefined) return environmentOverride;

  // V2 is the supported editor.  Keep the query/environment switches as an
  // immediate, explicit rollback path while existing persisted V0 payloads
  // are lazily migrated by the attribute bridge.
  return true;
};

type ViteImportMeta = ImportMeta & {
  readonly env?: {
    readonly DEV?: boolean;
    readonly VITE_MINDMAP_V2?: string;
  };
};

export const isMindMapV2Enabled = (): boolean => {
  const location = typeof window === 'undefined' ? undefined : window.location;
  const environment = (import.meta as ViteImportMeta).env;

  return resolveMindMapV2Flag({
    pathname: location?.pathname,
    search: location?.search,
    isDevelopment: environment?.DEV === true,
    environmentValue: environment?.VITE_MINDMAP_V2,
  });
};
