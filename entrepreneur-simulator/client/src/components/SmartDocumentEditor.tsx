import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bold, Italic, Type, Strikethrough, Quote, ListOrdered, List, CheckSquare, 
  Code, PanelLeft, Columns, Table as TableIcon, Image as ImageIcon, X, Network,
  Link as LinkIcon, Unlink, AlignLeft, AlignCenter, AlignRight, Captions,
  ImagePlus, Download, ExternalLink, Maximize2, Trash2, Copy, GripVertical,
  MoreHorizontal, ArrowUp, ArrowDown, Heading1, Heading2, Heading3, MessageSquare,
  Paperclip, Video, Music, FileText, RefreshCw, Palette, ChevronRight, AlertTriangle,
  Plus, ListTree
} from 'lucide-react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { selectedRect } from '@tiptap/pm/tables';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { api, CURRENT_USER_ID, type SOPContentRepairResult } from '../services/api';
import { createSmartDocumentExtensions } from '../features/document-editor/createEditorExtensions';
import { SmartCodeBlock } from '../features/document-editor/nodes/SmartCodeBlock';
import { FindReplaceExtension } from '../features/document-editor/findReplace/FindReplaceExtension';
import { EditorFindReplace, type FindPanelMode } from '../features/document-editor/ui/EditorFindReplace';
import { ReadOnlyGuardExtension } from '../features/document-editor/ReadOnlyGuardExtension';
import {
    SmartClipboardExtension,
    type SmartClipboardUploadController,
} from '../features/document-editor/SmartClipboardExtension';
import { serializeToMarkdown } from '../features/document-editor/serialization/toMarkdown';
import { serializeToPlainText } from '../features/document-editor/serialization/toPlainText';
import { decodeLegacyEncodedFormula } from '../features/document-editor/serialization/serializationUtils';
import { installMindMapMarkdownFence } from '../features/document-editor/serialization/mindMapMarkdownFence';
import type { DocumentNodeJson } from '../features/document-editor/schema/documentSchema';
import { SMART_DOCUMENT_SCHEMA_VERSION } from '../features/document-editor/useRevisionedSaveQueue';
import {
    WhiteboardEmbed,
    insertWhiteboardIntoEditor,
} from '../features/whiteboard/embed/WhiteboardExtension';
import {
    EditorCompactToolbar,
    EditorSelectionMenu,
    EditorTableMenu,
} from '../features/document-editor/ui/EditorMenus';
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
    TemplateButtonBlock,
    SyncedBlock,
    PageLinkBlock,
    InlineEquation,
    EquationBlock,
    DatabaseBlock,
    promptForImageUrl,
    promptForText,
    promptForUrl,
} from './TiptapExtensions';

// --- Parsers ---

const mdParser = new MarkdownIt({ html: true });
installMindMapMarkdownFence(mdParser);

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
    'whiteboardEmbed',
    'toggleBlock',
    'calloutBlock',
    'bookmarkBlock',
    'embedBlock',
    'mediaBlock',
    'templateButtonBlock',
    'syncedBlock',
    'pageLinkBlock',
    'equationBlock',
    'databaseBlock',
];
const BLOCK_IDENTITY_TRANSACTION_META = 'smartDocumentBlockIdentity';

const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const TEXT_TURN_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock']);
const TEXT_STYLE_BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem']);
const TABLE_CELL_BACKGROUND_ATTRIBUTE = 'backgroundColor';
const BLOCK_TEXT_COLOR_ATTRIBUTE = 'blockTextColor';
const BLOCK_BACKGROUND_COLOR_ATTRIBUTE = 'blockBackgroundColor';

const TABLE_CELL_BACKGROUND_COLORS = [
    { label: '默认', value: null, swatch: 'transparent' },
    { label: '灰色', value: '#f3f4f6', swatch: '#f3f4f6' },
    { label: '黄色', value: '#fef3c7', swatch: '#fef3c7' },
    { label: '橙色', value: '#ffedd5', swatch: '#ffedd5' },
    { label: '红色', value: '#fee2e2', swatch: '#fee2e2' },
    { label: '绿色', value: '#dcfce7', swatch: '#dcfce7' },
    { label: '蓝色', value: '#dbeafe', swatch: '#dbeafe' },
    { label: '紫色', value: '#ede9fe', swatch: '#ede9fe' },
];

const BLOCK_COLOR_TOKENS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
type BlockColorToken = typeof BLOCK_COLOR_TOKENS[number];
type BlockColorValue = BlockColorToken | null;

const BLOCK_TEXT_COLOR_OPTIONS: Array<{ label: string; value: BlockColorValue; swatch: string }> = [
    { label: '默认', value: null, swatch: '#111827' },
    { label: '灰色', value: 'gray', swatch: '#6b7280' },
    { label: '棕色', value: 'brown', swatch: '#92400e' },
    { label: '橙色', value: 'orange', swatch: '#c2410c' },
    { label: '黄色', value: 'yellow', swatch: '#a16207' },
    { label: '绿色', value: 'green', swatch: '#15803d' },
    { label: '蓝色', value: 'blue', swatch: '#2563eb' },
    { label: '紫色', value: 'purple', swatch: '#7c3aed' },
    { label: '粉色', value: 'pink', swatch: '#db2777' },
    { label: '红色', value: 'red', swatch: '#dc2626' },
];

const BLOCK_BACKGROUND_COLOR_OPTIONS: Array<{ label: string; value: BlockColorValue; swatch: string }> = [
    { label: '默认', value: null, swatch: '#ffffff' },
    { label: '灰色', value: 'gray', swatch: '#f3f4f6' },
    { label: '棕色', value: 'brown', swatch: '#f5f0ea' },
    { label: '橙色', value: 'orange', swatch: '#ffedd5' },
    { label: '黄色', value: 'yellow', swatch: '#fef3c7' },
    { label: '绿色', value: 'green', swatch: '#dcfce7' },
    { label: '蓝色', value: 'blue', swatch: '#dbeafe' },
    { label: '紫色', value: 'purple', swatch: '#ede9fe' },
    { label: '粉色', value: 'pink', swatch: '#fce7f3' },
    { label: '红色', value: 'red', swatch: '#fee2e2' },
];

const normalizeBlockColor = (value: unknown): BlockColorValue => {
    const token = String(value || '').trim().toLowerCase();
    return BLOCK_COLOR_TOKENS.includes(token as BlockColorToken) ? token as BlockColorToken : null;
};

const createBlockId = () => {
    const randomPart = Math.random().toString(36).slice(2, 9);
    return `blk_${Date.now().toString(36)}_${randomPart}`;
};

const normalizeTableCellBackground = (value: unknown) => {
    const color = String(value || '').trim().toLowerCase();
    if (!color || color === 'transparent' || color === 'none') return null;
    const allowed = new Set(TABLE_CELL_BACKGROUND_COLORS.map((item) => item.value).filter(Boolean));
    return allowed.has(color) ? color : null;
};

const renderTableCellBackground = (value: unknown) => {
    const color = normalizeTableCellBackground(value);
    if (!color) return {};

    return {
        'data-background-color': color,
        style: `background-color: ${color};`,
    };
};

const tableCellBackgroundAttribute = {
    default: null,
    parseHTML: (element: HTMLElement) => (
        normalizeTableCellBackground(element.getAttribute('data-background-color') || element.style.backgroundColor)
    ),
    renderHTML: (attributes: Record<string, any>) => renderTableCellBackground(attributes[TABLE_CELL_BACKGROUND_ATTRIBUTE]),
};

const TableCellWithBackground = TableCell.extend({
    addAttributes() {
        return {
            ...(this.parent?.() || {}),
            [TABLE_CELL_BACKGROUND_ATTRIBUTE]: tableCellBackgroundAttribute,
        };
    },
});

const TableHeaderWithBackground = TableHeader.extend({
    addAttributes() {
        return {
            ...(this.parent?.() || {}),
            [TABLE_CELL_BACKGROUND_ATTRIBUTE]: tableCellBackgroundAttribute,
        };
    },
});

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
const BLOCK_LINK_HIGHLIGHT_CLASS = 'smart-doc-block-link-highlight';
const BLOCK_LINK_TARGET_ATTRIBUTE = 'data-block-link-target';
const BLOCK_LINK_RETRY_MS = 8000;
const BLOCK_LINK_RETRY_INTERVAL_MS = 100;

const getBlockDomIdFromHash = () => {
    if (typeof window === 'undefined') return '';
    const rawHash = window.location.hash || '';
    if (!rawHash.startsWith('#block-')) return '';

    try {
        return decodeURIComponent(rawHash.slice(1));
    } catch {
        return rawHash.slice(1);
    }
};

const clearBlockLinkTargets = (root: ParentNode | null = null) => {
    if (typeof document === 'undefined') return;

    const scope = root || document;
    scope
        .querySelectorAll(`[${BLOCK_LINK_TARGET_ATTRIBUTE}], .${BLOCK_LINK_HIGHLIGHT_CLASS}`)
        .forEach((element) => {
            element.removeAttribute(BLOCK_LINK_TARGET_ATTRIBUTE);
            element.classList.remove(BLOCK_LINK_HIGHLIGHT_CLASS);
        });
};

const scrollBlockHashIntoView = (root: HTMLElement | null, attempt = 0): boolean => {
    if (typeof document === 'undefined') return false;

    const targetId = getBlockDomIdFromHash();
    if (!targetId) return false;

    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLElement) || (root && !root.contains(target))) {
        if (attempt < 8) {
            window.requestAnimationFrame(() => scrollBlockHashIntoView(root, attempt + 1));
        }
        return false;
    }

    clearBlockLinkTargets(root || document);

    target.scrollIntoView({ behavior: attempt === 0 ? 'smooth' : 'auto', block: 'center' });
    target.setAttribute(BLOCK_LINK_TARGET_ATTRIBUTE, 'true');
    target.classList.add(BLOCK_LINK_HIGHLIGHT_CLASS);
    window.setTimeout(() => {
        target.classList.remove(BLOCK_LINK_HIGHLIGHT_CLASS);
    }, 1800);

    return true;
};

