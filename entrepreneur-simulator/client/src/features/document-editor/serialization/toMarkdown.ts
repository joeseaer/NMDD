import type { DocumentMarkJson, DocumentNodeJson } from '../schema/documentSchema';
import {
  cleanJoinedBlocks,
  getNodeText,
  nodeChildren,
  normalizeSerializedFormula,
  normalizeSerializableInput,
  stringifyCellValue,
  type SerializableDocumentInput,
} from './serializationUtils';

interface MarkdownContext {
  listDepth: number;
}

const escapeMarkdownText = (value: string): string => (
  value.replace(/([\\`*_[\]~])/g, '\\$1')
);

const escapeTableCell = (value: string): string => (
  value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()
);

const destination = (value: unknown): string => {
  const url = String(value || '').trim().replace(/>/g, '%3E');
  return /[\s()]/.test(url) ? `<${url}>` : url;
};

const inlineCode = (value: string): string => {
  const longestRun = Math.max(0, ...(value.match(/`+/g) || []).map(run => run.length));
  const fence = '`'.repeat(Math.max(1, longestRun + 1));
  const padded = /^\s|\s$|^`|`$/.test(value) ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
};

const applyMarks = (text: string, marks: DocumentMarkJson[] | undefined): string => {
  if (!marks?.length) return escapeMarkdownText(text);
  const code = marks.find(mark => mark.type === 'code');
  let value = code ? inlineCode(text) : escapeMarkdownText(text);
  if (marks.some(mark => mark.type === 'bold')) value = `**${value}**`;
  if (marks.some(mark => mark.type === 'italic')) value = `*${value}*`;
  if (marks.some(mark => mark.type === 'strike')) value = `~~${value}~~`;
  const link = marks.find(mark => mark.type === 'link');
  if (link?.attrs?.href) value = `[${value}](${destination(link.attrs.href)})`;
  return value;
};

const inlineContent = (node: DocumentNodeJson, context: MarkdownContext): string => (
  nodeChildren(node).map(child => renderNode(child, context)).join('')
);

const indentLines = (value: string, spaces: number): string => {
  const indent = ' '.repeat(spaces);
  return value.split('\n').map((line, index) => index === 0 ? line : `${indent}${line}`).join('\n');
};

const renderListItem = (
  node: DocumentNodeJson,
  marker: string,
  context: MarkdownContext,
): string => {
  const children = nodeChildren(node);
  const first = children[0];
  const firstText = first?.type === 'paragraph'
    ? inlineContent(first, context)
    : first ? renderNode(first, context) : '';
  const continuation = children.slice(1).map(child => renderNode(child, {
    ...context,
    listDepth: context.listDepth + 1,
  })).filter(Boolean);
  const markerWidth = marker.length + 1;
  let rendered = `${marker} ${indentLines(firstText, markerWidth)}`;
  if (continuation.length) {
    rendered += `\n${continuation.map(value => indentLines(value, markerWidth)).join('\n')}`;
  }
  return rendered;
};

const renderList = (node: DocumentNodeJson, context: MarkdownContext, ordered: boolean): string => {
  const start = Number(node.attrs?.start || 1);
  return nodeChildren(node).map((item, index) => (
    renderListItem(item, ordered ? `${start + index}.` : '-', context)
  )).join('\n');
};

const renderTaskList = (node: DocumentNodeJson, context: MarkdownContext): string => (
  nodeChildren(node).map(item => {
    const checked = item.attrs?.checked === true || item.attrs?.checked === 'true';
    return renderListItem(item, `- [${checked ? 'x' : ' '}]`, context);
  }).join('\n')
);

const cellMarkdown = (cell: DocumentNodeJson): string => {
  const context = { listDepth: 0 };
  const content = nodeChildren(cell).map(child => renderNode(child, context)).join('<br>');
  return escapeTableCell(content);
};

const renderTable = (node: DocumentNodeJson): string => {
  const rows = nodeChildren(node).filter(row => row.type === 'tableRow');
  if (!rows.length) return '';
  const matrix = rows.map(row => nodeChildren(row).map(cellMarkdown));
  const width = Math.max(...matrix.map(row => row.length));
  const padded = matrix.map(row => [...row, ...Array.from({ length: width - row.length }, () => '')]);
  const [header, ...body] = padded;
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
};

