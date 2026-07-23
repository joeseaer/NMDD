import { parseMindMapDocument, type MindMapParseResult } from './parser';
import type { MindMapDocumentV1 } from './types';
import {
  validateMindMapDocument,
  type ValidationIssue,
} from './validation';

export class InvalidMindMapDocumentError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('Mind map document failed schema or invariant validation and was not serialized.');
    this.name = 'InvalidMindMapDocumentError';
    this.issues = issues;
  }
}

const normalizeForStableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    normalized[key] = normalizeForStableJson(record[key]);
  }
  return normalized;
};

export const serializeMindMapDocument = (
  document: MindMapDocumentV1,
): string => {
  const validation = validateMindMapDocument(document);
  if (!validation.valid) throw new InvalidMindMapDocumentError(validation.issues);
  return JSON.stringify(normalizeForStableJson(document));
};

export const parseMindMapAttribute = (raw: unknown): MindMapParseResult =>
  parseMindMapDocument(raw);

