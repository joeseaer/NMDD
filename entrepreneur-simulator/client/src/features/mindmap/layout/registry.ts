import type {
  CoreStructureId,
  ResolvedLayoutDirection,
} from '../domain/types';

export const CORE_LAYOUT_CAPABILITY_VERSION = 'xmind-layout@2026-07-19' as const;

export type SupportedCoreLayoutStructure =
  | 'core:mind-map'
  | 'core:logic-chart'
  | 'core:org-chart'
  | 'core:tree-chart'
  | 'core:timeline'
  | 'core:fishbone'
  | 'core:matrix'
  | 'core:brace-map'
  | 'core:tree-table'
  | 'core:grid';

export type CardinalLayoutDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top';

export interface CoreLayoutCapabilityDescriptor {
  readonly structure: SupportedCoreLayoutStructure;
  readonly displayName: string;
  readonly allowedDirections: readonly ResolvedLayoutDirection[];
  readonly defaultDirection: CardinalLayoutDirection | 'both';
  readonly defaultSpacing: Readonly<{ sibling: number; level: number }>;
  readonly connectorRouting: 'curve' | 'orthogonal';
  /** Stable structure variants understood by the deterministic engine. */
  readonly variantIds: readonly string[];
  /** Whitelisted option names interpreted by the deterministic engine. */
  readonly optionKeys: readonly string[];
  readonly supportsMixedChildStructures: true;
}

const cardinalDirections = Object.freeze([
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
] as const);

const descriptor = (
  value: Omit<CoreLayoutCapabilityDescriptor, 'supportsMixedChildStructures'>,
): CoreLayoutCapabilityDescriptor => Object.freeze({
  ...value,
  allowedDirections: Object.freeze([...value.allowedDirections]),
  defaultSpacing: Object.freeze({ ...value.defaultSpacing }),
  variantIds: Object.freeze([...value.variantIds]),
  optionKeys: Object.freeze([...value.optionKeys]),
  supportsMixedChildStructures: true,
});

export const CORE_LAYOUT_CAPABILITIES: Readonly<
  Record<SupportedCoreLayoutStructure, CoreLayoutCapabilityDescriptor>
> = Object.freeze({
  'core:mind-map': descriptor({
    structure: 'core:mind-map',
    displayName: 'Mind Map',
    allowedDirections: ['both', ...cardinalDirections],
    defaultDirection: 'both',
    defaultSpacing: { sibling: 28, level: 72 },
    connectorRouting: 'curve',
    variantIds: ['balanced'],
    optionKeys: ['compact', 'justify'],
  }),
  'core:logic-chart': descriptor({
    structure: 'core:logic-chart',
    displayName: 'Logic Chart',
    allowedDirections: cardinalDirections,
    defaultDirection: 'left-to-right',
    defaultSpacing: { sibling: 24, level: 64 },
    connectorRouting: 'orthogonal',
    variantIds: ['standard'],
    optionKeys: ['compact', 'justify'],
  }),
  'core:org-chart': descriptor({
    structure: 'core:org-chart',
    displayName: 'Org Chart',
    allowedDirections: cardinalDirections,
    defaultDirection: 'top-to-bottom',
    defaultSpacing: { sibling: 36, level: 72 },
    connectorRouting: 'orthogonal',
    variantIds: ['standard'],
    optionKeys: ['compact', 'justify'],
  }),
  'core:tree-chart': descriptor({
    structure: 'core:tree-chart',
    displayName: 'Tree Chart',
    allowedDirections: cardinalDirections,
    defaultDirection: 'left-to-right',
    defaultSpacing: { sibling: 20, level: 56 },
    connectorRouting: 'orthogonal',
    variantIds: ['standard'],
    optionKeys: ['compact', 'justify'],
  }),
  'core:timeline': descriptor({
    structure: 'core:timeline',
    displayName: 'Timeline',
    allowedDirections: cardinalDirections,
    defaultDirection: 'left-to-right',
    defaultSpacing: { sibling: 48, level: 72 },
    connectorRouting: 'curve',
    variantIds: ['horizontal', 'vertical', 'horizontal-off-axis'],
    optionKeys: ['alternate', 'axisGap'],
  }),
  'core:fishbone': descriptor({
    structure: 'core:fishbone',
    displayName: 'Fishbone',
    allowedDirections: ['left-to-right', 'right-to-left'],
    defaultDirection: 'right-to-left',
    defaultSpacing: { sibling: 52, level: 84 },
    connectorRouting: 'curve',
    variantIds: ['standard', 'compact'],
    optionKeys: ['boneAngle', 'alternate'],
  }),
  'core:matrix': descriptor({
    structure: 'core:matrix',
    displayName: 'Matrix',
    allowedDirections: cardinalDirections,
    defaultDirection: 'top-to-bottom',
    defaultSpacing: { sibling: 20, level: 28 },
    connectorRouting: 'orthogonal',
    variantIds: ['l-shaped'],
    optionKeys: ['columnWidth', 'rowHeight', 'columns'],
  }),
  'core:brace-map': descriptor({
    structure: 'core:brace-map',
    displayName: 'Brace Map',
    allowedDirections: ['left-to-right', 'right-to-left'],
    defaultDirection: 'left-to-right',
    defaultSpacing: { sibling: 18, level: 76 },
    connectorRouting: 'curve',
    variantIds: ['standard'],
    optionKeys: ['braceGap'],
  }),
  'core:tree-table': descriptor({
    structure: 'core:tree-table',
    displayName: 'Tree Table',
    allowedDirections: cardinalDirections,
    defaultDirection: 'left-to-right',
    defaultSpacing: { sibling: 8, level: 20 },
    connectorRouting: 'orthogonal',
    variantIds: ['standard', 'dashed'],
    optionKeys: ['columnWidth', 'rowGap'],
  }),
  'core:grid': descriptor({
    structure: 'core:grid',
    displayName: 'Grid',
    allowedDirections: cardinalDirections,
    defaultDirection: 'top-to-bottom',
    defaultSpacing: { sibling: 24, level: 36 },
    connectorRouting: 'orthogonal',
    variantIds: ['standard'],
    optionKeys: ['columns', 'cellWidth', 'cellHeight'],
  }),
});

export const SUPPORTED_CORE_LAYOUT_STRUCTURES = Object.freeze(
  Object.keys(CORE_LAYOUT_CAPABILITIES) as SupportedCoreLayoutStructure[],
);

export const isSupportedCoreLayoutStructure = (
  structure: string,
): structure is SupportedCoreLayoutStructure =>
  Object.prototype.hasOwnProperty.call(CORE_LAYOUT_CAPABILITIES, structure);

export const getCoreLayoutCapability = (
  structure: CoreStructureId | string,
): CoreLayoutCapabilityDescriptor | undefined =>
  isSupportedCoreLayoutStructure(structure)
    ? CORE_LAYOUT_CAPABILITIES[structure]
    : undefined;
