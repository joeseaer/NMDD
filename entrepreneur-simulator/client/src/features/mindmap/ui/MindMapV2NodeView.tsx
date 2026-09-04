import {
  memo,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileInput,
  Flag,
  Focus,
  ImagePlus,
  Link2,
  ListTodo,
  Maximize2,
  Minimize2,
  NotebookPen,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Tags,
  Table2,
  Trash2,
  Undo2,
} from 'lucide-react';
import ReactFlow, {
  applyNodeChanges,
  Background,
  Handle,
  NodeToolbar,
  Position,
  ReactFlowProvider,
  type Node as ReactFlowNode,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport as ReactFlowViewport,
} from 'reactflow';
import 'reactflow/dist/style.css';

import {
  decodeMindMapClipboard,
  encodeMindMapClipboard,
  MIND_MAP_CLIPBOARD_HTML_MIME,
  MIND_MAP_CLIPBOARD_MARKDOWN_MIME,
  MIND_MAP_CLIPBOARD_MIME,
  MIND_MAP_CLIPBOARD_TEXT_MIME,
  type EncodedMindMapClipboard,
} from '../clipboard';
import { createRichText } from '../domain/defaults';
import { semanticSiblingEdges } from '../domain/semanticScope';
import { getParentEdge } from '../domain/tree';
import type {
  BoundaryId,
  ElementRef,
  ImageId,
  MindMapDocumentV1,
  MindMapSheet,
  Point,
  Rect,
  ResolvedBranchLayoutSpec,
  ResolvedLayoutDirection,
  RichText,
  SheetId,
  SheetViewState,
  Size,
  StyleProperties,
  SummaryId,
  TopicId,
} from '../domain/types';
import {
  getCoreLayoutCapability,
  SUPPORTED_CORE_LAYOUT_STRUCTURES,
  type SupportedCoreLayoutStructure,
} from '../layout';
import { projectMindMapToRenderModel } from '../render/model';
import type { MindMapSearchFilterProjection } from '../view/types';
import { MindMapContentStore } from '../store/contentStore';
import {
  planCreateTopicCommand,
  planDeleteCurrentTopicCommand,
  planDeleteTopicSubtreeCommand,
  planInsertParentTopicCommand,
  planToggleTopicCollapseCommand,
  planUpdateTopicTitleCommand,
} from './commandPlanning';
import {
  buildMindMapFlowProjection,
  isOrdinaryStackedTopicImage,
  measureTopicStickerLayout,
  richTextToPlainText,
  TOPIC_NODE_TYPE,
  type MindMapTopicNodeData,
} from './projection';
import {
  findDirectionalTopic,
  normalizeTopLevelTopicSelection,
  selectElement,
  type NavigationDirection,
  type SelectionModifiers,
} from './selection';
import {
  detectTopicDropIntent,
  planReorderTopicCommand,
  planReparentTopicCommand,
  type TopicRect,
} from './dragPlanning';
import {
  planCutMindMapClipboard,
  planPasteClipboardFragmentCommand,
  planPasteTextTopicCommand,
} from './clipboardPlanning';
import {
  planCreateSheetCommand,
  planDeleteSheetCommand,
  planRenameSheetCommand,
  planUpdateSheetLayoutCommand,
} from './sheetPlanning';
import { SemanticElementPanel } from './SemanticElementPanel';
import { SemanticPropertiesPanel } from './SemanticPropertiesPanel';
import {
  SemanticOverlaySvg,
  type BoundaryRangeHandleSpec,
  type SummaryRangeHandleSpec,
} from './SemanticOverlaySvg';
import { FormatPanel } from './FormatPanel';
import type { FormatSelectionEntry } from './formatSelection';
import {
  planResetStyleBindingsCommand,
  planUpdateStyleBindingsCommand,
  type StyleOverridePath,
} from './formatPlanning';
import {
  SearchOutlinerPanel,
  type SearchOutlinerPanelHandle,
} from './SearchOutlinerPanel';
import {
  planOutlinerMutationCommand,
  type OutlinerMutationIntent,
} from './outlinerEditing';
import {
  ImportExportPanel,
  type MindMapImportSource,
} from './ImportExportPanel';
import type { MindMapImportResult, XMindImportResult } from '../io';
import { planReplaceImportedDocumentCommand } from './importPlanning';
import {
  buildTopicEnrichmentsProjection,
  type TopicEnrichmentKind,
} from './enrichmentProjection';
import { TopicBadges } from './TopicBadges';
import {
  TOPIC_IMAGE_DRAG_MIME,
  TopicImages,
  type TopicImagesSide,
} from './TopicImages';
import {
  STICKER_CATALOG_DRAG_MIME,
  StickerCatalogPanel,
} from './StickerCatalogPanel';
import {
  isBuiltInStickerId,
  type BuiltInStickerId,
} from './stickerCatalog';
import { recordRecentlyUsedSticker } from '../catalog/stickerRecentStore';
import {
  planBuiltInStickerIngest,
  stickerIngestErrorMessage,
} from './stickerIngest';
import {
  TopicEnrichmentPanel,
  type TopicEnrichmentSection,
} from './TopicEnrichmentPanel';
import type { TopicEnrichmentCommand } from './enrichmentPlanning';
import { MarkerLegendPanel } from './MarkerLegendPanel';
import { MarkerLegendCanvas } from './MarkerLegendCanvas';
import {
  planMoveMarkerLegendCommand,
  type MarkerLegendCommand,
} from './markerPlanning';
import { MindMapContextMenu } from './MindMapContextMenu';
import { TopicRichTextDisplay, TopicRichTextEditor } from './TopicRichText';
import {
  CanvasNavigationControls,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  clampCanvasZoom,
  createReactFlowCanvasNavigationHandlers,
  type CanvasSafeArea,
} from './CanvasNavigationControls';
import {
  enterBranchFocus,
  exitBranchFocus,
  projectFocusedBranchContext,
  projectSheetViewStateForRender,
  type BranchFocusSession,
} from '../viewState';
import {
  createdElementRef,
  isDeletableSemanticElementRef,
  planCreateBoundaryCommand,
  planCreateCalloutCommand,
  planCreateRelationshipCommand,
  planCreateSummaryCommand,
  planDeleteSemanticElementCommand,
  planResizeBoundaryFrameCommand,
  planAdjustBoundaryRangeCommand,
  planAdjustSummaryRangeCommand,
  previewBoundaryCreation,
  previewSummaryCreation,
  type BoundaryRangeDirection,
  type BoundaryRangeEndpoint,
  type DeletableSemanticElementRef,
  type SemanticCreateKind,
} from './semanticPlanning';
import {
  isSemanticPropertiesElementRef,
  type SemanticPropertiesCommand,
} from './semanticPropertiesPlanning';
import {
  planDeleteImageCommand,
  planResetImageSizeCommand,
  planUpdateImageCommand,
} from './imagePlanning';
import {
  LOCAL_IMAGE_ACCEPT,
  localImageIngestErrorMessage,
  planLocalImageIngest,
} from './localImageIngest';
import { api } from '../../../services/api';
import { XMindResourceSession } from './xmindResourceSession';
import {
  materializeXMindEmbeddedResources,
  XMindResourceMaterializationError,
} from './xmindResourceMaterialization';

export type MindMapV2NodeViewProps = Pick<
  NodeViewProps,
  'node' | 'updateAttributes' | 'editor' | 'selected'
> & {
  /** Optional host override; Tiptap editor.isEditable remains authoritative. */
  readonly readOnly?: boolean;
};

const useEditorEditable = (editor: MindMapV2NodeViewProps['editor']): boolean => {
  const subscribe = useCallback((onStoreChange: () => void) => {
    // Tiptap's setEditable() emits `update`, while normal editor state changes
    // emit `transaction`. Subscribe to both so host mode changes reach NodeViews.
    editor.on('update', onStoreChange);
    editor.on('transaction', onStoreChange);
    return () => {
      editor.off('update', onStoreChange);
      editor.off('transaction', onStoreChange);
    };
  }, [editor]);
  const getSnapshot = useCallback(() => editor.isEditable, [editor]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

interface SheetLocalView {
  readonly selection: readonly ElementRef[];
  readonly viewport?: ReactFlowViewport;
  readonly focusedBranchRootId?: TopicId;
  readonly foldOverrides?: Readonly<Record<TopicId, boolean>>;
}

interface PendingMindMapImport {
  readonly result: MindMapImportResult;
  readonly source: MindMapImportSource;
  readonly resourceBytes?: XMindImportResult['resourceBytes'];
}

interface MindMapContextMenuState {
  readonly anchor: { readonly clientX: number; readonly clientY: number };
  readonly target: ElementRef | null;
}

interface TopicEnrichmentPanelState {
  readonly section: TopicEnrichmentSection;
  readonly focusLinkRequest: number;
}

type SheetLocalViews = Readonly<Record<string, SheetLocalView>>;
const EMPTY_SELECTION: readonly ElementRef[] = Object.freeze([]);

const STRUCTURE_LABELS: Readonly<Record<SupportedCoreLayoutStructure, string>> = {
  'core:mind-map': '思维导图',
  'core:logic-chart': '逻辑图',
  'core:org-chart': '组织结构图',
  'core:tree-chart': '树状图',
  'core:timeline': '时间轴',
  'core:fishbone': '鱼骨图',
  'core:matrix': '矩阵',
  'core:brace-map': '括号图',
  'core:tree-table': '树形表格',
  'core:grid': '网格',
};

const DIRECTION_LABELS: Readonly<Record<ResolvedLayoutDirection, string>> = {
  'left-to-right': '从左到右',
  'right-to-left': '从右到左',
  'top-to-bottom': '从上到下',
  'bottom-to-top': '从下到上',
  both: '双向',
  radial: '放射',
  clockwise: '顺时针',
  counterclockwise: '逆时针',
};

const VARIANT_LABELS: Readonly<Record<string, string>> = {
  balanced: '平衡',
  standard: '标准',
  horizontal: '水平',
  vertical: '垂直',
  'horizontal-off-axis': '水平离轴',
  compact: '紧凑',
  'l-shaped': 'L 型',
  dashed: '虚线',
};

interface TopicNodeActions {
  readonly readOnly: boolean;
  readonly selectedImageId?: ImageId;
  select(topicId: TopicId, modifiers?: SelectionModifiers): void;
  beginEdit(topicId: TopicId): void;
  commitTitle(topicId: TopicId, title: RichText): void;
  cancelEdit(): void;
  toggleCollapse(topicId: TopicId): void;
  activateEnrichment(topicId: TopicId, kind: TopicEnrichmentKind, id: string): void;
  selectImage(topicId: TopicId, imageId: ImageId): void;
  moveImage(imageId: ImageId, side: TopicImagesSide): void;
  resizeImage(imageId: ImageId, size: Size): void;
  resetImageSize(imageId: ImageId): void;
  deleteImage(imageId: ImageId): void;
  dropImage(topicId: TopicId, imageId: ImageId, side: TopicImagesSide): void;
  ingestDroppedImages(topicId: TopicId, files: readonly File[]): void;
  ingestSticker(topicId: TopicId, stickerId: BuiltInStickerId): void;
}

const TopicNodeActionsContext = createContext<TopicNodeActions | null>(null);

const useTopicNodeActions = (): TopicNodeActions => {
  const actions = useContext(TopicNodeActionsContext);
  if (!actions) throw new Error('MindMapV2 topic actions are unavailable.');
  return actions;
};

const TopicFlowNode = memo(({
  data,
  selected,
}: NodeProps<MindMapTopicNodeData>) => {
  const actions = useTopicNodeActions();
  const stickerLayout = measureTopicStickerLayout(data.localImages);
  const visibleBadges = data.badges?.filter((badge) => badge.kind !== 'image'
    || !data.localImages.some((image) =>
      image.id === badge.id && (
        isOrdinaryStackedTopicImage(image)
        || (image.role === 'sticker' && image.placement.side !== 'overlay')
      )));

  const visualStyle: CSSProperties = {
    backgroundColor: data.visualStyle.backgroundColor,
    borderColor: selected ? '#2563EB' : data.visualStyle.borderColor,
    borderRadius: data.visualStyle.borderRadius,
    borderWidth: selected
      ? Math.max(2, data.visualStyle.borderWidth)
      : data.visualStyle.borderWidth,
    color: data.visualStyle.color,
    fontFamily: data.visualStyle.fontFamily,
    fontSize: data.visualStyle.fontSize,
    fontStyle: data.visualStyle.fontStyle,
    fontWeight: data.visualStyle.fontWeight,
    opacity: data.visualStyle.opacity,
    textDecoration: data.visualStyle.textDecoration,
    boxShadow: selected
      ? '0 0 0 3px rgba(37, 99, 235, 0.18), 0 8px 24px rgba(15, 23, 42, 0.12)'
      : data.searchState === 'match'
        ? '0 0 0 3px rgba(245, 158, 11, 0.42), 0 8px 24px rgba(15, 23, 42, 0.12)'
        : '0 6px 18px rgba(15, 23, 42, 0.10)',
  };

  return (
    <div
      className="relative grid h-full w-full text-center"
      style={{
        gridTemplateColumns: `${stickerLayout.leftWidth}px minmax(0, 1fr) ${stickerLayout.rightWidth}px`,
        gridTemplateRows: `${stickerLayout.topHeight}px minmax(0, 1fr) ${stickerLayout.bottomHeight}px`,
      }}
      data-entity-id={data.entityId}
      data-topic-role={data.role}
      data-summary-owner-id={data.summaryOwnerId}
      data-search-state={data.searchState ?? 'normal'}
      role="treeitem"
      aria-level={data.depth + 1}
      aria-selected={selected}
      aria-expanded={data.childCount > 0 ? !data.collapsed : undefined}
      aria-label={`${data.label}${data.childCount > 0
        ? `，${data.childCount} 个子主题，${data.collapsed ? '已折叠' : '已展开'}`
        : ''}`}
      onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
        const types = Array.from(event.dataTransfer.types);
        const hasFiles = types.includes('Files');
        const hasTopicImage = types.includes(TOPIC_IMAGE_DRAG_MIME);
        const hasCatalogSticker = types.includes(STICKER_CATALOG_DRAG_MIME);
        if (!hasFiles && !hasTopicImage && !hasCatalogSticker) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = actions.readOnly
          ? 'none'
          : hasFiles || hasCatalogSticker ? 'copy' : 'move';
      }}
      onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
        const types = Array.from(event.dataTransfer.types);
        const hasFiles = types.includes('Files');
        const hasTopicImage = types.includes(TOPIC_IMAGE_DRAG_MIME);
        const hasCatalogSticker = types.includes(STICKER_CATALOG_DRAG_MIME);
        if (!hasFiles && !hasTopicImage && !hasCatalogSticker) return;
        event.preventDefault();
        event.stopPropagation();
        // Files always win, so an OS drop can never enter the internal move path.
        if (hasFiles) {
          actions.ingestDroppedImages(data.entityId, Array.from(event.dataTransfer.files));
          return;
        }
        if (hasCatalogSticker) {
          const stickerId = event.dataTransfer.getData(STICKER_CATALOG_DRAG_MIME).trim();
          if (isBuiltInStickerId(stickerId)) actions.ingestSticker(data.entityId, stickerId);
          return;
        }
        if (!hasTopicImage) return;
        const imageId = event.dataTransfer.getData(TOPIC_IMAGE_DRAG_MIME).trim();
        if (!imageId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const image = data.localImages.find((candidate) => candidate.id === imageId);
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const side: TopicImagesSide = image?.role === 'sticker'
          ? Math.abs(event.clientX - centerX) / Math.max(1, bounds.width)
              > Math.abs(event.clientY - centerY) / Math.max(1, bounds.height)
            ? event.clientX < centerX ? 'left' : 'right'
            : event.clientY < centerY ? 'top' : 'bottom'
          : event.clientY < centerY ? 'top' : 'bottom';
        actions.dropImage(
          data.entityId,
          imageId as ImageId,
          side,
        );
      }}
    >
      <TopicImages
        images={data.localImages}
        side="top"
        kind="sticker"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
        className="col-start-2 row-start-1"
      />
      <TopicImages
        images={data.localImages}
        side="left"
        kind="sticker"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
        className="col-start-1 row-start-2"
      />
      <div
        className="relative col-start-2 row-start-2 flex h-full w-full flex-col items-center justify-center gap-2 border px-4 py-2 text-center transition-shadow"
        style={visualStyle}
        data-testid={`mindmap-topic-card-${data.entityId}`}
      >
      {!actions.readOnly && data.role !== 'central' && (
        <span
          className="mindmap-topic-drag-handle absolute -left-2 top-1/2 h-7 w-3 -translate-y-1/2 cursor-grab rounded-full border border-slate-300 bg-white shadow-sm active:cursor-grabbing"
          title="拖动主题"
          aria-hidden="true"
        />
      )}
      <Handle
        type="target"
        position={data.targetPosition}
        isConnectable={false}
        className="!h-1 !w-1 !border-0 !bg-transparent"
      />
      <TopicImages
        images={data.localImages}
        side="top"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
      />
      {data.editing && !actions.readOnly ? (
        <NodeToolbar
          align="center"
          isVisible
          offset={12}
          position={Position.Bottom}
          data-testid="mindmap-topic-title-editor-popover"
        >
          <TopicRichTextEditor
            initialValue={data.title}
            ariaLabel="编辑主题标题"
            className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 text-left text-slate-900 shadow-2xl"
            onCommit={(title) => actions.commitTitle(data.entityId, title)}
            onCancel={actions.cancelEdit}
          />
        </NodeToolbar>
      ) : null}
      <div
        role="button"
        aria-label={data.label}
        className={`nodrag flex w-full min-w-0 flex-1 cursor-default items-center justify-center overflow-hidden whitespace-pre-wrap break-words bg-transparent ${
          visibleBadges && visibleBadges.length > 0 ? 'pb-4' : ''
        }`}
        onClick={(event) => {
          event.stopPropagation();
          actions.select(data.entityId, {
            toggle: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
          });
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!actions.readOnly) actions.beginEdit(data.entityId);
        }}
        title={data.label}
      >
        <TopicRichTextDisplay
          value={data.title}
          ariaLabel={`主题标题：${data.label}`}
        />
      </div>
      <TopicImages
        images={data.localImages}
        side="bottom"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
      />
      {!data.editing && visibleBadges && visibleBadges.length > 0 ? (
        <TopicBadges
          badges={visibleBadges}
          maxVisible={3}
          className="absolute inset-x-3 bottom-1 justify-center"
          canActivate={(kind) => kind === 'marker'
            || kind === 'label'
            || kind === 'note'
            || kind === 'link'
            || kind === 'todo'
            || kind === 'todo-progress'
            || kind === 'task'}
          onActivate={(kind, id) => actions.activateEnrichment(data.entityId, kind, id)}
        />
      ) : null}

      {data.childCount > 0 && (
        <button
          type="button"
          className="nodrag absolute -right-3 top-1/2 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white px-1 text-[10px] font-semibold text-slate-600 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            actions.toggleCollapse(data.entityId);
          }}
          disabled={actions.readOnly}
          aria-label={data.collapsed ? '展开主题' : '折叠主题'}
          title={data.collapsed ? '展开' : '折叠'}
        >
          {data.collapsed
            ? <ChevronRight size={13} aria-hidden="true" />
            : <ChevronDown size={13} aria-hidden="true" />}
          {data.collapsed && <span>{data.childCount}</span>}
        </button>
      )}
      <Handle
        type="source"
        position={data.sourcePosition}
        isConnectable={false}
        className="!h-1 !w-1 !border-0 !bg-transparent"
      />
      </div>
      <TopicImages
        images={data.localImages}
        side="right"
        kind="sticker"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
        className="col-start-3 row-start-2"
      />
      <TopicImages
        images={data.localImages}
        side="bottom"
        kind="sticker"
        selectedImageId={actions.selectedImageId}
        readOnly={actions.readOnly}
        onSelect={(imageId) => actions.selectImage(data.entityId, imageId)}
        onMove={actions.moveImage}
        onResizeCommit={actions.resizeImage}
        onResetSize={actions.resetImageSize}
        onDelete={actions.deleteImage}
        className="col-start-2 row-start-3"
      />
    </div>
  );
});

