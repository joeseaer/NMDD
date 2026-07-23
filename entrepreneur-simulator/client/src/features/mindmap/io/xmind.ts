import { createRichText } from '../domain/defaults';
import { createUuidV7 } from '../domain/ids';
import { rebalanceOrderKeys } from '../domain/orderKey';
import {
  expandSemanticTopicScope,
  normalizeExactSemanticScopeMembers,
  semanticSiblingEdges,
} from '../domain/semanticScope';
import type {
  Asset,
  AssetId,
  Boundary,
  BoundaryId,
  BranchLayoutSpec,
  ControlPointId,
  Id,
  ImageId,
  LinkId,
  MarkerDefinition,
  MarkerDefinitionId,
  MarkerGroup,
  MarkerGroupId,
  MarkerInstanceId,
  MindMapDocumentV1,
  MindMapSheet,
  Note,
  NoteId,
  OrderKey,
  Relationship,
  RelationshipControlPoint,
  RelationshipId,
  RichInline,
  RichList,
  RichMark,
  RichText,
  Summary,
  SummaryId,
  Topic,
  TopicImage,
  TopicId,
  TopicLink,
  TopicScope,
  TodoId,
  TreeEdge,
} from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import {
  compareMindMapViewOrderedEntities,
  getMindMapSheetsInViewOrder,
} from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';
import { buildCanonicalDocumentFromOutline } from './canonicalImport';
import { resolveMindMapImportLimits } from './limits';
import { MindMapImportReportBuilder } from './report';
import type {
  MindMapImportDiagnostic,
  MindMapImportEntityKind,
  MindMapImportOptions,
  MindMapImportResult,
  NormalizedOutlineDocument,
  NormalizedOutlineNode,
  NormalizedOutlineSheet,
} from './types';
import {
  createDeterministicXMindZip,
  inspectAndExtractXMindZip,
  resolveXMindZipSecurityLimits,
  XMindZipSecurityError,
  type XMindZipEntryDescriptor,
  type XMindZipSecurityLimitOverrides,
} from './xmindZip';
import {
  hasSignedRemoteCredential,
  inspectXMindRaster,
  isSafeXMindPackagePath,
  redactSensitiveRemoteUrl,
  safeXMindResourceFileName,
  XMIND_IMAGE_RESOURCE_MAX_BYTES,
  XMIND_IMAGE_RESOURCE_MAX_COUNT,
  xmindImageSourceToPackagePath,
  xmindPackagePathToImageSource,
} from './xmindImages';

export const XMIND_SOURCE_ID_EXTENSION_KEY = 'io.xmind.source-id' as const;
export const XMIND_RAW_TOPIC_EXTENSION_KEY = 'io.xmind.raw-topic' as const;
export const XMIND_RAW_SHEET_EXTENSION_KEY = 'io.xmind.raw-sheet' as const;
export const XMIND_RAW_SEMANTIC_EXTENSION_KEY = 'io.xmind.raw-semantic' as const;
export const XMIND_RESOURCE_MANIFEST_EXTENSION_KEY = 'io.xmind.resource-manifest' as const;
export const XMIND_METADATA_EXTENSION_KEY = 'io.xmind.metadata' as const;
export const XMIND_RAW_TITLE_EXTENSION_KEY = 'io.xmind.raw-title' as const;
export const XMIND_RAW_RELATIONSHIPS_EXTENSION_KEY = 'io.xmind.raw-relationships' as const;

const NMDD_RICH_TEXT_PROVIDER = 'app.nmdd.rich-text';
const NMDD_BRANCH_SIDE_PROVIDER = 'app.nmdd.branch-side';
const NMDD_MARKER_LIBRARY_KEY_EXTENSION = 'app.nmdd.marker-library-key';
const XMIND_NATIVE_STANDARD_MARKER_GROUP_IDS = new Set([
  'priority',
  'progress',
  'flag',
  'star',
  'arrow',
]);
const XMIND_FORMAT = 'xmind-content-json' as const;
const SELECTED_ZIP_PATHS = new Set(['content.json', 'manifest.json', 'metadata.json']);
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const XMIND_VOLATILE_FINGERPRINT_KEYS = new Set([
  'createdAt',
  'lastModified',
  'modified-by',
  'modifiedBy',
  'revision',
  'timestamp',
  'updatedAt',
]);
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

type JsonRecord = Record<string, unknown>;
type ChildKind = 'attached' | 'detached' | 'summary' | string;

export interface XMindImportOptions extends MindMapImportOptions {
  readonly zipLimits?: XMindZipSecurityLimitOverrides;
}

export interface XMindExportReport {
  readonly degradedItems: number;
  readonly diagnostics: readonly MindMapImportDiagnostic[];
  readonly exportedSheets: number;
  readonly exportedTopics: number;
  readonly format: typeof XMIND_FORMAT;
  readonly preservedAttributes: number;
  readonly success: boolean;
}

export interface XMindExportResult {
  readonly bytes: Uint8Array | null;
  readonly report: XMindExportReport;
}

export interface XMindImportResult extends MindMapImportResult {
  /** Validated package resources kept outside canonical JSON for later persistence/export. */
  readonly resourceBytes?: Readonly<Record<string, Uint8Array>>;
}

export interface XMindExportOptions {
  /**
   * Caller-owned bytes keyed by Asset ID or by an embedded Asset.relativePath.
   * The pure codec never fetches remote URLs or resolves managed object keys.
   */
  readonly resourceBytes?: Readonly<Record<string, ArrayBuffer | Uint8Array>>;
}

interface NativeImageResource {
  readonly packagePath: string;
  readonly rawImage: JsonRecord;
}

interface ParsedTopicRecord {
  readonly childIndex: number;
  readonly childKind: ChildKind;
  readonly node: NormalizedOutlineNode;
  readonly parentSourceId?: string;
  readonly path: string;
  readonly raw: JsonRecord;
  readonly sourceId: string;
}

interface ParsedSheetRecord {
  readonly normalized: NormalizedOutlineSheet;
  readonly path: string;
  readonly raw: JsonRecord;
  readonly sourceId: string;
  readonly topics: ParsedTopicRecord[];
}

interface ParsedXMindContent {
  readonly outline: NormalizedOutlineDocument;
  readonly sheets: ParsedSheetRecord[];
}

interface MutableExportReport {
  degradedItems: number;
  diagnostics: MindMapImportDiagnostic[];
  exportedSheets: number;
  exportedTopics: number;
  preservedAttributes: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function copyJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 64) return '[xmind value exceeded preservation depth]';
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => copyJsonValue(item, depth + 1));
  if (!isRecord(value)) return String(value);
  const result: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
    result[key] = copyJsonValue(value[key], depth + 1);
  }
  return result;
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(value: string | Uint8Array): string {
  const source = typeof value === 'string'
    ? Uint8Array.from(new TextEncoder().encode(value))
    : Uint8Array.from(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 = rightRotate(before15, 7) ^ rightRotate(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rightRotate(before2, 17) ^ rightRotate(before2, 19) ^ (before2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function stableJsonHash(value: unknown): string {
  return sha256Hex(JSON.stringify(copyJsonValue(value)));
}

function xmindFingerprintValue(value: unknown, depth = 0): unknown {
  if (depth > 96) return '[xmind fingerprint depth exceeded]';
  if (Array.isArray(value)) {
    return value.map((item) => xmindFingerprintValue(item, depth + 1));
  }
  if (!isRecord(value)) return copyJsonValue(value, depth);
  const result: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_OBJECT_KEYS.has(key) || XMIND_VOLATILE_FINGERPRINT_KEYS.has(key)) continue;
    result[key] = xmindFingerprintValue(value[key], depth + 1);
  }
  return result;
}

function xmindContentIdentityHash(value: unknown): string {
  return sha256Hex(JSON.stringify(xmindFingerprintValue(value)));
}

function rawWithout(record: JsonRecord, omitted: ReadonlySet<string>): JsonRecord | undefined {
  const result: JsonRecord = {};
  for (const key of Object.keys(record).sort()) {
    if (omitted.has(key) || DANGEROUS_OBJECT_KEYS.has(key)) continue;
    result[key] = copyJsonValue(record[key]);
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function utf8Decode(bytes: Uint8Array): string {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  } catch {
    throw new Error('content.json is not valid UTF-8.');
  }
}

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

function inspectJsonComplexity(
  value: unknown,
  maximumDepth: number,
  maximumValues: number,
): 'depth' | 'values' | null {
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  let values = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    values += 1;
    if (values > maximumValues) return 'values';
    if (current.depth > maximumDepth) return 'depth';
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ depth: current.depth + 1, value: item });
    } else if (isRecord(current.value)) {
      for (const item of Object.values(current.value)) {
        stack.push({ depth: current.depth + 1, value: item });
      }
    }
  }
  return null;
}

function flattenRichValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenRichValue).join('');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (isRecord(value.plain) && typeof value.plain.content === 'string') {
    return value.plain.content;
  }
  if (typeof value.content === 'string') return value.content;
  for (const key of ['spans', 'children', 'paragraphs', 'items', 'blocks']) {
    if (Array.isArray(value[key])) return flattenRichValue(value[key]);
  }
  return '';
}

function titleFromXMind(
  value: unknown,
  path: string,
  report: MindMapImportReportBuilder,
): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) {
    report.add({
      code: 'xmind.topic-title-missing',
      disposition: 'degraded',
      message: 'A topic without a title was imported as an empty plain-text title.',
      path,
      severity: 'warning',
    });
    return '';
  }
  const flattened = flattenRichValue(value);
  report.add({
    code: 'xmind.rich-title-plain-fallback',
    disposition: 'degraded',
    message: 'A non-string XMind title was flattened to safe plain text; its source value remains in extensions.',
    path,
    severity: 'warning',
  });
  return flattened;
}

function providerContent(extensions: unknown, provider: string): unknown {
  if (!Array.isArray(extensions)) return undefined;
  for (const extension of extensions) {
    if (isRecord(extension) && extension.provider === provider) return extension.content;
  }
  return undefined;
}

function isRichMark(value: unknown): value is RichMark {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (['bold', 'italic', 'underline', 'strike', 'code'].includes(value.type)) return true;
  if (['color', 'fontFamily'].includes(value.type)) return typeof value.value === 'string';
  if (value.type === 'fontSize') return typeof value.value === 'number' && Number.isFinite(value.value);
  if (value.type === 'textTransform') {
    return ['none', 'uppercase', 'lowercase', 'capitalize'].includes(String(value.value));
  }
  return value.type === 'link' && typeof value.href === 'string'
    && (value.title === undefined || typeof value.title === 'string');
}

function isRichInline(value: unknown): value is RichInline {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'hardBreak') return true;
  return value.type === 'text'
    && typeof value.text === 'string'
    && (value.marks === undefined
      || (Array.isArray(value.marks) && value.marks.every(isRichMark)));
}

function isRichList(value: unknown, depth: number): value is RichList {
  if (
    depth > 16
    || !isRecord(value)
    || !['bulletList', 'orderedList'].includes(String(value.type))
    || !Array.isArray(value.items)
  ) return false;
  if (value.start !== undefined && (!Number.isInteger(value.start) || Number(value.start) < 1)) {
    return false;
  }
  return value.items.every((item) => isRecord(item)
    && item.type === 'listItem'
    && Array.isArray(item.children)
    && item.children.every((child) => isRichBlock(child, depth + 1)));
}

function isRichBlock(value: unknown, depth: number): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'paragraph') {
    return Array.isArray(value.children)
      && value.children.every(isRichInline)
      && (value.align === undefined || ['left', 'center', 'right'].includes(String(value.align)));
  }
  return isRichList(value, depth);
}

function isCanonicalRichText(value: unknown): value is RichText {
  return isRecord(value)
    && value.type === 'doc'
    && value.version === 1
    && Array.isArray(value.blocks)
    && value.blocks.every((block) => isRichBlock(block, 0));
}

function readSourceId(
  rawId: unknown,
  path: string,
  seen: Set<string>,
  report: MindMapImportReportBuilder,
): string | null {
  let sourceId: string;
  if (typeof rawId === 'string' && rawId.length > 0 && rawId.length <= 1_024) {
    sourceId = rawId;
  } else {
    sourceId = `nmdd-synthetic:${path}`;
    report.add({
      code: 'xmind.topic-id-synthesized',
      disposition: 'degraded',
      message: 'A missing or oversized XMind topic id was replaced by a deterministic import-local id.',
      path: `${path}/id`,
      severity: 'warning',
    });
  }
  if (seen.has(sourceId)) {
    report.add({
      code: 'xmind.topic-id-duplicate',
      disposition: 'rejected',
      message: `Duplicate XMind topic id ${JSON.stringify(sourceId)} makes references ambiguous.`,
      path: `${path}/id`,
      severity: 'error',
    });
    return null;
  }
  seen.add(sourceId);
  return sourceId;
}

