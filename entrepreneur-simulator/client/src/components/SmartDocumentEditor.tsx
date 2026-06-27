import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bold, Italic, Type, Strikethrough, Quote, ListOrdered, List, CheckSquare, 
  Code, PanelLeft, Columns, Table as TableIcon, Image as ImageIcon, X, Network,
  Link as LinkIcon, Unlink, AlignLeft, AlignCenter, AlignRight, Captions,
  ImagePlus, Download, ExternalLink, Maximize2, Trash2, Copy, GripVertical,
  MoreHorizontal, ArrowUp, ArrowDown, Heading1, Heading2, Heading3, MessageSquare
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Heading from '@tiptap/extension-heading';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { api, CURRENT_USER_ID } from '../services/api';
import {
    ColumnList,
    Column,
    SlashCommand,
    getSuggestionItems,
    renderItems,
    Indent,
    MindMap,
    ToggleBlock,
    CalloutBlock,
    BookmarkBlock,
    EmbedBlock,
    MediaBlock,
    SyncedBlock,
    PageLinkBlock,
    EquationBlock,
} from './TiptapExtensions';

// --- Parsers ---

const mdParser = new MarkdownIt({ html: true });

const BLOCK_ID_TYPES = [
    'paragraph',
    'heading',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'bulletList',
    'orderedList',
    'listItem',
    'taskList',
    'taskItem',
    'image',
    'table',
    'columnList',
    'column',
    'mindMap',
    'toggleBlock',
    'calloutBlock',
    'bookmarkBlock',
    'embedBlock',
    'mediaBlock',
    'syncedBlock',
    'pageLinkBlock',
    'equationBlock',
];

const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const TEXT_TURN_TYPES = new Set(['paragraph', 'heading']);

const createBlockId = () => {
    const randomPart = Math.random().toString(36).slice(2, 9);
    return `blk_${Date.now().toString(36)}_${randomPart}`;
};

type BlockComment = {
    id: string;
    text: string;
    author: string;
    createdAt: string;
    resolved?: boolean;
};

const createCommentId = () => {
    const randomPart = Math.random().toString(36).slice(2, 9);
    return `cmt_${Date.now().toString(36)}_${randomPart}`;
};

const formatCommentAuthor = (author: string) => {
    return author === CURRENT_USER_ID ? '我' : author;
};

const normalizeBlockComments = (value: unknown): BlockComment[] => {
    if (!Array.isArray(value)) return [];

    return value
        .map((item: any) => ({
            id: String(item?.id || createCommentId()),
            text: String(item?.text || '').trim(),
            author: String(item?.author || CURRENT_USER_ID),
            createdAt: String(item?.createdAt || new Date().toISOString()),
            resolved: Boolean(item?.resolved),
        }))
        .filter((item) => item.text);
};

const parseBlockCommentsAttribute = (value: string | null) => {
    if (!value) return [];

    const candidates = [value];
    try {
        candidates.push(decodeURIComponent(value));
    } catch {}

    for (const candidate of candidates) {
        try {
            return normalizeBlockComments(JSON.parse(candidate));
        } catch {}
    }

    return [];
};

const isBlockIdentityNode = (node: ProseMirrorNode) => {
    return BLOCK_ID_TYPES.includes(node.type.name);
};

const blockDomId = (blockId?: string | null) => blockId ? `block-${blockId}` : undefined;

const BlockIdentity = Extension.create({
    name: 'blockIdentity',
    priority: 1000,

    addGlobalAttributes() {
        return [
            {
                types: BLOCK_ID_TYPES,
                attributes: {
                    blockId: {
                        default: null,
                        parseHTML: (element) => element.getAttribute('data-block-id') || null,
                        renderHTML: (attributes) => {
                            const id = attributes.blockId;
                            if (!id) return {};
                            return {
                                id: blockDomId(id),
                                'data-block-id': id,
                            };
                        },
                    },
                    blockComments: {
                        default: [],
                        parseHTML: (element) => parseBlockCommentsAttribute(element.getAttribute('data-comments')),
                        renderHTML: (attributes) => {
                            const comments = normalizeBlockComments(attributes.blockComments);
                            if (!comments.length) return {};

                            return {
                                'data-comments': encodeURIComponent(JSON.stringify(comments)),
                            };
                        },
                    },
                },
            },
        ];
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('blockIdentity'),
                appendTransaction: (transactions, _oldState, newState) => {
                    if (!transactions.some((transaction) => transaction.docChanged)) return null;

                    const tr = newState.tr;
                    const seen = new Set<string>();

                    newState.doc.descendants((node, pos) => {
                        if (!isBlockIdentityNode(node)) return true;

                        const currentId = node.attrs.blockId;
                        if (!currentId || seen.has(currentId)) {
                            tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                blockId: createBlockId(),
                            }, node.marks);
                            return true;
                        }

                        seen.add(currentId);
                        return true;
                    });

                    if (!tr.docChanged) return null;
                    tr.setMeta('addToHistory', false);
                    return tr;
                },
            }),
        ];
    },
});

const ensureEditorBlockIds = (editor: any) => {
    const { state, view } = editor;
    const tr = state.tr;
    const seen = new Set<string>();

    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (!isBlockIdentityNode(node)) return true;

        const currentId = node.attrs.blockId;
        if (!currentId || seen.has(currentId)) {
            tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: createBlockId(),
            }, node.marks);
            return true;
        }

        seen.add(currentId);
        return true;
    });

    if (tr.docChanged) {
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
        return true;
    }

    return false;
};

type BlockHandleInfo = {
    id: string;
    pos: number;
    nodeSize: number;
    nodeType: string;
    depth: number;
    parentDepth: number;
    parentStart: number;
    parentType: string;
    parentId: string | null;
    grandParentStart: number | null;
    grandParentType: string | null;
    grandParentId: string | null;
    index: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
    canTurnIntoText: boolean;
    commentCount: number;
    top: number;
    left: number;
    width: number;
    height: number;
};

type DragBlockState = {
    source: BlockHandleInfo;
    drop?: {
        target: BlockHandleInfo;
        placement: 'before' | 'after';
        top: number;
        left: number;
        width: number;
        allowed: boolean;
    };
};

type ColumnResizeHandleInfo = {
    id: string;
    columnListId: string;
    leftColumnId: string;
    rightColumnId: string;
    top: number;
    left: number;
    height: number;
};

const getBlockElementScore = (element: HTMLElement) => {
    const tagName = element.tagName.toLowerCase();
    const dataType = element.getAttribute('data-type') || '';

    if (element.classList.contains('notion-image-block')) return 110;
    if (dataType === 'mind-map') return 105;
    if (dataType === 'media' || dataType === 'embed' || dataType === 'bookmark') return 104;
    if (dataType === 'toggle' || dataType === 'callout') return 98;
    if (tagName === 'table') return 100;
    if (tagName === 'blockquote' || tagName === 'pre') return 95;
    if (tagName === 'li') return 90;
    if (tagName === 'hr') return 80;
    if (/^h[1-6]$/.test(tagName)) return 70;
    if (tagName === 'p') return 60;
    if (tagName === 'ul' || tagName === 'ol') return 50;
    if (dataType === 'column-list') return 30;
    if (dataType === 'column') return 55;

    return 10;
};

const findBestBlockElement = (target: EventTarget | null, root: HTMLElement) => {
    let element = target instanceof HTMLElement ? target : null;
    if (!element && target instanceof Text) element = target.parentElement;

    const candidates: HTMLElement[] = [];
    while (element && root.contains(element)) {
        if (element.getAttribute('data-block-id')) candidates.push(element);
        element = element.parentElement;
    }

    if (!candidates.length) return null;

    const best = candidates.sort((a, b) => getBlockElementScore(b) - getBlockElementScore(a))[0];
    if (best.getAttribute('data-type') === 'column') {
        const childBlocks = Array.from(best.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement && Boolean(child.getAttribute('data-block-id')));
        return childBlocks[childBlocks.length - 1] || best;
    }

    return best;
};

const findBlockById = (editor: any, id: string): { node: ProseMirrorNode; pos: number } | null => {
    let result: { node: ProseMirrorNode; pos: number } | null = null;

    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.attrs?.blockId === id) {
            result = { node, pos };
            return false;
        }
        return true;
    });

    return result;
};

const getBlockContext = (editor: any, pos: number) => {
    const $before = editor.state.doc.resolve(pos);
    const parentDepth = $before.depth;
    const parent = $before.node(parentDepth);
    const index = $before.index(parentDepth);
    const grandParentDepth = parentDepth > 0 ? parentDepth - 1 : null;
    const grandParent = grandParentDepth !== null ? $before.node(grandParentDepth) : null;

    return {
        parent,
        parentDepth,
        parentStart: $before.start(parentDepth),
        parentPos: parentDepth > 0 ? $before.before(parentDepth) : 0,
        grandParent,
        grandParentDepth,
        grandParentStart: grandParentDepth !== null ? $before.start(grandParentDepth) : null,
        grandParentPos: grandParentDepth !== null && grandParentDepth > 0 ? $before.before(grandParentDepth) : 0,
        index,
    };
};

const getBlockDomElement = (editor: any, id: string, pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement && dom.getAttribute('data-block-id') === id) return dom;
    if (dom instanceof HTMLElement) {
        const nested = dom.querySelector(`[data-block-id="${id}"]`);
        if (nested instanceof HTMLElement) return nested;
    }

    const matches = Array.from(editor.view.dom.querySelectorAll('[data-block-id]')) as HTMLElement[];
    return matches.find((element) => element.getAttribute('data-block-id') === id) || null;
};

