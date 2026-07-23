import {
  MIND_MAP_COMMAND_TYPES,
  type UpsertLinkCommand,
} from '../commands/types';
import { createEntityId } from '../domain/ids';
import { compareOrderedEntities, createOrderKeyBetween } from '../domain/orderKey';
import { getChildrenSorted, getTreeRoots } from '../domain/tree';
import type {
  CommandId,
  LinkId,
  MindMapDocumentV1,
  MindMapSheet,
  OrderKey,
  SheetId,
  TopicId,
  TopicLink,
} from '../domain/types';
import { mindMapRichTextToPlainText } from '../view/text';

export type InternalLinkTarget =
  | { readonly kind: 'sheet'; readonly targetSheetId: SheetId }
  | {
      readonly kind: 'topic';
      readonly targetSheetId: SheetId;
      readonly targetTopicId: TopicId;
    };

export interface InternalLinkTargetOption {
  readonly key: string;
  readonly kind: InternalLinkTarget['kind'];
  readonly sheetId: SheetId;
  readonly sheetTitle: string;
  readonly topicId?: TopicId;
  readonly topicTitle?: string;
  readonly path: readonly string[];
  readonly depth: number;
  readonly searchableText: string;
}

export interface ListInternalLinkTargetsOptions {
  readonly query?: string;
  readonly includeSheets?: boolean;
  readonly includeTopics?: boolean;
}

export const internalLinkTargetKey = (target: InternalLinkTarget): string => target.kind === 'sheet'
  ? `sheet:${target.targetSheetId}`
  : `topic:${target.targetSheetId}:${target.targetTopicId}`;

const normalizeSearch = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase();

const topicTitle = (
  sheet: MindMapSheet,
  topicId: TopicId,
): string => mindMapRichTextToPlainText(sheet.topics[topicId]?.title).trim() || '未命名主题';

const orderedSheets = (document: MindMapDocumentV1): MindMapSheet[] => Object.values(document.sheets)
  .sort(compareOrderedEntities);

/**
 * Builds the XMind-style target picker model in canonical Sheet/tree order.
 * Floating roots are included after the central root according to getTreeRoots.
 */
export const listInternalLinkTargets = (
  document: MindMapDocumentV1,
  options: ListInternalLinkTargetsOptions = {},
): InternalLinkTargetOption[] => {
  const includeSheets = options.includeSheets ?? true;
  const includeTopics = options.includeTopics ?? true;
  const query = normalizeSearch(options.query ?? '');
  const queryTokens = query.split(/\s+/u).filter(Boolean);
  const result: InternalLinkTargetOption[] = [];
  const matchesQuery = (searchableText: string): boolean => queryTokens.length === 0
    || queryTokens.every((token) => searchableText.includes(token));

  for (const sheet of orderedSheets(document)) {
    const sheetTitle = sheet.title.trim() || '未命名 Sheet';
    if (includeSheets) {
      const option: InternalLinkTargetOption = {
        key: `sheet:${sheet.id}`,
        kind: 'sheet',
        sheetId: sheet.id,
        sheetTitle,
        path: [sheetTitle],
        depth: 0,
        searchableText: normalizeSearch(sheetTitle),
      };
      if (matchesQuery(option.searchableText)) result.push(option);
    }

    if (!includeTopics) continue;
    const visited = new Set<TopicId>();
    const visit = (topicId: TopicId, ancestors: readonly string[], depth: number): void => {
      if (visited.has(topicId) || !sheet.topics[topicId]) return;
      visited.add(topicId);
      const title = topicTitle(sheet, topicId);
      const path = [...ancestors, title];
      const searchableText = normalizeSearch(`${sheetTitle} ${path.join(' ')}`);
      const option: InternalLinkTargetOption = {
        key: `topic:${sheet.id}:${topicId}`,
        kind: 'topic',
        sheetId: sheet.id,
        sheetTitle,
        topicId,
        topicTitle: title,
        path,
        depth,
        searchableText,
      };
      if (matchesQuery(searchableText)) result.push(option);
      for (const child of getChildrenSorted(sheet, topicId)) {
        visit(child.id, path, depth + 1);
      }
    };

    for (const root of getTreeRoots(sheet)) visit(root.id, [], 0);
    // Canonical validation normally makes this unnecessary, but preserving an
    // orphan in the picker is safer than silently making it impossible to link.
    for (const topic of Object.values(sheet.topics).sort((left, right) => left.id.localeCompare(right.id))) {
      visit(topic.id, [], 0);
    }
  }

  return result;
};

interface InternalLinkCommandInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly target: InternalLinkTarget;
  readonly title?: string;
  readonly linkId?: LinkId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const nextLinkOrderKey = (links: readonly TopicLink[]): OrderKey => {
  const ordered = [...links].sort(compareOrderedEntities);
  const last = ordered.length > 0 ? ordered[ordered.length - 1]!.orderKey : undefined;
  if (!last) return createOrderKeyBetween();
  try {
    return createOrderKeyBetween(last, null);
  } catch {
    if (last.length < 256) return `${last}~` as OrderKey;
    throw new Error('链接顺序空间已用尽，请先重排链接后再添加。');
  }
};

const normalizeOptionalTitle = (title: string | undefined): string | undefined => {
  const normalized = title?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 4096 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('链接标题必须少于 4097 个字符，且不能包含控制字符。');
  }
  return normalized;
};

/** Creates or retargets one canonical Sheet/Topic Link without a transient broken state. */
export const planUpsertInternalTopicLinkCommand = (
  input: InternalLinkCommandInput,
): UpsertLinkCommand => {
  const sourceSheet = input.document.sheets[input.sheetId];
  if (!sourceSheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  if (!sourceSheet.topics[input.topicId]) throw new Error(`Topic ${input.topicId} does not exist.`);

  const targetSheet = input.document.sheets[input.target.targetSheetId];
  if (!targetSheet) throw new Error('目标 Sheet 不存在或已被删除。');
  if (input.target.kind === 'topic' && !targetSheet.topics[input.target.targetTopicId]) {
    throw new Error('目标主题不存在或已被删除。');
  }

  const existing = input.linkId ? sourceSheet.links[input.linkId] : undefined;
  if (input.linkId && !existing) throw new Error('要编辑的链接不存在。');
  if (existing && existing.topicId !== input.topicId) throw new Error('不能把链接移动到其他主题。');
  const title = normalizeOptionalTitle(input.title);
  const sourceLinks = Object.values(sourceSheet.links).filter((link) => link.topicId === input.topicId);
  const base = {
    id: existing?.id ?? createEntityId<'Link'>(),
    topicId: input.topicId,
    orderKey: existing?.orderKey ?? nextLinkOrderKey(sourceLinks),
    status: 'active' as const,
    ...(title ? { title } : {}),
  };
  const link: TopicLink = input.target.kind === 'sheet'
    ? { ...base, kind: 'sheet', targetSheetId: input.target.targetSheetId }
    : {
        ...base,
        kind: 'topic',
        targetSheetId: input.target.targetSheetId,
        targetTopicId: input.target.targetTopicId,
      };

  return {
    commandId: input.commandId ?? createEntityId<'Command'>(),
    type: MIND_MAP_COMMAND_TYPES.upsertLink,
    sheetId: input.sheetId,
    payload: { link },
    baseRevision: input.document.contentRevision,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    origin: input.origin ?? 'mindmap-v2-internal-link-picker',
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
};