TopicFlowNode.displayName = 'MindMapV2TopicNode';

const NODE_TYPES = { [TOPIC_NODE_TYPE]: TopicFlowNode };

const orderedSheetIds = (document: MindMapDocumentV1 | null): SheetId[] =>
  document
    ? Object.values(document.sheets)
        .sort((left, right) =>
          left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1
            : left.id < right.id ? -1 : 1)
        .map((sheet) => sheet.id)
    : [];

const selectionForSheet = (
  views: SheetLocalViews,
  sheetId: SheetId | null,
): readonly ElementRef[] => sheetId
  ? views[sheetId]?.selection ?? EMPTY_SELECTION
  : EMPTY_SELECTION;

const isTopicSelection = (
  selection: ElementRef | null,
): selection is Extract<ElementRef, { kind: 'topic' }> => selection?.kind === 'topic';

const primarySelection = (selection: readonly ElementRef[]): ElementRef | null =>
  selection[selection.length - 1] ?? null;

const elementExistsInSheet = (
  sheet: MindMapSheet | undefined,
  reference: ElementRef,
): boolean => {
  if (!sheet) return false;
  if (reference.kind === 'topic') return Boolean(sheet.topics[reference.id]);
  if (reference.kind === 'relationship') return Boolean(sheet.relationships[reference.id]);
  if (reference.kind === 'boundary') return Boolean(sheet.boundaries[reference.id]);
  if (reference.kind === 'summary') return Boolean(sheet.summaries[reference.id]);
  if (reference.kind === 'callout') return Boolean(sheet.callouts[reference.id]);
  return Boolean(sheet.zones[reference.id]);
};

const formatEntryForReference = (
  sheet: MindMapSheet,
  reference: ElementRef,
): FormatSelectionEntry | undefined => {
  if (reference.kind === 'topic') {
    const entity = sheet.topics[reference.id];
    return entity ? { target: { scope: 'topic', id: reference.id }, binding: entity.style } : undefined;
  }
  if (reference.kind === 'relationship') {
    const entity = sheet.relationships[reference.id];
    return entity
      ? { target: { scope: 'relationship', id: reference.id }, binding: entity.style }
      : undefined;
  }
  if (reference.kind === 'boundary') {
    const entity = sheet.boundaries[reference.id];
    return entity
      ? { target: { scope: 'boundary', id: reference.id }, binding: entity.style }
      : undefined;
  }
  if (reference.kind === 'summary') {
    const entity = sheet.summaries[reference.id];
    return entity
      ? { target: { scope: 'summary', id: reference.id }, binding: entity.style }
      : undefined;
  }
  if (reference.kind === 'callout') {
    const entity = sheet.callouts[reference.id];
    return entity
      ? { target: { scope: 'callout', id: reference.id }, binding: entity.style }
      : undefined;
  }
  const entity = sheet.zones[reference.id];
  return entity
    ? { target: { scope: 'zone', id: reference.id }, binding: entity.style }
    : undefined;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '脑图操作失败。';

const isAbortError = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && 'name' in error
  && error.name === 'AbortError'
);

const CLIPBOARD_MIME_WRITE_ORDER = [
  MIND_MAP_CLIPBOARD_MIME,
  MIND_MAP_CLIPBOARD_HTML_MIME,
  MIND_MAP_CLIPBOARD_MARKDOWN_MIME,
  MIND_MAP_CLIPBOARD_TEXT_MIME,
] as const;

interface ClipboardWriteResult {
  readonly customWritten: boolean;
  readonly writtenCount: number;
}

const writeEncodedClipboard = (
  clipboardData: DataTransfer,
  encoded: EncodedMindMapClipboard,
): ClipboardWriteResult => {
  try {
    clipboardData.clearData();
  } catch {
    // Some hosts deny clearing but still allow one or more explicit formats.
  }
  let customWritten = false;
  let writtenCount = 0;
  for (const mime of CLIPBOARD_MIME_WRITE_ORDER) {
    const value = encoded.mimeData[mime];
    if (typeof value !== 'string') continue;
    try {
      clipboardData.setData(mime, value);
      writtenCount += 1;
      if (mime === MIND_MAP_CLIPBOARD_MIME) customWritten = true;
    } catch {
      // Keep trying readable fallbacks; cut is separately guarded by customWritten.
    }
  }
  return { customWritten, writtenCount };
};

const isNativeClipboardTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement
  && !target.closest('[data-mindmap-clipboard-sink]')
  && Boolean(target.closest('input, textarea, [contenteditable="true"]'));

