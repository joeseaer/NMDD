import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { ImageId, Size } from '../domain/types';
import type { ImageEnrichmentProjection } from './enrichmentProjection';
import { isOrdinaryStackedTopicImage } from './projection';

export type TopicImagesSide = 'top' | 'bottom' | 'left' | 'right';
export type TopicImagesKind = 'ordinary' | 'sticker';

/** Dedicated channel; intentionally distinct from Files and topic-structure drag. */
export const TOPIC_IMAGE_DRAG_MIME = 'application/x-nmdd-mindmap-topic-image';

export interface TopicImagesProps {
  readonly images: readonly ImageEnrichmentProjection[];
  readonly side: TopicImagesSide;
  readonly kind?: TopicImagesKind;
  readonly selectedImageId?: ImageId;
  readonly readOnly?: boolean;
  readonly onSelect?: (imageId: ImageId) => void;
  readonly onMove?: (imageId: ImageId, side: TopicImagesSide) => void;
  readonly onResizeCommit?: (imageId: ImageId, size: Size) => void;
  readonly onResetSize?: (imageId: ImageId) => void;
  readonly onDelete?: (imageId: ImageId) => void;
  readonly className?: string;
}

const MIN_RESIZE_EDGE = 24;
const MAX_RESIZE_EDGE = 2_048;

const imageLabel = (image: Readonly<ImageEnrichmentProjection>): string =>
  image.alt?.trim() || image.fileName.trim() || (image.role === 'sticker' ? '主题贴纸' : '主题图片');

const imageKindLabel = (image: Readonly<ImageEnrichmentProjection>): '图片' | '贴纸' =>
  image.role === 'sticker' ? '贴纸' : '图片';

const SIDE_LABELS: Readonly<Record<TopicImagesSide, string>> = {
  top: '上方',
  bottom: '下方',
  left: '左侧',
  right: '右侧',
};

const stopPointerPropagation = (event: PointerEvent<HTMLElement>): void => {
  event.stopPropagation();
};

const stopMousePropagation = (event: MouseEvent<HTMLElement>): void => {
  event.stopPropagation();
};

const finitePositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/** Projects pointer movement onto the original diagonal and preserves ratio. */
export const proportionalImageResize = (
  start: Readonly<Size>,
  deltaX: number,
  deltaY: number,
): Size => {
  const width = finitePositive(start.width, MIN_RESIZE_EDGE);
  const height = finitePositive(start.height, MIN_RESIZE_EDGE);
  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
  const denominator = width * width + height * height;
  const projectedScale = denominator > 0
    ? 1 + (safeDeltaX * width + safeDeltaY * height) / denominator
    : 1;
  const minimumScale = Math.max(MIN_RESIZE_EDGE / width, MIN_RESIZE_EDGE / height);
  const maximumScale = Math.min(MAX_RESIZE_EDGE / width, MAX_RESIZE_EDGE / height);
  const scale = Math.min(
    Math.max(finitePositive(projectedScale, minimumScale), minimumScale),
    Math.max(minimumScale, maximumScale),
  );
  return {
    width: Math.max(MIN_RESIZE_EDGE, Math.round(width * scale)),
    height: Math.max(MIN_RESIZE_EDGE, Math.round(height * scale)),
  };
};

interface ResizeSession {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly startSize: Size;
  readonly scaleX: number;
  readonly scaleY: number;
}

interface TopicImageItemProps {
  readonly image: ImageEnrichmentProjection;
  readonly selected: boolean;
  readonly readOnly: boolean;
  readonly onSelect?: (imageId: ImageId) => void;
  readonly onMove?: (imageId: ImageId, side: TopicImagesSide) => void;
  readonly onResizeCommit?: (imageId: ImageId, size: Size) => void;
  readonly onResetSize?: (imageId: ImageId) => void;
  readonly onDelete?: (imageId: ImageId) => void;
  readonly onOpenContextMenu: (
    imageId: ImageId,
    clientX: number,
    clientY: number,
  ) => void;
}