function parseXMindContent(
  value: unknown,
  metadata: unknown,
  options: XMindImportOptions,
  report: MindMapImportReportBuilder,
): ParsedXMindContent | null {
  const limits = resolveMindMapImportLimits(options.limits);
  let sheetValues: unknown[];
  if (Array.isArray(value)) {
    sheetValues = value;
  } else if (isRecord(value) && Array.isArray(value.sheets)) {
    sheetValues = value.sheets;
    report.add({
      code: 'xmind.wrapped-sheets-container',
      disposition: 'preserved',
      message: 'A nonstandard {sheets:[...]} content wrapper was accepted.',
      path: '/sheets',
      severity: 'info',
    });
  } else {
    report.add({
      code: 'xmind.content-root-invalid',
      disposition: 'rejected',
      message: 'content.json must contain an array of XMind sheets.',
      severity: 'error',
    });
    return null;
  }
  if (sheetValues.length === 0) {
    report.add({
      code: 'xmind.no-sheets',
      disposition: 'rejected',
      message: 'content.json does not contain a sheet.',
      severity: 'error',
    });
    return null;
  }
  if (sheetValues.length > limits.maxNodes) {
    report.add({
      code: 'xmind.sheet-limit',
      disposition: 'rejected',
      message: `The workbook exceeds the ${limits.maxNodes} sheet safety limit.`,
      severity: 'error',
    });
    return null;
  }

  const seenTopicIds = new Set<string>();
  const seenSheetIds = new Set<string>();
  const parsedSheets: ParsedSheetRecord[] = [];
  let topicCount = 0;

  const parseTopic = (
    rawValue: unknown,
    path: string,
    depth: number,
    childKind: ChildKind,
    childIndex: number,
    parentSourceId: string | undefined,
    records: ParsedTopicRecord[],
  ): ParsedTopicRecord | null => {
    if (!isRecord(rawValue)) {
      report.add({
        code: 'xmind.topic-invalid',
        disposition: 'rejected',
        message: 'Every XMind topic must be a JSON object.',
        path,
        severity: 'error',
      });
      return null;
    }
    if (depth > limits.maxDepth) {
      report.add({
        code: 'xmind.depth-limit',
        disposition: 'rejected',
        message: `The XMind tree exceeds the ${limits.maxDepth} level import limit.`,
        path,
        severity: 'error',
      });
      return null;
    }
    topicCount += 1;
    if (topicCount > limits.maxNodes) {
      report.add({
        code: 'xmind.node-limit',
        disposition: 'rejected',
        message: `The XMind workbook exceeds the ${limits.maxNodes} topic limit.`,
        path,
        severity: 'error',
      });
      return null;
    }

    const sourceId = readSourceId(rawValue.id, path, seenTopicIds, report);
    if (!sourceId) return null;
    const rawFallback = rawWithout(rawValue, new Set(['children', 'id', 'title']));
    const extensions: JsonRecord = {
      [XMIND_SOURCE_ID_EXTENSION_KEY]: sourceId,
      ...(rawFallback === undefined ? {} : { [XMIND_RAW_TOPIC_EXTENSION_KEY]: rawFallback }),
      ...(typeof rawValue.title === 'string' || rawValue.title === undefined
        ? {}
        : { [XMIND_RAW_TITLE_EXTENSION_KEY]: copyJsonValue(rawValue.title) }),
      'io.xmind.child-kind': childKind,
    };
    const preservedOnlyKeys = Object.keys(rawValue).filter((key) =>
      ['image', 'numbering', 'style'].includes(key)
      || ![
        'boundaries', 'branch', 'children', 'class', 'extensions', 'href', 'id',
        'labels', 'markers', 'notes', 'position', 'structureClass', 'summaries',
        'title', 'titleUnedited', 'width',
      ].includes(key));
    if (preservedOnlyKeys.length > 0) {
      report.add({
        code: 'xmind.topic-attributes-preserved',
        count: preservedOnlyKeys.length,
        disposition: 'preserved',
        message: `XMind topic attributes without a canonical equivalent were retained in ${XMIND_RAW_TOPIC_EXTENSION_KEY}.`,
        path,
        severity: 'info',
      });
    }
    const node: { title: string; children: NormalizedOutlineNode[]; extensions: JsonRecord } = {
      children: [],
      extensions,
      title: titleFromXMind(rawValue.title, `${path}/title`, report),
    };
    const record: ParsedTopicRecord = {
      childIndex,
      childKind,
      node,
      ...(parentSourceId === undefined ? {} : { parentSourceId }),
      path,
      raw: rawValue,
      sourceId,
    };
    records.push(record);

    if (rawValue.children !== undefined && !isRecord(rawValue.children)) {
      report.add({
        code: 'xmind.children-invalid',
        disposition: 'rejected',
        message: 'A topic children field must be an object of topic arrays.',
        path: `${path}/children`,
        severity: 'error',
      });
      return null;
    }
    const children = isRecord(rawValue.children) ? rawValue.children : {};
    const childKinds = Object.keys(children).sort((left, right) => {
      const rank = (kind: string): number => {
        if (kind === 'attached') return 0;
        if (kind === 'detached') return 1;
        if (kind === 'summary') return 2;
        return 3;
      };
      return rank(left) - rank(right) || left.localeCompare(right, 'en-US');
    });
    for (const kind of childKinds) {
      const childValues = children[kind];
      if (!Array.isArray(childValues)) {
        report.add({
          code: 'xmind.child-list-invalid',
          disposition: 'rejected',
          message: `children.${kind} must be an array.`,
          path: `${path}/children/${kind}`,
          severity: 'error',
        });
        return null;
      }
      if (!['attached', 'detached', 'summary'].includes(kind) && childValues.length > 0) {
        report.add({
          code: 'xmind.child-kind-degraded',
          count: childValues.length,
          disposition: 'degraded',
          message: `Unsupported XMind child kind ${kind} was retained as an ordered tree branch and tagged in extensions.`,
          path: `${path}/children/${kind}`,
          severity: 'warning',
        });
      }
      for (let index = 0; index < childValues.length; index += 1) {
        const parsed = parseTopic(
          childValues[index],
          `${path}/children/${kind}/${index}`,
          depth + 1,
          kind,
          index,
          sourceId,
          records,
        );
        if (!parsed) return null;
        node.children.push(parsed.node);
      }
    }
    return record;
  };

  for (let sheetIndex = 0; sheetIndex < sheetValues.length; sheetIndex += 1) {
    const path = `/sheets/${sheetIndex}`;
    const rawSheet = sheetValues[sheetIndex];
    if (!isRecord(rawSheet) || !isRecord(rawSheet.rootTopic)) {
      report.add({
        code: 'xmind.sheet-invalid',
        disposition: 'rejected',
        message: 'Every XMind sheet must have a rootTopic object.',
        path,
        severity: 'error',
      });
      return null;
    }
    const sourceId = typeof rawSheet.id === 'string' && rawSheet.id.length <= 1_024
      ? rawSheet.id
      : `nmdd-sheet:${sheetIndex}`;
    if (seenSheetIds.has(sourceId)) {
      report.add({
        code: 'xmind.sheet-id-duplicate',
        disposition: 'rejected',
        message: `Duplicate XMind sheet id ${JSON.stringify(sourceId)} makes sheet references ambiguous.`,
        path: `${path}/id`,
        severity: 'error',
      });
      return null;
    }
    seenSheetIds.add(sourceId);
    const records: ParsedTopicRecord[] = [];
    const root = parseTopic(rawSheet.rootTopic, `${path}/rootTopic`, 0, 'attached', 0, undefined, records);
    if (!root) return null;
    const rawSheetFallback = rawWithout(
      rawSheet,
      new Set(['id', 'relationships', 'rootTopic', 'title']),
    );
    const normalized: NormalizedOutlineSheet = {
      extensions: {
        [XMIND_SOURCE_ID_EXTENSION_KEY]: sourceId,
        ...(rawSheetFallback === undefined
          ? {}
          : { [XMIND_RAW_SHEET_EXTENSION_KEY]: rawSheetFallback }),
        ...(Array.isArray(rawSheet.relationships)
          ? { [XMIND_RAW_RELATIONSHIPS_EXTENSION_KEY]: copyJsonValue(rawSheet.relationships) }
          : {}),
      },
      roots: [root.node],
      title: typeof rawSheet.title === 'string' ? rawSheet.title : root.node.title,
    };
    parsedSheets.push({ normalized, path, raw: rawSheet, sourceId, topics: records });
    const preservedSheetKeys = Object.keys(rawSheet).filter((key) =>
      ['legend', 'settings', 'style', 'theme'].includes(key)
      || ![
        'class', 'id', 'relationships', 'rootTopic', 'title', 'topicOverlapping',
        'topicPositioning',
      ].includes(key));
    if (preservedSheetKeys.length > 0) {
      report.add({
        code: 'xmind.sheet-attributes-preserved',
        count: preservedSheetKeys.length,
        disposition: 'preserved',
        message: `XMind sheet attributes without a canonical equivalent were retained in ${XMIND_RAW_SHEET_EXTENSION_KEY}.`,
        path,
        severity: 'info',
      });
    }
  }

  const metadataTitle = isRecord(metadata)
    && isRecord(metadata.nmdd)
    && typeof metadata.nmdd.documentTitle === 'string'
    ? metadata.nmdd.documentTitle
    : undefined;
  return {
    outline: {
      ...(isRecord(metadata) ? { extensions: { [XMIND_METADATA_EXTENSION_KEY]: copyJsonValue(metadata) } } : {}),
      sheets: parsedSheets.map((sheet) => sheet.normalized),
      title: metadataTitle ?? parsedSheets[0].normalized.title,
    },
    sheets: parsedSheets,
  };
}

function sourceTopicMap(sheet: MindMapSheet): Map<string, Topic> {
  const result = new Map<string, Topic>();
  for (const topic of Object.values(sheet.topics)) {
    const sourceId = topic.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY];
    if (typeof sourceId === 'string') result.set(sourceId, topic);
  }
  return result;
}

function incomingEdgeMap(sheet: MindMapSheet): Map<TopicId, TreeEdge> {
  return new Map(Object.values(sheet.treeEdges).map((edge) => [edge.childTopicId, edge]));
}

function xmindStructureToCanonical(value: unknown): BranchLayoutSpec | null {
  if (typeof value !== 'string' || value === '') return null;
  const lower = value.toLowerCase();
  if (lower.includes('logic')) {
    return {
      direction: lower.includes('left') ? 'right-to-left' : 'left-to-right',
      mode: 'auto',
      structure: 'core:logic-chart',
    };
  }
  if (lower.includes('org-chart') || lower.includes('orgchart')) {
    return {
      direction: lower.includes('up') ? 'bottom-to-top' : 'top-to-bottom',
      mode: 'auto',
      structure: 'core:org-chart',
    };
  }
  if (lower.includes('fishbone')) {
    return {
      direction: lower.includes('left') ? 'right-to-left' : 'left-to-right',
      mode: 'auto',
      structure: 'core:fishbone',
    };
  }
  if (lower.includes('timeline')) {
    return {
      direction: lower.includes('vertical') ? 'top-to-bottom' : 'left-to-right',
      mode: 'auto',
      structure: 'core:timeline',
    };
  }
  if (lower.includes('spreadsheet') || lower.includes('matrix')) {
    return { direction: 'top-to-bottom', mode: 'auto', structure: 'core:matrix' };
  }
  if (lower.includes('brace')) {
    return {
      direction: lower.includes('left') ? 'right-to-left' : 'left-to-right',
      mode: 'auto',
      structure: 'core:brace-map',
    };
  }
  if (lower.includes('tree-table')) {
    return { direction: 'left-to-right', mode: 'auto', structure: 'core:tree-table' };
  }
  if (lower.includes('tree')) {
    let direction: BranchLayoutSpec['direction'] = 'left-to-right';
    if (lower.includes('left')) direction = 'right-to-left';
    if (lower.includes('down')) direction = 'top-to-bottom';
    if (lower.includes('up')) direction = 'bottom-to-top';
    return { direction, mode: 'auto', structure: 'core:tree-chart' };
  }
  if (lower.includes('map')) {
    return {
      direction: lower.includes('counterclockwise')
        ? 'counterclockwise'
        : lower.includes('clockwise')
          ? 'clockwise'
          : 'both',
      mode: 'auto',
      structure: 'core:mind-map',
    };
  }
  return null;
}

function branchSideFromRaw(
  raw: JsonRecord,
  sheetLayout: BranchLayoutSpec | null,
  childIndex: number,
  nativeRightCount: number | null,
): TreeEdge['side'] {
  const extensionSide = providerContent(raw.extensions, NMDD_BRANCH_SIDE_PROVIDER);
  const sideValue = isRecord(extensionSide) ? extensionSide.side : extensionSide;
  if (['left', 'right', 'top', 'bottom', 'center', 'inherit'].includes(String(sideValue))) {
    return sideValue as TreeEdge['side'];
  }
  if (isRecord(raw.position) && typeof raw.position.x === 'number' && Number.isFinite(raw.position.x)) {
    if (raw.position.x < 0) return 'left';
    if (raw.position.x > 0) return 'right';
  }
  if (nativeRightCount !== null && nativeRightCount >= 0) {
    return childIndex < nativeRightCount ? 'right' : 'left';
  }
  if (sheetLayout?.direction === 'right-to-left') return 'left';
  if (sheetLayout?.direction === 'left-to-right') return 'right';
  return 'right';
}

function nativeRightBranchCount(root: JsonRecord): number | null {
  const content = providerContent(root.extensions, 'org.xmind.ui.map.unbalanced');
  let value: unknown;
  if (isRecord(content)) {
    value = content['right-number'] ?? content.rightNumber;
  } else if (Array.isArray(content)) {
    const item = content.find((candidate) =>
      isRecord(candidate) && candidate.name === 'right-number');
    value = isRecord(item) ? item.content : undefined;
  }
  const numeric = typeof value === 'string' && /^-?\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof numeric === 'number' && Number.isSafeInteger(numeric) ? numeric : null;
}

function notePlainText(rawNotes: unknown): { text: string; usedHtmlFallback: boolean } | null {
  if (!isRecord(rawNotes)) return null;
  if (isRecord(rawNotes.plain) && typeof rawNotes.plain.content === 'string') {
    return { text: rawNotes.plain.content, usedHtmlFallback: false };
  }
  const html = isRecord(rawNotes.realHTML)
    ? rawNotes.realHTML.content
    : isRecord(rawNotes.html)
      ? rawNotes.html.content
      : undefined;
  if (typeof html === 'string') return { text: html, usedHtmlFallback: true };
  const flattened = flattenRichValue(html);
  return flattened === '' ? null : { text: flattened, usedHtmlFallback: true };
}

function parseLabels(value: unknown): string[] | undefined {
  const labels = Array.isArray(value)
    ? value.filter((label): label is string => typeof label === 'string')
    : typeof value === 'string'
      ? [value]
      : [];
  const unique = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  return unique.length > 0 ? unique : undefined;
}

function parseRange(value: unknown): { first: number; last: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  return Number.isSafeInteger(first) && Number.isSafeInteger(last) && first <= last
    ? { first, last }
    : null;
}

function createScopeForRange(
  parent: ParsedTopicRecord,
  rawRange: unknown,
  sourceTopics: Map<string, Topic>,
  sheet: MindMapSheet,
): TopicScope | null {
  const range = parseRange(rawRange);
  if (!range || !isRecord(parent.raw.children) || !Array.isArray(parent.raw.children.attached)) {
    return null;
  }
  const attached = parent.raw.children.attached;
  if (range.last >= attached.length) return null;
  const firstRaw = attached[range.first];
  const lastRaw = attached[range.last];
  if (!isRecord(firstRaw) || !isRecord(lastRaw)) return null;
  const firstSource = typeof firstRaw.id === 'string'
    ? firstRaw.id
    : `nmdd-synthetic:${parent.path}/children/attached/${range.first}`;
  const lastSource = typeof lastRaw.id === 'string'
    ? lastRaw.id
    : `nmdd-synthetic:${parent.path}/children/attached/${range.last}`;
  const firstTopic = sourceTopics.get(firstSource);
  const lastTopic = sourceTopics.get(lastSource);
  const parentTopic = sourceTopics.get(parent.sourceId);
  if (!firstTopic || !lastTopic || !parentTopic) return null;
  const firstEdge = Object.values(sheet.treeEdges).find(
    (edge) => edge.parentTopicId === parentTopic.id && edge.childTopicId === firstTopic.id,
  );
  const lastEdge = Object.values(sheet.treeEdges).find(
    (edge) => edge.parentTopicId === parentTopic.id && edge.childTopicId === lastTopic.id,
  );
  if (!firstEdge || !lastEdge) return null;
  const topicIds = attached
    .slice(range.first, range.last + 1)
    .map((rawChild, index) => {
      if (!isRecord(rawChild)) return undefined;
      const sourceId = typeof rawChild.id === 'string'
        ? rawChild.id
        : `nmdd-synthetic:${parent.path}/children/attached/${range.first + index}`;
      return sourceTopics.get(sourceId)?.id;
    });
  if (topicIds.some((topicId) => topicId === undefined)) return null;
  const explicitClosure = [...new Set((topicIds as TopicId[]).flatMap((topicId) =>
    expandSemanticTopicScope(sheet, {
      kind: 'subtree',
      rootTopicId: topicId,
      depth: 'all',
    })))];
  const siblings = semanticSiblingEdges(sheet, firstEdge);
  const firstIndex = siblings.findIndex((edge) => edge.id === firstEdge.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === lastEdge.id);
  const canonicalIds = firstIndex >= 0 && lastIndex >= firstIndex
    ? siblings.slice(firstIndex, lastIndex + 1).map((edge) => edge.childTopicId)
    : [];
  if (
    canonicalIds.length !== topicIds.length
    || canonicalIds.some((topicId, index) => topicId !== topicIds[index])
  ) return { kind: 'explicit', topicIds: explicitClosure };
  return {
    firstEdgeId: firstEdge.id,
    includeDescendants: true,
    kind: 'sibling-range',
    lastEdgeId: lastEdge.id,
    parentTopicId: parentTopic.id,
  };
}

