import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useViewport } from 'reactflow';

import type { ArrowHead, ElementRef, Rect } from '../domain/types';
import {
  resizeBoundaryFrame,
  type BoundaryFrameResizeHandle,
} from '../domain/boundaryFrame';
import type {
  SemanticGeometryPath,
  SemanticOverlayGeometry,
  SemanticOverlayGeometryModel,
} from '../render/geometry';
import type { ConnectorVisualStyle, SemanticVisualStyle } from '../style';

export interface SemanticOverlayViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface SemanticOverlayContextMenuEventInfo {
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface BoundaryRangeEndpointCapabilities {
  readonly outwardSteps: number;
  readonly inwardSteps: number;
}

export interface BoundaryRangeHandleSpec {
  readonly axis: 'horizontal' | 'vertical';
  /** Diagram-space distance between adjacent sibling centers. */
  readonly stepSpacing: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly siblingTargets: readonly Readonly<{
    edgeId: string;
    index: number;
    center: number;
  }>[];
  readonly start: BoundaryRangeEndpointCapabilities;
  readonly end: BoundaryRangeEndpointCapabilities;
}

/** Summary and Boundary ranges share the same canonical sibling landing model. */
export type SummaryRangeHandleSpec = BoundaryRangeHandleSpec;

export interface SemanticOverlaySvgProps {
  readonly geometry: SemanticOverlayGeometryModel;
  readonly currentSelection?: ElementRef | null;
  /** Labels are keyed by canonical entity ID and are presentation-only. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Styles are resolved from Theme → rules → named Style → local overrides. */
  readonly styles?: Readonly<Record<string, SemanticVisualStyle | ConnectorVisualStyle>>;
  readonly onSelect?: (selection: ElementRef) => void;
  readonly onContextMenu?: (
    selection: ElementRef,
    eventInfo: SemanticOverlayContextMenuEventInfo,
  ) => void;
  readonly readOnly?: boolean;
  /** Only canonical sibling-range Boundaries expose endpoint drag handles. */
  readonly boundaryRangeAdjustableIds?: ReadonlySet<string>;
  /** App projection supplies geometry-derived axes/capabilities for canonical ranges. */
  readonly boundaryRangeHandleSpecs?: Readonly<Record<string, BoundaryRangeHandleSpec>>;
  readonly onBoundaryRangeDrag?: (
    boundaryId: string,
    endpoint: 'start' | 'end',
    direction: 'outward' | 'inward',
    steps: number,
  ) => void;
  /** Eight-direction frame resize. The final diagram-space frame is committed once on pointer-up. */
  readonly onBoundaryFrameResize?: (
    boundaryId: string,
    frame: Readonly<Rect>,
  ) => void;
  /** Only canonical sibling-range Summaries expose endpoint drag handles. */
  readonly summaryRangeAdjustableIds?: ReadonlySet<string>;
  readonly summaryRangeHandleSpecs?: Readonly<Record<string, SummaryRangeHandleSpec>>;
  readonly onSummaryRangeDrag?: (
    summaryId: string,
    endpoint: 'start' | 'end',
    direction: 'outward' | 'inward',
    steps: number,
  ) => void;
}

export interface SemanticOverlaySvgContentsProps extends SemanticOverlaySvgProps {
  readonly viewport: SemanticOverlayViewport;
}

const number = (value: number): string => Number.isInteger(value)
  ? String(value)
  : String(Math.round(value * 1_000_000) / 1_000_000);

export const semanticGeometryPathToSvg = (path: SemanticGeometryPath): string =>
  path.commands.map((command) => {
    if (command.kind === 'close') return 'Z';
    if (command.kind === 'move') return `M ${number(command.to.x)} ${number(command.to.y)}`;
    if (command.kind === 'line') return `L ${number(command.to.x)} ${number(command.to.y)}`;
    if (command.kind === 'quadratic') {
      return `Q ${number(command.control.x)} ${number(command.control.y)} ${number(command.to.x)} ${number(command.to.y)}`;
    }
    return `C ${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.to.x)} ${number(command.to.y)}`;
  }).join(' ');

const elementRefFor = (item: SemanticOverlayGeometry): ElementRef => {
  if (item.kind === 'zone') return { kind: 'zone', id: item.entityId };
  if (item.kind === 'boundary') return { kind: 'boundary', id: item.entityId };
  if (item.kind === 'summary') return { kind: 'summary', id: item.entityId };
  if (item.kind === 'callout') return { kind: 'callout', id: item.entityId };
  return { kind: 'relationship', id: item.entityId };
};

const isSelected = (
  item: SemanticOverlayGeometry,
  currentSelection: ElementRef | null | undefined,
): boolean => currentSelection?.kind === item.kind && currentSelection.id === item.entityId;

const stopAndSelect = (
  event: ReactPointerEvent<SVGElement>,
  item: SemanticOverlayGeometry,
  onSelect: SemanticOverlaySvgProps['onSelect'],
): void => {
  event.preventDefault();
  event.stopPropagation();
  onSelect?.(elementRefFor(item));
};

const stopAndOpenContextMenu = (
  event: ReactMouseEvent<SVGElement>,
  item: SemanticOverlayGeometry,
  onContextMenu: SemanticOverlaySvgProps['onContextMenu'],
): void => {
  event.preventDefault();
  event.stopPropagation();
  onContextMenu?.(elementRefFor(item), {
    clientX: event.clientX,
    clientY: event.clientY,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  });
};

const shortLabel = (value: string | undefined): string | undefined => {
  const label = value?.trim();
  if (!label) return undefined;
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
};

const customBoundaryPath = (
  frame: Readonly<{ x: number; y: number; width: number; height: number }>,
  shape: string,
): string => {
  const { x, y, width, height } = frame;
  const right = x + width;
  const bottom = y + height;
  const dx = Math.max(4, width / 8);
  const dy = Math.max(4, height / 6);
  if (shape === 'scallop') {
    return `M ${number(x)} ${number(y)} Q ${number(x + dx / 2)} ${number(y - dy)} ${number(x + dx)} ${number(y)} Q ${number(x + width / 2)} ${number(y - dy)} ${number(right - dx)} ${number(y)} Q ${number(right + dx / 2)} ${number(y)} ${number(right)} ${number(y + dy)} Q ${number(right + dx)} ${number(y + height / 2)} ${number(right)} ${number(bottom - dy)} Q ${number(right)} ${number(bottom + dy)} ${number(right - dx)} ${number(bottom)} Q ${number(x + width / 2)} ${number(bottom + dy)} ${number(x + dx)} ${number(bottom)} Q ${number(x - dx / 2)} ${number(bottom)} ${number(x)} ${number(bottom - dy)} Q ${number(x - dx)} ${number(y + height / 2)} ${number(x)} ${number(y + dy)} Z`;
  }
  if (shape === 'wave') {
    return `M ${number(x)} ${number(y + dy)} C ${number(x + width * 0.25)} ${number(y - dy)} ${number(x + width * 0.25)} ${number(y + dy)} ${number(x + width * 0.5)} ${number(y)} C ${number(x + width * 0.75)} ${number(y - dy)} ${number(x + width * 0.75)} ${number(y + dy)} ${number(right)} ${number(y)} L ${number(right)} ${number(bottom - dy)} C ${number(x + width * 0.75)} ${number(bottom + dy)} ${number(x + width * 0.75)} ${number(bottom - dy)} ${number(x + width * 0.5)} ${number(bottom)} C ${number(x + width * 0.25)} ${number(bottom + dy)} ${number(x + width * 0.25)} ${number(bottom - dy)} ${number(x)} ${number(bottom)} Z`;
  }
  if (shape === 'tension') {
    return `M ${number(x + dx)} ${number(y)} Q ${number(x)} ${number(y)} ${number(x)} ${number(y + dy)} Q ${number(x + dx)} ${number(y + height / 2)} ${number(x)} ${number(bottom - dy)} Q ${number(x)} ${number(bottom)} ${number(x + dx)} ${number(bottom)} Q ${number(x + width / 2)} ${number(bottom - dy)} ${number(right - dx)} ${number(bottom)} Q ${number(right)} ${number(bottom)} ${number(right)} ${number(bottom - dy)} Q ${number(right - dx)} ${number(y + height / 2)} ${number(right)} ${number(y + dy)} Q ${number(right)} ${number(y)} ${number(right - dx)} ${number(y)} Q ${number(x + width / 2)} ${number(y + dy)} ${number(x + dx)} ${number(y)} Z`;
  }
  return `M ${number(x + dx)} ${number(y)} H ${number(x)} V ${number(bottom)} H ${number(x + dx)} M ${number(right - dx)} ${number(y)} H ${number(right)} V ${number(bottom)} H ${number(right - dx)}`;
};

const semanticStyleFor = (
  styles: SemanticOverlaySvgProps['styles'],
  entityId: string,
): SemanticVisualStyle | undefined => {
  const style = styles?.[entityId];
  return style && 'fill' in style ? style : undefined;
};

const connectorStyleFor = (
  styles: SemanticOverlaySvgProps['styles'],
  entityId: string,
): ConnectorVisualStyle | undefined => {
  const style = styles?.[entityId];
  return style && !('fill' in style) ? style : undefined;
};

interface SemanticRangeHandleProps {
  readonly axis: 'horizontal' | 'vertical';
  readonly entityId: string;
  readonly entityKind: 'boundary' | 'summary';
  readonly capabilities: BoundaryRangeEndpointCapabilities;
  readonly endpoint: 'start' | 'end';
  readonly currentIndex?: number;
  readonly lastIndex?: number;
  readonly firstIndex?: number;
  readonly siblingTargets?: BoundaryRangeHandleSpec['siblingTargets'];
  readonly stepSpacing: number;
  readonly viewport: SemanticOverlayViewport;
  readonly x: number;
  readonly y: number;
  readonly onDrag: (
    entityId: string,
    endpoint: 'start' | 'end',
    direction: 'outward' | 'inward',
    steps: number,
  ) => void;
}

/**
 * A gesture produces one final canonical range update on pointer-up. When
 * projected sibling centers are available, the nearest legal center is the
 * landing target (including unequal spacing and multi-sibling jumps).
 */
const SemanticRangeHandle = ({
  axis,
  capabilities,
  currentIndex,
  endpoint,
  entityId,
  entityKind,
  firstIndex,
  lastIndex,
  onDrag,
  siblingTargets,
  stepSpacing,
  viewport,
  x,
  y,
}: SemanticRangeHandleProps) => {
  const dragStart = useRef<Readonly<{ pointerId: number; x: number; y: number }> | null>(null);
  const dispatchSignedDirection = (signedDirection: -1 | 1, requestedSteps = 1): void => {
    const outward = endpoint === 'start' ? signedDirection < 0 : signedDirection > 0;
    const direction = outward ? 'outward' : 'inward';
    const availableSteps = direction === 'outward'
      ? capabilities.outwardSteps
      : capabilities.inwardSteps;
    if (availableSteps <= 0) return;
    onDrag(entityId, endpoint, direction, Math.min(requestedSteps, availableSteps));
  };
  const onPointerDown = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const clearPointer = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (dragStart.current?.pointerId === event.pointerId) dragStart.current = null;
  };
  const onPointerUp = (event: ReactPointerEvent<SVGCircleElement>): void => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStart.current = null;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const delta = axis === 'horizontal'
      ? event.clientX - start.x
      : event.clientY - start.y;
    if (Math.abs(delta) < 4) return;
    if (
      currentIndex !== undefined
      && firstIndex !== undefined
      && lastIndex !== undefined
      && siblingTargets
      && siblingTargets.length > 0
    ) {
      const svgBounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
      const clientCoordinate = axis === 'horizontal' ? event.clientX : event.clientY;
      const svgStart = axis === 'horizontal' ? svgBounds?.left ?? 0 : svgBounds?.top ?? 0;
      const viewportOffset = axis === 'horizontal' ? viewport.x : viewport.y;
      const diagramCoordinate = (
        clientCoordinate - svgStart - viewportOffset
      ) / Math.max(0.01, viewport.zoom);
      const legalTargets = siblingTargets.filter((target) => endpoint === 'start'
        ? target.index <= lastIndex
        : target.index >= firstIndex);
      const target = legalTargets.reduce<(typeof legalTargets)[number] | undefined>(
        (nearest, candidate) => !nearest
          || Math.abs(candidate.center - diagramCoordinate)
            < Math.abs(nearest.center - diagramCoordinate)
          ? candidate
          : nearest,
        undefined,
      );
      if (!target || target.index === currentIndex) return;
      const signedSteps = target.index - currentIndex;
      dispatchSignedDirection(signedSteps < 0 ? -1 : 1, Math.abs(signedSteps));
      return;
    }
    const spacingInClientPixels = Math.max(1, stepSpacing * Math.max(0.01, viewport.zoom));
    const requestedSteps = Math.max(1, Math.round(Math.abs(delta) / spacingInClientPixels));
    dispatchSignedDirection(delta < 0 ? -1 : 1, requestedSteps);
  };
  const onKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>): void => {
    const negativeKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const positiveKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== negativeKey && event.key !== positiveKey) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchSignedDirection(event.key === negativeKey ? -1 : 1);
  };
  return (
    <circle
      aria-label={`${endpoint === 'start' ? '起点' : '终点'}范围拖柄`}
      cx={x}
      cy={y}
      data-boundary-id={entityKind === 'boundary' ? entityId : undefined}
      data-boundary-range-axis={entityKind === 'boundary' ? axis : undefined}
      data-boundary-range-handle={entityKind === 'boundary' ? endpoint : undefined}
      data-summary-id={entityKind === 'summary' ? entityId : undefined}
      data-summary-range-axis={entityKind === 'summary' ? axis : undefined}
      data-summary-range-handle={entityKind === 'summary' ? endpoint : undefined}
      data-inward-steps={capabilities.inwardSteps}
      data-outward-steps={capabilities.outwardSteps}
      data-current-edge-id={siblingTargets?.find((target) => target.index === currentIndex)?.edgeId}
      data-entity-id={entityId}
      data-testid={`mindmap-${entityKind}-range-handle-${endpoint}-${entityId}`}
      fill="white"
      aria-disabled={capabilities.inwardSteps === 0 && capabilities.outwardSteps === 0}
      r={6}
      role="button"
      stroke="#2563EB"
      strokeWidth={2}
      tabIndex={0}
      vectorEffect="non-scaling-stroke"
      style={{
        cursor: axis === 'horizontal' ? 'ew-resize' : 'ns-resize',
        pointerEvents: 'all',
      }}
      onKeyDown={onKeyDown}
      onPointerCancel={clearPointer}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    />
  );
};