const getBlockInfoById = (editor: any, id: string, shell: HTMLElement): BlockHandleInfo | null => {
    const found = findBlockById(editor, id);
    if (!found) return null;

    const element = getBlockDomElement(editor, id, found.pos);
    if (!element) return null;

    const context = getBlockContext(editor, found.pos);
    const rect = element.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();

    return {
        id,
        pos: found.pos,
        nodeSize: found.node.nodeSize,
        nodeType: found.node.type.name,
        depth: context.parentDepth + 1,
        parentDepth: context.parentDepth,
        parentStart: context.parentStart,
        parentType: context.parent.type.name,
        parentId: context.parent.attrs?.blockId || null,
        grandParentStart: context.grandParentStart,
        grandParentType: context.grandParent?.type.name || null,
        grandParentId: context.grandParent?.attrs?.blockId || null,
        index: context.index,
        canMoveUp: context.index > 0,
        canMoveDown: context.index < context.parent.childCount - 1,
        canTurnIntoText: TEXT_TURN_TYPES.has(found.node.type.name),
        commentCount: normalizeBlockComments(found.node.attrs.blockComments).filter((comment) => !comment.resolved).length,
        top: rect.top - shellRect.top,
        left: Math.max(8, rect.left - shellRect.left - 44),
        width: rect.width,
        height: rect.height,
    };
};

const getBlockInfoFromEvent = (editor: any, event: React.MouseEvent, shell: HTMLElement | null) => {
    if (!shell) return null;
    const root = editor.view.dom as HTMLElement;
    const element = findBestBlockElement(event.target, root);
    const id = element?.getAttribute('data-block-id');
    if (!id) return null;
    return getBlockInfoById(editor, id, shell);
};

const getBlockInfoFromPoint = (editor: any, x: number, y: number, shell: HTMLElement | null) => {
    if (!shell) return null;
    const root = editor.view.dom as HTMLElement;
    const elementAtPoint = document.elementFromPoint(x, y);
    const element = findBestBlockElement(elementAtPoint, root);
    const id = element?.getAttribute('data-block-id');
    if (!id) return null;
    return getBlockInfoById(editor, id, shell);
};

const COLUMN_MIN_WIDTH_PERCENT = 18;

const clampColumnWidth = (value: number) => {
    return Math.max(COLUMN_MIN_WIDTH_PERCENT, Math.min(100, Math.round(value * 100) / 100));
};

const formatColumnWidth = (value: number) => `${Math.round(value * 100) / 100}%`;

const parseColumnWidthPercent = (value: unknown, fallback: number) => {
    if (typeof value !== 'string') return fallback;
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clampColumnWidth(parsed);
};

const getColumnResizeHandles = (editor: any, shell: HTMLElement | null, pointerY?: number): ColumnResizeHandleInfo[] => {
    if (!editor || !shell) return [];

    const shellRect = shell.getBoundingClientRect();
    const lists = Array.from((editor.view.dom as HTMLElement).querySelectorAll('[data-type="column-list"][data-block-id]')) as HTMLElement[];
    const activeList = lists.find((list) => {
        const rect = list.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (pointerY === undefined) return true;
        return pointerY >= rect.top - 12 && pointerY <= rect.bottom + 12;
    });

    if (!activeList) return [];

    const columnElements = Array.from(activeList.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('data-type') === 'column' && Boolean(child.getAttribute('data-block-id')));

    if (columnElements.length < 2) return [];

    const listId = activeList.getAttribute('data-block-id') || '';
    const listRect = activeList.getBoundingClientRect();

    return columnElements.slice(0, -1).map((column, index) => {
        const leftRect = column.getBoundingClientRect();
        const rightColumn = columnElements[index + 1];
        const leftColumnId = column.getAttribute('data-block-id') || '';
        const rightColumnId = rightColumn.getAttribute('data-block-id') || '';

        return {
            id: `${listId}-${leftColumnId}-${rightColumnId}`,
            columnListId: listId,
            leftColumnId,
            rightColumnId,
            top: listRect.top - shellRect.top,
            left: leftRect.right - shellRect.left - 5,
            height: listRect.height,
        };
    });
};

const getColumnWidthPercent = (node: ProseMirrorNode, element: HTMLElement | null, parentWidth: number, fallback: number) => {
    const attrWidth = parseColumnWidthPercent(node.attrs?.width, Number.NaN);
    if (Number.isFinite(attrWidth)) return attrWidth;

    if (element && parentWidth > 0) {
        const rectWidth = element.getBoundingClientRect().width;
        if (rectWidth > 0) return clampColumnWidth((rectWidth / parentWidth) * 100);
    }

    return fallback;
};

const getColumnElementById = (editor: any, columnId: string) => {
    const element = (editor.view.dom as HTMLElement).querySelector(`[data-type="column"][data-block-id="${columnId}"]`);
    return element instanceof HTMLElement ? element : null;
};

const cloneBlockWithFreshIds = (editor: any, node: ProseMirrorNode) => {
    const json = node.toJSON();

    const refresh = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (value.attrs?.blockId) value.attrs.blockId = createBlockId();
        if (value.attrs?.blockComments) delete value.attrs.blockComments;
        if (Array.isArray(value.content)) value.content.forEach(refresh);
    };

    refresh(json);
    return editor.state.schema.nodeFromJSON(json);
};

const copyTextToClipboard = async (text: string) => {
    let copied = false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch {
            copied = false;
        }
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    document.body.appendChild(input);

    try {
        input.focus();
        input.select();
        copied = document.execCommand('copy') || copied;
    } catch {
        copied = copied || false;
    } finally {
        document.body.removeChild(input);
    }

    if (navigator.clipboard?.readText) {
        try {
            const readBack = await navigator.clipboard.readText();
            if (readBack === text) return true;
            copied = false;
        } catch {
            return copied;
        }
    }

    return copied;
};

const canMoveBlockToTarget = (editor: any, sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo, placement: 'before' | 'after') => {
    if (!editor || sourceBlock.id === targetBlock.id) return false;

    const source = findBlockById(editor, sourceBlock.id);
    const target = findBlockById(editor, targetBlock.id);
    if (!source || !target) return false;

    const rawInsertPos = placement === 'before' ? target.pos : target.pos + target.node.nodeSize;
    if (rawInsertPos > source.pos && rawInsertPos < source.pos + source.node.nodeSize) return false;

    const targetContext = getBlockContext(editor, target.pos);
    const insertIndex = placement === 'before' ? targetContext.index : targetContext.index + 1;
    return targetContext.parent.canReplaceWith(insertIndex, insertIndex, source.node.type, source.node.marks);
};

const deleteSourceForMove = (editor: any, tr: any, source: { node: ProseMirrorNode; pos: number; context: ReturnType<typeof getBlockContext> }) => {
    const { node, pos, context } = source;

    if (context.parent.type.name !== 'doc' && context.parent.childCount <= 1) {
        const emptyParagraph = editor.state.schema.nodes.paragraph.create({ blockId: createBlockId() });
        tr.replaceWith(pos, pos + node.nodeSize, emptyParagraph);
        return;
    }

    tr.delete(pos, pos + node.nodeSize);
};

const defaultFence = mdParser.renderer.rules.fence;
mdParser.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    if (info === 'mindmap' || info.startsWith('mindmap ')) {
        const jsonStr = (token.content || '').trim();
        const encoded = encodeURIComponent(jsonStr);
        return `<div data-type="mind-map" data-mindmap="${encoded}"></div>`;
    }
    if (defaultFence) return defaultFence(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
};
const turndownService = new TurndownService({ 
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

function normalizeMindMapHtmlForTurndown(html: string) {
    if (!html || !html.includes('data-type="mind-map"')) return html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const mindmaps = Array.from(doc.querySelectorAll('div[data-type="mind-map"][data-mindmap]'));
        if (mindmaps.length === 0) return html;

        for (const el of mindmaps) {
            const encoded = el.getAttribute('data-mindmap') || '';
            let jsonStr = '';
            try {
                jsonStr = decodeURIComponent(encoded);
            } catch {
                jsonStr = encoded;
            }

            const pre = doc.createElement('pre');
            const code = doc.createElement('code');
            code.className = 'language-mindmap';
            code.textContent = jsonStr;
            pre.appendChild(code);
            el.replaceWith(pre);
        }

        return doc.body.innerHTML;
    } catch {
        return html;
    }
}

// Custom rule to keep column structure as HTML
turndownService.addRule('keepColumns', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    return nodeName === 'div' && (
      getAttr('data-type') === 'column-list' ||
      getAttr('data-type') === 'column'
    );
  },
  replacement: (_content, node) => {
    return (node as HTMLElement).outerHTML;
  }
});

turndownService.addRule('keepSmartDocumentBlocks', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    const dataType = getAttr('data-type');

    return (
      (nodeName === 'details' && dataType === 'toggle') ||
      (nodeName === 'div' && ['callout', 'embed', 'media', 'equation', 'synced-block'].includes(dataType || '')) ||
      (nodeName === 'a' && ['bookmark', 'page-link'].includes(dataType || ''))
    );
  },
  replacement: (_content, node) => {
    return `\n\n${(node as HTMLElement).outerHTML}\n\n`;
  }
});

const escapeHtmlAttribute = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