function collectDocumentIds(document: MindMapDocumentV1): Set<string> {
  const ids = new Set<string>([document.id]);
  for (const theme of Object.values(document.themes)) ids.add(theme.id);
  for (const sheet of Object.values(document.sheets)) {
    ids.add(sheet.id);
    for (const collection of [sheet.topics, sheet.treeEdges]) {
      for (const entity of Object.values(collection)) ids.add(entity.id);
    }
  }
  return ids;
}

function createImportIdAllocator(
  document: MindMapDocumentV1,
  options: XMindImportOptions,
  report: MindMapImportReportBuilder,
): <Kind extends string>(kind: MindMapImportEntityKind) => Id<Kind> | null {
  const used = collectDocumentIds(document);
  const factory = options.idFactory ?? (() => createUuidV7());
  return <Kind extends string>(kind: MindMapImportEntityKind): Id<Kind> | null => {
    const value = factory(kind);
    if (!UUID_V7_PATTERN.test(value) || used.has(value)) {
      report.add({
        code: used.has(value) ? 'xmind.id-factory-duplicate' : 'xmind.id-factory-invalid',
        disposition: 'rejected',
        message: `idFactory returned an invalid or duplicate UUIDv7 for ${kind}.`,
        severity: 'error',
      });
      return null;
    }
    used.add(value);
    return value as Id<Kind>;
  };
}

function semanticRawExtensions(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value)
    ? { [XMIND_RAW_SEMANTIC_EXTENSION_KEY]: copyJsonValue(value) }
    : undefined;
}

function enrichCanonicalDocument(
  document: MindMapDocumentV1,
  parsed: ParsedXMindContent,
  options: XMindImportOptions,
  report: MindMapImportReportBuilder,
  referencedImages: ReadonlyMap<string, ReferencedImageEntry>,
  extractedResources: Readonly<Record<string, Uint8Array>>,
): boolean {
  const allocate = createImportIdAllocator(document, options, report);
  const canonicalSheetsBySource = new Map<string, MindMapSheet>();
  for (const sheet of Object.values(document.sheets)) {
    const sourceId = sheet.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY];
    if (typeof sourceId === 'string') canonicalSheetsBySource.set(sourceId, sheet);
  }

  const markerGroupBySource = new Map<string, MarkerGroup>();
  const markerDefinitionBySource = new Map<string, MarkerDefinition>();

  for (const parsedSheet of parsed.sheets) {
    const sheet = canonicalSheetsBySource.get(parsedSheet.sourceId);
    if (!sheet) return false;
    const topicsBySource = sourceTopicMap(sheet);
    const incoming = incomingEdgeMap(sheet);
    const rootRecord = parsedSheet.topics[0];
    const sheetLayout = xmindStructureToCanonical(rootRecord.raw.structureClass);
    const nativeRightCount = nativeRightBranchCount(rootRecord.raw);
    if (sheetLayout) {
      sheet.defaultBranchLayout = {
        ...sheet.defaultBranchLayout,
        direction: sheetLayout.direction === 'inherit' ? 'both' : sheetLayout.direction,
        structure: sheetLayout.structure === 'inherit' ? 'core:mind-map' : sheetLayout.structure,
      };
    } else if (typeof rootRecord.raw.structureClass === 'string') {
      report.add({
        code: 'xmind.structure-preserved-only',
        disposition: 'preserved',
        message: `Unknown XMind structure ${rootRecord.raw.structureClass} was preserved in topic extensions.`,
        path: `${rootRecord.path}/structureClass`,
        severity: 'warning',
      });
    }

    for (const record of parsedSheet.topics) {
      const topic = topicsBySource.get(record.sourceId);
      if (!topic) return false;
      const customRichText = providerContent(record.raw.extensions, NMDD_RICH_TEXT_PROVIDER);
      if (isCanonicalRichText(customRichText)) {
        const currentPlainTitle = mindMapRichTextToPlainText(topic.title);
        const preservedPlainTitle = mindMapRichTextToPlainText(customRichText);
        if (preservedPlainTitle === currentPlainTitle) {
          topic.title = copyJsonValue(customRichText) as RichText;
        } else {
          report.add({
            code: 'xmind.nmdd-rich-text-stale',
            disposition: 'preserved',
            message: 'The NMDD rich-text extension no longer matches the XMind topic title, so it was preserved without replacing the edited title.',
            path: `${record.path}/extensions`,
            severity: 'warning',
          });
        }
      } else if (customRichText !== undefined) {
        report.add({
          code: 'xmind.nmdd-rich-text-invalid',
          disposition: 'ignored',
          message: 'An invalid NMDD rich-text preservation extension was ignored.',
          path: `${record.path}/extensions`,
          severity: 'warning',
        });
      }
      const labels = parseLabels(record.raw.labels);
      if (labels) topic.labels = labels;
      if (record.raw.branch === 'folded') topic.defaultCollapsed = true;
      const localLayout = xmindStructureToCanonical(record.raw.structureClass);
      if (localLayout && record !== rootRecord) topic.branchLayout = localLayout;
      if (
        isRecord(record.raw.position)
        && typeof record.raw.position.x === 'number'
        && typeof record.raw.position.y === 'number'
        && Number.isFinite(record.raw.position.x)
        && Number.isFinite(record.raw.position.y)
      ) {
        topic.placement = {
          mode: 'absolute',
          x: record.raw.position.x,
          y: record.raw.position.y,
        };
      }
      const incomingEdge = incoming.get(topic.id);
      if (incomingEdge && record.parentSourceId === rootRecord.sourceId) {
        incomingEdge.side = branchSideFromRaw(
          record.raw,
          sheetLayout,
          record.childIndex,
          nativeRightCount,
        );
      }
      if (incomingEdge && (record.childKind === 'detached' || record.childKind === 'summary')) {
        delete sheet.treeEdges[incomingEdge.id];
        incoming.delete(topic.id);
        topic.role = record.childKind === 'detached' ? 'floating-root' : 'summary-result';
        if (record.childKind === 'summary' && topic.placement.mode === 'absolute') {
          topic.placement = {
            mode: 'offset',
            dx: topic.placement.x,
            dy: topic.placement.y,
          };
          report.add({
            code: 'xmind.summary-position-as-offset',
            disposition: 'degraded',
            message: 'A native Summary result position was preserved as an offset from its derived Summary anchor.',
            path: `${record.path}/position`,
            severity: 'info',
          });
        }
      }

      const note = notePlainText(record.raw.notes);
      if (note) {
        const id = allocate<'Note'>('note') as NoteId | null;
        if (!id) return false;
        sheet.notes[id] = {
          content: createRichText(note.text),
          id,
          topicId: topic.id,
          ...(isRecord(record.raw.notes)
            ? { extensions: semanticRawExtensions(record.raw.notes) }
            : {}),
        };
        if (note.usedHtmlFallback) {
          report.add({
            code: 'xmind.notes-html-as-plain-text',
            disposition: 'degraded',
            message: 'HTML-only notes were stored as inert plain text and preserved in extensions.',
            path: `${record.path}/notes`,
            severity: 'warning',
          });
        }
      }

      if (Array.isArray(record.raw.markers)) {
        const instanceIds: MarkerInstanceId[] = [];
        const pending: Array<{ definitionId: MarkerDefinitionId; id: MarkerInstanceId }> = [];
        for (let markerIndex = 0; markerIndex < record.raw.markers.length; markerIndex += 1) {
          const rawMarker = record.raw.markers[markerIndex];
          if (!isRecord(rawMarker) || typeof rawMarker.markerId !== 'string') {
            report.add({
              code: 'xmind.marker-invalid',
              disposition: 'ignored',
              message: 'An invalid marker reference was preserved in topic extensions but not activated.',
              path: `${record.path}/markers/${markerIndex}`,
              severity: 'warning',
            });
            continue;
          }
          const groupSource = typeof rawMarker.groupId === 'string'
            ? rawMarker.groupId
            : `xmind-group:${rawMarker.markerId.split('-')[0] || 'markers'}`;
          let group = markerGroupBySource.get(groupSource);
          if (!group) {
            const groupId = allocate<'MarkerGroup'>('marker-group') as MarkerGroupId | null;
            if (!groupId) return false;
            group = {
              exclusive: false,
              id: groupId,
              kind: 'builtin',
              name: groupSource,
              orderKey: '' as OrderKey,
              extensions: { [XMIND_SOURCE_ID_EXTENSION_KEY]: groupSource },
            };
            markerGroupBySource.set(groupSource, group);
            document.markerGroups[groupId] = group;
          }
          const definitionSource = `${groupSource}\0${rawMarker.markerId}`;
          let definition = markerDefinitionBySource.get(definitionSource);
          if (!definition) {
            const definitionId = allocate<'MarkerDefinition'>('marker-definition') as MarkerDefinitionId | null;
            if (!definitionId) return false;
            definition = {
              groupId: group.id,
              id: definitionId,
              name: rawMarker.markerId,
              orderKey: '' as OrderKey,
              source: { kind: 'builtin', key: rawMarker.markerId },
              extensions: { [XMIND_SOURCE_ID_EXTENSION_KEY]: rawMarker.markerId },
            };
            markerDefinitionBySource.set(definitionSource, definition);
            document.markerDefinitions[definitionId] = definition;
          }
          const instanceId = allocate<'MarkerInstance'>('marker-instance') as MarkerInstanceId | null;
          if (!instanceId) return false;
          instanceIds.push(instanceId);
          pending.push({ definitionId: definition.id, id: instanceId });

          if (/^task-(done|complete|completed)$/i.test(rawMarker.markerId)) {
            const todoId = allocate<'Todo'>('todo') as TodoId | null;
            if (!todoId) return false;
            sheet.todos[todoId] = { completed: true, id: todoId, topicId: topic.id };
          }
        }
        const keys = rebalanceOrderKeys(instanceIds);
        for (const item of pending) {
          sheet.markerInstances[item.id] = {
            id: item.id,
            markerDefinitionId: item.definitionId,
            orderKey: keys[item.id],
            topicId: topic.id,
          };
        }
      }
    }

    for (const parentRecord of parsedSheet.topics) {
      const parentTopic = topicsBySource.get(parentRecord.sourceId);
      if (!parentTopic) return false;
      if (Array.isArray(parentRecord.raw.boundaries)) {
        for (let index = 0; index < parentRecord.raw.boundaries.length; index += 1) {
          const rawBoundary = parentRecord.raw.boundaries[index];
          const scope = isRecord(rawBoundary)
            ? createScopeForRange(parentRecord, rawBoundary.range, topicsBySource, sheet)
            : null;
          if (!scope || !isRecord(rawBoundary)) {
            report.add({
              code: 'xmind.boundary-range-degraded',
              disposition: 'degraded',
              message: 'A boundary with an invalid child range remains in topic extensions.',
              path: `${parentRecord.path}/boundaries/${index}`,
              severity: 'warning',
            });
            continue;
          }
          if (scope.kind === 'explicit') {
            report.add({
              code: 'xmind.boundary-range-degraded',
              disposition: 'degraded',
              message: 'A child range spanning mixed semantic sibling groups was imported as an explicit descendant closure.',
              path: `${parentRecord.path}/boundaries/${index}/range`,
              severity: 'warning',
            });
          }
          const id = allocate<'Boundary'>('boundary') as BoundaryId | null;
          if (!id) return false;
          const boundary: Boundary = {
            id,
            padding: 16,
            scope,
            extensions: semanticRawExtensions(rawBoundary),
            ...(rawBoundary.title === undefined
              ? {}
              : { title: createRichText(titleFromXMind(rawBoundary.title, `${parentRecord.path}/boundaries/${index}/title`, report)) }),
          };
          sheet.boundaries[id] = boundary;
        }
      }
      if (Array.isArray(parentRecord.raw.summaries)) {
        for (let index = 0; index < parentRecord.raw.summaries.length; index += 1) {
          const rawSummary = parentRecord.raw.summaries[index];
          const scope = isRecord(rawSummary)
            ? createScopeForRange(parentRecord, rawSummary.range, topicsBySource, sheet)
            : null;
          const resultTopic = isRecord(rawSummary) && typeof rawSummary.topicId === 'string'
            ? topicsBySource.get(rawSummary.topicId)
            : undefined;
          if (!scope || !resultTopic || !isRecord(rawSummary)) {
            report.add({
              code: 'xmind.summary-reference-degraded',
              disposition: 'degraded',
              message: 'A summary with an invalid range or result reference remains in topic extensions.',
              path: `${parentRecord.path}/summaries/${index}`,
              severity: 'warning',
            });
            continue;
          }
          if (scope.kind === 'explicit') {
            report.add({
              code: 'xmind.summary-reference-degraded',
              disposition: 'degraded',
              message: 'A child range spanning mixed semantic sibling groups was imported as an explicit descendant closure.',
              path: `${parentRecord.path}/summaries/${index}/range`,
              severity: 'warning',
            });
          }
          const id = allocate<'Summary'>('summary') as SummaryId | null;
          if (!id) return false;
          const summary: Summary = {
            id,
            orientation: 'auto',
            resultTopicId: resultTopic.id,
            scope,
            extensions: semanticRawExtensions(rawSummary),
          };
          resultTopic.role = 'summary-result';
          sheet.summaries[id] = summary;
        }
      }
    }

    if (Array.isArray(parsedSheet.raw.relationships)) {
      for (let index = 0; index < parsedSheet.raw.relationships.length; index += 1) {
        const rawRelationship = parsedSheet.raw.relationships[index];
        const sourceTopic = isRecord(rawRelationship) && typeof rawRelationship.end1Id === 'string'
          ? topicsBySource.get(rawRelationship.end1Id)
          : undefined;
        const targetTopic = isRecord(rawRelationship) && typeof rawRelationship.end2Id === 'string'
          ? topicsBySource.get(rawRelationship.end2Id)
          : undefined;
        if (!isRecord(rawRelationship) || !sourceTopic || !targetTopic) {
          report.add({
            code: 'xmind.relationship-reference-degraded',
            disposition: 'degraded',
            message: 'A relationship with an unresolved endpoint was preserved in sheet extensions.',
            path: `${parsedSheet.path}/relationships/${index}`,
            severity: 'warning',
          });
          continue;
        }
        const id = allocate<'Relationship'>('relationship') as RelationshipId | null;
        if (!id) return false;
        const controlPoints: Record<ControlPointId, RelationshipControlPoint> = {};
        if (isRecord(rawRelationship.controlPoints)) {
          const rawPoints = Object.entries(rawRelationship.controlPoints)
            .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
            .filter(([, point]) => typeof point.x === 'number' && typeof point.y === 'number'
              && Number.isFinite(point.x) && Number.isFinite(point.y))
            .sort(([left], [right]) => left.localeCompare(right, 'en-US'));
          const pointIds: ControlPointId[] = [];
          const pointData: Array<{ id: ControlPointId; raw: JsonRecord }> = [];
          for (const [, point] of rawPoints) {
            const pointId = allocate<'RelationshipControlPoint'>(
              'relationship-control-point',
            ) as ControlPointId | null;
            if (!pointId) return false;
            pointIds.push(pointId);
            pointData.push({ id: pointId, raw: point });
          }
          const pointOrder = rebalanceOrderKeys(pointIds);
          for (const point of pointData) {
            controlPoints[point.id] = {
              id: point.id,
              orderKey: pointOrder[point.id],
              x: Number(point.raw.x),
              y: Number(point.raw.y),
            };
          }
        }
        const relationship: Relationship = {
          controlPoints,
          endArrow: 'triangle',
          extensions: semanticRawExtensions(rawRelationship),
          id,
          routing: Object.keys(controlPoints).length > 0 ? 'manual' : 'curve',
          source: { anchor: 'auto', element: { kind: 'topic', topicId: sourceTopic.id } },
          startArrow: 'none',
          target: { anchor: 'auto', element: { kind: 'topic', topicId: targetTopic.id } },
          ...(rawRelationship.title === undefined
            ? {}
            : { title: createRichText(titleFromXMind(rawRelationship.title, `${parsedSheet.path}/relationships/${index}/title`, report)) }),
        };
        sheet.relationships[id] = relationship;
      }
    }

    const linkIdsByTopic = new Map<TopicId, LinkId[]>();
    for (const record of parsedSheet.topics) {
      if (typeof record.raw.href !== 'string' || record.raw.href === '') continue;
      const topic = topicsBySource.get(record.sourceId);
      if (!topic) return false;
      const href = record.raw.href;
      const id = allocate<'Link'>('link') as LinkId | null;
      if (!id) return false;
      let link: TopicLink | null = null;
      if (href.startsWith('xmind:#')) {
        let targetSourceId: string | null = null;
        try {
          targetSourceId = decodeURIComponent(href.slice('xmind:#'.length));
        } catch {
          targetSourceId = null;
        }
        let targetSheet = sheet;
        let target = targetSourceId === null ? undefined : topicsBySource.get(targetSourceId);
        if (!target && targetSourceId !== null) {
          const separator = targetSourceId.indexOf('/');
          if (separator > 0 && separator < targetSourceId.length - 1) {
            const targetSheetSourceId = targetSourceId.slice(0, separator);
            const targetTopicSourceId = targetSourceId.slice(separator + 1);
            const candidateSheet = canonicalSheetsBySource.get(targetSheetSourceId);
            const candidateTopic = candidateSheet
              ? sourceTopicMap(candidateSheet).get(targetTopicSourceId)
              : undefined;
            if (candidateSheet && candidateTopic) {
              targetSheet = candidateSheet;
              target = candidateTopic;
            }
          }
        }
        if (target) {
          link = {
            id,
            kind: 'topic',
            orderKey: '' as OrderKey,
            status: 'active',
            targetSheetId: targetSheet.id,
            targetTopicId: target.id,
            topicId: topic.id,
          };
        } else if (targetSourceId !== null) {
          const sheetTarget = canonicalSheetsBySource.get(targetSourceId);
          if (sheetTarget) {
            link = {
              id,
              kind: 'sheet',
              orderKey: '' as OrderKey,
              status: 'active',
              targetSheetId: sheetTarget.id,
              topicId: topic.id,
            };
          }
        }
      } else {
        try {
          const url = new URL(href);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            link = { href, id, kind: 'web', orderKey: '' as OrderKey, status: 'active', topicId: topic.id };
          } else if (url.protocol === 'mailto:') {
            link = { href, id, kind: 'email', orderKey: '' as OrderKey, status: 'active', topicId: topic.id };
          } else if (url.protocol === 'file:') {
            link = { href, id, kind: 'file', orderKey: '' as OrderKey, status: 'active', topicId: topic.id };
          }
        } catch {
          link = null;
        }
      }
      if (!link) {
        report.add({
          code: 'xmind.href-preserved-only',
          disposition: 'ignored',
          message: 'An unsafe, malformed, or unresolved XMind hyperlink was kept only in topic extensions.',
          path: `${record.path}/href`,
          severity: 'warning',
        });
        continue;
      }
      sheet.links[id] = link;
      const ids = linkIdsByTopic.get(topic.id) ?? [];
      ids.push(id);
      linkIdsByTopic.set(topic.id, ids);
    }
    for (const ids of linkIdsByTopic.values()) {
      const keys = rebalanceOrderKeys(ids);
      for (const id of ids) sheet.links[id].orderKey = keys[id];
    }
  }

  if (!importNativeTopicImages(
    document,
    parsed,
    referencedImages,
    extractedResources,
    allocate,
    report,
  )) return false;

  const groupIds = [...markerGroupBySource.values()].map((group) => group.id);
  const groupKeys = rebalanceOrderKeys(groupIds);
  for (const group of markerGroupBySource.values()) group.orderKey = groupKeys[group.id];
  const definitionsByGroup = new Map<MarkerGroupId, MarkerDefinition[]>();
  for (const definition of markerDefinitionBySource.values()) {
    const definitions = definitionsByGroup.get(definition.groupId) ?? [];
    definitions.push(definition);
    definitionsByGroup.set(definition.groupId, definitions);
  }
  for (const definitions of definitionsByGroup.values()) {
    const ids = definitions.map((definition) => definition.id);
    const keys = rebalanceOrderKeys(ids);
    for (const definition of definitions) definition.orderKey = keys[definition.id];
  }

  if (report.hasErrors()) return false;
  const validation = validateMindMapDocument(document);
  if (!validation.valid) {
    report.add({
      code: 'xmind.canonical-validation-failed',
      disposition: 'rejected',
      message: validation.issues.slice(0, 8).map((issue) => `${issue.code}@${issue.path}`).join(', '),
      severity: 'error',
    });
    return false;
  }
  return true;
}