const TopicImageItem = ({
  image,
  selected,
  readOnly,
  onSelect,
  onMove,
  onResizeCommit,
  onResetSize,
  onDelete,
  onOpenContextMenu,
}: TopicImageItemProps) => {
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewSize, setPreviewSize] = useState<Size>();
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const label = imageLabel(image);
  const kindLabel = imageKindLabel(image);
  const renderedSize = previewSize ?? image.displaySize;
  const unavailableReason = image.rendererSource.status === 'unavailable'
    ? image.rendererSource.reason
    : loadFailed
      ? 'load-failed'
      : undefined;
  const select = (): void => onSelect?.(image.id);

  useEffect(() => {
    setLoadFailed(false);
  }, [image.rendererSource]);

  useEffect(() => {
    setPreviewSize(undefined);
    resizeSessionRef.current = null;
  }, [image.displaySize.height, image.displaySize.width, selected]);

  const deleteImage = (): void => {
    if (!readOnly) onDelete?.(image.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (
      selected
      && !readOnly
      && (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      event.preventDefault();
      deleteImage();
    }
  };

  const beginResize = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || !onResizeCommit) return;
    select();
    const frameRect = event.currentTarget.parentElement?.getBoundingClientRect();
    const scaleX = frameRect && frameRect.width > 0
      ? frameRect.width / image.displaySize.width
      : 1;
    const scaleY = frameRect && frameRect.height > 0
      ? frameRect.height / image.displaySize.height
      : 1;
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startSize: { ...image.displaySize },
      scaleX: finitePositive(scaleX, 1),
      scaleY: finitePositive(scaleY, 1),
    };
    setPreviewSize({ ...image.displaySize });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in jsdom and older engines.
    }
  };

  const previewResize = (event: PointerEvent<HTMLButtonElement>): Size | undefined => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return undefined;
    event.preventDefault();
    event.stopPropagation();
    const nextSize = proportionalImageResize(
      session.startSize,
      (event.clientX - session.originX) / session.scaleX,
      (event.clientY - session.originY) / session.scaleY,
    );
    setPreviewSize(nextSize);
    return nextSize;
  };

  const commitResize = (event: PointerEvent<HTMLButtonElement>): void => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const nextSize = previewResize(event) ?? session.startSize;
    resizeSessionRef.current = null;
    setPreviewSize(nextSize);
    if (
      nextSize.width !== Math.round(session.startSize.width)
      || nextSize.height !== Math.round(session.startSize.height)
    ) {
      onResizeCommit?.(image.id, nextSize);
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released or unsupported.
    }
  };

  const cancelResize = (event: PointerEvent<HTMLButtonElement>): void => {
    if (resizeSessionRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current = null;
    setPreviewSize(undefined);
  };

  return (
    <div
      className="nodrag nopan relative box-border inline-flex shrink-0 items-center justify-center"
      style={{
        width: renderedSize.width,
        height: renderedSize.height,
        alignSelf: image.placement.align === 'start'
          ? 'flex-start'
          : image.placement.align === 'end'
            ? 'flex-end'
            : 'center',
        transform: `translate(${image.placement.offset.x}px, ${image.placement.offset.y}px)`,
      }}
      data-testid={`topic-image-frame-${image.id}`}
      data-topic-image-preview-width={renderedSize.width}
      data-topic-image-preview-height={renderedSize.height}
    >
      <button
        type="button"
        draggable={!readOnly && Boolean(onMove)}
        className={`h-full w-full overflow-hidden rounded border bg-slate-50 p-0 text-slate-500 ${
          selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
        }`}
        data-testid={`topic-image-${image.id}`}
        data-topic-image-id={image.id}
        data-topic-image-role={image.role}
        data-topic-image-side={image.placement.side}
        data-topic-image-align={image.placement.align}
        data-topic-image-offset-x={image.placement.offset.x}
        data-topic-image-offset-y={image.placement.offset.y}
        data-topic-image-source={image.rendererSource.status}
        data-topic-image-size-source={image.displaySizeSource}
        data-topic-image-draggable={!readOnly && Boolean(onMove) ? 'true' : 'false'}
        aria-label={`选择${kindLabel}：${label}`}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          select();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          select();
          if (!readOnly) onOpenContextMenu(image.id, event.clientX, event.clientY);
        }}
        onDoubleClick={stopMousePropagation}
        onMouseDown={stopMousePropagation}
        onPointerDown={stopPointerPropagation}
        onPointerUp={stopPointerPropagation}
        onDragStart={(event: DragEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          if (readOnly || !onMove) {
            event.preventDefault();
            return;
          }
          select();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(TOPIC_IMAGE_DRAG_MIME, String(image.id));
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={onKeyDown}
      >
        {unavailableReason ? (
          <span
            role="img"
            aria-label={`${label}（${kindLabel}不可用）`}
            data-testid={`topic-image-unavailable-${image.id}`}
            data-unavailable-reason={unavailableReason}
            className="flex h-full w-full items-center justify-center px-2 text-center text-xs"
          >
            {kindLabel}不可用
          </span>
        ) : image.rendererSource.status === 'ready' ? (
          <img
            src={image.rendererSource.url}
            alt={label}
            width={renderedSize.width}
            height={renderedSize.height}
            draggable={false}
            data-testid={`topic-image-content-${image.id}`}
            className="pointer-events-none block h-full w-full object-contain"
            onError={() => setLoadFailed(true)}
          />
        ) : null}
      </button>

      {selected && !readOnly ? (
        <>
          <div
            className="nodrag nopan absolute -top-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 shadow-lg"
            data-testid={`topic-image-controls-${image.id}`}
            onPointerDown={stopPointerPropagation}
            onClick={stopMousePropagation}
          >
            {(image.role === 'sticker'
              ? (['top', 'bottom', 'left', 'right'] as const)
              : (['top', 'bottom'] as const)).map((side) => (
                <button
                  key={side}
                  type="button"
                  className="rounded px-1.5 py-1 text-[10px] text-slate-700 hover:bg-slate-100 disabled:opacity-35"
                  aria-label={`将${kindLabel}移到主题${SIDE_LABELS[side]}`}
                  disabled={image.placement.side === side}
                  onClick={() => onMove?.(image.id, side)}
                >
                  {SIDE_LABELS[side].slice(0, 1)}
                </button>
              ))}
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[10px] text-slate-700 hover:bg-slate-100"
              aria-label={`重置${kindLabel}尺寸`}
              onClick={() => onResetSize?.(image.id)}
            >
              重置
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[10px] text-red-600 hover:bg-red-50"
              aria-label={`删除${kindLabel}`}
              onClick={deleteImage}
            >
              删除
            </button>
          </div>
          <button
            type="button"
            className="nodrag nopan absolute -bottom-2 -right-2 z-50 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-blue-600 shadow"
            aria-label={`按比例调整${kindLabel}大小`}
            data-testid={`topic-image-resize-handle-${image.id}`}
            onPointerDown={beginResize}
            onPointerMove={(event) => {
              previewResize(event);
            }}
            onPointerUp={commitResize}
            onPointerCancel={cancelResize}
            onLostPointerCapture={(event) => {
              if (resizeSessionRef.current?.pointerId !== event.pointerId) return;
              resizeSessionRef.current = null;
              setPreviewSize(undefined);
            }}
          />
        </>
      ) : null}
    </div>
  );
};

