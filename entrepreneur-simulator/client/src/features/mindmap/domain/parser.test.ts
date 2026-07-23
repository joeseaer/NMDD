import { describe, expect, it } from 'vitest';
import { createNewMindMapDocument } from './defaults';
import { parseMindMapDocument } from './parser';
import type { Id } from './types';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;

const createDocument = () => createNewMindMapDocument({
  documentId: asId<'Document'>('018f0000-0000-7000-8000-000000000001'),
  sheetId: asId<'Sheet'>('018f0000-0000-7000-8000-000000000002'),
  rootTopicId: asId<'Topic'>('018f0000-0000-7000-8000-000000000003'),
  themeId: asId<'Theme'>('018f0000-0000-7000-8000-000000000004'),
  sheetOrderKey: 'a0',
  title: 'Parser fixture',
  sheetTitle: 'Sheet 1',
  rootTitle: 'Central topic',
});

describe('parseMindMapDocument', () => {
  it('accepts a valid canonical V1 document', () => {
    const document = createDocument();
    const result = parseMindMapDocument(document);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected canonical parse success');
    expect(result.sourceFormat).toBe('canonical-v1');
    expect(result.document).toEqual(document);
    expect(result.document).not.toBe(document);
  });

  it('migrates legacy nodes + edges deterministically before validation', () => {
    const legacy = {
      nodes: [
        { id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: '中心主题' } },
        { id: 'child', type: 'mindMap', position: { x: 240, y: 0 }, data: { label: '子主题', bold: true } },
      ],
      edges: [{ id: 'edge', source: 'root', target: 'child', type: 'smoothstep' }],
    };

    const first = parseMindMapDocument(legacy);
    const second = parseMindMapDocument(JSON.stringify(legacy));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected migration success');
    expect(first.sourceFormat).toBe('legacy-v0');
    expect(first.document).toEqual(second.document);
    expect(first.migrationReport?.sourceHash).toBe(second.migrationReport?.sourceHash);
  });

  it('rejects future reader versions read-only and preserves the source', () => {
    const future = { ...createDocument(), minimumReaderVersion: 2 };
    const source = JSON.stringify(future);
    const result = parseMindMapDocument(source);

    expect(result).toMatchObject({
      ok: false,
      readOnly: true,
      reason: 'unsupported-version',
      sourceFormat: 'canonical-future',
      preservedPayload: source,
    });
  });

  it('does not overwrite unknown or schema-invalid payloads', () => {
    const unknownSource = '{"hello":"world"}';
    const unknown = parseMindMapDocument(unknownSource);
    expect(unknown).toMatchObject({
      ok: false,
      readOnly: true,
      reason: 'unknown-format',
      preservedPayload: unknownSource,
    });

    const invalid = { ...createDocument(), selected: true };
    const invalidResult = parseMindMapDocument(invalid);
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult).toMatchObject({ reason: 'validation-failed', readOnly: true });
    expect(invalidResult.issues.some((issue) => issue.code === 'schema.additionalProperties'))
      .toBe(true);
  });
});