function resourceEntries(entries: readonly XMindZipEntryDescriptor[]): XMindZipEntryDescriptor[] {
  return entries.filter((entry) => {
    if (entry.name.endsWith('/')) return false;
    return !SELECTED_ZIP_PATHS.has(entry.name) && entry.name !== 'content.xml';
  });
}

interface ReferencedImageEntry {
  readonly entryName: string;
  readonly rawImage: JsonRecord;
}

function collectReferencedImageEntries(
  parsed: ParsedXMindContent,
  entries: readonly XMindZipEntryDescriptor[],
  report: MindMapImportReportBuilder,
): ReadonlyMap<string, ReferencedImageEntry> {
  const resources = resourceEntries(entries);
  const byLowercaseName = new Map(resources.map((entry) => [
    entry.name.toLocaleLowerCase('en-US'),
    entry,
  ]));
  const referenced = new Map<string, ReferencedImageEntry>();
  const uniqueEntryNames = new Set<string>();
  let limitReported = false;

  for (const sheet of parsed.sheets) {
    for (const topic of sheet.topics) {
      if (topic.raw.image === undefined) continue;
      if (!isRecord(topic.raw.image)) {
        report.add({
          code: 'xmind.topic-image-invalid',
          disposition: 'ignored',
          message: 'A topic image that was not an object was preserved in extensions but not activated.',
          path: `${topic.path}/image`,
          severity: 'warning',
        });
        continue;
      }
      const rawImage = topic.raw.image;
      const requestedPath = xmindImageSourceToPackagePath(rawImage.src);
      if (!requestedPath) {
        report.add({
          code: 'xmind.topic-image-source-unsafe',
          disposition: 'ignored',
          message: 'A topic image with a missing, external, absolute, traversal, or malformed resource path was kept inert in extensions.',
          path: `${topic.path}/image/src`,
          severity: 'warning',
        });
        continue;
      }
      const descriptor = byLowercaseName.get(requestedPath.toLocaleLowerCase('en-US'));
      if (!descriptor) {
        report.add({
          code: 'xmind.topic-image-resource-missing',
          disposition: 'degraded',
          message: 'A topic image points to a package resource that is missing.',
          path: `${topic.path}/image/src`,
          severity: 'warning',
        });
        continue;
      }
      if (descriptor.uncompressedSize > XMIND_IMAGE_RESOURCE_MAX_BYTES) {
        report.add({
          code: 'xmind.topic-image-resource-size-limit',
          disposition: 'ignored',
          message: `A topic image exceeds the ${XMIND_IMAGE_RESOURCE_MAX_BYTES} byte raster-resource limit.`,
          path: descriptor.name,
          severity: 'warning',
        });
        continue;
      }
      if (
        !uniqueEntryNames.has(descriptor.name)
        && uniqueEntryNames.size >= XMIND_IMAGE_RESOURCE_MAX_COUNT
      ) {
        if (!limitReported) {
          report.add({
            code: 'xmind.topic-image-resource-count-limit',
            count: 1,
            disposition: 'ignored',
            message: `Only the first ${XMIND_IMAGE_RESOURCE_MAX_COUNT} distinct topic image resources are decoded.`,
            path: '/archive-entries',
            severity: 'warning',
          });
          limitReported = true;
        }
        continue;
      }
      uniqueEntryNames.add(descriptor.name);
      referenced.set(topic.path, { entryName: descriptor.name, rawImage });
    }
  }
  return referenced;
}

function finitePositiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number'
    && Number.isFinite(numeric)
    && numeric > 0
    && numeric <= 100_000
    ? numeric
    : null;
}

function importedImageSize(rawImage: JsonRecord): { height: number; width: number } | undefined {
  const width = finitePositiveNumber(rawImage.width);
  const height = finitePositiveNumber(rawImage.height);
  return width !== null && height !== null ? { height, width } : undefined;
}

function importedImageSide(rawImage: JsonRecord): 'bottom' | 'top' {
  const value = rawImage.placement ?? rawImage.position ?? rawImage.side;
  return value === 'bottom' ? 'bottom' : 'top';
}

function importedImageAlign(rawImage: JsonRecord): 'center' | 'end' | 'start' {
  return rawImage.align === 'start' || rawImage.align === 'end' ? rawImage.align : 'center';
}

function importedImageOffset(rawImage: JsonRecord): { x: number; y: number } {
  if (
    isRecord(rawImage.offset)
    && typeof rawImage.offset.x === 'number'
    && Number.isFinite(rawImage.offset.x)
    && typeof rawImage.offset.y === 'number'
    && Number.isFinite(rawImage.offset.y)
  ) return { x: rawImage.offset.x, y: rawImage.offset.y };
  return { x: 0, y: 0 };
}

function importedImageAlt(rawImage: JsonRecord, fallback: string): string {
  const value = typeof rawImage.alt === 'string'
    ? rawImage.alt
    : typeof rawImage.altText === 'string'
      ? rawImage.altText
      : fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 2_048);
}

function importNativeTopicImages(
  document: MindMapDocumentV1,
  parsed: ParsedXMindContent,
  referenced: ReadonlyMap<string, ReferencedImageEntry>,
  extracted: Readonly<Record<string, Uint8Array>>,
  allocate: <Kind extends string>(kind: MindMapImportEntityKind) => Id<Kind> | null,
  report: MindMapImportReportBuilder,
): boolean {
  const canonicalSheetsBySource = new Map<string, MindMapSheet>();
  for (const sheet of Object.values(document.sheets)) {
    const sourceId = sheet.extensions?.[XMIND_SOURCE_ID_EXTENSION_KEY];
    if (typeof sourceId === 'string') canonicalSheetsBySource.set(sourceId, sheet);
  }
  const assetsByFingerprint = new Map<string, Asset>();
  const imageIdsByTopic = new Map<TopicId, ImageId[]>();

  for (const parsedSheet of parsed.sheets) {
    const sheet = canonicalSheetsBySource.get(parsedSheet.sourceId);
    if (!sheet) return false;
    const topicsBySource = sourceTopicMap(sheet);
    for (const record of parsedSheet.topics) {
      const reference = referenced.get(record.path);
      if (!reference) continue;
      const bytes = extracted[reference.entryName];
      if (!bytes) {
        report.add({
          code: 'xmind.topic-image-resource-unavailable',
          disposition: 'degraded',
          message: 'A referenced topic image resource was not available after bounded extraction.',
          path: reference.entryName,
          severity: 'warning',
        });
        continue;
      }
      const inspection = inspectXMindRaster(bytes);
      if (!inspection) {
        report.add({
          code: 'xmind.topic-image-resource-spoofed',
          disposition: 'ignored',
          message: 'A topic image resource did not contain an allowed PNG, JPEG, GIF, or WebP raster signature.',
          path: reference.entryName,
          severity: 'warning',
        });
        continue;
      }
      const topic = topicsBySource.get(record.sourceId);
      if (!topic) return false;
      const sha256 = sha256Hex(bytes);
      const fingerprint = `${inspection.mimeType}\0${sha256}`;
      let asset = assetsByFingerprint.get(fingerprint);
      if (!asset) {
        const assetId = allocate<'Asset'>('asset') as AssetId | null;
        if (!assetId) return false;
        asset = {
          byteSize: bytes.byteLength,
          fileName: safeXMindResourceFileName(reference.entryName, inspection.extension),
          id: assetId,
          ...(inspection.intrinsicSize === undefined
            ? {}
            : { intrinsicSize: inspection.intrinsicSize }),
          mimeType: inspection.mimeType,
          sha256,
          source: { kind: 'embedded', relativePath: reference.entryName },
        };
        document.assets[assetId] = asset;
        assetsByFingerprint.set(fingerprint, asset);
      }
      const imageId = allocate<'Image'>('image') as ImageId | null;
      if (!imageId) return false;
      const image: TopicImage = {
        alt: importedImageAlt(reference.rawImage, asset.fileName),
        assetId: asset.id,
        id: imageId,
        orderKey: '' as OrderKey,
        placement: {
          align: importedImageAlign(reference.rawImage),
          offset: importedImageOffset(reference.rawImage),
          side: importedImageSide(reference.rawImage),
        },
        role: 'inline',
        ...(importedImageSize(reference.rawImage) === undefined
          ? {}
          : { size: importedImageSize(reference.rawImage) }),
        topicId: topic.id,
      };
      sheet.images[imageId] = image;
      const imageIds = imageIdsByTopic.get(topic.id) ?? [];
      imageIds.push(imageId);
      imageIdsByTopic.set(topic.id, imageIds);
      report.add({
        code: 'xmind.topic-image-imported',
        disposition: 'preserved',
        message: 'A validated XMind package raster was imported as canonical Asset + TopicImage.',
        path: `${record.path}/image`,
        severity: 'info',
      });
    }
  }
  for (const [topicId, ids] of imageIdsByTopic) {
    const keys = rebalanceOrderKeys(ids);
    for (const sheet of Object.values(document.sheets)) {
      for (const id of ids) {
        const image = sheet.images[id];
        if (image?.topicId === topicId) image.orderKey = keys[id];
      }
    }
  }
  return true;
}

