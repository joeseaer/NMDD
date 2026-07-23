import { describe, expect, it } from 'vitest';

import { createTopic } from '../domain/defaults';
import { getChildEdgesSorted, getParentEdge, wouldCreateCycle } from '../domain/tree';
import type {
  CommandId,
  MindMapDocumentV1,
  OrderKey,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import { createMindMapV1SmallFixture } from '../testing';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type CreateTopicCommand,
  type DeleteTopicSubtreeCommand,
  type MindMapCommand,
  type ReorderTopicCommand,
  type ReparentTopicCommand,
  type ToggleTopicCollapseCommand,
} from './types';

const STEPS = 10_000;
const timestamp = '2026-07-18T12:00:00.000Z';

const uuid = <Kind extends string>(counter: number) =>
  `018f0000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as
    Kind extends 'Command' ? CommandId
      : Kind extends 'Topic' ? TopicId
        : TreeEdgeId;

const commandId = (step: number): CommandId => uuid<'Command'>(3_000_000 + step);
const orderKey = (prefix: string, step: number): OrderKey =>
  `${prefix}${step.toString(36).padStart(10, '0')}`;

const xorshift = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};

const at = <T>(values: readonly T[], random: () => number): T =>
  values[random() % values.length];

describe('mind map command invariant fuzzing', () => {
  it('preserves the tree and round-trips 10,000 deterministic random commands', {
    timeout: 60_000,
  }, () => {
    const initial = createMindMapV1SmallFixture();
    const initialTopicIds = new Set(
      Object.values(initial.sheets)[0]
        ? Object.keys(Object.values(initial.sheets)[0].topics)
        : [],
    );
    const random = xorshift(0x5eed_2026);
    const history = new PatchCommandHistory({ byteBudget: 128 * 1024 * 1024 });
    let document: MindMapDocumentV1 = initial;

    for (let step = 0; step < STEPS; step += 1) {
      const sheet = Object.values(document.sheets)[0];
      const topics = Object.values(sheet.topics);
      const nonRoot = topics.filter((topic) => topic.id !== sheet.rootTopicId);
      const action = random() % 5;
      let command: MindMapCommand;

      if (action === 0) {
        const topic = at(nonRoot, random);
        command = {
          commandId: commandId(step),
          type: MIND_MAP_COMMAND_TYPES.toggleTopicCollapse,
          sheetId: sheet.id,
          payload: { topicId: topic.id },
          baseRevision: document.contentRevision,
          origin: 'fuzz',
          timestamp,
        } satisfies ToggleTopicCollapseCommand;
      } else if (action === 1) {
        const topic = at(nonRoot, random);
        const incoming = getParentEdge(sheet, topic.id)!;
        const candidates = topics.filter((candidate) =>
          candidate.id !== topic.id
          && !wouldCreateCycle(sheet, candidate.id, topic.id));
        const parent = at(candidates, random);
        command = {
          commandId: commandId(step),
          type: MIND_MAP_COMMAND_TYPES.reparentTopic,
          sheetId: sheet.id,
          payload: {
            topicId: topic.id,
            edge: {
              ...incoming,
              parentTopicId: parent.id,
              orderKey: orderKey('p', step),
              side: parent.id === sheet.rootTopicId
                ? incoming.side === 'left' || incoming.side === 'right'
                  ? incoming.side
                  : 'right'
                : 'inherit',
            },
          },
          baseRevision: document.contentRevision,
          origin: 'fuzz',
          timestamp,
        } satisfies ReparentTopicCommand;
      } else if (action === 2) {
        const topic = at(nonRoot, random);
        command = {
          commandId: commandId(step),
          type: MIND_MAP_COMMAND_TYPES.reorderTopic,
          sheetId: sheet.id,
          payload: { topicId: topic.id, orderKey: orderKey('r', step) },
          baseRevision: document.contentRevision,
          origin: 'fuzz',
          timestamp,
        } satisfies ReorderTopicCommand;
      } else {
        const addedLeaves = topics.filter((topic) =>
          !initialTopicIds.has(topic.id)
          && getChildEdgesSorted(sheet, topic.id).length === 0);
        const shouldCreate = action === 3 || addedLeaves.length === 0;
        if (shouldCreate && topics.length < 40) {
          const parent = at(topics, random);
          const topicId = uuid<'Topic'>(5_000_000 + step * 2);
          command = {
            commandId: commandId(step),
            type: MIND_MAP_COMMAND_TYPES.createTopic,
            sheetId: sheet.id,
            payload: {
              topic: createTopic({ id: topicId, title: `Fuzz ${step}` }),
              edge: {
                id: uuid<'TreeEdge'>(5_000_001 + step * 2),
                parentTopicId: parent.id,
                childTopicId: topicId,
                orderKey: orderKey('c', step),
                side: parent.id === sheet.rootTopicId ? 'right' : 'inherit',
              },
            },
            baseRevision: document.contentRevision,
            origin: 'fuzz',
            timestamp,
          } satisfies CreateTopicCommand;
        } else {
          const leaf = at(addedLeaves, random);
          command = {
            commandId: commandId(step),
            type: MIND_MAP_COMMAND_TYPES.deleteTopicSubtree,
            sheetId: sheet.id,
            payload: { topicId: leaf.id },
            baseRevision: document.contentRevision,
            origin: 'fuzz',
            timestamp,
          } satisfies DeleteTopicSubtreeCommand;
        }
      }

      const execution = executeMindMapCommand(document, command);
      history.record(execution.applied);
      document = execution.document;
    }

    expect(history.undoDepth).toBe(STEPS);
    expect(validateMindMapDocument(document).valid).toBe(true);
    for (let step = 0; step < STEPS; step += 1) {
      document = history.undo(document)!.document;
    }
    expect(document).toEqual(initial);
    expect(history.canUndo).toBe(false);
    expect(history.redoDepth).toBe(STEPS);
  });
});
