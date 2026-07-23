import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type {
  MarkerDefinitionId,
  MindMapDocumentV1,
  Point,
  SheetId,
} from '../domain/types';
import { markerLegendDefinitionIds } from './markerPlanning';
import { markerVisual } from './markerVisuals';
import { MarkerIcon } from './MarkerIcon';

export interface MarkerLegendViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface MarkerLegendCanvasProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly readOnly: boolean;
  readonly viewport: MarkerLegendViewport;
  onMove?(position: Point): void;
}

interface DragSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startPosition: Point;
  latestPosition: Point;
}

const samePoint = (left: Point, right: Point): boolean =>
  left.x === right.x && left.y === right.y;

const definitionLabel = (
  document: MindMapDocumentV1,
  definitionId: MarkerDefinitionId,
): string => {
  const definition = document.markerDefinitions[definitionId];
  if (!definition) return '缺失标记';
  const group = document.markerGroups[definition.groupId];
  return `${definition.name}${group ? `（${group.name}）` : '（缺失分组）'}`;
};

/**
 * Content-coordinate legend overlay. Pointer movement is preview-only; one
 * canonical move is emitted on pointerup, so a drag is exactly one undo unit.
 */
export const MarkerLegendCanvas = ({
  document,
  sheetId,
  readOnly,
  viewport,
  onMove,
}: MarkerLegendCanvasProps) => {
  const sheet = document.sheets[sheetId];
  const canonicalPosition = sheet?.markerLegend.position;
  const [previewPosition, setPreviewPosition] = useState<Point>(
    canonicalPosition ?? { x: 0, y: 0 },
  );
  const dragRef = useRef<DragSession | null>(null);
  const definitionIds = useMemo(() => markerLegendDefinitionIds(document, sheetId), [document, sheetId]);

  useEffect(() => {
    if (!dragRef.current && canonicalPosition) setPreviewPosition(canonicalPosition);
  }, [canonicalPosition?.x, canonicalPosition?.y]);

  if (!sheet?.markerLegend.visible) return null;

  const updateDrag = (event: ReactPointerEvent<HTMLElement>): Point | null => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return null;
    const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
    const position = {
      x: Math.round((session.startPosition.x + (event.clientX - session.startClientX) / zoom) * 100) / 100,
      y: Math.round((session.startPosition.y + (event.clientY - session.startClientY) / zoom) * 100) / 100,
    };
    session.latestPosition = position;
    setPreviewPosition(position);
    return position;
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const position = updateDrag(event) ?? session.latestPosition;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!samePoint(position, canonicalPosition)) onMove?.(position);
  };

  return (
    <section
      className="nodrag nopan nowheel absolute z-30 min-w-44 max-w-64 overflow-hidden rounded-lg border border-slate-300 bg-white/95 text-slate-700 shadow-xl backdrop-blur"
      aria-label={sheet.markerLegend.title || '标记图例'}
      data-testid="mindmap-marker-legend-canvas"
      data-content-x={previewPosition.x}
      data-content-y={previewPosition.y}
      style={{
        left: viewport.x + previewPosition.x * viewport.zoom,
        top: viewport.y + previewPosition.y * viewport.zoom,
        transform: `scale(${viewport.zoom})`,
        transformOrigin: 'top left',
      }}
      onPointerMove={(event) => {
        if (updateDrag(event)) event.preventDefault();
      }}
      onPointerUp={finishDrag}
      onPointerCancel={(event) => {
        const session = dragRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setPreviewPosition(canonicalPosition);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
    >
      <header
        className={`border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold ${
          readOnly ? '' : 'cursor-grab touch-none active:cursor-grabbing'
        }`}
        aria-label={readOnly ? '标记图例标题' : '拖动标记图例'}
        onPointerDown={(event) => {
          if (readOnly || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const startPosition = { ...canonicalPosition };
          dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPosition,
            latestPosition: startPosition,
          };
          event.currentTarget.parentElement?.setPointerCapture?.(event.pointerId);
        }}
      >
        {sheet.markerLegend.title || '标记图例'}
      </header>
      <ul className="space-y-1 p-2" aria-label="标记图例项目">
        {definitionIds.map((definitionId) => {
          const definition = document.markerDefinitions[definitionId];
          if (!definition) {
            return <li key={definitionId} className="text-[10px] text-red-600">! 缺失标记 {definitionId}</li>;
          }
          const visual = markerVisual(definition);
          return (
            <li key={definition.id} className="flex items-center gap-1.5 text-[10px]" aria-label={definitionLabel(document, definition.id)}>
              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${visual.toneClassName}`} aria-hidden="true">
                <MarkerIcon visual={visual} size={12} />
              </span>
              <span className="truncate">{definition.name}</span>
              <span className="ml-auto truncate text-[9px] text-slate-400">
                {document.markerGroups[definition.groupId]?.name || '缺失分组'}
              </span>
            </li>
          );
        })}
        {definitionIds.length === 0 ? <li className="text-[10px] text-slate-400">暂无图例项目</li> : null}
      </ul>
    </section>
  );
};
