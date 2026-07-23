import type {
  ActorId,
  Asset,
  AssetId,
  AttachmentId,
  ImageId,
  ISODateTime,
  LinkId,
  MarkerInstanceId,
  MindMapDocumentV1,
  NoteId,
  Rect,
  SheetId,
  Size,
  TaskDisplayField,
  TaskId,
  TaskStatus,
  TodoId,
  TopicId,
  TopicImagePlacement,
} from '../domain/types';
import {
  managedMindMapImageMimeType,
  mindMapImageAssetUrl,
} from '../assets/managedImageTransport';
import { richTextToPlainText } from './projection';

export type TopicEnrichmentKind =
  | 'marker'
  | 'label'
  | 'note'
  | 'link'
  | 'image'
  | 'attachment'
  | 'todo'
  | 'todo-progress'
  | 'task';

export type TopicBadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

export interface TopicBadgeProjection {
  readonly kind: TopicEnrichmentKind;
  /** Canonical entity ID, or a deterministic derived ID for labels/progress. */
  readonly id: string;
  readonly topicId: TopicId;
  readonly label: string;
  readonly title: string;
  readonly displayText?: string;
  readonly tone: TopicBadgeTone;
  readonly progress?: number;
  readonly missingReference?: boolean;
  /** Deterministic vector artwork metadata, present only for Marker badges. */
  readonly markerSourceKind?: 'asset' | 'builtin';
  readonly markerSourceKey?: string;
}

export interface NoteEnrichmentProjection {
  readonly id: NoteId;
  readonly preview: string;
  readonly hasContent: boolean;
}

export interface LinkEnrichmentProjection {
  readonly id: LinkId;
  readonly kind: 'web' | 'email' | 'file' | 'folder' | 'sheet' | 'topic' | 'document-page';
  readonly label: string;
  readonly status: 'active' | 'broken';
  readonly unresolvedTarget: boolean;
}

export interface AssetReferenceProjection {
  readonly assetId: AssetId;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly byteSize?: number;
  readonly missingAsset: boolean;
}

export interface AttachmentEnrichmentProjection extends AssetReferenceProjection {
  readonly id: AttachmentId;
}

export type ImageRendererSource =
  | {
      readonly status: 'ready';
      /** A renderer-safe remote URL or a mounted-session Blob URL. */
      readonly url: string;
    }
  | {
      readonly status: 'unavailable';
      readonly reason:
        | 'missing-asset'
        | 'embedded-source'
        | 'managed-source'
        | 'unsafe-remote-url'
        | 'unsupported-mime-type';
    };

export type ImageDisplaySizeSource = 'explicit' | 'intrinsic' | 'fallback';

/**
 * Renderer bounds are intentionally shared by projection, layout, and the
 * read-only image component. They keep malformed or unusually large canonical
 * dimensions from destabilizing the canvas while preserving the source data.
 */
export const TOPIC_IMAGE_DISPLAY_LIMITS = Object.freeze({
  fallbackWidth: 160,
  fallbackHeight: 90,
  minimumWidth: 24,
  minimumHeight: 24,
  maximumWidth: 2_048,
  maximumHeight: 2_048,
});

export interface ImageEnrichmentProjection extends AssetReferenceProjection {
  readonly id: ImageId;
  readonly role: 'inline' | 'thumbnail' | 'background' | 'sticker';
  /** Canonical placement copied by value so renderer code cannot mutate the document. */
  readonly placement: TopicImagePlacement;
  /** Canonical explicit display size, when present. */
  readonly size?: Size;
  /** Canonical asset dimensions, when present. */
  readonly intrinsicSize?: Size;
  /** Deterministic, clamped box used by both layout and rendering. */
  readonly displaySize: Size;
  readonly displaySizeSource: ImageDisplaySizeSource;
  readonly crop?: Rect;
  readonly alt?: string;
  /** Safe rendering state; never contains embedded paths or managed object keys. */
  readonly rendererSource: ImageRendererSource;
}