/** Renders one ordinary top/bottom image stack plus local-only edit affordances. */
export const TopicImages = ({
  images,
  side,
  kind = 'ordinary',
  selectedImageId,
  readOnly = false,
  onSelect,
  onMove,
  onResizeCommit,
  onResetSize,
  onDelete,
  className,
}: TopicImagesProps) => {
  const [contextMenu, setContextMenu] = useState<{
    readonly imageId: ImageId;
    readonly clientX: number;
    readonly clientY: number;
  } | null>(null);
  const visibleImages = images.filter((image) => (
    kind === 'sticker'
      ? image.role === 'sticker'
        && image.placement.side !== 'overlay'
        && image.placement.side === side
      : isOrdinaryStackedTopicImage(image) && image.placement.side === side
  ));

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    globalThis.document.addEventListener('pointerdown', close);
    globalThis.document.addEventListener('keydown', onKeyDown);
    return () => {
      globalThis.document.removeEventListener('pointerdown', close);
      globalThis.document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (readOnly) setContextMenu(null);
  }, [readOnly]);

  if (visibleImages.length === 0) return null;

  return (
    <div
      className={`nodrag nopan flex ${side === 'left' || side === 'right'
        ? 'h-full w-auto flex-col justify-center'
        : 'w-full flex-col items-center'} gap-2 ${className ?? ''}`.trim()}
      data-testid={`${kind === 'sticker' ? 'topic-stickers' : 'topic-images'}-${side}`}
      data-topic-images-side={side}
      data-topic-images-kind={kind}
      onClick={stopMousePropagation}
      onDoubleClick={stopMousePropagation}
      onMouseDown={stopMousePropagation}
      onPointerDown={stopPointerPropagation}
      onPointerUp={stopPointerPropagation}
    >
      {visibleImages.map((image) => (
        <TopicImageItem
          key={`${image.id}:${image.rendererSource.status === 'ready'
            ? image.rendererSource.url
            : image.rendererSource.reason}`}
          image={image}
          selected={selectedImageId === image.id}
          readOnly={readOnly}
          onSelect={onSelect}
          onMove={onMove}
          onResizeCommit={onResizeCommit}
          onResetSize={onResetSize}
          onDelete={onDelete}
          onOpenContextMenu={(imageId, clientX, clientY) => {
            setContextMenu({ imageId, clientX, clientY });
          }}
        />
      ))}

      {contextMenu && !readOnly && typeof document !== 'undefined' ? createPortal((
        <div
          role="menu"
          aria-label={visibleImages.find((image) => image.id === contextMenu.imageId)?.role === 'sticker'
            ? '贴纸菜单'
            : '图片菜单'}
          data-testid="topic-image-context-menu"
          className="nodrag nopan fixed z-[10000] min-w-28 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(contextMenu.clientX, globalThis.innerWidth - 152)),
            top: Math.max(8, Math.min(contextMenu.clientY, globalThis.innerHeight - 88)),
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            onClick={() => {
              onResetSize?.(contextMenu.imageId);
              setContextMenu(null);
            }}
          >
            重置{visibleImages.find((image) => image.id === contextMenu.imageId)?.role === 'sticker'
              ? '贴纸'
              : '图片'}尺寸
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
            onClick={() => {
              onDelete?.(contextMenu.imageId);
              setContextMenu(null);
            }}
          >
            删除{visibleImages.find((image) => image.id === contextMenu.imageId)?.role === 'sticker'
              ? '贴纸'
              : '图片'}
          </button>
        </div>
      ), document.body) : null}
    </div>
  );
};
