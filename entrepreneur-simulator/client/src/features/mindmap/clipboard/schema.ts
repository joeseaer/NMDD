import Ajv2020, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import { MIND_MAP_SCHEMA_ID, mindMapDocumentSchema } from '../domain/schema';

const ref = (definition: string): string => `${MIND_MAP_SCHEMA_ID}#/$defs/${definition}`;

const entityTypes = [
  'topic',
  'tree-edge',
  'relationship',
  'relationship-control-point',
  'boundary',
  'summary',
  'callout',
  'zone',
  'style',
  'marker-group',
  'marker-definition',
  'marker-instance',
  'note',
  'link',
  'asset',
  'attachment',
  'image',
  'equation',
  'audio-clip',
  'todo',
  'task',
  'task-dependency',
] as const;

const omissionReasons = [
  'external-endpoint',
  'external-scope',
  'external-topic-link',
  'sheet-link',
  'partial-zone',
] as const;

export const mindMapClipboardEnvelopeSchema = {
  $id: 'https://schemas.nmdd.app/mindmap/clipboard/v1.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  properties: {
    fragment: {
      additionalProperties: false,
      properties: {
        assets: { $ref: ref('assetMap') },
        attachments: { $ref: ref('attachmentMap') },
        audioClips: { $ref: ref('audioClipMap') },
        boundaries: { $ref: ref('boundaryMap') },
        callouts: { $ref: ref('calloutMap') },
        equations: { $ref: ref('equationMap') },
        images: { $ref: ref('topicImageMap') },
        links: { $ref: ref('topicLinkMap') },
        markerDefinitions: { $ref: ref('markerDefinitionMap') },
        markerGroups: { $ref: ref('markerGroupMap') },
        markerInstances: { $ref: ref('markerInstanceMap') },
        notes: { $ref: ref('noteMap') },
        relationships: { $ref: ref('relationshipMap') },
        styles: { $ref: ref('styleDefinitionMap') },
        summaries: { $ref: ref('summaryMap') },
        taskDependencies: { $ref: ref('taskDependencyMap') },
        tasks: { $ref: ref('topicTaskMap') },
        todos: { $ref: ref('topicTodoMap') },
        topics: { $ref: ref('topicMap') },
        treeEdges: { $ref: ref('treeEdgeMap') },
        zones: { $ref: ref('zoneMap') },
      },
      required: [
        'assets',
        'attachments',
        'audioClips',
        'boundaries',
        'callouts',
        'equations',
        'images',
        'links',
        'markerDefinitions',
        'markerGroups',
        'markerInstances',
        'notes',
        'relationships',
        'styles',
        'summaries',
        'taskDependencies',
        'tasks',
        'todos',
        'topics',
        'treeEdges',
        'zones',
      ],
      type: 'object',
    },
    report: {
      additionalProperties: false,
      properties: {
        omissions: {
          items: {
            additionalProperties: false,
            properties: {
              entityId: { $ref: ref('uuidv7') },
              entityType: { enum: entityTypes },
              reason: { enum: omissionReasons },
            },
            required: ['entityId', 'entityType', 'reason'],
            type: 'object',
          },
          maxItems: 100000,
          type: 'array',
        },
      },
      required: ['omissions'],
      type: 'object',
    },
    rootHints: {
      items: {
        additionalProperties: false,
        properties: {
          orderKey: { $ref: ref('orderKey') },
          side: {
            enum: ['left', 'right', 'top', 'bottom', 'center', 'inherit'],
          },
          slot: { maxLength: 256, type: 'string' },
          topicId: { $ref: ref('uuidv7') },
        },
        required: ['orderKey', 'side', 'topicId'],
        type: 'object',
      },
      maxItems: 100000,
      type: 'array',
    },
    rootTopicIds: {
      items: { $ref: ref('uuidv7') },
      maxItems: 100000,
      minItems: 1,
      type: 'array',
      uniqueItems: true,
    },
    schema: { const: 'app.nmdd.mindmap.clipboard' },
    schemaVersion: { const: 1 },
    source: {
      additionalProperties: false,
      properties: {
        contentRevision: { minimum: 0, type: 'integer' },
        documentId: { $ref: ref('uuidv7') },
        sheetId: { $ref: ref('uuidv7') },
      },
      required: ['contentRevision', 'documentId', 'sheetId'],
      type: 'object',
    },
  },
  required: [
    'fragment',
    'report',
    'rootHints',
    'rootTopicIds',
    'schema',
    'schemaVersion',
    'source',
  ],
  type: 'object',
} as const;

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strictNumbers: true,
  strictRequired: false,
  strictSchema: true,
  strictTypes: false,
  unicodeRegExp: true,
  validateFormats: true,
});
addFormats(ajv);
ajv.addSchema(mindMapDocumentSchema as AnySchema);

const validateEnvelope: ValidateFunction = ajv.compile(
  mindMapClipboardEnvelopeSchema as AnySchema,
);

function formatError(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? error.keyword}`;
}

export function validateMindMapClipboardEnvelopeSchema(value: unknown): readonly string[] {
  if (validateEnvelope(value)) return [];
  return (validateEnvelope.errors ?? []).map(formatError).sort();
}
