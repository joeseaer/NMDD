import { describe, expect, it } from 'vitest';

import {
  detectMindMapPayload,
  migrateLegacyV0ToCanonical,
  projectCanonicalToLegacyCanvas,
} from './legacy';
import type { LegacyMindMapEdge, LegacyMindMapNode } from './legacy';
import type { BoundaryId, SummaryId, TopicId } from './types';
import { validateMindMapDocument } from './validation';
import {
  LEGACY_V0_DAMAGED_FIXTURE,
  LEGACY_V0_NO_TOPIC_FIXTURE,
  LEGACY_V0_RICH_FIXTURE,
} from './__fixtures__/legacy';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const firstSheet = (
  document: NonNullable<ReturnType<typeof migrateLegacyV0ToCanonical>['document']>,
) => {
  const sheet = Object.values(document.sheets)[0];
  if (!sheet) throw new Error('Expected migrated Sheet');
  return sheet;
};

describe('legacy payload detection', () => {
  const json = JSON.stringify(LEGACY_V0_RICH_FIXTURE);

  it.each([
    ['object', LEGACY_V0_RICH_FIXTURE],
    ['json', json],
    ['uri', encodeURIComponent(json)],
    ['html-entity', json.replace(/"/g, '&quot;')],
  ] as const)('detects the %s persistence representation', (decodedFrom, input) => {
    const detection = detectMindMapPayload(input);

    expect(detection.kind).toBe('legacy-v0');
    expect(detection.decodedFrom).toBe(decodedFrom);
    expect(detection.value).toEqual(LEGACY_V0_RICH_FIXTURE);
  });

  it('rejects payloads outside configured limits before migration', () => {
    const detection = detectMindMapPayload(LEGACY_V0_RICH_FIXTURE, { maxNodes: 1 });

    expect(detection.kind).toBe('unknown');
    expect(detection.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'node-limit-exceeded', severity: 'error' }),
    );
  });
});