turndownService.addRule('keepSmartImages', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    if (nodeName !== 'img' || typeof el.getAttribute !== 'function') return false;
    return Boolean(
      el.getAttribute('data-width') ||
      el.getAttribute('data-align') ||
      el.getAttribute('data-caption') ||
      el.getAttribute('data-fit') ||
      el.getAttribute('data-aspect-ratio') ||
      el.getAttribute('data-shape') ||
      el.getAttribute('data-link')
    );
  },
  replacement: (_content, node) => {
    const el = node as HTMLImageElement;
    const width = normalizeImageWidth(el.getAttribute('data-width') || el.getAttribute('width') || el.style.width || '100%');
    const align = el.getAttribute('data-align') || 'center';
    const caption = el.getAttribute('data-caption') || '';
    const fit = el.getAttribute('data-fit') || 'contain';
    const aspectRatio = el.getAttribute('data-aspect-ratio') || '';
    const shape = el.getAttribute('data-shape') || 'rounded';
    const link = el.getAttribute('data-link') || '';
    const attrs = [
      `src="${escapeHtmlAttribute(el.getAttribute('src') || '')}"`,
      `alt="${escapeHtmlAttribute(el.getAttribute('alt') || '')}"`,
      el.getAttribute('title') ? `title="${escapeHtmlAttribute(el.getAttribute('title') || '')}"` : '',
      `data-width="${escapeHtmlAttribute(width)}"`,
      `data-align="${escapeHtmlAttribute(align)}"`,
      caption ? `data-caption="${escapeHtmlAttribute(caption)}"` : '',
      fit !== 'contain' ? `data-fit="${escapeHtmlAttribute(fit)}"` : '',
      aspectRatio ? `data-aspect-ratio="${escapeHtmlAttribute(aspectRatio)}"` : '',
      shape !== 'rounded' ? `data-shape="${escapeHtmlAttribute(shape)}"` : '',
      link ? `data-link="${escapeHtmlAttribute(link)}"` : '',
      `style="width: ${escapeHtmlAttribute(width)}; max-width: 100%; height: auto;"`,
    ].filter(Boolean);

    return `\n\n<img ${attrs.join(' ')} />\n\n`;
  }
});

// Custom rule to keep mind map structure as HTML
turndownService.addRule('keepMindMap', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    const hasAttr = (name: string) => (typeof el.hasAttribute === 'function' ? el.hasAttribute(name) : !!getAttr(name));
    return nodeName === 'div' && (getAttr('data-type') === 'mind-map' || hasAttr('data-mindmap'));
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const encoded = el.getAttribute('data-mindmap') || '';
    let jsonStr = '';
    try {
        jsonStr = decodeURIComponent(encoded);
    } catch {
        jsonStr = encoded;
    }
    return `\n\n\`\`\`mindmap\n${jsonStr}\n\`\`\`\n\n`;
  }
});

// --- Custom Node Views ---
const ResizableImageComponent = (props: any) => {
    return <NotionImageComponent {...props} />;

};

const IMAGE_MIN_WIDTH_PERCENT = 20;
const IMAGE_MAX_WIDTH_PERCENT = 100;

const clampImageWidth = (value: number) => {
    return Math.max(IMAGE_MIN_WIDTH_PERCENT, Math.min(IMAGE_MAX_WIDTH_PERCENT, Math.round(value)));
};

const normalizeImageWidth = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return '100%';
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) return `${clampImageWidth(parseFloat(trimmed))}%`;
    return trimmed;
};

const getImageAlignmentStyle = (align: string) => {
    if (align === 'left') return { marginLeft: 0, marginRight: 'auto' };
    if (align === 'right') return { marginLeft: 'auto', marginRight: 0 };
    return { marginLeft: 'auto', marginRight: 'auto' };
};

const getImageShapeClass = (shape: string) => {
    if (shape === 'circle') return 'rounded-full';
    if (shape === 'square') return 'rounded-none';
    return 'rounded-lg';
};

const getMediaKindFromFile = (file: File) => {
    const mime = file.type || '';
    const name = file.name || '';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    return 'file';
};

const ImageActionButton = ({
    children,
    title,
    onClick,
    active,
    danger,
}: {
    children: React.ReactNode;
    title: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
}) => (
    <button
        type="button"
        title={title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        }}
        className={`h-7 min-w-7 rounded px-1.5 flex items-center justify-center text-xs font-semibold transition-colors ${
            active
                ? 'bg-gray-900 text-white'
                : danger
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-600 hover:bg-gray-100'
        }`}
    >
        {children}
    </button>
);

