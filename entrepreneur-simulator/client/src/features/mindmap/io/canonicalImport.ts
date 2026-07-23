import {
  createMindMapSheet,
  createNewMindMapDocument,
  createTopic,
} from '../domain/defaults';
import { createUuidV7 } from '../domain/ids';
import { rebalanceOrderKeys } from '../domain/orderKey';
import type {
  DocumentId,
  MindMapDocumentV1,
  MindMapSheet,
  OrderKey,
  SheetId,
  ThemeId,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import type { MindMapImportReportBuilder } from './report';
import { resolveMindMapImportLimits } from './limits';
import type {
  MindMapImportEntityKind,
  MindMapImportOptions,
  NormalizedOutlineDocument,
  NormalizedOutlineNode,
  NormalizedOutlineSheet,
} from './types';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface PreparedNode {
  readonly children: PreparedNode[];
  readonly id: TopicId;
  readonly input: NormalizedOutlineNode;
}

interface PreparedSheet {
  readonly id: SheetId;
  readonly input: NormalizedOutlineSheet;
  readonly root: PreparedNode;
}

function codePointSlice(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

function sanitizePlainTitle(
  value: string,
  maximum: number,
  path: string,
  report: MindMapImportReportBuilder,
): string {
  let result = value;
  if (/\0/.test(result)) {
    result = result.replace(/\0/g, '\ufffd');
    report.add({
      code: 'outline.nul-replaced',
      disposition: 'degraded',
      message: 'NUL characters were replaced with U+FFFD plain text.',
      path,
      severity: 'warning',
    });
  }
  if (Array.from(result).length > maximum) {
    result = codePointSlice(result, maximum);
    report.add({
      code: 'outline.title-truncated',
      disposition: 'degraded',
      message: `Title exceeded ${maximum} Unicode code points and was truncated.`,
      path,
      severity: 'warning',
    });
  }
  return result;
}

function normalizeSheetRoots(
  outline: NormalizedOutlineDocument,
  sheet: NormalizedOutlineSheet,
  sheetIndex: number,
  report: MindMapImportReportBuilder,
): NormalizedOutlineNode {
  if (sheet.roots.length === 1) return sheet.roots[0];

  const fallbackTitle = sheet.title || outline.title || `Sheet ${sheetIndex + 1}`;
  if (sheet.roots.length === 0) {
    report.add({
      code: 'outline.empty-sheet-root-created',
      disposition: 'degraded',
      message: 'The empty sheet received a central topic created from its title.',
      path: `/sheets/${sheetIndex}`,
      severity: 'warning',
    });
    return { children: [], title: fallbackTitle };
  }

  report.add({
    code: 'outline.multiple-roots-wrapped',
    disposition: 'degraded',
    message: 'Multiple top-level outline nodes were wrapped by one central topic.',
    path: `/sheets/${sheetIndex}/roots`,
    severity: 'warning',
  });
  return { children: [...sheet.roots], title: fallbackTitle };
}

function inspectOutlineLimits(
  roots: readonly NormalizedOutlineNode[],
  maxNodes: number,
  maxDepth: number,
  report: MindMapImportReportBuilder,
): boolean {
  let count = 0;
  const stack = roots.map((node) => ({ depth: 0, node }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    count += 1;
    if (count > maxNodes) {
      report.add({
        code: 'outline.node-limit',
        disposition: 'rejected',
        message: `Outline exceeds the ${maxNodes} node import limit.`,
        severity: 'error',
      });
      return false;
    }
    if (current.depth > maxDepth) {
      report.add({
        code: 'outline.depth-limit',
        disposition: 'rejected',
        message: `Outline exceeds the ${maxDepth} level import limit.`,
        severity: 'error',
      });
      return false;
    }
    for (const child of current.node.children) {
      stack.push({ depth: current.depth + 1, node: child });
    }
  }
  return true;
}

export function buildCanonicalDocumentFromOutline(
  outline: NormalizedOutlineDocument,
  options: MindMapImportOptions,
  report: MindMapImportReportBuilder,
): MindMapDocumentV1 | null {
  const limits = resolveMindMapImportLimits(options.limits);
  if (outline.sheets.length === 0) {
    report.add({
      code: 'outline.no-sheets',
      disposition: 'rejected',
      message: 'No importable sheet was found.',
      severity: 'error',
    });
    return null;
  }

  const normalizedRoots = outline.sheets.map((sheet, index) =>
    normalizeSheetRoots(outline, sheet, index, report));
  if (!inspectOutlineLimits(normalizedRoots, limits.maxNodes, limits.maxDepth, report)) {
    return null;
  }

  const idFactory = options.idFactory ?? (() => createUuidV7());
  const allocatedIds = new Set<string>();
  const nextId = <Kind extends string>(
    entityKind: MindMapImportEntityKind,
  ): import('../domain/types').Id<Kind> | null => {
    const value = idFactory(entityKind);
    if (!UUID_V7_PATTERN.test(value)) {
      report.add({
        code: 'outline.id-factory-invalid',
        disposition: 'rejected',
        message: `idFactory returned a non-UUIDv7 value for ${entityKind}.`,
        severity: 'error',
      });
      return null;
    }
    if (allocatedIds.has(value)) {
      report.add({
        code: 'outline.id-factory-duplicate',
        disposition: 'rejected',
        message: `idFactory returned a duplicate value for ${entityKind}.`,
        severity: 'error',
      });
      return null;
    }
    allocatedIds.add(value);
    return value as import('../domain/types').Id<Kind>;
  };

  const documentId = nextId<'Document'>('document') as DocumentId | null;
  const themeId = nextId<'Theme'>('theme') as ThemeId | null;
  if (!documentId || !themeId) return null;

  const prepareNode = (node: NormalizedOutlineNode): PreparedNode | null => {
    const id = nextId<'Topic'>('topic') as TopicId | null;
    if (!id) return null;
    const children: PreparedNode[] = [];
    for (const child of node.children) {
      const prepared = prepareNode(child);
      if (!prepared) return null;
      children.push(prepared);
    }
    return { children, id, input: node };
  };

  const preparedSheets: PreparedSheet[] = [];
  for (let index = 0; index < outline.sheets.length; index += 1) {
    const id = nextId<'Sheet'>('sheet') as SheetId | null;
    const root = prepareNode(normalizedRoots[index]);
    if (!id || !root) return null;
    preparedSheets.push({ id, input: outline.sheets[index], root });
  }

  const sheetOrderKeys = rebalanceOrderKeys(preparedSheets.map((sheet) => sheet.id));
  const documentTitle = sanitizePlainTitle(
    outline.title,
    limits.maxTitleLength,
    '/title',
    report,
  );
  const firstPrepared = preparedSheets[0];
  const firstSheetTitle = sanitizePlainTitle(
    firstPrepared.input.title,
    limits.maxTitleLength,
    '/sheets/0/title',
    report,
  );
  const firstRootTitle = sanitizePlainTitle(
    firstPrepared.root.input.title,
    limits.maxTitleLength,
    '/sheets/0/roots/0/title',
    report,
  );
  const document = createNewMindMapDocument({
    documentId,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    rootTitle: firstRootTitle,
    rootTopicId: firstPrepared.root.id,
    sheetId: firstPrepared.id,
    sheetOrderKey: sheetOrderKeys[firstPrepared.id],
    sheetTitle: firstSheetTitle,
    themeId,
    title: documentTitle,
  });
  if (outline.extensions !== undefined) {
    document.extensions = { ...outline.extensions };
  }

  const populateSheet = (
    sheet: MindMapSheet,
    prepared: PreparedSheet,
    sheetIndex: number,
  ): void => {
    if (prepared.input.extensions !== undefined) {
      sheet.extensions = { ...prepared.input.extensions };
    }
    const rootTopic = sheet.topics[prepared.root.id];
    if (prepared.root.input.extensions !== undefined) {
      rootTopic.extensions = { ...prepared.root.input.extensions };
    }

    const stack: Array<{
      depth: number;
      node: PreparedNode;
      path: string;
    }> = [{ depth: 0, node: prepared.root, path: `/sheets/${sheetIndex}/roots/0` }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      const edgeIds: TreeEdgeId[] = [];
      for (let childIndex = 0; childIndex < current.node.children.length; childIndex += 1) {
        const edgeId = nextId<'TreeEdge'>('tree-edge') as TreeEdgeId | null;
        if (!edgeId) return;
        edgeIds.push(edgeId);
      }
      const edgeOrderKeys = rebalanceOrderKeys(edgeIds);

      for (let childIndex = 0; childIndex < current.node.children.length; childIndex += 1) {
        const child = current.node.children[childIndex];
        const childPath = `${current.path}/children/${childIndex}`;
        const topic = createTopic({
          id: child.id,
          title: sanitizePlainTitle(
            child.input.title,
            limits.maxTitleLength,
            `${childPath}/title`,
            report,
          ),
        });
        if (child.input.extensions !== undefined) {
          topic.extensions = { ...child.input.extensions };
        }
        sheet.topics[child.id] = topic;
        const edgeId = edgeIds[childIndex];
        const edge: TreeEdge = {
          childTopicId: child.id,
          id: edgeId,
          orderKey: edgeOrderKeys[edgeId] as OrderKey,
          parentTopicId: current.node.id,
          side: current.depth === 0 ? 'right' : 'inherit',
        };
        sheet.treeEdges[edgeId] = edge;
        stack.push({ depth: current.depth + 1, node: child, path: childPath });
      }
    }
  };

  populateSheet(document.sheets[firstPrepared.id], firstPrepared, 0);
  if (report.hasErrors()) return null;

  for (let index = 1; index < preparedSheets.length; index += 1) {
    const prepared = preparedSheets[index];
    const sheet = createMindMapSheet({
      id: prepared.id,
      orderKey: sheetOrderKeys[prepared.id],
      rootTitle: sanitizePlainTitle(
        prepared.root.input.title,
        limits.maxTitleLength,
        `/sheets/${index}/roots/0/title`,
        report,
      ),
      rootTopicId: prepared.root.id,
      themeId,
      title: sanitizePlainTitle(
        prepared.input.title,
        limits.maxTitleLength,
        `/sheets/${index}/title`,
        report,
      ),
    });
    populateSheet(sheet, prepared, index);
    if (report.hasErrors()) return null;
    document.sheets[prepared.id] = sheet;
  }

  const validation = validateMindMapDocument(document);
  if (!validation.valid) {
    report.add({
      code: 'outline.canonical-validation-failed',
      disposition: 'rejected',
      message: validation.issues
        .slice(0, 5)
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', '),
      severity: 'error',
    });
    return null;
  }

  report.setImportedCounts(
    Object.keys(document.sheets).length,
    Object.values(document.sheets)
      .reduce((total, sheet) => total + Object.keys(sheet.topics).length, 0),
  );
  return document;
}