describe('legacy v0 migration', () => {
  it('is deterministic, immutable, and emits valid UUIDv7 canonical data', () => {
    const sourceBefore = JSON.stringify(LEGACY_V0_RICH_FIXTURE);
    const first = migrateLegacyV0ToCanonical(LEGACY_V0_RICH_FIXTURE);
    const second = migrateLegacyV0ToCanonical(LEGACY_V0_RICH_FIXTURE);

    expect(first.document).not.toBeNull();
    expect(second).toEqual(first);
    expect(JSON.stringify(first.document)).toBe(JSON.stringify(second.document));
    expect(JSON.stringify(LEGACY_V0_RICH_FIXTURE)).toBe(sourceBefore);
    expect(first.report.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(first.legacyBackup)).toBe(true);
    expect(Object.isFrozen((first.legacyBackup as { nodes: unknown[] }).nodes)).toBe(true);

    const document = first.document!;
    const sheet = firstSheet(document);
    const ids = [
      document.id,
      sheet.id,
      ...Object.keys(sheet.topics),
      ...Object.keys(sheet.treeEdges),
      ...Object.keys(sheet.relationships),
      ...Object.keys(sheet.boundaries),
      ...Object.keys(sheet.summaries),
    ];
    expect(ids.every((id) => UUID_V7.test(id))).toBe(true);
    expect(validateMindMapDocument(document)).toMatchObject({
      invariantValid: true,
      schemaValid: true,
      valid: true,
    });
  });

  it('preserves label, bold, positions, scopes, and separates links from tree edges', () => {
    const result = migrateLegacyV0ToCanonical(LEGACY_V0_RICH_FIXTURE);
    const document = result.document!;
    const sheet = firstSheet(document);
    const branchAId = result.report.idMap['$.nodes[1]'] as TopicId;
    const boundaryId = result.report.idMap['$.nodes[4]'] as BoundaryId;
    const summaryId = result.report.idMap['$.nodes[5]'] as SummaryId;
    const branchA = sheet.topics[branchAId];
    const boundary = sheet.boundaries[boundaryId];
    const summary = sheet.summaries[summaryId];
    const relationship = Object.values(sheet.relationships)[0];

    expect(result.report.stats).toMatchObject({
      topics: 5,
      treeEdges: 3,
      relationships: 1,
      boundaries: 1,
      summaries: 1,
    });
    expect(branchA.title.blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Branch A' }],
    });
    expect(branchA.placement).toEqual({ mode: 'absolute', x: 340, y: 40 });
    expect(branchA.style?.overrides?.typography?.fontWeight).toBe(700);
    expect(branchA.extensions?.['app.nmdd.legacy-v0']).toMatchObject({
      data: { customFlag: 'preserve-me' },
      node: { customNodeField: { source: 'legacy' } },
    });
    expect(result.report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['runtime-field-dropped', 'unknown-field-preserved']),
    );

    expect(boundary.scope).toEqual({
      kind: 'subtree',
      rootTopicId: branchAId,
      depth: 'all',
    });
    expect(summary.scope.kind).toBe('sibling-range');
    expect(sheet.topics[summary.resultTopicId]).toMatchObject({
      role: 'summary-result',
      placement: { mode: 'offset' },
    });
    expect(sheet.topics[summary.resultTopicId].title.blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Summary A+B' }],
    });

    expect(relationship).toMatchObject({
      routing: 'orthogonal',
      startArrow: 'none',
      endArrow: 'triangle',
      style: {
        overrides: {
          connector: {
            color: { kind: 'literal', value: '#DC2626' },
            width: 3,
            dash: [5, 3],
          },
        },
      },
    });
    expect(relationship.extensions?.['app.nmdd.legacy-v0']).toMatchObject({
      data: { kind: 'link', label: 'cross reference' },
      edge: { customEdgeField: 'preserve-me-too' },
    });
  });

  it('projects canonical data back to the current canvas without becoming persistence truth', () => {
    const result = migrateLegacyV0ToCanonical(LEGACY_V0_RICH_FIXTURE);
    const projected = projectCanonicalToLegacyCanvas(result.document!);
    const nodes = projected.nodes as LegacyMindMapNode[];
    const edges = projected.edges as LegacyMindMapEdge[];
    const branchA = nodes.find((node) => node.id === 'branch-a');
    const boundary = nodes.find((node) => node.id === 'boundary-a');
    const summary = nodes.find((node) => node.id === 'summary-ab');
    const link = edges.find((edge) => edge.id === 'link-a1-b');

    expect(branchA).toMatchObject({
      type: 'mindMap',
      position: { x: 340, y: 40 },
      data: { label: 'Branch A', bold: true },
    });
    expect(boundary).toMatchObject({
      position: { x: 316, y: 16 },
      data: {
        memberIds: ['branch-a', 'leaf-a1'],
        padding: 24,
        w: 440,
        h: 120,
      },
    });
    expect(summary).toMatchObject({
      position: { x: 760, y: 78 },
      data: {
        memberIds: ['branch-a', 'branch-b'],
        padding: 16,
        h: 190,
        label: 'Summary A+B',
      },
    });
    expect(link).toMatchObject({
      source: 'leaf-a1',
      target: 'branch-b',
      data: { kind: 'link', label: 'cross reference' },
      style: { stroke: '#dc2626', strokeWidth: 3, strokeDasharray: '5 3' },
      markerEnd: 'ArrowClosed',
    });
  });

  it('repairs or quarantines damaged data with explicit diagnostics and no dangling output', () => {
    const result = migrateLegacyV0ToCanonical(LEGACY_V0_DAMAGED_FIXTURE);
    const document = result.document!;
    const sheet = firstSheet(document);
    const codes = result.report.diagnostics.map((item) => item.code);

    expect(result.report.status).toBe('degraded');
    expect(codes).toEqual(expect.arrayContaining([
      'preview-edge-dropped',
      'duplicate-node-id',
      'dangling-member-ref',
      'invalid-member-ref',
      'summary-includes-central',
      'unknown-node-type',
      'invalid-node',
      'demoted-relationship',
      'dangling-ref',
      'illegal-relationship-pair',
    ]));
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'demoted-relationship',
      message: expect.stringContaining('multiple-parent'),
    }));
    expect(result.report.legacyIdMap.a).toHaveLength(2);
    expect(result.report.quarantined).toContainEqual(expect.objectContaining({
      kind: 'edge',
      reason: 'dangling-ref',
      original: expect.objectContaining({ id: 'dangling' }),
    }));
    expect(result.legacyBackup).toEqual(LEGACY_V0_DAMAGED_FIXTURE);

    const children = Object.values(sheet.treeEdges).map((edge) => edge.childTopicId);
    expect(new Set(children).size).toBe(children.length);
    expect(Object.values(sheet.relationships)).toHaveLength(3);
    expect(validateMindMapDocument(document)).toMatchObject({
      invariantValid: true,
      schemaValid: true,
      valid: true,
    });
  });

  it('fails closed and retains rollback data when no Topic can be migrated', () => {
    const result = migrateLegacyV0ToCanonical(LEGACY_V0_NO_TOPIC_FIXTURE);

    expect(result.document).toBeNull();
    expect(result.report.status).toBe('failed');
    expect(result.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-topic-root', severity: 'error' }),
    );
    expect(result.report.quarantined).toContainEqual(
      expect.objectContaining({ kind: 'payload', reason: 'missing-topic-root' }),
    );
    expect(result.legacyBackup).toEqual(LEGACY_V0_NO_TOPIC_FIXTURE);
  });
});