function safeCanonicalFallbackPolicyIssue(document: MindMapDocumentV1): string | null {
  if (document.extensions?.[XMIND_METADATA_EXTENSION_KEY] !== undefined) {
    return `canonical fallback must not recursively contain ${XMIND_METADATA_EXTENSION_KEY}`;
  }
  for (const sheet of Object.values(document.sheets)) {
    for (const link of Object.values(sheet.links)) {
      if (!('href' in link)) continue;
      let protocol: string;
      try {
        protocol = new URL(link.href).protocol;
      } catch {
        return `link ${link.id} has a malformed URL`;
      }
      const allowed = link.kind === 'web'
        ? protocol === 'http:' || protocol === 'https:'
        : link.kind === 'email'
          ? protocol === 'mailto:'
          : protocol === 'file:';
      if (!allowed) return `link ${link.id} has a protocol inconsistent with kind ${link.kind}`;
    }
    for (const topic of Object.values(sheet.topics)) {
      const rawTopic = topic.extensions?.[XMIND_RAW_TOPIC_EXTENSION_KEY];
      if (
        isRecord(rawTopic)
        && isRecord(rawTopic.image)
        && xmindImageSourceToPackagePath(rawTopic.image.src) === null
      ) return `topic ${topic.id} contains an unsafe raw image resource source`;
    }
  }
  for (const asset of Object.values(document.assets)) {
    if (asset.source.kind === 'remote') {
      try {
        const url = new URL(asset.source.url);
        const protocol = url.protocol;
        if (protocol !== 'http:' && protocol !== 'https:') {
          return `remote asset ${asset.id} has an unsafe protocol`;
        }
        if (hasSignedRemoteCredential(asset.source.url)) {
          return `remote asset ${asset.id} contains credentials or signed-query secrets`;
        }
      } catch {
        return `remote asset ${asset.id} has a malformed URL`;
      }
    }
    if (asset.source.kind === 'managed') {
      return `managed asset ${asset.id} cannot be restored from an untrusted package object key`;
    }
    if (asset.source.kind === 'embedded') {
      const path = asset.source.relativePath;
      const parts = path.split('/');
      if (
        path === ''
        || path.includes('\\')
        || path.startsWith('/')
        || /^[A-Za-z]:/.test(path)
        || parts.some((part) => part === '' || part === '.' || part === '..')
      ) {
        return `embedded asset ${asset.id} has an unsafe relative path`;
      }
    }
  }
  return null;
}

function countCanonicalFallbackOnlyEntities(document: MindMapDocumentV1): number {
  return Object.keys(document.assets).length
    + Object.keys(document.presentations).length
    + Object.keys(document.savedViews).length
    + Object.values(document.sheets).reduce((total, sheet) => total
      + Object.keys(sheet.callouts).length
      + Object.keys(sheet.zones).length
      + Object.values(sheet.relationships).filter((relationship) =>
        relationship.source.element.kind !== 'topic'
        || relationship.target.element.kind !== 'topic').length
      + Object.keys(sheet.attachments).length
      + Object.keys(sheet.images).length
      + Object.keys(sheet.equations).length
      + Object.keys(sheet.audioClips).length
      + Object.keys(sheet.tasks).length
      + Object.keys(sheet.taskDependencies).length, 0);
}

function nativeImagesFromFallbackEnvelope(
  nmdd: JsonRecord,
  document: MindMapDocumentV1,
  resourceBytes: Readonly<Record<string, Uint8Array>>,
): ReadonlyMap<ImageId, NativeImageResource> | null {
  if (nmdd.nativeImageResources === undefined) return new Map();
  if (!isRecord(nmdd.nativeImageResources)) return null;
  const imagesById = new Map<ImageId, TopicImage>();
  for (const sheet of Object.values(document.sheets)) {
    for (const image of Object.values(sheet.images)) imagesById.set(image.id, image);
  }
  const result = new Map<ImageId, NativeImageResource>();
  for (const [rawImageId, rawPath] of Object.entries(nmdd.nativeImageResources)) {
    if (typeof rawPath !== 'string' || !isSafeXMindPackagePath(rawPath)) return null;
    const image = imagesById.get(rawImageId as ImageId);
    const asset = image ? document.assets[image.assetId] : undefined;
    const bytes = resourceBytes[rawPath];
    const inspection = bytes ? inspectXMindRaster(bytes) : null;
    if (
      !image
      || !asset
      || !bytes
      || !inspection
      || inspection.mimeType !== asset.mimeType
      || bytes.byteLength !== asset.byteSize
      || sha256Hex(bytes) !== asset.sha256.toLocaleLowerCase('en-US')
      || asset.source.kind !== 'embedded'
      || asset.source.relativePath !== rawPath
    ) return null;
    result.set(image.id, {
      packagePath: rawPath,
      rawImage: nativeImageJson(image, asset, rawPath),
    });
  }
  return result;
}

function packagedImageAssetsMatchFallbackEnvelope(
  nmdd: JsonRecord,
  document: MindMapDocumentV1,
  resourceBytes: Readonly<Record<string, Uint8Array>>,
): boolean {
  if (nmdd.packagedImageAssets === undefined) return true;
  if (!isRecord(nmdd.packagedImageAssets)) return false;
  const entries = Object.entries(nmdd.packagedImageAssets);
  if (new Set(entries.map(([, path]) => path)).size > XMIND_IMAGE_RESOURCE_MAX_COUNT) return false;
  const imageAssetIds = new Set<AssetId>();
  for (const sheet of Object.values(document.sheets)) {
    for (const image of Object.values(sheet.images)) imageAssetIds.add(image.assetId);
  }
  for (const [rawAssetId, rawPath] of entries) {
    if (
      typeof rawPath !== 'string'
      || !isSafeXMindPackagePath(rawPath)
      || !imageAssetIds.has(rawAssetId as AssetId)
    ) return false;
    const asset = document.assets[rawAssetId as AssetId];
    const bytes = resourceBytes[rawPath];
    const inspection = bytes ? inspectXMindRaster(bytes) : null;
    if (
      !asset
      || !bytes
      || !inspection
      || inspection.mimeType !== asset.mimeType
      || bytes.byteLength !== asset.byteSize
      || sha256Hex(bytes) !== asset.sha256.toLocaleLowerCase('en-US')
      || asset.source.kind !== 'embedded'
      || asset.source.relativePath !== rawPath
    ) return false;
  }
  return true;
}

/** Reads only bounded, safe paths. Full byte/integrity checks happen before fallback restoration. */
function packagedImageAssetPathsFromMetadata(metadata: unknown): readonly string[] {
  if (
    !isRecord(metadata)
    || !isRecord(metadata.nmdd)
    || !isRecord(metadata.nmdd.packagedImageAssets)
  ) return [];
  const paths: string[] = [];
  for (const rawPath of Object.values(metadata.nmdd.packagedImageAssets)) {
    if (typeof rawPath !== 'string' || !isSafeXMindPackagePath(rawPath)) return [];
    if (!paths.includes(rawPath)) paths.push(rawPath);
    if (paths.length > XMIND_IMAGE_RESOURCE_MAX_COUNT) return [];
  }
  return paths;
}

function restoreTrustedCanonicalFallback(
  metadata: unknown,
  actualContent: unknown,
  report: MindMapImportReportBuilder,
  resourceBytes: Readonly<Record<string, Uint8Array>>,
): MindMapDocumentV1 | null {
  if (!isRecord(metadata) || !isRecord(metadata.nmdd) || !own(metadata.nmdd, 'canonicalFallback')) {
    return null;
  }
  const nmdd = metadata.nmdd;
  const reject = (code: string, message: string): null => {
    report.add({
      code,
      disposition: 'ignored',
      message: `${message} Normal content.json import was kept and metadata remains in ${XMIND_METADATA_EXTENSION_KEY}.`,
      path: '/metadata.json/nmdd/canonicalFallback',
      severity: 'warning',
    });
    return null;
  };
  if (nmdd.canonicalFallbackRestorable === false) {
    return reject(
      'xmind.canonical-fallback-sensitive-source-redacted',
      'The exporter redacted one or more storage credentials, so this fallback is intentionally non-restorable.',
    );
  }
  if (
    nmdd.schema !== 'app.nmdd.mindmap'
    || nmdd.schemaVersion !== 1
    || nmdd.fallbackEnvelopeVersion !== 1
  ) {
    return reject(
      'xmind.canonical-fallback-envelope-unsupported',
      'The NMDD fallback schema or envelope version is unsupported.',
    );
  }
  if (!isRecord(nmdd.canonicalFallback)) {
    return reject('xmind.canonical-fallback-invalid', 'canonicalFallback is not a document object.');
  }
  if (
    typeof nmdd.canonicalFallbackSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(nmdd.canonicalFallbackSha256)
    || stableJsonHash(nmdd.canonicalFallback) !== nmdd.canonicalFallbackSha256
  ) {
    return reject(
      'xmind.canonical-fallback-integrity-mismatch',
      'The canonical fallback SHA-256 integrity value does not match its payload.',
    );
  }
  const validation = validateMindMapDocument(nmdd.canonicalFallback);
  if (!validation.valid) {
    return reject(
      'xmind.canonical-fallback-validation-failed',
      `The canonical fallback failed schema/invariant validation: ${validation.issues
        .slice(0, 6)
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}.`,
    );
  }
  const candidate = nmdd.canonicalFallback as unknown as MindMapDocumentV1;
  if (
    typeof nmdd.documentId !== 'string'
    || nmdd.documentId !== candidate.id
    || nmdd.documentTitle !== candidate.title
    || nmdd.contentRevision !== candidate.contentRevision
  ) {
    return reject(
      'xmind.canonical-fallback-workbook-mismatch',
      'The fallback document identity, title, or revision does not match its envelope.',
    );
  }
  const policyIssue = safeCanonicalFallbackPolicyIssue(candidate);
  if (policyIssue) {
    return reject(
      'xmind.canonical-fallback-security-policy',
      `The canonical fallback violates safe import policy: ${policyIssue}.`,
    );
  }
  const nativeImages = nativeImagesFromFallbackEnvelope(nmdd, candidate, resourceBytes);
  if (!nativeImages) {
    return reject(
      'xmind.canonical-fallback-image-envelope-invalid',
      'The fallback native-image resource map is malformed or inconsistent with canonical assets.',
    );
  }
  if (!packagedImageAssetsMatchFallbackEnvelope(nmdd, candidate, resourceBytes)) {
    return reject(
      'xmind.canonical-fallback-packaged-image-envelope-invalid',
      'The fallback packaged-image asset map is malformed or inconsistent with canonical assets.',
    );
  }
  if (
    typeof nmdd.contentIdentitySha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(nmdd.contentIdentitySha256)
  ) {
    return reject(
      'xmind.canonical-fallback-content-identity-missing',
      'The fallback envelope has no valid content identity SHA-256.',
    );
  }
  const actualIdentity = xmindContentIdentityHash(actualContent);
  if (actualIdentity !== nmdd.contentIdentitySha256) {
    return reject(
      'xmind.canonical-fallback-content-changed',
      'content.json no longer matches the workbook content identity bound to the fallback.',
    );
  }
  const projectionState: MutableExportReport = {
    degradedItems: 0,
    diagnostics: [],
    exportedSheets: 0,
    exportedTopics: 0,
    preservedAttributes: 0,
  };
  const expectedContent = projectDocumentToXMindContent(candidate, projectionState, nativeImages);
  if (xmindContentIdentityHash(expectedContent) !== actualIdentity) {
    return reject(
      'xmind.canonical-fallback-structure-mismatch',
      'The validated fallback does not project to the same sheets, topic identities, order, structure, and native semantics as content.json.',
    );
  }

  const restoredCount = countCanonicalFallbackOnlyEntities(candidate);
  report.add({
    code: 'xmind.canonical-fallback-restored',
    count: Math.max(1, restoredCount),
    disposition: 'preserved',
    message: 'A validated, integrity-bound NMDD canonical fallback matched content.json and was restored without remapping IDs.',
    path: '/metadata.json/nmdd/canonicalFallback',
    severity: 'info',
  });
  return candidate;
}

/**
 * Imports the current ZIP/content.json XMind format without touching UI state.
 * All decompression is preceded by central-directory limits and path checks.
 */
