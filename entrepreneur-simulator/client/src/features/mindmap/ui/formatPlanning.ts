import {
  MIND_MAP_COMMAND_TYPES,
  type StyleBindingReplacement,
  type StyleBindingTarget,
  type UpdateStyleBindingsCommand,
} from '../commands/types';
import { createEntityId } from '../domain/ids';
import type {
  CommandId,
  MindMapDocumentV1,
  MindMapSheet,
  SheetId,
  StyleBinding,
  StyleId,
  StyleProperties,
} from '../domain/types';
import {
  cloneStyleProperties,
  mergeStyleProperties,
} from '../style/merge';

export const STYLE_OVERRIDE_PATHS = [
  'opacity',
  'typography.fontFamily',
  'typography.fontSize',
  'typography.fontWeight',
  'typography.italic',
  'typography.underline',
  'typography.strike',
  'typography.lineHeight',
  'typography.letterSpacing',
  'typography.color',
  'typography.align',
  'fill.color',
  'fill.opacity',
  'border.color',
  'border.width',
  'border.dash',
  'border.radius',
  'shape',
  'padding',
  'minSize',
  'maxSize',
  'shadow',
  'connector.color',
  'connector.width',
  'connector.dash',
  'connector.shape',
  'connector.startCap',
  'connector.endCap',
  'connector.taper',
  'connector.colorMode',
  'connector.palette',
] as const;

export type StyleOverridePath = (typeof STYLE_OVERRIDE_PATHS)[number];

interface BaseFormatPlanningInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly targets: readonly StyleBindingTarget[];
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

export interface PlanUpdateStyleBindingsInput extends BaseFormatPlanningInput {
  /** Deep-merged into every target's current local overrides. */
  readonly overrides?: Readonly<StyleProperties>;
  /** null removes a named Style reference; undefined preserves it. */
  readonly styleId?: StyleId | null;
  /** null removes the explicit inheritance mode; undefined preserves it. */
  readonly inheritance?: StyleBinding['inheritance'] | null;
}

export interface PlanResetStyleBindingsInput extends BaseFormatPlanningInput {
  /** Omit to clear the complete binding; provide paths to reset only those overrides. */
  readonly paths?: readonly StyleOverridePath[];
}

const getSheet = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
): MindMapSheet => document.sheets[sheetId]
  ?? (() => { throw new Error(`Sheet ${sheetId} does not exist.`); })();

const getTargetStyle = (
  sheet: MindMapSheet,
  target: StyleBindingTarget,
): Readonly<StyleBinding> | undefined => {
  const entity = target.scope === 'topic'
    ? sheet.topics[target.id]
    : target.scope === 'tree-edge'
      ? sheet.treeEdges[target.id]
      : target.scope === 'relationship'
        ? sheet.relationships[target.id]
        : target.scope === 'boundary'
          ? sheet.boundaries[target.id]
          : target.scope === 'summary'
            ? sheet.summaries[target.id]
            : target.scope === 'callout'
              ? sheet.callouts[target.id]
              : sheet.zones[target.id];
  if (!entity) throw new Error(`Style target ${target.scope}:${target.id} does not exist.`);
  return entity.style;
};

const cloneBinding = (
  binding: Readonly<StyleBinding> | undefined,
): StyleBinding => ({
  ...(binding?.styleId !== undefined ? { styleId: binding.styleId } : {}),
  ...(binding?.inheritance !== undefined ? { inheritance: binding.inheritance } : {}),
  ...(binding?.overrides !== undefined
    ? { overrides: cloneStyleProperties(binding.overrides) }
    : {}),
});

