import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createNewMindMapDocument,
  createRichText,
  createTopic,
} from '../domain/defaults';
import { createOrderKeyBetween } from '../domain/orderKey';
import type {
  CommandId,
  DocumentId,
  SheetId,
  ThemeId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import {
  CommandRevisionError,
  CommandValidationError,
  ReadOnlyCommandError,
  UnknownMindMapCommandError,
} from './errors';
import {
  createMindMapCommandEngine,
  executeMindMapCommand,
  type EditableMindMapDispatch,
} from './engine';
import { CORE_MIND_MAP_COMMAND_REGISTRY } from './registry';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateTopicCommand,
  type MindMapCommand,
  type ReparentTopicCommand,
  type ToggleTopicCollapseCommand,
  type UpdateTopicTitleCommand,
} from './types';

const IDS = {
  document: '018f0000-0000-7000-8000-000000000001' as DocumentId,
  sheet: '018f0000-0000-7000-8000-000000000002' as SheetId,
  theme: '018f0000-0000-7000-8000-000000000003' as ThemeId,
  root: '018f0000-0000-7000-8000-000000000004' as TopicId,
  a: '018f0000-0000-7000-8000-000000000005' as TopicId,
  b: '018f0000-0000-7000-8000-000000000006' as TopicId,
  edgeA: '018f0000-0000-7000-8000-000000000007' as TreeEdgeId,
  edgeB: '018f0000-0000-7000-8000-000000000008' as TreeEdgeId,
};

const commandId = (value: string): CommandId => value as CommandId;
const timestamp = '2026-07-18T12:00:00.000Z';
const centerKey = createOrderKeyBetween();
const beforeCenterKey = createOrderKeyBetween(null, centerKey);
const afterCenterKey = createOrderKeyBetween(centerKey, null);

const createDocument = () => createNewMindMapDocument({
  documentId: IDS.document,
  sheetId: IDS.sheet,
  rootTopicId: IDS.root,
  themeId: IDS.theme,
  sheetOrderKey: centerKey,
  rootTitle: 'Root',
});

const createTopicCommand = (
  topicId: TopicId,
  edgeId: TreeEdgeId,
  parentTopicId: TopicId,
  baseRevision: number,
): CreateTopicCommand => ({
  commandId: commandId(`create-${topicId}`),
  type: MIND_MAP_COMMAND_TYPES.createTopic,
  sheetId: IDS.sheet,
  payload: {
    topic: createTopic({ id: topicId, title: topicId }),
    edge: {
      id: edgeId,
      parentTopicId,
      childTopicId: topicId,
      orderKey: centerKey,
      side: 'right',
    },
  },
  baseRevision,
  origin: 'test',
  timestamp,
});

const updateTitleCommand = (
  title: string,
  baseRevision = 0,
): UpdateTopicTitleCommand => ({
  commandId: commandId(`title-${baseRevision}-${title}`),
  type: MIND_MAP_COMMAND_TYPES.updateTopicTitle,
  sheetId: IDS.sheet,
  payload: { topicId: IDS.root, title: createRichText(title) },
  baseRevision,
  origin: 'test',
  timestamp,
});

