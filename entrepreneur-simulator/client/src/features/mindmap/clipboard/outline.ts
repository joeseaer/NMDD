import type { RichInline, RichList, RichText, TreeEdge } from '../domain/types';
import type {
  MindMapClipboardEnvelopeV1,
  OutlineProjectionOptions,
} from './types';

function inlineText(inline: RichInline): string {
  return inline.type === 'hardBreak' ? '\n' : inline.text;
}

function listText(list: RichList): string {
  return list.items
    .flatMap((item) => item.children.map((child) =>
      child.type === 'paragraph'
        ? child.children.map(inlineText).join('')
        : listText(child)))
    .join(' ');
}

export function clipboardRichTextToPlainText(value: RichText): string {
  const text = value.blocks
    .map((block) =>
      block.type === 'paragraph'
        ? block.children.map(inlineText).join('')
        : listText(block))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text || 'Untitled';
}

function escapeClipboardHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function projectMindMapClipboardHtmlOutline(
  envelope: MindMapClipboardEnvelopeV1,
): string {
  const visited = new Set<string>();
  const edgesByParent = new Map<string, TreeEdge[]>();

  for (const edge of Object.values(envelope.fragment.treeEdges)) {
    const siblings = edgesByParent.get(edge.parentTopicId) ?? [];
    siblings.push(edge);
    edgesByParent.set(edge.parentTopicId, siblings);
  }
  for (const siblings of edgesByParent.values()) {
    siblings.sort((left, right) =>
      (left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  const renderTopic = (topicId: string): string => {
    if (visited.has(topicId)) return '';
    const topic = envelope.fragment.topics[
      topicId as keyof typeof envelope.fragment.topics
    ];
    if (!topic) return '';
    visited.add(topicId);

    const children = (edgesByParent.get(topicId) ?? [])
      .map((edge) => renderTopic(edge.childTopicId))
      .filter((value) => value !== '');
    const nested = children.length > 0 ? `<ul>${children.join('')}</ul>` : '';
    const title = escapeClipboardHtml(clipboardRichTextToPlainText(topic.title));
    return `<li>${title}${nested}</li>`;
  };

  const roots = envelope.rootTopicIds
    .map((topicId) => renderTopic(topicId))
    .filter((value) => value !== '');
  return `<ul data-nmdd-mindmap-outline="1">${roots.join('')}</ul>`;
}

export function projectMindMapClipboardOutline(
  envelope: MindMapClipboardEnvelopeV1,
  options: OutlineProjectionOptions = {},
): string {
  const format = options.format ?? 'plain';
  const indent = options.indent ?? (format === 'markdown' ? '  ' : '\t');
  const lines: string[] = [];
  const visited = new Set<string>();

  const edgesByParent = new Map<string, TreeEdge[]>();
  for (const edge of Object.values(envelope.fragment.treeEdges)) {
    const siblings = edgesByParent.get(edge.parentTopicId) ?? [];
    siblings.push(edge);
    edgesByParent.set(edge.parentTopicId, siblings);
  }
  for (const siblings of edgesByParent.values()) {
    siblings.sort((left, right) =>
      (left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  const visit = (topicId: string, depth: number): void => {
    if (visited.has(topicId)) return;
    const topic = envelope.fragment.topics[topicId as keyof typeof envelope.fragment.topics];
    if (!topic) return;
    visited.add(topicId);
    const prefix = indent.repeat(depth);
    const bullet = format === 'markdown' ? '- ' : '';
    lines.push(`${prefix}${bullet}${clipboardRichTextToPlainText(topic.title)}`);
    for (const edge of edgesByParent.get(topicId) ?? []) visit(edge.childTopicId, depth + 1);
  };

  for (const rootId of envelope.rootTopicIds) visit(rootId, 0);
  return lines.join('\n');
}