export interface MarkerEnrichmentProjection {
  readonly id: MarkerInstanceId;
  readonly label: string;
  readonly groupName: string;
  readonly sourceKind?: 'builtin' | 'asset';
  readonly sourceKey?: string;
  readonly value?: string | number | boolean;
  readonly missingDefinition: boolean;
  readonly missingGroup: boolean;
  readonly missingAsset: boolean;
}

export interface LabelEnrichmentProjection {
  /** Labels have no canonical entity ID, so this ID is stable for the array slot. */
  readonly id: string;
  readonly value: string;
  readonly index: number;
}

export interface TodoEnrichmentProjection {
  readonly id: TodoId;
  readonly completed: boolean;
  readonly completedAt?: ISODateTime;
}

export interface ChildTodoProgressProjection {
  /** Derived UI identity; this is never persisted. */
  readonly id: string;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly progress: number;
}

export interface TaskAssigneeProjection {
  readonly id: ActorId;
  readonly displayName: string;
  readonly missingActor: boolean;
}

export interface TaskEnrichmentProjection {
  readonly id: TaskId;
  readonly status: TaskStatus;
  /** A display-safe 0..1 value. Canonical invalid values are not rewritten. */
  readonly progress: number;
  readonly invalidProgress: boolean;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly startDate?: string;
  readonly dueDate?: string;
  readonly durationMinutes?: number;
  readonly milestone: boolean;
  readonly assignees: readonly TaskAssigneeProjection[];
  readonly displayFields: readonly TaskDisplayField[];
}

export interface TopicEnrichmentProjection {
  readonly topicId: TopicId;
  readonly markers: readonly MarkerEnrichmentProjection[];
  readonly labels: readonly LabelEnrichmentProjection[];
  readonly notes: readonly NoteEnrichmentProjection[];
  readonly links: readonly LinkEnrichmentProjection[];
  readonly images: readonly ImageEnrichmentProjection[];
  readonly attachments: readonly AttachmentEnrichmentProjection[];
  readonly todos: readonly TodoEnrichmentProjection[];
  readonly childTodoProgress?: ChildTodoProgressProjection;
  readonly tasks: readonly TaskEnrichmentProjection[];
  readonly badges: readonly TopicBadgeProjection[];
}

export type EnrichmentProjectionDiagnosticCode =
  | 'missing-sheet'
  | 'orphan-entity'
  | 'missing-asset'
  | 'missing-marker-definition'
  | 'missing-marker-group'
  | 'missing-link-target'
  | 'missing-actor'
  | 'unsafe-image-source';

export interface EnrichmentProjectionDiagnostic {
  readonly code: EnrichmentProjectionDiagnosticCode;
  readonly entityKind: string;
  readonly entityId: string;
  readonly topicId?: TopicId;
}

export interface TopicEnrichmentsProjection {
  readonly sheetId: SheetId;
  readonly topicIds: readonly TopicId[];
  readonly byTopicId: Readonly<Record<TopicId, TopicEnrichmentProjection>>;
  readonly diagnostics: readonly EnrichmentProjectionDiagnostic[];
}

export interface BuildTopicEnrichmentsProjectionInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  /** Session-only resolver for validated XMind package resources. */
  readonly resolveEmbeddedImageUrl?: EmbeddedImageUrlResolver;
}

export type EmbeddedImageUrlResolver = (asset: Readonly<Asset>) => string | undefined;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareOrderedEntity = (
  left: { readonly orderKey: string; readonly id: string },
  right: { readonly orderKey: string; readonly id: string },
): number => compareText(left.orderKey, right.orderKey) || compareText(left.id, right.id);

const compareEntityId = (
  left: { readonly id: string },
  right: { readonly id: string },
): number => compareText(left.id, right.id);