const DiagnosticView = ({ store }: { store: MindMapContentStore }) => {
  const result = store.parseResult;
  if (result.ok) return null;
  return (
    <section
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      role="alert"
      data-testid="mindmap-v2-diagnostic"
    >
      <div className="font-semibold">脑图数据无法载入，已进入只读诊断模式</div>
      <div className="mt-1 text-xs text-amber-800">
        原因：{result.reason}。原始 payload 已完整保留，组件不会覆盖或修复写回。
      </div>
      {result.issues.length > 0 && (
        <ul className="mt-3 max-h-28 list-disc overflow-auto pl-5 text-xs">
          {result.issues.slice(0, 8).map((issue) => (
            <li key={`${issue.path}:${issue.code}:${issue.message}`}>
              <code>{issue.path}</code> · {issue.message}
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium">查看保留的原始 payload</summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px]">
          {result.preservedPayload}
        </pre>
      </details>
    </section>
  );
};

const EMBEDDED_PRESENTATION_HEIGHT_CLASS = 'h-[clamp(440px,52vh,560px)] min-h-[440px]';

const MindMapV2Canvas = ({
  node,
  updateAttributes,
  editor,
  selected: nodeViewSelected,
  readOnly: readOnlyOverride,
}: MindMapV2NodeViewProps) => {
  const rawAttribute = node.attrs.data as unknown;
  const editorEditable = useEditorEditable(editor);
  const readOnly = readOnlyOverride === true || !editorEditable;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;
  const [store] = useState(() => new MindMapContentStore(
    rawAttribute,
    (write) => updateAttributesRef.current({ data: write.data }),
    { readOnly, debounceMs: 200 },
  ));
  const [xmindResourceSession] = useState(() => new XMindResourceSession());
  const [xmindResourceRevision, refreshXMindResources] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  const loadedStoreRef = useRef(store);
  const loadedRawRef = useRef(rawAttribute);
  const importApplyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => store.subscribe(forceRender), [store]);
  useEffect(() => () => store.dispose({ flush: true }), [store]);
  useEffect(() => () => xmindResourceSession.dispose(), [xmindResourceSession]);
  useEffect(() => store.setReadOnly(readOnly), [readOnly, store]);
  useEffect(() => {
    if (loadedStoreRef.current !== store) {
      loadedStoreRef.current = store;
      loadedRawRef.current = rawAttribute;
      return;
    }
    if (Object.is(loadedRawRef.current, rawAttribute)) return;
    loadedRawRef.current = rawAttribute;
    const before = store.getSnapshot();
    store.replaceFromExternal(rawAttribute);
    // Recent self-emissions, including undo/redo, keep the same snapshot object.
    // A real host replacement invalidates package bytes owned by this NodeView.
    if (store.getSnapshot() !== before) {
      importApplyAbortRef.current?.abort();
      xmindResourceSession.clear();
      refreshXMindResources();
    }
  }, [rawAttribute, store, xmindResourceSession]);

  const document = store.getSnapshot();
  const sheetIds = useMemo(() => orderedSheetIds(document), [document]);
  const [activeSheetId, setActiveSheetId] = useState<SheetId | null>(
    () => sheetIds[0] ?? null,
  );
  const [sheetViews, setSheetViews] = useState<SheetLocalViews>({});
  const [editingTopicId, setEditingTopicId] = useState<TopicId | null>(null);
  const [editingSheetId, setEditingSheetId] = useState<SheetId | null>(null);
  const [sheetTitleDraft, setSheetTitleDraft] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingMindMapImport | null>(null);
  const [importApplyBusy, setImportApplyBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<MindMapContextMenuState | null>(null);
  const [formatPanelVersion, setFormatPanelVersion] = useState(0);
  const [formatPanelExpanded, setFormatPanelExpanded] = useState(false);
  const [topicEnrichmentPanel, setTopicEnrichmentPanel] = useState<TopicEnrichmentPanelState | null>(null);
  const [markerLegendPanelOpen, setMarkerLegendPanelOpen] = useState(false);
  const [stickerCatalogOpen, setStickerCatalogOpen] = useState(false);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [searchPanelCollapsed, setSearchPanelCollapsed] = useState(true);
  const [searchFilter, setSearchFilter] = useState<MindMapSearchFilterProjection>();
  const [liveZoom, setLiveZoom] = useState(1);
  const [liveViewport, setLiveViewport] = useState<ReactFlowViewport>({ x: 0, y: 0, zoom: 1 });
  const [status, setStatus] = useState<string | null>(null);
  const [selectedLocalImageId, setSelectedLocalImageId] = useState<ImageId>();
  const [localImageBusy, setLocalImageBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const flowViewportRef = useRef<HTMLDivElement>(null);
  const clipboardSinkRef = useRef<HTMLTextAreaElement>(null);
  const searchPanelRef = useRef<SearchOutlinerPanelHandle>(null);
  const localImageInputRef = useRef<HTMLInputElement>(null);
  const localImageTargetTopicRef = useRef<TopicId | null>(null);
  const fullScreenButtonRef = useRef<HTMLButtonElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const focusRestoreCleanupRef = useRef<(() => void) | null>(null);
  const branchFocusSessionsRef = useRef(new Map<SheetId, BranchFocusSession>());
  const localImageIngestingRef = useRef(false);
  const stickerIngestingRef = useRef(false);
  const stickerAbortRef = useRef<AbortController | null>(null);
  const pendingImportRef = useRef<PendingMindMapImport | null>(pendingImport);
  const readOnlyRef = useRef(readOnly);
  const activeSheetIdRef = useRef<SheetId | null>(activeSheetId);
  const currentSelectionRef = useRef<ElementRef | null>(null);
  readOnlyRef.current = readOnly;
  activeSheetIdRef.current = activeSheetId;
  pendingImportRef.current = pendingImport;

  useEffect(() => {
    if (!fullScreen || typeof globalThis.document === 'undefined') return;
    const body = globalThis.document.body;
    const previousOverflow = body.style.overflow;
    const previousOverscrollBehavior = body.style.overscrollBehavior;
    const previousFullscreenMarker = body.getAttribute('data-mindmap-fullscreen-open');
    const fullscreenLayer = containerRef.current?.closest(
      '[data-testid="mindmap-v2-fullscreen-layer"]',
    );
    const backgroundState = Array.from(body.children)
      .filter((element) => element !== fullscreenLayer)
      .map((element) => ({
        element,
        inert: element.getAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      }));
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.setAttribute('data-mindmap-fullscreen-open', 'true');
    backgroundState.forEach(({ element }) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setFullScreen(false);
    };
    globalThis.document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      globalThis.document.removeEventListener('keydown', closeOnEscape, true);
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscrollBehavior;
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previousFullscreenMarker === null) {
        body.removeAttribute('data-mindmap-fullscreen-open');
      } else {
        body.setAttribute('data-mindmap-fullscreen-open', previousFullscreenMarker);
      }
    };
  }, [fullScreen]);

  const previousFullScreenRef = useRef(fullScreen);
  useEffect(() => {
    if (previousFullScreenRef.current === fullScreen) return;
    previousFullScreenRef.current = fullScreen;
    const frame = requestAnimationFrame(() => {
      if (fullScreen) containerRef.current?.focus({ preventScroll: true });
      else fullScreenButtonRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [fullScreen]);

  useEffect(() => () => importApplyAbortRef.current?.abort(), []);
  useEffect(() => () => stickerAbortRef.current?.abort(), []);
  useEffect(() => {
    if (readOnly) {
      importApplyAbortRef.current?.abort();
      stickerAbortRef.current?.abort();
      setStickerCatalogOpen(false);
    }
  }, [readOnly]);

  useEffect(() => {
    if (activeSheetId && document?.sheets[activeSheetId]) return;
    setActiveSheetId(sheetIds[0] ?? null);
    setEditingTopicId(null);
  }, [activeSheetId, document, sheetIds]);

  useEffect(() => {
    if (editingSheetId && !document?.sheets[editingSheetId]) setEditingSheetId(null);
  }, [document, editingSheetId]);

  const currentSelections = selectionForSheet(sheetViews, activeSheetId);
  const currentSelection = primarySelection(currentSelections);
  currentSelectionRef.current = currentSelection;
  const activeSheet = activeSheetId && document
    ? document.sheets[activeSheetId]
    : undefined;

  useEffect(() => {
    if (!selectedLocalImageId) return;
    const image = activeSheet?.images[selectedLocalImageId];
    if (
      !image
      || currentSelection?.kind !== 'topic'
      || currentSelection.id !== image.topicId
    ) setSelectedLocalImageId(undefined);
  }, [activeSheet, currentSelection, selectedLocalImageId]);

  useEffect(() => {
    if (topicEnrichmentPanel && !isTopicSelection(currentSelection)) {
      setTopicEnrichmentPanel(null);
    }
  }, [currentSelection, topicEnrichmentPanel]);
  const activeLocalView = activeSheetId ? sheetViews[activeSheetId] : undefined;
  const effectiveSheetView = useMemo<SheetViewState>(() => ({
    viewport: { ...(activeLocalView?.viewport ?? { x: 0, y: 0, zoom: 1 }) },
    selection: [...currentSelections],
    ...(activeLocalView?.focusedBranchRootId
      ? { focusedBranchRootId: activeLocalView.focusedBranchRootId }
      : {}),
    ...(activeLocalView?.foldOverrides
      ? { foldOverrides: { ...activeLocalView.foldOverrides } }
      : {}),
  }), [activeLocalView, currentSelections]);
  const focusedBranchRootId = effectiveSheetView.focusedBranchRootId;
  const focusedBranchContext = useMemo(() =>
    activeSheet && focusedBranchRootId
      ? projectFocusedBranchContext(activeSheet, focusedBranchRootId)
      : null,
  [activeSheet, focusedBranchRootId]);
  const renderViewOptions = useMemo(() =>
    activeSheet
      ? projectSheetViewStateForRender(activeSheet, effectiveSheetView)
      : undefined,
  [activeSheet, effectiveSheetView]);

  useEffect(() => {
    if (
      activeSheetId
      && currentSelections.some((reference) => !elementExistsInSheet(activeSheet, reference))
    ) {
      setSheetViews((previous) => ({
        ...previous,
        [activeSheetId]: {
          ...(previous[activeSheetId] ?? { selection: [] }),
          selection: currentSelections.filter((reference) =>
            elementExistsInSheet(activeSheet, reference)),
        },
      }));
    }
    if (editingTopicId && !activeSheet?.topics[editingTopicId]) {
      setEditingTopicId(null);
    }
  }, [activeSheet, activeSheetId, currentSelections, editingTopicId]);

  useEffect(() => {
    if (
      !activeSheetId
      || !focusedBranchRootId
      || activeSheet?.topics[focusedBranchRootId]
    ) return;
    branchFocusSessionsRef.current.delete(activeSheetId);
    setSheetViews((previous) => {
      const current = previous[activeSheetId];
      if (!current?.focusedBranchRootId) return previous;
      const { focusedBranchRootId: _ignored, ...withoutFocus } = current;
      return { ...previous, [activeSheetId]: withoutFocus };
    });
  }, [activeSheet, activeSheetId, focusedBranchRootId]);

  const setSelections = useCallback((selection: readonly ElementRef[]) => {
    if (!activeSheetId) return;
    currentSelectionRef.current = primarySelection(selection);
    setSheetViews((previous) => ({
      ...previous,
      [activeSheetId]: {
        ...(previous[activeSheetId] ?? { selection: [] }),
        selection,
      },
    }));
  }, [activeSheetId]);

  const setSelection = useCallback((selection: ElementRef | null) => {
    setSelections(selection ? [selection] : []);
  }, [setSelections]);

  const renderModel = useMemo(() =>
    document && activeSheetId
      ? projectMindMapToRenderModel({
          document,
          activeSheetId,
          ...(renderViewOptions ?? {}),
        })
      : null,
  [activeSheetId, document, renderViewOptions]);
  const flowProjection = useMemo(() =>
    document && renderModel
      ? buildMindMapFlowProjection(document, renderModel, currentSelection, {
          resolveEmbeddedImageUrl: xmindResourceSession.resolveEmbeddedImageUrl,
        })
      : null,
  [currentSelection, document, renderModel, xmindResourceRevision, xmindResourceSession]);
  const topicEnrichments = useMemo(() =>
    document && activeSheetId
      ? buildTopicEnrichmentsProjection({
          document,
          sheetId: activeSheetId,
          resolveEmbeddedImageUrl: xmindResourceSession.resolveEmbeddedImageUrl,
        })
      : null,
  [activeSheetId, document, xmindResourceRevision, xmindResourceSession]);
  const semanticOverlayLabels = useMemo<Readonly<Record<string, string>>>(() =>
    Object.freeze(Object.fromEntries(
      (flowProjection?.overlays ?? []).map((item) => [item.entityId, item.label]),
    )),
  [flowProjection]);
  const boundaryRangeAdjustableIds = useMemo<ReadonlySet<string>>(() => new Set(
    Object.values(activeSheet?.boundaries ?? {})
      .filter((boundary) => boundary.scope.kind === 'sibling-range')
      .map((boundary) => boundary.id),
  ), [activeSheet]);
  const summaryRangeAdjustableIds = useMemo<ReadonlySet<string>>(() => new Set(
    Object.values(activeSheet?.summaries ?? {})
      .filter((summary) => summary.scope.kind === 'sibling-range')
      .map((summary) => summary.id),
  ), [activeSheet]);
  const boundaryRangeHandleSpecs = useMemo<Readonly<Record<string, BoundaryRangeHandleSpec>>>(() => {
    if (!activeSheet || !flowProjection) return {};
    const specs: Record<string, BoundaryRangeHandleSpec> = {};
    for (const boundary of Object.values(activeSheet.boundaries)) {
      if (boundary.scope.kind !== 'sibling-range') continue;
      const firstEdge = activeSheet.treeEdges[boundary.scope.firstEdgeId];
      const lastEdge = activeSheet.treeEdges[boundary.scope.lastEdgeId];
      if (!firstEdge || !lastEdge) continue;
      const siblings = semanticSiblingEdges(activeSheet, firstEdge);
      const firstIndex = siblings.findIndex((edge) => edge.id === firstEdge.id);
      const lastIndex = siblings.findIndex((edge) => edge.id === lastEdge.id);
      if (firstIndex < 0 || lastIndex < firstIndex) continue;
      const centers = siblings.map((edge) => {
        const rect = flowProjection.semanticGeometry.topicRects[edge.childTopicId];
        return rect ? {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          rect,
        } : undefined;
      });
      const visibleCenters = centers.filter((center): center is NonNullable<typeof center> =>
        center !== undefined);
      const xSpan = visibleCenters.length > 1
        ? Math.max(...visibleCenters.map((center) => center.x))
          - Math.min(...visibleCenters.map((center) => center.x))
        : 0;
      const ySpan = visibleCenters.length > 1
        ? Math.max(...visibleCenters.map((center) => center.y))
          - Math.min(...visibleCenters.map((center) => center.y))
        : 0;
      const verticalLayout = activeSheet.defaultBranchLayout.direction === 'left-to-right'
        || activeSheet.defaultBranchLayout.direction === 'right-to-left'
        || activeSheet.defaultBranchLayout.direction === 'both';
      const axis: BoundaryRangeHandleSpec['axis'] = xSpan === ySpan
        ? (verticalLayout ? 'vertical' : 'horizontal')
        : xSpan > ySpan ? 'horizontal' : 'vertical';
      const spacings = centers.slice(1).flatMap((center, index) => {
        const previous = centers[index];
        if (!center || !previous) return [];
        const distance = Math.abs(
          axis === 'horizontal' ? center.x - previous.x : center.y - previous.y,
        );
        return distance > 1 ? [distance] : [];
      }).sort((left, right) => left - right);
      const middle = Math.floor(spacings.length / 2);
      const medianSpacing = spacings.length === 0
        ? undefined
        : spacings.length % 2 === 1
          ? spacings[middle]
          : (spacings[middle - 1] + spacings[middle]) / 2;
      const sampleRect = visibleCenters[0]?.rect;
      const fallbackSpacing = axis === 'horizontal'
        ? (sampleRect?.width ?? 120) + 24
        : (sampleRect?.height ?? 40) + 24;
      specs[boundary.id] = {
        axis,
        firstIndex,
        lastIndex,
        siblingTargets: centers.flatMap((center, index) => center ? [{
          edgeId: siblings[index].id,
          index,
          center: axis === 'horizontal' ? center.x : center.y,
        }] : []),
        stepSpacing: medianSpacing ?? fallbackSpacing,
        start: {
          outwardSteps: firstIndex,
          inwardSteps: lastIndex - firstIndex,
        },
        end: {
          outwardSteps: siblings.length - 1 - lastIndex,
          inwardSteps: lastIndex - firstIndex,
        },
      };
    }
    return specs;
  }, [activeSheet, flowProjection]);
  const summaryRangeHandleSpecs = useMemo<Readonly<Record<string, SummaryRangeHandleSpec>>>(() => {
    if (!activeSheet || !flowProjection) return {};
    const specs: Record<string, SummaryRangeHandleSpec> = {};
    for (const summary of Object.values(activeSheet.summaries)) {
      if (summary.scope.kind !== 'sibling-range') continue;
      const firstEdge = activeSheet.treeEdges[summary.scope.firstEdgeId];
      const lastEdge = activeSheet.treeEdges[summary.scope.lastEdgeId];
      if (!firstEdge || !lastEdge) continue;
      const siblings = semanticSiblingEdges(activeSheet, firstEdge);
      const firstIndex = siblings.findIndex((edge) => edge.id === firstEdge.id);
      const lastIndex = siblings.findIndex((edge) => edge.id === lastEdge.id);
      if (firstIndex < 0 || lastIndex < firstIndex) continue;
      const orientation = flowProjection.semanticGeometry.summaries
        .find((item) => item.entityId === summary.id)?.orientation;
      const axis: SummaryRangeHandleSpec['axis'] = orientation === 'top' || orientation === 'bottom'
        ? 'horizontal'
        : 'vertical';
      const centers = siblings.map((edge) => {
        const rect = flowProjection.semanticGeometry.topicRects[edge.childTopicId];
        return rect ? {
          center: axis === 'horizontal'
            ? rect.x + rect.width / 2
            : rect.y + rect.height / 2,
          rect,
        } : undefined;
      });
      const spacings = centers.slice(1).flatMap((center, index) => {
        const previous = centers[index];
        if (!center || !previous) return [];
        const distance = Math.abs(center.center - previous.center);
        return distance > 1 ? [distance] : [];
      }).sort((left, right) => left - right);
      const middle = Math.floor(spacings.length / 2);
      const medianSpacing = spacings.length === 0
        ? undefined
        : spacings.length % 2 === 1
          ? spacings[middle]
          : (spacings[middle - 1] + spacings[middle]) / 2;
      const sampleRect = centers.find((center) => center !== undefined)?.rect;
      const fallbackSpacing = axis === 'horizontal'
        ? (sampleRect?.width ?? 120) + 24
        : (sampleRect?.height ?? 40) + 24;
      specs[summary.id] = {
        axis,
        firstIndex,
        lastIndex,
        siblingTargets: centers.flatMap((center, index) => center ? [{
          edgeId: siblings[index].id,
          index,
          center: center.center,
        }] : []),
        stepSpacing: medianSpacing ?? fallbackSpacing,
        start: {
          outwardSteps: firstIndex,
          inwardSteps: lastIndex - firstIndex,
        },
        end: {
          outwardSteps: siblings.length - 1 - lastIndex,
          inwardSteps: lastIndex - firstIndex,
        },
      };
    }
    return specs;
  }, [activeSheet, flowProjection]);
  const projectionBounds = useMemo(() => {
    if (!flowProjection) return undefined;
    const rectangles = [
      flowProjection.coreLayout.bounds,
      ...[
        ...flowProjection.semanticGeometry.zones,
        ...flowProjection.semanticGeometry.boundaries,
        ...flowProjection.semanticGeometry.summaries,
        ...flowProjection.semanticGeometry.callouts,
        ...flowProjection.semanticGeometry.relationships,
      ].flatMap((item) => item.visibility === 'visible' && item.bounds
        ? [item.bounds]
        : []),
    ];
    const minX = Math.min(...rectangles.map((bounds) => bounds.x));
    const minY = Math.min(...rectangles.map((bounds) => bounds.y));
    const maxX = Math.max(...rectangles.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...rectangles.map((bounds) => bounds.y + bounds.height));
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }, [flowProjection]);
  const workspaceChromeVisible = fullScreen;
  const hasRightWorkspacePanel = workspaceChromeVisible && (
    importExportOpen
    || markerLegendPanelOpen
    || stickerCatalogOpen
    || Boolean(topicEnrichmentPanel)
    || isSemanticPropertiesElementRef(currentSelection)
    || formatPanelExpanded
  );
  const canvasSafeArea = useMemo<CanvasSafeArea>(() => ({
    top: focusedBranchRootId ? 52 : 16,
    right: hasRightWorkspacePanel ? 340 : 28,
    bottom: workspaceChromeVisible ? 56 : 28,
    left: workspaceChromeVisible ? (searchPanelCollapsed ? 64 : 332) : 28,
  }), [focusedBranchRootId, hasRightWorkspacePanel, searchPanelCollapsed, workspaceChromeVisible]);
  const fitProjection = useCallback((duration = 220) => {
    const instance = flowInstanceRef.current;
    if (!instance) return;
    createReactFlowCanvasNavigationHandlers(instance, {
      safeArea: canvasSafeArea,
      duration,
      minZoom: MIN_CANVAS_ZOOM,
      maxZoom: MAX_CANVAS_ZOOM,
      getContentBounds: () => projectionBounds,
      getViewportSize: () => {
        const rect = flowViewportRef.current?.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0
          ? { width: rect.width, height: rect.height }
          : null;
      },
    }).onFitView();
  }, [canvasSafeArea, projectionBounds]);
  const fitProjectionRef = useRef(fitProjection);
  fitProjectionRef.current = fitProjection;
  const workspaceLayoutMountedRef = useRef(false);
  useEffect(() => {
    if (!workspaceLayoutMountedRef.current) {
      workspaceLayoutMountedRef.current = true;
      return;
    }
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        fitProjectionRef.current(0);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [fullScreen, hasRightWorkspacePanel, searchPanelCollapsed]);
  useEffect(() => {
    const viewport = flowViewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const initialRect = viewport.getBoundingClientRect();
    let previousSize = {
      width: initialRect.width,
      height: initialRect.height,
    };
    let firstFrame = 0;
    let secondFrame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextSize = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      const materiallyChanged = Math.abs(nextSize.width - previousSize.width) >= 2
        || Math.abs(nextSize.height - previousSize.height) >= 2;
      previousSize = nextSize;
      if (!materiallyChanged) return;
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => fitProjectionRef.current(0));
      });
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [activeSheetId, fullScreen]);
  const selectedTopicIdList = useMemo(() =>
    currentSelections
      .filter((reference): reference is Extract<ElementRef, { kind: 'topic' }> =>
        reference.kind === 'topic')
      .map((reference) => reference.id),
  [currentSelections]);
  const selectedTopicIds = useMemo(
    () => new Set(selectedTopicIdList),
    [selectedTopicIdList],
  );
  const boundaryCreationPreview = useMemo(() => activeSheetId && document
    ? previewBoundaryCreation(document, activeSheetId, selectedTopicIdList)
    : { eligible: false, groupCount: 0, reason: '当前 Sheet 不存在。' },
  [activeSheetId, document, selectedTopicIdList]);
  const summaryCreationPreview = useMemo(() => activeSheetId && document
    ? previewSummaryCreation(document, activeSheetId, selectedTopicIdList)
    : { eligible: false, groupCount: 0, reason: '当前 Sheet 不存在。' },
  [activeSheetId, document, selectedTopicIdList]);
  const activeSearchStates = useMemo(() => {
    const projection = activeSheetId && searchFilter?.active
      ? searchFilter.sheets[activeSheetId]
      : undefined;
    return {
      matched: new Set(projection?.matchedTopicIds ?? []),
      context: new Set(projection?.contextTopicIds ?? []),
      dimmed: new Set(projection?.dimmedTopicIds ?? []),
    };
  }, [activeSheetId, searchFilter]);
  const formatSelection = useMemo<readonly FormatSelectionEntry[]>(() =>
    activeSheet
      ? currentSelections.flatMap((reference) => {
          const entry = formatEntryForReference(activeSheet, reference);
          return entry ? [entry] : [];
        })
      : [],
  [activeSheet, currentSelections]);
  const flowNodes = useMemo<ReactFlowNode<MindMapTopicNodeData>[]>(() =>
    flowProjection?.nodes.map((flowNode): ReactFlowNode<MindMapTopicNodeData> => {
      const topicId = flowNode.id as TopicId;
      const searchState: NonNullable<MindMapTopicNodeData['searchState']> =
        activeSearchStates.matched.has(topicId)
          ? 'match'
          : activeSearchStates.context.has(topicId)
            ? 'context'
            : activeSearchStates.dimmed.has(topicId)
              ? 'dimmed'
              : 'normal';
      return {
        ...flowNode,
        draggable: !readOnly,
        dragHandle: '.mindmap-topic-drag-handle',
        selected: selectedTopicIds.has(topicId),
        data: {
          ...flowNode.data,
          editing: flowNode.id === editingTopicId,
          badges: topicEnrichments?.byTopicId[topicId]?.badges ?? [],
          searchState,
          visualStyle: {
            ...flowNode.data.visualStyle,
            opacity: searchState === 'dimmed'
              ? Math.min(flowNode.data.visualStyle.opacity, 0.25)
              : flowNode.data.visualStyle.opacity,
          },
        },
      };
    }) ?? [],
  [activeSearchStates, editingTopicId, flowProjection, readOnly, selectedTopicIds, topicEnrichments]);
  const [interactiveNodes, setInteractiveNodes] = useState<ReactFlowNode<MindMapTopicNodeData>[]>(
    flowNodes,
  );
  const draggingTopicRef = useRef<TopicId | null>(null);

  useEffect(() => {
    if (!draggingTopicRef.current) setInteractiveNodes(flowNodes);
  }, [flowNodes]);

  const focusCanvas = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const zoomCanvasTo = useCallback((zoom: number) => {
    const instance = flowInstanceRef.current;
    if (!instance) return;
    const nextZoom = clampCanvasZoom(zoom, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
    createReactFlowCanvasNavigationHandlers(instance, {
      minZoom: MIN_CANVAS_ZOOM,
      maxZoom: MAX_CANVAS_ZOOM,
    }).onZoomChange(nextZoom);
    setLiveZoom(nextZoom);
  }, []);

  const resetCanvasZoom = useCallback(() => zoomCanvasTo(1), [zoomCanvasTo]);

  const enterFocusedBranch = useCallback((topicId: TopicId) => {
    if (!activeSheetId || !activeSheet) return;
    const liveViewport = flowInstanceRef.current?.getViewport()
      ?? effectiveSheetView.viewport;
    const transition = enterBranchFocus(
      activeSheet,
      {
        ...effectiveSheetView,
        viewport: { ...liveViewport },
        selection: [...currentSelections],
      },
      topicId,
      branchFocusSessionsRef.current.get(activeSheetId),
    );
    if (!transition) return;
    branchFocusSessionsRef.current.set(activeSheetId, transition.session);
    setSheetViews((previous) => ({
      ...previous,
      [activeSheetId]: transition.sheetViewState,
    }));
    setEditingTopicId(null);
    setStatus(`仅显示分支：${richTextToPlainText(activeSheet.topics[topicId].title) || '未命名主题'}`);
    focusCanvas();
  }, [activeSheet, activeSheetId, currentSelections, effectiveSheetView, focusCanvas]);

  const focusSelectedBranch = useCallback(() => {
    if (!isTopicSelection(currentSelection)) return;
    enterFocusedBranch(currentSelection.id);
  }, [currentSelection, enterFocusedBranch]);

  const leaveFocusedBranch = useCallback(() => {
    if (!activeSheetId || !focusedBranchRootId) return;
    const session = branchFocusSessionsRef.current.get(activeSheetId);
    branchFocusSessionsRef.current.delete(activeSheetId);
    const current = activeLocalView ?? effectiveSheetView;
    const restored = session
      ? exitBranchFocus({
          viewport: { ...(current.viewport ?? effectiveSheetView.viewport) },
          selection: [...current.selection],
          ...(current.focusedBranchRootId
            ? { focusedBranchRootId: current.focusedBranchRootId }
            : {}),
          ...(current.foldOverrides
            ? { foldOverrides: { ...current.foldOverrides } }
            : {}),
        }, session)
      : (() => {
          const { focusedBranchRootId: _ignored, ...withoutFocus } = current;
          return {
            ...withoutFocus,
            viewport: { ...(withoutFocus.viewport ?? effectiveSheetView.viewport) },
            selection: [...withoutFocus.selection],
          };
        })();
    setSheetViews((previous) => ({
      ...previous,
      [activeSheetId]: restored,
    }));
    setLiveZoom(restored.viewport.zoom);
    setLiveViewport(restored.viewport);
    requestAnimationFrame(() => {
      const instance = flowInstanceRef.current;
      if (instance) void instance.setViewport(restored.viewport, { duration: 0 });
    });
    setStatus(null);
    focusCanvas();
  }, [
    activeLocalView,
    activeSheetId,
    effectiveSheetView,
    focusCanvas,
    focusedBranchRootId,
  ]);

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const instance = flowInstanceRef.current;
    const flowViewport = flowViewportRef.current;
    const target = event.target;
    const rect = flowViewport?.getBoundingClientRect();
    if (
      !instance
      || !flowViewport
      || !rect
      || !(target instanceof Node)
      || !flowViewport.contains(target)
      || (target instanceof Element && target.closest('.nowheel'))
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const current = instance.getViewport();
    const nextZoom = clampCanvasZoom(
      current.zoom * Math.exp(-event.deltaY * 0.002),
      MIN_CANVAS_ZOOM,
      MAX_CANVAS_ZOOM,
    );
    if (nextZoom === current.zoom) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const flowX = (pointerX - current.x) / current.zoom;
    const flowY = (pointerY - current.y) / current.zoom;
    const nextViewport = {
      x: pointerX - flowX * nextZoom,
      y: pointerY - flowY * nextZoom,
      zoom: nextZoom,
    };
    void instance.setViewport(nextViewport, { duration: 0 });
    setLiveZoom(nextZoom);
    setLiveViewport(nextViewport);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const listener = (event: WheelEvent): void => handleCanvasWheel(event);
    container.addEventListener('wheel', listener, { capture: true, passive: false });
    return () => container.removeEventListener('wheel', listener, true);
  }, [handleCanvasWheel]);

  useEffect(() => {
    const viewport = activeLocalView?.viewport ?? { x: 0, y: 0, zoom: 1 };
    setLiveZoom(viewport.zoom);
    setLiveViewport(viewport);
  }, [activeLocalView?.viewport, activeSheetId]);

  const previousFocusedBranchRef = useRef<TopicId | undefined>(undefined);
  useEffect(() => {
    const previous = previousFocusedBranchRef.current;
    previousFocusedBranchRef.current = focusedBranchRootId;
    if (!focusedBranchRootId || previous === focusedBranchRootId) return;
    const frame = requestAnimationFrame(() => fitProjection(0));
    return () => cancelAnimationFrame(frame);
  }, [fitProjection, focusedBranchRootId]);

  const restoreCanvasFocusAfterCommit = useCallback(() => {
    focusRestoreCleanupRef.current?.();
    let frame = 0;
    let timer = 0;
    const cleanup = (): void => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) globalThis.clearTimeout(timer);
      globalThis.document.removeEventListener('pointerdown', cancelOnOutsidePointer, true);
      if (focusRestoreCleanupRef.current === cleanup) focusRestoreCleanupRef.current = null;
    };
    const cancelOnOutsidePointer = (event: PointerEvent): void => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node) || !container.contains(event.target)) {
        cleanup();
      }
    };
    globalThis.document.addEventListener('pointerdown', cancelOnOutsidePointer, true);
    frame = requestAnimationFrame(focusCanvas);
    // Tiptap's debounced attribute transaction can move focus after the first
    // frame. Restore once more unless the user deliberately clicked elsewhere.
    timer = globalThis.setTimeout(() => {
      cleanup();
      focusCanvas();
    }, 320);
    focusRestoreCleanupRef.current = cleanup;
  }, [focusCanvas]);

  useEffect(() => () => focusRestoreCleanupRef.current?.(), []);

  const selectSemanticOverlay = useCallback((selection: ElementRef) => {
    setSelection(selection);
    focusCanvas();
  }, [focusCanvas, setSelection]);

  const adjustBoundaryRangeFromOverlay = useCallback((
    boundaryId: string,
    endpoint: BoundaryRangeEndpoint,
    direction: BoundaryRangeDirection,
    steps: number,
  ) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      store.dispatch(planAdjustBoundaryRangeCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        boundaryId: boundaryId as BoundaryId,
        endpoint,
        direction,
        steps,
        groupId: `boundary-range-drag:${boundaryId}:${endpoint}`,
        origin: 'mindmap-v2-boundary-range-drag',
      }));
      setStatus(null);
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, restoreCanvasFocusAfterCommit, store]);

  const resizeBoundaryFrameFromOverlay = useCallback((
    boundaryId: string,
    frame: Readonly<Rect>,
  ) => {
    const currentDocument = store.getSnapshot();
    const geometry = flowProjection?.semanticGeometry.boundaries
      .find((item) => item.entityId === boundaryId);
    if (
      readOnly
      || !currentDocument
      || !activeSheetId
      || !geometry?.memberBounds
    ) return;
    try {
      store.dispatch(planResizeBoundaryFrameCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        boundaryId: boundaryId as BoundaryId,
        memberBounds: geometry.memberBounds,
        frame,
        groupId: `boundary-frame-resize:${boundaryId}`,
        origin: 'mindmap-v2-boundary-frame-resize',
      }));
      setStatus(null);
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, flowProjection, readOnly, restoreCanvasFocusAfterCommit, store]);

  const adjustSummaryRangeFromOverlay = useCallback((
    summaryId: string,
    endpoint: 'start' | 'end',
    direction: 'outward' | 'inward',
    steps: number,
  ) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      store.dispatch(planAdjustSummaryRangeCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        summaryId: summaryId as SummaryId,
        endpoint,
        direction,
        steps,
        groupId: `summary-range-drag:${summaryId}:${endpoint}`,
        origin: 'mindmap-v2-summary-range-drag',
      }));
      setStatus(null);
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, restoreCanvasFocusAfterCommit, store]);

  const selectFromNavigator = useCallback((selection: ElementRef, sheetId: SheetId) => {
    const targetSheet = document?.sheets[sheetId];
    const targetView = sheetViews[sheetId];
    const targetFocusContext = targetSheet && targetView?.focusedBranchRootId
      ? projectFocusedBranchContext(targetSheet, targetView.focusedBranchRootId)
      : null;
    const selectionOutsideFocus = selection.kind === 'topic'
      && targetFocusContext !== null
      && !targetFocusContext.visibleTopicIds.includes(selection.id);
    if (selectionOutsideFocus && sheetId === activeSheetId) leaveFocusedBranch();
    setSheetViews((previous) => ({
      ...previous,
      [sheetId]: {
        ...((): SheetLocalView => {
          const current = previous[sheetId] ?? { selection: [] };
          if (!selectionOutsideFocus || sheetId === activeSheetId) return current;
          const session = branchFocusSessionsRef.current.get(sheetId);
          branchFocusSessionsRef.current.delete(sheetId);
          if (session) {
            return exitBranchFocus({
              viewport: { ...(current.viewport ?? { x: 0, y: 0, zoom: 1 }) },
              selection: [...current.selection],
              ...(current.focusedBranchRootId
                ? { focusedBranchRootId: current.focusedBranchRootId }
                : {}),
              ...(current.foldOverrides
                ? { foldOverrides: { ...current.foldOverrides } }
                : {}),
            }, session);
          }
          const { focusedBranchRootId: _ignored, ...withoutFocus } = current;
          return withoutFocus;
        })(),
        selection: [selection],
      },
    }));
    setActiveSheetId(sheetId);
    setEditingTopicId(null);
    setEditingSheetId(null);
  }, [activeSheetId, document, leaveFocusedBranch, sheetViews]);

  const applyOutlinerMutation = useCallback((intent: OutlinerMutationIntent) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument) return;
    try {
      store.dispatch(planOutlinerMutationCommand(currentDocument, intent));
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [readOnly, store]);

  const selectTopic = useCallback((topicId: TopicId, modifiers: SelectionModifiers = {}) => {
    if (!activeSheet) return;
    setSelectedLocalImageId(undefined);
    setSelections(selectElement(
      activeSheet,
      currentSelections,
      { kind: 'topic', id: topicId },
      modifiers,
    ));
    focusCanvas();
  }, [activeSheet, currentSelections, focusCanvas, setSelections]);

  const activateTopicEnrichment = useCallback((
    topicId: TopicId,
    kind: TopicEnrichmentKind,
    _id: string,
  ) => {
    if (kind === 'marker') {
      selectTopic(topicId);
      setImportExportOpen(false);
      setTopicEnrichmentPanel(null);
      setMarkerLegendPanelOpen(true);
      return;
    }
    const section: TopicEnrichmentSection | undefined = kind === 'label'
      ? 'labels'
      : kind === 'note'
        ? 'note'
        : kind === 'link'
          ? 'links'
          : kind === 'todo' || kind === 'todo-progress'
            ? 'todo'
            : kind === 'task'
              ? 'task'
          : undefined;
    if (!section) return;
    selectTopic(topicId);
    setImportExportOpen(false);
    setMarkerLegendPanelOpen(false);
    setStickerCatalogOpen(false);
    setTopicEnrichmentPanel((previous) => ({
      section,
      focusLinkRequest: section === 'links'
        ? (previous?.focusLinkRequest ?? 0) + 1
        : previous?.focusLinkRequest ?? 0,
    }));
  }, [selectTopic]);

  const openSelectedTopicEnrichment = useCallback((
    section: TopicEnrichmentSection,
    focusLinkInput = false,
  ) => {
    if (!isTopicSelection(currentSelection)) return;
    setImportExportOpen(false);
    setMarkerLegendPanelOpen(false);
    setStickerCatalogOpen(false);
    setTopicEnrichmentPanel((previous) => ({
      section,
      focusLinkRequest: focusLinkInput
        ? (previous?.focusLinkRequest ?? 0) + 1
        : previous?.focusLinkRequest ?? 0,
    }));
  }, [currentSelection]);

  const dispatchTopicEnrichmentCommand = useCallback((
    command: TopicEnrichmentCommand,
  ) => {
    if (readOnly) throw new Error('只读模式不能修改主题内容。');
    try {
      store.dispatch(command);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
      throw error;
    }
  }, [readOnly, store]);

  const dispatchMarkerLegendCommand = useCallback((command: MarkerLegendCommand) => {
    if (readOnly) throw new Error('只读模式不能修改标记或图例。');
    try {
      store.dispatch(command);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
      throw error;
    }
  }, [readOnly, store]);

  const moveMarkerLegend = useCallback((position: Point) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    dispatchMarkerLegendCommand(planMoveMarkerLegendCommand({
      document: currentDocument,
      sheetId: activeSheetId,
      position,
    }));
  }, [activeSheetId, dispatchMarkerLegendCommand, readOnly, store]);

  const beginEdit = useCallback((topicId: TopicId) => {
    if (readOnly) return;
    setSelection({ kind: 'topic', id: topicId });
    setEditingTopicId(topicId);
  }, [readOnly, setSelection]);

  const commitTitle = useCallback((topicId: TopicId, title: RichText) => {
    setEditingTopicId(null);
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    const topic = currentDocument.sheets[activeSheetId]?.topics[topicId];
    if (!topic) return;
    const normalizedTitle = richTextToPlainText(title)
      ? title
      : createRichText('未命名主题');
    if (JSON.stringify(topic.title) === JSON.stringify(normalizedTitle)) return;
    try {
      store.dispatch(planUpdateTopicTitleCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        topicId,
        title: normalizedTitle,
        groupId: `title:${topicId}`,
      }));
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const createSheet = useCallback(() => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      const command = planCreateSheetCommand({
        document: currentDocument,
        sheetId: activeSheetId,
      });
      store.dispatch(command);
      const newSheetId = command.payload.sheet.id;
      setActiveSheetId(newSheetId);
      setEditingTopicId(null);
      setEditingSheetId(newSheetId);
      setSheetTitleDraft(command.payload.sheet.title);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const commitSheetTitle = useCallback((sheetId: SheetId, title: string) => {
    setEditingSheetId(null);
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument) return;
    const normalized = title.trim() || '未命名 Sheet';
    if (currentDocument.sheets[sheetId]?.title === normalized) return;
    try {
      store.dispatch(planRenameSheetCommand({
        document: currentDocument,
        sheetId,
        title: normalized,
        groupId: `sheet-title:${sheetId}`,
      }));
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [readOnly, store]);

  const deleteActiveSheet = useCallback(() => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId || sheetIds.length <= 1) return;
    const index = sheetIds.indexOf(activeSheetId);
    const fallbackSheetId = sheetIds[index + 1] ?? sheetIds[index - 1];
    try {
      store.dispatch(planDeleteSheetCommand({
        document: currentDocument,
        sheetId: activeSheetId,
      }));
      branchFocusSessionsRef.current.delete(activeSheetId);
      setSheetViews((previous) => {
        const { [activeSheetId]: _deleted, ...remaining } = previous;
        return remaining;
      });
      setActiveSheetId(fallbackSheetId);
      setEditingTopicId(null);
      setEditingSheetId(null);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, sheetIds, store]);

  const updateSheetLayout = useCallback((
    update: (current: ResolvedBranchLayoutSpec) => ResolvedBranchLayoutSpec,
  ) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    const sheet = currentDocument.sheets[activeSheetId];
    if (!sheet) return;
    try {
      store.dispatch(planUpdateSheetLayoutCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        defaultBranchLayout: update(sheet.defaultBranchLayout),
        groupId: `sheet-layout:${activeSheetId}`,
      }));
      setStatus(null);
      requestAnimationFrame(() => fitProjection(220));
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, fitProjection, readOnly, store]);

  const changeLayoutStructure = useCallback((structure: SupportedCoreLayoutStructure) => {
    const capability = getCoreLayoutCapability(structure);
    if (!capability) return;
    updateSheetLayout((current) => ({
      ...current,
      structure,
      direction: capability.allowedDirections.includes(current.direction)
        ? current.direction
        : capability.defaultDirection,
      spacing: { ...capability.defaultSpacing },
      variantId: capability.variantIds[0],
      options: {},
    }));
  }, [updateSheetLayout]);

  const changeLayoutDirection = useCallback((direction: ResolvedLayoutDirection) => {
    updateSheetLayout((current) => ({ ...current, direction }));
  }, [updateSheetLayout]);

  const changeLayoutVariant = useCallback((variantId: string) => {
    updateSheetLayout((current) => ({ ...current, variantId }));
  }, [updateSheetLayout]);

  const applyFormatOverrides = useCallback((overrides: Readonly<StyleProperties>) => {
    const currentDocument = store.getSnapshot();
    if (
      readOnly
      || !currentDocument
      || !activeSheetId
      || formatSelection.length === 0
    ) return;
    try {
      store.dispatch(planUpdateStyleBindingsCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        targets: formatSelection.map((entry) => entry.target),
        overrides,
        groupId: `format:${formatSelection
          .map((entry) => `${entry.target.scope}:${entry.target.id}`)
          .join(',')}`,
      }));
      setStatus(null);
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('does not change any target')) return;
      setStatus(message);
    }
  }, [activeSheetId, formatSelection, readOnly, store]);

  const resetFormatOverrides = useCallback((paths?: readonly StyleOverridePath[]) => {
    const currentDocument = store.getSnapshot();
    if (
      readOnly
      || !currentDocument
      || !activeSheetId
      || formatSelection.length === 0
    ) return;
    try {
      store.dispatch(planResetStyleBindingsCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        targets: formatSelection.map((entry) => entry.target),
        ...(paths ? { paths } : {}),
        groupId: `format-reset:${formatSelection
          .map((entry) => `${entry.target.scope}:${entry.target.id}`)
          .join(',')}`,
      }));
      setStatus(null);
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('does not change any target')) return;
      setStatus(message);
    }
  }, [activeSheetId, formatSelection, readOnly, store]);

  const toggleCollapse = useCallback((topicId: TopicId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      store.dispatch(planToggleTopicCollapseCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        topicId,
      }));
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const addChild = useCallback((parentTopicId?: TopicId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    const sheet = currentDocument.sheets[activeSheetId];
    const resolvedParent = parentTopicId ?? (
      isTopicSelection(currentSelection) ? currentSelection.id : sheet.rootTopicId
    );
    try {
      const command = planCreateTopicCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        parentTopicId: resolvedParent,
        title: '新主题',
        groupId: `create-child:${resolvedParent}`,
      });
      store.dispatch(command);
      setSelection({ kind: 'topic', id: command.payload.topic.id });
      setEditingTopicId(command.payload.topic.id);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, currentSelection, readOnly, setSelection, store]);

  const addSibling = useCallback((
    topicId: TopicId,
    position: 'before' | 'after' = 'after',
  ) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    const sheet = currentDocument.sheets[activeSheetId];
    const parentEdge = getParentEdge(sheet, topicId);
    if (!parentEdge) {
      addChild(topicId);
      return;
    }
    try {
      const command = planCreateTopicCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        parentTopicId: parentEdge.parentTopicId,
        title: '新主题',
        insertion: { relativeTopicId: topicId, position },
        groupId: `create-sibling:${position}:${topicId}`,
      });
      store.dispatch(command);
      setSelection({ kind: 'topic', id: command.payload.topic.id });
      setEditingTopicId(command.payload.topic.id);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, addChild, readOnly, setSelection, store]);

  const insertParentTopic = useCallback((topicId: TopicId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      const command = planInsertParentTopicCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        topicId,
        title: '新主题',
        groupId: `insert-parent:${topicId}`,
      });
      store.dispatch(command);
      setSelection({ kind: 'topic', id: command.payload.parentTopic.id });
      setEditingTopicId(command.payload.parentTopic.id);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, setSelection, store]);

  const deleteCurrentTopic = useCallback((topicId: TopicId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    const sheet = currentDocument.sheets[activeSheetId];
    const parentTopicId = getParentEdge(sheet, topicId)?.parentTopicId;
    try {
      const command = planDeleteCurrentTopicCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        topicId,
        groupId: `delete-current:${topicId}`,
      });
      store.dispatch(command);
      const fallbackTopicId = command.payload.promotedEdges[0]?.childTopicId
        ?? parentTopicId
        ?? sheet.rootTopicId;
      setEditingTopicId(null);
      setSelection({ kind: 'topic', id: fallbackTopicId });
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, setSelection, store]);

  const invokeSystemClipboardCommand = useCallback((action: 'copy' | 'cut') => {
    requestAnimationFrame(() => {
      const sink = clipboardSinkRef.current;
      if (!sink || typeof globalThis.document.execCommand !== 'function') {
        setStatus('当前浏览器不支持从上下文菜单访问系统剪贴板。');
        return;
      }
      sink.value = ' ';
      sink.focus({ preventScroll: true });
      sink.select();
      if (!globalThis.document.execCommand(action)) {
        sink.value = '';
        setStatus('系统拒绝访问剪贴板，请使用 Ctrl/Cmd 快捷键重试。');
      }
    });
  }, []);

  const createSemanticElement = useCallback((kind: SemanticCreateKind) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      const common = {
        document: currentDocument,
        sheetId: activeSheetId,
      };
      const command = kind === 'relationship'
        ? planCreateRelationshipCommand({
            ...common,
            topicIds: selectedTopicIdList,
          })
        : kind === 'boundary'
          ? planCreateBoundaryCommand({
              ...common,
              topicIds: selectedTopicIdList,
            })
          : kind === 'summary'
            ? planCreateSummaryCommand({
                ...common,
                topicIds: selectedTopicIdList,
              })
            : planCreateCalloutCommand({
                ...common,
                topicId: selectedTopicIdList[0],
              });
      store.dispatch(command);
      setSelection(createdElementRef(command));
      setEditingTopicId(null);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, selectedTopicIdList, setSelection, store]);

  const deleteSemanticElement = useCallback((reference: DeletableSemanticElementRef) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      store.dispatch(planDeleteSemanticElementCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        element: reference,
      }));
      setSelections(currentSelections.filter((selectedReference) =>
        selectedReference.kind !== reference.kind || selectedReference.id !== reference.id));
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, currentSelections, readOnly, setSelections, store]);

  const dispatchSemanticPropertiesCommand = useCallback((
    command: SemanticPropertiesCommand,
  ) => {
    if (readOnly) return;
    try {
      store.dispatch(command);
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [readOnly, store]);

  const deleteSelection = useCallback(() => {
    const currentDocument = store.getSnapshot();
    if (
      readOnly
      || !currentDocument
      || !activeSheetId
      || currentSelections.length === 0
    ) return;
    const initialSheet = currentDocument.sheets[activeSheetId];
    const topicIds = normalizeTopLevelTopicSelection(initialSheet, currentSelections)
      .filter((topicId) => topicId !== initialSheet.rootTopicId);
    if (topicIds.length === 0) return;
    const fallbackTopicId = getParentEdge(initialSheet, topicIds[0])?.parentTopicId
      ?? initialSheet.rootTopicId;
    try {
      for (const topicId of topicIds) {
        const nextDocument = store.getSnapshot();
        if (!nextDocument?.sheets[activeSheetId]?.topics[topicId]) continue;
        store.dispatch(planDeleteTopicSubtreeCommand({
          document: nextDocument,
          sheetId: activeSheetId,
          topicId,
          groupId: `delete-selection:${topicIds.join(',')}`,
        }));
      }
      setEditingTopicId(null);
      setSelection({ kind: 'topic', id: fallbackTopicId });
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, currentSelections, readOnly, setSelection, store]);

  const finishTopicDrag = useCallback((draggedNode: ReactFlowNode<MindMapTopicNodeData>) => {
    const topicId = draggedNode.id as TopicId;
    draggingTopicRef.current = null;
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) {
      setInteractiveNodes(flowNodes);
      return;
    }
    const sheet = currentDocument.sheets[activeSheetId];
    const toRect = (flowNode: ReactFlowNode<MindMapTopicNodeData>): TopicRect => ({
      id: flowNode.id as TopicId,
      x: flowNode.id === draggedNode.id ? draggedNode.position.x : flowNode.position.x,
      y: flowNode.id === draggedNode.id ? draggedNode.position.y : flowNode.position.y,
      width: flowNode.width ?? 184,
      height: flowNode.height ?? 58,
    });
    const topicRects = interactiveNodes.map(toRect);
    const draggedRect = toRect(draggedNode);
    const intent = detectTopicDropIntent({
      sheet,
      topicId,
      dragged: draggedRect,
      topics: topicRects,
    });
    if (intent.kind === 'none') {
      setInteractiveNodes(flowNodes);
      setStatus(intent.reason === 'central-topic' ? '中心主题不能拖动。' : null);
      return;
    }
    try {
      if (intent.kind === 'reparent') {
        store.dispatch(planReparentTopicCommand({
          document: currentDocument,
          sheetId: activeSheetId,
          topicId,
          parentTopicId: intent.parentTopicId,
          groupId: `drag:${topicId}`,
        }));
        setStatus('已移动主题及其完整分支。');
      } else {
        store.dispatch(planReorderTopicCommand({
          document: currentDocument,
          sheetId: activeSheetId,
          topicId,
          index: intent.index,
          groupId: `drag:${topicId}`,
        }));
        setStatus('已调整同级顺序。');
      }
    } catch (error) {
      setInteractiveNodes(flowNodes);
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, flowNodes, interactiveNodes, readOnly, store]);

  const undo = useCallback(() => {
    if (readOnly) return;
    try {
      store.undo();
      setEditingTopicId(null);
      setStatus(null);
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [readOnly, restoreCanvasFocusAfterCommit, store]);

  const redo = useCallback(() => {
    if (readOnly) return;
    try {
      store.redo();
      setEditingTopicId(null);
      setStatus(null);
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [readOnly, restoreCanvasFocusAfterCommit, store]);

  const ingestLocalImage = useCallback(async (
    topicId: TopicId,
    files: readonly File[],
  ): Promise<void> => {
    if (!activeSheetId) return;
    if (files.length !== 1) {
      setStatus(files.length === 0
        ? '未选择图片文件。'
        : '一次只能添加一张图片。');
      return;
    }
    if (localImageIngestingRef.current) {
      setStatus('正在添加图片，请稍候。');
      return;
    }

    localImageIngestingRef.current = true;
    setLocalImageBusy(true);
    setStatus('正在添加本地图片…');
    currentSelectionRef.current = { kind: 'topic', id: topicId };
    setSelection({ kind: 'topic', id: topicId });
    try {
      const planned = await planLocalImageIngest({
        file: files[0],
        readOnly: readOnlyRef.current,
        sheetId: activeSheetId,
        topicId,
        getDocument: () => store.getSnapshot(),
        upload: api.uploadImage,
      });
      if (
        activeSheetIdRef.current !== activeSheetId
        || currentSelectionRef.current?.kind !== 'topic'
        || currentSelectionRef.current.id !== topicId
      ) {
        setStatus('无法添加该图片。');
        return;
      }
      if (readOnlyRef.current) {
        setStatus('只读模式不能添加图片。');
        return;
      }
      store.dispatch(planned.command);
      setSelectedLocalImageId(planned.image.id);
      setStatus('已添加本地图片。');
      restoreCanvasFocusAfterCommit();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fitProjectionRef.current(260);
      }));
    } catch (error) {
      setStatus(localImageIngestErrorMessage(error));
    } finally {
      localImageIngestingRef.current = false;
      setLocalImageBusy(false);
    }
  }, [activeSheetId, restoreCanvasFocusAfterCommit, setSelection, store]);

  const ingestBuiltInSticker = useCallback(async (
    topicId: TopicId,
    stickerId: BuiltInStickerId,
  ): Promise<void> => {
    if (!activeSheetId) return;
    if (stickerIngestingRef.current) {
      setStatus('正在添加贴纸，请稍候。');
      return;
    }
    if (readOnlyRef.current) {
      setStatus('只读模式不能添加贴纸。');
      return;
    }

    const controller = new AbortController();
    stickerAbortRef.current = controller;
    stickerIngestingRef.current = true;
    setStickerBusy(true);
    setStatus('正在添加贴纸…');
    currentSelectionRef.current = { kind: 'topic', id: topicId };
    setSelection({ kind: 'topic', id: topicId });
    try {
      const planned = await planBuiltInStickerIngest({
        stickerId,
        readOnly: readOnlyRef.current,
        sheetId: activeSheetId,
        topicId,
        getDocument: () => store.getSnapshot(),
        signal: controller.signal,
        upload: (file) => api.uploadImage(file, { signal: controller.signal }),
      });
      const currentDocument = store.getSnapshot();
      if (
        controller.signal.aborted
        || readOnlyRef.current
        || activeSheetIdRef.current !== activeSheetId
        || !currentDocument?.sheets[activeSheetId]?.topics[topicId]
      ) {
        setStatus('已取消添加贴纸。');
        return;
      }
      store.dispatch(planned.command);
      recordRecentlyUsedSticker(stickerId);
      setSelectedLocalImageId(planned.image.id);
      setStatus('已添加贴纸。');
      restoreCanvasFocusAfterCommit();
    } catch (error) {
      setStatus(controller.signal.aborted
        ? '已取消添加贴纸。'
        : stickerIngestErrorMessage(error));
    } finally {
      if (stickerAbortRef.current === controller) stickerAbortRef.current = null;
      stickerIngestingRef.current = false;
      setStickerBusy(false);
    }
  }, [activeSheetId, restoreCanvasFocusAfterCommit, setSelection, store]);

  const selectLocalImage = useCallback((topicId: TopicId, imageId: ImageId) => {
    // A pending post-command canvas focus must not steal keyboard ownership
    // from the image button (notably before image-level Delete).
    focusRestoreCleanupRef.current?.();
    if (!activeSheet) return;
    setSelections(selectElement(
      activeSheet,
      currentSelections,
      { kind: 'topic', id: topicId },
      {},
    ));
    setSelectedLocalImageId(imageId);
  }, [activeSheet, currentSelections, setSelections]);

  const moveLocalImage = useCallback((imageId: ImageId, side: TopicImagesSide) => {
    const currentDocument = store.getSnapshot();
    const image = activeSheetId
      ? currentDocument?.sheets[activeSheetId]?.images[imageId]
      : undefined;
    if (readOnly || !currentDocument || !activeSheetId || !image) return;
    if (
      (image.role === 'sticker' && !['top', 'bottom', 'left', 'right'].includes(side))
      || (image.role !== 'sticker' && side !== 'top' && side !== 'bottom')
    ) return;
    if (image.placement.side === side) return;
    try {
      store.dispatch(planUpdateImageCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        image: {
          ...structuredClone(image),
          placement: { ...structuredClone(image.placement), side },
        },
        origin: 'mindmap-v2-local-image-move',
      }));
      const kind = image.role === 'sticker' ? '贴纸' : '图片';
      const sideLabel = side === 'top'
        ? '上方'
        : side === 'bottom'
          ? '下方'
          : side === 'left'
            ? '左侧'
            : '右侧';
      setStatus(`已将${kind}移到主题${sideLabel}。`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const dropLocalImage = useCallback((
    topicId: TopicId,
    imageId: ImageId,
    side: TopicImagesSide,
  ) => {
    const currentDocument = store.getSnapshot();
    const image = activeSheetId
      ? currentDocument?.sheets[activeSheetId]?.images[imageId]
      : undefined;
    if (
      readOnly
      || !image
      || image.topicId !== topicId
      || (image.role === 'background')
      || (image.role !== 'sticker' && image.role !== 'inline' && image.role !== 'thumbnail')
      || (image.role !== 'sticker' && side !== 'top' && side !== 'bottom')
      || image.placement.side === side
    ) return;
    moveLocalImage(imageId, side);
  }, [activeSheetId, moveLocalImage, readOnly, store]);

  const resizeLocalImage = useCallback((imageId: ImageId, size: Size) => {
    const currentDocument = store.getSnapshot();
    const image = activeSheetId
      ? currentDocument?.sheets[activeSheetId]?.images[imageId]
      : undefined;
    if (readOnly || !currentDocument || !activeSheetId || !image) return;
    if (
      !Number.isFinite(size.width)
      || !Number.isFinite(size.height)
      || size.width <= 0
      || size.height <= 0
    ) {
      setStatus('图片尺寸必须是有限正数。');
      return;
    }
    const normalizedSize = {
      width: Math.min(1_000_000, Math.max(1, Math.round(size.width))),
      height: Math.min(1_000_000, Math.max(1, Math.round(size.height))),
    };
    try {
      store.dispatch(planUpdateImageCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        image: { ...structuredClone(image), size: normalizedSize },
        origin: 'mindmap-v2-local-image-resize',
      }));
      setStatus('已调整图片大小。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const resetLocalImageSize = useCallback((imageId: ImageId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      store.dispatch(planResetImageSizeCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        imageId,
        origin: 'mindmap-v2-local-image-reset-size',
      }));
      setStatus('已恢复图片原始尺寸。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const deleteLocalImage = useCallback((imageId: ImageId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId) return;
    try {
      // Asset pruning is exclusively derived by the planner/registry.
      store.dispatch(planDeleteImageCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        imageId,
        origin: 'mindmap-v2-local-image-delete',
      }));
      setSelectedLocalImageId(undefined);
      setStatus('已删除图片。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [activeSheetId, readOnly, store]);

  const receiveImportResult = useCallback((
    result: MindMapImportResult,
    source: MindMapImportSource,
  ) => {
    if (!result.report.success || !result.document) {
      setPendingImport(null);
      setStatus(`无法导入 ${source.fileName}：请查看导入报告。`);
      return;
    }
    const resourceBytes = source.format === 'xmind-content-json'
      ? (result as XMindImportResult).resourceBytes
      : undefined;
    setPendingImport({
      result,
      source,
      ...(resourceBytes === undefined ? {} : { resourceBytes }),
    });
    setStatus(null);
  }, []);

  const applyPendingImport = useCallback(async () => {
    const currentDocument = store.getSnapshot();
    const pending = pendingImport;
    const candidate = pending?.result.document;
    if (
      readOnly
      || importApplyAbortRef.current
      || !currentDocument
      || !candidate
      || !pending
    ) return;
    const controller = new AbortController();
    importApplyAbortRef.current = controller;
    setImportApplyBusy(true);
    try {
      const materialized = pending.source.format === 'xmind-content-json'
        ? await materializeXMindEmbeddedResources({
            candidate,
            resourceBytes: pending.resourceBytes ?? {},
            signal: controller.signal,
            uploadImage: (file, options) => api.uploadImage(file, options),
          })
        : { document: candidate };
      if (
        controller.signal.aborted
        || readOnlyRef.current
        || store.getSnapshot() !== currentDocument
        || pendingImportRef.current !== pending
      ) {
        throw new DOMException('Import application became stale.', 'AbortError');
      }
      const imported = store.dispatch(planReplaceImportedDocumentCommand({
        document: currentDocument,
        candidate: materialized.document,
        sheetId: activeSheetId ?? undefined,
      }));
      store.flush();
      // The sidecar now serves only as a same-session export cache. Rendering
      // uses the durable, same-origin managed resource endpoint after apply.
      const resourcesInstalled = xmindResourceSession.replace(
        materialized.verifiedResourceBytes,
        materialized.document.assets,
      );
      if (!resourcesInstalled) xmindResourceSession.clear();
      refreshXMindResources();
      const firstImportedSheetId = orderedSheetIds(imported)[0] ?? null;
      setActiveSheetId(firstImportedSheetId);
      branchFocusSessionsRef.current.clear();
      setSheetViews({});
      setEditingTopicId(null);
      setEditingSheetId(null);
      setPendingImport(null);
      setImportExportOpen(false);
      setMarkerLegendPanelOpen(false);
      setStatus(
        `已导入 ${pending.source.fileName}：${pending.result.report.importedSheets} 个 Sheet，${pending.result.report.importedTopics} 个主题。${
          resourcesInstalled ? '' : ' 图片导出缓存不可用；受管图片仍可从服务器读取。'
        }`,
      );
      requestAnimationFrame(() => flowInstanceRef.current?.fitView({ padding: 0.2 }));
    } catch (error) {
      if (isAbortError(error)) {
        setStatus('已取消应用导入；当前脑图未更改。');
      } else if (error instanceof XMindResourceMaterializationError) {
        setStatus(`图片资源校验或上传失败（${error.code}）；当前脑图未更改。`);
      } else {
        setStatus(errorMessage(error));
      }
    } finally {
      if (importApplyAbortRef.current === controller) {
        importApplyAbortRef.current = null;
        setImportApplyBusy(false);
      }
    }
  }, [activeSheetId, pendingImport, readOnly, store, xmindResourceSession]);

  const cancelPendingImport = useCallback(() => {
    const wasApplying = importApplyAbortRef.current !== null;
    importApplyAbortRef.current?.abort();
    setPendingImport(null);
    if (wasApplying) setStatus('正在取消应用导入…');
  }, []);

  const navigateSelection = useCallback((direction: NavigationDirection, extend: boolean) => {
    if (!isTopicSelection(currentSelection)) return;
    const nextTopicId = findDirectionalTopic(
      flowNodes.map((flowNode) => ({
        id: flowNode.id as TopicId,
        x: flowNode.position.x,
        y: flowNode.position.y,
        width: flowNode.width ?? 184,
        height: flowNode.height ?? 58,
      })),
      currentSelection.id,
      direction,
    );
    if (nextTopicId) selectTopic(nextTopicId, { range: extend });
  }, [currentSelection, flowNodes, selectTopic]);

  const topicActions = useMemo<TopicNodeActions>(() => ({
    readOnly,
    selectedImageId: selectedLocalImageId,
    select: selectTopic,
    beginEdit,
    commitTitle,
    cancelEdit: () => setEditingTopicId(null),
    toggleCollapse,
    activateEnrichment: activateTopicEnrichment,
    selectImage: selectLocalImage,
    moveImage: moveLocalImage,
    resizeImage: resizeLocalImage,
    resetImageSize: resetLocalImageSize,
    deleteImage: deleteLocalImage,
    dropImage: dropLocalImage,
    ingestDroppedImages: (topicId, files) => {
      void ingestLocalImage(topicId, files);
    },
    ingestSticker: (topicId, stickerId) => {
      void ingestBuiltInSticker(topicId, stickerId);
    },
  }), [
    activateTopicEnrichment,
    beginEdit,
    commitTitle,
    deleteLocalImage,
    dropLocalImage,
    ingestBuiltInSticker,
    ingestLocalImage,
    moveLocalImage,
    readOnly,
    resetLocalImageSize,
    resizeLocalImage,
    selectLocalImage,
    selectedLocalImageId,
    selectTopic,
    toggleCollapse,
  ]);

  const handleCopyOrCut = useCallback((
    event: ReactClipboardEvent<HTMLDivElement>,
    cut: boolean,
  ) => {
    if (isNativeClipboardTarget(event.target)) return;
    const currentDocument = store.getSnapshot();
    if (!currentDocument || !activeSheetId || selectedTopicIdList.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (cut && readOnly) {
      setStatus('只读模式不能剪切主题。');
      return;
    }

    try {
      const encoded = cut
        ? planCutMindMapClipboard({
            document: currentDocument,
            sheetId: activeSheetId,
            selectedTopicIds: selectedTopicIdList,
          }).clipboard
        : encodeMindMapClipboard({
            document: currentDocument,
            sheetId: activeSheetId,
            selectedTopicIds: selectedTopicIdList,
          });
      const result = writeEncodedClipboard(event.clipboardData, encoded);
      if (result.writtenCount === 0) {
        setStatus('系统拒绝访问剪贴板，请检查浏览器剪贴板权限后重试。');
        return;
      }
      if (cut && !result.customWritten) {
        setStatus('系统不支持脑图结构剪贴板格式；已复制文本，但未删除原主题。');
        return;
      }
      if (cut) {
        deleteSelection();
        setStatus('已剪切主题；可用 Ctrl/Cmd+V 粘贴。');
      } else {
        setStatus(result.customWritten
          ? '已复制完整主题结构。'
          : '系统不支持脑图结构格式，已复制可读文本。');
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      focusCanvas();
    }
  }, [activeSheetId, deleteSelection, focusCanvas, readOnly, selectedTopicIdList, store]);

  const pasteFromSystemClipboard = useCallback(async (requestedParentTopicId?: TopicId) => {
    const currentDocument = store.getSnapshot();
    if (readOnly || !currentDocument || !activeSheetId || !activeSheet) return;
    const clipboard = globalThis.navigator.clipboard;
    if (!clipboard) {
      setStatus('当前浏览器不支持读取系统剪贴板，请使用 Ctrl/Cmd+V。');
      return;
    }

    let custom = '';
    let markdown = '';
    let plain = '';
    try {
      if (typeof clipboard.read === 'function') {
        const items = await clipboard.read();
        for (const item of items) {
          const readType = async (mime: string): Promise<string> => {
            if (!item.types.includes(mime)) return '';
            return (await item.getType(mime)).text();
          };
          custom ||= await readType(MIND_MAP_CLIPBOARD_MIME);
          markdown ||= await readType(MIND_MAP_CLIPBOARD_MARKDOWN_MIME);
          plain ||= await readType(MIND_MAP_CLIPBOARD_TEXT_MIME);
        }
      } else if (typeof clipboard.readText === 'function') {
        plain = await clipboard.readText();
      }
    } catch (error) {
      setStatus(`无法读取系统剪贴板：${errorMessage(error)}`);
      return;
    }
    if (!custom.trim() && !markdown.trim() && !plain.trim()) {
      setStatus('系统剪贴板中没有可粘贴的脑图或文本。');
      return;
    }

    const latestDocument = store.getSnapshot();
    if (!latestDocument?.sheets[activeSheetId]) return;
    const parentTopicId = requestedParentTopicId
      ?? (isTopicSelection(currentSelection) ? currentSelection.id : activeSheet.rootTopicId);
    try {
      if (custom.trim()) {
        const envelope = decodeMindMapClipboard(custom);
        const command = planPasteClipboardFragmentCommand({
          document: latestDocument,
          sheetId: activeSheetId,
          parentTopicId,
          envelope,
        });
        store.dispatch(command);
        setSelections(command.payload.rootTopicIds.map((topicId) => ({
          kind: 'topic' as const,
          id: topicId,
        })));
        setStatus('已从系统剪贴板粘贴完整主题结构。');
      } else {
        const command = planPasteTextTopicCommand({
          document: latestDocument,
          sheetId: activeSheetId,
          parentTopicId,
          text: markdown.trim() ? markdown : plain,
        });
        store.dispatch(command);
        setSelection({ kind: 'topic', id: command.payload.topic.id });
        setStatus('已从系统剪贴板粘贴为新主题。');
      }
      setEditingTopicId(null);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      focusCanvas();
    }
  }, [
    activeSheet,
    activeSheetId,
    currentSelection,
    focusCanvas,
    readOnly,
    setSelection,
    setSelections,
    store,
  ]);

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (isNativeClipboardTarget(event.target)) return;
    const currentDocument = store.getSnapshot();
    if (!currentDocument || !activeSheetId || !activeSheet) return;

    let custom = '';
    let markdown = '';
    let plain = '';
    try {
      custom = event.clipboardData.getData(MIND_MAP_CLIPBOARD_MIME);
      markdown = event.clipboardData.getData(MIND_MAP_CLIPBOARD_MARKDOWN_MIME);
      plain = event.clipboardData.getData(MIND_MAP_CLIPBOARD_TEXT_MIME);
    } catch (error) {
      event.preventDefault();
      event.stopPropagation();
      setStatus(`无法读取系统剪贴板：${errorMessage(error)}`);
      focusCanvas();
      return;
    }
    if (!custom.trim() && !markdown.trim() && !plain.trim()) {
      focusCanvas();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) {
      setStatus('只读模式不能粘贴主题。');
      focusCanvas();
      return;
    }

    const parentTopicId = isTopicSelection(currentSelection)
      ? currentSelection.id
      : activeSheet.rootTopicId;
    try {
      if (custom.trim()) {
        const envelope = decodeMindMapClipboard(custom);
        const command = planPasteClipboardFragmentCommand({
          document: currentDocument,
          sheetId: activeSheetId,
          parentTopicId,
          envelope,
        });
        store.dispatch(command);
        setSelections(command.payload.rootTopicIds.map((topicId) => ({
          kind: 'topic' as const,
          id: topicId,
        })));
        setEditingTopicId(null);
        const omitted = envelope.report.omissions.length;
        setStatus(omitted > 0
          ? `已粘贴完整主题结构；${omitted} 个选区外引用未带入。`
          : '已粘贴完整主题结构。');
        return;
      }

      const command = planPasteTextTopicCommand({
        document: currentDocument,
        sheetId: activeSheetId,
        parentTopicId,
        text: markdown.trim() ? markdown : plain,
      });
      store.dispatch(command);
      setSelection({ kind: 'topic', id: command.payload.topic.id });
      setEditingTopicId(null);
      setStatus('剪贴板没有脑图结构格式，已安全粘贴为新主题。');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      focusCanvas();
    }
  }, [
    activeSheet,
    activeSheetId,
    currentSelection,
    focusCanvas,
    readOnly,
    setSelection,
    setSelections,
    store,
  ]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (
      selectedLocalImageId
      && (event.key === 'Delete' || event.key === 'Backspace')
      && !target.matches('input, textarea, select, [contenteditable="true"]')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!readOnly) deleteLocalImage(selectedLocalImageId);
      return;
    }
    if (target.matches('input, textarea, select, button, [contenteditable="true"]')) return;
    const commandModifier = event.ctrlKey || event.metaKey;
    const lowerKey = event.key.toLowerCase();

    if (commandModifier && lowerKey === 'f') {
      event.preventDefault();
      event.stopPropagation();
      if (workspaceChromeVisible) {
        searchPanelRef.current?.focusSearch();
      } else {
        setFullScreen(true);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          searchPanelRef.current?.focusSearch();
        }));
      }
      return;
    }

    if (commandModifier && lowerKey === 'k' && isTopicSelection(currentSelection)) {
      event.preventDefault();
      event.stopPropagation();
      openSelectedTopicEnrichment('links', true);
      return;
    }

    if (commandModifier && (event.code === 'Semicolon' || lowerKey === ';')) {
      event.preventDefault();
      event.stopPropagation();
      if (focusedBranchRootId) leaveFocusedBranch();
      else focusSelectedBranch();
      return;
    }

    if (commandModifier && (event.key === '+' || event.key === '=')) {
      event.preventDefault();
      event.stopPropagation();
      zoomCanvasTo(liveZoom + 0.1);
      return;
    }

    if (commandModifier && event.key === '-') {
      event.preventDefault();
      event.stopPropagation();
      zoomCanvasTo(liveZoom - 0.1);
      return;
    }

    if (commandModifier && event.key === '0') {
      event.preventDefault();
      event.stopPropagation();
      resetCanvasZoom();
      return;
    }

    if (commandModifier && (lowerKey === 'c' || lowerKey === 'x' || lowerKey === 'v')) {
      clipboardSinkRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === 'Escape') {
      if (editingTopicId) {
        event.preventDefault();
        event.stopPropagation();
        setEditingTopicId(null);
        return;
      }
      if (focusedBranchRootId) {
        event.preventDefault();
        event.stopPropagation();
        leaveFocusedBranch();
        return;
      }
      if (fullScreen) {
        event.preventDefault();
        event.stopPropagation();
        setFullScreen(false);
        return;
      }
      if (currentSelections.length > 1 && currentSelection) {
        event.preventDefault();
        event.stopPropagation();
        setSelection(currentSelection);
        return;
      }
    }

    const direction = event.key === 'ArrowLeft' ? 'left'
      : event.key === 'ArrowRight' ? 'right'
        : event.key === 'ArrowUp' ? 'up'
          : event.key === 'ArrowDown' ? 'down'
            : undefined;
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      navigateSelection(direction, event.shiftKey);
      return;
    }
    if (commandModifier && lowerKey === 'a' && activeSheet) {
      event.preventDefault();
      event.stopPropagation();
      setSelections(flowNodes.map((flowNode) => ({
        kind: 'topic' as const,
        id: flowNode.id as TopicId,
      })));
      return;
    }
    if (readOnly) return;

    if (commandModifier && lowerKey === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (commandModifier && lowerKey === 'y') {
      event.preventDefault();
      event.stopPropagation();
      redo();
      return;
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace')
      && isDeletableSemanticElementRef(currentSelection)
    ) {
      event.preventDefault();
      event.stopPropagation();
      deleteSemanticElement(currentSelection);
      return;
    }
    if (!isTopicSelection(currentSelection)) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      addChild(currentSelection.id);
    } else if (event.key === 'Enter' && commandModifier) {
      event.preventDefault();
      event.stopPropagation();
      insertParentTopic(currentSelection.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      addSibling(currentSelection.id, event.shiftKey ? 'before' : 'after');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
    } else if (event.key === 'F2' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      beginEdit(currentSelection.id);
    }
  }, [
    addChild,
    addSibling,
    activeSheet,
    beginEdit,
    currentSelection,
    currentSelections,
    deleteLocalImage,
    deleteSemanticElement,
    insertParentTopic,
    deleteSelection,
    editingTopicId,
    flowNodes,
    focusSelectedBranch,
    focusedBranchRootId,
    fullScreen,
    leaveFocusedBranch,
    liveZoom,
    navigateSelection,
    openSelectedTopicEnrichment,
    readOnly,
    redo,
    resetCanvasZoom,
    selectedLocalImageId,
    setSelection,
    setSelections,
    undo,
    workspaceChromeVisible,
    zoomCanvasTo,
  ]);

  if (!document) return <DiagnosticView store={store} />;
  if (!activeSheetId || !activeSheet || !renderModel || !flowProjection) {
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        此脑图没有可显示的 Sheet。
      </section>
    );
  }

  const isRootSelected = isTopicSelection(currentSelection)
    && currentSelection.id === activeSheet.rootTopicId;
  const presentationClassName = fullScreen
    ? 'fixed inset-0 z-[900] h-[100dvh] w-screen overflow-hidden bg-slate-100'
    : `relative ${EMBEDDED_PRESENTATION_HEIGHT_CLASS} w-full overflow-hidden rounded-2xl border bg-slate-50 shadow-[0_12px_36px_rgba(15,23,42,0.08)] ${
        nodeViewSelected ? 'border-blue-500' : 'border-slate-200'
      }`;
  const canvasClassName = 'relative h-full w-full overflow-hidden bg-slate-50';
  const localViewport = sheetViews[activeSheetId]?.viewport;
  const layoutCapability = getCoreLayoutCapability(
    activeSheet.defaultBranchLayout.structure,
  );

  const canvas = (
      <div
        ref={containerRef}
        className={canvasClassName}
        tabIndex={0}
        role="tree"
        aria-label={`${document.title || '未命名思维导图'}，当前画布 ${activeSheet.title || '未命名 Sheet'}`}
        onCopy={(event) => handleCopyOrCut(event, false)}
        onCut={(event) => handleCopyOrCut(event, true)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        data-testid="mindmap-v2-canvas"
        data-read-only={readOnly ? 'true' : 'false'}
        data-mindmap-presentation={fullScreen ? 'fullscreen' : 'embedded'}
      >
        <textarea
          ref={clipboardSinkRef}
          data-mindmap-clipboard-sink="true"
          tabIndex={-1}
          aria-hidden="true"
          defaultValue=""
          onInput={(event) => {
            event.currentTarget.value = '';
          }}
          className="nodrag pointer-events-none fixed h-px w-px resize-none opacity-0"
        />
        <header
          className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-1.5 border-b border-slate-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur sm:gap-2 sm:px-3"
          data-testid={fullScreen
            ? 'mindmap-v2-fullscreen-topbar'
            : 'mindmap-v2-embedded-topbar'}
          data-mindmap-chrome={fullScreen ? 'compact' : 'preview'}
        >
          <div
            className={`${workspaceChromeVisible ? 'hidden sm:flex' : 'hidden'} shrink-0 items-center gap-1.5 pr-1`}
            aria-label="思维导图工作区"
          >
            <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.12)]" />
            <span className="whitespace-nowrap text-xs font-semibold text-slate-700">
              思维导图
            </span>
          </div>
          <div
            className="flex min-w-[7rem] max-w-[38%] shrink-0 items-center gap-1 overflow-x-auto sm:min-w-[9rem]"
            aria-label="Sheet 切换"
            data-testid="mindmap-v2-sheet-strip"
          >
            {sheetIds.map((sheetId) => editingSheetId === sheetId && !readOnly ? (
              <input
                key={sheetId}
                autoFocus
                value={sheetTitleDraft}
                onChange={(event) => setSheetTitleDraft(event.target.value)}
                onBlur={() => commitSheetTitle(sheetId, sheetTitleDraft)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditingSheetId(null);
                  }
                }}
                className="nodrag w-28 shrink-0 rounded-md border border-blue-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none ring-2 ring-blue-100"
                aria-label="编辑画布标题"
              />
            ) : (
              <button
                key={sheetId}
                type="button"
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${
                  sheetId === activeSheetId
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                onClick={() => {
                  setActiveSheetId(sheetId);
                  setEditingTopicId(null);
                }}
                onDoubleClick={() => {
                  if (readOnly) return;
                  setEditingSheetId(sheetId);
                  setSheetTitleDraft(document.sheets[sheetId].title);
                }}
                title="双击重命名画布"
              >
                {document.sheets[sheetId].title || '未命名 Sheet'}
              </button>
            ))}
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              onClick={createSheet}
              disabled={readOnly}
              aria-label="新增画布"
              title="新增画布"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-35"
              onClick={deleteActiveSheet}
              disabled={readOnly || sheetIds.length <= 1}
              aria-label="删除当前画布"
              title="删除当前画布"
            >
              <Trash2 size={13} />
            </button>
          </div>
          {workspaceChromeVisible ? <div
            className="hidden min-w-0 items-center gap-1 border-l border-slate-200 pl-2 xl:flex"
            aria-label="布局结构"
          >
            <select
              className="nodrag max-w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm outline-none focus:border-blue-400 disabled:opacity-45"
              aria-label="导图结构"
              title="导图结构"
              value={activeSheet.defaultBranchLayout.structure}
              disabled={readOnly}
              onChange={(event) => changeLayoutStructure(
                event.target.value as SupportedCoreLayoutStructure,
              )}
            >
              {!layoutCapability ? (
                <option value={activeSheet.defaultBranchLayout.structure}>
                  扩展结构
                </option>
              ) : null}
              {SUPPORTED_CORE_LAYOUT_STRUCTURES.map((structure) => (
                <option key={structure} value={structure}>
                  {STRUCTURE_LABELS[structure]}
                </option>
              ))}
            </select>
            {layoutCapability ? (
              <select
                className="nodrag max-w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm outline-none focus:border-blue-400 disabled:opacity-45"
                aria-label="布局方向"
                title="布局方向"
                value={activeSheet.defaultBranchLayout.direction}
                disabled={readOnly}
                onChange={(event) => changeLayoutDirection(
                  event.target.value as ResolvedLayoutDirection,
                )}
              >
                {layoutCapability.allowedDirections.map((direction) => (
                  <option key={direction} value={direction}>
                    {DIRECTION_LABELS[direction]}
                  </option>
                ))}
              </select>
            ) : null}
            {layoutCapability && layoutCapability.variantIds.length > 1 ? (
              <select
                className="nodrag max-w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm outline-none focus:border-blue-400 disabled:opacity-45"
                aria-label="结构变体"
                title="结构变体"
                value={activeSheet.defaultBranchLayout.variantId ?? layoutCapability.variantIds[0]}
                disabled={readOnly}
                onChange={(event) => changeLayoutVariant(event.target.value)}
              >
                {layoutCapability.variantIds.map((variantId) => (
                  <option key={variantId} value={variantId}>
                    {VARIANT_LABELS[variantId] ?? variantId}
                  </option>
                ))}
              </select>
            ) : null}
          </div> : null}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
            <div
              className={`flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain pr-1 [&>button]:shrink-0 ${
                workspaceChromeVisible ? '' : '[&>[data-fullscreen-only=true]]:hidden'
              }`}
              data-testid="mindmap-v2-action-strip"
            >
            <input
              ref={localImageInputRef}
              type="file"
              accept={LOCAL_IMAGE_ACCEPT}
              className="hidden"
              aria-label="选择本地图片"
              data-testid="mindmap-local-image-input"
              disabled={readOnly || localImageBusy}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                const targetTopicId = localImageTargetTopicRef.current
                  ?? (isTopicSelection(currentSelection)
                    && activeSheet?.topics[currentSelection.id]
                    ? currentSelection.id
                    : activeSheet?.rootTopicId);
                localImageTargetTopicRef.current = null;
                if (!targetTopicId) {
                  setStatus('当前画布没有可添加图片的主题。');
                  return;
                }
                void ingestLocalImage(targetTopicId, files);
              }}
            />
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => addChild()}
              disabled={readOnly}
              title="新增子主题 (Tab)"
            >
              <Plus size={14} className="mr-1 inline" />子主题
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => {
                const targetTopicId = isTopicSelection(currentSelection)
                  && activeSheet?.topics[currentSelection.id]
                  ? currentSelection.id
                  : activeSheet?.rootTopicId;
                if (!targetTopicId) {
                  setStatus('当前画布没有可添加图片的主题。');
                  return;
                }
                localImageTargetTopicRef.current = targetTopicId;
                currentSelectionRef.current = { kind: 'topic', id: targetTopicId };
                setSelection({ kind: 'topic', id: targetTopicId });
                localImageInputRef.current?.click();
              }}
              disabled={readOnly || localImageBusy || !activeSheet}
              title="插入本地图片"
              aria-label="插入本地图片"
              data-testid="mindmap-insert-local-image"
              data-local-image-busy={localImageBusy ? 'true' : 'false'}
            >
              <ImagePlus size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                activeSheet?.defaultBranchLayout.structure === 'core:tree-table'
                  ? 'border-blue-300 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => changeLayoutStructure(
                activeSheet?.defaultBranchLayout.structure === 'core:tree-table'
                  ? 'core:mind-map'
                  : 'core:tree-table',
              )}
              disabled={readOnly || !activeSheet}
              title={activeSheet?.defaultBranchLayout.structure === 'core:tree-table'
                ? '切换为思维导图'
                : '转换为树形表格'}
              aria-label={activeSheet?.defaultBranchLayout.structure === 'core:tree-table'
                ? '切换为思维导图'
                : '转换为树形表格'}
              data-testid="mindmap-toggle-tree-table"
            >
              <Table2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                stickerCatalogOpen
                  ? 'border-amber-300 text-amber-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => {
                setStickerCatalogOpen((open) => {
                  if (!open) {
                    setImportExportOpen(false);
                    setMarkerLegendPanelOpen(false);
                    setTopicEnrichmentPanel(null);
                  }
                  return !open;
                });
              }}
              disabled={readOnly || stickerBusy}
              title="贴纸与插画"
              aria-label="打开贴纸与插画"
              aria-expanded={stickerCatalogOpen}
              data-testid="mindmap-open-sticker-catalog"
            >
              <Sparkles size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm ${
                markerLegendPanelOpen
                  ? 'border-orange-300 text-orange-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => {
                setMarkerLegendPanelOpen((open) => {
                  if (!open) {
                    setImportExportOpen(false);
                    setStickerCatalogOpen(false);
                    setTopicEnrichmentPanel(null);
                  }
                  return !open;
                });
              }}
              title="标记与图例"
              aria-label="打开标记与图例"
              aria-expanded={markerLegendPanelOpen}
            >
              <Flag size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:opacity-40 ${
                topicEnrichmentPanel?.section === 'labels'
                  ? 'border-violet-300 text-violet-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => openSelectedTopicEnrichment('labels')}
              disabled={!isTopicSelection(currentSelection)}
              title="标签"
              aria-label="打开主题标签"
              aria-expanded={topicEnrichmentPanel?.section === 'labels'}
            >
              <Tags size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:opacity-40 ${
                topicEnrichmentPanel?.section === 'note'
                  ? 'border-blue-300 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => openSelectedTopicEnrichment('note')}
              disabled={!isTopicSelection(currentSelection)}
              title="笔记"
              aria-label="打开主题笔记"
              aria-expanded={topicEnrichmentPanel?.section === 'note'}
            >
              <NotebookPen size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:opacity-40 ${
                topicEnrichmentPanel?.section === 'links'
                  ? 'border-blue-300 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => openSelectedTopicEnrichment('links', true)}
              disabled={!isTopicSelection(currentSelection)}
              title="链接 (Ctrl/Cmd+K)"
              aria-label="打开主题链接"
              aria-expanded={topicEnrichmentPanel?.section === 'links'}
            >
              <Link2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:opacity-40 ${
                topicEnrichmentPanel?.section === 'todo'
                  ? 'border-emerald-300 text-emerald-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => openSelectedTopicEnrichment('todo')}
              disabled={!isTopicSelection(currentSelection)}
              title="待办"
              aria-label="打开主题待办"
              aria-expanded={topicEnrichmentPanel?.section === 'todo'}
            >
              <ListTodo size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm disabled:opacity-40 ${
                topicEnrichmentPanel?.section === 'task'
                  ? 'border-indigo-300 text-indigo-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => openSelectedTopicEnrichment('task')}
              disabled={!isTopicSelection(currentSelection)}
              title="任务"
              aria-label="打开主题任务"
              aria-expanded={topicEnrichmentPanel?.section === 'task'}
            >
              <ClipboardList size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={() => isTopicSelection(currentSelection) && toggleCollapse(currentSelection.id)}
              disabled={readOnly || !isTopicSelection(currentSelection)}
              title="折叠/展开"
              aria-label="折叠或展开选中主题"
            >
              <ChevronDown size={15} />
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={undo}
              disabled={readOnly || !store.canUndo}
              title="撤销 (Ctrl/Cmd+Z)"
              aria-label="撤销"
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={redo}
              disabled={readOnly || !store.canRedo}
              title="重做 (Ctrl/Cmd+Y)"
              aria-label="重做"
            >
              <Redo2 size={15} />
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50"
              onClick={() => {
                if (workspaceChromeVisible) {
                  searchPanelRef.current?.focusSearch();
                  return;
                }
                setFullScreen(true);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  searchPanelRef.current?.focusSearch();
                }));
              }}
              title="搜索与大纲 (Ctrl/Cmd+F)"
              aria-label="打开搜索与大纲"
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              data-fullscreen-only="true"
              className={`rounded-md border bg-white p-1.5 shadow-sm ${
                importExportOpen
                  ? 'border-blue-300 text-blue-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => {
                setImportExportOpen((value) => !value);
                setTopicEnrichmentPanel(null);
                setMarkerLegendPanelOpen(false);
                setStickerCatalogOpen(false);
              }}
              title="导入与导出"
              aria-label="打开导入与导出"
              aria-expanded={importExportOpen}
            >
              <FileInput size={15} />
            </button>
            </div>
            <div
              className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-1"
              data-testid="mindmap-v2-viewport-actions"
            >
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50"
              onClick={() => fitProjection()}
              title="适配画布"
              aria-label="适配画布"
            >
              <Focus size={15} />
            </button>
            <button
              ref={fullScreenButtonRef}
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:bg-slate-50"
              onClick={() => setFullScreen((value) => !value)}
              title={fullScreen ? '退出全屏' : '全屏'}
              aria-label={fullScreen ? '退出全屏' : '全屏'}
              data-testid={fullScreen
                ? 'mindmap-v2-exit-fullscreen'
                : 'mindmap-v2-enter-fullscreen'}
            >
              {fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            </div>
          </div>
        </header>

        {store.parseResult.ok && store.parseResult.sourceFormat === 'legacy-v0' && (
          <div className="absolute left-3 top-14 z-20 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 shadow-sm">
            已只读迁移 legacy payload；首次内容修改将仅写回 canonical V1。
          </div>
        )}
        {readOnly && (
          <div className="absolute right-3 top-14 z-20 rounded-full bg-slate-900/75 px-2.5 py-1 text-[11px] font-medium text-white">
            只读模式
          </div>
        )}

        <div
          ref={flowViewportRef}
          className="absolute inset-x-0 bottom-0 top-12"
          data-testid="mindmap-v2-flow-viewport"
        >
          <ReactFlow
            key={activeSheetId}
            nodes={interactiveNodes}
            edges={[...flowProjection.treeEdges]}
            nodeTypes={NODE_TYPES}
            nodesDraggable={!readOnly}
            nodesConnectable={false}
            elementsSelectable
            minZoom={MIN_CANVAS_ZOOM}
            maxZoom={MAX_CANVAS_ZOOM}
            panOnScroll
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            defaultViewport={localViewport}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
              const viewport = instance.getViewport();
              setLiveZoom(viewport.zoom);
              setLiveViewport(viewport);
              if (!localViewport) requestAnimationFrame(() => fitProjection(0));
            }}
            onNodeClick={(event, flowNode) => selectTopic(flowNode.id as TopicId, {
              toggle: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            })}
            onNodeDoubleClick={(_event, flowNode) => beginEdit(flowNode.id as TopicId)}
            onNodeContextMenu={(event, flowNode) => {
              event.preventDefault();
              event.stopPropagation();
              const target = { kind: 'topic' as const, id: flowNode.id as TopicId };
              const alreadySelected = currentSelections.some((reference) =>
                reference.kind === 'topic' && reference.id === target.id);
              if (!alreadySelected) setSelection(target);
              setContextMenu({
                anchor: { clientX: event.clientX, clientY: event.clientY },
                target,
              });
            }}
            onNodesChange={(changes) => {
              setInteractiveNodes((previous) => applyNodeChanges(changes, previous));
            }}
            onNodeDragStart={(_event, flowNode) => {
              draggingTopicRef.current = flowNode.id as TopicId;
              selectTopic(flowNode.id as TopicId);
              setStatus('拖到主题上可换父级；拖到同级间隙可重排。');
            }}
            onNodeDragStop={(_event, flowNode) => finishTopicDrag(flowNode)}
            onPaneClick={() => {
              setContextMenu(null);
              setSelection(null);
              setEditingTopicId(null);
              focusCanvas();
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelection(null);
              setEditingTopicId(null);
              setContextMenu({
                anchor: { clientX: event.clientX, clientY: event.clientY },
                target: null,
              });
            }}
            onMoveEnd={(_event, viewport) => {
              setLiveZoom(viewport.zoom);
              setLiveViewport(viewport);
              setSheetViews((previous) => ({
                ...previous,
                [activeSheetId]: {
                  ...(previous[activeSheetId] ?? { selection: [] }),
                  viewport,
                },
              }));
            }}
            onMove={(_event, viewport) => {
              setLiveZoom(viewport.zoom);
              setLiveViewport(viewport);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#CBD5E1" gap={22} size={1} />
          </ReactFlow>
          <SemanticOverlaySvg
            geometry={flowProjection.semanticGeometry}
            currentSelection={currentSelection}
            boundaryRangeAdjustableIds={boundaryRangeAdjustableIds}
            boundaryRangeHandleSpecs={boundaryRangeHandleSpecs}
            summaryRangeAdjustableIds={summaryRangeAdjustableIds}
            summaryRangeHandleSpecs={summaryRangeHandleSpecs}
            labels={semanticOverlayLabels}
            readOnly={readOnly}
            styles={flowProjection.semanticStyles}
            onBoundaryFrameResize={resizeBoundaryFrameFromOverlay}
            onBoundaryRangeDrag={adjustBoundaryRangeFromOverlay}
            onSummaryRangeDrag={adjustSummaryRangeFromOverlay}
            onSelect={selectSemanticOverlay}
            onDelete={(selection) => {
              if (isDeletableSemanticElementRef(selection)) deleteSemanticElement(selection);
            }}
            onContextMenu={(selection, eventInfo) => {
              setSelection(selection);
              setEditingTopicId(null);
              setContextMenu({
                anchor: {
                  clientX: eventInfo.clientX,
                  clientY: eventInfo.clientY,
                },
                target: selection,
              });
            }}
          />
          <MarkerLegendCanvas
            document={document}
            sheetId={activeSheetId}
            readOnly={readOnly}
            viewport={liveViewport}
            onMove={readOnly ? undefined : moveMarkerLegend}
          />
          {workspaceChromeVisible
          && !importExportOpen
          && !markerLegendPanelOpen
          && !stickerCatalogOpen
          && !topicEnrichmentPanel
          && !isSemanticPropertiesElementRef(currentSelection) ? (
            <FormatPanel
              key={`format-panel:${formatPanelVersion}`}
              selection={formatSelection}
              readOnly={readOnly}
              defaultExpanded={formatPanelVersion > 0}
              onApply={applyFormatOverrides}
              onReset={resetFormatOverrides}
              onExpandedChange={setFormatPanelExpanded}
            />
          ) : null}
          {workspaceChromeVisible && focusedBranchContext ? (
            <nav
              className="nowheel nodrag absolute left-1/2 top-3 z-30 flex max-w-[min(70%,720px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-blue-200 bg-white/95 px-2 py-1 text-[11px] text-slate-600 shadow-lg backdrop-blur"
              aria-label="聚焦分支路径"
              data-testid="mindmap-branch-breadcrumb"
            >
              {[...focusedBranchContext.ancestorTopicIds, focusedBranchContext.rootTopicId]
                .map((topicId, index, path) => (
                  <span key={topicId} className="flex shrink-0 items-center gap-1">
                    {index > 0 ? <span aria-hidden="true">/</span> : null}
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 hover:bg-blue-50 ${
                        topicId === focusedBranchContext.rootTopicId
                          ? 'font-semibold text-blue-700'
                          : 'text-slate-600'
                      }`}
                      aria-current={index === path.length - 1 ? 'page' : undefined}
                      onClick={() => enterFocusedBranch(topicId)}
                    >
                      {richTextToPlainText(activeSheet.topics[topicId]?.title) || '未命名主题'}
                    </button>
                  </span>
                ))}
            </nav>
          ) : null}
          {workspaceChromeVisible ? <CanvasNavigationControls
            zoom={liveZoom}
            safeArea={{
              top: 16,
              right: canvasSafeArea.right,
              bottom: 16,
              left: canvasSafeArea.left,
            }}
            isBranchFocused={Boolean(focusedBranchRootId)}
            canFocusBranch={isTopicSelection(currentSelection)
              && currentSelection.id !== activeSheet.rootTopicId}
            focusedBranchLabel={focusedBranchRootId
              ? richTextToPlainText(activeSheet.topics[focusedBranchRootId]?.title)
              : undefined}
            onZoomChange={zoomCanvasTo}
            onResetZoom={resetCanvasZoom}
            onFitView={() => fitProjection()}
            onFocusBranch={focusSelectedBranch}
            onExitFocusBranch={leaveFocusedBranch}
          /> : null}
        </div>

        {workspaceChromeVisible ? <SearchOutlinerPanel
          ref={searchPanelRef}
          document={document}
          activeSheetId={activeSheetId}
          branchRootTopicId={isTopicSelection(currentSelection)
            ? currentSelection.id
            : activeSheet.rootTopicId}
          selectedTopic={isTopicSelection(currentSelection)
            ? { sheetId: activeSheetId, topicId: currentSelection.id }
            : undefined}
          readOnly={readOnly}
          defaultCollapsed
          onCollapsedChange={setSearchPanelCollapsed}
          onFilterChange={setSearchFilter}
          onSelect={selectFromNavigator}
          onUpdateTopicTitle={applyOutlinerMutation}
          onReparentTopic={applyOutlinerMutation}
          onReorderTopic={applyOutlinerMutation}
        /> : null}

        {workspaceChromeVisible && importExportOpen ? (
          <ImportExportPanel
            document={document}
            activeSheetId={activeSheetId}
            branchRootTopicId={isTopicSelection(currentSelection)
              ? currentSelection.id
              : effectiveSheetView.focusedBranchRootId}
            readOnly={readOnly}
            xmindResourceBytes={xmindResourceSession.exportResourceBytes}
            defaultExpanded
            className="absolute right-3 top-14 z-40 max-h-[calc(100%-4.25rem)]"
            onImportResult={receiveImportResult}
            onDownload={({ fileName, report }) => setStatus(report
              ? `已导出 ${fileName}；降级 ${report.degradedItems} 项，保留属性 ${report.preservedAttributes} 项。`
              : `已导出 ${fileName}。`)}
          />
        ) : null}

        {workspaceChromeVisible
        && stickerCatalogOpen
        && !importExportOpen
        && !markerLegendPanelOpen
        && !topicEnrichmentPanel ? (
          <StickerCatalogPanel
            busy={stickerBusy}
            readOnly={readOnly}
            onClose={() => setStickerCatalogOpen(false)}
            onInsert={(stickerId) => {
              if (!isTopicSelection(currentSelection)) {
                setStatus('请先选择一个主题，或把贴纸拖到目标主题。');
                return;
              }
              void ingestBuiltInSticker(currentSelection.id, stickerId);
            }}
          />
        ) : null}

        {workspaceChromeVisible && markerLegendPanelOpen && !importExportOpen && !stickerCatalogOpen ? (
          <div className="absolute bottom-3 right-3 top-16 z-40 flex items-start overflow-hidden">
            <MarkerLegendPanel
              document={document}
              sheetId={activeSheetId}
              {...(isTopicSelection(currentSelection) ? { topicId: currentSelection.id } : {})}
              readOnly={readOnly}
              onCommand={dispatchMarkerLegendCommand}
              onClose={() => setMarkerLegendPanelOpen(false)}
            />
          </div>
        ) : null}

        {workspaceChromeVisible
        && topicEnrichmentPanel
        && !importExportOpen
        && !markerLegendPanelOpen
        && !stickerCatalogOpen
        && isTopicSelection(currentSelection) ? (
          <div className="absolute bottom-3 right-3 top-16 z-40 flex items-start overflow-hidden">
            <TopicEnrichmentPanel
              document={document}
              sheetId={activeSheetId}
              topicId={currentSelection.id}
              selectedTopicIds={selectedTopicIdList}
              section={topicEnrichmentPanel.section}
              focusLinkRequest={topicEnrichmentPanel.focusLinkRequest}
              readOnly={readOnly}
              onSectionChange={(section) => setTopicEnrichmentPanel((previous) => ({
                section,
                focusLinkRequest: previous?.focusLinkRequest ?? 0,
              }))}
              onCommand={dispatchTopicEnrichmentCommand}
              onNavigate={(sheetId, topicId) => selectFromNavigator(
                { kind: 'topic', id: topicId },
                sheetId,
              )}
              onClose={() => setTopicEnrichmentPanel(null)}
            />
          </div>
        ) : null}

        {workspaceChromeVisible && pendingImport?.result.document ? (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mindmap-import-confirm-title"
            aria-busy={importApplyBusy}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <h2 id="mindmap-import-confirm-title" className="text-base font-semibold text-slate-900">
                应用导入结果？
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                将用 <strong>{pendingImport.source.fileName}</strong> 替换当前脑图；这是一次可撤销操作。
              </p>
              {importApplyBusy ? (
                <p className="mt-2 text-xs text-blue-700" role="status">
                  正在校验并上传 XMind 图片资源；完成前不会修改当前脑图…
                </p>
              ) : null}
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">Sheet</dt>
                  <dd className="font-semibold text-slate-800">
                    {pendingImport.result.report.importedSheets}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">主题</dt>
                  <dd className="font-semibold text-slate-800">
                    {pendingImport.result.report.importedTopics}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-[10px] text-slate-500">降级/忽略</dt>
                  <dd className="font-semibold text-slate-800">
                    {pendingImport.result.report.degradedItems + pendingImport.result.report.ignoredItems}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={cancelPendingImport}
                >
                  {importApplyBusy ? '取消应用' : '取消'}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  disabled={readOnly || importApplyBusy}
                  onClick={() => void applyPendingImport()}
                >
                  {importApplyBusy ? '正在应用…' : '应用导入'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <MindMapContextMenu
          open={contextMenu !== null}
          anchor={contextMenu?.anchor ?? { clientX: 0, clientY: 0 }}
          target={contextMenu?.target ?? null}
          selectionCount={currentSelections.length}
          readOnly={readOnly}
          collapsed={contextMenu?.target?.kind === 'topic'
            ? Boolean(activeSheet.topics[contextMenu.target.id]?.defaultCollapsed)
            : false}
          capabilities={{
            editTitle: contextMenu?.target?.kind === 'topic',
            addChildTopic: contextMenu?.target?.kind === 'topic',
            addNextSiblingTopic: contextMenu?.target?.kind === 'topic'
              && contextMenu.target.id !== activeSheet.rootTopicId,
            addPreviousSiblingTopic: contextMenu?.target?.kind === 'topic'
              && contextMenu.target.id !== activeSheet.rootTopicId,
            insertParentTopic: contextMenu?.target?.kind === 'topic'
              && activeSheet.topics[contextMenu.target.id]?.role === 'regular',
            copy: contextMenu?.target?.kind === 'topic',
            cut: contextMenu?.target?.kind === 'topic'
              && contextMenu.target.id !== activeSheet.rootTopicId,
            paste: Boolean(globalThis.navigator.clipboard)
              && (contextMenu?.target === null || contextMenu?.target?.kind === 'topic'),
            deleteElement: isDeletableSemanticElementRef(contextMenu?.target ?? null),
            deleteBranch: contextMenu?.target?.kind === 'topic'
              && contextMenu.target.id !== activeSheet.rootTopicId,
            deleteCurrentTopic: contextMenu?.target?.kind === 'topic'
              && activeSheet.topics[contextMenu.target.id]?.role === 'regular',
            toggleCollapse: contextMenu?.target?.kind === 'topic'
              && Object.values(activeSheet.treeEdges).some(
                (edge) => edge.parentTopicId === contextMenu.target?.id,
              ),
            createRelationship: selectedTopicIdList.length === 2,
            createBoundary: boundaryCreationPreview.eligible,
            createSummary: summaryCreationPreview.eligible,
            createCallout: selectedTopicIdList.length === 1,
            openFormat: contextMenu?.target !== null,
          }}
          onEditTitle={({ target }) => {
            if (target?.kind === 'topic') beginEdit(target.id);
          }}
          onAddChildTopic={({ target }) => {
            if (target?.kind === 'topic') addChild(target.id);
          }}
          onAddNextSiblingTopic={({ target }) => {
            if (target?.kind === 'topic') addSibling(target.id, 'after');
          }}
          onAddPreviousSiblingTopic={({ target }) => {
            if (target?.kind === 'topic') addSibling(target.id, 'before');
          }}
          onInsertParentTopic={({ target }) => {
            if (target?.kind === 'topic') insertParentTopic(target.id);
          }}
          onCopy={() => invokeSystemClipboardCommand('copy')}
          onCut={() => invokeSystemClipboardCommand('cut')}
          onPaste={({ target }) => void pasteFromSystemClipboard(
            target?.kind === 'topic' ? target.id : undefined,
          )}
          onDeleteElement={({ target }) => {
            if (isDeletableSemanticElementRef(target)) deleteSemanticElement(target);
          }}
          onDeleteBranch={deleteSelection}
          onDeleteCurrentTopic={({ target }) => {
            if (target?.kind === 'topic') deleteCurrentTopic(target.id);
          }}
          onToggleCollapse={({ target }) => {
            if (target?.kind === 'topic') toggleCollapse(target.id);
          }}
          onCreateRelationship={() => createSemanticElement('relationship')}
          onCreateBoundary={() => createSemanticElement('boundary')}
          onCreateSummary={() => createSemanticElement('summary')}
          onCreateCallout={() => createSemanticElement('callout')}
          onOpenFormat={() => setFormatPanelVersion((value) => value + 1)}
          onClose={() => setContextMenu(null)}
        />

        {workspaceChromeVisible && !importExportOpen && !topicEnrichmentPanel ? (
          isSemanticPropertiesElementRef(currentSelection) ? (
            <div className="absolute bottom-3 right-3 top-16 z-40 flex items-end overflow-hidden">
              <SemanticPropertiesPanel
                document={document}
                sheetId={activeSheetId}
                selection={currentSelection}
                readOnly={readOnly}
                onCommand={dispatchSemanticPropertiesCommand}
                onClose={() => setSelection(null)}
              />
            </div>
          ) : !formatPanelExpanded ? (
            <SemanticElementPanel
              overlays={flowProjection.overlays}
              currentSelection={currentSelection}
              topicSelectionCount={selectedTopicIdList.length}
              boundaryPreview={boundaryCreationPreview}
              summaryPreview={summaryCreationPreview}
              readOnly={readOnly}
              onCreate={createSemanticElement}
              onSelect={setSelection}
              onDelete={deleteSemanticElement}
            />
          ) : null
        ) : null}

        {workspaceChromeVisible || status ? <footer className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-[10px] text-slate-500 shadow-sm">
          {status
            ? (
                <span
                  role="status"
                  data-testid="mindmap-status"
                  className="text-red-600"
                >
                  {status}
                </span>
              )
            : readOnly
              ? '可选择、平移和缩放；内容修改已禁用'
              : `Tab 子主题 · Enter 同级 · Space/F2 编辑 · Delete 删除${isRootSelected ? '（中心主题不可删）' : ''}`}
        </footer> : null}
      </div>
  );

  const presentation = (
    <section
      className={presentationClassName}
      data-testid={fullScreen
        ? 'mindmap-v2-fullscreen-layer'
        : 'mindmap-v2-embedded-preview'}
      data-mindmap-presentation={fullScreen ? 'fullscreen' : 'embedded'}
      data-mindmap-chrome={fullScreen ? 'compact' : 'preview'}
      role={fullScreen ? 'dialog' : undefined}
      aria-modal={fullScreen ? true : undefined}
      aria-label={fullScreen ? '思维导图全屏工作区' : undefined}
    >
      {canvas}
    </section>
  );
  const portalHost = typeof globalThis.document === 'undefined'
    ? null
    : globalThis.document.body;

  return (
    <TopicNodeActionsContext.Provider value={topicActions}>
      {fullScreen && portalHost ? (
        <>
          <div
            className={`${EMBEDDED_PRESENTATION_HEIGHT_CLASS} w-full`}
            data-testid="mindmap-v2-fullscreen-placeholder"
            aria-hidden="true"
          />
          {createPortal(presentation, portalHost)}
        </>
      ) : presentation}
    </TopicNodeActionsContext.Provider>
  );
};

/** Canonical React NodeView. It is structurally compatible with ReactNodeViewRenderer. */
export const MindMapV2NodeView = (props: MindMapV2NodeViewProps) => (
  <NodeViewWrapper
    className="mind-map-v2-wrapper my-6"
    contentEditable={false}
    id={props.node.attrs.blockId ? `block-${String(props.node.attrs.blockId)}` : undefined}
    data-block-id={props.node.attrs.blockId || undefined}
    data-type="mind-map"
    data-mindmap-version="2"
  >
    <ReactFlowProvider>
      <MindMapV2Canvas {...props} />
    </ReactFlowProvider>
  </NodeViewWrapper>
);