const BlockIdentity = Extension.create({
    name: 'blockIdentity',
    priority: 1000,

    addStorage() {
        return {
            positions: new Map<string, number>(),
        };
    },

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
                            const domId = blockDomId(id);
                            return {
                                id: domId,
                                'data-block-id': id,
                                ...(domId === getBlockDomIdFromHash() ? { [BLOCK_LINK_TARGET_ATTRIBUTE]: 'true' } : {}),
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
                    [BLOCK_TEXT_COLOR_ATTRIBUTE]: {
                        default: null,
                        parseHTML: (element) => normalizeBlockColor(element.getAttribute('data-block-text-color')),
                        renderHTML: (attributes) => {
                            const color = normalizeBlockColor(attributes[BLOCK_TEXT_COLOR_ATTRIBUTE]);
                            return color ? { 'data-block-text-color': color } : {};
                        },
                    },
                    [BLOCK_BACKGROUND_COLOR_ATTRIBUTE]: {
                        default: null,
                        parseHTML: (element) => normalizeBlockColor(element.getAttribute('data-block-background-color')),
                        renderHTML: (attributes) => {
                            const color = normalizeBlockColor(attributes[BLOCK_BACKGROUND_COLOR_ATTRIBUTE]);
                            return color ? { 'data-block-background-color': color } : {};
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
                    const positions = new Map<string, number>();

                    newState.doc.descendants((node, pos) => {
                        if (!isBlockIdentityNode(node)) return true;

                        const currentId = node.attrs.blockId;
                        if (!currentId || seen.has(currentId)) {
                            try {
                                tr.setNodeMarkup(pos, undefined, {
                                    ...node.attrs,
                                    blockId: createBlockId(),
                                }, node.marks);
                            } catch (error) {
                                console.warn('[document-editor] Skipped block identity repair for an invalid legacy node.', {
                                    nodeType: node.type.name,
                                    error,
                                });
                            }
                            return true;
                        }

                        seen.add(currentId);
                        positions.set(currentId, pos);
                        return true;
                    });

                    this.storage.positions = positions;

                    if (!tr.docChanged) return null;
                    tr.setMeta('addToHistory', false);
                    tr.setMeta(BLOCK_IDENTITY_TRANSACTION_META, true);
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
    const positions = new Map<string, number>();

    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (!isBlockIdentityNode(node)) return true;

        const currentId = node.attrs.blockId;
        if (!currentId || seen.has(currentId)) {
            try {
                tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    blockId: createBlockId(),
                }, node.marks);
            } catch (error) {
                console.warn('[document-editor] Skipped block identity repair for an invalid legacy node.', {
                    nodeType: node.type.name,
                    error,
                });
            }
            return true;
        }

        seen.add(currentId);
        positions.set(currentId, pos);
        return true;
    });

    if (editor.storage?.blockIdentity) editor.storage.blockIdentity.positions = positions;

    if (tr.docChanged) {
        tr.setMeta('addToHistory', false);
        // Block IDs are editor runtime metadata. Hydrating a legacy document
        // on open must not masquerade as a user edit or auto-save a recovered
        // draft, especially on databases that do not yet support CAS.
        tr.setMeta('preventUpdate', true);
        tr.setMeta(BLOCK_IDENTITY_TRANSACTION_META, true);
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
    canStyleBlock: boolean;
    blockTextColor: BlockColorValue;
    blockBackgroundColor: BlockColorValue;
    commentCount: number;
    top: number;
    left: number;
    width: number;
    height: number;
};

type BlockDropPlacement = 'before' | 'after' | 'inside-start' | 'inside-end';

type DragBlockState = {
    source: BlockHandleInfo;
    drop?: {
        target: BlockHandleInfo;
        placement: BlockDropPlacement;
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

type TableCellBackgroundScope = 'cell' | 'row' | 'column';
type TurnIntoTarget = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'quote' | 'code' | 'toggle' | 'toggle-h1' | 'toggle-h2' | 'toggle-h3' | 'callout';

const TABLE_CELL_NODE_TYPES = new Set(['tableCell', 'tableHeader']);

const canUpdateTableCellBackground = (editor: any) => {
    try {
        return Boolean(editor?.isActive('table') && editor.can().setCellAttribute(TABLE_CELL_BACKGROUND_ATTRIBUTE, TABLE_CELL_BACKGROUND_COLORS[1].value));
    } catch {
        return false;
    }
};

const getCurrentTableCellBackground = (editor: any) => {
    const cellColor = normalizeTableCellBackground(editor?.getAttributes('tableCell')?.[TABLE_CELL_BACKGROUND_ATTRIBUTE]);
    const headerColor = normalizeTableCellBackground(editor?.getAttributes('tableHeader')?.[TABLE_CELL_BACKGROUND_ATTRIBUTE]);
    return cellColor || headerColor;
};

const getTableCellPositionsForScope = (editor: any, scope: Exclude<TableCellBackgroundScope, 'cell'>) => {
    try {
        const rect = selectedRect(editor.state);
        const positions = new Set<number>();

        if (scope === 'row') {
            for (let row = rect.top; row < rect.bottom; row += 1) {
                for (let col = 0; col < rect.map.width; col += 1) {
                    positions.add(rect.map.map[row * rect.map.width + col]);
                }
            }
        } else {
            for (let col = rect.left; col < rect.right; col += 1) {
                for (let row = 0; row < rect.map.height; row += 1) {
                    positions.add(rect.map.map[row * rect.map.width + col]);
                }
            }
        }

        return { rect, positions: Array.from(positions) };
    } catch {
        return null;
    }
};

const setTableCellBackground = (editor: any, scope: TableCellBackgroundScope, value: string | null) => {
    const color = normalizeTableCellBackground(value);
    const nextValue = color || null;

    if (scope === 'cell') {
        return editor.chain().focus().setCellAttribute(TABLE_CELL_BACKGROUND_ATTRIBUTE, nextValue).run();
    }

    const target = getTableCellPositionsForScope(editor, scope);
    if (!target || !target.positions.length) return false;

    const { rect, positions } = target;
    const tr = editor.state.tr;

    positions.forEach((relativePos) => {
        const cell = rect.table.nodeAt(relativePos);
        if (!cell || !TABLE_CELL_NODE_TYPES.has(cell.type.name)) return;

        tr.setNodeMarkup(
            tr.mapping.map(rect.tableStart + relativePos),
            undefined,
            {
                ...cell.attrs,
                [TABLE_CELL_BACKGROUND_ATTRIBUTE]: nextValue,
            },
            cell.marks,
        );
    });

    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    return true;
};

const createEmptyTextBlock = (schema: any) => (
    schema.nodes.paragraph.create({ blockId: createBlockId() })
);

const createEmptySiblingBlock = (editor: any, sourceNode: ProseMirrorNode) => {
    const schema = editor.state.schema;

    if (LIST_ITEM_TYPES.has(sourceNode.type.name)) {
        return sourceNode.type.create(
            {
                ...sourceNode.attrs,
                blockId: createBlockId(),
                checked: sourceNode.type.name === 'taskItem' ? false : sourceNode.attrs.checked,
                blockComments: [],
            },
            createEmptyTextBlock(schema),
        );
    }

    return createEmptyTextBlock(schema);
};

const getTextTurnAttrs = (node: ProseMirrorNode) => {
    const attrs = { ...(node.attrs as Record<string, any>) };
    delete attrs.level;
    delete attrs.checked;
    return attrs;
};

const getTextTurnInlineContent = (schema: any, node: ProseMirrorNode) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') return node.content;

    const text = node.textBetween(0, node.content.size, '\n');
    return text ? schema.text(text) : null;
};

const createTextTurnParagraph = (schema: any, node: ProseMirrorNode, attrs: Record<string, any>) => (
    schema.nodes.paragraph.create(attrs, getTextTurnInlineContent(schema, node))
);

const createTextTurnList = (schema: any, node: ProseMirrorNode, attrs: Record<string, any>, target: Extract<TurnIntoTarget, 'bullet' | 'ordered' | 'todo'>) => {
    const listType = target === 'ordered'
        ? schema.nodes.orderedList
        : target === 'todo'
            ? schema.nodes.taskList
            : schema.nodes.bulletList;
    const itemType = target === 'todo' ? schema.nodes.taskItem : schema.nodes.listItem;
    const itemAttrs = target === 'todo' ? { ...attrs, checked: false } : attrs;
    const paragraph = schema.nodes.paragraph.create(
        { blockId: createBlockId() },
        getTextTurnInlineContent(schema, node),
    );

    return listType.create(
        { blockId: createBlockId() },
        itemType.create(itemAttrs, paragraph),
    );
};

const createTextTurnContainerContent = (schema: any, node: ProseMirrorNode) => {
    if (node.type.name === 'blockquote') return node.content;
    return [schema.nodes.paragraph.create({ blockId: createBlockId() }, getTextTurnInlineContent(schema, node))];
};

const getBlockElementScore = (element: HTMLElement) => {
    const tagName = element.tagName.toLowerCase();
    const dataType = element.getAttribute('data-type') || '';

    if (element.classList.contains('notion-image-block')) return 110;
    if (dataType === 'mind-map') return 105;
    if (dataType === 'database') return 105;
    if (dataType === 'media' || dataType === 'embed' || dataType === 'bookmark' || dataType === 'template-button') return 104;
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
    const indexedPos = editor.storage?.blockIdentity?.positions?.get(id);
    if (typeof indexedPos === 'number') {
        const indexedNode = editor.state.doc.nodeAt(indexedPos);
        if (indexedNode?.attrs?.blockId === id) return { node: indexedNode, pos: indexedPos };
    }

    let result: { node: ProseMirrorNode; pos: number } | null = null;

    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.attrs?.blockId === id) {
            result = { node, pos };
            return false;
        }
        return true;
    });

    const found = result as { node: ProseMirrorNode; pos: number } | null;
    if (found && editor.storage?.blockIdentity?.positions) {
        editor.storage.blockIdentity.positions.set(id, found.pos);
    }

    return found;
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
        canStyleBlock: TEXT_STYLE_BLOCK_TYPES.has(found.node.type.name),
        blockTextColor: normalizeBlockColor(found.node.attrs[BLOCK_TEXT_COLOR_ATTRIBUTE]),
        blockBackgroundColor: normalizeBlockColor(found.node.attrs[BLOCK_BACKGROUND_COLOR_ATTRIBUTE]),
        commentCount: normalizeBlockComments(found.node.attrs.blockComments).filter((comment) => !comment.resolved).length,
        top: rect.top - shellRect.top,
        left: Math.max(8, rect.left - shellRect.left - 44),
        width: rect.width,
        height: rect.height,
    };
};

const getBlockInfoFromEvent = (editor: any, event: React.MouseEvent, shell: HTMLElement | null) => {
    return getBlockInfoFromTarget(editor, event.target, shell);
};