const compactText = (value: string, maximum = 48): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, Math.max(0, maximum - 1))}…`
    : normalized;
};

const compactBadgeText = (value: string, maximum = 12): string => {
  const normalized = compactText(value, maximum);
  return normalized || '未命名';
};

const asPercentage = (progress: number): number => Math.round(progress * 100);

const clampProgress = (progress: number): number => {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
};

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const copyValidSize = (size: Size | undefined): Size | undefined =>
  size && finitePositive(size.width) && finitePositive(size.height)
    ? { width: size.width, height: size.height }
    : undefined;

/** Resolve the exact renderer box without rewriting the canonical explicit/intrinsic size. */
export const resolveTopicImageDisplaySize = (
  explicitSize: Size | undefined,
  intrinsicSize: Size | undefined,
): { readonly size: Size; readonly source: ImageDisplaySizeSource } => {
  const explicit = copyValidSize(explicitSize);
  const intrinsic = copyValidSize(intrinsicSize);
  const source: ImageDisplaySizeSource = explicit
    ? 'explicit'
    : intrinsic
      ? 'intrinsic'
      : 'fallback';
  const candidate = explicit ?? intrinsic ?? {
    width: TOPIC_IMAGE_DISPLAY_LIMITS.fallbackWidth,
    height: TOPIC_IMAGE_DISPLAY_LIMITS.fallbackHeight,
  };
  const minimumScale = Math.max(
    TOPIC_IMAGE_DISPLAY_LIMITS.minimumWidth / candidate.width,
    TOPIC_IMAGE_DISPLAY_LIMITS.minimumHeight / candidate.height,
  );
  const maximumScale = Math.min(
    TOPIC_IMAGE_DISPLAY_LIMITS.maximumWidth / candidate.width,
    TOPIC_IMAGE_DISPLAY_LIMITS.maximumHeight / candidate.height,
  );
  // Keep the canonical aspect ratio. If an extreme panorama cannot satisfy
  // both minimum and maximum edges, cap it to the safe maximum and keep the
  // shorter edge visible at one device-independent pixel.
  const scale = minimumScale <= maximumScale
    ? Math.min(maximumScale, Math.max(minimumScale, 1))
    : maximumScale;
  return {
    source,
    size: {
      width: Math.max(1, Math.round(candidate.width * scale)),
      height: Math.max(1, Math.round(candidate.height * scale)),
    },
  };
};

const SENSITIVE_REMOTE_IMAGE_QUERY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'key-pair-id',
  'sig',
  'signature',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-signature',
]);

const RENDERABLE_RASTER_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const imageRendererSource = (
  asset: MindMapDocumentV1['assets'][AssetId] | undefined,
  resolveEmbeddedImageUrl?: EmbeddedImageUrlResolver,
): ImageRendererSource => {
  if (!asset) return { status: 'unavailable', reason: 'missing-asset' };
  const mimeType = typeof asset.mimeType === 'string'
    ? asset.mimeType.toLocaleLowerCase('en-US')
    : '';
  if (!RENDERABLE_RASTER_MIME_TYPES.has(mimeType)) {
    return { status: 'unavailable', reason: 'unsupported-mime-type' };
  }
  if (asset.source.kind === 'embedded') {
    const resolved = resolveEmbeddedImageUrl?.(asset);
    if (resolved) {
      try {
        const parsed = new URL(resolved);
        if (parsed.protocol === 'blob:') return { status: 'ready', url: parsed.href };
      } catch {
        // Only a trusted, well-formed session Blob URL may activate package bytes.
      }
    }
    return { status: 'unavailable', reason: 'embedded-source' };
  }
  if (asset.source.kind === 'managed') {
    try {
      if (managedMindMapImageMimeType(asset.source.objectKey) !== mimeType) {
        return { status: 'unavailable', reason: 'managed-source' };
      }
      return { status: 'ready', url: mindMapImageAssetUrl(asset.source.objectKey) };
    } catch {
      return { status: 'unavailable', reason: 'managed-source' };
    }
  }

  try {
    const parsed = new URL(asset.source.url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username.length > 0
      || parsed.password.length > 0
      || [...parsed.searchParams.keys()].some((key) =>
        SENSITIVE_REMOTE_IMAGE_QUERY_KEYS.has(key.toLocaleLowerCase('en-US')))) {
      return { status: 'unavailable', reason: 'unsafe-remote-url' };
    }
    return { status: 'ready', url: parsed.href };
  } catch {
    return { status: 'unavailable', reason: 'unsafe-remote-url' };
  }
};

const taskStatusLabel: Readonly<Record<TaskStatus, string>> = {
  'not-started': '未开始',
  'in-progress': '进行中',
  blocked: '已阻塞',
  done: '已完成',
  cancelled: '已取消',
};

const taskTone = (status: TaskStatus): TopicBadgeTone => {
  switch (status) {
    case 'done':
      return 'success';
    case 'in-progress':
      return 'info';
    case 'blocked':
      return 'danger';
    case 'cancelled':
      return 'muted';
    case 'not-started':
      return 'neutral';
  }
};

const linkKindLabel: Readonly<Record<LinkEnrichmentProjection['kind'], string>> = {
  web: '网页链接',
  email: '邮件链接',
  file: '文件链接',
  folder: '文件夹链接',
  sheet: '画布链接',
  topic: '主题链接',
  'document-page': '文档页面链接',
};

const emptyTopicProjection = (topicId: TopicId): TopicEnrichmentProjection => ({
  topicId,
  markers: [],
  labels: [],
  notes: [],
  links: [],
  images: [],
  attachments: [],
  todos: [],
  tasks: [],
  badges: [],
});

/**
 * Projects canonical topic enrichments into immutable, renderer-friendly values.
 * It deliberately tolerates dangling references so one damaged resource cannot
 * prevent the rest of a sheet from rendering.
 */
export const buildTopicEnrichmentsProjection = ({
  document,
  sheetId,
  resolveEmbeddedImageUrl,
}: BuildTopicEnrichmentsProjectionInput): TopicEnrichmentsProjection => {
  const sheet = document.sheets[sheetId];
  if (!sheet) {
    return {
      sheetId,
      topicIds: [],
      byTopicId: {} as Record<TopicId, TopicEnrichmentProjection>,
      diagnostics: [{
        code: 'missing-sheet',
        entityKind: 'sheet',
        entityId: sheetId,
      }],
    };
  }

  const diagnostics: EnrichmentProjectionDiagnostic[] = [];
  const topicIds = (Object.keys(sheet.topics) as TopicId[]).sort(compareText);
  const mutable = new Map<TopicId, {
    markers: MarkerEnrichmentProjection[];
    labels: LabelEnrichmentProjection[];
    notes: NoteEnrichmentProjection[];
    links: LinkEnrichmentProjection[];
    images: ImageEnrichmentProjection[];
    attachments: AttachmentEnrichmentProjection[];
    todos: TodoEnrichmentProjection[];
    tasks: TaskEnrichmentProjection[];
  }>();

  for (const topicId of topicIds) {
    const topic = sheet.topics[topicId];
    mutable.set(topicId, {
      markers: [],
      labels: (topic.labels ?? []).map((value, index) => ({
        id: `label:${topicId}:${index}`,
        value,
        index,
      })),
      notes: [],
      links: [],
      images: [],
      attachments: [],
      todos: [],
      tasks: [],
    });
  }

  const topicBucket = (
    entityKind: string,
    entityId: string,
    topicId: TopicId,
  ) => {
    const bucket = mutable.get(topicId);
    if (!bucket) {
      diagnostics.push({ code: 'orphan-entity', entityKind, entityId, topicId });
    }
    return bucket;
  };

  for (const note of Object.values(sheet.notes).sort(compareEntityId)) {
    const bucket = topicBucket('note', note.id, note.topicId);
    if (!bucket) continue;
    const text = compactText(richTextToPlainText(note.content));
    bucket.notes.push({ id: note.id, preview: text, hasContent: text.length > 0 });
  }

  for (const link of Object.values(sheet.links).sort(compareOrderedEntity)) {
    const bucket = topicBucket('link', link.id, link.topicId);
    if (!bucket) continue;

    let targetLabel = linkKindLabel[link.kind];
    let unresolvedTarget = false;
    if (link.kind === 'sheet') {
      const targetSheet = document.sheets[link.targetSheetId];
      unresolvedTarget = !targetSheet;
      targetLabel = targetSheet?.title.trim() || (targetSheet ? '未命名画布' : '缺失画布');
    } else if (link.kind === 'topic') {
      const targetSheet = document.sheets[link.targetSheetId];
      const targetTopic = targetSheet?.topics[link.targetTopicId];
      unresolvedTarget = !targetSheet || !targetTopic;
      targetLabel = targetTopic
        ? compactText(richTextToPlainText(targetTopic.title), 48) || '未命名主题'
        : '缺失主题';
    }

    if (unresolvedTarget) {
      diagnostics.push({
        code: 'missing-link-target',
        entityKind: 'link',
        entityId: link.id,
        topicId: link.topicId,
      });
    }

    bucket.links.push({
      id: link.id,
      kind: link.kind,
      label: link.title?.trim() || targetLabel,
      status: link.status,
      unresolvedTarget,
    });
  }

  for (const attachment of Object.values(sheet.attachments).sort(compareOrderedEntity)) {
    const bucket = topicBucket('attachment', attachment.id, attachment.topicId);
    if (!bucket) continue;
    const asset = document.assets[attachment.assetId];
    if (!asset) {
      diagnostics.push({
        code: 'missing-asset',
        entityKind: 'attachment',
        entityId: attachment.id,
        topicId: attachment.topicId,
      });
    }
    bucket.attachments.push({
      id: attachment.id,
      assetId: attachment.assetId,
      fileName: asset?.fileName || '缺失附件资源',
      mimeType: asset?.mimeType,
      byteSize: asset?.byteSize,
      missingAsset: !asset,
    });
  }

  for (const image of Object.values(sheet.images).sort(compareOrderedEntity)) {
    const bucket = topicBucket('image', image.id, image.topicId);
    if (!bucket) continue;
    const asset = document.assets[image.assetId];
    if (!asset) {
      diagnostics.push({
        code: 'missing-asset',
        entityKind: 'image',
        entityId: image.id,
        topicId: image.topicId,
      });
    }
    const rendererSource = imageRendererSource(asset, resolveEmbeddedImageUrl);
    if (rendererSource.status === 'unavailable'
      && rendererSource.reason === 'unsafe-remote-url') {
      diagnostics.push({
        code: 'unsafe-image-source',
        entityKind: 'image',
        entityId: image.id,
        topicId: image.topicId,
      });
    }
    const resolvedSize = resolveTopicImageDisplaySize(image.size, asset?.intrinsicSize);
    bucket.images.push({
      id: image.id,
      assetId: image.assetId,
      fileName: asset?.fileName || '缺失图片资源',
      mimeType: asset?.mimeType,
      byteSize: asset?.byteSize,
      missingAsset: !asset,
      role: image.role,
      placement: {
        side: image.placement.side,
        align: image.placement.align,
        offset: { ...image.placement.offset },
      },
      ...(image.size ? { size: { ...image.size } } : {}),
      ...(asset?.intrinsicSize ? { intrinsicSize: { ...asset.intrinsicSize } } : {}),
      displaySize: resolvedSize.size,
      displaySizeSource: resolvedSize.source,
      ...(image.crop ? { crop: { ...image.crop } } : {}),
      alt: image.alt,
      rendererSource,
    });
  }

  for (const instance of Object.values(sheet.markerInstances).sort(compareOrderedEntity)) {
    const bucket = topicBucket('marker', instance.id, instance.topicId);
    if (!bucket) continue;
    const definition = document.markerDefinitions[instance.markerDefinitionId];
    const group = definition ? document.markerGroups[definition.groupId] : undefined;
    const missingAsset = definition?.source.kind === 'asset'
      ? !document.assets[definition.source.assetId]
      : false;
    if (!definition) {
      diagnostics.push({
        code: 'missing-marker-definition',
        entityKind: 'marker',
        entityId: instance.id,
        topicId: instance.topicId,
      });
    } else if (!group) {
      diagnostics.push({
        code: 'missing-marker-group',
        entityKind: 'marker',
        entityId: instance.id,
        topicId: instance.topicId,
      });
    }
    if (missingAsset) {
      diagnostics.push({
        code: 'missing-asset',
        entityKind: 'marker',
        entityId: instance.id,
        topicId: instance.topicId,
      });
    }
    bucket.markers.push({
      id: instance.id,
      label: definition?.name || '缺失标记',
      groupName: group?.name || (definition ? '缺失标记分组' : '未知标记分组'),
      sourceKind: definition?.source.kind,
      sourceKey: definition?.source.kind === 'builtin' ? definition.source.key : undefined,
      value: instance.value ?? definition?.semanticValue,
      missingDefinition: !definition,
      missingGroup: Boolean(definition && !group),
      missingAsset,
    });
  }

  for (const todo of Object.values(sheet.todos).sort(compareEntityId)) {
    const bucket = topicBucket('todo', todo.id, todo.topicId);
    if (!bucket) continue;
    bucket.todos.push({
      id: todo.id,
      completed: todo.completed,
      completedAt: todo.completedAt,
    });
  }

  for (const task of Object.values(sheet.tasks).sort(compareEntityId)) {
    const bucket = topicBucket('task', task.id, task.topicId);
    if (!bucket) continue;
    const invalidProgress = !Number.isFinite(task.progress)
      || task.progress < 0
      || task.progress > 1;
    const assignees = (task.assigneeIds ?? []).map((actorId) => {
      const actor = document.actors[actorId];
      if (!actor) {
        diagnostics.push({
          code: 'missing-actor',
          entityKind: 'task',
          entityId: task.id,
          topicId: task.topicId,
        });
      }
      return {
        id: actorId,
        displayName: actor?.displayName.trim() || 'Unknown',
        missingActor: !actor,
      };
    });
    bucket.tasks.push({
      id: task.id,
      status: task.status,
      progress: clampProgress(task.progress),
      invalidProgress,
      priority: task.priority,
      startDate: task.startDate,
      dueDate: task.dueDate,
      durationMinutes: task.durationMinutes,
      milestone: task.milestone ?? false,
      assignees,
      displayFields: [...(task.displayFields ?? [])],
    });
  }

  const directChildren = new Map<TopicId, TopicId[]>();
  for (const edge of Object.values(sheet.treeEdges).sort(compareOrderedEntity)) {
    if (!sheet.topics[edge.parentTopicId] || !sheet.topics[edge.childTopicId]) continue;
    const children = directChildren.get(edge.parentTopicId) ?? [];
    if (!children.includes(edge.childTopicId)) children.push(edge.childTopicId);
    directChildren.set(edge.parentTopicId, children);
  }

  const byTopicId = {} as Record<TopicId, TopicEnrichmentProjection>;
  for (const topicId of topicIds) {
    const bucket = mutable.get(topicId);
    if (!bucket) {
      byTopicId[topicId] = emptyTopicProjection(topicId);
      continue;
    }

    const childTodos = (directChildren.get(topicId) ?? [])
      .map((childId) => mutable.get(childId)?.todos[0])
      .filter((todo): todo is TodoEnrichmentProjection => todo !== undefined);
    const childTodoProgress = childTodos.length > 0 ? {
      id: `todo-progress:${topicId}`,
      completedCount: childTodos.filter((todo) => todo.completed).length,
      totalCount: childTodos.length,
      progress: childTodos.filter((todo) => todo.completed).length / childTodos.length,
    } satisfies ChildTodoProgressProjection : undefined;

    const badges: TopicBadgeProjection[] = [];
    for (const marker of bucket.markers) {
      const missingReference = marker.missingDefinition || marker.missingGroup || marker.missingAsset;
      const valueSuffix = marker.value === undefined ? '' : `，值：${String(marker.value)}`;
      badges.push({
        kind: 'marker',
        id: marker.id,
        topicId,
        label: marker.label,
        title: `标记：${marker.label}（${marker.groupName}）${valueSuffix}${missingReference ? '，引用缺失' : ''}`,
        displayText: compactBadgeText(marker.label),
        tone: missingReference ? 'warning' : 'info',
        missingReference,
        markerSourceKind: marker.sourceKind,
        markerSourceKey: marker.sourceKey,
      });
    }
    for (const label of bucket.labels) {
      const normalized = label.value.trim();
      badges.push({
        kind: 'label',
        id: label.id,
        topicId,
        label: normalized || '空标签',
        title: `标签：${normalized || '空标签'}`,
        displayText: `#${compactBadgeText(normalized || '空标签', 14)}`,
        tone: 'neutral',
      });
    }
    for (const note of bucket.notes) {
      badges.push({
        kind: 'note',
        id: note.id,
        topicId,
        label: note.preview || '空笔记',
        title: `笔记：${note.preview || '空笔记'}`,
        tone: note.hasContent ? 'neutral' : 'muted',
      });
    }
    for (const link of bucket.links) {
      const broken = link.status === 'broken' || link.unresolvedTarget;
      badges.push({
        kind: 'link',
        id: link.id,
        topicId,
        label: link.label,
        title: `链接：${link.label}${broken ? '（不可用）' : ''}`,
        tone: broken ? 'danger' : 'info',
        missingReference: link.unresolvedTarget,
      });
    }
    for (const image of bucket.images) {
      const label = image.alt?.trim() || image.fileName;
      badges.push({
        kind: 'image',
        id: image.id,
        topicId,
        label,
        title: `${image.role === 'sticker' ? '贴纸' : '图片'}：${label}${image.missingAsset ? '（资源缺失）' : ''}`,
        tone: image.missingAsset ? 'warning' : 'neutral',
        missingReference: image.missingAsset,
      });
    }
    for (const attachment of bucket.attachments) {
      badges.push({
        kind: 'attachment',
        id: attachment.id,
        topicId,
        label: attachment.fileName,
        title: `附件：${attachment.fileName}${attachment.missingAsset ? '（资源缺失）' : ''}`,
        displayText: compactBadgeText(attachment.fileName),
        tone: attachment.missingAsset ? 'warning' : 'neutral',
        missingReference: attachment.missingAsset,
      });
    }
    for (const todo of bucket.todos) {
      badges.push({
        kind: 'todo',
        id: todo.id,
        topicId,
        label: todo.completed ? '已完成' : '未完成',
        title: `待办：${todo.completed ? '已完成' : '未完成'}`,
        tone: todo.completed ? 'success' : 'neutral',
        progress: todo.completed ? 1 : 0,
      });
    }
    if (childTodoProgress) {
      const percent = asPercentage(childTodoProgress.progress);
      badges.push({
        kind: 'todo-progress',
        id: childTodoProgress.id,
        topicId,
        label: `${percent}%`,
        title: `子级待办进度：${childTodoProgress.completedCount}/${childTodoProgress.totalCount}（${percent}%）`,
        displayText: `${percent}%`,
        tone: childTodoProgress.progress === 1
          ? 'success'
          : childTodoProgress.progress > 0
            ? 'info'
            : 'neutral',
        progress: childTodoProgress.progress,
      });
    }
    for (const task of bucket.tasks) {
      const percent = asPercentage(task.progress);
      badges.push({
        kind: 'task',
        id: task.id,
        topicId,
        label: `${taskStatusLabel[task.status]} ${percent}%`,
        title: `任务：${taskStatusLabel[task.status]}，进度 ${percent}%${task.priority ? `，优先级 ${task.priority}` : ''}${task.invalidProgress ? '（原始进度无效，已安全限制）' : ''}`,
        displayText: `${percent}%`,
        tone: task.invalidProgress ? 'warning' : taskTone(task.status),
        progress: task.progress,
      });
    }

    byTopicId[topicId] = {
      topicId,
      markers: bucket.markers,
      labels: bucket.labels,
      notes: bucket.notes,
      links: bucket.links,
      images: bucket.images,
      attachments: bucket.attachments,
      todos: bucket.todos,
      childTodoProgress,
      tasks: bucket.tasks,
      badges,
    };
  }

  return { sheetId, topicIds, byTopicId, diagnostics };
};