const renderCodeBlock = (node: DocumentNodeJson): string => {
  const code = getNodeText(node).replace(/\n$/, '');
  const longestRun = Math.max(0, ...(code.match(/`+/g) || []).map(run => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const language = String(node.attrs?.language || node.attrs?.lang || '')
    .replace(/[^A-Za-z0-9_+-]/g, '');
  return `${fence}${language}\n${code}\n${fence}`;
};

const quoteLines = (value: string): string => value.split('\n').map(line => `> ${line}`).join('\n');

const renderDatabase = (node: DocumentNodeJson): string => {
  const database = node.attrs?.database;
  if (!database || typeof database !== 'object') return '[Database]';
  const record = database as Record<string, unknown>;
  const properties = Array.isArray(record.properties)
    ? record.properties.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  const rows = Array.isArray(record.rows)
    ? record.rows.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  if (!properties.length) return String(record.title || '[Database]');
  const header = properties.map(property => escapeTableCell(String(property.name || 'Property')));
  const body = rows.map(row => {
    const cells = row.cells && typeof row.cells === 'object' ? row.cells as Record<string, unknown> : {};
    return properties.map(property => escapeTableCell(stringifyCellValue(cells[String(property.id || '')])));
  });
  return [
    record.title ? `**${escapeMarkdownText(String(record.title))}**\n` : '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].filter(Boolean).join('\n');
};

const renderNode = (node: DocumentNodeJson, context: MarkdownContext): string => {
  if (node.type === 'text') return applyMarks(node.text || '', node.marks);
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'paragraph') return inlineContent(node, context);
  if (node.type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node.attrs?.level || 1)));
    return `${'#'.repeat(level)} ${inlineContent(node, context)}`;
  }
  if (node.type === 'bulletList') return renderList(node, context, false);
  if (node.type === 'orderedList') return renderList(node, context, true);
  if (node.type === 'taskList') return renderTaskList(node, context);
  if (node.type === 'listItem' || node.type === 'taskItem') return inlineContent(node, context);
  if (node.type === 'blockquote') return quoteLines(nodeChildren(node).map(child => renderNode(child, context)).join('\n\n'));
  if (node.type === 'codeBlock') return renderCodeBlock(node);
  if (node.type === 'horizontalRule') return '---';
  if (node.type === 'table') return renderTable(node);
  if (node.type === 'tableRow' || node.type === 'tableCell' || node.type === 'tableHeader') return inlineContent(node, context);
  if (node.type === 'image') {
    const alt = escapeMarkdownText(String(node.attrs?.alt || node.attrs?.caption || 'image'));
    const src = destination(node.attrs?.src);
    const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
    return src ? `![${alt}](${src}${title})` : alt;
  }
  if (node.type === 'inlineEquation') return `\\(${normalizeSerializedFormula(node.attrs?.formula)}\\)`;
  if (node.type === 'equationBlock') return `\\[\n${normalizeSerializedFormula(node.attrs?.formula)}\n\\]`;
  if (node.type === 'calloutBlock') {
    const icon = String(node.attrs?.icon || '!');
    const body = nodeChildren(node).map(child => renderNode(child, context)).join('\n\n');
    return quoteLines(`${icon} ${body}`.trim());
  }
  if (node.type === 'toggleBlock') {
    const title = String(node.attrs?.title || 'Toggle');
    const body = nodeChildren(node).map(child => renderNode(child, context)).join('\n\n');
    return `▶ ${escapeMarkdownText(title)}${body ? `\n\n${body}` : ''}`;
  }
  if (node.type === 'bookmarkBlock' || node.type === 'embedBlock' || node.type === 'mediaBlock') {
    const url = destination(node.attrs?.url);
    const label = escapeMarkdownText(String(node.attrs?.title || node.attrs?.name || url || 'Link'));
    const description = String(node.attrs?.description || '').trim();
    return `${url ? `[${label}](${url})` : label}${description ? `\n\n${quoteLines(description)}` : ''}`;
  }
  if (node.type === 'pageLinkBlock') {
    const title = escapeMarkdownText(String(node.attrs?.title || 'Page'));
    const pageId = String(node.attrs?.pageId || '');
    const view = node.attrs?.category === 'note' || !node.attrs?.category ? 'notes' : 'sop';
    return pageId ? `[${title}](/notes?view=${view}&doc=${encodeURIComponent(pageId)})` : title;
  }
  if (node.type === 'mindMap') {
    const data = node.attrs?.data;
    const serialized = typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2);
    return `\`\`\`mindmap\n${serialized}\n\`\`\``;
  }
  if (node.type === 'databaseBlock') return renderDatabase(node);
  if (node.type === 'templateButtonBlock') return `[Template: ${escapeMarkdownText(String(node.attrs?.label || 'New template'))}]`;
  if (node.type === 'columnList') return nodeChildren(node).map((column, index) => (
    `**Column ${index + 1}**\n\n${renderNode(column, context)}`
  )).join('\n\n');
  if (node.type === 'column' || node.type === 'syncedBlock' || node.type === 'doc') {
    return nodeChildren(node).map(child => renderNode(child, context)).filter(Boolean).join('\n\n');
  }
  return nodeChildren(node).map(child => renderNode(child, context)).join('') || escapeMarkdownText(node.text || '');
};

export const serializeToMarkdown = (input: SerializableDocumentInput): string => {
  const normalized = normalizeSerializableInput(input);
  const nodes = Array.isArray(normalized) ? normalized : [normalized];
  return cleanJoinedBlocks(nodes.map(node => renderNode(node, { listDepth: 0 })).filter(Boolean).join('\n\n'));
};