const getBlockInfoFromTarget = (editor: any, target: EventTarget | null, shell: HTMLElement | null) => {
    if (!shell) return null;
    const root = editor.view.dom as HTMLElement;
    const element = findBestBlockElement(target, root);
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

const getBlockClipboardPayload = (editor: any, node: ProseMirrorNode) => {
    const serializer = DOMSerializer.fromSchema(editor.state.schema);
    const wrapper = document.createElement('div');
    wrapper.appendChild(serializer.serializeNode(node, { document }));

    const html = normalizeSmartImageLinksForExport(wrapper.innerHTML);
    const markdown = turndownService.turndown(normalizeMindMapHtmlForTurndown(html)).trim();
    const text = node.textBetween(0, node.content.size, '\n').trim() || markdown || html.trim();

    return { html, markdown, text };
};

const copyRichBlockToClipboard = async (payload: { html: string; text: string }) => {
    const clipboardItem = (window as any).ClipboardItem;

    if (navigator.clipboard?.write && clipboardItem) {
        try {
            await navigator.clipboard.write([
                new clipboardItem({
                    'text/html': new Blob([payload.html], { type: 'text/html' }),
                    'text/plain': new Blob([payload.text], { type: 'text/plain' }),
                }),
            ]);
            return true;
        } catch {}
    }

    return copyTextToClipboard(payload.text);
};

const isInsideColumnPlacement = (placement: BlockDropPlacement) => placement === 'inside-start' || placement === 'inside-end';

const isEmptyParagraphNode = (node: ProseMirrorNode) => {
    return node.type.name === 'paragraph' && node.content.size === 0;
};

const getColumnDropPlan = (editor: any, sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo, placement: BlockDropPlacement) => {
    if (!editor || !isInsideColumnPlacement(placement) || targetBlock.nodeType !== 'column') return null;

    const source = findBlockById(editor, sourceBlock.id);
    const target = findBlockById(editor, targetBlock.id);
    if (!source || !target || target.node.type.name !== 'column') return null;
    if (sourceBlock.id === targetBlock.id) return null;
    if (target.pos > source.pos && target.pos < source.pos + source.node.nodeSize) return null;

    const sourceContext = getBlockContext(editor, source.pos);
    const sourceIsAlreadyOnlyChild = sourceContext.parent.attrs?.blockId === targetBlock.id && sourceContext.parent.childCount <= 1;
    if (sourceIsAlreadyOnlyChild) return null;

    const shouldReplaceEmptyPlaceholder = (
        sourceContext.parent.attrs?.blockId !== targetBlock.id &&
        target.node.childCount === 1 &&
        isEmptyParagraphNode(target.node.child(0))
    );

    if (shouldReplaceEmptyPlaceholder) {
        if (!target.node.canReplaceWith(0, 1, source.node.type, source.node.marks)) return null;
        const from = target.pos + 1;
        return {
            insertPos: from,
            replaceFrom: from,
            replaceTo: from + target.node.child(0).nodeSize,
        };
    }

    const insertIndex = placement === 'inside-start' ? 0 : target.node.childCount;
    if (!target.node.canReplaceWith(insertIndex, insertIndex, source.node.type, source.node.marks)) return null;

    return {
        insertPos: placement === 'inside-start' ? target.pos + 1 : target.pos + target.node.nodeSize - 1,
        replaceFrom: null,
        replaceTo: null,
    };
};

const getColumnPlaceholderDropPlan = (editor: any, sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo) => {
    if (!editor || sourceBlock.id === targetBlock.id || targetBlock.nodeType !== 'paragraph') return null;

    const source = findBlockById(editor, sourceBlock.id);
    const target = findBlockById(editor, targetBlock.id);
    if (!source || !target || !isEmptyParagraphNode(target.node)) return null;

    const targetContext = getBlockContext(editor, target.pos);
    if (targetContext.parent.type.name !== 'column' || targetContext.parent.childCount !== 1) return null;

    const sourceContext = getBlockContext(editor, source.pos);
    if (sourceContext.parent.attrs?.blockId === targetContext.parent.attrs?.blockId) return null;
    if (!targetContext.parent.canReplaceWith(targetContext.index, targetContext.index + 1, source.node.type, source.node.marks)) return null;

    return {
        insertPos: target.pos,
        replaceFrom: target.pos,
        replaceTo: target.pos + target.node.nodeSize,
    };
};

const canMoveBlockToTarget = (editor: any, sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo, placement: BlockDropPlacement) => {
    if (!editor || sourceBlock.id === targetBlock.id) return false;
    if (isInsideColumnPlacement(placement)) return Boolean(getColumnDropPlan(editor, sourceBlock, targetBlock, placement));
    if (getColumnPlaceholderDropPlan(editor, sourceBlock, targetBlock)) return true;

    const source = findBlockById(editor, sourceBlock.id);
    const target = findBlockById(editor, targetBlock.id);
    if (!source || !target) return false;

    const rawInsertPos = placement === 'before' ? target.pos : target.pos + target.node.nodeSize;
    if (rawInsertPos > source.pos && rawInsertPos < source.pos + source.node.nodeSize) return false;

    const targetContext = getBlockContext(editor, target.pos);
    const insertIndex = placement === 'before' ? targetContext.index : targetContext.index + 1;
    return targetContext.parent.canReplaceWith(insertIndex, insertIndex, source.node.type, source.node.marks);
};

const getBlockDropPlacement = (target: BlockHandleInfo, clientY: number, shellTop: number): BlockDropPlacement => {
    if (target.nodeType === 'column') {
        return clientY < target.top + shellTop + target.height / 2 ? 'inside-start' : 'inside-end';
    }

    return clientY < target.top + shellTop + target.height / 2 ? 'before' : 'after';
};

const getBlockDropIndicator = (target: BlockHandleInfo, placement: BlockDropPlacement) => {
    if (isInsideColumnPlacement(placement)) {
        return {
            top: placement === 'inside-start' ? target.top + 8 : target.top + Math.max(8, target.height - 8),
            left: target.left + 52,
            width: Math.max(24, target.width - 16),
        };
    }

    return {
        top: placement === 'before' ? target.top : target.top + target.height,
        left: target.left + 44,
        width: target.width,
    };
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

const turndownService = new TurndownService({ 
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

const decodeSmartFormulaAttribute = (value: string | null) => {
    return decodeLegacyEncodedFormula(value);
};

const getSmartEquationFormula = (node: HTMLElement) => {
    return decodeSmartFormulaAttribute(node.getAttribute('data-equation')) || node.textContent?.trim() || '';
};

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

turndownService.addRule('smartEquations', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    const dataType = getAttr('data-type');
    return (
      (nodeName === 'div' && dataType === 'equation') ||
      (nodeName === 'span' && dataType === 'inline-equation')
    );
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const formula = getSmartEquationFormula(el);
    if (!formula) return '';
    return el.getAttribute('data-type') === 'inline-equation'
      ? `\\(${formula}\\)`
      : `\n\n\\[\n${formula}\n\\]\n\n`;
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
      (nodeName === 'div' && ['callout', 'embed', 'media', 'template-button', 'synced-block', 'database'].includes(dataType || '')) ||
      (nodeName === 'a' && ['bookmark', 'page-link', 'image-link'].includes(dataType || ''))
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

// Whiteboard documents live independently; Markdown stores only the stable reference.
turndownService.addRule('keepWhiteboardEmbed', {
  filter: (node) => {
    const el = node as HTMLElement;
    return String(el.nodeName || '').toLowerCase() === 'figure'
      && el.getAttribute?.('data-type') === 'whiteboard-embed';
  },
  replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
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

const getMediaKindFromUrl = (url: string, fallbackKind: string = 'file') => {
    const pathname = (() => {
        try {
            return new URL(url, window.location.origin).pathname.toLowerCase();
        } catch {
            return url.toLowerCase();
        }
    })();

    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(pathname)) return 'video';
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(pathname)) return 'audio';
    if (/\.pdf$/i.test(pathname)) return 'pdf';
    return normalizeMediaKind(fallbackKind);
};

const normalizeMediaKind = (value: unknown) => {
    const kind = typeof value === 'string' ? value : '';
    return ['video', 'audio', 'pdf', 'file'].includes(kind) ? kind : 'file';
};

const formatMediaSize = (value: unknown) => {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let current = size;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
        current /= 1024;
        unitIndex += 1;
    }

    const precision = current >= 10 || unitIndex === 0 ? 0 : 1;
    return `${current.toFixed(precision)} ${units[unitIndex]}`;
};

const getMediaDisplayName = (name: string, url: string, kind: string) => {
    if (name?.trim()) return name;
    if (url) {
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            let last = pathname.split('/').filter(Boolean).pop() || '';
            try {
                last = decodeURIComponent(last);
            } catch {}
            if (last) return last;
        } catch {}
    }
    if (kind === 'video') return '未命名视频';
    if (kind === 'audio') return '未命名音频';
    if (kind === 'pdf') return '未命名 PDF';
    return '未命名文件';
};

const getMediaKindLabel = (kind: string) => {
    if (kind === 'video') return '视频';
    if (kind === 'audio') return '音频';
    if (kind === 'pdf') return 'PDF';
    return '文件';
};

const getMediaMimeFromUrl = (url: string, kind: string) => {
    const lower = url.toLowerCase();
    if (kind === 'video') {
        if (lower.includes('.webm')) return 'video/webm';
        if (lower.includes('.mov')) return 'video/quicktime';
        return 'video/mp4';
    }
    if (kind === 'audio') {
        if (lower.includes('.wav')) return 'audio/wav';
        if (lower.includes('.ogg')) return 'audio/ogg';
        return 'audio/mpeg';
    }
    if (kind === 'pdf') return 'application/pdf';
    return '';
};

const getMediaAccept = (kind: string) => {
    if (kind === 'video') return 'video/*';
    if (kind === 'audio') return 'audio/*';
    if (kind === 'pdf') return 'application/pdf';
    return undefined;
};

const safeDownloadName = (value: string) => {
    const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, '-');
    return normalized || 'attachment';
};

const ImageActionButton = ({
    children,
    label,
    title,
    onClick,
    active,
    danger,
}: {
    children?: React.ReactNode;
    label?: string;
    title: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
}) => (
    <button
        type="button"
        title={title}
        aria-label={title}
        data-smart-doc-ui="button"
        data-label={label || undefined}
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
        {label ? <span aria-hidden="true" className="smart-doc-action-label" data-label={label} /> : children}
    </button>
);

const NotionImageComponent = (props: any) => {
    const { node, updateAttributes, selected, deleteNode, editor } = props;
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [width, setWidth] = useState(normalizeImageWidth(node.attrs.width));
    const [resizing, setResizing] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
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

    const promptAltText = async () => {
        const nextAlt = await promptForText({
            title: '图片描述 / Alt text',
            initialValue: alt,
            allowEmpty: true,
            confirmLabel: '保存',
        });
        if (nextAlt === null) return;
        updateAttributes({ alt: nextAlt.trim() });
    };

    const promptImageLink = async () => {
        const nextLink = await promptForUrl({
            title: '图片链接',
            initialValue: link,
            allowEmpty: true,
            confirmLabel: '保存',
        });
        if (nextLink === null) return;
        updateAttributes({ link: nextLink.trim() });
    };

    const openImageLink = () => {
        if (!link) return;
        window.open(link, '_blank', 'noopener,noreferrer');
    };

    const copyImageLink = async () => {
        try {
            await navigator.clipboard.writeText(src);
        } catch {
            await promptForText({
                title: '复制图片链接',
                initialValue: src,
                readOnly: true,
                confirmLabel: '关闭',
            });
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

    const controlsVisible = selected || resizing || hovered || focusWithin;

    const handleBlurCapture = (event: React.FocusEvent<HTMLElement>) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setFocusWithin(false);
        }
    };

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
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={handleBlurCapture}
        >
            <div className={`relative ${shapeClass} ${selected ? 'ring-2 ring-primary/80 ring-offset-2' : ''}`}>
                <div
                    className={`overflow-hidden border border-gray-100 bg-gray-50 shadow-sm ${shapeClass}`}
                    style={aspectRatio ? { aspectRatio } : undefined}
                >
                    <img
                        src={src}
                        alt={alt || caption}
                        title={link ? '打开图片链接' : node.attrs.title || alt || caption}
                        role={link ? 'link' : undefined}
                        tabIndex={link ? 0 : undefined}
                        className={`block w-full ${link ? 'cursor-pointer' : ''} ${aspectRatio ? `h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}` : 'h-auto'}`}
                        draggable={false}
                        onMouseDown={link ? (event) => event.stopPropagation() : undefined}
                        onClick={link ? openImageLink : undefined}
                        onKeyDown={link ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openImageLink();
                            }
                        } : undefined}
                    />
                </div>

                {controlsVisible && (
                    <>
                        <div
                            className="absolute left-0 top-1/2 h-16 w-1.5 -translate-x-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-gray-900 opacity-90"
                            aria-hidden="true"
                            data-smart-doc-ui="resize-handle"
                            onMouseDown={(event) => handleResizeMouseDown(event, 'left')}
                            title="拖拽调整宽度"
                        />
                        <div
                            className="absolute right-0 top-1/2 h-16 w-1.5 translate-x-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-gray-900 opacity-90"
                            aria-hidden="true"
                            data-smart-doc-ui="resize-handle"
                            onMouseDown={(event) => handleResizeMouseDown(event, 'right')}
                            title="拖拽调整宽度"
                        />

                        <div
                            className="absolute right-2 top-2 z-10 flex max-w-[min(680px,calc(100vw-3rem))] items-center gap-1 overflow-x-auto rounded-md border border-gray-200 bg-white/95 p-1 opacity-100 shadow-lg backdrop-blur"
                            contentEditable={false}
                            data-smart-doc-ui="image-toolbar"
                            role="toolbar"
                            aria-label="图片操作"
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
                                    label={String(percent)}
                                    active={width === `${percent}%`}
                                    onClick={() => commitWidth(`${percent}%`)}
                                />
                            ))}
                            <ImageActionButton
                                title="原始比例"
                                label="原"
                                active={!aspectRatio && shape === 'rounded'}
                                onClick={() => updateAttributes({ aspectRatio: '', fit: 'contain', shape: 'rounded' })}
                            />
                            <ImageActionButton
                                title="裁剪 16:9"
                                label="16:9"
                                active={aspectRatio === '16 / 9' && fit === 'cover'}
                                onClick={() => updateAttributes({ aspectRatio: '16 / 9', fit: 'cover', shape: 'rounded' })}
                            />
                            <ImageActionButton
                                title="裁剪 1:1"
                                label="1:1"
                                active={aspectRatio === '1 / 1' && fit === 'cover' && shape !== 'circle'}
                                onClick={() => updateAttributes({ aspectRatio: '1 / 1', fit: 'cover', shape: 'rounded' })}
                            />
                            <ImageActionButton
                                title="圆形遮罩"
                                label="圆"
                                active={shape === 'circle'}
                                onClick={() => updateAttributes({ aspectRatio: '1 / 1', fit: 'cover', shape: 'circle' })}
                            />
                            <ImageActionButton title="添加说明" active={showCaption || Boolean(caption)} onClick={() => setShowCaption(true)}>
                                <Captions className="h-4 w-4" />
                            </ImageActionButton>
                            <ImageActionButton title="替换图片" onClick={() => fileInputRef.current?.click()}>
                                <ImagePlus className="h-4 w-4" />
                            </ImageActionButton>
                            <ImageActionButton title="Alt 文本" label="ALT" active={Boolean(alt)} onClick={promptAltText} />
                            <ImageActionButton title="图片链接" active={Boolean(link)} onClick={promptImageLink}>
                                <LinkIcon className="h-4 w-4" />
                            </ImageActionButton>
                            {link && (
                                <ImageActionButton title="打开图片链接" onClick={openImageLink}>
                                    <ExternalLink className="h-4 w-4" />
                                </ImageActionButton>
                            )}
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
                    </>
                )}

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
                    data-smart-doc-ui="image-preview"
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

