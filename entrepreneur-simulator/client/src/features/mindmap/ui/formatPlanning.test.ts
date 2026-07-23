import { describe, expect, it } from 'vitest';

import { executeMindMapCommand, PatchCommandHistory } from '../commands';
import type { StyleBindingTarget } from '../commands/types';
import type { CommandId, StyleId } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing';
import {
  planResetStyleBindingsCommand,
  planUpdateStyleBindingsCommand,
} from './formatPlanning';

const literal = (value: string) => ({ kind: 'literal' as const, value });
const commandId = (suffix: string) => `format-plan-${suffix}` as CommandId;

describe('format command planning', () => {
  it('deep-merges one changed field across mixed Topic selections in one command', () => {
    const before = createMindMapV1SmallFixture();
    const sheet = Object.values(before.sheets)[0];
    const topics = Object.values(sheet.topics).filter((topic) => topic.role === 'regular').slice(0, 2);
    topics[0].style = {
      inheritance: 'default',
      overrides: {
        shape: 'pill',
        fill: { color: literal('#111111'), opacity: 0.2 },
        typography: { fontFamily: 'Inter', fontSize: 13 },
      },
    };
    topics[1].style = {
      overrides: {
        border: { radius: 7, width: 2 },
        fill: { color: literal('#222222'), opacity: 0.8 },
        typography: { fontFamily: 'Noto Sans CJK SC', fontSize: 16 },
      },
    };
    topics[0].extensions = { 'vendor.example': { untouched: true } };
    const targets = topics.map((topic) => ({
      scope: 'topic' as const,
      id: topic.id,
    }));

    const command = planUpdateStyleBindingsCommand({
      document: before,
      sheetId: sheet.id,
      targets,
      overrides: {
        fill: { color: literal('#336699') },
        typography: { fontWeight: 700 },
      },
      commandId: commandId('mixed'),
      timestamp: '2026-07-19T00:00:00.000Z',
    });
    expect(command.payload.replacements).toHaveLength(2);
    expect(command.payload.replacements[0].binding).toMatchObject({
      inheritance: 'default',
      overrides: {
        shape: 'pill',
        fill: { color: literal('#336699'), opacity: 0.2 },
        typography: { fontFamily: 'Inter', fontSize: 13, fontWeight: 700 },
      },
    });
    expect(command.payload.replacements[1].binding).toMatchObject({
      overrides: {
        border: { radius: 7, width: 2 },
        fill: { color: literal('#336699'), opacity: 0.8 },
        typography: {
          fontFamily: 'Noto Sans CJK SC',
          fontSize: 16,
          fontWeight: 700,
        },
      },
    });

    const execution = executeMindMapCommand(before, command);
    expect(execution.document.sheets[sheet.id].topics[topics[0].id].extensions)
      .toEqual(topics[0].extensions);
    const history = new PatchCommandHistory();
    history.record(execution.applied);
    expect(history.undoDepth).toBe(1);
    const undone = history.undo(execution.document)!;
    expect(undone.document).toEqual(before);
    expect(history.redo(undone.document)!.document).toEqual(execution.document);
  });

  it('plans Topic text/shape/fill plus branch line fields without changing content', () => {
    const before = createMindMapV1SmallFixture();
    const sheet = Object.values(before.sheets)[0];
    const topic = Object.values(sheet.topics).find((candidate) => candidate.role === 'regular')!;
    const edge = Object.values(sheet.treeEdges).find(
      (candidate) => candidate.childTopicId === topic.id,
    )!;
    const titleBefore = structuredClone(topic.title);

    const topicCommand = planUpdateStyleBindingsCommand({
      document: before,
      sheetId: sheet.id,
      targets: [{ scope: 'topic', id: topic.id }],
      overrides: {
        opacity: 0.9,
        shape: 'rounded-rectangle',
        fill: { color: literal('#FEF3C7') },
        border: { color: literal('#F59E0B'), radius: 10, width: 2 },
        typography: {
          align: 'center',
          color: literal('#78350F'),
          fontFamily: 'Inter',
          fontSize: 17,
          fontWeight: 600,
          italic: true,
          strike: false,
          underline: true,
        },
      },
    });
    const withTopicStyle = executeMindMapCommand(before, topicCommand).document;
    const edgeCommand = planUpdateStyleBindingsCommand({
      document: withTopicStyle,
      sheetId: sheet.id,
      targets: [{ scope: 'tree-edge', id: edge.id }],
      overrides: {
        connector: {
          color: literal('#2563EB'),
          dash: [10, 4],
          endCap: 'round',
          shape: 'rounded-elbow',
          taper: 'end',
          width: 5,
        },
      },
    });
    const after = executeMindMapCommand(withTopicStyle, edgeCommand).document;

    expect(after.sheets[sheet.id].topics[topic.id].title).toEqual(titleBefore);
    expect(after.sheets[sheet.id].topics[topic.id].style?.overrides)
      .toMatchObject({ shape: 'rounded-rectangle', typography: { fontSize: 17 } });
    expect(after.sheets[sheet.id].treeEdges[edge.id].style?.overrides?.connector)
      .toMatchObject({ shape: 'rounded-elbow', width: 5, taper: 'end' });
  });

  it('resets one override path or the complete binding while preserving siblings', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const topic = Object.values(sheet.topics)[0];
    const styleId = '018f0000-0000-7000-8000-000000009902' as StyleId;
    document.styles[styleId] = {
      id: styleId,
      name: 'Topic base',
      scope: 'topic',
      properties: { fill: { color: literal('#FFFFFF') } },
    };
    topic.style = {
      styleId,
      inheritance: 'break',
      overrides: {
        fill: { color: literal('#123456'), opacity: 0.4 },
        typography: { fontFamily: 'Inter', fontSize: 20 },
      },
    };
    const target = { scope: 'topic' as const, id: topic.id };

    const partial = planResetStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target],
      paths: ['fill.color', 'typography.fontSize'],
    });
    expect(partial.payload.replacements[0].binding).toEqual({
      styleId,
      inheritance: 'break',
      overrides: {
        fill: { opacity: 0.4 },
        typography: { fontFamily: 'Inter' },
      },
    });
    const partiallyReset = executeMindMapCommand(document, partial).document;

    const all = planResetStyleBindingsCommand({
      document: partiallyReset,
      sheetId: sheet.id,
      targets: [target],
    });
    expect(all.payload.replacements).toEqual([{ target, binding: null }]);
    expect(executeMindMapCommand(partiallyReset, all).document.sheets[sheet.id].topics[topic.id].style)
      .toBeUndefined();
  });

  it('removes named-style metadata independently and rejects ambiguous/no-op requests', () => {
    const document = createMindMapV1SmallFixture();
    const sheet = Object.values(document.sheets)[0];
    const topic = Object.values(sheet.topics)[0];
    topic.style = {
      inheritance: 'break',
      overrides: { fill: { opacity: 0.5 } },
    };
    const target: StyleBindingTarget = { scope: 'topic', id: topic.id };

    const clearInheritance = planUpdateStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target],
      inheritance: null,
    });
    expect(clearInheritance.payload.replacements[0].binding).toEqual({
      overrides: { fill: { opacity: 0.5 } },
    });

    expect(() => planUpdateStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target],
      overrides: {},
    })).toThrow('requires overrides');
    expect(() => planUpdateStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target, target],
      overrides: { opacity: 0.5 },
    })).toThrow('repeated');
    expect(() => planResetStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target],
      paths: [],
    })).toThrow('cannot be empty');
    expect(() => planResetStyleBindingsCommand({
      document,
      sheetId: sheet.id,
      targets: [target],
      paths: ['fill.color'],
    })).toThrow('does not change');
  });
});