const NotionImageComponent = (props: any) => {
    const { node, updateAttributes, selected, deleteNode, editor } = props;
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [width, setWidth] = useState(normalizeImageWidth(node.attrs.width));
    const [resizing, setResizing] = useState(false);
    const [showCaption, setShowCaption] = useState(Boolean(node.attrs.caption));
    const [previewOpen, setPreviewOpen] = useState(false);

    const src = node.attrs.src || '';
    const align = node.attrs.align || 'center';
    const caption = node.attrs.caption || '';
    const alt = node.attrs.alt || '';
    const fit = node.attrs.fit || 'contain';
    const aspectRatio = node.attrs.aspectRatio || '';
    const shape = node.attrs.shape || 'rounded';
    const link = node.attrs.link || '';
    const shapeClass = getImageShapeClass(shape);

    useEffect(() => {
        setWidth(normalizeImageWidth(node.attrs.width));
        setShowCaption(Boolean(node.attrs.caption));
    }, [node.attrs.width, node.attrs.caption]);

    const commitWidth = useCallback((nextWidth: string) => {
        const normalized = normalizeImageWidth(nextWidth);
        setWidth(normalized);
        updateAttributes({ width: normalized });
    }, [updateAttributes]);

    const handleResizeMouseDown = (event: React.MouseEvent, side: 'left' | 'right') => {
        event.preventDefault();
        event.stopPropagation();

        const wrapper = wrapperRef.current;
        const parent = wrapper?.parentElement;
        if (!wrapper || !parent) return;

        setResizing(true);
        const startX = event.clientX;
        const startWidth = wrapper.getBoundingClientRect().width;
        const parentWidth = parent.getBoundingClientRect().width || startWidth;
        let draftWidth = width;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = side === 'right' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
            const nextPercent = clampImageWidth(((startWidth + delta) / parentWidth) * 100);
            draftWidth = `${nextPercent}%`;
            setWidth(draftWidth);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setResizing(false);
            updateAttributes({ width: draftWidth });
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const replaceImage = async (file: File) => {
        const uploadImage = editor?.storage?.smartDocument?.uploadImage;
        if (typeof uploadImage !== 'function') return;
        const url = await uploadImage(file);
        if (url) updateAttributes({ src: url });
    };

    const promptAltText = () => {
        const nextAlt = window.prompt('图片描述 / Alt text', alt);
        if (nextAlt === null) return;
        updateAttributes({ alt: nextAlt.trim() });
    };

    const promptImageLink = () => {
        const nextLink = window.prompt('图片链接', link);
        if (nextLink === null) return;
        updateAttributes({ link: nextLink.trim() });
    };

    const copyImageLink = async () => {
        try {
            await navigator.clipboard.writeText(src);
        } catch {
            window.prompt('复制图片链接', src);
        }
    };

    const downloadImage = () => {
        const link = document.createElement('a');
        link.href = src;
        link.download = (alt || caption || 'image').replace(/[\\/:*?"<>|]+/g, '-');
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.click();
    };

    const toolbarVisible = selected || resizing;

    return (
        <NodeViewWrapper
            className="notion-image-block group relative block my-4 max-w-full"
            id={blockDomId(node.attrs.blockId)}
            data-block-id={node.attrs.blockId || undefined}
            data-comments={
                normalizeBlockComments(node.attrs.blockComments).length
                    ? encodeURIComponent(JSON.stringify(normalizeBlockComments(node.attrs.blockComments)))
                    : undefined
            }
            style={{
                width,
                maxWidth: '100%',
                ...getImageAlignmentStyle(align),
            }}
            ref={wrapperRef}
        >
            <div className={`relative ${shapeClass} ${selected ? 'ring-2 ring-primary/80 ring-offset-2' : ''}`}>
                <div
                    className={`overflow-hidden border border-gray-100 bg-gray-50 shadow-sm ${shapeClass}`}
                    style={aspectRatio ? { aspectRatio } : undefined}
                >
                    {link ? (
                        <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                            contentEditable={false}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            <img
                                src={src}
                                alt={alt || caption}
                                title={node.attrs.title || alt || caption}
                                className={`block w-full ${aspectRatio ? `h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-auto'}`}
                                draggable={false}
                            />
                        </a>
                    ) : (
                        <img
                            src={src}
                            alt={alt || caption}
                            title={node.attrs.title || alt || caption}
                            className={`block w-full ${aspectRatio ? `h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-auto'}`}
                            draggable={false}
                        />
                    )}
                </div>

                <div
                    className={`absolute left-0 top-1/2 h-16 w-1.5 -translate-x-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-gray-900 transition-opacity ${
                        toolbarVisible ? 'opacity-90' : 'opacity-0 group-hover:opacity-80'
                    }`}
                    onMouseDown={(event) => handleResizeMouseDown(event, 'left')}
                    title="拖拽调整宽度"
                />
                <div
                    className={`absolute right-0 top-1/2 h-16 w-1.5 translate-x-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-gray-900 transition-opacity ${
                        toolbarVisible ? 'opacity-90' : 'opacity-0 group-hover:opacity-80'
                    }`}
                    onMouseDown={(event) => handleResizeMouseDown(event, 'right')}
                    title="拖拽调整宽度"
                />

                <div
                    className={`absolute right-2 top-2 z-10 flex max-w-[min(680px,calc(100vw-3rem))] items-center gap-1 overflow-x-auto rounded-md border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur transition-opacity ${
                        toolbarVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    contentEditable={false}
                >
                    <ImageActionButton title="左对齐" active={align === 'left'} onClick={() => updateAttributes({ align: 'left' })}>
                        <AlignLeft className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="居中" active={align === 'center'} onClick={() => updateAttributes({ align: 'center' })}>
                        <AlignCenter className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="右对齐" active={align === 'right'} onClick={() => updateAttributes({ align: 'right' })}>
                        <AlignRight className="h-4 w-4" />
                    </ImageActionButton>
                    {[50, 75, 100].map((percent) => (
                        <ImageActionButton
                            key={percent}
                            title={`${percent}% 宽度`}
                            active={width === `${percent}%`}
                            onClick={() => commitWidth(`${percent}%`)}
                        >
                            {percent}
                        </ImageActionButton>
                    ))}
                    <ImageActionButton
                        title="原始比例"
                        active={!aspectRatio && shape === 'rounded'}
                        onClick={() => updateAttributes({ aspectRatio: '', fit: 'contain', shape: 'rounded' })}
                    >
                        原
                    </ImageActionButton>
                    <ImageActionButton
                        title="裁剪 16:9"
                        active={aspectRatio === '16 / 9' && fit === 'cover'}
                        onClick={() => updateAttributes({ aspectRatio: '16 / 9', fit: 'cover', shape: 'rounded' })}
                    >
                        16:9
                    </ImageActionButton>
                    <ImageActionButton
                        title="裁剪 1:1"
                        active={aspectRatio === '1 / 1' && fit === 'cover' && shape !== 'circle'}
                        onClick={() => updateAttributes({ aspectRatio: '1 / 1', fit: 'cover', shape: 'rounded' })}
                    >
                        1:1
                    </ImageActionButton>
                    <ImageActionButton
                        title="圆形遮罩"
                        active={shape === 'circle'}
                        onClick={() => updateAttributes({ aspectRatio: '1 / 1', fit: 'cover', shape: 'circle' })}
                    >
                        圆
                    </ImageActionButton>
                    <ImageActionButton title="添加说明" active={showCaption || Boolean(caption)} onClick={() => setShowCaption(true)}>
                        <Captions className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="替换图片" onClick={() => fileInputRef.current?.click()}>
                        <ImagePlus className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="Alt 文本" active={Boolean(alt)} onClick={promptAltText}>
                        ALT
                    </ImageActionButton>
                    <ImageActionButton title="图片链接" active={Boolean(link)} onClick={promptImageLink}>
                        <LinkIcon className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="复制图片链接" onClick={copyImageLink}>
                        <Copy className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="查看原图" onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}>
                        <ExternalLink className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="全屏预览" onClick={() => setPreviewOpen(true)}>
                        <Maximize2 className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="下载" onClick={downloadImage}>
                        <Download className="h-4 w-4" />
                    </ImageActionButton>
                    <ImageActionButton title="删除" danger onClick={() => deleteNode?.()}>
                        <Trash2 className="h-4 w-4" />
                    </ImageActionButton>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) replaceImage(file);
                        event.target.value = '';
                    }}
                />
            </div>

            {(showCaption || caption) && (
                <input
                    contentEditable={false}
                    value={caption}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={(event) => updateAttributes({ caption: event.target.value })}
                    placeholder="添加图片说明"
                    className="mt-2 w-full border-none bg-transparent px-1 text-center text-xs text-gray-500 outline-none placeholder:text-gray-300 focus:ring-0"
                />
            )}

            {previewOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-8"
                    contentEditable={false}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={() => setPreviewOpen(false)}
                >
                    <button
                        type="button"
                        title="关闭"
                        className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                        onClick={() => setPreviewOpen(false)}
                    >
                        <X className="h-5 w-5" />
                    </button>
                    <div className="max-h-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
                        <img src={src} alt={alt || caption} className="max-h-[82vh] max-w-full rounded-lg object-contain" />
                        {caption && <div className="mt-3 text-center text-sm text-white/80">{caption}</div>}
                    </div>
                </div>
            )}
        </NodeViewWrapper>
    );
};

export type SmartDocumentValue = {
    markdown: string;
    json: JSONContent;
    html: string;
    text: string;
};

export type SmartDocumentPageLink = {
    id: string;
    title: string;
    category?: string;
};

type SmartDocumentEditorProps = {
    content?: string;
    contentJson?: JSONContent | null;
    pages?: SmartDocumentPageLink[];
    currentDocumentId?: string | null;
    onChange: (value: SmartDocumentValue) => void;
};

const isValidDocJson = (value: unknown): value is JSONContent => {
    return !!value && typeof value === 'object' && (value as any).type === 'doc';
};

const isMarkdownStructureLine = (line: string) => {
    const trimmed = line.trim();
    return (
        /^#{1,6}\s+/.test(trimmed) ||
        /^([-*+]|\d+[.)])\s+/.test(trimmed) ||
        /^>\s?/.test(trimmed) ||
        /^(```|~~~)/.test(trimmed) ||
        /^\|.*\|$/.test(trimmed) ||
        /^<\/?[a-z][\s\S]*>/i.test(trimmed)
    );
};

const preserveLegacyMarkdownBlankLines = (value: string) => {
    const normalized = (value || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    let inFence = false;

    return lines.map((line, index) => {
        const trimmed = line.trim();
        if (/^(```|~~~)/.test(trimmed)) {
            inFence = !inFence;
            return line;
        }

        if (inFence || trimmed !== '') return line;

        const previous = [...lines.slice(0, index)].reverse().find((item) => item.trim() !== '');
        const next = lines.slice(index + 1).find((item) => item.trim() !== '');
        if (!previous || !next) return line;
        if (isMarkdownStructureLine(previous) || isMarkdownStructureLine(next)) return line;

        return '\n<p data-preserved-blank-line></p>\n';
    }).join('\n');
};

const markdownToHtml = (value: string) => mdParser.render(preserveLegacyMarkdownBlankLines(value || ''));

const editorToMarkdown = (editor: any) => {
    const html = editor.getHTML();
    return turndownService.turndown(normalizeMindMapHtmlForTurndown(html));
};

const getInitialContent = (contentJson: JSONContent | null | undefined, markdown: string) => {
    return isValidDocJson(contentJson) ? contentJson : markdownToHtml(markdown || '');
};

const getContentSignature = (contentJson: JSONContent | null | undefined, markdown: string) => {
    if (isValidDocJson(contentJson)) return `json:${JSON.stringify(contentJson)}`;
    return `markdown:${markdown || ''}`;
};

export const SmartDocumentEditor = ({
    content = '',
    contentJson = null,
    pages = [],
    currentDocumentId = null,
    onChange,
}: SmartDocumentEditorProps) => {
    const [showTOC, setShowTOC] = useState(false);
    const [hoveredBlock, setHoveredBlock] = useState<BlockHandleInfo | null>(null);
    const [blockMenuOpen, setBlockMenuOpen] = useState(false);
    const [dragBlock, setDragBlock] = useState<DragBlockState | null>(null);
    const [columnResizeHandles, setColumnResizeHandles] = useState<ColumnResizeHandleInfo[]>([]);
    const [commentPanelBlock, setCommentPanelBlock] = useState<BlockHandleInfo | null>(null);
    const shellRef = React.useRef<HTMLDivElement | null>(null);
    const mmSigRef = React.useRef<string>('');
    const externalSigRef = React.useRef<string>(getContentSignature(contentJson, content));

    const uploadImage = useCallback(async (file: File) => {
        try {
            const { url } = await api.uploadImage(file);
            return url;
        } catch (error) {
            console.error('Failed to upload image', error);
            alert('图片上传失败，请重试');
            return null;
        }
    }, []);

    const uploadFile = useCallback(async (file: File) => {
        try {
            const { url } = await api.uploadFile(file);
            return url;
        } catch (error) {
            console.error('Failed to upload file', error);
            alert('文件上传失败，请重试');
            return null;
        }
    }, []);

    const editor = useEditor({
        extensions: [
            BlockIdentity,
            StarterKit.configure({
                bulletList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
                orderedList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
            }),
            LinkExtension.configure({ openOnClick: false }),
            Image.extend({
                addAttributes() {
                    return {
                        ...this.parent?.(),
                        width: {
                            default: '100%',
                            parseHTML: element => element.getAttribute('data-width') || element.getAttribute('width') || element.style.width || '100%',
                            renderHTML: attributes => ({
                                width: normalizeImageWidth(attributes.width),
                                'data-width': normalizeImageWidth(attributes.width),
                                style: `width: ${normalizeImageWidth(attributes.width)}; max-width: 100%; height: auto;`,
                            }),
                        },
                        align: {
                            default: 'center',
                            parseHTML: element => element.getAttribute('data-align') || 'center',
                            renderHTML: attributes => ({
                                'data-align': attributes.align || 'center',
                            }),
                        },
                        caption: {
                            default: '',
                            parseHTML: element => element.getAttribute('data-caption') || '',
                            renderHTML: attributes => ({
                                'data-caption': attributes.caption || undefined,
                            }),
                        },
                        title: {
                            default: '',
                            parseHTML: element => element.getAttribute('title') || '',
                            renderHTML: attributes => ({
                                title: attributes.title || undefined,
                            }),
                        },
                        fit: {
                            default: 'contain',
                            parseHTML: element => element.getAttribute('data-fit') || 'contain',
                            renderHTML: attributes => ({
                                'data-fit': attributes.fit && attributes.fit !== 'contain' ? attributes.fit : undefined,
                            }),
                        },
                        aspectRatio: {
                            default: '',
                            parseHTML: element => element.getAttribute('data-aspect-ratio') || '',
                            renderHTML: attributes => ({
                                'data-aspect-ratio': attributes.aspectRatio || undefined,
                            }),
                        },
                        shape: {
                            default: 'rounded',
                            parseHTML: element => element.getAttribute('data-shape') || 'rounded',
                            renderHTML: attributes => ({
                                'data-shape': attributes.shape && attributes.shape !== 'rounded' ? attributes.shape : undefined,
                            }),
                        },
                        link: {
                            default: '',
                            parseHTML: element => element.getAttribute('data-link') || '',
                            renderHTML: attributes => ({
                                'data-link': attributes.link || undefined,
                            }),
                        },
                    }
                },
                addNodeView() {
                    return ReactNodeViewRenderer(ResizableImageComponent);
                },
            }).configure({
                inline: true,
                allowBase64: true,
            }),
            Heading.configure({
                levels: [1, 2, 3, 4, 5, 6],
            }),
            TaskList,
            TaskItem.configure({ 
                nested: true,
                HTMLAttributes: {
                    class: 'flex items-start space-x-2',
                },
            }),
            Placeholder.configure({ placeholder: '开始输入内容... (输入 / 唤起命令菜单)' }),
            ColumnList,
            Column,
            SlashCommand.configure({
                suggestion: {
                    items: getSuggestionItems,
                    render: renderItems,
                },
            }),
            Indent,
            MindMap,
            ToggleBlock,
            CalloutBlock,
            BookmarkBlock,
            EmbedBlock,
            MediaBlock,
            SyncedBlock,
            PageLinkBlock,
            EquationBlock,
            Table.configure({
                resizable: true,
            }),
            TableRow,
            TableHeader,
            TableCell,
        ],
        content: getInitialContent(contentJson, content),
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] p-8 outline-none whitespace-pre-wrap break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-6 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h4]:text-lg [&_h4]:font-bold [&_h4]:mb-2 [&_h5]:text-base [&_h5]:font-bold [&_h5]:mb-1 [&_h6]:text-sm [&_h6]:font-bold [&_h6]:text-gray-500 [&_li_p]:m-0 [&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0 [&_img]:rounded-lg [&_img]:shadow-sm [&_img]:max-w-full [&_img]:my-4 [&_div[data-type="mind-map"]]:my-6',
            },
            handlePaste: (view, event, _slice) => {
                const text = event.clipboardData?.getData('text/plain');
                if (text) {
                     // Check for Markdown table syntax (Header row + Separator row)
                     if (/^\s*\|.*\|\s*\n\s*\|[-:| ]+\|\s*/m.test(text)) {
                         const html = mdParser.render(text);
                         const parser = new DOMParser();
                         const doc = parser.parseFromString(html, 'text/html');
                         const pmParser = ProseMirrorDOMParser.fromSchema(view.state.schema);
                         const slice = pmParser.parseSlice(doc.body);
                         const transaction = view.state.tr.replaceSelection(slice);
                         view.dispatch(transaction);
                         return true;
                     }
                }

                const items = Array.from(event.clipboardData?.items || []);
                const item = items.find(item => item.kind === 'file');

                if (item) {
                    event.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        const upload = file.type.indexOf('image') === 0 ? uploadImage : uploadFile;
                        upload(file).then(url => {
                            if (url) {
                                const { schema } = view.state;
                                const node = file.type.indexOf('image') === 0
                                    ? schema.nodes.image.create({ src: url, width: '100%', align: 'center' })
                                    : schema.nodes.mediaBlock.create({
                                        url,
                                        name: file.name,
                                        mime: file.type || '',
                                        size: file.size,
                                        kind: getMediaKindFromFile(file),
                                    });
                                const transaction = view.state.tr.replaceSelectionWith(node);
                                view.dispatch(transaction);
                            }
                        });
                    }
                    return true;
                }
                return false;
            },
            handleDrop: (view, event, _slice, moved) => {
                if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
                    const file = event.dataTransfer.files[0];
                    event.preventDefault();
                    const upload = file.type.indexOf('image') === 0 ? uploadImage : uploadFile;
                    upload(file).then(url => {
                        if (url) {
                            const { schema } = view.state;
                            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                            if (coordinates) {
                                const node = file.type.indexOf('image') === 0
                                    ? schema.nodes.image.create({ src: url, width: '100%', align: 'center' })
                                    : schema.nodes.mediaBlock.create({
                                        url,
                                        name: file.name,
                                        mime: file.type || '',
                                        size: file.size,
                                        kind: getMediaKindFromFile(file),
                                    });
                                const transaction = view.state.tr.insert(coordinates.pos, node);
                                view.dispatch(transaction);
                            }
                        }
                    });
                    return true;
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
             const html = editor.getHTML();
             const normalizedHtml = normalizeMindMapHtmlForTurndown(html);
             const markdown = turndownService.turndown(normalizedHtml);
             const json = editor.getJSON();
             externalSigRef.current = getContentSignature(json, markdown);

             try {
                 const hasDiv = html.includes('data-type="mind-map"');
                 const hasFence = markdown.includes('```mindmap');
                 const sig = `${hasDiv}-${hasFence}-${markdown.length}`;
                 if (hasDiv && sig !== mmSigRef.current) mmSigRef.current = sig;
             } catch {}

             onChange({
                markdown,
                json,
                html,
                text: editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
             });
        }
    });

    useEffect(() => {
        if (!editor) return;
        const storage = editor.storage as typeof editor.storage & {
            smartDocument?: {
                uploadImage?: (file: File) => Promise<string | null>;
                uploadFile?: (file: File) => Promise<string | null>;
                pages?: SmartDocumentPageLink[];
                currentDocumentId?: string | null;
            };
        };
        storage.smartDocument = {
            ...(storage.smartDocument || {}),
            uploadImage,
            uploadFile,
            pages,
            currentDocumentId,
        };
    }, [currentDocumentId, editor, pages, uploadImage, uploadFile]);

    useEffect(() => {
        if (!editor) return;
        ensureEditorBlockIds(editor);
    }, [editor, content, contentJson]);

    useEffect(() => {
        if (!editor) return;
        const nextSignature = getContentSignature(contentJson, content);
        if (nextSignature === externalSigRef.current) return;
        if (editor.isFocused) return;

        if (isValidDocJson(contentJson)) {
            const currentSignature = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
            if (currentSignature !== nextSignature) {
                editor.commands.setContent(contentJson, { emitUpdate: false });
                ensureEditorBlockIds(editor);
            }
            externalSigRef.current = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
            return;
        }

        const currentMarkdown = editorToMarkdown(editor);
        if (currentMarkdown !== (content || '')) {
            editor.commands.setContent(markdownToHtml(content || ''), { emitUpdate: false });
            ensureEditorBlockIds(editor);
        }
        externalSigRef.current = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
    }, [content, contentJson, editor]);

    const getLiveBlock = useCallback((block: BlockHandleInfo) => {
        if (!editor) return null;
        const found = findBlockById(editor, block.id);
        if (!found) return null;
        return {
            ...found,
            context: getBlockContext(editor, found.pos),
        };
    }, [editor]);

    const closeBlockMenu = useCallback(() => {
        setBlockMenuOpen(false);
    }, []);

    const moveBlock = useCallback((block: BlockHandleInfo, direction: 'up' | 'down') => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const { node, pos, context } = live;
        const { parent, index } = context;
        if (direction === 'up' && index <= 0) return;
        if (direction === 'down' && index >= parent.childCount - 1) return;

        const rawInsertPos = direction === 'up'
            ? pos - parent.child(index - 1).nodeSize
            : pos + node.nodeSize + parent.child(index + 1).nodeSize;

        const tr = editor.state.tr;
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(tr.mapping.map(rawInsertPos), node);
        editor.view.dispatch(tr.scrollIntoView());
        setCommentPanelBlock((current) => current?.id === block.id ? null : current);
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const moveBlockToTarget = useCallback((sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo, placement: 'before' | 'after') => {
        if (!editor || !shellRef.current || sourceBlock.id === targetBlock.id) return;

        const source = getLiveBlock(sourceBlock);
        const target = getLiveBlock(targetBlock);
        if (!source || !target) return;

        const sourceInfo = getBlockInfoById(editor, sourceBlock.id, shellRef.current as HTMLElement);
        const targetInfo = getBlockInfoById(editor, targetBlock.id, shellRef.current as HTMLElement);
        if (!sourceInfo || !targetInfo || !canMoveBlockToTarget(editor, sourceInfo, targetInfo, placement)) return;

        const rawInsertPos = placement === 'before'
            ? target.pos
            : target.pos + target.node.nodeSize;

        if (rawInsertPos >= source.pos && rawInsertPos <= source.pos + source.node.nodeSize) return;

        const tr = editor.state.tr;
        deleteSourceForMove(editor, tr, source);
        tr.insert(tr.mapping.map(rawInsertPos), source.node);
        editor.view.dispatch(tr.scrollIntoView());
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const duplicateBlock = useCallback((block: BlockHandleInfo) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const clone = cloneBlockWithFreshIds(editor, live.node);
        const tr = editor.state.tr.insert(live.pos + live.node.nodeSize, clone);
        editor.view.dispatch(tr.scrollIntoView());
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const deleteBlock = useCallback((block: BlockHandleInfo) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const { node, pos, context } = live;
        const { parent, parentDepth, parentPos } = context;
        const schema = editor.state.schema;
        const emptyParagraph = schema.nodes.paragraph.create({ blockId: createBlockId() });
        const tr = editor.state.tr;

        if (LIST_ITEM_TYPES.has(node.type.name) && LIST_CONTAINER_TYPES.has(parent.type.name) && parent.childCount <= 1 && parentDepth > 0) {
            const parentContext = getBlockContext(editor, parentPos);
            if (parentContext.parent.type.name === 'doc' && parentContext.parent.childCount <= 1) {
                tr.replaceWith(parentPos, parentPos + parent.nodeSize, emptyParagraph);
            } else if (parentContext.parent.type.name !== 'doc' && parentContext.parent.childCount <= 1) {
                tr.replaceWith(parentPos, parentPos + parent.nodeSize, emptyParagraph);
            } else {
                tr.delete(parentPos, parentPos + parent.nodeSize);
            }
        } else if (parent.type.name === 'doc' && parent.childCount <= 1) {
            tr.replaceWith(pos, pos + node.nodeSize, emptyParagraph);
        } else if (parent.type.name !== 'doc' && parent.childCount <= 1) {
            tr.replaceWith(pos, pos + node.nodeSize, emptyParagraph);
        } else {
            tr.delete(pos, pos + node.nodeSize);
        }

        editor.view.dispatch(tr.scrollIntoView());
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const turnBlockInto = useCallback((block: BlockHandleInfo, target: 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'quote') => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live || !TEXT_TURN_TYPES.has(live.node.type.name)) return;

        const { node, pos } = live;
        const attrs = { ...(node.attrs as Record<string, any>) };

        if (target === 'paragraph') {
            delete attrs.level;
            const tr = editor.state.tr.setNodeMarkup(pos, editor.state.schema.nodes.paragraph, attrs, node.marks);
            editor.view.dispatch(tr.scrollIntoView());
            closeBlockMenu();
            return;
        }

        if (target === 'h1' || target === 'h2' || target === 'h3') {
            const level = target === 'h1' ? 1 : target === 'h2' ? 2 : 3;
            const tr = editor.state.tr.setNodeMarkup(pos, editor.state.schema.nodes.heading, {
                ...attrs,
                level,
            }, node.marks);
            editor.view.dispatch(tr.scrollIntoView());
            closeBlockMenu();
            return;
        }

        const chain = editor.chain().focus(pos + 1);
        if (node.type.name === 'heading') chain.setParagraph();
        if (target === 'bullet') chain.toggleBulletList().run();
        if (target === 'ordered') chain.toggleOrderedList().run();
        if (target === 'todo') chain.toggleTaskList().run();
        if (target === 'quote') chain.toggleBlockquote().run();
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const copyBlockLink = useCallback(async (block: BlockHandleInfo) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        const blockId = live?.node.attrs.blockId || block.id;
        const hash = blockDomId(blockId);
        if (!hash) return;

        const url = new URL(window.location.href);
        url.hash = hash;

        const copied = await copyTextToClipboard(url.toString());
        if (!copied) {
            window.prompt('Copy block link', url.toString());
        }

        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const refreshBlockPanelInfo = useCallback((blockId: string) => {
        if (!editor || !shellRef.current) return;
        const nextInfo = getBlockInfoById(editor, blockId, shellRef.current);
        if (nextInfo) {
            setCommentPanelBlock(nextInfo);
            setHoveredBlock((current) => current?.id === blockId ? nextInfo : current);
        }
    }, [editor]);

    const updateBlockComments = useCallback((block: BlockHandleInfo, comments: BlockComment[]) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const nextComments = normalizeBlockComments(comments);
        const tr = editor.state.tr.setNodeMarkup(live.pos, undefined, {
            ...live.node.attrs,
            blockComments: nextComments,
        }, live.node.marks);
        editor.view.dispatch(tr.scrollIntoView());

        window.requestAnimationFrame(() => refreshBlockPanelInfo(block.id));
    }, [editor, getLiveBlock, refreshBlockPanelInfo]);

    const openBlockComments = useCallback((block: BlockHandleInfo) => {
        if (!editor || !shellRef.current) return;
        const nextInfo = getBlockInfoById(editor, block.id, shellRef.current) || block;
        setCommentPanelBlock(nextInfo);
        setBlockMenuOpen(false);
    }, [editor]);

    const closeBlockComments = useCallback(() => {
        setCommentPanelBlock(null);
    }, []);

    const addBlockComment = useCallback((block: BlockHandleInfo, text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        const live = getLiveBlock(block);
        if (!live) return;

        updateBlockComments(block, [
            ...normalizeBlockComments(live.node.attrs.blockComments),
            {
                id: createCommentId(),
                text: trimmed,
                author: CURRENT_USER_ID,
                createdAt: new Date().toISOString(),
            },
        ]);
    }, [getLiveBlock, updateBlockComments]);

    const resolveBlockComment = useCallback((block: BlockHandleInfo, commentId: string) => {
        const live = getLiveBlock(block);
        if (!live) return;

        updateBlockComments(block, normalizeBlockComments(live.node.attrs.blockComments).map((comment) => (
            comment.id === commentId ? { ...comment, resolved: !comment.resolved } : comment
        )));
    }, [getLiveBlock, updateBlockComments]);

    const deleteBlockComment = useCallback((block: BlockHandleInfo, commentId: string) => {
        const live = getLiveBlock(block);
        if (!live) return;

        updateBlockComments(block, normalizeBlockComments(live.node.attrs.blockComments).filter((comment) => comment.id !== commentId));
    }, [getLiveBlock, updateBlockComments]);

    const handleEditorMouseMove = useCallback((event: React.MouseEvent) => {
        if (!editor) return;
        setColumnResizeHandles(getColumnResizeHandles(editor, shellRef.current, event.clientY));
        const nextBlock = getBlockInfoFromEvent(editor, event, shellRef.current);
        if (!nextBlock) return;

        setHoveredBlock((current) => {
            if (
                current?.id === nextBlock.id &&
                Math.abs(current.top - nextBlock.top) < 1 &&
                Math.abs(current.height - nextBlock.height) < 1
            ) {
                return current;
            }
            return nextBlock;
        });
    }, [editor]);

    const handleEditorMouseLeave = useCallback(() => {
        if (!blockMenuOpen && !dragBlock) setHoveredBlock(null);
        setColumnResizeHandles([]);
    }, [blockMenuOpen, dragBlock]);

    const applyColumnWidths = useCallback((leftColumnId: string, rightColumnId: string, leftWidth: number, rightWidth: number, addToHistory = false) => {
        if (!editor) return;

        const left = findBlockById(editor, leftColumnId);
        const right = findBlockById(editor, rightColumnId);
        if (!left || !right) return;

        const tr = editor.state.tr;
        tr.setNodeMarkup(left.pos, undefined, {
            ...left.node.attrs,
            width: formatColumnWidth(leftWidth),
        }, left.node.marks);
        tr.setNodeMarkup(right.pos, undefined, {
            ...right.node.attrs,
            width: formatColumnWidth(rightWidth),
        }, right.node.marks);

        if (!addToHistory) tr.setMeta('addToHistory', false);
        editor.view.dispatch(tr);
        window.requestAnimationFrame(() => {
            setColumnResizeHandles(getColumnResizeHandles(editor, shellRef.current));
        });
    }, [editor]);

    const handleColumnResizeStart = useCallback((event: React.MouseEvent, handle: ColumnResizeHandleInfo) => {
        if (!editor || !shellRef.current) return;

        event.preventDefault();
        event.stopPropagation();

        const left = findBlockById(editor, handle.leftColumnId);
        const right = findBlockById(editor, handle.rightColumnId);
        const listElement = (editor.view.dom as HTMLElement).querySelector(`[data-type="column-list"][data-block-id="${handle.columnListId}"]`);
        if (!left || !right || !(listElement instanceof HTMLElement)) return;

        const leftElement = getColumnElementById(editor, handle.leftColumnId);
        const rightElement = getColumnElementById(editor, handle.rightColumnId);
        const listWidth = listElement.getBoundingClientRect().width || 1;
        const leftStart = getColumnWidthPercent(left.node, leftElement, listWidth, 50);
        const rightStart = getColumnWidthPercent(right.node, rightElement, listWidth, 50);
        const widthTotal = Math.max(COLUMN_MIN_WIDTH_PERCENT * 2, leftStart + rightStart);
        const startX = event.clientX;
        const previousCursor = document.body.style.cursor;

        document.body.style.cursor = 'col-resize';

        const resizeTo = (clientX: number, addToHistory = false) => {
            const deltaPercent = ((clientX - startX) / listWidth) * 100;
            const nextLeft = Math.max(COLUMN_MIN_WIDTH_PERCENT, Math.min(widthTotal - COLUMN_MIN_WIDTH_PERCENT, leftStart + deltaPercent));
            const nextRight = widthTotal - nextLeft;
            applyColumnWidths(handle.leftColumnId, handle.rightColumnId, nextLeft, nextRight, addToHistory);
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            resizeTo(moveEvent.clientX);
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            upEvent.preventDefault();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = previousCursor;
            resizeTo(upEvent.clientX, true);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [applyColumnWidths, editor]);

    const handleBlockDragStart = useCallback((event: React.MouseEvent, block: BlockHandleInfo) => {
        if (!editor || !shellRef.current) return;

        event.preventDefault();
        event.stopPropagation();

        const source = getBlockInfoById(editor, block.id, shellRef.current) || block;
        let currentDrag: DragBlockState = { source };
        const previousCursor = document.body.style.cursor;

        document.body.style.cursor = 'grabbing';
        setBlockMenuOpen(false);
        setDragBlock(currentDrag);

        const updateDropTarget = (clientX: number, clientY: number) => {
            const target = getBlockInfoFromPoint(editor, clientX, clientY, shellRef.current);
            if (!target || target.id === source.id) {
                currentDrag = { source };
                setDragBlock(currentDrag);
                return;
            }

            const shellTop = shellRef.current?.getBoundingClientRect().top || 0;
            const placement = clientY < target.top + shellTop + target.height / 2 ? 'before' : 'after';
            const allowed = canMoveBlockToTarget(editor, source, target, placement);

            currentDrag = {
                source,
                drop: {
                    target,
                    placement,
                    top: placement === 'before' ? target.top : target.top + target.height,
                    left: target.left + 44,
                    width: target.width,
                    allowed,
                },
            };
            setDragBlock(currentDrag);
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            updateDropTarget(moveEvent.clientX, moveEvent.clientY);
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            upEvent.preventDefault();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = previousCursor;

            if (currentDrag.drop?.allowed) {
                moveBlockToTarget(currentDrag.source, currentDrag.drop.target, currentDrag.drop.placement);
            }

            setDragBlock(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        updateDropTarget(event.clientX, event.clientY);
    }, [editor, moveBlockToTarget]);

    const handleEditorDragOver = useCallback((event: React.DragEvent) => {
        if (!editor || !dragBlock || !shellRef.current) return;
        const target = getBlockInfoFromEvent(editor, event as unknown as React.MouseEvent, shellRef.current);
        if (!target || target.id === dragBlock.source.id) return;

        const placement = event.clientY < target.top + shellRef.current.getBoundingClientRect().top + target.height / 2
            ? 'before'
            : 'after';
        const allowed = canMoveBlockToTarget(editor, dragBlock.source, target, placement);

        event.preventDefault();
        event.dataTransfer.dropEffect = allowed ? 'move' : 'none';

        setDragBlock({
            source: dragBlock.source,
            drop: {
                target,
                placement,
                top: placement === 'before' ? target.top : target.top + target.height,
                left: target.left + 44,
                width: target.width,
                allowed,
            },
        });
    }, [dragBlock, editor]);

    const handleEditorDrop = useCallback((event: React.DragEvent) => {
        if (!dragBlock?.drop) return;
        event.preventDefault();

        if (dragBlock.drop.allowed) {
            moveBlockToTarget(dragBlock.source, dragBlock.drop.target, dragBlock.drop.placement);
        }

        setDragBlock(null);
    }, [dragBlock, moveBlockToTarget]);

    const handleEditorDragEnd = useCallback(() => {
        setDragBlock(null);
    }, []);

    const addImage = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            if (input.files?.length) {
                const file = input.files[0];
                const url = await uploadImage(file);
                if (url) {
                    editor?.chain().focus().setImage({ src: url, width: '100%', align: 'center' } as any).run();
                }
            }
        };
        input.click();
    }, [editor, uploadImage]);

    if (!editor) return null;

    const commentPanelComments = commentPanelBlock
        ? normalizeBlockComments(findBlockById(editor, commentPanelBlock.id)?.node.attrs.blockComments)
        : [];

    return (
        <div
            ref={shellRef}
            className="flex h-full min-h-[500px] relative"
            onDragOver={handleEditorDragOver}
            onDrop={handleEditorDrop}
            onDragEnd={handleEditorDragEnd}
        >
            <BlockHandleLayer
                block={hoveredBlock}
                menuOpen={blockMenuOpen}
                onMenuOpenChange={setBlockMenuOpen}
                onMove={moveBlock}
                onDuplicate={duplicateBlock}
                onDelete={deleteBlock}
                onTurnInto={turnBlockInto}
                onCopyLink={copyBlockLink}
                onOpenComments={openBlockComments}
                onDragStart={handleBlockDragStart}
            />
            <BlockDropIndicator dragBlock={dragBlock} />
            <ColumnResizeLayer handles={columnResizeHandles} onResizeStart={handleColumnResizeStart} />
            <BlockCommentPanel
                block={commentPanelBlock}
                comments={commentPanelComments}
                onClose={closeBlockComments}
                onAdd={addBlockComment}
                onResolve={resolveBlockComment}
                onDelete={deleteBlockComment}
            />
            {/* Outline / Table of Contents (Left Side) */}
            {showTOC && (
                <div className="hidden xl:flex flex-col w-64 sticky top-0 h-full border-r border-gray-100 bg-gray-50/30 flex-shrink-0 transition-all duration-300">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                         <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center">
                            <ListOrdered className="w-3 h-3 mr-2" /> 
                            大纲
                         </h4>
                         <button 
                            onClick={() => setShowTOC(false)} 
                            className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded"
                            title="隐藏大纲"
                         >
                            <X className="w-3 h-3" />
                         </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <TableOfContents editor={editor} />
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col min-w-0 transition-all duration-300">
                <EditorToolbar 
                    editor={editor} 
                    onAddImage={addImage} 
                    showTOC={showTOC} 
                    onToggleTOC={() => setShowTOC(!showTOC)} 
                />
                <div
                    className="flex-1 bg-white cursor-text p-8 sm:p-12 max-w-5xl mx-auto w-full"
                    onClick={() => editor.chain().focus().run()}
                    onMouseMove={handleEditorMouseMove}
                    onMouseLeave={handleEditorMouseLeave}
                >
                    <EditorContent editor={editor} />
                </div>
            </div>
        </div>
    )
}

const menuButtonClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

const BlockHandleLayer = ({
    block,
    menuOpen,
    onMenuOpenChange,
    onMove,
    onDuplicate,
    onDelete,
    onTurnInto,
    onCopyLink,
    onOpenComments,
    onDragStart,
}: {
    block: BlockHandleInfo | null;
    menuOpen: boolean;
    onMenuOpenChange: (open: boolean) => void;
    onMove: (block: BlockHandleInfo, direction: 'up' | 'down') => void;
    onDuplicate: (block: BlockHandleInfo) => void;
    onDelete: (block: BlockHandleInfo) => void;
    onTurnInto: (block: BlockHandleInfo, target: 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'quote') => void;
    onCopyLink: (block: BlockHandleInfo) => void;
    onOpenComments: (block: BlockHandleInfo) => void;
    onDragStart: (event: React.MouseEvent, block: BlockHandleInfo) => void;
}) => {
    if (!block) return null;

    return (
        <div
            className="absolute z-30 flex items-start gap-1"
            style={{ top: Math.max(0, block.top), left: block.left }}
            contentEditable={false}
            onMouseDown={(event) => event.preventDefault()}
        >
            <button
                type="button"
                title="拖动块"
                onMouseDown={(event) => onDragStart(event, block)}
                className="mt-0.5 flex h-7 w-7 cursor-grab items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            {block.commentCount > 0 && (
                <button
                    type="button"
                    title="评论"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenComments(block);
                    }}
                    className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded px-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span className="ml-0.5 text-[10px] font-semibold">{block.commentCount}</span>
                </button>
            )}
            <div className="relative">
                <button
                    type="button"
                    title="块菜单"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onMenuOpenChange(!menuOpen);
                    }}
                    className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded ${
                        menuOpen ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>

                {menuOpen && (
                    <div
                        className="absolute left-8 top-0 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <button className={menuButtonClass} disabled={!block.canMoveUp} onClick={() => onMove(block, 'up')}>
                            <ArrowUp className="h-3.5 w-3.5" /> 上移
                        </button>
                        <button className={menuButtonClass} disabled={!block.canMoveDown} onClick={() => onMove(block, 'down')}>
                            <ArrowDown className="h-3.5 w-3.5" /> 下移
                        </button>
                        <button className={menuButtonClass} onClick={() => onDuplicate(block)}>
                            <Copy className="h-3.5 w-3.5" /> 复制块
                        </button>
                        <button className={menuButtonClass} onClick={() => onCopyLink(block)}>
                            <LinkIcon className="h-3.5 w-3.5" /> 复制块链接
                        </button>

                        <button className={menuButtonClass} onClick={() => onOpenComments(block)}>
                            <MessageSquare className="h-3.5 w-3.5" /> 评论{block.commentCount ? ` (${block.commentCount})` : ''}
                        </button>

                        {block.canTurnIntoText && (
                            <>
                                <div className="my-1 h-px bg-gray-100" />
                                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Turn into</div>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'paragraph')}>
                                    <Type className="h-3.5 w-3.5" /> 普通文本
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'h1')}>
                                    <Heading1 className="h-3.5 w-3.5" /> 一级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'h2')}>
                                    <Heading2 className="h-3.5 w-3.5" /> 二级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'h3')}>
                                    <Heading3 className="h-3.5 w-3.5" /> 三级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'bullet')}>
                                    <List className="h-3.5 w-3.5" /> 项目列表
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'ordered')}>
                                    <ListOrdered className="h-3.5 w-3.5" /> 编号列表
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'todo')}>
                                    <CheckSquare className="h-3.5 w-3.5" /> 待办
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'quote')}>
                                    <Quote className="h-3.5 w-3.5" /> 引用
                                </button>
                            </>
                        )}

                        <div className="my-1 h-px bg-gray-100" />
                        <button className={`${menuButtonClass} text-red-600 hover:bg-red-50`} onClick={() => onDelete(block)}>
                            <Trash2 className="h-3.5 w-3.5" /> 删除块
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const formatCommentTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const BlockCommentPanel = ({
    block,
    comments,
    onClose,
    onAdd,
    onResolve,
    onDelete,
}: {
    block: BlockHandleInfo | null;
    comments: BlockComment[];
    onClose: () => void;
    onAdd: (block: BlockHandleInfo, text: string) => void;
    onResolve: (block: BlockHandleInfo, commentId: string) => void;
    onDelete: (block: BlockHandleInfo, commentId: string) => void;
}) => {
    const [draft, setDraft] = useState('');

    useEffect(() => {
        setDraft('');
    }, [block?.id]);

    if (!block) return null;

    const activeComments = comments.filter((comment) => !comment.resolved);
    const resolvedComments = comments.filter((comment) => comment.resolved);
    const panelLeft = typeof window === 'undefined'
        ? block.left + block.width + 72
        : Math.max(8, Math.min(block.left + block.width + 72, window.innerWidth - 344));
    const submitDraft = () => {
        if (!draft.trim()) return;
        onAdd(block, draft);
        setDraft('');
    };

    return (
        <div
            className="absolute z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
            style={{
                top: Math.max(8, block.top),
                left: panelLeft,
            }}
            contentEditable={false}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <MessageSquare className="h-4 w-4" />
                    评论
                </div>
                <button
                    type="button"
                    title="关闭评论"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    onClick={onClose}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {comments.length === 0 && (
                    <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                        还没有评论。
                    </div>
                )}

                {[...activeComments, ...resolvedComments].map((comment) => (
                    <div
                        key={comment.id}
                        className={`rounded-md border px-3 py-2 ${
                            comment.resolved ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-200 bg-white text-gray-700'
                        }`}
                    >
                        <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-xs font-semibold">
                                {formatCommentAuthor(comment.author)}
                                <span className="ml-2 font-normal text-gray-400">{formatCommentTime(comment.createdAt)}</span>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-1">
                                <button
                                    type="button"
                                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100"
                                    onClick={() => onResolve(block, comment.id)}
                                >
                                    {comment.resolved ? '重新打开' : '解决'}
                                </button>
                                <button
                                    type="button"
                                    title="删除评论"
                                    className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => onDelete(block, comment.id)}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                        <div className={`whitespace-pre-wrap text-xs leading-5 ${comment.resolved ? 'line-through' : ''}`}>
                            {comment.text}
                        </div>
                    </div>
                ))}
            </div>

            <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        submitDraft();
                    }
                }}
                placeholder="添加评论..."
                className="mt-3 min-h-20 w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    disabled={!draft.trim()}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={submitDraft}
                >
                    添加评论
                </button>
            </div>
        </div>
    );
};