describe('mind-map command execution', () => {
  it('rejects a reparent that would create a tree cycle', () => {
    const initial = createDocument();
    const withA = executeMindMapCommand(
      initial,
      createTopicCommand(IDS.a, IDS.edgeA, IDS.root, 0),
    ).document;
    const withB = executeMindMapCommand(
      withA,
      createTopicCommand(IDS.b, IDS.edgeB, IDS.a, 1),
    ).document;
    const cycle: ReparentTopicCommand = {
      commandId: commandId('cycle'),
      type: MIND_MAP_COMMAND_TYPES.reparentTopic,
      sheetId: IDS.sheet,
      payload: {
        topicId: IDS.a,
        edge: {
          id: IDS.edgeA,
          parentTopicId: IDS.b,
          childTopicId: IDS.a,
          orderKey: centerKey,
          side: 'right',
        },
      },
      baseRevision: 2,
      origin: 'test',
      timestamp,
    };

    expect(() => executeMindMapCommand(withB, cycle)).toThrow(CommandValidationError);
    expect(withB.contentRevision).toBe(2);
    expect(withB.sheets[IDS.sheet].treeEdges[IDS.edgeA].parentTopicId).toBe(IDS.root);
  });

  it('rejects stale base revisions before mutating content', () => {
    const document = createDocument();
    expect(() => executeMindMapCommand(document, updateTitleCommand('stale', 4)))
      .toThrow(CommandRevisionError);
    expect(document.contentRevision).toBe(0);
  });

  it('increments contentRevision for a successful content command', () => {
    const document = createDocument();
    const command: ToggleTopicCollapseCommand = {
      commandId: commandId('collapse'),
      type: MIND_MAP_COMMAND_TYPES.toggleTopicCollapse,
      sheetId: IDS.sheet,
      payload: { topicId: IDS.root },
      baseRevision: 0,
      origin: 'keyboard',
      timestamp,
    };
    const result = executeMindMapCommand(document, command);

    expect(result.document.contentRevision).toBe(1);
    expect(result.document.sheets[IDS.sheet].topics[IDS.root].defaultCollapsed).toBe(true);
    expect(result.applied.forwardPatches.length).toBeGreaterThan(0);
    expect(result.applied.inversePatches.length).toBeGreaterThan(0);
  });

  it('applies create, reorder, reparent, collapse, and subtree delete atomically', () => {
    let document = createDocument();
    document = executeMindMapCommand(
      document,
      createTopicCommand(IDS.a, IDS.edgeA, IDS.root, 0),
    ).document;
    const createB = createTopicCommand(IDS.b, IDS.edgeB, IDS.root, 1);
    createB.payload.edge!.orderKey = afterCenterKey;
    document = executeMindMapCommand(document, createB).document;

    document = executeMindMapCommand(document, {
      commandId: commandId('reorder-b'),
      type: MIND_MAP_COMMAND_TYPES.reorderTopic,
      sheetId: IDS.sheet,
      payload: { topicId: IDS.b, orderKey: beforeCenterKey, side: 'left' },
      baseRevision: 2,
      origin: 'pointer',
      timestamp,
    }).document;
    expect(document.sheets[IDS.sheet].treeEdges[IDS.edgeB]).toMatchObject({
      parentTopicId: IDS.root,
      orderKey: beforeCenterKey,
      side: 'left',
    });

    document = executeMindMapCommand(document, {
      commandId: commandId('reparent-b'),
      type: MIND_MAP_COMMAND_TYPES.reparentTopic,
      sheetId: IDS.sheet,
      payload: {
        topicId: IDS.b,
        edge: {
          id: IDS.edgeB,
          parentTopicId: IDS.a,
          childTopicId: IDS.b,
          orderKey: centerKey,
          side: 'right',
        },
      },
      baseRevision: 3,
      origin: 'pointer',
      timestamp,
    }).document;
    document = executeMindMapCommand(document, {
      commandId: commandId('collapse-a'),
      type: MIND_MAP_COMMAND_TYPES.toggleTopicCollapse,
      sheetId: IDS.sheet,
      payload: { topicId: IDS.a, collapsed: true },
      baseRevision: 4,
      origin: 'keyboard',
      timestamp,
    }).document;
    document = executeMindMapCommand(document, {
      commandId: commandId('delete-a'),
      type: MIND_MAP_COMMAND_TYPES.deleteTopicSubtree,
      sheetId: IDS.sheet,
      payload: { topicId: IDS.a },
      baseRevision: 5,
      origin: 'keyboard',
      timestamp,
    }).document;

    expect(document.contentRevision).toBe(6);
    expect(document.sheets[IDS.sheet].topics[IDS.a]).toBeUndefined();
    expect(document.sheets[IDS.sheet].topics[IDS.b]).toBeUndefined();
    expect(Object.keys(document.sheets[IDS.sheet].treeEdges)).toHaveLength(0);
  });

  it('rejects content dispatch from read-only engines in types and at runtime', () => {
    const engine = createMindMapCommandEngine({ readOnly: true });
    expectTypeOf(engine.dispatch).toEqualTypeOf<never>();

    const unsafeDispatch = engine.dispatch as unknown as EditableMindMapDispatch;
    expect(() => unsafeDispatch(createDocument(), updateTitleCommand('blocked')))
      .toThrow(ReadOnlyCommandError);
  });

  it('keeps selection outside the command union, registry, and revision stream', () => {
    type SelectionCommand = Extract<MindMapCommand, { type: 'selection.set' }>;
    expectTypeOf<SelectionCommand>().toEqualTypeOf<never>();
    expect(CORE_MIND_MAP_COMMAND_REGISTRY.has('selection.set')).toBe(false);

    const document = createDocument();
    const selectionCommand = {
      commandId: commandId('selection'),
      type: 'selection.set',
      sheetId: IDS.sheet,
      payload: { topicIds: [IDS.root] },
      baseRevision: 0,
      origin: 'pointer',
      timestamp,
    } as unknown as MindMapCommand;
    expect(() => executeMindMapCommand(document, selectionCommand))
      .toThrow(UnknownMindMapCommandError);
    expect(document.contentRevision).toBe(0);
  });
});
