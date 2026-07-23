import { describe, expect, it } from 'vitest';

import type {
  CommandId,
  StyleId,
  StyleProperties,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing';
import { CommandValidationError } from './errors';
import { executeMindMapCommand } from './engine';
import { PatchCommandHistory } from './history';
import {
  MIND_MAP_COMMAND_TYPES,
  type StyleBindingTarget,
  type UpdateStyleBindingsCommand,
} from './types';

const timestamp = '2026-07-19T00:00:00.000Z';
const commandId = (suffix: string): CommandId =>
  `format-${suffix}` as CommandId;
const literal = (value: string) => ({ kind: 'literal' as const, value });

const createCommand = (
  target: StyleBindingTarget,
  binding: UpdateStyleBindingsCommand['payload']['replacements'][number]['binding'],
): UpdateStyleBindingsCommand => {
  const document = createMindMapElementsFixture();
  const sheet = Object.values(document.sheets)[0];
  return {
    commandId: commandId('single'),
    type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
    sheetId: sheet.id,
    payload: { replacements: [{ target, binding }] },
    baseRevision: document.contentRevision,
    origin: 'test',
    timestamp,
  };
};

describe('style binding commands', () => {
  it('updates heterogeneous targets atomically and round-trips one history unit', () => {
    const before = createMindMapElementsFixture();
    const sheet = Object.values(before.sheets)[0];
    const topic = Object.values(sheet.topics).find((candidate) => candidate.role === 'regular')!;
    const edge = Object.values(sheet.treeEdges).find(
      (candidate) => candidate.childTopicId === topic.id,
    )!;
    const boundary = Object.values(sheet.boundaries)[0];
    topic.extensions = { 'vendor.example': { keep: true } };
    topic.style = {
      inheritance: 'default',
      overrides: {
        typography: { fontFamily: 'Inter', fontSize: 14 },
        fill: { opacity: 0.5 },
      },
    };
    const beforeJson = JSON.stringify(before);
    const command: UpdateStyleBindingsCommand = {
      commandId: commandId('atomic'),
      type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      sheetId: sheet.id,
      payload: {
        replacements: [
          {
            target: { scope: 'topic', id: topic.id },
            binding: {
              inheritance: 'default',
              overrides: {
                shape: 'pill',
                fill: { color: literal('#112233'), opacity: 0.5 },
                typography: { fontFamily: 'Inter', fontSize: 18, fontWeight: 700 },
              },
            },
          },
          {
            target: { scope: 'tree-edge', id: edge.id },
            binding: {
              overrides: {
                connector: {
                  color: literal('#445566'),
                  width: 4,
                  dash: [8, 4],
                  shape: 'curve',
                },
              },
            },
          },
          {
            target: { scope: 'boundary', id: boundary.id },
            binding: {
              overrides: {
                border: { color: literal('#778899'), radius: 12, width: 2 },
                fill: { color: literal('#AABBCC'), opacity: 0.25 },
              },
            },
          },
        ],
      },
      baseRevision: before.contentRevision,
      origin: 'test',
      timestamp,
    };

    const execution = executeMindMapCommand(before, command);
    const afterSheet = execution.document.sheets[sheet.id];
    expect(afterSheet.topics[topic.id].style).toEqual(command.payload.replacements[0].binding);
    expect(afterSheet.treeEdges[edge.id].style).toEqual(command.payload.replacements[1].binding);
    expect(afterSheet.boundaries[boundary.id].style).toEqual(command.payload.replacements[2].binding);
    expect(afterSheet.topics[topic.id].extensions).toEqual(topic.extensions);
    expect(JSON.stringify(before)).toBe(beforeJson);

    const payloadFill = command.payload.replacements[0].binding?.overrides?.fill;
    if (payloadFill) payloadFill.opacity = 0.9;
    expect(afterSheet.topics[topic.id].style?.overrides?.fill?.opacity).toBe(0.5);

    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    const undone = history.undo(execution.document)!;
    expect(undone.document).toEqual(before);
    expect(history.redo(undone.document)!.document).toEqual(execution.document);
  });

  it('removes a complete binding with null without touching the entity', () => {
    const before = createMindMapElementsFixture();
    const sheet = Object.values(before.sheets)[0];
    const callout = Object.values(sheet.callouts)[0];
    callout.style = { overrides: { fill: { color: literal('#123456') } } };
    callout.extensions = { 'vendor.example': { preserved: 1 } };
    const command = createCommand(
      { scope: 'callout', id: callout.id },
      null,
    );
    command.sheetId = sheet.id;
    command.baseRevision = before.contentRevision;

    const result = executeMindMapCommand(before, command).document;
    expect(result.sheets[sheet.id].callouts[callout.id].style).toBeUndefined();
    expect(result.sheets[sheet.id].callouts[callout.id].extensions)
      .toEqual(callout.extensions);
  });

  it('requires named Styles to exist and match the target scope', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const topic = Object.values(sheet.topics)[0];
    const edge = Object.values(sheet.treeEdges)[0];
    const styleId = '018f0000-0000-7000-8000-000000009901' as StyleId;
    document.styles[styleId] = {
      id: styleId,
      name: 'Topic emphasis',
      scope: 'topic',
      properties: { typography: { fontWeight: 700 } },
    };

    const valid = createCommand(
      { scope: 'topic', id: topic.id },
      { styleId },
    );
    valid.sheetId = sheet.id;
    valid.baseRevision = document.contentRevision;
    expect(executeMindMapCommand(document, valid).document.sheets[sheet.id].topics[topic.id].style)
      .toEqual({ styleId });

    const mismatch: UpdateStyleBindingsCommand = {
      ...valid,
      commandId: commandId('scope-mismatch'),
      payload: {
        replacements: [{ target: { scope: 'tree-edge', id: edge.id }, binding: { styleId } }],
      },
    };
    expect(() => executeMindMapCommand(document, mismatch)).toThrow(CommandValidationError);
  });

  it('rejects malformed bindings, duplicate/missing targets, and illegal Relationship fields', () => {
    const document = createMindMapElementsFixture();
    const sheet = Object.values(document.sheets)[0];
    const topic = Object.values(sheet.topics)[0];
    const relationship = Object.values(sheet.relationships)[0];
    const base = (replacements: UpdateStyleBindingsCommand['payload']['replacements']) => ({
      commandId: commandId('invalid'),
      type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      sheetId: sheet.id,
      payload: { replacements },
      baseRevision: document.contentRevision,
      origin: 'test',
      timestamp,
    }) satisfies UpdateStyleBindingsCommand;

    const invalidBindings = [
      { overrides: { opacity: 2 } },
      { overrides: { fill: { color: literal('red') } } },
      { overrides: { typography: { fontWeight: 500.5 } } },
      { overrides: { connector: { dash: [1, Number.POSITIVE_INFINITY] } } },
      { overrides: { unknown: true } },
    ];
    for (const binding of invalidBindings) {
      expect(() => executeMindMapCommand(document, base([{
        target: { scope: 'topic', id: topic.id },
        binding: binding as never,
      }]))).toThrow(CommandValidationError);
    }

    expect(() => executeMindMapCommand(document, base([
      { target: { scope: 'topic', id: topic.id }, binding: null },
      { target: { scope: 'topic', id: topic.id }, binding: null },
    ]))).toThrow(CommandValidationError);

    expect(() => executeMindMapCommand(document, base([{
      target: {
        scope: 'topic',
        id: '018f0000-0000-7000-8000-000000009999',
      } as StyleBindingTarget,
      binding: null,
    }]))).toThrow(CommandValidationError);

    const illegalRelationshipProperties: StyleProperties[] = [
      { shape: 'pill' },
      { opacity: 0.5 },
      { connector: { shape: 'curve' } },
      { connector: { startCap: 'arrow' } },
    ];
    for (const overrides of illegalRelationshipProperties) {
      expect(() => executeMindMapCommand(document, base([{
        target: { scope: 'relationship', id: relationship.id },
        binding: { overrides },
      }]))).toThrow(CommandValidationError);
    }

    expect(executeMindMapCommand(document, base([{
      target: { scope: 'relationship', id: relationship.id },
      binding: {
        overrides: {
          connector: { color: literal('#ABCDEF'), width: 3, dash: [6, 2] },
        },
      },
    }])).document.sheets[sheet.id].relationships[relationship.id].style)
      .toMatchObject({ overrides: { connector: { width: 3 } } });
  });
});

