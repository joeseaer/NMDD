import type { DocumentFragmentJson, DocumentNodeJson } from '../schema/documentSchema';

export type SerializableDocumentInput =
  | DocumentFragmentJson
  | { toJSON(): DocumentNodeJson };

export const normalizeSerializableInput = (input: SerializableDocumentInput): DocumentFragmentJson => {
  if (!Array.isArray(input) && typeof (input as { toJSON?: unknown }).toJSON === 'function') {
    return (input as { toJSON(): DocumentNodeJson }).toJSON();
  }
  return input as DocumentFragmentJson;
};

export const nodeChildren = (node: DocumentNodeJson): DocumentNodeJson[] => (
  Array.isArray(node.content) ? node.content : []
);

export const getNodeText = (node: DocumentNodeJson): string => {
  if (typeof node.text === 'string') return node.text;
  return nodeChildren(node).map(getNodeText).join('');
};

export const cleanJoinedBlocks = (value: string): string => (
  value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
);

const ENCODED_FORMULA_TOKEN = /%(?:25)*(?:5c|7b|7d|24|5e|5f|2b|3d|2f|28|29|5b|5d)/i;

/**
 * Decode only formulas that look like an old URI-encoded attribute payload.
 * Canonical LaTeX is raw text; blindly decoding `%20` or `%25` changes valid
 * formulas and URLs every time a document is opened and saved.
 */
export const decodeLegacyEncodedFormula = (value: unknown): string => {
  let formula = String(value ?? '').trim();
  if (!formula || formula.includes('\\') || !ENCODED_FORMULA_TOKEN.test(formula)) return formula;

  for (let attempt = 0; attempt < 2 && ENCODED_FORMULA_TOKEN.test(formula); attempt += 1) {
    try {
      const decoded = decodeURIComponent(formula);
      if (decoded === formula) break;
      formula = decoded;
    } catch {
      break;
    }
  }
  return formula.trim();
};

export const normalizeSerializedFormula = decodeLegacyEncodedFormula;

export const stringifyCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '✓' : '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyCellValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.name || record.title || record.label || record.url || '');
  }
  return String(value);
};