export function importXMind(
  input: ArrayBuffer | Uint8Array,
  options: XMindImportOptions = {},
): XMindImportResult {
  const bytes = asBytes(input);
  const report = new MindMapImportReportBuilder(XMIND_FORMAT, bytes.byteLength);
  const zipLimits = resolveXMindZipSecurityLimits({
    ...options.zipLimits,
    ...(options.limits?.maxInputBytes === undefined
      ? {}
      : { maxArchiveBytes: options.limits.maxInputBytes }),
  });
  let inspection;
  try {
    inspection = inspectAndExtractXMindZip(
      bytes,
      zipLimits,
      SELECTED_ZIP_PATHS,
    );
  } catch (error) {
    const securityError = error instanceof XMindZipSecurityError ? error : null;
    report.add({
      code: securityError?.code ?? 'xmind.zip-invalid',
      disposition: 'rejected',
      message: securityError?.message ?? 'The input is not a readable XMind ZIP archive.',
      ...(securityError?.path === undefined ? {} : { path: securityError.path }),
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const contentBytes = inspection.extracted['content.json'];
  if (!contentBytes) {
    report.add({
      code: 'xmind.content-json-missing',
      disposition: 'rejected',
      message: 'The XMind archive does not contain root-level content.json.',
      path: '/content.json',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }
  const genericLimits = resolveMindMapImportLimits(options.limits);
  if (contentBytes.byteLength > genericLimits.maxInputBytes) {
    report.add({
      code: 'xmind.content-json-limit',
      disposition: 'rejected',
      message: `content.json exceeds the ${genericLimits.maxInputBytes} byte import limit.`,
      path: '/content.json',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  let content: unknown;
  let metadata: unknown = undefined;
  try {
    content = JSON.parse(utf8Decode(contentBytes));
  } catch (error) {
    report.add({
      code: 'xmind.content-json-invalid',
      disposition: 'rejected',
      message: `content.json is not valid UTF-8 JSON: ${error instanceof Error ? error.message : 'parse error'}.`,
      path: '/content.json',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }
  const complexity = inspectJsonComplexity(
    content,
    Math.max(genericLimits.maxDepth + 32, 96),
    Math.max(genericLimits.maxNodes * 64, 100_000),
  );
  if (complexity) {
    report.add({
      code: complexity === 'depth' ? 'xmind.json-depth-limit' : 'xmind.json-value-limit',
      disposition: 'rejected',
      message: 'content.json exceeds the safe JSON structural complexity limit.',
      path: '/content.json',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const metadataBytes = inspection.extracted['metadata.json'];
  if (metadataBytes) {
    if (metadataBytes.byteLength > genericLimits.maxInputBytes) {
      report.add({
        code: 'xmind.metadata-json-limit',
        disposition: 'ignored',
        message: `metadata.json exceeded the ${genericLimits.maxInputBytes} byte limit and was ignored.`,
        path: '/metadata.json',
        severity: 'warning',
      });
    } else {
      try {
        const parsedMetadata: unknown = JSON.parse(utf8Decode(metadataBytes));
        const metadataComplexity = inspectJsonComplexity(
          parsedMetadata,
          96,
          Math.max(genericLimits.maxNodes * 32, 50_000),
        );
        if (metadataComplexity) {
          report.add({
            code: 'xmind.metadata-json-complexity',
            disposition: 'ignored',
            message: 'metadata.json exceeded safe structural complexity limits and was ignored.',
            path: '/metadata.json',
            severity: 'warning',
          });
        } else {
          metadata = parsedMetadata;
        }
      } catch {
        report.add({
          code: 'xmind.metadata-json-ignored',
          disposition: 'ignored',
          message: 'Malformed metadata.json was ignored; map content remains importable.',
          path: '/metadata.json',
          severity: 'warning',
        });
      }
    }
  }
  if (!inspection.extracted['manifest.json']) {
    report.add({
      code: 'xmind.manifest-missing',
      disposition: 'degraded',
      message: 'The package has no manifest.json; content.json was imported directly.',
      path: '/manifest.json',
      severity: 'warning',
    });
  }

  const parsed = parseXMindContent(content, metadata, options, report);
  if (!parsed || report.hasErrors()) {
    return { document: null, report: report.build(false) };
  }
  const referencedImages = collectReferencedImageEntries(parsed, inspection.entries, report);
  const packagedFallbackImagePaths = packagedImageAssetPathsFromMetadata(metadata);
  let extractedResources: Readonly<Record<string, Uint8Array>> = {};
  if (referencedImages.size > 0 || packagedFallbackImagePaths.length > 0) {
    const selectedResourcePaths = new Set(
      [
        ...[...referencedImages.values()].map((reference) => reference.entryName),
        ...packagedFallbackImagePaths,
      ],
    );
    try {
      extractedResources = inspectAndExtractXMindZip(
        bytes,
        zipLimits,
        selectedResourcePaths,
      ).extracted;
    } catch (error) {
      const securityError = error instanceof XMindZipSecurityError ? error : null;
      report.add({
        code: securityError?.code ?? 'xmind.image-resource-extraction-failed',
        disposition: 'rejected',
        message: securityError?.message ?? 'Referenced XMind image resources could not be extracted safely.',
        ...(securityError?.path === undefined ? {} : { path: securityError.path }),
        severity: 'error',
      });
      return { document: null, report: report.build(false) };
    }
  }
  const document = buildCanonicalDocumentFromOutline(parsed.outline, options, report);
  if (!document || report.hasErrors()) {
    return { document: null, report: report.build(false) };
  }
  const resources = resourceEntries(inspection.entries);
  if (resources.length > 0) {
    document.extensions = {
      ...document.extensions,
      [XMIND_RESOURCE_MANIFEST_EXTENSION_KEY]: resources.map((entry) => ({
        compressedSize: entry.compressedSize,
        compressionMethod: entry.compressionMethod,
        name: entry.name,
        uncompressedSize: entry.uncompressedSize,
      })),
    };
    const represented = new Set(
      [
        ...[...referencedImages.values()].map((reference) => reference.entryName),
        ...packagedFallbackImagePaths,
      ],
    );
    const unrepresentedCount = resources.filter((entry) => !represented.has(entry.name)).length;
    if (unrepresentedCount > 0) {
      report.add({
        code: 'xmind.resources-not-embedded',
        count: unrepresentedCount,
        disposition: 'degraded',
        message: 'Archive resources without a supported topic-image reference were not activated; their paths and sizes remain in a structured resource manifest.',
        path: '/archive-entries',
        severity: 'warning',
      });
    }
  }
  if (!enrichCanonicalDocument(
    document,
    parsed,
    options,
    report,
    referencedImages,
    extractedResources,
  )) {
    return { document: null, report: report.build(false) };
  }
  const validatedResourceBytes = Object.fromEntries(
    Object.entries(extractedResources)
      .filter(([, resourceBytes]) => inspectXMindRaster(resourceBytes) !== null)
      .map(([path, resourceBytes]) => [path, Uint8Array.from(resourceBytes)]),
  );
  const trustedFallback = restoreTrustedCanonicalFallback(
    metadata,
    content,
    report,
    validatedResourceBytes,
  );
  return {
    document: trustedFallback ?? document,
    report: report.build(true),
    ...(Object.keys(validatedResourceBytes).length === 0
      ? {}
      : { resourceBytes: validatedResourceBytes }),
  };
}

export const importMindMapFromXMind = importXMind;

function addExportDiagnostic(
  state: MutableExportReport,
  input: Omit<MindMapImportDiagnostic, 'path'> & { readonly count?: number; readonly path?: string },
): void {
  const count = Math.max(1, Math.floor(input.count ?? 1));
  if (input.disposition === 'degraded') state.degradedItems += count;
  if (input.disposition === 'preserved') state.preservedAttributes += count;
  state.diagnostics.push({
    code: input.code,
    disposition: input.disposition,
    message: input.message,
    ...(input.path === undefined ? {} : { path: input.path }),
    severity: input.severity,
  });
}

function buildExportReport(
  state: MutableExportReport,
  success: boolean,
): XMindExportReport {
  return {
    degradedItems: state.degradedItems,
    diagnostics: [...state.diagnostics],
    exportedSheets: state.exportedSheets,
    exportedTopics: state.exportedTopics,
    format: XMIND_FORMAT,
    preservedAttributes: state.preservedAttributes,
    success,
  };
}

function safeRecord(value: unknown): JsonRecord {
  const copied = copyJsonValue(value);
  return isRecord(copied) ? copied : {};
}

function extensionArrayWith(
  existing: unknown,
  additions: readonly { readonly content: unknown; readonly provider: string }[],
): JsonRecord[] {
  const providerNames = new Set(additions.map((item) => item.provider));
  const result = Array.isArray(existing)
    ? existing
      .filter((item) => !isRecord(item) || !providerNames.has(String(item.provider)))
      .map((item) => safeRecord(item))
    : [];
  for (const addition of [...additions].sort((left, right) =>
    left.provider.localeCompare(right.provider, 'en-US'))) {
    result.push({ content: copyJsonValue(addition.content), provider: addition.provider });
  }
  return result;
}

function canonicalStructureToXMind(layout: BranchLayoutSpec): string {
  switch (layout.structure) {
    case 'core:logic-chart':
      return layout.direction === 'right-to-left'
        ? 'org.xmind.ui.logic.left'
        : 'org.xmind.ui.logic.right';
    case 'core:org-chart':
      return layout.direction === 'bottom-to-top'
        ? 'org.xmind.ui.org-chart.up'
        : 'org.xmind.ui.org-chart.down';
    case 'core:tree-chart': {
      if (layout.direction === 'right-to-left') return 'org.xmind.ui.tree.left';
      if (layout.direction === 'top-to-bottom') return 'org.xmind.ui.tree.down';
      if (layout.direction === 'bottom-to-top') return 'org.xmind.ui.tree.up';
      return 'org.xmind.ui.tree.right';
    }
    case 'core:timeline':
      return layout.direction === 'top-to-bottom' || layout.direction === 'bottom-to-top'
        ? 'org.xmind.ui.timeline.vertical'
        : 'org.xmind.ui.timeline.horizontal';
    case 'core:fishbone':
      return layout.direction === 'right-to-left'
        ? 'org.xmind.ui.fishbone.leftHeaded'
        : 'org.xmind.ui.fishbone.rightHeaded';
    case 'core:matrix':
    case 'core:grid':
      return 'org.xmind.ui.spreadsheet';
    case 'core:brace-map':
      return layout.direction === 'right-to-left'
        ? 'org.xmind.ui.brace.left'
        : 'org.xmind.ui.brace.right';
    case 'core:tree-table':
      return 'org.xmind.ui.tree-table';
    case 'core:mind-map':
      if (layout.direction === 'clockwise') return 'org.xmind.ui.map.clockwise';
      if (layout.direction === 'counterclockwise') return 'org.xmind.ui.map.counterclockwise';
      return 'org.xmind.ui.map';
    default:
      return String(layout.structure);
  }
}

function xmindStyleFromTopic(topic: Topic): JsonRecord | undefined {
  const style = topic.style?.overrides;
  if (!style) return undefined;
  const properties: JsonRecord = {};
  if (style.fill?.color?.kind === 'literal') properties['svg:fill'] = style.fill.color.value;
  if (style.typography?.color?.kind === 'literal') {
    properties['fo:color'] = style.typography.color.value;
  }
  if (style.typography?.fontFamily) properties['fo:font-family'] = style.typography.fontFamily;
  if (style.typography?.fontSize !== undefined) {
    properties['fo:font-size'] = `${style.typography.fontSize}pt`;
  }
  if (style.typography?.fontWeight !== undefined) {
    properties['fo:font-weight'] = style.typography.fontWeight;
  }
  if (style.typography?.italic) properties['fo:font-style'] = 'italic';
  if (style.typography?.align) properties['fo:text-align'] = style.typography.align;
  if (style.border?.color?.kind === 'literal') {
    properties['border-line-color'] = style.border.color.value;
  }
  if (style.border?.width !== undefined) properties['border-line-width'] = `${style.border.width}pt`;
  if (style.shape) properties['shape-class'] = style.shape;
  return Object.keys(properties).length === 0
    ? undefined
    : { id: `nmdd-style-${topic.id}`, properties, type: 'topic' };
}

function hasNonPlainRichText(value: RichText): boolean {
  return JSON.stringify(value) !== JSON.stringify(createRichText(mindMapRichTextToPlainText(value)));
}

function xmindRawFromExtension(
  entity: { readonly extensions?: Record<string, unknown> },
  key: string,
): JsonRecord {
  return safeRecord(entity.extensions?.[key]);
}

function orderedTreeEdges(sheet: MindMapSheet): Map<TopicId, TreeEdge[]> {
  const result = new Map<TopicId, TreeEdge[]>();
  for (const edge of Object.values(sheet.treeEdges)) {
    const edges = result.get(edge.parentTopicId) ?? [];
    edges.push(edge);
    result.set(edge.parentTopicId, edges);
  }
  for (const edges of result.values()) edges.sort(compareMindMapViewOrderedEntities);
  return result;
}

function scopeToNativeRange(
  sheet: MindMapSheet,
  scope: TopicScope,
  incoming: Map<TopicId, TreeEdge>,
  emittedChildrenByParent: ReadonlyMap<TopicId, readonly TreeEdge[]>,
): { first: number; last: number; parentTopicId: TopicId } | null {
  let candidate: Extract<TopicScope, { kind: 'sibling-range' }> | null = null;
  if (scope.kind === 'sibling-range') candidate = scope;
  if (scope.kind === 'subtree') {
    if (scope.depth !== 'all') return null;
    const edge = incoming.get(scope.rootTopicId);
    if (!edge) return null;
    candidate = {
      kind: 'sibling-range',
      parentTopicId: edge.parentTopicId,
      firstEdgeId: edge.id,
      lastEdgeId: edge.id,
      includeDescendants: true,
    };
  } else if (scope.kind === 'explicit') {
    const normalized = normalizeExactSemanticScopeMembers(sheet, scope.topicIds);
    if (normalized.rejectedTopicIds.length > 0 || normalized.groups.length !== 1) return null;
    const normalizedScope = normalized.groups[0].scope;
    if (normalizedScope.kind !== 'sibling-range' || !normalizedScope.includeDescendants) {
      return null;
    }
    candidate = normalizedScope;
  }
  if (!candidate) return null;
  if (!candidate.includeDescendants) return null;
  const firstEdge = sheet.treeEdges[candidate.firstEdgeId];
  const lastEdge = sheet.treeEdges[candidate.lastEdgeId];
  if (
    !firstEdge
    || !lastEdge
    || firstEdge.parentTopicId !== candidate.parentTopicId
    || lastEdge.parentTopicId !== candidate.parentTopicId
  ) return null;
  const semanticSiblings = semanticSiblingEdges(sheet, firstEdge);
  const semanticFirst = semanticSiblings.findIndex((edge) => edge.id === firstEdge.id);
  const semanticLast = semanticSiblings.findIndex((edge) => edge.id === lastEdge.id);
  if (semanticFirst < 0 || semanticLast < semanticFirst) return null;
  const anchorEdgeIds = semanticSiblings
    .slice(semanticFirst, semanticLast + 1)
    .map((edge) => edge.id);
  const emitted = emittedChildrenByParent.get(candidate.parentTopicId) ?? [];
  const first = emitted.findIndex((edge) => edge.id === firstEdge.id);
  const last = emitted.findIndex((edge) => edge.id === lastEdge.id);
  if (first < 0 || last < first) return null;
  const emittedSliceIds = emitted.slice(first, last + 1).map((edge) => edge.id);
  if (
    emittedSliceIds.length !== anchorEdgeIds.length
    || emittedSliceIds.some((edgeId, index) => edgeId !== anchorEdgeIds[index])
  ) return null;
  return { first, last, parentTopicId: candidate.parentTopicId };
}

function xmindHrefForLink(link: TopicLink, sheet: MindMapSheet): string | null {
  if (link.kind === 'web' || link.kind === 'email' || link.kind === 'file' || link.kind === 'folder') {
    return link.href;
  }
  if (link.kind === 'topic') {
    return link.targetSheetId === sheet.id
      ? `xmind:#${encodeURIComponent(link.targetTopicId)}`
      : `xmind:#${encodeURIComponent(link.targetSheetId)}/${encodeURIComponent(link.targetTopicId)}`;
  }
  if (link.kind === 'sheet') return `xmind:#${encodeURIComponent(link.targetSheetId)}`;
  return null;
}

interface PreparedNativeImageResources {
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly images: ReadonlyMap<ImageId, NativeImageResource>;
  readonly packagedPathByAsset: ReadonlyMap<AssetId, string>;
}

function exportResourceBytes(
  asset: Asset,
  options: XMindExportOptions,
): Uint8Array | null {
  const value = options.resourceBytes?.[asset.id]
    ?? (asset.source.kind === 'embedded'
      ? options.resourceBytes?.[asset.source.relativePath]
      : undefined);
  if (value === undefined) return null;
  return value instanceof Uint8Array
    ? Uint8Array.from(value)
    : Uint8Array.from(new Uint8Array(value));
}

function nativeImageJson(
  image: TopicImage,
  asset: Asset,
  packagePath: string,
): JsonRecord {
  const size = image.size ?? asset.intrinsicSize;
  const raw: JsonRecord = {
    src: xmindPackagePathToImageSource(packagePath),
    placement: image.placement.side,
    align: image.placement.align,
    ...(image.alt === undefined ? {} : { alt: image.alt }),
    ...(size === undefined ? {} : { height: size.height, width: size.width }),
  };
  if (image.placement.offset.x !== 0 || image.placement.offset.y !== 0) {
    raw.offset = { ...image.placement.offset };
  }
  return raw;
}

function prepareNativeImageResources(
  document: MindMapDocumentV1,
  options: XMindExportOptions,
  state: MutableExportReport,
): PreparedNativeImageResources {
  const files: Record<string, Uint8Array> = {};
  const images = new Map<ImageId, NativeImageResource>();
  const packagedPathByAsset = new Map<AssetId, string>();
  const resourceFingerprintByPath = new Map<string, string>();
  const attemptedAssetIds = new Set<AssetId>();

  /**
   * Package every validated raster used by a canonical TopicImage, including
   * Sticker/Illustration assets that do not have a stable native topic.image
   * representation. This keeps the integrity-bound canonical fallback
   * restorable without exposing managed object keys.
   */
  const packageAsset = (asset: Asset): string | null => {
    const existing = packagedPathByAsset.get(asset.id);
    if (existing) return existing;
    if (attemptedAssetIds.has(asset.id)) return null;
    attemptedAssetIds.add(asset.id);

    const bytes = exportResourceBytes(asset, options);
    if (!bytes) {
      if (asset.source.kind === 'remote' && hasSignedRemoteCredential(asset.source.url)) {
        addExportDiagnostic(state, {
          code: 'xmind.remote-image-credential-not-exported',
          disposition: 'degraded',
          message: 'A remote image URL containing credentials or a recognized signed-query credential was not copied into the XMind package.',
          path: `/assets/${asset.id}/source`,
          severity: 'warning',
        });
      }
      addExportDiagnostic(state, {
        code: 'xmind.image-resource-bytes-unavailable',
        disposition: 'degraded',
        message: 'The pure XMind codec does not fetch remote URLs or resolve managed/embedded storage; supply validated bytes to emit a native image resource.',
        path: `/assets/${asset.id}`,
        severity: 'warning',
      });
      return null;
    }
    if (bytes.byteLength > XMIND_IMAGE_RESOURCE_MAX_BYTES) {
      addExportDiagnostic(state, {
        code: 'xmind.image-resource-size-limit',
        disposition: 'degraded',
        message: `An image resource exceeds the ${XMIND_IMAGE_RESOURCE_MAX_BYTES} byte export limit.`,
        path: `/assets/${asset.id}`,
        severity: 'warning',
      });
      return null;
    }
    const inspection = inspectXMindRaster(bytes);
    const sha256 = sha256Hex(bytes);
    if (
      !inspection
      || inspection.mimeType !== asset.mimeType
      || bytes.byteLength !== asset.byteSize
      || sha256 !== asset.sha256.toLocaleLowerCase('en-US')
    ) {
      addExportDiagnostic(state, {
        code: 'xmind.image-resource-integrity-mismatch',
        disposition: 'degraded',
        message: 'Supplied image bytes failed the canonical MIME, byteSize, or SHA-256 contract and were not packaged.',
        path: `/assets/${asset.id}`,
        severity: 'warning',
      });
      return null;
    }
    const packagePath = `resources/${sha256}.${inspection.extension}`;
    const fingerprint = `${inspection.mimeType}\0${sha256}`;
    const previousFingerprint = resourceFingerprintByPath.get(packagePath);
    if (previousFingerprint !== undefined && previousFingerprint !== fingerprint) {
      addExportDiagnostic(state, {
        code: 'xmind.image-resource-path-collision',
        disposition: 'degraded',
        message: 'A deterministic image resource path collision prevented native packaging.',
        path: packagePath,
        severity: 'warning',
      });
      return null;
    }
    if (!(packagePath in files) && Object.keys(files).length >= XMIND_IMAGE_RESOURCE_MAX_COUNT) {
      addExportDiagnostic(state, {
        code: 'xmind.image-resource-count-limit',
        disposition: 'degraded',
        message: `The XMind export exceeds the ${XMIND_IMAGE_RESOURCE_MAX_COUNT} distinct image-resource limit.`,
        path: `/assets/${asset.id}`,
        severity: 'warning',
      });
      return null;
    }
    if (!(packagePath in files)) files[packagePath] = bytes;
    resourceFingerprintByPath.set(packagePath, fingerprint);
    packagedPathByAsset.set(asset.id, packagePath);
    return packagePath;
  };

  const orderedSheets = getMindMapSheetsInViewOrder(document);
  for (const sheet of orderedSheets) {
    for (const image of Object.values(sheet.images).sort(compareMindMapViewOrderedEntities)) {
      const asset = document.assets[image.assetId];
      if (asset) packageAsset(asset);
    }
  }

  for (const [sheetIndex, sheet] of orderedSheets.entries()) {
    const ordinaryByTopic = new Map<TopicId, TopicImage[]>();
    for (const image of Object.values(sheet.images).sort(compareMindMapViewOrderedEntities)) {
      if (image.role === 'background' || image.role === 'sticker') continue;
      const list = ordinaryByTopic.get(image.topicId) ?? [];
      list.push(image);
      ordinaryByTopic.set(image.topicId, list);
    }
    for (const [topicId, candidates] of ordinaryByTopic) {
      const image = candidates[0];
      if (candidates.length > 1) {
        addExportDiagnostic(state, {
          code: 'xmind.multiple-topic-images-preserved-only',
          count: candidates.length - 1,
          disposition: 'preserved',
          message: 'XMind has one native topic-image slot; additional canonical images remain only in the canonical fallback.',
          path: `/sheets/${sheetIndex}/topics/${topicId}/images`,
          severity: 'warning',
        });
      }
      if (image.placement.side !== 'top' && image.placement.side !== 'bottom') {
        addExportDiagnostic(state, {
          code: 'xmind.topic-image-placement-preserved-only',
          disposition: 'preserved',
          message: 'A nonstandard ordinary image placement was not represented as an XMind Local Image.',
          path: `/sheets/${sheetIndex}/images/${image.id}/placement`,
          severity: 'warning',
        });
        continue;
      }
      const asset = document.assets[image.assetId];
      if (!asset) continue;
      const packagePath = packageAsset(asset);
      if (!packagePath) continue;
      images.set(image.id, {
        packagePath,
        rawImage: nativeImageJson(image, asset, packagePath),
      });
    }
  }
  return { files, images, packagedPathByAsset };
}

interface CanonicalFallbackExport {
  readonly fallback: JsonRecord;
  readonly redactedSensitiveSources: number;
}

function redactUnsafeRawTopicImageSources(fallback: JsonRecord): number {
  if (!isRecord(fallback.sheets)) return 0;
  let redacted = 0;
  for (const sheet of Object.values(fallback.sheets)) {
    if (!isRecord(sheet) || !isRecord(sheet.topics)) continue;
    for (const topic of Object.values(sheet.topics)) {
      if (!isRecord(topic) || !isRecord(topic.extensions)) continue;
      const rawTopic = topic.extensions[XMIND_RAW_TOPIC_EXTENSION_KEY];
      if (!isRecord(rawTopic) || !isRecord(rawTopic.image)) continue;
      if (xmindImageSourceToPackagePath(rawTopic.image.src) !== null) continue;
      delete rawTopic.image;
      redacted += 1;
    }
  }
  return redacted;
}

function createCanonicalFallback(
  document: MindMapDocumentV1,
  packagedPathByAsset: ReadonlyMap<AssetId, string>,
): CanonicalFallbackExport {
  const fallback = safeRecord(document);
  if (isRecord(fallback.extensions)) {
    delete fallback.extensions[XMIND_METADATA_EXTENSION_KEY];
    if (Object.keys(fallback.extensions).length === 0) delete fallback.extensions;
  }
  let redactedSensitiveSources = redactUnsafeRawTopicImageSources(fallback);
  if (isRecord(fallback.assets)) {
    for (const asset of Object.values(document.assets)) {
      const copiedAsset = fallback.assets[asset.id];
      if (!isRecord(copiedAsset)) continue;
      const packagedPath = packagedPathByAsset.get(asset.id);
      if (packagedPath) {
        copiedAsset.source = { kind: 'embedded', relativePath: packagedPath };
        continue;
      }
      if (asset.source.kind === 'managed') {
        copiedAsset.source = { kind: 'managed', objectKey: '[redacted]' };
        redactedSensitiveSources += 1;
      } else if (
        asset.source.kind === 'remote'
        && hasSignedRemoteCredential(asset.source.url)
      ) {
        copiedAsset.source = {
          kind: 'remote',
          url: redactSensitiveRemoteUrl(asset.source.url),
        };
        redactedSensitiveSources += 1;
      }
    }
  }
  return { fallback, redactedSensitiveSources };
}

function nonEmptyExtensionString(
  extensions: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | null {
  const value = extensions?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Returns an exact XMind-native marker reference only when the canonical marker
 * explicitly represents a built-in marker. Imported source IDs win so a foreign
 * XMind vocabulary survives an import/export cycle byte-for-byte at field level.
 */
function nativeXMindMarkerReference(
  group: MarkerGroup | undefined,
  definition: MarkerDefinition | undefined,
): { readonly groupId: string; readonly markerId: string } | null {
  if (!group || !definition || group.kind !== 'builtin' || definition.source.kind !== 'builtin') {
    return null;
  }
  const importedGroupId = nonEmptyExtensionString(
    group.extensions,
    XMIND_SOURCE_ID_EXTENSION_KEY,
  );
  const libraryGroupId = nonEmptyExtensionString(
    group.extensions,
    NMDD_MARKER_LIBRARY_KEY_EXTENSION,
  );
  const groupId = importedGroupId
    ?? (libraryGroupId && XMIND_NATIVE_STANDARD_MARKER_GROUP_IDS.has(libraryGroupId)
      ? libraryGroupId
      : group.name);
  const markerId = nonEmptyExtensionString(
    definition.extensions,
    XMIND_SOURCE_ID_EXTENSION_KEY,
  ) ?? definition.source.key;
  return groupId.length > 0 && markerId.length > 0 ? { groupId, markerId } : null;
}

function exportSheetToXMind(
  document: MindMapDocumentV1,
  sheet: MindMapSheet,
  state: MutableExportReport,
  sheetIndex: number,
  nativeImages: ReadonlyMap<ImageId, NativeImageResource> = new Map(),
): JsonRecord {
  const childrenByParent = orderedTreeEdges(sheet);
  const incoming = incomingEdgeMap(sheet);
  const summaryResultIds = new Set(Object.values(sheet.summaries).map((summary) => summary.resultTopicId));
  const emittedChildrenByParent = new Map<TopicId, readonly TreeEdge[]>(
    [...childrenByParent.entries()].map(([parentTopicId, edges]) => [
      parentTopicId,
      edges.filter((edge) => !summaryResultIds.has(edge.childTopicId)),
    ]),
  );
  const boundariesByParent = new Map<TopicId, JsonRecord[]>();
  const summariesByParent = new Map<TopicId, JsonRecord[]>();
  const summaryTopicsByParent = new Map<TopicId, TopicId[]>();

  for (const boundary of Object.values(sheet.boundaries).sort((left, right) =>
    left.id.localeCompare(right.id, 'en-US'))) {
    const range = scopeToNativeRange(sheet, boundary.scope, incoming, emittedChildrenByParent);
    if (!range) {
      addExportDiagnostic(state, {
        code: 'xmind.boundary-scope-preserved-only',
        disposition: 'preserved',
        message: 'A boundary scope that XMind ranges cannot express was retained in metadata fallback.',
        path: `/sheets/${sheetIndex}/boundaries/${boundary.id}`,
        severity: 'warning',
      });
      continue;
    }
    const raw = xmindRawFromExtension(boundary, XMIND_RAW_SEMANTIC_EXTENSION_KEY);
    const item: JsonRecord = {
      ...raw,
      class: 'boundary',
      id: boundary.id,
      range: `(${range.first},${range.last})`,
      ...(boundary.title === undefined
        ? {}
        : { title: mindMapRichTextToPlainText(boundary.title), titleUnedited: false }),
    };
    const items = boundariesByParent.get(range.parentTopicId) ?? [];
    items.push(item);
    boundariesByParent.set(range.parentTopicId, items);
  }

  for (const summary of Object.values(sheet.summaries).sort((left, right) =>
    left.id.localeCompare(right.id, 'en-US'))) {
    const range = scopeToNativeRange(sheet, summary.scope, incoming, emittedChildrenByParent);
    const resultTopic = sheet.topics[summary.resultTopicId];
    if (!range || !resultTopic) {
      addExportDiagnostic(state, {
        code: 'xmind.summary-scope-preserved-only',
        disposition: 'preserved',
        message: 'A summary that XMind ranges cannot express was retained in metadata fallback.',
        path: `/sheets/${sheetIndex}/summaries/${summary.id}`,
        severity: 'warning',
      });
      continue;
    }
    const raw = xmindRawFromExtension(summary, XMIND_RAW_SEMANTIC_EXTENSION_KEY);
    const item: JsonRecord = {
      ...raw,
      class: 'summary',
      id: summary.id,
      range: `(${range.first},${range.last})`,
      topicId: resultTopic.id,
    };
    const items = summariesByParent.get(range.parentTopicId) ?? [];
    items.push(item);
    summariesByParent.set(range.parentTopicId, items);
    const topics = summaryTopicsByParent.get(range.parentTopicId) ?? [];
    if (!topics.includes(resultTopic.id)) topics.push(resultTopic.id);
    summaryTopicsByParent.set(range.parentTopicId, topics);
  }

  const notesByTopic = new Map<TopicId, Note[]>();
  for (const note of Object.values(sheet.notes).sort((left, right) =>
    left.id.localeCompare(right.id, 'en-US'))) {
    const notes = notesByTopic.get(note.topicId) ?? [];
    notes.push(note);
    notesByTopic.set(note.topicId, notes);
  }
  const linksByTopic = new Map<TopicId, TopicLink[]>();
  for (const link of Object.values(sheet.links).sort(compareMindMapViewOrderedEntities)) {
    const links = linksByTopic.get(link.topicId) ?? [];
    links.push(link);
    linksByTopic.set(link.topicId, links);
  }
  const nativeImageByTopic = new Map<TopicId, JsonRecord>();
  for (const image of Object.values(sheet.images).sort(compareMindMapViewOrderedEntities)) {
    const native = nativeImages.get(image.id);
    if (native && !nativeImageByTopic.has(image.topicId)) {
      nativeImageByTopic.set(image.topicId, native.rawImage);
    }
  }
  const markersByTopic = new Map<TopicId, JsonRecord[]>();
  for (const instance of Object.values(sheet.markerInstances).sort(compareMindMapViewOrderedEntities)) {
    const definition = document.markerDefinitions[instance.markerDefinitionId];
    const group = definition ? document.markerGroups[definition.groupId] : undefined;
    const nativeReference = nativeXMindMarkerReference(group, definition);
    if (!nativeReference) {
      const asset = definition?.source.kind === 'asset';
      const custom = !asset && group?.kind === 'custom';
      addExportDiagnostic(state, {
        code: asset
          ? 'xmind.asset-marker-preserved-only'
          : custom
            ? 'xmind.custom-marker-preserved-only'
            : 'xmind.marker-reference-preserved-only',
        disposition: 'preserved',
        message: asset
          ? 'An asset-backed marker was retained losslessly in canonical fallback and was not misrepresented as an XMind built-in marker.'
          : custom
            ? 'A custom marker was retained losslessly in canonical fallback and was not misrepresented as an XMind built-in marker.'
            : 'A marker without a complete XMind-native reference was retained losslessly in canonical fallback.',
        path: `/sheets/${sheetIndex}/markerInstances/${instance.id}`,
        severity: 'warning',
      });
      continue;
    }
    const marker: JsonRecord = nativeReference;
    const markers = markersByTopic.get(instance.topicId) ?? [];
    markers.push(marker);
    markersByTopic.set(instance.topicId, markers);
  }
  for (const todo of Object.values(sheet.todos).sort((left, right) =>
    left.id.localeCompare(right.id, 'en-US'))) {
    const markers = markersByTopic.get(todo.topicId) ?? [];
    const markerId = todo.completed ? 'task-done' : 'task-start';
    if (!markers.some((marker) => marker.markerId === markerId)) {
      markers.push({ groupId: 'task', markerId });
    }
    markersByTopic.set(todo.topicId, markers);
  }

  const visited = new Set<TopicId>();
  const createTopic = (topic: Topic, incomingEdge?: TreeEdge): JsonRecord => {
    visited.add(topic.id);
    state.exportedTopics += 1;
    const raw = xmindRawFromExtension(topic, XMIND_RAW_TOPIC_EXTENSION_KEY);
    const additions: Array<{ content: unknown; provider: string }> = [
      { content: topic.title, provider: NMDD_RICH_TEXT_PROVIDER },
    ];
    if (incomingEdge) {
      additions.push({ content: { side: incomingEdge.side }, provider: NMDD_BRANCH_SIDE_PROVIDER });
    }
    const result: JsonRecord = {
      ...raw,
      class: 'topic',
      id: topic.id,
      title: mindMapRichTextToPlainText(topic.title),
      titleUnedited: false,
      extensions: extensionArrayWith(raw.extensions, additions),
    };
    // Never replay an imported raw reference unless this export also contains
    // the validated bytes at the referenced package path.
    delete result.image;
    const nativeImage = nativeImageByTopic.get(topic.id);
    if (nativeImage) result.image = copyJsonValue(nativeImage);
    const style = xmindStyleFromTopic(topic);
    if (style) result.style = style;
    if (topic.branchLayout) result.structureClass = canonicalStructureToXMind(topic.branchLayout);
    if (topic.defaultCollapsed) result.branch = 'folded';
    if (topic.placement.mode === 'absolute') {
      result.position = { x: topic.placement.x, y: topic.placement.y };
    } else if (topic.placement.mode === 'offset') {
      result.position = { x: topic.placement.dx, y: topic.placement.dy };
    }
    if (topic.sizing.width.mode === 'fixed') result.width = topic.sizing.width.value;
    if (topic.labels && topic.labels.length > 0) result.labels = [...topic.labels];
    const notes = notesByTopic.get(topic.id) ?? [];
    if (notes.length > 0) {
      const noteText = notes.map((note) => mindMapRichTextToPlainText(note.content)).join('\n\n');
      result.notes = { plain: { content: noteText } };
      if (notes.length > 1) {
        addExportDiagnostic(state, {
          code: 'xmind.multiple-notes-combined',
          count: notes.length - 1,
          disposition: 'degraded',
          message: 'Multiple canonical notes on one topic were combined with blank lines for XMind.',
          path: `/sheets/${sheetIndex}/topics/${topic.id}/notes`,
          severity: 'warning',
        });
      }
    }
    const links = linksByTopic.get(topic.id) ?? [];
    const representable = links
      .map((link) => ({ href: xmindHrefForLink(link, sheet), link }))
      .filter((item): item is { href: string; link: TopicLink } => item.href !== null);
    if (representable[0]) result.href = representable[0].href;
    if (links.length > 1 || representable.length !== links.length) {
      result.extensions = extensionArrayWith(result.extensions, [{
        content: links,
        provider: 'app.nmdd.topic-links',
      }]);
      addExportDiagnostic(state, {
        code: 'xmind.links-preserved-in-extension',
        count: Math.max(1, links.length - 1),
        disposition: 'preserved',
        message: 'Links beyond XMind’s single native href slot were retained in an NMDD extension.',
        path: `/sheets/${sheetIndex}/topics/${topic.id}/links`,
        severity: 'info',
      });
    }
    const markers = markersByTopic.get(topic.id);
    if (markers && markers.length > 0) result.markers = markers;
    const boundaries = boundariesByParent.get(topic.id);
    if (boundaries && boundaries.length > 0) result.boundaries = boundaries;
    else delete result.boundaries;
    const summaries = summariesByParent.get(topic.id);
    if (summaries && summaries.length > 0) result.summaries = summaries;
    else delete result.summaries;

    const attached = (childrenByParent.get(topic.id) ?? [])
      .filter((edge) => !summaryResultIds.has(edge.childTopicId))
      .map((edge) => {
        const child = sheet.topics[edge.childTopicId];
        return child ? createTopic(child, edge) : null;
      })
      .filter((child): child is JsonRecord => child !== null);
    const summaryChildren = (summaryTopicsByParent.get(topic.id) ?? [])
      .map((topicId) => sheet.topics[topicId])
      .filter((candidate): candidate is Topic => Boolean(candidate))
      .filter((candidate) => !visited.has(candidate.id))
      .map((candidate) => createTopic(candidate));
    if (attached.length > 0 || summaryChildren.length > 0) {
      result.children = {
        ...(attached.length === 0 ? {} : { attached }),
        ...(summaryChildren.length === 0 ? {} : { summary: summaryChildren }),
      };
    } else {
      delete result.children;
    }
    return result;
  };

  const root = sheet.topics[sheet.rootTopicId];
  const rootTopic = createTopic(root);
  rootTopic.structureClass = canonicalStructureToXMind(sheet.defaultBranchLayout);
  const rootEdges = (childrenByParent.get(root.id) ?? [])
    .filter((edge) => !summaryResultIds.has(edge.childTopicId));
  const nativeSides = rootEdges.filter((edge) => edge.side === 'left' || edge.side === 'right');
  const rightCount = nativeSides.filter((edge) => edge.side === 'right').length;
  const firstLeft = nativeSides.findIndex((edge) => edge.side === 'left');
  const hasRightAfterLeft = firstLeft >= 0
    && nativeSides.slice(firstLeft + 1).some((edge) => edge.side === 'right');
  if (nativeSides.some((edge) => edge.side === 'left') && rightCount > 0) {
    rootTopic.extensions = extensionArrayWith(rootTopic.extensions, [{
      content: { 'right-number': rightCount },
      provider: 'org.xmind.ui.map.unbalanced',
    }]);
    if (hasRightAfterLeft) {
      addExportDiagnostic(state, {
        code: 'xmind.interleaved-root-sides-extension',
        disposition: 'preserved',
        message: 'Interleaved left/right root branches exceed XMind’s native right-number model; exact sides remain in per-topic NMDD extensions.',
        path: `/sheets/${sheetIndex}/topics/${root.id}/children`,
        severity: 'warning',
      });
    }
  }
  const nativelyEmittedSummaryResultIds = new Set(
    [...summaryTopicsByParent.values()].flat(),
  );
  const detached = Object.values(sheet.topics)
    .filter((topic) =>
      topic.id !== root.id
      && !incoming.has(topic.id)
      && !nativelyEmittedSummaryResultIds.has(topic.id))
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
    .filter((topic) => !visited.has(topic.id))
    .map((topic) => {
      const result = createTopic(topic);
      if (topic.role === 'summary-result' && !isRecord(result.position)) {
        result.position = { x: 0, y: 0 };
      }
      return result;
    });
  if (detached.length > 0) {
    const children = isRecord(rootTopic.children) ? rootTopic.children : {};
    rootTopic.children = { ...children, detached };
  }

  for (const topic of Object.values(sheet.topics)) {
    if (!visited.has(topic.id)) {
      addExportDiagnostic(state, {
        code: 'xmind.unreachable-topic-preserved-only',
        disposition: 'preserved',
        message: 'An unreachable canonical topic was retained in metadata fallback.',
        path: `/sheets/${sheetIndex}/topics/${topic.id}`,
        severity: 'warning',
      });
    }
  }

  const relationships = Object.values(sheet.relationships)
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
    .flatMap((relationship): JsonRecord[] => {
      if (
        relationship.source.element.kind !== 'topic'
        || relationship.target.element.kind !== 'topic'
      ) {
        addExportDiagnostic(state, {
          code: 'xmind.non-topic-relationship-preserved-only',
          disposition: 'preserved',
          message: 'A relationship whose endpoint is not a topic was retained in metadata fallback.',
          path: `/sheets/${sheetIndex}/relationships/${relationship.id}`,
          severity: 'warning',
        });
        return [];
      }
      const raw = xmindRawFromExtension(relationship, XMIND_RAW_SEMANTIC_EXTENSION_KEY);
      const points = relationship.controlPoints
        ? Object.values(relationship.controlPoints).sort(compareMindMapViewOrderedEntities)
        : [];
      const controlPoints: JsonRecord = {};
      points.forEach((point, index) => {
        controlPoints[String(index)] = { x: point.x, y: point.y };
      });
      return [{
        ...raw,
        class: 'relationship',
        controlPoints,
        end1Id: relationship.source.element.topicId,
        end2Id: relationship.target.element.topicId,
        id: relationship.id,
        ...(relationship.title === undefined
          ? {}
          : { title: mindMapRichTextToPlainText(relationship.title), titleUnedited: false }),
      }];
    });

  const rawSheet = xmindRawFromExtension(sheet, XMIND_RAW_SHEET_EXTENSION_KEY);
  return {
    ...rawSheet,
    class: 'sheet',
    id: sheet.id,
    relationships,
    rootTopic,
    title: sheet.title,
    topicOverlapping: sheet.advancedLayout.allowTopicOverlap ? 'overlap' : 'none',
    topicPositioning: sheet.defaultBranchLayout.mode === 'manual' ? 'fixed' : 'loose',
  };
}

function projectDocumentToXMindContent(
  document: MindMapDocumentV1,
  state: MutableExportReport,
  nativeImages: ReadonlyMap<ImageId, NativeImageResource> = new Map(),
): JsonRecord[] {
  const orderedSheets = getMindMapSheetsInViewOrder(document);
  const sheets = orderedSheets.map((sheet, index) =>
    exportSheetToXMind(document, sheet, state, index, nativeImages));
  state.exportedSheets = sheets.length;
  return sheets;
}

/**
 * Produces a deterministic XMind ZIP. Native fields are emitted for hierarchy,
 * structures and common topic semantics; unsupported canonical data is kept in
 * metadata.json and surfaced in the export report.
 */
export function exportXMind(
  document: MindMapDocumentV1,
  options: XMindExportOptions = {},
): XMindExportResult {
  const state: MutableExportReport = {
    degradedItems: 0,
    diagnostics: [],
    exportedSheets: 0,
    exportedTopics: 0,
    preservedAttributes: 0,
  };
  const validation = validateMindMapDocument(document);
  if (!validation.valid) {
    addExportDiagnostic(state, {
      code: 'xmind.source-document-invalid',
      disposition: 'rejected',
      message: validation.issues.slice(0, 8).map((issue) => `${issue.code}@${issue.path}`).join(', '),
      severity: 'error',
    });
    return { bytes: null, report: buildExportReport(state, false) };
  }

  const nativeResources = prepareNativeImageResources(document, options, state);
  const sheets = projectDocumentToXMindContent(document, state, nativeResources.images);

  const assetCount = Object.keys(document.assets).length;
  const resourceManifest = document.extensions?.[XMIND_RESOURCE_MANIFEST_EXTENSION_KEY];
  const unavailableAssetCount = Math.max(
    0,
    assetCount - nativeResources.packagedPathByAsset.size,
  );
  if (unavailableAssetCount > 0 || Array.isArray(resourceManifest)) {
    addExportDiagnostic(state, {
      code: 'xmind.resource-bytes-unavailable',
      count: Math.max(
        unavailableAssetCount,
        Array.isArray(resourceManifest) ? resourceManifest.length : 0,
        1,
      ),
      disposition: 'degraded',
      message: 'Canonical asset metadata was retained or safely redacted, but bytes unavailable to the pure codec were not fabricated into the ZIP.',
      path: '/metadata.json/nmdd/canonicalFallback/assets',
      severity: 'warning',
    });
  }
  const unsupportedCount = Object.values(document.sheets).reduce((total, sheet) => total
    + Object.keys(sheet.callouts).length
    + Object.keys(sheet.zones).length
    + Object.keys(sheet.attachments).length
    + Object.values(sheet.images).filter((image) => !nativeResources.images.has(image.id)).length
    + Object.keys(sheet.equations).length
    + Object.keys(sheet.audioClips).length
    + Object.keys(sheet.tasks).length
    + Object.keys(sheet.taskDependencies).length, 0)
    + Object.keys(document.presentations).length
    + Object.keys(document.savedViews).length;
  const stickerCount = Object.values(document.sheets).reduce(
    (total, sheet) => total
      + Object.values(sheet.images).filter((image) => image.role === 'sticker').length,
    0,
  );
  if (stickerCount > 0) {
    addExportDiagnostic(state, {
      code: 'xmind.sticker-preserved-in-fallback',
      count: stickerCount,
      disposition: 'preserved',
      message: 'Sticker/Illustration placement and role were retained in the integrity-bound canonical fallback; packaged raster bytes keep NMDD round trips lossless, while content.json has no verified native Sticker mapping yet.',
      path: '/metadata.json/nmdd/canonicalFallback/sheets',
      severity: 'info',
    });
  }
  if (unsupportedCount > 0) {
    addExportDiagnostic(state, {
      code: 'xmind.canonical-features-in-metadata',
      count: unsupportedCount,
      disposition: 'preserved',
      message: 'Canonical features without a stable XMind content.json equivalent were retained in metadata.json canonicalFallback.',
      path: '/metadata.json/nmdd/canonicalFallback',
      severity: 'info',
    });
  }
  const richTextFallbackCount = Object.values(document.sheets).reduce((total, sheet) => {
    const topicTitles = Object.values(sheet.topics)
      .filter((topic) => hasNonPlainRichText(topic.title)).length;
    const noteContents = Object.values(sheet.notes)
      .filter((note) => hasNonPlainRichText(note.content)).length;
    const relationshipTitles = Object.values(sheet.relationships)
      .filter((relationship) => relationship.title && hasNonPlainRichText(relationship.title)).length;
    const boundaryTitles = Object.values(sheet.boundaries)
      .filter((boundary) => boundary.title && hasNonPlainRichText(boundary.title)).length;
    const calloutContents = Object.values(sheet.callouts)
      .filter((callout) => hasNonPlainRichText(callout.content)).length;
    return total
      + topicTitles
      + noteContents
      + relationshipTitles
      + boundaryTitles
      + calloutContents;
  }, 0);
  if (richTextFallbackCount > 0) {
    addExportDiagnostic(state, {
      code: 'xmind.rich-text-preserved-in-extension',
      count: richTextFallbackCount,
      disposition: 'preserved',
      message: 'Rich-text marks were flattened for native XMind titles/notes and preserved losslessly in NMDD extensions or canonicalFallback metadata.',
      path: '/metadata.json/nmdd/canonicalFallback/sheets',
      severity: 'info',
    });
  }

  const canonicalFallbackExport = createCanonicalFallback(
    document,
    nativeResources.packagedPathByAsset,
  );
  const canonicalFallback = canonicalFallbackExport.fallback;
  if (canonicalFallbackExport.redactedSensitiveSources > 0) {
    addExportDiagnostic(state, {
      code: 'xmind.sensitive-resource-source-redacted',
      count: canonicalFallbackExport.redactedSensitiveSources,
      disposition: 'degraded',
      message: 'Managed object keys, recognized signed remote credentials, and unsafe raw topic-image sources were redacted from the package fallback; that fallback is intentionally non-restorable.',
      path: '/metadata.json/nmdd/canonicalFallback/assets',
      severity: 'warning',
    });
  }
  const nativeImageResources = Object.fromEntries(
    [...nativeResources.images.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([imageId, resource]) => [imageId, resource.packagePath]),
  );
  const packagedImageAssets = Object.fromEntries(
    [...nativeResources.packagedPathByAsset.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en-US')),
  );
  const metadata = copyJsonValue({
    creator: { name: 'NMDD MindMap' },
    nmdd: {
      canonicalFallback,
      canonicalFallbackRestorable: canonicalFallbackExport.redactedSensitiveSources === 0,
      canonicalFallbackSha256: stableJsonHash(canonicalFallback),
      contentIdentitySha256: xmindContentIdentityHash(sheets),
      contentRevision: document.contentRevision,
      documentTitle: document.title,
      documentId: document.id,
      fallbackEnvelopeVersion: 1,
      nativeImageResources,
      packagedImageAssets,
      schema: document.schema,
      schemaVersion: document.schemaVersion,
    },
  });
  const imageManifestEntries = Object.fromEntries(
    Object.keys(nativeResources.files).sort().map((path) => [path, {}]),
  );
  const manifest = {
    'file-entries': {
      'content.json': {},
      'metadata.json': {},
      ...imageManifestEntries,
    },
  };
  const encoder = new TextEncoder();
  const bytes = createDeterministicXMindZip({
    'content.json': encoder.encode(JSON.stringify(sheets)),
    'manifest.json': encoder.encode(JSON.stringify(manifest)),
    'metadata.json': encoder.encode(JSON.stringify(metadata)),
    ...nativeResources.files,
  });
  return { bytes, report: buildExportReport(state, true) };
}

export const exportMindMapToXMind = exportXMind;

export {
  DEFAULT_XMIND_ZIP_SECURITY_LIMITS,
  type XMindZipSecurityLimits,
} from './xmindZip';
