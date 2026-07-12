import { describe, expect, it } from 'vitest';
import { cloneFragmentForPaste, stripFragmentRuntimeAttributes } from '../cloneFragment';
import type { DocumentNodeJson } from '../documentSchema';

const createId = (kind: string, previousId: string) => `${kind}:copy:${previousId}`;

const DATABASE_FRAGMENT: DocumentNodeJson = {
  type: 'doc',
  content: [
    {
      type: 'syncedBlock',
      attrs: {
        blockId: 'block-1',
        syncId: 'sync-1',
        blockComments: [{ id: 'comment-1' }],
      },
      content: [{ type: 'paragraph', attrs: { blockId: 'block-2' }, content: [{ type: 'text', text: 'Synced' }] }],
    },
    {
      type: 'databaseBlock',
      attrs: {
        blockId: 'block-db',
        database: {
          id: 'db-1',
          properties: [
            { id: 'prop-title', name: 'Name', type: 'title' },
            { id: 'prop-rel', name: 'Relation', type: 'relation' },
            { id: 'prop-files', name: 'Files', type: 'files' },
            { id: 'prop-rollup', name: 'Rollup', type: 'rollup', relationPropertyId: 'prop-rel', rollupTargetPropertyId: 'prop-title' },
          ],
          rows: [
            { id: 'row-1', cells: { 'prop-title': 'A', 'prop-rel': ['row-2'], 'prop-files': [{ id: 'file-1', name: 'a.pdf' }] }, page: { content: '' } },
            { id: 'row-2', cells: { 'prop-title': 'B', 'prop-rel': ['row-1'], 'prop-files': [] }, page: { content: '' } },
          ],
          views: [{ id: 'view-1', filters: [{ id: 'filter-1', propertyId: 'prop-title', value: 'A' }], groupBy: 'prop-title', sort: { propertyId: 'prop-title', direction: 'asc' } }],
          activeViewId: 'view-1',
          filters: [{ id: 'filter-1', propertyId: 'prop-title', value: 'A' }],
          groupBy: 'prop-title',
          sort: { propertyId: 'prop-title', direction: 'asc' },
        },
      },
    },
  ],
};

describe('cloneFragmentForPaste', () => {
  it('reassigns runtime and database IDs as coherent groups', () => {
    const result = cloneFragmentForPaste(DATABASE_FRAGMENT, { createId });
    const synced = result.fragment.content?.[0];
    expect(synced?.attrs).toMatchObject({
      blockId: 'block:copy:block-1',
      syncId: 'sync:copy:sync-1',
    });
    expect(synced?.attrs).not.toHaveProperty('blockComments');

    const database = result.fragment.content?.[1].attrs?.database as Record<string, any>;
    expect(database.id).toBe('database:copy:db-1');
    expect(database.properties[3]).toMatchObject({
      relationPropertyId: 'property:copy:prop-rel',
      rollupTargetPropertyId: 'property:copy:prop-title',
    });
    expect(database.rows[0].cells['property:copy:prop-rel']).toEqual(['row:copy:row-2']);
    expect(database.rows[0].cells['property:copy:prop-files'][0].id).toBe('file:copy:file-1');
    expect(database.activeViewId).toBe('view:copy:view-1');
    expect(database.views[0].filters[0]).toMatchObject({
      id: 'filter:copy:filter-1',
      propertyId: 'property:copy:prop-title',
    });
  });

  it('can strip copy-only runtime attrs without touching content IDs', () => {
    const stripped = stripFragmentRuntimeAttributes(DATABASE_FRAGMENT);
    expect(stripped.content?.[0].attrs).not.toHaveProperty('blockId');
    expect(stripped.content?.[0].attrs).not.toHaveProperty('syncId');
    expect((stripped.content?.[1].attrs?.database as Record<string, unknown>).id).toBe('db-1');
  });
});