const NotionMediaComponent = (props: any) => {
    const { node, updateAttributes, selected, deleteNode, editor } = props;
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [hovered, setHovered] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);

    const url = node.attrs.url || '';
    const kind = normalizeMediaKind(node.attrs.kind);
    const name = node.attrs.name || '';
    const mime = node.attrs.mime || '';
    const size = node.attrs.size || 0;
    const displayName = getMediaDisplayName(name, url, kind);
    const sizeLabel = formatMediaSize(size);
    const meta = [getMediaKindLabel(kind), mime, sizeLabel].filter(Boolean).join(' · ');

    const replaceMedia = async (file: File) => {
        const uploadFile = editor?.storage?.smartDocument?.uploadFile || editor?.storage?.smartDocument?.uploadImage;
        if (typeof uploadFile !== 'function') return;

        const nextUrl = await uploadFile(file);
        if (!nextUrl) return;

        updateAttributes({
            url: nextUrl,
            name: file.name,
            mime: file.type || '',
            size: file.size,
            kind: kind === 'file' ? getMediaKindFromFile(file) : kind,
        });
    };

    const replaceMediaUrl = async () => {
        const nextUrl = await promptForUrl({
            title: '替换媒体链接',
            initialValue: url,
            confirmLabel: '保存',
        });
        if (!nextUrl) return;

        const previousDefaultName = getMediaDisplayName('', url, kind);
        const nextKind = getMediaKindFromUrl(nextUrl, kind);
        const nextDefaultName = getMediaDisplayName('', nextUrl, nextKind);
        const shouldUpdateName = !name.trim() || name.trim() === previousDefaultName || name.trim() === url;

        updateAttributes({
            url: nextUrl,
            name: shouldUpdateName ? nextDefaultName : name,
            mime: getMediaMimeFromUrl(nextUrl, nextKind),
            size: 0,
            kind: kind === 'file' ? nextKind : kind,
        });
    };

    const copyMediaLink = async () => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            await promptForText({
                title: '复制文件链接',
                initialValue: url,
                readOnly: true,
                confirmLabel: '关闭',
            });
        }
    };

    const downloadMedia = () => {
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = safeDownloadName(displayName);
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.click();
    };

    const renderIcon = () => {
        if (kind === 'video') return <Video className="h-4 w-4" />;
        if (kind === 'audio') return <Music className="h-4 w-4" />;
        if (kind === 'pdf') return <FileText className="h-4 w-4" />;
        return <Paperclip className="h-4 w-4" />;
    };

    const renderPreview = () => {
        if (kind === 'video') {
            return (
                <video
                    src={url}
                    controls
                    className="block max-h-[520px] w-full bg-black"
                    contentEditable={false}
                />
            );
        }

        if (kind === 'audio') {
            return (
                <div className="border-t border-gray-100 px-3 py-3">
                    <audio src={url} controls className="w-full" contentEditable={false} />
                </div>
            );
        }

        if (kind === 'pdf') {
            return (
                <iframe
                    src={url}
                    title={displayName}
                    className="h-96 w-full border-t border-gray-100 bg-gray-50"
                    contentEditable={false}
                />
            );
        }

        return null;
    };

    const controlsVisible = selected || hovered || focusWithin;

    const handleBlurCapture = (event: React.FocusEvent<HTMLElement>) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setFocusWithin(false);
        }
    };

    return (
        <NodeViewWrapper
            className={`smart-doc-media group relative my-3 overflow-hidden rounded-md border bg-white transition-colors ${
                selected ? 'border-gray-400 ring-2 ring-gray-200' : 'border-gray-200 hover:border-gray-300'
            }`}
            data-type="media"
            data-kind={kind}
            data-url={url}
            data-name={name}
            data-mime={mime}
            data-size={size || 0}
            id={blockDomId(node.attrs.blockId)}
            data-block-id={node.attrs.blockId || undefined}
            data-comments={
                normalizeBlockComments(node.attrs.blockComments).length
                    ? encodeURIComponent(JSON.stringify(normalizeBlockComments(node.attrs.blockComments)))
                    : undefined
            }
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={handleBlurCapture}
        >
            <div className="flex items-start gap-3 px-3 py-3" contentEditable={false}>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-500">
                    {renderIcon()}
                </div>
                <div className="min-w-0 flex-1">
                    <input
                        value={displayName}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => updateAttributes({ name: event.target.value })}
                        className="h-7 w-full border-none bg-transparent px-0 text-sm font-medium text-gray-900 outline-none focus:ring-0"
                        aria-label="媒体名称"
                    />
                    <div className="truncate text-xs text-gray-400">{meta || url}</div>
                </div>
                {controlsVisible && (
                    <div
                        className="flex flex-shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white/95 p-1 opacity-100 shadow-sm"
                        data-smart-doc-ui="media-toolbar"
                        role="toolbar"
                        aria-label="媒体操作"
                    >
                        <ImageActionButton title="替换文件" onClick={() => fileInputRef.current?.click()}>
                            <RefreshCw className="h-4 w-4" />
                        </ImageActionButton>
                        <ImageActionButton title="替换链接" onClick={replaceMediaUrl}>
                            <LinkIcon className="h-4 w-4" />
                        </ImageActionButton>
                        <ImageActionButton title="复制链接" onClick={copyMediaLink}>
                            <Copy className="h-4 w-4" />
                        </ImageActionButton>
                        <ImageActionButton title="打开原文件" onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}>
                            <ExternalLink className="h-4 w-4" />
                        </ImageActionButton>
                        <ImageActionButton title="下载" onClick={downloadMedia}>
                            <Download className="h-4 w-4" />
                        </ImageActionButton>
                        <ImageActionButton title="删除" danger onClick={() => deleteNode?.()}>
                            <Trash2 className="h-4 w-4" />
                        </ImageActionButton>
                    </div>
                )}
            </div>

            {renderPreview()}

            <input
                ref={fileInputRef}
                type="file"
                accept={getMediaAccept(kind)}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) replaceMedia(file);
                    event.target.value = '';
                }}
            />
        </NodeViewWrapper>
    );
};

export type SmartDocumentValue = {
    markdown: string;
    json: JSONContent;
    html: string;
    text: string;
};

export type SmartDocumentValueGetter = () => SmartDocumentValue | null;

export type SmartDocumentPageLink = {
    id: string;
    title: string;
    category?: string;
    href?: string;
};

