import { describe, expect, it } from 'vitest';
import { createNewMindMapDocument } from './defaults';
import {
  InvalidMindMapDocumentError,
  parseMindMapAttribute,
  serializeMindMapDocument,
} from './persistence';
import type { Id } from './types';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;

const documentFixture = () => createNewMindMapDocument({
  documentId: asId<'Document'>('018f0000-0000-7000-8000-000000000001'),
  sheetId: asId<'Sheet'>('018f0000-0000-7000-8000-000000000002'),
  rootTopicId: asId<'Topic'>('018f0000-0000-7000-8000-000000000003'),
  themeId: asId<'Theme'>('018f0000-0000-7000-8000-000000000004'),
  sheetOrderKey: 'a0',
  title: 'Persistence fixture',
});

describe('mind map persistence boundary', () => {
  it('validates and round-trips canonical attributes', () => {
    const source = documentFixture();
    const serialized = serializeMindMapDocument(source);
    const parsed = parseMindMapAttribute(serialized);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected parse success');
    expect(parsed.document).toEqual(source);
  });

  it('emits byte-stable JSON independent of record insertion order', () => {
    const first = documentFixture();
    const second = documentFixture();
    second.actors = Object.fromEntries(Object.entries(second.actors).reverse()) as typeof second.actors;
    second.sheets = Object.fromEntries(Object.entries(second.sheets).reverse()) as typeof second.sheets;

    expect(serializeMindMapDocument(first)).toBe(serializeMindMapDocument(second));
  });

  it('refuses to write schema-invalid or invariant-invalid content', () => {
    const invalid = documentFixture() as ReturnType<typeof documentFixture> & { selected?: boolean };
    invalid.selected = true;

    expect(() => serializeMindMapDocument(invalid)).toThrow(InvalidMindMapDocumentError);
  });
});
