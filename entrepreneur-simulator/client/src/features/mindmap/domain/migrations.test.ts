import { describe, expect, it } from 'vitest';
import {
  getMindMapMigration,
  LEGACY_V0_TO_SCHEMA_V1,
  MIND_MAP_MIGRATIONS,
} from './migrations';
import { parseMindMapDocument } from './parser';

const legacyFixture = {
  nodes: [
    { id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: 'Root' } },
    { id: 'child', type: 'mindMap', position: { x: 200, y: 0 }, data: { label: 'Child' } },
  ],
  edges: [{ id: 'tree', source: 'root', target: 'child' }],
};

describe('mind map migration registry', () => {
  it('registers the legacy migration in one frozen location', () => {
    expect(Object.isFrozen(MIND_MAP_MIGRATIONS)).toBe(true);
    expect(getMindMapMigration(LEGACY_V0_TO_SCHEMA_V1)).toMatchObject({
      id: 'legacy-0.x->schema-1',
      from: 'legacy-v0',
      toSchemaVersion: 1,
    });
  });

  it('is normalized-idempotent when the migrated document is parsed again', () => {
    const first = getMindMapMigration(LEGACY_V0_TO_SCHEMA_V1).migrate(legacyFixture);
    expect(first.document).not.toBeNull();
    const second = parseMindMapDocument(first.document);
    expect(second.ok).toBe(true);
    if (!first.document || !second.ok) throw new Error('Expected migration success');
    expect(second.document).toEqual(first.document);
  });
});