const BOUNDARY_FRAME_RESIZE_HANDLES: readonly BoundaryFrameResizeHandle[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

const boundaryFrameHandleCenter = (
  frame: Readonly<Rect>,
  handle: BoundaryFrameResizeHandle,
) => ({
  x: handle.includes('w')
    ? frame.x
    : handle.includes('e')
      ? frame.x + frame.width
      : frame.x + frame.width / 2,
  y: handle.includes('n')
    ? frame.y
    : handle.includes('s')
      ? frame.y + frame.height
      : frame.y + frame.height / 2,
});

const boundaryFrameCursor = (handle: BoundaryFrameResizeHandle): string => {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
};

interface BoundaryFrameHandleProps {
  readonly boundaryId: string;
  readonly frame: Readonly<Rect>;
  readonly handle: BoundaryFrameResizeHandle;
  readonly memberBounds: Readonly<Rect>;
  readonly viewport: SemanticOverlayViewport;
  readonly onResize: (boundaryId: string, frame: Readonly<Rect>) => void;
}

const BoundaryFrameHandle = ({
  boundaryId,
  frame,
  handle,
  memberBounds,
  onResize,
  viewport,
}: BoundaryFrameHandleProps) => {
  const dragStart = useRef<Readonly<{
    pointerId: number;
    clientX: number;
    clientY: number;
  }> | null>(null);
  const [previewFrame, setPreviewFrame] = useState<Readonly<Rect> | null>(null);
  const zoom = Math.max(0.01, viewport.zoom);
  const center = boundaryFrameHandleCenter(frame, handle);
  const handleSize = 10 / zoom;
  const resizedFrame = (clientX: number, clientY: number): Rect | null => {
    const start = dragStart.current;
    if (!start) return null;
    return resizeBoundaryFrame(frame, memberBounds, handle, {
      x: (clientX - start.clientX) / zoom,
      y: (clientY - start.clientY) / zoom,
    });
  };
  const finish = (event: ReactPointerEvent<SVGRectElement>, commit: boolean): void => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const nextFrame = resizedFrame(event.clientX, event.clientY);
    dragStart.current = null;
    setPreviewFrame(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (commit && nextFrame && (
      nextFrame.x !== frame.x
      || nextFrame.y !== frame.y
      || nextFrame.width !== frame.width
      || nextFrame.height !== frame.height
    )) onResize(boundaryId, nextFrame);
  };
  return (
    <g data-boundary-frame-handle-group={handle}>
      {previewFrame ? (
        <rect
          data-testid={`mindmap-boundary-frame-preview-${boundaryId}`}
          x={previewFrame.x}
          y={previewFrame.y}
          width={previewFrame.width}
          height={previewFrame.height}
          rx={8 / zoom}
          fill="none"
          stroke="#2563EB"
          strokeDasharray="5 4"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      ) : null}
      <rect
        aria-label={`边界${handle}缩放柄`}
        data-boundary-frame-handle={handle}
        data-boundary-id={boundaryId}
        data-testid={`mindmap-boundary-frame-handle-${handle}-${boundaryId}`}
        fill="white"
        height={handleSize}
        role="button"
        rx={2 / zoom}
        stroke="#2563EB"
        strokeWidth={1.75}
        tabIndex={0}
        vectorEffect="non-scaling-stroke"
        width={handleSize}
        x={center.x - handleSize / 2}
        y={center.y - handleSize / 2}
        style={{ cursor: boundaryFrameCursor(handle), pointerEvents: 'all' }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 24 : 8;
          const delta = event.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : event.key === 'ArrowUp'
                ? { x: 0, y: -step }
                : event.key === 'ArrowDown'
                  ? { x: 0, y: step }
                  : null;
          if (!delta) return;
          event.preventDefault();
          event.stopPropagation();
          const nextFrame = resizeBoundaryFrame(frame, memberBounds, handle, delta);
          if (
            nextFrame.x !== frame.x
            || nextFrame.y !== frame.y
            || nextFrame.width !== frame.width
            || nextFrame.height !== frame.height
          ) onResize(boundaryId, nextFrame);
        }}
        onPointerCancel={(event) => finish(event, false)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragStart.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
          };
        }}
        onPointerMove={(event) => {
          if (dragStart.current?.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          setPreviewFrame(resizedFrame(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => finish(event, true)}
      />
    </g>
  );
};

interface RelationshipArrowMarkerProps {
  readonly arrow: ArrowHead;
  readonly color: string;
  readonly id: string;
}

const RelationshipArrowMarker = ({
  arrow,
  color,
  id,
}: RelationshipArrowMarkerProps) => {
  if (arrow === 'none') return null;
  const open = arrow.startsWith('open-');
  const common = {
    fill: open ? 'white' : color,
    stroke: color,
    strokeWidth: 1.5,
  };
  return (
    <marker
      id={id}
      markerHeight="12"
      markerUnits="userSpaceOnUse"
      markerWidth="14"
      orient="auto-start-reverse"
      refX="11"
      refY="6"
      viewBox="-1 0 14 12"
    >
      {arrow === 'triangle' || arrow === 'open-triangle' ? (
        <path d="M 1 1 L 11 6 L 1 11 Z" {...common} />
      ) : arrow === 'diamond' || arrow === 'open-diamond' ? (
        <path d="M 1 6 L 6 1 L 11 6 L 6 11 Z" {...common} />
      ) : arrow === 'circle' || arrow === 'open-circle' ? (
        <circle cx="6" cy="6" r="4.5" {...common} />
      ) : arrow === 'square' || arrow === 'open-square' ? (
        <rect x="2" y="2" width="8" height="8" {...common} />
      ) : arrow === 'double-bar' ? (
        <path d="M 7 1 L 7 11 M 11 1 L 11 11" fill="none" stroke={color} strokeWidth="1.8" />
      ) : (
        <path d="M 10 1 L 10 11" fill="none" stroke={color} strokeWidth="1.8" />
      )}
    </marker>
  );
};

export const SemanticOverlaySvgContents = memo(({
  boundaryRangeAdjustableIds,
  boundaryRangeHandleSpecs,
  currentSelection,
  geometry,
  labels,
  onContextMenu,
  onBoundaryFrameResize,
  onBoundaryRangeDrag,
  onSummaryRangeDrag,
  onSelect,
  readOnly,
  styles,
  summaryRangeAdjustableIds,
  summaryRangeHandleSpecs,
  viewport,
}: SemanticOverlaySvgContentsProps) => (
  <svg
    aria-label="思维导图语义元素图层"
    className="pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-hidden"
    data-testid="mindmap-semantic-overlay"
  >
    <g transform={`translate(${number(viewport.x)} ${number(viewport.y)}) scale(${number(viewport.zoom)})`}>
      {geometry.zones.map((item) => item.visibility === 'visible' && item.rect ? (
        <g
          key={`zone:${item.entityId}`}
          data-semantic-kind="zone"
          data-entity-id={item.entityId}
          data-selected={isSelected(item, currentSelection) ? 'true' : 'false'}
          opacity={semanticStyleFor(styles, item.entityId)?.opacity ?? 1}
          style={{ filter: isSelected(item, currentSelection) ? 'drop-shadow(0 0 2px #2563EB)' : undefined }}
        >
          <rect
            x={item.rect.x}
            y={item.rect.y}
            width={item.rect.width}
            height={item.rect.height}
            rx={semanticStyleFor(styles, item.entityId)?.borderRadius ?? 12}
            fill={semanticStyleFor(styles, item.entityId)?.fill ?? '#F8FAFC'}
            fillOpacity={semanticStyleFor(styles, item.entityId)?.fillOpacity ?? 0.12}
            stroke={semanticStyleFor(styles, item.entityId)?.stroke ?? '#94A3B8'}
            strokeDasharray={semanticStyleFor(styles, item.entityId)?.strokeDasharray ?? '6 4'}
            strokeWidth={(semanticStyleFor(styles, item.entityId)?.strokeWidth ?? 1)
              + (isSelected(item, currentSelection) ? 1 : 0)}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
            onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
          />
          {shortLabel(labels?.[item.entityId]) ? (
            <text
              x={item.rect.x + 12}
              y={item.rect.y + 20}
              fill={semanticStyleFor(styles, item.entityId)?.color ?? '#475569'}
              fontFamily={semanticStyleFor(styles, item.entityId)?.fontFamily}
              fontSize={semanticStyleFor(styles, item.entityId)?.fontSize ?? 12}
              fontStyle={semanticStyleFor(styles, item.entityId)?.fontStyle}
              fontWeight={semanticStyleFor(styles, item.entityId)?.fontWeight ?? 600}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {shortLabel(labels?.[item.entityId])}
            </text>
          ) : null}
        </g>
      ) : null)}

      {geometry.boundaries.map((item) => {
        if (item.visibility !== 'visible' || !item.outline || !item.frame) return null;
        const selected = isSelected(item, currentSelection);
        const visual = semanticStyleFor(styles, item.entityId);
        const shape = visual?.shape ?? 'rounded-rectangle';
        const common = {
          fill: shape === 'bracket' || shape === 'none' ? 'none' : visual?.fill ?? '#EFF6FF',
          fillOpacity: visual?.fillOpacity ?? 0.08,
          stroke: shape === 'none' ? 'transparent' : visual?.stroke ?? '#60A5FA',
          strokeDasharray: visual?.strokeDasharray ?? '7 5',
          strokeWidth: (visual?.strokeWidth ?? 2) + (selected ? 1 : 0),
          vectorEffect: 'non-scaling-stroke' as const,
          // Boundary fill sits behind its member topics. Only the outline owns
          // the hit area so users can still select/edit topics inside it.
          style: { pointerEvents: 'stroke' as const, cursor: 'pointer' },
        };
        const rx = shape === 'capsule'
          ? Math.min(item.frame.width, item.frame.height) / 2
          : shape === 'rounded-rectangle'
            ? visual?.borderRadius ?? 18
            : 0;
        const rangeSpec = boundaryRangeHandleSpecs?.[item.entityId];
        const rangeAxis = rangeSpec?.axis
          ?? (item.frame.width >= item.frame.height ? 'horizontal' : 'vertical');
        const rangeHandleOffset = 18 / Math.max(0.01, viewport.zoom);
        const startHandle = rangeAxis === 'horizontal'
          ? { x: item.frame.x - rangeHandleOffset, y: item.frame.y + item.frame.height / 2 }
          : { x: item.frame.x + item.frame.width / 2, y: item.frame.y - rangeHandleOffset };
        const endHandle = rangeAxis === 'horizontal'
          ? {
              x: item.frame.x + item.frame.width + rangeHandleOffset,
              y: item.frame.y + item.frame.height / 2,
            }
          : {
              x: item.frame.x + item.frame.width / 2,
              y: item.frame.y + item.frame.height + rangeHandleOffset,
            };
        const showRangeHandles = selected
          && !readOnly
          && Boolean(onBoundaryRangeDrag)
          && (Boolean(rangeSpec) || Boolean(boundaryRangeAdjustableIds?.has(item.entityId)));
        const showFrameHandles = selected
          && !readOnly
          && Boolean(onBoundaryFrameResize)
          && Boolean(item.memberBounds);
        const fallbackCapabilities = { outwardSteps: 1, inwardSteps: 1 } as const;
        return (
          <g
            key={`boundary:${item.entityId}`}
            data-semantic-kind="boundary"
            data-entity-id={item.entityId}
            data-boundary-shape={shape}
            data-selected={selected ? 'true' : 'false'}
            data-range-first-edge-id={rangeSpec?.siblingTargets
              .find((target) => target.index === rangeSpec.firstIndex)?.edgeId}
            data-range-last-edge-id={rangeSpec?.siblingTargets
              .find((target) => target.index === rangeSpec.lastIndex)?.edgeId}
            opacity={visual?.opacity ?? 1}
            style={{ filter: selected ? 'drop-shadow(0 0 2px #2563EB)' : undefined }}
            onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
            onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
          >
            {shape === 'ellipse' ? (
              <ellipse
                cx={item.frame.x + item.frame.width / 2}
                cy={item.frame.y + item.frame.height / 2}
                rx={item.frame.width / 2}
                ry={item.frame.height / 2}
                {...common}
              />
            ) : shape === 'scallop' || shape === 'wave' || shape === 'tension' || shape === 'bracket' ? (
              <path d={customBoundaryPath(item.frame, shape)} {...common} />
            ) : (
              <rect
                x={item.frame.x}
                y={item.frame.y}
                width={item.frame.width}
                height={item.frame.height}
                rx={rx}
                {...common}
              />
            )}
            {shortLabel(labels?.[item.entityId]) ? (
              <text
                x={item.frame.x + 10}
                y={item.frame.y + 16}
                fill={visual?.color ?? '#1D4ED8'}
                fontFamily={visual?.fontFamily}
                fontSize={visual?.fontSize ?? 12}
                fontStyle={visual?.fontStyle}
                fontWeight={visual?.fontWeight ?? 600}
                style={{ pointerEvents: 'all', cursor: 'pointer', userSelect: 'none' }}
              >
                {shortLabel(labels?.[item.entityId])}
              </text>
            ) : null}
            {showRangeHandles ? (
              <>
                <SemanticRangeHandle
                  axis={rangeAxis}
                  capabilities={rangeSpec?.start ?? fallbackCapabilities}
                  currentIndex={rangeSpec?.firstIndex}
                  endpoint="start"
                  entityId={item.entityId}
                  entityKind="boundary"
                  firstIndex={rangeSpec?.firstIndex}
                  lastIndex={rangeSpec?.lastIndex}
                  siblingTargets={rangeSpec?.siblingTargets}
                  stepSpacing={rangeSpec?.stepSpacing ?? 80}
                  viewport={viewport}
                  x={startHandle.x}
                  y={startHandle.y}
                  onDrag={onBoundaryRangeDrag!}
                />
                <SemanticRangeHandle
                  axis={rangeAxis}
                  capabilities={rangeSpec?.end ?? fallbackCapabilities}
                  currentIndex={rangeSpec?.lastIndex}
                  endpoint="end"
                  entityId={item.entityId}
                  entityKind="boundary"
                  firstIndex={rangeSpec?.firstIndex}
                  lastIndex={rangeSpec?.lastIndex}
                  siblingTargets={rangeSpec?.siblingTargets}
                  stepSpacing={rangeSpec?.stepSpacing ?? 80}
                  viewport={viewport}
                  x={endHandle.x}
                  y={endHandle.y}
                  onDrag={onBoundaryRangeDrag!}
                />
              </>
            ) : null}
            {showFrameHandles ? BOUNDARY_FRAME_RESIZE_HANDLES.map((handle) => (
              <BoundaryFrameHandle
                key={handle}
                boundaryId={item.entityId}
                frame={item.frame!}
                handle={handle}
                memberBounds={item.memberBounds!}
                viewport={viewport}
                onResize={onBoundaryFrameResize!}
              />
            )) : null}
          </g>
        );
      })}

      {geometry.summaries.map((item) => {
        if (item.visibility !== 'visible') return null;
        const selected = isSelected(item, currentSelection);
        const visual = semanticStyleFor(styles, item.entityId);
        const rangeSpec = summaryRangeHandleSpecs?.[item.entityId];
        const bracketCommands = item.bracket?.commands.filter(
          (command) => command.kind === 'move' || command.kind === 'line',
        ) ?? [];
        const bracketStart = bracketCommands[1]?.kind === 'line'
          ? bracketCommands[1].to
          : undefined;
        const bracketEnd = bracketCommands[2]?.kind === 'line'
          ? bracketCommands[2].to
          : undefined;
        const showRangeHandles = selected
          && !readOnly
          && Boolean(onSummaryRangeDrag)
          && Boolean(bracketStart)
          && Boolean(bracketEnd)
          && (Boolean(rangeSpec) || Boolean(summaryRangeAdjustableIds?.has(item.entityId)));
        const fallbackCapabilities = { outwardSteps: 1, inwardSteps: 1 } as const;
        const rangeAxis = rangeSpec?.axis
          ?? (item.orientation === 'left' || item.orientation === 'right'
            ? 'vertical'
            : 'horizontal');
        const renderSummaryPath = (
          part: 'bracket' | 'connector',
          path: SemanticGeometryPath | undefined,
          fallbackDash?: string,
        ) => path ? (
          <>
            <path
              aria-hidden="true"
              d={semanticGeometryPathToSvg(path)}
              data-summary-hit-part={part}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
              onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
            />
            <path
              aria-label={`概要${part === 'bracket' ? '括号' : '连接线'}`}
              aria-pressed={selected}
              d={semanticGeometryPathToSvg(path)}
              data-summary-part={part}
              fill="none"
              role="button"
              stroke={visual?.stroke ?? '#8B5CF6'}
              strokeDasharray={visual?.strokeDasharray ?? fallbackDash}
              strokeWidth={(visual?.strokeWidth ?? 2) + (selected ? 1 : 0)}
              tabIndex={0}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(elementRefFor(item));
              }}
              onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
              onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
            />
          </>
        ) : null;
        return (
          <g
            key={`summary:${item.entityId}`}
            data-semantic-kind="summary"
            data-entity-id={item.entityId}
            data-summary-orientation={item.orientation}
            data-selected={selected ? 'true' : 'false'}
            opacity={visual?.opacity ?? 1}
            style={{ filter: selected ? 'drop-shadow(0 0 2px #2563EB)' : undefined }}
          >
            {renderSummaryPath('bracket', item.bracket)}
            {renderSummaryPath('connector', item.resultConnector, '4 3')}
            {showRangeHandles ? (
              <>
                <SemanticRangeHandle
                  axis={rangeAxis}
                  capabilities={rangeSpec?.start ?? fallbackCapabilities}
                  currentIndex={rangeSpec?.firstIndex}
                  endpoint="start"
                  entityId={item.entityId}
                  entityKind="summary"
                  firstIndex={rangeSpec?.firstIndex}
                  lastIndex={rangeSpec?.lastIndex}
                  siblingTargets={rangeSpec?.siblingTargets}
                  stepSpacing={rangeSpec?.stepSpacing ?? 80}
                  viewport={viewport}
                  x={bracketStart!.x}
                  y={bracketStart!.y}
                  onDrag={onSummaryRangeDrag!}
                />
                <SemanticRangeHandle
                  axis={rangeAxis}
                  capabilities={rangeSpec?.end ?? fallbackCapabilities}
                  currentIndex={rangeSpec?.lastIndex}
                  endpoint="end"
                  entityId={item.entityId}
                  entityKind="summary"
                  firstIndex={rangeSpec?.firstIndex}
                  lastIndex={rangeSpec?.lastIndex}
                  siblingTargets={rangeSpec?.siblingTargets}
                  stepSpacing={rangeSpec?.stepSpacing ?? 80}
                  viewport={viewport}
                  x={bracketEnd!.x}
                  y={bracketEnd!.y}
                  onDrag={onSummaryRangeDrag!}
                />
              </>
            ) : null}
          </g>
        );
      })}

      {geometry.callouts.map((item) => item.visibility === 'visible' && item.bubble ? (
        <g
          key={`callout:${item.entityId}`}
          data-semantic-kind="callout"
          data-entity-id={item.entityId}
          data-selected={isSelected(item, currentSelection) ? 'true' : 'false'}
          opacity={semanticStyleFor(styles, item.entityId)?.opacity ?? 1}
          style={{ filter: isSelected(item, currentSelection) ? 'drop-shadow(0 0 2px #2563EB)' : undefined }}
        >
          {item.tail ? (
            <path
              d={semanticGeometryPathToSvg(item.tail)}
              fill={semanticStyleFor(styles, item.entityId)?.fill ?? '#FFFBEB'}
              fillOpacity={semanticStyleFor(styles, item.entityId)?.fillOpacity ?? 1}
              stroke={semanticStyleFor(styles, item.entityId)?.stroke ?? '#F59E0B'}
              strokeWidth={(semanticStyleFor(styles, item.entityId)?.strokeWidth ?? 2)
                + (isSelected(item, currentSelection) ? 1 : 0)}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <rect
            x={item.bubble.x}
            y={item.bubble.y}
            width={item.bubble.width}
            height={item.bubble.height}
            rx={semanticStyleFor(styles, item.entityId)?.borderRadius ?? 12}
            fill={semanticStyleFor(styles, item.entityId)?.fill ?? '#FFFBEB'}
            fillOpacity={semanticStyleFor(styles, item.entityId)?.fillOpacity ?? 1}
            stroke={semanticStyleFor(styles, item.entityId)?.stroke ?? '#F59E0B'}
            strokeDasharray={semanticStyleFor(styles, item.entityId)?.strokeDasharray}
            strokeWidth={(semanticStyleFor(styles, item.entityId)?.strokeWidth ?? 2)
              + (isSelected(item, currentSelection) ? 1 : 0)}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
            onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
          />
          {shortLabel(labels?.[item.entityId]) ? (
            <text
              x={item.bubble.x + item.bubble.width / 2}
              y={item.bubble.y + item.bubble.height / 2}
              dominantBaseline="middle"
              textAnchor="middle"
              fill={semanticStyleFor(styles, item.entityId)?.color ?? '#92400E'}
              fontFamily={semanticStyleFor(styles, item.entityId)?.fontFamily}
              fontSize={semanticStyleFor(styles, item.entityId)?.fontSize ?? 12}
              fontStyle={semanticStyleFor(styles, item.entityId)?.fontStyle}
              fontWeight={semanticStyleFor(styles, item.entityId)?.fontWeight}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {shortLabel(labels?.[item.entityId])}
            </text>
          ) : null}
        </g>
      ) : null)}

      {geometry.relationships.map((item) => {
        if (item.visibility !== 'visible' || !item.path) return null;
        const selected = isSelected(item, currentSelection);
        const visualStyle = connectorStyleFor(styles, item.entityId);
        const color = visualStyle?.stroke ?? '#64748B';
        const startMarkerId = `mindmap-relationship-${item.entityId}-start`;
        const endMarkerId = `mindmap-relationship-${item.entityId}-end`;
        return (
          <g
            key={`relationship:${item.entityId}`}
            data-semantic-kind="relationship"
            data-entity-id={item.entityId}
            data-selected={selected ? 'true' : 'false'}
            opacity={visualStyle?.opacity ?? 1}
            style={{ filter: selected ? 'drop-shadow(0 0 2px #2563EB)' : undefined }}
          >
            <defs>
              <RelationshipArrowMarker id={startMarkerId} arrow={item.startArrow} color={color} />
              <RelationshipArrowMarker id={endMarkerId} arrow={item.endArrow} color={color} />
            </defs>
            <path
              d={semanticGeometryPathToSvg(item.path)}
              fill="none"
              markerStart={item.startArrow === 'none' ? undefined : `url(#${startMarkerId})`}
              markerEnd={item.endArrow === 'none' ? undefined : `url(#${endMarkerId})`}
              stroke={color}
              strokeDasharray={visualStyle?.strokeDasharray}
              strokeWidth={(visualStyle?.strokeWidth ?? 2) + (selected ? 1 : 0)}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(event) => stopAndSelect(event, item, onSelect)}
              onContextMenu={(event) => stopAndOpenContextMenu(event, item, onContextMenu)}
            />
            {shortLabel(labels?.[item.entityId]) && item.bounds ? (
              <text
                x={item.bounds.x + item.bounds.width / 2}
                y={item.bounds.y + item.bounds.height / 2 - 6}
                textAnchor="middle"
                fill="#475569"
                fontSize={11}
                paintOrder="stroke"
                stroke="white"
                strokeWidth={4}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {shortLabel(labels?.[item.entityId])}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  </svg>
));

SemanticOverlaySvgContents.displayName = 'SemanticOverlaySvgContents';

export const SemanticOverlaySvg = memo((props: SemanticOverlaySvgProps) => {
  const viewport = useViewport();
  return <SemanticOverlaySvgContents {...props} viewport={viewport} />;
});

SemanticOverlaySvg.displayName = 'SemanticOverlaySvg';
