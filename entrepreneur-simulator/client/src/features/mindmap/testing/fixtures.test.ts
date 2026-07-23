import { describe, expect, it } from 'vitest';

import { validateMindMapDocument } from '../domain/validation';
import {
  CORRUPTED_LEGACY_FIXTURE_FACTORIES,
  MIND_MAP_FIXTURE_NAMES,
  MIND_MAP_FIXTURE_REGISTRY,
  createLegacyCycleFixture,
  createLegacyMultipleParentsFixture,
  createMindMapFixture,
  createMindMapFixtureTiptapDocument,
  isMindMapFixtureName,
} from './fixtures';

describe('mind-map fixture registry', () => {
  it('exposes the frozen Phase 0 fixture names', () => {
    expect(MIND_MAP_FIXTURE_NAMES).toEqual([
      'mindmap-v0',
      'mindmap-v1-small',
      'mindmap-v1-large',
      'mindmap-elements',
      'mindmap-mixed-structures',
    ]);
    expect(Object.keys(MIND_MAP_FIXTURE_REGISTRY)).toEqual(MIND_MAP_FIXTURE_NAMES);
    expect(Object.isFrozen(MIND_MAP_FIXTURE_REGISTRY)).toBe(true);
    expect(isMindMapFixtureName('mindmap-elements')).toBe(true);
    expect(isMindMapFixtureName('unknown')).toBe(false);
  });

  it('creates fresh, byte-deterministic payloads', () => {
    for (const name of MIND_MAP_FIXTURE_NAMES) {
      const first = createMindMapFixture(name);
      const second = createMindMapFixture(name);
      expect(second).not.toBe(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('keeps every canonical fixture Schema and invariant valid', () => {
    for (const name of MIND_MAP_FIXTURE_NAMES) {
      const fixture = createMindMapFixture(name);
      if (fixture.kind !== 'canonical-v1') continue;
      const result = validateMindMapDocument(fixture.document);
      expect(result.issues, name).toEqual([]);
      expect(result.valid, name).toBe(true);
    }
  });

  it('builds the large fixture with exactly 1000 deterministic topics', () => {
    const fixture = createMindMapFixture('mindmap-v1-large');
    expect(fixture.kind).toBe('canonical-v1');
    if (fixture.kind !== 'canonical-v1') return;
    const sheet = Object.values(fixture.document.sheets)[0];
    expect(Object.keys(sheet.topics)).toHaveLength(1000);
    expect(Object.keys(sheet.treeEdges)).toHaveLength(999);
  });

  it('keeps the v0 fixture in renderer-owned nodes + edges shape', () => {
    const fixture = createMindMapFixture('mindmap-v0');
    expect(fixture.kind).toBe('legacy-v0');
    if (fixture.kind !== 'legacy-v0') return;
    expect(Array.isArray(fixture.graph.nodes)).toBe(true);
    expect(Array.isArray(fixture.graph.edges)).toBe(true);
    expect(fixture.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'root', type: 'mindMap' }),
        expect.objectContaining({ id: 'boundary-1', type: 'boundary' }),
        expect.objectContaining({ id: 'summary-1', type: 'summary' }),
      ]),
    );
  });

  it('exports reproducible multiple-parent and cycle corruption corpora', () => {
    const multipleParents = createLegacyMultipleParentsFixture();
    const childParents = multipleParents.edges.filter(
      (edge) =>
        typeof edge === 'object' &&
        edge !== null &&
        'target' in edge &&
        edge.target === 'child',
    );
    expect(childParents).toHaveLength(2);

    const cycle = createLegacyCycleFixture();
    expect(cycle.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'x', target: 'y' }),
        expect.objectContaining({ source: 'y', target: 'x' }),
      ]),
    );
    expect(CORRUPTED_LEGACY_FIXTURE_FACTORIES.multipleParents()).toEqual(multipleParents);
    expect(CORRUPTED_LEGACY_FIXTURE_FACTORIES.cycle()).toEqual(cycle);
  });

  it('converts fixtures to an explanation plus one mindMap block', () => {
    const document = createMindMapFixtureTiptapDocument('mindmap-v1-small');
    expect(document.type).toBe('doc');
    expect(document.content).toHaveLength(2);
    expect(document.content?.[0]).toMatchObject({ type: 'paragraph' });
    expect(document.content?.[1]).toMatchObject({
      attrs: { data: expect.objectContaining({ schema: 'app.nmdd.mindmap' }) },
      type: 'mindMap',
    });
  });
});