type SmartDocumentEditorProps = {
    content?: string;
    contentJson?: JSONContent | null;
    pages?: SmartDocumentPageLink[];
    currentDocumentId?: string | null;
    contentRevision?: number | null;
    mode?: 'edit' | 'read';
    theme?: 'light' | 'dark' | 'system';
    outlineOpen?: boolean;
    onOutlineOpenChange?: (open: boolean) => void;
    serializationFlushRef?: React.MutableRefObject<(() => Promise<void>) | null>;
    exportValueRef?: React.MutableRefObject<SmartDocumentValueGetter | null>;
    onRecoveryRepaired?: (value: SmartDocumentValue, result: SOPContentRepairResult) => void;
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

export const preserveLegacyMarkdownBlankLines = (value: string) => {
    const normalized = (value || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const output: string[] = [];
    let inFence = false;
    let previousNonEmpty = '';

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const trimmed = line.trim();
        if (/^(```|~~~)/.test(trimmed)) {
            inFence = !inFence;
            output.push(line);
            previousNonEmpty = line;
            index += 1;
            continue;
        }

        if (inFence || trimmed !== '') {
            output.push(line);
            if (trimmed) previousNonEmpty = line;
            index += 1;
            continue;
        }

        const runStart = index;
        while (index < lines.length && lines[index].trim() === '') index += 1;
        const blankCount = index - runStart;
        const nextNonEmpty = index < lines.length ? lines[index] : '';
        const canPreserveExtraBlankBlocks = (
            blankCount > 1
            && previousNonEmpty
            && nextNonEmpty
            && !isMarkdownStructureLine(previousNonEmpty)
            && !isMarkdownStructureLine(nextNonEmpty)
        );

        // One blank line is normal Markdown paragraph syntax. Only additional
        // blank lines represent intentional visual space in legacy documents.
        output.push('');
        for (let offset = 1; offset < blankCount; offset += 1) {
            output.push(canPreserveExtraBlankBlocks ? '<p data-preserved-blank-line></p>' : '');
        }
    }

    return output.join('\n');
};

const markdownToHtml = (value: string) => mdParser.render(preserveLegacyMarkdownBlankLines(value || ''));

const normalizeSmartImageLinksForExport = (html: string) => {
    if (!html || typeof document === 'undefined') return html;

    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('img[data-link]').forEach((image) => {
        const link = image.getAttribute('data-link')?.trim();
        if (!link) return;

        const parent = image.parentElement;
        if (!parent) return;

        if (parent.matches('a[data-type="image-link"]')) {
            parent.setAttribute('href', link);
            parent.setAttribute('target', '_blank');
            parent.setAttribute('rel', 'noopener noreferrer');
            parent.setAttribute('data-link', link);
            return;
        }

        const anchor = document.createElement('a');
        anchor.setAttribute('href', link);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.setAttribute('data-type', 'image-link');
        anchor.setAttribute('data-link', link);
        anchor.className = 'smart-doc-image-link';

        parent.replaceChild(anchor, image);
        anchor.appendChild(image);
    });

    return template.innerHTML;
};

const editorToMarkdown = (editor: any) => {
    const html = normalizeSmartImageLinksForExport(editor.getHTML());
    return turndownService.turndown(normalizeMindMapHtmlForTurndown(html));
};

const getInitialContent = (contentJson: JSONContent | null | undefined, markdown: string) => {
    return isValidDocJson(contentJson) ? contentJson : markdownToHtml(markdown || '');
};

const getContentSignature = (contentJson: JSONContent | null | undefined, markdown: string) => {
    if (isValidDocJson(contentJson)) return `json:${JSON.stringify(contentJson)}`;
    return `markdown:${markdown || ''}`;
};

const readSmartDocumentValue = (editorInstance: any): SmartDocumentValue | null => {
    if (!editorInstance || editorInstance.isDestroyed) return null;
    const json = editorInstance.getJSON();
    return {
        html: normalizeSmartImageLinksForExport(editorInstance.getHTML()),
        json,
        markdown: serializeToMarkdown(json as DocumentNodeJson),
        text: serializeToPlainText(json as DocumentNodeJson),
    };
};

export const SmartDocumentEditor = ({
    content = '',
    contentJson = null,
    pages = [],
    currentDocumentId = null,
    contentRevision = null,
    mode = 'edit',
    theme = 'system',
    outlineOpen: controlledOutlineOpen,
    onOutlineOpenChange,
    serializationFlushRef,
    exportValueRef,
    onRecoveryRepaired,
    onChange,
}: SmartDocumentEditorProps) => {
    const [internalOutlineOpen, setInternalOutlineOpen] = useState(false);
    const showTOC = controlledOutlineOpen ?? internalOutlineOpen;
    const showLocalOutlineToggle = controlledOutlineOpen === undefined && onOutlineOpenChange === undefined;
    const setShowTOC = useCallback((open: boolean) => {
        if (controlledOutlineOpen === undefined) setInternalOutlineOpen(open);
        onOutlineOpenChange?.(open);
    }, [controlledOutlineOpen, onOutlineOpenChange]);
    const [findPanelMode, setFindPanelMode] = useState<FindPanelMode | null>(null);
    const [hoveredBlock, setHoveredBlock] = useState<BlockHandleInfo | null>(null);
    const [blockMenuOpen, setBlockMenuOpen] = useState(false);
    const [dragBlock, setDragBlock] = useState<DragBlockState | null>(null);
    const [columnResizeHandles, setColumnResizeHandles] = useState<ColumnResizeHandleInfo[]>([]);
    const [commentPanelBlock, setCommentPanelBlock] = useState<BlockHandleInfo | null>(null);
    const initiallyRequiresRecovery = contentJson !== null
        && contentJson !== undefined
        && !isValidDocJson(contentJson);
    const [contentRecoveryWarning, setContentRecoveryWarning] = useState(initiallyRequiresRecovery);
    const [contentRecoveryExpanded, setContentRecoveryExpanded] = useState(false);
    const [contentRecoveryState, setContentRecoveryState] = useState<'idle' | 'saving' | 'error'>('idle');
    const [contentRecoveryError, setContentRecoveryError] = useState('');
    const shellRef = React.useRef<HTMLDivElement | null>(null);
    const outlineLayerRef = React.useRef<HTMLDivElement | null>(null);
    const outlinePanelRef = React.useRef<HTMLElement | null>(null);
    const uploadControllerRef = React.useRef<SmartClipboardUploadController | null>(null);
    const initialContentRecoveryRef = React.useRef(false);
    const recoveryBlockedRef = React.useRef(initiallyRequiresRecovery);
    const mmSigRef = React.useRef<string>('');
    const externalSigRef = React.useRef<string>(getContentSignature(contentJson, content));
    const onChangeRef = React.useRef(onChange);
    const serializationTimerRef = React.useRef<number | null>(null);
    const pointerFrameRef = React.useRef<number | null>(null);
    const pendingPointerRef = React.useRef<{ target: EventTarget | null; clientY: number } | null>(null);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    React.useLayoutEffect(() => {
        if (!showTOC) return;
        const layer = outlineLayerRef.current;
        const editorShell = shellRef.current;
        if (!layer || !editorShell) return;

        const workspaceBody = editorShell.closest('.smart-document-shell')
            ?.querySelector<HTMLElement>('.smart-document-shell__body');
        const viewportTarget = workspaceBody || editorShell;

        const updateBounds = () => {
            const bounds = viewportTarget.getBoundingClientRect();
            layer.style.setProperty('--smart-document-outline-top', `${Math.max(0, bounds.top)}px`);
            layer.style.setProperty('--smart-document-outline-right', `${Math.max(0, window.innerWidth - bounds.right)}px`);
            layer.style.setProperty('--smart-document-outline-bottom', `${Math.max(0, window.innerHeight - bounds.bottom)}px`);
            layer.style.setProperty('--smart-document-outline-left', `${Math.max(0, bounds.left)}px`);
        };

        updateBounds();
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updateBounds);
        resizeObserver?.observe(viewportTarget);
        window.addEventListener('resize', updateBounds);
        window.addEventListener('scroll', updateBounds, true);

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updateBounds);
            window.removeEventListener('scroll', updateBounds, true);
        };
    }, [showTOC]);

    useEffect(() => {
        if (!showTOC) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (outlinePanelRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest('[data-smart-document-outline-toggle]')) return;
            setShowTOC(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setShowTOC(false);
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [setShowTOC, showTOC]);

    const serializeAndEmit = useCallback((editorInstance: any) => {
        if (recoveryBlockedRef.current) return;
        const value = readSmartDocumentValue(editorInstance);
        if (!value) return;
        externalSigRef.current = getContentSignature(value.json, value.markdown);

        try {
            const hasDiv = value.html.includes('data-type="mind-map"');
            const hasFence = value.markdown.includes('```mindmap');
            const sig = `${hasDiv}-${hasFence}-${value.markdown.length}`;
            if (hasDiv && sig !== mmSigRef.current) mmSigRef.current = sig;
        } catch {
            // A serialization diagnostic must never interrupt editing.
        }

        onChangeRef.current(value);
    }, []);

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
        editable: mode === 'edit',
        extensions: createSmartDocumentExtensions({
            codeBlock: SmartCodeBlock,
            before: [
                ReadOnlyGuardExtension,
                BlockIdentity,
                SmartClipboardExtension.configure({
                    uploadImage,
                    uploadFile,
                    uploadControllerRef,
                }),
            ],
            image: Image.extend({
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
                            parseHTML: element => (
                                element.getAttribute('data-link')
                                || (element.closest('a[data-type="image-link"],a[data-image-link],a[href]') as HTMLAnchorElement | null)?.getAttribute('href')
                                || ''
                            ),
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
                // Images are document blocks in NMDD. Treating them as inline
                // made legacy top-level image JSON violate the doc `block+`
                // schema and could crash block-ID normalization on load.
                inline: false,
                allowBase64: true,
            }),
            custom: [
                FindReplaceExtension,
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
                WhiteboardEmbed,
                ToggleBlock,
                CalloutBlock,
                BookmarkBlock,
                EmbedBlock,
                MediaBlock.extend({
                    addNodeView() {
                        return ReactNodeViewRenderer(NotionMediaComponent);
                    },
                }),
                TemplateButtonBlock,
                SyncedBlock,
                PageLinkBlock,
                InlineEquation,
                EquationBlock,
                DatabaseBlock,
            ],
            table: {
                table: Table.configure({ resizable: true }),
                row: TableRow,
                header: TableHeaderWithBackground,
                cell: TableCellWithBackground,
            },
        }),
        content: getInitialContent(contentJson, content),
        enableContentCheck: true,
        onContentError: ({ error }) => {
            initialContentRecoveryRef.current = true;
            recoveryBlockedRef.current = true;
            console.warn('[document-editor] Invalid structured content detected; using the Markdown recovery copy.', error);
        },
        editorProps: {
            attributes: {
                class: 'smart-document-content min-h-[500px] focus:outline-none',
            },
        },
        onUpdate: ({ editor, transaction, appendedTransactions }) => {
            const changedTransactions = [transaction, ...(appendedTransactions || [])]
                .filter(candidate => candidate.docChanged);
            if (
                changedTransactions.length === 0
                || changedTransactions.every(candidate => candidate.getMeta(BLOCK_IDENTITY_TRANSACTION_META))
            ) {
                return;
            }
            if (serializationTimerRef.current !== null) {
                window.clearTimeout(serializationTimerRef.current);
            }
            serializationTimerRef.current = window.setTimeout(() => {
                serializationTimerRef.current = null;
                serializeAndEmit(editor);
            }, 180);
        }
    });

    const flushPendingSerialization = useCallback(() => {
        if (serializationTimerRef.current !== null) {
            window.clearTimeout(serializationTimerRef.current);
            serializationTimerRef.current = null;
            serializeAndEmit(editor);
        }
    }, [editor, serializeAndEmit]);

    const flushPendingEditorWork = useCallback(async () => {
        await uploadControllerRef.current?.waitForPendingUploads();
        flushPendingSerialization();
    }, [flushPendingSerialization]);

    useEffect(() => {
        if (!serializationFlushRef) return;
        serializationFlushRef.current = flushPendingEditorWork;
        return () => {
            if (serializationFlushRef.current === flushPendingEditorWork) {
                serializationFlushRef.current = null;
            }
        };
    }, [flushPendingEditorWork, serializationFlushRef]);

    useEffect(() => {
        if (!exportValueRef) return;
        const getter: SmartDocumentValueGetter = () => readSmartDocumentValue(editor);
        exportValueRef.current = getter;
        return () => {
            if (exportValueRef.current === getter) exportValueRef.current = null;
        };
    }, [editor, exportValueRef]);

    useEffect(() => {
        if (!editor || !initialContentRecoveryRef.current) return;
        const timeoutId = window.setTimeout(() => {
            if (editor.isDestroyed || !initialContentRecoveryRef.current) return;
            initialContentRecoveryRef.current = false;
            editor.commands.setContent(markdownToHtml(content || ''), {
                emitUpdate: false,
                // Markdown is the recovery format. Unknown legacy wrappers may
                // be discarded, but their supported text/children must remain.
                errorOnInvalidContent: false,
            });
            externalSigRef.current = getContentSignature(contentJson, content);
            recoveryBlockedRef.current = true;
            setContentRecoveryWarning(true);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [content, contentJson, editor]);

    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!uploadControllerRef.current?.hasPendingUploads()) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    useEffect(() => () => {
        flushPendingSerialization();
    }, [flushPendingSerialization]);

    useEffect(() => () => {
        if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
    }, []);

    useEffect(() => {
        if (!editor) return;
        const timeoutId = window.setTimeout(() => {
            if (!editor.isDestroyed) editor.setEditable(mode === 'edit' && !contentRecoveryWarning);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [contentRecoveryWarning, editor, mode]);

    useEffect(() => {
        if (!editor) return;
        const handleFindShortcut = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key === 'f') {
                event.preventDefault();
                setFindPanelMode('find');
            }
            if (key === 'h' && mode === 'edit') {
                event.preventDefault();
                setFindPanelMode('replace');
            }
        };
        window.addEventListener('keydown', handleFindShortcut);
        return () => window.removeEventListener('keydown', handleFindShortcut);
    }, [editor, mode]);

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
        const timeoutId = window.setTimeout(() => {
            if (!editor.isDestroyed) ensureEditorBlockIds(editor);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [editor, content, contentJson]);

    useEffect(() => {
        if (!editor || initialContentRecoveryRef.current) return;
        const timeoutId = window.setTimeout(() => {
            if (editor.isDestroyed) return;
            const nextSignature = getContentSignature(contentJson, content);
            if (nextSignature === externalSigRef.current) return;
            if (editor.isFocused) return;

            if (isValidDocJson(contentJson)) {
                const currentSignature = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
                if (currentSignature !== nextSignature) {
                    try {
                        editor.commands.setContent(contentJson, {
                            emitUpdate: false,
                            errorOnInvalidContent: true,
                        });
                        ensureEditorBlockIds(editor);
                        recoveryBlockedRef.current = false;
                        setContentRecoveryWarning(false);
                    } catch (error) {
                        console.warn('[document-editor] Rejected invalid external JSON and restored its Markdown copy.', error);
                        editor.commands.setContent(markdownToHtml(content || ''), {
                            emitUpdate: false,
                            errorOnInvalidContent: false,
                        });
                        recoveryBlockedRef.current = true;
                        setContentRecoveryWarning(true);
                    }
                }
                externalSigRef.current = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
                return;
            }

            const currentMarkdown = editorToMarkdown(editor);
            if (currentMarkdown !== (content || '')) {
                editor.commands.setContent(markdownToHtml(content || ''), {
                    emitUpdate: false,
                    errorOnInvalidContent: false,
                });
                ensureEditorBlockIds(editor);
            }
            const hasInvalidStructuredSource = contentJson !== null && contentJson !== undefined;
            recoveryBlockedRef.current = hasInvalidStructuredSource;
            setContentRecoveryWarning(hasInvalidStructuredSource);
            externalSigRef.current = getContentSignature(editor.getJSON(), editorToMarkdown(editor));
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [content, contentJson, editor]);

    useEffect(() => {
        if (!editor || typeof window === 'undefined') return;

        let handledHash = '';
        let timeoutId: number | null = null;
        let expiresAt = 0;
        let settleUntil = 0;

        const clearRetry = () => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const tryScroll = () => {
            const targetId = getBlockDomIdFromHash();
            if (!targetId) {
                handledHash = '';
                settleUntil = 0;
                clearBlockLinkTargets(shellRef.current || (editor.view?.dom as HTMLElement | null) || null);
                clearRetry();
                return;
            }

            if (targetId !== handledHash) {
                handledHash = targetId;
                settleUntil = 0;
            }

            const root = shellRef.current || (editor.view?.dom as HTMLElement | null) || null;
            const handled = scrollBlockHashIntoView(root);
            if (handled && settleUntil === 0) {
                settleUntil = Date.now() + 800;
            }

            if (Date.now() < expiresAt && (!handled || Date.now() < settleUntil)) {
                timeoutId = window.setTimeout(tryScroll, BLOCK_LINK_RETRY_INTERVAL_MS);
            }
        };

        const startRetry = () => {
            handledHash = '';
            settleUntil = 0;
            expiresAt = Date.now() + BLOCK_LINK_RETRY_MS;
            clearRetry();
            tryScroll();
        };

        startRetry();
        window.addEventListener('hashchange', startRetry);

        return () => {
            clearRetry();
            window.removeEventListener('hashchange', startRetry);
        };
    }, [currentDocumentId, editor]);

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

    const moveBlockToTarget = useCallback((sourceBlock: BlockHandleInfo, targetBlock: BlockHandleInfo, placement: BlockDropPlacement) => {
        if (!editor || !shellRef.current || sourceBlock.id === targetBlock.id) return;

        const source = getLiveBlock(sourceBlock);
        const target = getLiveBlock(targetBlock);
        if (!source || !target) return;

        const sourceInfo = getBlockInfoById(editor, sourceBlock.id, shellRef.current as HTMLElement);
        const targetInfo = getBlockInfoById(editor, targetBlock.id, shellRef.current as HTMLElement);
        if (!sourceInfo || !targetInfo || !canMoveBlockToTarget(editor, sourceInfo, targetInfo, placement)) return;

        if (isInsideColumnPlacement(placement)) {
            const plan = getColumnDropPlan(editor, sourceInfo, targetInfo, placement);
            if (!plan) return;
            if (plan.insertPos >= source.pos && plan.insertPos <= source.pos + source.node.nodeSize) return;

            const tr = editor.state.tr;
            deleteSourceForMove(editor, tr, source);

            if (plan.replaceFrom !== null && plan.replaceTo !== null) {
                tr.replaceWith(tr.mapping.map(plan.replaceFrom), tr.mapping.map(plan.replaceTo), source.node);
            } else {
                tr.insert(tr.mapping.map(plan.insertPos), source.node);
            }

            editor.view.dispatch(tr.scrollIntoView());
            closeBlockMenu();
            return;
        }

        const placeholderPlan = getColumnPlaceholderDropPlan(editor, sourceInfo, targetInfo);
        if (placeholderPlan) {
            if (placeholderPlan.insertPos >= source.pos && placeholderPlan.insertPos <= source.pos + source.node.nodeSize) return;

            const tr = editor.state.tr;
            deleteSourceForMove(editor, tr, source);
            tr.replaceWith(tr.mapping.map(placeholderPlan.replaceFrom), tr.mapping.map(placeholderPlan.replaceTo), source.node);
            editor.view.dispatch(tr.scrollIntoView());
            closeBlockMenu();
            return;
        }

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

    const copyBlockContent = useCallback(async (block: BlockHandleInfo) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const payload = getBlockClipboardPayload(editor, live.node);
        const copied = await copyRichBlockToClipboard({
            html: payload.html,
            text: payload.text || payload.markdown,
        });

        if (!copied) {
            await promptForText({
                title: '复制块内容',
                initialValue: payload.markdown || payload.text || payload.html,
                readOnly: true,
                confirmLabel: '关闭',
            });
        }

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

    const insertBlankBlock = useCallback((block: BlockHandleInfo, placement: 'before' | 'after') => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live) return;

        const { node, pos, context } = live;
        const { parent, index } = context;
        const insertIndex = placement === 'before' ? index : index + 1;
        const blankBlock = createEmptySiblingBlock(editor, node);

        if (!parent.canReplaceWith(insertIndex, insertIndex, blankBlock.type)) return;

        const insertPos = placement === 'before' ? pos : pos + node.nodeSize;
        const tr = editor.state.tr.insert(insertPos, blankBlock).scrollIntoView();
        const focusPos = Math.min(tr.doc.content.size, insertPos + 1);

        try {
            tr.setSelection(TextSelection.near(tr.doc.resolve(focusPos), 1));
        } catch {
            // Falling back to browser focus is better than rejecting the insert.
        }

        editor.view.dispatch(tr);
        editor.view.focus();
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock]);

    const turnBlockInto = useCallback((block: BlockHandleInfo, target: TurnIntoTarget) => {
        if (!editor) return;
        const live = getLiveBlock(block);
        if (!live || !TEXT_TURN_TYPES.has(live.node.type.name)) return;

        const { node, pos } = live;
        const schema = editor.state.schema;
        const attrs = getTextTurnAttrs(node);

        const replaceCurrentBlock = (nextNode: ProseMirrorNode) => {
            editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode).scrollIntoView());
            closeBlockMenu();
        };

        if (target === 'code') {
            const text = node.textContent || '';
            const codeContent = text ? schema.text(text) : null;
            replaceCurrentBlock(schema.nodes.codeBlock.create(attrs, codeContent));
            return;
        }

        if (target === 'callout') {
            const callout = schema.nodes.calloutBlock.create(
                { ...attrs, icon: '!', tone: 'yellow' },
                createTextTurnContainerContent(schema, node),
            );
            replaceCurrentBlock(callout);
            return;
        }

        if (target === 'toggle' || target === 'toggle-h1' || target === 'toggle-h2' || target === 'toggle-h3') {
            const title = node.textContent.trim() || 'Toggle';
            const inheritedLevel = node.type.name === 'heading' && [1, 2, 3].includes(Number(node.attrs.level))
                ? Number(node.attrs.level)
                : 0;
            const level = target === 'toggle-h1'
                ? 1
                : target === 'toggle-h2'
                    ? 2
                    : target === 'toggle-h3'
                        ? 3
                        : inheritedLevel;
            const toggle = schema.nodes.toggleBlock.create(
                { ...attrs, title, open: true, level },
                [schema.nodes.paragraph.create({ blockId: createBlockId() })],
            );
            replaceCurrentBlock(toggle);
            return;
        }

        if (target === 'paragraph') {
            replaceCurrentBlock(createTextTurnParagraph(schema, node, attrs));
            return;
        }

        if (target === 'h1' || target === 'h2' || target === 'h3') {
            const level = target === 'h1' ? 1 : target === 'h2' ? 2 : 3;
            replaceCurrentBlock(schema.nodes.heading.create({
                ...attrs,
                level,
            }, getTextTurnInlineContent(schema, node)));
            return;
        }

        if (target === 'bullet' || target === 'ordered' || target === 'todo') {
            replaceCurrentBlock(createTextTurnList(schema, node, attrs, target));
            return;
        }

        if (target === 'quote') {
            replaceCurrentBlock(schema.nodes.blockquote.create(
                attrs,
                createTextTurnContainerContent(schema, node),
            ));
        }
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
            await promptForText({
                title: '复制块链接',
                initialValue: url.toString(),
                readOnly: true,
                confirmLabel: '关闭',
            });
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

    const setBlockColor = useCallback((block: BlockHandleInfo, attribute: typeof BLOCK_TEXT_COLOR_ATTRIBUTE | typeof BLOCK_BACKGROUND_COLOR_ATTRIBUTE, value: BlockColorValue) => {
        if (!editor || !block.canStyleBlock) return;
        const live = getLiveBlock(block);
        if (!live || !TEXT_STYLE_BLOCK_TYPES.has(live.node.type.name)) return;

        const nextColor = normalizeBlockColor(value);
        const tr = editor.state.tr.setNodeMarkup(live.pos, undefined, {
            ...live.node.attrs,
            [attribute]: nextColor,
        }, live.node.marks);

        editor.view.dispatch(tr.scrollIntoView());
        window.requestAnimationFrame(() => refreshBlockPanelInfo(block.id));
        closeBlockMenu();
    }, [closeBlockMenu, editor, getLiveBlock, refreshBlockPanelInfo]);

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
        if (!editor || mode !== 'edit') return;
        pendingPointerRef.current = { target: event.target, clientY: event.clientY };
        if (pointerFrameRef.current !== null) return;
        pointerFrameRef.current = window.requestAnimationFrame(() => {
            pointerFrameRef.current = null;
            const pointer = pendingPointerRef.current;
            if (!pointer) return;
            const nextHandles = getColumnResizeHandles(editor, shellRef.current, pointer.clientY);
            setColumnResizeHandles((current) => {
                const unchanged = current.length === nextHandles.length && current.every((handle, index) => {
                    const next = nextHandles[index];
                    return handle.id === next?.id
                        && Math.abs(handle.top - next.top) < 1
                        && Math.abs(handle.left - next.left) < 1
                        && Math.abs(handle.height - next.height) < 1;
                });
                return unchanged ? current : nextHandles;
            });

            const nextBlock = getBlockInfoFromTarget(editor, pointer.target, shellRef.current);
            if (!nextBlock) {
                if (!blockMenuOpen && !dragBlock) setHoveredBlock(null);
                return;
            }
            setHoveredBlock((current) => {
                if (
                    current?.id === nextBlock.id
                    && Math.abs(current.top - nextBlock.top) < 1
                    && Math.abs(current.height - nextBlock.height) < 1
                ) return current;
                return nextBlock;
            });
        });
    }, [blockMenuOpen, dragBlock, editor, mode]);

    const handleEditorMouseLeave = useCallback(() => {
        pendingPointerRef.current = null;
        if (pointerFrameRef.current !== null) {
            window.cancelAnimationFrame(pointerFrameRef.current);
            pointerFrameRef.current = null;
        }
        if (!blockMenuOpen && !dragBlock) setHoveredBlock(null);
        setColumnResizeHandles([]);
    }, [blockMenuOpen, dragBlock]);

    const handleEditorCanvasClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!editor) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('.ProseMirror')) return;

        editor.chain().focus().run();
    }, [editor]);

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
        let latestClientX = startX;
        let animationFrame = 0;

        document.body.style.cursor = 'col-resize';

        const getWidths = (clientX: number) => {
            const deltaPercent = ((clientX - startX) / listWidth) * 100;
            const nextLeft = Math.max(COLUMN_MIN_WIDTH_PERCENT, Math.min(widthTotal - COLUMN_MIN_WIDTH_PERCENT, leftStart + deltaPercent));
            const nextRight = widthTotal - nextLeft;
            return { nextLeft, nextRight };
        };

        const previewResize = () => {
            animationFrame = 0;
            const { nextLeft, nextRight } = getWidths(latestClientX);
            leftElement?.style.setProperty('--smart-column-width', formatColumnWidth(nextLeft));
            rightElement?.style.setProperty('--smart-column-width', formatColumnWidth(nextRight));
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            latestClientX = moveEvent.clientX;
            if (!animationFrame) animationFrame = window.requestAnimationFrame(previewResize);
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            upEvent.preventDefault();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            document.body.style.cursor = previousCursor;
            const { nextLeft, nextRight } = getWidths(upEvent.clientX);
            leftElement?.style.setProperty('--smart-column-width', formatColumnWidth(nextLeft));
            rightElement?.style.setProperty('--smart-column-width', formatColumnWidth(nextRight));
            applyColumnWidths(handle.leftColumnId, handle.rightColumnId, nextLeft, nextRight, true);
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
            const placement = getBlockDropPlacement(target, clientY, shellTop);
            const allowed = canMoveBlockToTarget(editor, source, target, placement);
            const indicator = getBlockDropIndicator(target, placement);

            currentDrag = {
                source,
                drop: {
                    target,
                    placement,
                    top: indicator.top,
                    left: indicator.left,
                    width: indicator.width,
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

        const placement = getBlockDropPlacement(target, event.clientY, shellRef.current.getBoundingClientRect().top);
        const allowed = canMoveBlockToTarget(editor, dragBlock.source, target, placement);
        const indicator = getBlockDropIndicator(target, placement);

        event.preventDefault();
        event.dataTransfer.dropEffect = allowed ? 'move' : 'none';

        setDragBlock({
            source: dragBlock.source,
            drop: {
                target,
                placement,
                top: indicator.top,
                left: indicator.left,
                width: indicator.width,
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

    const addImageByUrl = useCallback(async () => {
        if (!editor) return;
        const url = await promptForImageUrl();
        if (!url) return;
        editor.chain().focus().setImage({ src: url, width: '100%', align: 'center' } as any).run();
    }, [editor]);

    const setSelectionLink = useCallback(async () => {
        if (!editor) return;
        const previousUrl = String(editor.getAttributes('link').href || '');
        const url = await promptForUrl({
            title: '链接地址',
            initialValue: previousUrl,
            allowEmpty: true,
            confirmLabel: '保存',
        });
        if (url === null) return;
        if (!url.trim()) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    }, [editor]);

    const downloadRecoverySource = useCallback(() => {
        const source = JSON.stringify({
            exported_at: new Date().toISOString(),
            document_id: currentDocumentId,
            markdown_backup: content || '',
            original_content_json: contentJson ?? null,
        }, null, 2);
        const url = URL.createObjectURL(new Blob([source], { type: 'application/json;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `document-${currentDocumentId || 'unknown'}-recovery-source.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, [content, contentJson, currentDocumentId]);

    const repairRecoveredContent = useCallback(async () => {
        if (!editor || editor.isDestroyed || !currentDocumentId || contentRecoveryState === 'saving') return;
        setContentRecoveryState('saving');
        setContentRecoveryError('');

        try {
            const value = readSmartDocumentValue(editor);
            if (!value || !isValidDocJson(value.json)) {
                throw new Error('修复结果不是有效的文档结构，已停止写入。');
            }
            const checked = editor.schema.nodeFromJSON(value.json);
            checked.check();
            if ((content || '').trim() && !value.markdown.trim() && !value.text.trim()) {
                throw new Error('修复结果为空，与 Markdown 备份不一致，已停止写入。');
            }

            const result = await api.repairSOPContent(currentDocumentId, {
                content: value.markdown,
                content_json: value.json,
                content_schema_version: SMART_DOCUMENT_SCHEMA_VERSION,
                ...(Number.isSafeInteger(contentRevision) && Number(contentRevision) > 0
                    ? { expected_revision: Number(contentRevision) }
                    : {}),
                userId: CURRENT_USER_ID,
            });

            recoveryBlockedRef.current = false;
            initialContentRecoveryRef.current = false;
            externalSigRef.current = getContentSignature(value.json, value.markdown);
            setContentRecoveryWarning(false);
            setContentRecoveryExpanded(false);
            setContentRecoveryState('idle');
            if (!editor.isDestroyed) editor.setEditable(mode === 'edit');
            try {
                onRecoveryRepaired?.(value, result);
            } catch (callbackError) {
                // The server repair is already confirmed at this point. A local
                // state callback must never make the UI claim that it failed.
                console.error('[document-editor] Recovery confirmation callback failed.', callbackError);
            }
        } catch (error) {
            console.error('[document-editor] Safe content repair failed.', error);
            recoveryBlockedRef.current = true;
            setContentRecoveryState('error');
            setContentRecoveryError(error instanceof Error ? error.message : '修复失败，请重试。');
        }
    }, [content, contentRecoveryState, contentRevision, currentDocumentId, editor, mode, onRecoveryRepaired]);

    if (!editor) return null;

    const commentPanelComments = commentPanelBlock
        ? normalizeBlockComments(findBlockById(editor, commentPanelBlock.id)?.node.attrs.blockComments)
        : [];

    return (
        <div
            ref={shellRef}
            className="smart-document smart-document-editor-shell"
            data-mode={mode}
            data-theme={theme}
            data-recovery-blocked={contentRecoveryWarning ? 'true' : 'false'}
            data-outline-local-toggle={showLocalOutlineToggle ? 'true' : 'false'}
            onDragOver={handleEditorDragOver}
            onDrop={handleEditorDrop}
            onDragEnd={handleEditorDragEnd}
        >
            {mode === 'edit' && !contentRecoveryWarning && <BlockHandleLayer
                block={hoveredBlock}
                menuOpen={blockMenuOpen}
                onMenuOpenChange={setBlockMenuOpen}
                onMove={moveBlock}
                onDuplicate={duplicateBlock}
                onCopyContent={copyBlockContent}
                onDelete={deleteBlock}
                onInsertBlank={insertBlankBlock}
                onTurnInto={turnBlockInto}
                onSetBlockTextColor={(block, color) => setBlockColor(block, BLOCK_TEXT_COLOR_ATTRIBUTE, color)}
                onSetBlockBackgroundColor={(block, color) => setBlockColor(block, BLOCK_BACKGROUND_COLOR_ATTRIBUTE, color)}
                onCopyLink={copyBlockLink}
                onOpenComments={openBlockComments}
                onDragStart={handleBlockDragStart}
            />}
            {mode === 'edit' && <BlockDropIndicator dragBlock={dragBlock} />}
            {mode === 'edit' && <ColumnResizeLayer handles={columnResizeHandles} onResizeStart={handleColumnResizeStart} />}
            {mode === 'edit' && <BlockCommentPanel
                block={commentPanelBlock}
                comments={commentPanelComments}
                onClose={closeBlockComments}
                onAdd={addBlockComment}
                onResolve={resolveBlockComment}
                onDelete={deleteBlockComment}
            />}
            <div className="smart-document-editor-main">
                {showLocalOutlineToggle ? (
                    <div className="smart-document-outline-local-control">
                        <button
                            type="button"
                            className="smart-document-icon-button"
                            data-smart-document-outline-toggle
                            data-active={showTOC ? 'true' : 'false'}
                            aria-label={showTOC ? '隐藏文档大纲' : '显示文档大纲'}
                            aria-expanded={showTOC}
                            aria-controls="smart-document-outline"
                            title={showTOC ? '隐藏文档大纲' : '显示文档大纲'}
                            onClick={() => setShowTOC(!showTOC)}
                        >
                            <ListTree aria-hidden="true" />
                        </button>
                    </div>
                ) : null}
                {showTOC && (
                    <div ref={outlineLayerRef} className="smart-document-outline-layer">
                        <button
                            type="button"
                            className="smart-document-outline-scrim"
                            aria-label="关闭文档大纲"
                            onClick={() => setShowTOC(false)}
                        />
                        <aside
                            ref={outlinePanelRef}
                            id="smart-document-outline"
                            className="smart-document-outline-panel"
                            aria-label="文档大纲"
                        >
                            <div className="smart-document-outline-header">
                                <h4>
                                    <ListTree aria-hidden="true" />
                                    大纲
                                </h4>
                                <button
                                    type="button"
                                    onClick={() => setShowTOC(false)}
                                    className="smart-document-icon-button"
                                    title="隐藏文档大纲"
                                    aria-label="隐藏文档大纲"
                                >
                                    <X aria-hidden="true" />
                                </button>
                            </div>
                            <div className="smart-document-outline-content custom-scrollbar">
                                <TableOfContents editor={editor} onNavigate={() => setShowTOC(false)} />
                            </div>
                        </aside>
                    </div>
                )}
                {findPanelMode ? (
                    <EditorFindReplace
                        editor={editor}
                        mode={findPanelMode}
                        readOnly={mode === 'read'}
                        onClose={() => setFindPanelMode(null)}
                    />
                ) : null}
                {contentRecoveryWarning && (
                    <div className="smart-document-recovery-warning" role="status" aria-live="polite">
                        <AlertTriangle aria-hidden="true" />
                        <div className="smart-document-recovery-warning__body">
                            <strong>这份文档需要安全修复</strong>
                            <p>
                                下方显示的是从 Markdown 备份重建的预览。修复前编辑已锁定；点击“修复并保存”后，
                                服务端会先保存原始 JSON 与 Markdown 快照，再通过版本校验写入新结构。
                            </p>
                            <div className="smart-document-recovery-warning__actions">
                                {mode === 'edit' ? (
                                    <button
                                        type="button"
                                        className="smart-document-recovery-warning__primary"
                                        disabled={contentRecoveryState === 'saving' || !currentDocumentId}
                                        onClick={() => void repairRecoveredContent()}
                                    >
                                        {contentRecoveryState === 'saving' ? '正在备份并修复…' : '修复并保存'}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => setContentRecoveryExpanded((current) => !current)}
                                    aria-expanded={contentRecoveryExpanded}
                                >
                                    {contentRecoveryExpanded ? '收起修复预览' : '查看修复预览'}
                                </button>
                                <button type="button" onClick={downloadRecoverySource}>下载原始数据</button>
                            </div>
                            {contentRecoveryExpanded ? (
                                <div className="smart-document-recovery-preview">
                                    <section>
                                        <h4>原始结构化 JSON</h4>
                                        <pre>{JSON.stringify(contentJson ?? null, null, 2)}</pre>
                                    </section>
                                    <section>
                                        <h4>待保存的 Markdown</h4>
                                        <pre>{editorToMarkdown(editor) || '（空文档）'}</pre>
                                    </section>
                                </div>
                            ) : null}
                            {contentRecoveryError ? (
                                <p className="smart-document-recovery-warning__error" role="alert">
                                    {contentRecoveryError}
                                </p>
                            ) : null}
                        </div>
                    </div>
                )}
                {mode === 'edit' && !contentRecoveryWarning && <EditorCompactToolbar
                    editor={editor} 
                    onAddImage={addImage}
                    onAddImageUrl={addImageByUrl}
                    onAddWhiteboard={() => { void insertWhiteboardIntoEditor(editor); }}
                />}
                {mode === 'edit' && !contentRecoveryWarning && (
                    <div className="smart-document-context-toolbar-row">
                        <EditorTableMenu editor={editor} />
                        <TableCellBackgroundMenu editor={editor} />
                    </div>
                )}
                <div
                    className="smart-document-canvas"
                    onClick={handleEditorCanvasClick}
                    onMouseMove={handleEditorMouseMove}
                    onMouseLeave={handleEditorMouseLeave}
                >
                    <div className="smart-document-content-rail">
                        <EditorContent editor={editor} />
                        {mode === 'edit' && !contentRecoveryWarning && <EditorSelectionMenu editor={editor} onSetLink={setSelectionLink} />}
                    </div>
                </div>
            </div>
        </div>
    )
}

const menuButtonClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

const BlockColorSwatchRow = ({
    label,
    value,
    options,
    onSelect,
}: {
    label: string;
    value: BlockColorValue;
    options: Array<{ label: string; value: BlockColorValue; swatch: string }>;
    onSelect: (value: BlockColorValue) => void;
}) => (
    <div className="px-2 py-1">
        <div className="mb-1 text-[10px] font-medium text-gray-400">{label}</div>
        <div className="grid grid-cols-10 gap-1">
            {options.map((option) => {
                const active = normalizeBlockColor(option.value) === normalizeBlockColor(value);
                return (
                    <button
                        key={option.value || 'default'}
                        type="button"
                        title={`${label}: ${option.label}`}
                        className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                            active ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400'
                        }`}
                        onClick={() => onSelect(option.value)}
                    >
                        <span
                            className="block h-3.5 w-3.5 rounded-sm border border-black/10"
                            style={{ backgroundColor: option.swatch }}
                        />
                    </button>
                );
            })}
        </div>
    </div>
);

const BlockHandleLayer = ({
    block,
    menuOpen,
    onMenuOpenChange,
    onMove,
    onDuplicate,
    onCopyContent,
    onDelete,
    onInsertBlank,
    onTurnInto,
    onSetBlockTextColor,
    onSetBlockBackgroundColor,
    onCopyLink,
    onOpenComments,
    onDragStart,
}: {
    block: BlockHandleInfo | null;
    menuOpen: boolean;
    onMenuOpenChange: (open: boolean) => void;
    onMove: (block: BlockHandleInfo, direction: 'up' | 'down') => void;
    onDuplicate: (block: BlockHandleInfo) => void;
    onCopyContent: (block: BlockHandleInfo) => void;
    onDelete: (block: BlockHandleInfo) => void;
    onInsertBlank: (block: BlockHandleInfo, placement: 'before' | 'after') => void;
    onTurnInto: (block: BlockHandleInfo, target: TurnIntoTarget) => void;
    onSetBlockTextColor: (block: BlockHandleInfo, color: BlockColorValue) => void;
    onSetBlockBackgroundColor: (block: BlockHandleInfo, color: BlockColorValue) => void;
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
                        className="absolute left-8 top-0 max-h-[360px] w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <button className={menuButtonClass} disabled={!block.canMoveUp} onClick={() => onMove(block, 'up')}>
                            <ArrowUp className="h-3.5 w-3.5" /> 上移
                        </button>
                        <button className={menuButtonClass} disabled={!block.canMoveDown} onClick={() => onMove(block, 'down')}>
                            <ArrowDown className="h-3.5 w-3.5" /> 下移
                        </button>
                        <button className={menuButtonClass} onClick={() => onInsertBlank(block, 'before')}>
                            <Plus className="h-3.5 w-3.5" /> 上方插入
                        </button>
                        <button className={menuButtonClass} onClick={() => onInsertBlank(block, 'after')}>
                            <Plus className="h-3.5 w-3.5" /> 下方插入
                        </button>
                        <button className={menuButtonClass} onClick={() => onCopyContent(block)}>
                            <Copy className="h-3.5 w-3.5" /> 复制内容
                        </button>
                        <button className={menuButtonClass} onClick={() => onDuplicate(block)}>
                            <Copy className="h-3.5 w-3.5" /> 复制一份
                        </button>
                        <button className={menuButtonClass} onClick={() => onCopyLink(block)}>
                            <LinkIcon className="h-3.5 w-3.5" /> 复制块链接
                        </button>

                        <button className={menuButtonClass} onClick={() => onOpenComments(block)}>
                            <MessageSquare className="h-3.5 w-3.5" /> 评论{block.commentCount ? ` (${block.commentCount})` : ''}
                        </button>

                        {block.canStyleBlock && (
                            <>
                                <div className="my-1 h-px bg-gray-100" />
                                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                    <Palette className="h-3 w-3" /> 颜色
                                </div>
                                <BlockColorSwatchRow
                                    label="文字"
                                    value={block.blockTextColor}
                                    options={BLOCK_TEXT_COLOR_OPTIONS}
                                    onSelect={(color) => onSetBlockTextColor(block, color)}
                                />
                                <BlockColorSwatchRow
                                    label="背景"
                                    value={block.blockBackgroundColor}
                                    options={BLOCK_BACKGROUND_COLOR_OPTIONS}
                                    onSelect={(color) => onSetBlockBackgroundColor(block, color)}
                                />
                            </>
                        )}

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
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'code')}>
                                    <Code className="h-3.5 w-3.5" /> 代码块
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'toggle')}>
                                    <ChevronRight className="h-3.5 w-3.5" /> 折叠块
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'toggle-h1')}>
                                    <Heading1 className="h-3.5 w-3.5" /> 折叠一级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'toggle-h2')}>
                                    <Heading2 className="h-3.5 w-3.5" /> 折叠二级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'toggle-h3')}>
                                    <Heading3 className="h-3.5 w-3.5" /> 折叠三级标题
                                </button>
                                <button className={menuButtonClass} onClick={() => onTurnInto(block, 'callout')}>
                                    <AlertTriangle className="h-3.5 w-3.5" /> Callout
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

type OutlineHeading = { level: number; text: string; id: string; pos: number };

const TableOfContents = ({ editor, onNavigate }: { editor: any; onNavigate?: () => void }) => {
    const [headings, setHeadings] = useState<OutlineHeading[]>([]);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
    const listRef = React.useRef<HTMLUListElement | null>(null);

    useEffect(() => {
        if (!editor) return;
        let frame = 0;
        let previousSignature = '';

        const updateHeadings = () => {
            const items: OutlineHeading[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
                if (node.type.name === 'heading') {
                    items.push({
                        level: node.attrs.level,
                        text: node.textContent,
                        id: `heading-${pos}`,
                        pos,
                    });
                }
                if (node.type.name === 'toggleBlock' && Number(node.attrs.level) > 0) {
                    items.push({
                        level: Number(node.attrs.level),
                        text: String(node.attrs.title || '折叠标题'),
                        id: `toggle-heading-${pos}`,
                        pos,
                    });
                }
            });
            const signature = items.map((item) => `${item.level}:${item.pos}:${item.text}`).join('|');
            if (signature !== previousSignature) {
                previousSignature = signature;
                setHeadings(items);
            }
        };

        const scheduleUpdate = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                updateHeadings();
            });
        };

        updateHeadings();
        editor.on('update', scheduleUpdate);

        return () => {
            editor.off('update', scheduleUpdate);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [editor]);

    useEffect(() => {
        if (!editor || headings.length === 0) {
            setActiveHeadingId(null);
            return;
        }

        const editorElement = editor.view.dom as HTMLElement;
        const workspaceScroll = editorElement.closest<HTMLElement>('.smart-document-shell__scroll');
        const editorCanvas = editorElement.closest<HTMLElement>('.smart-document-canvas');
        const scrollContainer = workspaceScroll
            || (editorCanvas && editorCanvas.scrollHeight > editorCanvas.clientHeight + 1 ? editorCanvas : null);
        const scrollTarget: HTMLElement | Window = scrollContainer || window;
        let frame = 0;

        const updateActiveHeading = () => {
            const containerTop = scrollContainer?.getBoundingClientRect().top || 0;
            const activationLine = containerTop + (editor.isEditable ? 64 : 32);
            let activeId = headings[0]?.id || null;

            for (const heading of headings) {
                const element = editor.view.nodeDOM(heading.pos) as HTMLElement | null;
                if (!element) continue;
                if (element.getBoundingClientRect().top <= activationLine) activeId = heading.id;
                else break;
            }

            setActiveHeadingId((current) => current === activeId ? current : activeId);
        };
        const scheduleUpdate = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                updateActiveHeading();
            });
        };

        updateActiveHeading();
        scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);
        editor.on('update', scheduleUpdate);

        return () => {
            scrollTarget.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            editor.off('update', scheduleUpdate);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [editor, headings]);

    useEffect(() => {
        if (!activeHeadingId) return;
        const list = listRef.current;
        const content = list?.closest<HTMLElement>('.smart-document-outline-content');
        const activeButton = list?.querySelector<HTMLElement>(`[data-outline-heading="${activeHeadingId}"]`);
        if (!content || !activeButton) return;

        const contentBounds = content.getBoundingClientRect();
        const buttonBounds = activeButton.getBoundingClientRect();
        if (buttonBounds.top < contentBounds.top + 8) {
            content.scrollTop -= contentBounds.top + 8 - buttonBounds.top;
        } else if (buttonBounds.bottom > contentBounds.bottom - 8) {
            content.scrollTop += buttonBounds.bottom - contentBounds.bottom + 8;
        }
    }, [activeHeadingId]);

    if (headings.length === 0) {
        return <div className="smart-document-outline-empty">暂无标题，请使用 H1-H6 添加</div>;
    }

    return (
        <ul ref={listRef} className="smart-document-outline-list">
            {headings.map((heading) => (
                <li key={heading.id} data-active={activeHeadingId === heading.id ? 'true' : 'false'}>
                    <button
                        type="button"
                        data-outline-heading={heading.id}
                        data-level={Math.min(heading.level, 6)}
                        aria-current={activeHeadingId === heading.id ? 'location' : undefined}
                        title={heading.text || '(空标题)'}
                        onClick={() => {
                            setActiveHeadingId(heading.id);
                            if (editor.isEditable) editor.commands.setTextSelection(heading.pos + 1);
                            const element = editor.view.nodeDOM(heading.pos) as HTMLElement | null;
                            element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            if (window.matchMedia('(max-width: 48rem)').matches) onNavigate?.();
                        }}
                    >
                        {heading.text || '(空标题)'}
                    </button>
                </li>
            ))}
        </ul>
    );
};

/** @deprecated Kept temporarily for downstream compatibility during the contextual-toolbar rollout. */
export const LegacyEditorToolbar = ({
    editor,
    onAddImage,
    onAddImageUrl,
    showTOC,
    onToggleTOC,
}: {
    editor: any,
    onAddImage: () => void,
    onAddImageUrl: () => void,
    showTOC: boolean,
    onToggleTOC: () => void,
}) => {
    if (!editor) return null;

    const setLink = async () => {
        const previousUrl = editor.getAttributes('link').href || '';
        const url = await promptForUrl({
            title: '链接地址',
            initialValue: previousUrl,
            allowEmpty: true,
            confirmLabel: '保存',
        });
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
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                disabled={!editor.can().addColumnBefore()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="左列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                disabled={!editor.can().addColumnAfter()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="右列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().deleteColumn().run()}
                disabled={!editor.can().deleteColumn()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="-列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().addRowBefore().run()}
                disabled={!editor.can().addRowBefore()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="上行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().addRowAfter().run()}
                disabled={!editor.can().addRowAfter()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="下行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().deleteRow().run()}
                disabled={!editor.can().deleteRow()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="-行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                disabled={!editor.can().toggleHeaderRow()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="表头行"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
                disabled={!editor.can().toggleHeaderColumn()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="表头列"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().mergeCells().run()}
                disabled={!editor.can().mergeCells()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="合并"
            />
            <ToolbarBtn
                onClick={() => editor.chain().focus().splitCell().run()}
                disabled={!editor.can().splitCell()}
                icon={<TableIcon className="w-4 h-4"/>}
                label="拆分"
            />
            <TableCellBackgroundMenu editor={editor} />
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
            <ToolbarBtn
                onClick={onAddImageUrl}
                icon={<LinkIcon className="w-4 h-4"/>}
                label="图片URL"
            />
        </div>
    );
};

const TABLE_BACKGROUND_SCOPE_OPTIONS: Array<{ value: TableCellBackgroundScope; label: string }> = [
    { value: 'cell', label: '单元格' },
    { value: 'row', label: '整行' },
    { value: 'column', label: '整列' },
];

const TableCellBackgroundMenu = ({ editor }: { editor: any }) => {
    const [open, setOpen] = useState(false);
    const [scope, setScope] = useState<TableCellBackgroundScope>('cell');
    const tableState = useEditorState({
        editor,
        selector: ({ editor: currentEditor }) => ({
            active: currentEditor.isActive('table'),
            canUse: canUpdateTableCellBackground(currentEditor),
            activeColor: getCurrentTableCellBackground(currentEditor),
        }),
    });
    const canUse = tableState.canUse;
    const activeColor = tableState.activeColor;

    useEffect(() => {
        if (!canUse) setOpen(false);
    }, [canUse]);

    const applyColor = (value: string | null) => {
        if (!canUse) return;
        if (setTableCellBackground(editor, scope, value)) setOpen(false);
    };

    if (!tableState.active) return null;

    return (
        <div className="relative flex-shrink-0">
            <button
                type="button"
                title="表格背景色"
                disabled={!canUse}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpen((current) => !current)}
                className={`p-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    open ? 'bg-gray-200 text-black' : 'text-gray-600 hover:bg-gray-200'
                }`}
            >
                <Palette className="w-4 h-4" />
                <span
                    className="h-3 w-3 rounded-sm border border-gray-300"
                    style={{
                        background: activeColor || 'linear-gradient(135deg, #ffffff 0 45%, #ef4444 46% 54%, #ffffff 55% 100%)',
                    }}
                />
            </button>

            {open && (
                <div
                    className="absolute left-0 top-9 z-50 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
                    onMouseDown={(event) => event.preventDefault()}
                >
                    <div className="mb-2 grid grid-cols-3 rounded-md bg-gray-100 p-0.5">
                        {TABLE_BACKGROUND_SCOPE_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setScope(option.value)}
                                className={`h-7 rounded text-xs font-medium transition-colors ${
                                    scope === option.value
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                        {TABLE_CELL_BACKGROUND_COLORS.map((color) => {
                            const isActive = normalizeTableCellBackground(color.value) === activeColor;
                            return (
                                <button
                                    key={color.label}
                                    type="button"
                                    title={color.label}
                                    onClick={() => applyColor(color.value)}
                                    className={`flex h-8 items-center justify-center rounded border transition-colors ${
                                        isActive ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
                                    }`}
                                >
                                    <span
                                        className="h-4 w-4 rounded-sm border border-gray-300"
                                        style={{
                                            background: color.value
                                                ? color.swatch
                                                : 'linear-gradient(135deg, #ffffff 0 45%, #ef4444 46% 54%, #ffffff 55% 100%)',
                                        }}
                                    />
                                </button>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={() => applyColor(null)}
                        className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    >
                        <X className="h-3.5 w-3.5" />
                        清除颜色
                    </button>
                </div>
            )}
        </div>
    );
};

/** @deprecated Used only by LegacyEditorToolbar. */
export function ToolbarBtn({ icon, label, onClick, isActive, disabled }: { icon: React.ReactNode; label?: string; onClick?: () => void; isActive?: boolean; disabled?: boolean }) {
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
