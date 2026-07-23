import type {
  LinkId,
  MindMapDocumentV1,
  MindMapSheet,
  NoteId,
  RichText,
  TopicId,
  TopicLink,
} from '../domain/types';
import { createUuidV7 } from '../domain/ids';
import { rebalanceOrderKeys } from '../domain/orderKey';
import { validateMindMapDocument } from '../domain/validation';
import { compareMindMapViewOrderedEntities } from '../view/ordering';
import { mindMapRichTextToPlainText } from '../view/text';
import { buildCanonicalDocumentFromOutline } from './canonicalImport';
import { resolveMindMapImportLimits, utf8ByteLength } from './limits';
import { projectMindMapToNormalizedOutline } from './normalizedOutline';
import { MindMapImportReportBuilder } from './report';
import type {
  MindMapImportOptions,
  MindMapImportResult,
  NormalizedOutlineNode,
  NormalizedOutlineSheet,
} from './types';

interface MutableOutlineNode {
  title: string;
  children: MutableOutlineNode[];
  metadata?: ParsedTopicMetadata;
  sourceOrder: number;
}

interface MutableOutlineSheet {
  title: string;
  roots: MutableOutlineNode[];
}

const MARKDOWN_SPECIAL = /[`*_[\]<>#]/g;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MARKDOWN_METADATA_EXTENSION_KEY = 'io.markdown.parsed-metadata';

interface ParsedMarkdownLink {
  readonly href: string;
  readonly title?: string;
}

interface ParsedTopicMetadata {
  links: ParsedMarkdownLink[];
  noteLines?: string[];
  readonly sourceOrder: number;
}

interface ActiveMarkdownNote {
  readonly indent: number;
  readonly node: MutableOutlineNode;
  readonly lines: string[];
}

function escapeMarkdownOutlineText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(MARKDOWN_SPECIAL, '\\$&');
}

function unescapeMarkdownOutlineText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\' || index + 1 >= value.length) {
      result += character;
      continue;
    }
    const next = value[index + 1];
    if (next === 'n') result += '\n';
    else if (next === 'r') result += '\r';
    else if (next === 't') result += '\t';
    else if ('\\`*_[]<>#'.includes(next)) result += next;
    else {
      result += `\\${next}`;
    }
    index += 1;
  }
  return result;
}

function indentationWidth(value: string): number {
  let width = 0;
  for (const character of value) width += character === '\t' ? 2 : 1;
  return width;
}

const markdownLinkDestination = (href: string): string | undefined => {
  const value = href.trim();
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)) return undefined;
  try {
    if (/^mailto:/i.test(value)) {
      const address = value.slice('mailto:'.length).split('?')[0];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) return undefined;
    } else {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    }
    return encodeURI(value)
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E');
  } catch {
    return undefined;
  }
};

function metadataForNode(node: MutableOutlineNode): ParsedTopicMetadata {
  if (!node.metadata) node.metadata = { links: [], sourceOrder: node.sourceOrder };
  return node.metadata;
}

function toNormalizedOutlineNode(node: MutableOutlineNode): NormalizedOutlineNode {
  return {
    children: node.children.map(toNormalizedOutlineNode),
    ...(node.metadata === undefined
      ? {}
      : { extensions: { [MARKDOWN_METADATA_EXTENSION_KEY]: node.metadata } }),
    title: node.title,
  };
}

function noteLinesToRichText(lines: readonly string[]): RichText {
  return {
    blocks: lines.map((line) => ({
      children: line === '' ? [] : [{ text: line, type: 'text' as const }],
      type: 'paragraph' as const,
    })),
    type: 'doc',
    version: 1,
  };
}

