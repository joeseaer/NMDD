import { describe, expect, it } from 'vitest';

import { executeMindMapCommand } from '../commands/engine';
import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import { createRichText } from '../domain/defaults';
import type {
  ArrowHead,
  BoundaryId,
  CalloutId,
  ElementRef,
  RelationshipId,
  RichText,
  SheetId,
  SummaryId,
  ZoneId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  buildSemanticPropertiesModel,
  planUpdateRelationshipArrowCommand,
  planUpdateRelationshipLineColorCommand,
  planUpdateRelationshipLineStyleCommand,
  planUpdateRelationshipLineWidthCommand,
  planUpdateRelationshipRoutingCommand,
  planUpdateSemanticContentCommand,
  planUpdateSummaryLineStyleCommand,
  planUpdateSummaryOrientationCommand,
  planUpdateSummaryStyleCommand,
} from './semanticPropertiesPlanning';

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const relationship = Object.values(sheet.relationships)[0];
  const boundary = Object.values(sheet.boundaries)[0];
  const summary = Object.values(sheet.summaries)[0];
  const callout = Object.values(sheet.callouts)[0];
  const zone = Object.values(sheet.zones)[0];
  const refs = {
    relationship: { kind: 'relationship', id: relationship.id } as const,
    boundary: { kind: 'boundary', id: boundary.id } as const,
    summary: { kind: 'summary', id: summary.id } as const,
    callout: { kind: 'callout', id: callout.id } as const,
    zone: { kind: 'zone', id: zone.id } as const,
  };
  return {
    document,
    sheet,
    sheetId,
    relationship,
    boundary,
    summary,
    callout,
    zone,
    refs,
  };
};

