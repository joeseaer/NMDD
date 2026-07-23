import {
  Focus,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  getRectOfNodes,
  type ReactFlowInstance,
  type Rect,
  type Viewport as ReactFlowViewport,
} from 'reactflow';

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 5;
export const CANVAS_ZOOM_STEP = 0.1;

export interface CanvasSafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface CanvasViewportSize {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_CANVAS_SAFE_AREA: Readonly<CanvasSafeArea> = Object.freeze({
  top: 16,
  right: 16,
  bottom: 16,
  // Keeps fitted nodes clear of the collapsed search/outliner rail.
  left: 48,
});

const finiteInset = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value! >= 0 ? value! : fallback;

export const resolveCanvasSafeArea = (
  safeArea?: Partial<CanvasSafeArea>,
): CanvasSafeArea => ({
  top: finiteInset(safeArea?.top, DEFAULT_CANVAS_SAFE_AREA.top),
  right: finiteInset(safeArea?.right, DEFAULT_CANVAS_SAFE_AREA.right),
  bottom: finiteInset(safeArea?.bottom, DEFAULT_CANVAS_SAFE_AREA.bottom),
  left: finiteInset(safeArea?.left, DEFAULT_CANVAS_SAFE_AREA.left),
});

export const clampCanvasZoom = (
  zoom: number,
  minZoom = MIN_CANVAS_ZOOM,
  maxZoom = MAX_CANVAS_ZOOM,
): number => {
  const minimum = Number.isFinite(minZoom) ? minZoom : MIN_CANVAS_ZOOM;
  const maximum = Number.isFinite(maxZoom) && maxZoom >= minimum ? maxZoom : MAX_CANVAS_ZOOM;
  const value = Number.isFinite(zoom) ? zoom : 1;
  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 1_000) / 1_000;
};

