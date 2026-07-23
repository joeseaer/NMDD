import type { StyleBindingTarget } from '../commands/types';
import type {
  ColorValue,
  StyleBinding,
  StyleProperties,
} from '../domain/types';
import { cloneStyleProperties } from '../style/merge';

export interface FormatSelectionEntry {
  readonly target: StyleBindingTarget;
  readonly binding?: Readonly<StyleBinding>;
}

export type FormatSelectionKind =
  | 'empty'
  | 'node'
  | 'connector'
  | 'incompatible';

export type FormatFieldState<T> =
  | { readonly kind: 'default' }
  | { readonly kind: 'mixed' }
  | { readonly kind: 'value'; readonly value: T };

export interface FormatSelectionFields {
  readonly fillColor: FormatFieldState<ColorValue>;
  readonly textColor: FormatFieldState<ColorValue>;
  readonly fontSize: FormatFieldState<number>;
  readonly bold: FormatFieldState<boolean>;
  readonly italic: FormatFieldState<boolean>;
  readonly borderColor: FormatFieldState<ColorValue>;
  readonly borderWidth: FormatFieldState<number>;
  readonly borderRadius: FormatFieldState<number>;
  readonly opacity: FormatFieldState<number>;
  readonly connectorColor: FormatFieldState<ColorValue>;
  readonly connectorWidth: FormatFieldState<number>;
  readonly connectorDash: FormatFieldState<readonly number[]>;
}

export interface FormatSelectionModel {
  readonly kind: FormatSelectionKind;
  readonly count: number;
  readonly hasRelationship: boolean;
  readonly fields: FormatSelectionFields;
}

const DEFAULT_FIELD = Object.freeze({ kind: 'default' } as const);

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
};

const commonField = <T>(
  entries: readonly FormatSelectionEntry[],
  read: (binding: Readonly<StyleBinding> | undefined) => T | undefined,
): FormatFieldState<T> => {
  if (entries.length === 0) return DEFAULT_FIELD;
  const values = entries.map((entry) => read(entry.binding));
  if (values.every((value) => value === undefined)) return DEFAULT_FIELD;
  const first = values[0];
  if (first !== undefined && values.every((value) => sameValue(value, first))) {
    return { kind: 'value', value: first };
  }
  return { kind: 'mixed' };
};

const isConnectorTarget = (target: StyleBindingTarget): boolean =>
  target.scope === 'tree-edge' || target.scope === 'relationship';

export const getFormatSelectionKind = (
  entries: readonly FormatSelectionEntry[],
): FormatSelectionKind => {
  if (entries.length === 0) return 'empty';
  const connectorCount = entries.filter((entry) => isConnectorTarget(entry.target)).length;
  if (connectorCount === entries.length) return 'connector';
  if (connectorCount === 0) return 'node';
  return 'incompatible';
};

/**
 * Computes local-override values only. A missing value means that the visual
 * value is inherited from the named Style, Theme, or renderer skeleton.
 */
export const buildFormatSelectionModel = (
  entries: readonly FormatSelectionEntry[],
): FormatSelectionModel => ({
  kind: getFormatSelectionKind(entries),
  count: entries.length,
  hasRelationship: entries.some((entry) => entry.target.scope === 'relationship'),
  fields: {
    fillColor: commonField(entries, (binding) => binding?.overrides?.fill?.color),
    textColor: commonField(entries, (binding) => binding?.overrides?.typography?.color),
    fontSize: commonField(entries, (binding) => binding?.overrides?.typography?.fontSize),
    bold: commonField(entries, (binding) => {
      const weight = binding?.overrides?.typography?.fontWeight;
      return weight === undefined ? undefined : weight >= 600;
    }),
    italic: commonField(entries, (binding) => binding?.overrides?.typography?.italic),
    borderColor: commonField(entries, (binding) => binding?.overrides?.border?.color),
    borderWidth: commonField(entries, (binding) => binding?.overrides?.border?.width),
    borderRadius: commonField(entries, (binding) => binding?.overrides?.border?.radius),
    opacity: commonField(entries, (binding) => binding?.overrides?.opacity),
    connectorColor: commonField(entries, (binding) => binding?.overrides?.connector?.color),
    connectorWidth: commonField(entries, (binding) => binding?.overrides?.connector?.width),
    connectorDash: commonField(entries, (binding) => binding?.overrides?.connector?.dash),
  },
});

/**
 * Relationship bindings intentionally have a smaller schema than general
 * StyleProperties. Keep this guard at the component boundary so a future UI
 * refactor cannot send fill/typography/routing/cap data to a Relationship.
 */
export const constrainFormatOverrides = (
  entries: readonly FormatSelectionEntry[],
  overrides: Readonly<StyleProperties>,
): StyleProperties => {
  const kind = getFormatSelectionKind(entries);
  if (kind !== 'connector' && !entries.some((entry) => entry.target.scope === 'relationship')) {
    return cloneStyleProperties(overrides);
  }
  const connector = overrides.connector;
  if (!connector) return {};
  return {
    connector: {
      ...(connector.color !== undefined ? { color: connector.color } : {}),
      ...(connector.width !== undefined ? { width: connector.width } : {}),
      ...(connector.dash !== undefined ? { dash: [...connector.dash] } : {}),
    },
  };
};

export const colorValueForInput = (
  state: FormatFieldState<ColorValue>,
  fallback = '#64748b',
): string => state.kind === 'value' && state.value.kind === 'literal'
  ? state.value.value
  : fallback;

