import type { Draft } from 'immer';

import { validateMindMapStyleBindingSchema } from '../domain/schema';
import type {
  MindMapDocumentV1,
  MindMapSheet,
  StyleBinding,
  StyleDefinition,
  StyleProperties,
  StyleScope,
} from '../domain/types';
import { cloneStyleProperties } from '../style/merge';
import { CommandValidationError } from './errors';
import type {
  CommandValidationContext,
  StyleBindingTarget,
  UpdateStyleBindingsCommand,
} from './types';

const ELEMENT_STYLE_SCOPES = new Set<StyleScope>([
  'topic',
  'tree-edge',
  'relationship',
  'boundary',
  'summary',
  'callout',
  'zone',
]);

const invalid = (message: string): never => {
  throw new CommandValidationError(message);
};

const assertTargetShape: (
  value: unknown,
) => asserts value is StyleBindingTarget = (
  value: unknown,
): asserts value is StyleBindingTarget => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Style target must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'scope') {
    invalid('Style target may contain only id and scope.');
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    invalid('Style target requires a non-empty entity ID.');
  }
  if (
    typeof record.scope !== 'string'
    || !ELEMENT_STYLE_SCOPES.has(record.scope as StyleScope)
  ) {
    invalid(`Style target scope ${String(record.scope)} is not supported.`);
  }
};

const getTargetEntity = (
  sheet: MindMapSheet,
  target: StyleBindingTarget,
): { readonly style?: StyleBinding } | undefined => {
  if (target.scope === 'topic') return sheet.topics[target.id];
  if (target.scope === 'tree-edge') return sheet.treeEdges[target.id];
  if (target.scope === 'relationship') return sheet.relationships[target.id];
  if (target.scope === 'boundary') return sheet.boundaries[target.id];
  if (target.scope === 'summary') return sheet.summaries[target.id];
  if (target.scope === 'callout') return sheet.callouts[target.id];
  return sheet.zones[target.id];
};

const assertRelationshipStyleProperties = (
  properties: Readonly<StyleProperties>,
  label: string,
): void => {
  const keys = Object.keys(properties);
  if (keys.some((key) => key !== 'connector')) {
    invalid(`${label} may override only relationship connector color, width, and dash.`);
  }
  const connector = properties.connector;
  if (
    connector
    && Object.keys(connector).some((key) => !['color', 'width', 'dash'].includes(key))
  ) {
    invalid(`${label} cannot override relationship routing, caps, taper, or palette.`);
  }
};

const assertNamedStyleCompatible = (
  document: MindMapDocumentV1,
  styleId: NonNullable<StyleBinding['styleId']>,
  scope: StyleBindingTarget['scope'],
): void => {
  const visited = new Set<string>();
  let currentId: typeof styleId | undefined = styleId;
  while (currentId !== undefined) {
    if (visited.has(currentId)) {
      invalid(`Named Style ${styleId} has an inheritance cycle.`);
    }
    visited.add(currentId);
    const definition: StyleDefinition = document.styles[currentId]
      ?? invalid(`Named Style ${currentId} does not exist.`);
    if (definition.scope !== scope) {
      invalid(
        `Named Style ${currentId} has scope ${definition.scope}, expected ${scope}.`,
      );
    }
    if (scope === 'relationship') {
      assertRelationshipStyleProperties(
        definition.properties,
        `Named relationship Style ${currentId}`,
      );
    }
    currentId = definition.basedOnStyleId;
  }
};

const cloneStyleBinding = (binding: Readonly<StyleBinding>): StyleBinding => ({
  ...(binding.styleId !== undefined ? { styleId: binding.styleId } : {}),
  ...(binding.inheritance !== undefined ? { inheritance: binding.inheritance } : {}),
  ...(binding.overrides !== undefined
    ? { overrides: cloneStyleProperties(binding.overrides) }
    : {}),
});

export const validateUpdateStyleBindings = (
  context: CommandValidationContext,
  command: UpdateStyleBindingsCommand,
): void => {
  const sheet = context.document.sheets[context.sheetId]
    ?? invalid(`Sheet ${context.sheetId} does not exist.`);
  const replacements = command.payload.replacements;
  if (!Array.isArray(replacements) || replacements.length === 0) {
    invalid('Style update requires at least one binding replacement.');
  }
  if (replacements.length > 100_000) {
    invalid('Style update cannot contain more than 100000 replacements.');
  }

  const seen = new Set<string>();
  for (const replacement of replacements) {
    if (
      replacement === null
      || typeof replacement !== 'object'
      || Array.isArray(replacement)
      || Object.keys(replacement).some((key) => key !== 'target' && key !== 'binding')
      || !Object.prototype.hasOwnProperty.call(replacement, 'target')
      || !Object.prototype.hasOwnProperty.call(replacement, 'binding')
    ) {
      invalid('Each style replacement must contain only target and binding.');
    }
    assertTargetShape(replacement.target);
    const identity = `${replacement.target.scope}:${replacement.target.id}`;
    if (seen.has(identity)) invalid(`Style target ${identity} is repeated.`);
    seen.add(identity);
    if (!getTargetEntity(sheet, replacement.target)) {
      invalid(`Style target ${identity} does not exist.`);
    }

    if (replacement.binding === null) continue;
    const schema = validateMindMapStyleBindingSchema(replacement.binding);
    if (!schema.valid) {
      const first = schema.errors[0];
      invalid(
        `Style binding for ${identity} is invalid at ${first?.instancePath || '/'}: ${first?.message ?? 'schema validation failed'}.`,
      );
    }
    if (replacement.binding.styleId !== undefined) {
      assertNamedStyleCompatible(
        context.document,
        replacement.binding.styleId,
        replacement.target.scope,
      );
    }
    if (
      replacement.target.scope === 'relationship'
      && replacement.binding.overrides !== undefined
    ) {
      assertRelationshipStyleProperties(
        replacement.binding.overrides,
        `Relationship ${replacement.target.id}`,
      );
    }
  }
};

export const applyUpdateStyleBindings = (
  document: Draft<MindMapDocumentV1>,
  command: UpdateStyleBindingsCommand,
): void => {
  const sheet = document.sheets[command.sheetId];
  for (const { binding, target } of command.payload.replacements) {
    const apply = (entity: { style?: StyleBinding }): void => {
      if (binding === null) delete entity.style;
      else entity.style = cloneStyleBinding(binding);
    };

    if (target.scope === 'topic') apply(sheet.topics[target.id]);
    else if (target.scope === 'tree-edge') apply(sheet.treeEdges[target.id]);
    else if (target.scope === 'relationship') apply(sheet.relationships[target.id]);
    else if (target.scope === 'boundary') apply(sheet.boundaries[target.id]);
    else if (target.scope === 'summary') apply(sheet.summaries[target.id]);
    else if (target.scope === 'callout') apply(sheet.callouts[target.id]);
    else apply(sheet.zones[target.id]);
  }
};
