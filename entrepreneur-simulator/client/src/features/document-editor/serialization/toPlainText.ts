import type { DocumentNodeJson } from '../schema/documentSchema';
import {
  cleanJoinedBlocks,
  getNodeText,
  nodeChildren,
  normalizeSerializedFormula,
  normalizeSerializableInput,
  stringifyCellValue,
  type SerializableDocumentInput,
} from './serializationUtils';

interface PlainContext {
  listDepth: number;
}

const inlineText = (node: DocumentNodeJson, context: PlainContext): string => (
  nodeChildren(node).map(child => renderPlainNode(child, context)).join('')
);

const indentContinuation = (value: string, spaces: number) => {
  const indent = ' '.repeat(spaces);
  return value.split('\n').map((line, index) => index === 0 ? line : `${indent}${line}`).join('\n');
};

const renderPlainList = (node: DocumentNodeJson, context: PlainContext, ordered: boolean, task: boolean): string => (
  nodeChildren(node).map((item, index) => {
    const marker = task
      ? `- [${item.attrs?.checked === true || item.attrs?.checked === 'true' ? 'x' : ' '}]`
      : ordered ? `${Number(node.attrs?.start || 1) + index}.` : '•';
    const children = nodeChildren(item);
    const first = children[0] ? renderPlainNode(children[0], context) : '';
    const rest = children.slice(1).map(child => renderPlainNode(child, { listDepth: context.listDepth + 1 })).filter(Boolean);
    return `${marker} ${indentContinuation(first, marker.length + 1)}${rest.length ? `\n${rest.map(value => indentContinuation(value, marker.length + 1)).join('\n')}` : ''}`;
  }).join('\n')
);

const renderPlainTable = (node: DocumentNodeJson): string => (
  nodeChildren(node)
    .filter(row => row.type === 'tableRow')
    .map(row => nodeChildren(row).map(cell => (
      nodeChildren(cell).map(child => renderPlainNode(child, { listDepth: 0 })).join(' ').replace(/\s*\n\s*/g, ' ')
    )).join('\t'))
    .join('\n')
);

const renderPlainDatabase = (node: DocumentNodeJson): string => {
  const database = node.attrs?.database;
  if (!database || typeof database !== 'object') return 'Database';
  const record = database as Record<string, unknown>;
  const properties = Array.isArray(record.properties)
    ? record.properties.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  const rows = Array.isArray(record.rows)
    ? record.rows.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
    : [];
  const lines = [properties.map(property => String(property.name || 'Property')).join('\t')];
  rows.forEach(row => {
    const cells = row.cells && typeof row.cells === 'object' ? row.cells as Record<string, unknown> : {};
    lines.push(properties.map(property => stringifyCellValue(cells[String(property.id || '')])).join('\t'));
  });
  return [String(record.title || '').trim(), lines.join('\n')].filter(Boolean).join('\n');
};

const renderPlainNode = (node: DocumentNodeJson, context: PlainContext): string => {
  if (node.type === 'text') {
    const text = node.text || '';
    const link = node.marks?.find(mark => mark.type === 'link')?.attrs?.href;
    return link && String(link) !== text ? `${text} (${String(link)})` : text;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'paragraph' || node.type === 'heading') return inlineText(node, context);
  if (node.type === 'bulletList') return renderPlainList(node, context, false, false);
  if (node.type === 'orderedList') return renderPlainList(node, context, true, false);
  if (node.type === 'taskList') return renderPlainList(node, context, false, true);
  if (node.type === 'listItem' || node.type === 'taskItem') return inlineText(node, context);
  if (node.type === 'blockquote') return nodeChildren(node).map(child => renderPlainNode(child, context)).join('\n');
  if (node.type === 'codeBlock') return getNodeText(node).replace(/\n$/, '');
  if (node.type === 'horizontalRule') return '────────';
  if (node.type === 'table') return renderPlainTable(node);
  if (node.type === 'tableRow' || node.type === 'tableCell' || node.type === 'tableHeader') return inlineText(node, context);
  if (node.type === 'image') return String(node.attrs?.caption || node.attrs?.alt || node.attrs?.src || 'image');
  if (node.type === 'inlineEquation' || node.type === 'equationBlock') return normalizeSerializedFormula(node.attrs?.formula);
  if (node.type === 'calloutBlock') {
    const body = nodeChildren(node).map(child => renderPlainNode(child, context)).join('\n');
    return `${String(node.attrs?.icon || '!')} ${body}`.trim();
  }
  if (node.type === 'toggleBlock') {
    const body = nodeChildren(node).map(child => renderPlainNode(child, context)).join('\n');
    return `${String(node.attrs?.title || 'Toggle')}${body ? `\n${body}` : ''}`;
  }
  if (node.type === 'bookmarkBlock' || node.type === 'embedBlock' || node.type === 'mediaBlock') {
    const label = String(node.attrs?.title || node.attrs?.name || '').trim();
    const url = String(node.attrs?.url || '').trim();
    return label && url && label !== url ? `${label} (${url})` : label || url;
  }
  if (node.type === 'pageLinkBlock') return String(node.attrs?.title || 'Page');
  if (node.type === 'mindMap') return String(node.attrs?.data || '');
  if (node.type === 'whiteboardEmbed') {
    const title = String(node.attrs?.title || '白板');
    const caption = String(node.attrs?.caption || '').trim();
    return caption ? `[白板] ${title} — ${caption}` : `[白板] ${title}`;
  }
  if (node.type === 'databaseBlock') return renderPlainDatabase(node);
  if (node.type === 'templateButtonBlock') return String(node.attrs?.label || 'Template');
  if (node.type === 'columnList' || node.type === 'column' || node.type === 'syncedBlock' || node.type === 'doc') {
    return nodeChildren(node).map(child => renderPlainNode(child, context)).filter(Boolean).join('\n\n');
  }
  return nodeChildren(node).map(child => renderPlainNode(child, context)).join('') || node.text || '';
};

export const serializeToPlainText = (input: SerializableDocumentInput): string => {
  const normalized = normalizeSerializableInput(input);
  const nodes = Array.isArray(normalized) ? normalized : [normalized];
  return cleanJoinedBlocks(nodes.map(node => renderPlainNode(node, { listDepth: 0 })).filter(Boolean).join('\n\n'));
};