function collectCanonicalEntityIds(document: MindMapDocumentV1): Set<string> {
  const ids = new Set<string>();
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (!Array.isArray(value)) {
      const candidate = (value as { id?: unknown }).id;
      if (typeof candidate === 'string') ids.add(candidate);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
  return ids;
}

function readAndRemoveParsedMetadata(
  document: MindMapDocumentV1,
): Array<{
  metadata: ParsedTopicMetadata;
  sheet: MindMapSheet;
  topicId: TopicId;
}> {
  const pending: Array<{
    metadata: ParsedTopicMetadata;
    sheet: MindMapSheet;
    topicId: TopicId;
  }> = [];
  for (const sheet of Object.values(document.sheets)) {
    for (const topic of Object.values(sheet.topics)) {
      const metadata = topic.extensions?.[MARKDOWN_METADATA_EXTENSION_KEY] as
        | ParsedTopicMetadata
        | undefined;
      if (metadata !== undefined) pending.push({ metadata, sheet, topicId: topic.id });
      if (topic.extensions && MARKDOWN_METADATA_EXTENSION_KEY in topic.extensions) {
        const extensions = { ...topic.extensions };
        delete extensions[MARKDOWN_METADATA_EXTENSION_KEY];
        if (Object.keys(extensions).length === 0) delete topic.extensions;
        else topic.extensions = extensions;
      }
    }
  }
  return pending.sort((left, right) => left.metadata.sourceOrder - right.metadata.sourceOrder);
}

function hydrateParsedMarkdownMetadata(
  document: MindMapDocumentV1,
  options: MindMapImportOptions,
  report: MindMapImportReportBuilder,
): boolean {
  const pending = readAndRemoveParsedMetadata(document);
  if (pending.length === 0) return true;

  const idFactory = options.idFactory ?? (() => createUuidV7());
  const allocatedIds = collectCanonicalEntityIds(document);
  const nextId = (kind: 'note' | 'link'): string | null => {
    const value = idFactory(kind);
    if (!UUID_V7_PATTERN.test(value)) {
      report.add({
        code: 'outline.id-factory-invalid',
        disposition: 'rejected',
        message: `idFactory returned a non-UUIDv7 value for ${kind}.`,
        severity: 'error',
      });
      return null;
    }
    if (allocatedIds.has(value)) {
      report.add({
        code: 'outline.id-factory-duplicate',
        disposition: 'rejected',
        message: `idFactory returned a duplicate value for ${kind}.`,
        severity: 'error',
      });
      return null;
    }
    allocatedIds.add(value);
    return value;
  };

  for (const { metadata, sheet, topicId } of pending) {
    if (metadata.noteLines !== undefined) {
      const noteId = nextId('note') as NoteId | null;
      if (!noteId) return false;
      sheet.notes[noteId] = {
        content: noteLinesToRichText(metadata.noteLines),
        id: noteId,
        topicId,
      };
    }

    const preparedLinks: Array<{ id: LinkId; link: ParsedMarkdownLink }> = [];
    for (const link of metadata.links) {
      const linkId = nextId('link') as LinkId | null;
      if (!linkId) return false;
      preparedLinks.push({ id: linkId, link });
    }
    const orderKeys = rebalanceOrderKeys(preparedLinks.map(({ id }) => id));
    for (const { id, link } of preparedLinks) {
      sheet.links[id] = {
        href: link.href,
        id,
        kind: /^mailto:/i.test(link.href) ? 'email' : 'web',
        orderKey: orderKeys[id],
        status: 'active',
        ...(link.title === undefined ? {} : { title: link.title }),
        topicId,
      };
    }
  }
  return true;
}

const readableLinkLabel = (
  document: MindMapDocumentV1,
  link: TopicLink,
): string => {
  if (link.title?.trim()) return link.title.trim();
  if (link.kind === 'web' || link.kind === 'email') return link.href;
  if (link.kind === 'file') return '本地文件（路径已省略）';
  if (link.kind === 'folder') return '本地文件夹（路径已省略）';
  if (link.kind === 'sheet') return document.sheets[link.targetSheetId]?.title ?? '缺失 Sheet';
  if (link.kind === 'topic') {
    const target = document.sheets[link.targetSheetId]?.topics[link.targetTopicId];
    return target ? mindMapRichTextToPlainText(target.title) || '未命名主题' : '缺失主题';
  }
  return '文档页面';
};

const topicMetadataLines = (
  document: MindMapDocumentV1,
  sheet: MindMapSheet,
  topicId: TopicId,
  depth: number,
): string[] => {
  const indentation = '  '.repeat(depth + 1);
  const lines: string[] = [];
  const note = Object.values(sheet.notes).find((candidate) => candidate.topicId === topicId);
  if (note) {
    const noteLines = mindMapRichTextToPlainText(note.content).replace(/\r\n?/g, '\n').split('\n');
    const firstLine = noteLines.shift() ?? '';
    lines.push(`${indentation}> **Note:** ${escapeMarkdownOutlineText(firstLine)}`);
    for (const line of noteLines) {
      lines.push(`${indentation}> ${escapeMarkdownOutlineText(line)}`);
    }
  }

  const links = Object.values(sheet.links)
    .filter((link) => link.topicId === topicId)
    .sort(compareMindMapViewOrderedEntities);
  for (const link of links) {
    const label = escapeMarkdownOutlineText(readableLinkLabel(document, link));
    const destination = (link.kind === 'web' || link.kind === 'email') && link.status === 'active'
      ? markdownLinkDestination(link.href)
      : undefined;
    const kind = link.kind === 'topic'
      ? 'Topic link'
      : link.kind === 'sheet'
        ? 'Sheet link'
        : link.kind === 'document-page'
          ? 'Document link'
          : 'Link';
    const state = link.status === 'broken' ? ' (broken)' : '';
    lines.push(destination
      ? `${indentation}> **${kind}:** [${label}](${destination})`
      : `${indentation}> **${kind}${state}:** ${label}`);
  }
  return lines;
};

export function exportMindMapToMarkdown(document: MindMapDocumentV1): string {
  const outline = projectMindMapToNormalizedOutline(document);
  const lines = [`# ${escapeMarkdownOutlineText(outline.title)}`, ''];

  for (const sheet of outline.sheets) {
    lines.push(`## ${escapeMarkdownOutlineText(sheet.title)}`, '');
    const stack: Array<{ depth: number; node: NormalizedOutlineNode }> = [];
    for (let index = sheet.roots.length - 1; index >= 0; index -= 1) {
      stack.push({ depth: 0, node: sheet.roots[index] });
    }
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      lines.push(
        `${'  '.repeat(current.depth)}- ${escapeMarkdownOutlineText(current.node.title)}`,
      );
      const sourceTopicId = current.node.sourceTopicId;
      const sourceSheet = sheet.sourceSheetId
        ? document.sheets[sheet.sourceSheetId]
        : undefined;
      if (sourceTopicId && sourceSheet) {
        lines.push(...topicMetadataLines(document, sourceSheet, sourceTopicId, current.depth));
      }
      for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
        stack.push({ depth: current.depth + 1, node: current.node.children[index] });
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function importMindMapFromMarkdown(
  source: string,
  options: MindMapImportOptions = {},
): MindMapImportResult {
  const inputBytes = utf8ByteLength(source);
  const limits = resolveMindMapImportLimits(options.limits);
  const report = new MindMapImportReportBuilder('markdown-outline', inputBytes);
  if (inputBytes > limits.maxInputBytes) {
    report.add({
      code: 'markdown.input-limit',
      disposition: 'rejected',
      message: `Markdown input exceeds the ${limits.maxInputBytes} byte limit.`,
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  let documentTitle = 'Imported Markdown';
  const sheets: MutableOutlineSheet[] = [];
  let currentSheet: MutableOutlineSheet | undefined;
  let stack: Array<{ indent: number; node: MutableOutlineNode }> = [];
  let nodeCount = 0;
  let sawDocumentHeading = false;
  let reportedHtml = false;
  let reportedLink = false;
  let metadataTopic: { indent: number; node: MutableOutlineNode } | undefined;
  let activeNote: ActiveMarkdownNote | undefined;

  const ensureSheet = (): MutableOutlineSheet => {
    if (currentSheet) return currentSheet;
    currentSheet = { roots: [], title: `Sheet ${sheets.length + 1}` };
    sheets.push(currentSheet);
    stack = [];
    return currentSheet;
  };

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const path = `/lines/${lineIndex + 1}`;
    if (/^\s*$/.test(line)) {
      metadataTopic = undefined;
      activeNote = undefined;
      continue;
    }

    const blockquote = /^([ \t]*)> ?(.*)$/.exec(line);
    const alignedMetadataBlockquote = Boolean(
      blockquote
      && metadataTopic
      && indentationWidth(blockquote[1]) === metadataTopic.indent + 2,
    );
    if (blockquote && metadataTopic && alignedMetadataBlockquote) {
      const content = blockquote[2];
      const noteMarker = /^\*\*Note:\*\*(?: (.*))?$/.exec(content);
      if (noteMarker) {
        const metadata = metadataForNode(metadataTopic.node);
        if (metadata.noteLines !== undefined) {
          report.add({
            code: 'markdown.duplicate-note-metadata',
            disposition: 'ignored',
            message: 'Only the first Note metadata block for a topic was imported.',
            path,
            severity: 'warning',
          });
          activeNote = undefined;
        } else {
          const noteLines = [unescapeMarkdownOutlineText(noteMarker[1] ?? '')];
          metadata.noteLines = noteLines;
          activeNote = {
            indent: metadataTopic.indent + 2,
            lines: noteLines,
            node: metadataTopic.node,
          };
        }
        continue;
      }

      const linkMarker = /^\*\*Link:\*\* \[((?:\\.|[^\\\]])*)\]\(([^)\s]+)\)$/.exec(content);
      if (linkMarker) {
        activeNote = undefined;
        const href = markdownLinkDestination(linkMarker[2]);
        if (href !== undefined) {
          const label = unescapeMarkdownOutlineText(linkMarker[1]);
          const labelDestination = markdownLinkDestination(label);
          metadataForNode(metadataTopic.node).links.push({
            href,
            ...(labelDestination === href ? {} : { title: label }),
          });
          continue;
        }
      }

      const startsAnotherMetadataField = /^\*\*[^*\n]+:\*\*(?: |$)/.test(content);
      if (
        !startsAnotherMetadataField
        && activeNote
        && activeNote.node === metadataTopic.node
        && activeNote.indent === indentationWidth(blockquote[1])
      ) {
        activeNote.lines.push(unescapeMarkdownOutlineText(content));
        continue;
      }
    }
    activeNote = undefined;

    const documentHeading = /^#(?:\s+(.*))?$/.exec(line);
    if (documentHeading) {
      metadataTopic = undefined;
      if (!sawDocumentHeading && sheets.length === 0) {
        documentTitle = unescapeMarkdownOutlineText(documentHeading[1] ?? '');
        sawDocumentHeading = true;
      } else {
        report.add({
          code: 'markdown.extra-document-heading',
          disposition: 'ignored',
          message: 'Only the first level-one heading is used as the document title.',
          path,
          severity: 'warning',
        });
      }
      continue;
    }

    const sheetHeading = /^##(?:\s+(.*))?$/.exec(line);
    if (sheetHeading) {
      metadataTopic = undefined;
      currentSheet = {
        roots: [],
        title: unescapeMarkdownOutlineText(sheetHeading[1] ?? ''),
      };
      sheets.push(currentSheet);
      stack = [];
      continue;
    }

    const bullet = /^([ \t]*)(?:[-+*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const sheet = ensureSheet();
      const indent = indentationWidth(bullet[1]);
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      const depth = stack.length;
      if (depth > limits.maxDepth) {
        report.add({
          code: 'markdown.depth-limit',
          disposition: 'rejected',
          message: `Markdown outline exceeds the ${limits.maxDepth} level limit.`,
          path,
          severity: 'error',
        });
        return { document: null, report: report.build(false) };
      }
      nodeCount += 1;
      if (nodeCount > limits.maxNodes) {
        report.add({
          code: 'markdown.node-limit',
          disposition: 'rejected',
          message: `Markdown outline exceeds the ${limits.maxNodes} node limit.`,
          path,
          severity: 'error',
        });
        return { document: null, report: report.build(false) };
      }

      const title = unescapeMarkdownOutlineText(bullet[2]);
      if (!reportedHtml && /<\/?[a-z][^>]*>/i.test(title)) {
        reportedHtml = true;
        report.add({
          code: 'markdown.html-as-plain-text',
          disposition: 'degraded',
          message: 'HTML-like markup was imported only as inert topic text.',
          path,
          severity: 'warning',
        });
      }
      if (
        !reportedLink
        && /\]\(\s*(?:https?:|mailto:|javascript:|data:)/i.test(title)
      ) {
        reportedLink = true;
        report.add({
          code: 'markdown.link-as-plain-text',
          disposition: 'degraded',
          message: 'External Markdown links were not activated and remain plain text.',
          path,
          severity: 'warning',
        });
      }

      const node: MutableOutlineNode = { children: [], sourceOrder: nodeCount, title };
      const parent = stack[stack.length - 1]?.node;
      if (parent) parent.children.push(node);
      else sheet.roots.push(node);
      stack.push({ indent, node });
      metadataTopic = { indent, node };
      continue;
    }

    if (!alignedMetadataBlockquote) metadataTopic = undefined;
    report.add({
      code: /^\s*</.test(line) ? 'markdown.html-line-ignored' : 'markdown.line-ignored',
      disposition: 'ignored',
      message: 'Non-outline Markdown content was ignored.',
      path,
      severity: 'warning',
    });
  }

  if (nodeCount === 0) {
    report.add({
      code: 'markdown.no-outline',
      disposition: 'rejected',
      message: 'Markdown contains no importable outline items.',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const outline = {
    sheets: sheets.map((sheet): NormalizedOutlineSheet => ({
      roots: sheet.roots.map(toNormalizedOutlineNode),
      title: sheet.title,
    })),
    title: documentTitle,
  };
  const document = buildCanonicalDocumentFromOutline(outline, options, report);
  if (!document) return { document: null, report: report.build(false) };
  if (!hydrateParsedMarkdownMetadata(document, options, report)) {
    return { document: null, report: report.build(false) };
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
    return { document: null, report: report.build(false) };
  }
  return { document, report: report.build(!report.hasErrors()) };
}