describe('semantic properties planning', () => {
  it('projects all five semantic kinds, including Summary result-topic content', () => {
    const { document, sheetId, refs, summary } = setup();
    const relationship = buildSemanticPropertiesModel(document, sheetId, refs.relationship);
    const boundary = buildSemanticPropertiesModel(document, sheetId, refs.boundary);
    const summaryModel = buildSemanticPropertiesModel(document, sheetId, refs.summary);
    const callout = buildSemanticPropertiesModel(document, sheetId, refs.callout);
    const zone = buildSemanticPropertiesModel(document, sheetId, refs.zone);

    expect(relationship).toMatchObject({
      kind: 'relationship',
      contentLabel: '关系标题',
      routing: 'curve',
      lineStyle: 'default',
      startArrow: 'none',
      endArrow: 'triangle',
    });
    expect(boundary).toMatchObject({ kind: 'boundary', contentLabel: '边界标题' });
    expect(summaryModel).toMatchObject({
      kind: 'summary',
      contentLabel: '概要内容',
      resultTopicId: summary.resultTopicId,
      orientation: 'right',
      lineStyle: 'default',
    });
    expect(mindMapRichTextToPlainText(summaryModel?.content)).toBe('第一阶段完成');
    expect(callout).toMatchObject({ kind: 'callout', contentLabel: '标注内容' });
    expect(zone).toMatchObject({ kind: 'zone', contentLabel: '区域标题' });
    expect(buildSemanticPropertiesModel(document, sheetId, {
      kind: 'topic',
      id: document.sheets[sheetId].rootTopicId,
    })).toBeNull();
  });

  it('updates Summary orientation and line style through canonical commands', () => {
    const { document, sheetId, refs, summary } = setup();
    const orientation = planUpdateSummaryOrientationCommand({
      document,
      sheetId,
      element: refs.summary,
      orientation: 'bottom',
    });
    expect(orientation).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.updateSummary,
      payload: { summary: { id: summary.id, orientation: 'bottom' } },
    });
    const oriented = executeMindMapCommand(document, orientation).document;

    const color = planUpdateSummaryStyleCommand({
      document: oriented,
      sheetId,
      element: refs.summary,
      border: { color: { kind: 'literal', value: '#A855F7' }, width: 4 },
    });
    const colored = executeMindMapCommand(oriented, color).document;
    expect(colored.sheets[sheetId].summaries[summary.id].style?.overrides?.border)
      .toMatchObject({ color: { kind: 'literal', value: '#A855F7' }, width: 4 });

    const dashed = planUpdateSummaryLineStyleCommand({
      document: colored,
      sheetId,
      element: refs.summary,
      lineStyle: 'dashed',
    });
    const styled = executeMindMapCommand(colored, dashed).document;
    expect(styled.sheets[sheetId].summaries[summary.id].style?.overrides?.border?.dash)
      .toEqual([6, 4]);
    expect(styled.sheets[sheetId].summaries[summary.id].orientation).toBe('bottom');
  });

  it.each([
    ['relationship', MIND_MAP_COMMAND_TYPES.updateRelationship],
    ['boundary', MIND_MAP_COMMAND_TYPES.updateBoundary],
    ['summary', MIND_MAP_COMMAND_TYPES.updateTopicTitle],
    ['callout', MIND_MAP_COMMAND_TYPES.updateCallout],
    ['zone', MIND_MAP_COMMAND_TYPES.updateZone],
  ] as const)('plans and executes %s content as exactly one command', (kind, commandType) => {
    const setupResult = setup();
    const { document, sheetId, refs } = setupResult;
    const content = createRichText(`更新-${kind}`);
    const command = planUpdateSemanticContentCommand({
      document,
      sheetId,
      element: refs[kind],
      content,
      commandId: `semantic-content-${kind}` as never,
      timestamp: '2026-07-19T08:00:00.000Z',
    });

    expect(command.type).toBe(commandType);
    expect(Array.isArray(command)).toBe(false);
    const execution = executeMindMapCommand(document, command);
    const nextSheet = execution.document.sheets[sheetId];
    const actual = kind === 'relationship'
      ? nextSheet.relationships[setupResult.relationship.id].title
      : kind === 'boundary'
        ? nextSheet.boundaries[setupResult.boundary.id].title
        : kind === 'summary'
          ? nextSheet.topics[setupResult.summary.resultTopicId].title
          : kind === 'callout'
            ? nextSheet.callouts[setupResult.callout.id].content
            : nextSheet.zones[setupResult.zone.id].title;
    expect(mindMapRichTextToPlainText(actual)).toBe(`更新-${kind}`);
    expect(execution.document.contentRevision).toBe(document.contentRevision + 1);
  });

  it('updates Relationship routing and either arrow without changing unrelated fields', () => {
    const { document, sheetId, refs, relationship } = setup();
    const routeCommand = planUpdateRelationshipRoutingCommand({
      document,
      sheetId,
      element: refs.relationship,
      routing: 'orthogonal',
    });
    const routed = executeMindMapCommand(document, routeCommand).document;
    expect(routed.sheets[sheetId].relationships[relationship.id]).toEqual({
      ...relationship,
      routing: 'orthogonal',
    });

    const arrowCommand = planUpdateRelationshipArrowCommand({
      document: routed,
      sheetId,
      element: refs.relationship,
      endpoint: 'start',
      arrow: 'open-diamond',
    });
    const arrowed = executeMindMapCommand(routed, arrowCommand).document;
    expect(arrowed.sheets[sheetId].relationships[relationship.id]).toEqual({
      ...relationship,
      routing: 'orthogonal',
      startArrow: 'open-diamond',
    });
  });

  it('uses one style-binding command for line presets and preserves unrelated binding state', () => {
    const { document, sheetId, refs, relationship } = setup();
    relationship.style = {
      inheritance: 'break',
      overrides: {
        connector: {
          color: { kind: 'literal', value: '#123456' },
          width: 3,
        },
      },
    };
    const dashedCommand = planUpdateRelationshipLineStyleCommand({
      document,
      sheetId,
      element: refs.relationship,
      lineStyle: 'dashed',
    });
    expect(dashedCommand.type).toBe(MIND_MAP_COMMAND_TYPES.updateStyleBindings);
    expect(dashedCommand.payload.replacements).toHaveLength(1);
    const dashed = executeMindMapCommand(document, dashedCommand).document;
    expect(dashed.sheets[sheetId].relationships[relationship.id].style).toEqual({
      inheritance: 'break',
      overrides: {
        connector: {
          color: { kind: 'literal', value: '#123456' },
          width: 3,
          dash: [6, 4],
        },
      },
    });

    const resetCommand = planUpdateRelationshipLineStyleCommand({
      document: dashed,
      sheetId,
      element: refs.relationship,
      lineStyle: 'default',
    });
    const reset = executeMindMapCommand(dashed, resetCommand).document;
    expect(reset.sheets[sheetId].relationships[relationship.id].style).toEqual({
      inheritance: 'break',
      overrides: {
        connector: {
          color: { kind: 'literal', value: '#123456' },
          width: 3,
        },
      },
    });
  });

  it('plans line color and width as isolated style commands with reset support', () => {
    const { document, sheetId, refs, relationship } = setup();
    const colorCommand = planUpdateRelationshipLineColorCommand({
      document,
      sheetId,
      element: refs.relationship,
      color: { kind: 'literal', value: '#AABBCC' },
    });
    expect(colorCommand.type).toBe(MIND_MAP_COMMAND_TYPES.updateStyleBindings);
    const colored = executeMindMapCommand(document, colorCommand).document;
    expect(colored.sheets[sheetId].relationships[relationship.id]
      .style?.overrides?.connector?.color).toEqual({
        kind: 'literal',
        value: '#AABBCC',
      });

    const widthCommand = planUpdateRelationshipLineWidthCommand({
      document: colored,
      sheetId,
      element: refs.relationship,
      width: 4.5,
    });
    const widened = executeMindMapCommand(colored, widthCommand).document;
    expect(widened.sheets[sheetId].relationships[relationship.id]
      .style?.overrides?.connector).toMatchObject({
        color: { kind: 'literal', value: '#AABBCC' },
        width: 4.5,
      });

    const resetColor = planUpdateRelationshipLineColorCommand({
      document: widened,
      sheetId,
      element: refs.relationship,
      color: null,
    });
    const reset = executeMindMapCommand(widened, resetColor).document;
    expect(reset.sheets[sheetId].relationships[relationship.id]
      .style?.overrides?.connector).toEqual({ width: 4.5 });
  });

  it('rejects no-ops, wrong element kinds, malformed rich text, and illegal enum values', () => {
    const { document, sheetId, refs, relationship } = setup();
    const malformed = {
      type: 'doc',
      version: 1,
      blocks: [],
      unsafeHtml: '<img src=x onerror=alert(1)>',
    } as unknown as RichText;

    expect(() => planUpdateSemanticContentCommand({
      document,
      sheetId,
      element: refs.relationship,
      content: relationship.title!,
    })).toThrow(/does not change/);
    expect(() => planUpdateSemanticContentCommand({
      document,
      sheetId,
      element: refs.relationship,
      content: malformed,
    })).toThrow(/invalid/);
    expect(() => planUpdateRelationshipRoutingCommand({
      document,
      sheetId,
      element: refs.boundary,
      routing: 'curve',
    })).toThrow(/Relationship/);
    expect(() => planUpdateRelationshipRoutingCommand({
      document,
      sheetId,
      element: refs.relationship,
      routing: 'javascript:' as never,
    })).toThrow(/not supported/);
    expect(() => planUpdateRelationshipArrowCommand({
      document,
      sheetId,
      element: refs.relationship,
      endpoint: 'end',
      arrow: '<script>' as ArrowHead,
    })).toThrow(/not supported/);
    expect(() => planUpdateRelationshipLineStyleCommand({
      document,
      sheetId,
      element: refs.relationship,
      lineStyle: 'custom' as never,
    })).toThrow(/not supported/);
    expect(() => planUpdateRelationshipLineColorCommand({
      document,
      sheetId,
      element: refs.relationship,
      color: { kind: 'literal', value: 'javascript:alert(1)' },
    })).toThrow(/#RRGGBB/);
    expect(() => planUpdateRelationshipLineWidthCommand({
      document,
      sheetId,
      element: refs.relationship,
      width: Number.POSITIVE_INFINITY,
    })).toThrow(/finite number/);
  });

  it('returns null for stale IDs and planners reject them deterministically', () => {
    const { document, sheetId } = setup();
    const staleRefs: ElementRef[] = [
      { kind: 'relationship', id: 'missing' as RelationshipId },
      { kind: 'boundary', id: 'missing' as BoundaryId },
      { kind: 'summary', id: 'missing' as SummaryId },
      { kind: 'callout', id: 'missing' as CalloutId },
      { kind: 'zone', id: 'missing' as ZoneId },
    ];
    for (const element of staleRefs) {
      expect(buildSemanticPropertiesModel(document, sheetId, element)).toBeNull();
      expect(() => planUpdateSemanticContentCommand({
        document,
        sheetId,
        element: element as never,
        content: createRichText('No target'),
      })).toThrow(/does not exist/);
    }
  });
});