const BlockDropIndicator = ({ dragBlock }: { dragBlock: DragBlockState | null }) => {
    const drop = dragBlock?.drop;
    if (!drop) return null;

    return (
        <div
            className={`pointer-events-none absolute z-40 h-0.5 rounded-full ${
                drop.allowed ? 'bg-primary' : 'bg-red-400'
            }`}
            style={{
                top: drop.top,
                left: drop.left,
                width: drop.width,
            }}
        />
    );
};

const ColumnResizeLayer = ({
    handles,
    onResizeStart,
}: {
    handles: ColumnResizeHandleInfo[];
    onResizeStart: (event: React.MouseEvent, handle: ColumnResizeHandleInfo) => void;
}) => {
    if (!handles.length) return null;

    return (
        <>
            {handles.map((handle) => (
                <button
                    key={handle.id}
                    type="button"
                    title="调整列宽"
                    className="absolute z-40 w-2 rounded-full bg-transparent transition-colors hover:bg-gray-300/70"
                    style={{
                        top: handle.top,
                        left: handle.left,
                        height: handle.height,
                        cursor: 'col-resize',
                    }}
                    onMouseDown={(event) => onResizeStart(event, handle)}
                >
                    <span className="mx-auto block h-full w-px bg-gray-300/70" />
                </button>
            ))}
        </>
    );
};