export const formatCanvasZoomPercentage = (zoom: number): string => {
  const percentage = Math.round(clampCanvasZoom(zoom) * 1_000) / 10;
  return `${percentage.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
};

export const parseCanvasZoomPercentage = (
  value: string,
  minZoom = MIN_CANVAS_ZOOM,
  maxZoom = MAX_CANVAS_ZOOM,
): number | null => {
  const normalized = value.trim().replace(/[%％]/g, '').replace(',', '.');
  if (normalized.length === 0) return null;
  const percentage = Number(normalized);
  if (!Number.isFinite(percentage)) return null;
  return clampCanvasZoom(percentage / 100, minZoom, maxZoom);
};

const finiteRect = (rect: Readonly<Rect>): boolean =>
  Number.isFinite(rect.x)
  && Number.isFinite(rect.y)
  && Number.isFinite(rect.width)
  && Number.isFinite(rect.height)
  && rect.width >= 0
  && rect.height >= 0;

const finiteViewportSize = (size: Readonly<CanvasViewportSize>): boolean =>
  Number.isFinite(size.width)
  && Number.isFinite(size.height)
  && size.width > 0
  && size.height > 0;

/**
 * Fits flow-space bounds into the unobscured canvas rectangle. Unlike React
 * Flow's scalar `padding`, this supports asymmetric UI rails and side panels.
 */
export const calculateSafeFitViewport = (input: {
  readonly bounds: Readonly<Rect>;
  readonly viewportSize: Readonly<CanvasViewportSize>;
  readonly safeArea?: Partial<CanvasSafeArea>;
  readonly padding?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}): ReactFlowViewport => {
  if (!finiteRect(input.bounds) || !finiteViewportSize(input.viewportSize)) {
    throw new RangeError('Safe Fit requires finite bounds and a positive viewport size.');
  }
  const safeArea = resolveCanvasSafeArea(input.safeArea);
  const padding = finiteInset(input.padding, 24);
  const availableWidth = Math.max(
    1,
    input.viewportSize.width - safeArea.left - safeArea.right - padding * 2,
  );
  const availableHeight = Math.max(
    1,
    input.viewportSize.height - safeArea.top - safeArea.bottom - padding * 2,
  );
  const contentWidth = Math.max(input.bounds.width, 1);
  const contentHeight = Math.max(input.bounds.height, 1);
  const zoom = clampCanvasZoom(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
    input.minZoom,
    input.maxZoom,
  );
  const x = safeArea.left
    + padding
    + (availableWidth - input.bounds.width * zoom) / 2
    - input.bounds.x * zoom;
  const y = safeArea.top
    + padding
    + (availableHeight - input.bounds.height * zoom) / 2
    - input.bounds.y * zoom;
  return { x, y, zoom };
};

/** Centers an already-fitted viewport inside an asymmetric safe area fallback. */
export const offsetViewportForSafeArea = (
  viewport: Readonly<ReactFlowViewport>,
  safeArea?: Partial<CanvasSafeArea>,
): ReactFlowViewport => {
  const resolved = resolveCanvasSafeArea(safeArea);
  return {
    x: viewport.x + (resolved.left - resolved.right) / 2,
    y: viewport.y + (resolved.top - resolved.bottom) / 2,
    zoom: viewport.zoom,
  };
};

export interface ReactFlowCanvasNavigationOptions {
  readonly safeArea?: Partial<CanvasSafeArea>;
  /** Dynamic container dimensions; enables exact asymmetric Safe Fit. */
  readonly getViewportSize?: () => CanvasViewportSize | null | undefined;
  /** Defaults to the bounds of the currently projected React Flow nodes. */
  readonly getContentBounds?: () => Rect | null | undefined;
  readonly fitPadding?: number;
  readonly fallbackFitPadding?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly duration?: number;
}

export interface ReactFlowCanvasNavigationHandlers {
  readonly safeArea: CanvasSafeArea;
  onZoomChange(zoom: number): void;
  onResetZoom(): void;
  onFitView(): void;
}

/**
 * Small integration seam for a ReactFlowInstance. Callers keep zoom controlled
 * from `onMove`, while Fit uses exact safe-area geometry when dimensions exist.
 */
export const createReactFlowCanvasNavigationHandlers = <NodeData, EdgeData>(
  instance: ReactFlowInstance<NodeData, EdgeData>,
  options: ReactFlowCanvasNavigationOptions = {},
): ReactFlowCanvasNavigationHandlers => {
  const safeArea = resolveCanvasSafeArea(options.safeArea);
  const minZoom = options.minZoom ?? MIN_CANVAS_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_CANVAS_ZOOM;
  const duration = options.duration ?? 160;
  return {
    safeArea,
    onZoomChange: (zoom) => {
      instance.zoomTo(clampCanvasZoom(zoom, minZoom, maxZoom), { duration });
    },
    onResetZoom: () => instance.zoomTo(1, { duration }),
    onFitView: () => {
      const nodes = instance.getNodes();
      const bounds = options.getContentBounds?.()
        ?? (nodes.length > 0 ? getRectOfNodes(nodes) : null);
      const viewportSize = options.getViewportSize?.();
      if (bounds && viewportSize && finiteRect(bounds) && finiteViewportSize(viewportSize)) {
        instance.setViewport(calculateSafeFitViewport({
          bounds,
          viewportSize,
          safeArea,
          padding: options.fitPadding,
          minZoom,
          maxZoom,
        }), { duration });
        return;
      }

      // React Flow only accepts scalar padding. Shift its result so even the
      // no-size fallback respects the left rail/right panel center line.
      instance.fitView({
        padding: options.fallbackFitPadding ?? 0.12,
        minZoom,
        maxZoom,
        duration: 0,
      });
      instance.setViewport(
        offsetViewportForSafeArea(instance.getViewport(), safeArea),
        { duration },
      );
    },
  };
};

export interface CanvasNavigationControlsProps {
  readonly zoom: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly zoomStep?: number;
  readonly safeArea?: Partial<CanvasSafeArea>;
  readonly isBranchFocused?: boolean;
  readonly canFocusBranch?: boolean;
  readonly focusedBranchLabel?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  onZoomChange(zoom: number): void;
  onFitView(): void;
  onResetZoom?(): void;
  onFocusBranch?(): void;
  onExitFocusBranch?(): void;
}

const buttonClass = 'inline-flex h-7 items-center justify-center rounded px-2 text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-35';

/** XMind-style, keyboard-accessible canvas navigation toolbar. */
export const CanvasNavigationControls = ({
  zoom,
  minZoom = MIN_CANVAS_ZOOM,
  maxZoom = MAX_CANVAS_ZOOM,
  zoomStep = CANVAS_ZOOM_STEP,
  safeArea: requestedSafeArea,
  isBranchFocused = false,
  canFocusBranch = false,
  focusedBranchLabel,
  className = '',
  style,
  onZoomChange,
  onFitView,
  onResetZoom,
  onFocusBranch,
  onExitFocusBranch,
}: CanvasNavigationControlsProps) => {
  const safeArea = resolveCanvasSafeArea(requestedSafeArea);
  const normalizedZoom = clampCanvasZoom(zoom, minZoom, maxZoom);
  const formattedZoom = formatCanvasZoomPercentage(normalizedZoom);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlurRef = useRef(false);
  const [draft, setDraft] = useState(formattedZoom);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(formattedZoom);
  }, [formattedZoom]);

  const commitDraft = (): void => {
    const nextZoom = parseCanvasZoomPercentage(draft, minZoom, maxZoom);
    if (nextZoom === null) {
      setDraft(formattedZoom);
      return;
    }
    setDraft(formatCanvasZoomPercentage(nextZoom));
    if (nextZoom !== normalizedZoom) onZoomChange(nextZoom);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      cancelBlurRef.current = true;
      commitDraft();
      event.currentTarget.blur();
      cancelBlurRef.current = false;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelBlurRef.current = true;
      setDraft(formattedZoom);
      event.currentTarget.blur();
      cancelBlurRef.current = false;
    }
  };

  const resetZoom = (): void => {
    if (onResetZoom) onResetZoom();
    else onZoomChange(1);
  };

  const focusDisabled = isBranchFocused
    ? !onExitFocusBranch
    : !canFocusBranch || !onFocusBranch;
  const focusLabel = isBranchFocused ? '退出聚焦' : '聚焦分支';
  const focusTitle = isBranchFocused
    ? `退出仅显示分支${focusedBranchLabel ? `：${focusedBranchLabel}` : ''}`
    : '仅显示所选分支（Ctrl+;）';

  return (
    <div
      role="toolbar"
      aria-label="画布导航"
      className={`nowheel nodrag absolute z-30 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur ${className}`}
      style={{ left: safeArea.left, bottom: safeArea.bottom, ...style }}
      data-testid="mindmap-canvas-navigation"
      data-safe-area-left={safeArea.left}
      data-safe-area-right={safeArea.right}
      data-focused={isBranchFocused ? 'true' : 'false'}
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
    >
      <button
        type="button"
        className={buttonClass}
        aria-label="缩小"
        title="缩小（Ctrl + 滚轮）"
        disabled={normalizedZoom <= minZoom}
        onClick={() => onZoomChange(clampCanvasZoom(
          normalizedZoom - zoomStep,
          minZoom,
          maxZoom,
        ))}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="h-7 w-[58px] rounded border border-transparent bg-slate-50 px-1 text-center text-xs tabular-nums text-slate-700 outline-none hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        aria-label="缩放百分比"
        title="缩放范围 10%–500%"
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelBlurRef.current) {
            cancelBlurRef.current = false;
            return;
          }
          commitDraft();
        }}
        onKeyDown={onInputKeyDown}
      />
      <button
        type="button"
        className={buttonClass}
        aria-label="放大"
        title="放大（Ctrl + 滚轮）"
        disabled={normalizedZoom >= maxZoom}
        onClick={() => onZoomChange(clampCanvasZoom(
          normalizedZoom + zoomStep,
          minZoom,
          maxZoom,
        ))}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
      <button
        type="button"
        className={`${buttonClass} gap-1 text-xs`}
        aria-label="适应安全画布"
        title="适应安全画布（避开侧栏和面板）"
        onClick={onFitView}
      >
        <Maximize2 size={13} aria-hidden="true" />
        <span>Fit</span>
      </button>
      <button
        type="button"
        className={`${buttonClass} text-xs tabular-nums`}
        aria-label="重置为 100%"
        title="实际大小"
        onClick={resetZoom}
      >
        100%
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
      <button
        type="button"
        className={`${buttonClass} gap-1 text-xs ${isBranchFocused ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : ''}`}
        aria-label={focusLabel}
        aria-pressed={isBranchFocused}
        title={focusTitle}
        disabled={focusDisabled}
        onClick={isBranchFocused ? onExitFocusBranch : onFocusBranch}
      >
        {isBranchFocused
          ? <X size={13} aria-hidden="true" />
          : <Focus size={13} aria-hidden="true" />}
        <span>{focusLabel}</span>
      </button>
    </div>
  );
};
