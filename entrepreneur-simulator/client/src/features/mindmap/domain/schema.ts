import Ajv2020, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import canonicalMindMapSchema from '../../../../../docs/xmind-parity/mindmap.schema.json';

export interface MindMapSchemaError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly schemaPath: string;
}

export interface MindMapSchemaValidation {
  readonly errors: readonly MindMapSchemaError[];
  readonly valid: boolean;
}

export const MIND_MAP_SCHEMA_ID = 'https://schemas.nmdd.app/mindmap/v1.json';
export const mindMapDocumentSchema = canonicalMindMapSchema;

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  messages: true,
  strictNumbers: true,
  strictRequired: false,
  strictSchema: true,
  strictTypes: false,
  unicodeRegExp: true,
  validateFormats: true,
});

addFormats(ajv);

const validateDocument: ValidateFunction = ajv.compile(
  canonicalMindMapSchema as AnySchema,
);

const canonicalSchemaParts = canonicalMindMapSchema as unknown as {
  $schema?: string;
  $defs: Record<string, AnySchema>;
};
const styleBindingDefinition = canonicalSchemaParts.$defs.styleBinding as Record<
  string,
  unknown
>;
const richTextDefinition = canonicalSchemaParts.$defs.richText as Record<string, unknown>;
const zoneDefinition = canonicalSchemaParts.$defs.zone as Record<string, unknown>;
const noteDefinition = canonicalSchemaParts.$defs.note as Record<string, unknown>;
const topicLinkDefinition = canonicalSchemaParts.$defs.topicLink as Record<string, unknown>;
const topicTodoDefinition = canonicalSchemaParts.$defs.topicTodo as Record<string, unknown>;
const topicTaskDefinition = canonicalSchemaParts.$defs.topicTask as Record<string, unknown>;
const markerGroupDefinition = canonicalSchemaParts.$defs.markerGroup as Record<string, unknown>;
const markerDefinitionDefinition = canonicalSchemaParts.$defs.markerDefinition as Record<string, unknown>;
const markerInstanceDefinition = canonicalSchemaParts.$defs.markerInstance as Record<string, unknown>;
const markerLegendDefinition = canonicalSchemaParts.$defs.markerLegendSpec as Record<string, unknown>;
const taskDependencyDefinition = canonicalSchemaParts.$defs.taskDependency as Record<
  string,
  unknown
>;

/**
 * Reuses the canonical $defs instead of maintaining a second hand-written
 * validator at the command boundary. This keeps format commands aligned with
 * every numeric bound and enum in mindmap.schema.json.
 */
const validateStyleBinding: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...styleBindingDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateZone: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...zoneDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateRichText: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...richTextDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateNote: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...noteDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateTopicLink: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...topicLinkDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateTopicTodo: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...topicTodoDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateTopicTask: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...topicTaskDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateMarkerGroup: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...markerGroupDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateMarkerDefinition: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...markerDefinitionDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateMarkerInstance: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...markerInstanceDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateMarkerLegend: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...markerLegendDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);
const validateTaskDependency: ValidateFunction = ajv.compile({
  ...(canonicalSchemaParts.$schema
    ? { $schema: canonicalSchemaParts.$schema }
    : {}),
  ...taskDependencyDefinition,
  $defs: canonicalSchemaParts.$defs,
} as AnySchema);

function copyError(error: ErrorObject): MindMapSchemaError {
  return {
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'Schema validation failed',
    params: { ...error.params },
    schemaPath: error.schemaPath,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareErrors(left: MindMapSchemaError, right: MindMapSchemaError): number {
  return (
    compareText(left.instancePath, right.instancePath) ||
    compareText(left.keyword, right.keyword) ||
    compareText(left.schemaPath, right.schemaPath) ||
    compareText(left.message, right.message)
  );
}

/**
 * Validates the canonical document shape only. Cross-record and graph semantics
 * are deliberately handled by the invariant layer.
 */
export function validateMindMapSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateDocument(value);
  if (valid) {
    return { errors: [], valid: true };
  }

  const errors = (validateDocument.errors ?? []).map(copyError).sort(compareErrors);
  return { errors, valid: false };
}

/** Validates a complete canonical StyleBinding in isolation. */
export function validateMindMapStyleBindingSchema(
  value: unknown,
): MindMapSchemaValidation {
  const valid = validateStyleBinding(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateStyleBinding.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical Zone entity in isolation. */
export function validateMindMapZoneSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateZone(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateZone.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates canonical RichText V1 without requiring a containing document. */
export function validateMindMapRichTextSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateRichText(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateRichText.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical Note entity in isolation. */
export function validateMindMapNoteSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateNote(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateNote.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical TopicLink entity in isolation. */
export function validateMindMapTopicLinkSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateTopicLink(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateTopicLink.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical lightweight TopicTodo entity in isolation. */
export function validateMindMapTopicTodoSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateTopicTodo(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateTopicTodo.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical TopicTask entity in isolation. */
export function validateMindMapTopicTaskSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateTopicTask(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateTopicTask.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical MarkerGroup entity in isolation. */
export function validateMindMapMarkerGroupSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateMarkerGroup(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateMarkerGroup.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical MarkerDefinition entity in isolation. */
export function validateMindMapMarkerDefinitionSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateMarkerDefinition(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateMarkerDefinition.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical MarkerInstance entity in isolation. */
export function validateMindMapMarkerInstanceSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateMarkerInstance(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateMarkerInstance.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical MarkerLegendSpec in isolation. */
export function validateMindMapMarkerLegendSchema(value: unknown): MindMapSchemaValidation {
  const valid = validateMarkerLegend(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateMarkerLegend.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}

/** Validates a complete canonical TaskDependency entity in isolation. */
export function validateMindMapTaskDependencySchema(
  value: unknown,
): MindMapSchemaValidation {
  const valid = validateTaskDependency(value);
  if (valid) return { errors: [], valid: true };
  return {
    errors: (validateTaskDependency.errors ?? []).map(copyError).sort(compareErrors),
    valid: false,
  };
}