const normalizeBinding = (binding: StyleBinding): StyleBinding | null => {
  const normalized = cloneBinding(binding);
  if (normalized.overrides && Object.keys(normalized.overrides).length === 0) {
    delete normalized.overrides;
  }
  return Object.keys(normalized).length === 0 ? null : normalized;
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const validateTargets = (
  sheet: MindMapSheet,
  targets: readonly StyleBindingTarget[],
): void => {
  if (targets.length === 0) throw new Error('Format planning requires at least one target.');
  const seen = new Set<string>();
  for (const target of targets) {
    const identity = `${target.scope}:${target.id}`;
    if (seen.has(identity)) throw new Error(`Style target ${identity} is repeated.`);
    seen.add(identity);
    getTargetStyle(sheet, target);
  }
};

const commandMetadata = (input: BaseFormatPlanningInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-format-panel',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

const createCommand = (
  input: BaseFormatPlanningInput,
  replacements: StyleBindingReplacement[],
): UpdateStyleBindingsCommand => {
  if (replacements.length === 0) {
    throw new Error('The requested format operation does not change any target.');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
    payload: { replacements },
  };
};

/**
 * Plans one heterogeneous, multi-selection format transaction. Only supplied
 * properties change; mixed values and every unrelated local override survive.
 */
export const planUpdateStyleBindingsCommand = (
  input: PlanUpdateStyleBindingsInput,
): UpdateStyleBindingsCommand => {
  const sheet = getSheet(input.document, input.sheetId);
  validateTargets(sheet, input.targets);
  const hasOverrides = input.overrides !== undefined
    && Object.keys(input.overrides).length > 0;
  if (
    !hasOverrides
    && input.styleId === undefined
    && input.inheritance === undefined
  ) {
    throw new Error('Format update requires overrides, styleId, or inheritance.');
  }

  const replacements: StyleBindingReplacement[] = [];
  for (const target of input.targets) {
    const current = getTargetStyle(sheet, target);
    const next = cloneBinding(current);
    if (hasOverrides) {
      next.overrides = mergeStyleProperties(next.overrides ?? {}, input.overrides);
    }
    if (input.styleId === null) delete next.styleId;
    else if (input.styleId !== undefined) next.styleId = input.styleId;
    if (input.inheritance === null) delete next.inheritance;
    else if (input.inheritance !== undefined) next.inheritance = input.inheritance;
    const binding = normalizeBinding(next);
    if (!sameJson(current ?? null, binding)) replacements.push({ target, binding });
  }
  return createCommand(input, replacements);
};

type MutableRecord = Record<string, unknown>;

const removePath = (
  properties: StyleProperties,
  path: StyleOverridePath,
): void => {
  const segments = path.split('.');
  let owner = properties as unknown as MutableRecord;
  const ancestors: MutableRecord[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const child = owner[segments[index]];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) return;
    ancestors.push(owner);
    owner = child as MutableRecord;
  }
  delete owner[segments[segments.length - 1]];
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const parent = ancestors[index];
    const segment = segments[index];
    const child = parent[segment];
    if (
      child !== null
      && typeof child === 'object'
      && !Array.isArray(child)
      && Object.keys(child as MutableRecord).length === 0
    ) {
      delete parent[segment];
    }
  }
};

/**
 * Omitted paths remove the complete entity binding. Explicit paths delete only
 * those local override properties, revealing the next Theme/Skeleton value.
 */
export const planResetStyleBindingsCommand = (
  input: PlanResetStyleBindingsInput,
): UpdateStyleBindingsCommand => {
  const sheet = getSheet(input.document, input.sheetId);
  validateTargets(sheet, input.targets);
  if (input.paths !== undefined && input.paths.length === 0) {
    throw new Error('Style reset paths cannot be empty.');
  }
  if (input.paths && new Set(input.paths).size !== input.paths.length) {
    throw new Error('Style reset paths cannot contain duplicates.');
  }

  const replacements: StyleBindingReplacement[] = [];
  for (const target of input.targets) {
    const current = getTargetStyle(sheet, target);
    if (!current) continue;
    let binding: StyleBinding | null = null;
    if (input.paths !== undefined) {
      const next = cloneBinding(current);
      const overrides = cloneStyleProperties(next.overrides ?? {});
      for (const path of input.paths) removePath(overrides, path);
      if (Object.keys(overrides).length === 0) delete next.overrides;
      else next.overrides = overrides;
      binding = normalizeBinding(next);
    }
    if (!sameJson(current, binding)) replacements.push({ target, binding });
  }
  return createCommand(input, replacements);
};