const TableOfContents = ({ editor }: { editor: any }) => {
    const [headings, setHeadings] = useState<{ level: number; text: string; id: string; pos: number }[]>([]);

    useEffect(() => {
        if (!editor) return;

        const updateHeadings = () => {
            const items: any[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
                if (node.type.name === 'heading') {
                    items.push({
                        level: node.attrs.level,
                        text: node.textContent,
                        id: `heading-${pos}`, // Simple ID
                        pos: pos
                    });
                }
            });
            setHeadings(items);
        };

        updateHeadings();
        editor.on('update', updateHeadings);

        return () => {
            editor.off('update', updateHeadings);
        };
    }, [editor]);

    if (headings.length === 0) return <div className="text-xs text-gray-400 pl-2 italic">暂无标题，请使用 H1-H6 添加</div>;

    return (
        <ul className="space-y-1 font-sans">
            {headings.map((heading, index) => (
                <li 
                    key={index} 
                    className={`
                        text-sm py-1.5 pr-2 rounded-md cursor-pointer hover:bg-gray-100 hover:text-primary transition-colors truncate block
                        ${heading.level === 1 ? 'font-bold text-gray-900 pl-2' : ''}
                        ${heading.level === 2 ? 'font-medium text-gray-700 pl-4' : ''}
                        ${heading.level === 3 ? 'text-gray-600 pl-6' : ''}
                        ${heading.level === 4 ? 'text-gray-500 pl-8 text-xs' : ''}
                        ${heading.level >= 5 ? 'text-gray-400 pl-10 text-xs' : ''}
                    `}
                    onClick={() => {
                        editor.chain().focus().setTextSelection(heading.pos + 1).run();
                        const element = editor.view.nodeDOM(heading.pos) as HTMLElement | null;
                        if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                >
                    {heading.text || '(空标题)'}
                </li>
            ))}
        </ul>
    );
};

const EditorToolbar = ({ editor, onAddImage, showTOC, onToggleTOC }: { editor: any, onAddImage: () => void, showTOC: boolean, onToggleTOC: () => void }) => {
    if (!editor) return null;

    const setLink = () => {
        const previousUrl = editor.getAttributes('link').href || '';
        const url = window.prompt('请输入链接地址', previousUrl);
        if (url === null) return;
        if (url.trim() === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    };

    return (
        <div className="border-b border-gray-200 p-2 flex items-center space-x-1 overflow-x-auto bg-white sticky top-0 z-10 shadow-sm">
             {/* TOC Toggle Button */}
            <ToolbarBtn 
                onClick={onToggleTOC} 
                isActive={showTOC}
                icon={<PanelLeft className={`w-4 h-4 ${showTOC ? 'text-primary' : 'text-gray-400'}`}/>} 
                label={showTOC ? "" : "大纲"}
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBold().run()} 
                isActive={editor.isActive('bold')} 
                icon={<Bold className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleItalic().run()} 
                isActive={editor.isActive('italic')} 
                icon={<Italic className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleStrike().run()} 
                isActive={editor.isActive('strike')} 
                icon={<Strikethrough className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleCode().run()} 
                isActive={editor.isActive('code')} 
                icon={<Code className="w-4 h-4"/>} 
            />
            <ToolbarBtn
                onClick={setLink}
                isActive={editor.isActive('link')}
                icon={<LinkIcon className="w-4 h-4"/>}
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
                disabled={!editor.isActive('link')}
                icon={<Unlink className="w-4 h-4"/>}
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} 
                isActive={editor.isActive('heading', { level: 1 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H1" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} 
                isActive={editor.isActive('heading', { level: 2 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H2" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} 
                isActive={editor.isActive('heading', { level: 3 })} 
                icon={<Type className="w-3 h-3"/>} 
                label="H3" 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBulletList().run()} 
                isActive={editor.isActive('bulletList')} 
                icon={<List className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleOrderedList().run()} 
                isActive={editor.isActive('orderedList')} 
                icon={<ListOrdered className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleTaskList().run()} 
                isActive={editor.isActive('taskList')} 
                icon={<CheckSquare className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBlockquote().run()} 
                isActive={editor.isActive('blockquote')} 
                icon={<Quote className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().setColumns(2).run()} 
                icon={<Columns className="w-4 h-4"/>} 
                label="2栏"
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().setColumns(3).run()} 
                icon={<Columns className="w-4 h-4"/>} 
                label="3栏"
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} 
                icon={<TableIcon className="w-4 h-4"/>} 
                label="表格"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                disabled={!editor.can().addColumnAfter()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="+列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().deleteColumn().run()}
                disabled={!editor.can().deleteColumn()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="-列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().addRowAfter().run()}
                disabled={!editor.can().addRowAfter()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="+行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().deleteRow().run()}
                disabled={!editor.can().deleteRow()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="-行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().deleteTable().run()}
                disabled={!editor.can().deleteTable()}
                icon={<X className="w-4 h-4"/>}
                label="删表"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().insertContent({
                    type: 'mindMap',
                    attrs: {
                        data: { 
                            nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }], 
                            edges: [] 
                        }
                    }
                }).run()} 
                icon={<Network className="w-4 h-4"/>} 
                label="导图"
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={onAddImage}  
                icon={<ImageIcon className="w-4 h-4"/>} 
                label="图片"
            />
        </div>
    );
};

function ToolbarBtn({ icon, label, onClick, isActive, disabled }: { icon: React.ReactNode; label?: string; onClick?: () => void; isActive?: boolean; disabled?: boolean }) {
    return (
        <button 
            onClick={onClick}
            disabled={disabled}
            className={`p-1.5 rounded flex items-center space-x-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isActive ? 'bg-gray-200 text-black' : 'text-gray-600 hover:bg-gray-200'}`}
        >
            {icon}
            {label && <span className="text-xs font-bold">{label}</span>}
        </button>
    );
}
