import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  BoundaryId,
  CalloutId,
  RelationshipId,
  SummaryId,
  TopicId,
  ZoneId,
} from '../domain/types';
import type {
  SemanticGeometryPath,
  SemanticOverlayGeometryModel,
} from '../render/geometry';
import {
  semanticGeometryPathToSvg,
  SemanticOverlaySvgContents,
} from './SemanticOverlaySvg';

const IDS = {
  zone: '018f0000-0000-7000-8000-000000000505' as ZoneId,
  boundary: '018f0000-0000-7000-8000-000000000506' as BoundaryId,
  summary: '018f0000-0000-7000-8000-000000000507' as SummaryId,
  callout: '018f0000-0000-7000-8000-000000000501' as CalloutId,
  relationship: '018f0000-0000-7000-8000-000000000502' as RelationshipId,
  source: '018f0000-0000-7000-8000-000000000503' as TopicId,
  target: '018f0000-0000-7000-8000-000000000504' as TopicId,
};

const path: SemanticGeometryPath = {
  commands: [
    { kind: 'move', to: { x: 0, y: 1.5 } },
    { kind: 'line', to: { x: 10, y: 5 } },
    { kind: 'quadratic', control: { x: 14, y: 8 }, to: { x: 18, y: 4 } },
    {
      kind: 'cubic',
      control1: { x: 20, y: 2 },
      control2: { x: 24, y: 6 },
      to: { x: 30, y: 5 },
    },
  ],
  hitPolyline: [{ x: 0, y: 1.5 }, { x: 30, y: 5 }],
  bounds: { x: 0, y: 1.5, width: 30, height: 3.5 },
};

const geometry: SemanticOverlayGeometryModel = {
  topicRects: {},
  zones: [{
    kind: 'zone',
    entityId: IDS.zone,
    visibility: 'visible',
    visibleRootTopicIds: [IDS.source],
    hiddenRootTopicIds: [],
    rect: { x: -20, y: -20, width: 340, height: 100 },
    bounds: { x: -20, y: -20, width: 340, height: 100 },
    hitRegions: [{ kind: 'rect', rect: { x: -20, y: -20, width: 340, height: 100 } }],
  }],
  boundaries: [{
    kind: 'boundary',
    entityId: IDS.boundary,
    visibility: 'visible',
    memberTopicIds: [IDS.source],
    hiddenTopicIds: [],
    unresolvedTopicIds: [],
    frame: { x: -10, y: -10, width: 120, height: 60 },
    outline: path,
    bounds: path.bounds,
    hitRegions: [{ kind: 'path', polyline: path.hitPolyline, tolerance: 8 }],
  }],
  summaries: [{
    kind: 'summary',
    entityId: IDS.summary,
    visibility: 'visible',
    memberTopicIds: [IDS.source],
    hiddenTopicIds: [],
    unresolvedTopicIds: [],
    resultTopicId: IDS.target,
    orientation: 'right',
    bracket: path,
    resultConnector: path,
    bounds: path.bounds,
    hitRegions: [{ kind: 'path', polyline: path.hitPolyline, tolerance: 8 }],
  }],
  callouts: [{
    kind: 'callout',
    entityId: IDS.callout,
    visibility: 'visible',
    targetTopicId: IDS.source,
    placementSide: 'right',
    targetAnchor: { x: 40, y: 40 },
    bubbleAnchor: { x: 80, y: 40 },
    bubble: { x: 60, y: 20, width: 120, height: 48 },
    tail: path,
    bounds: { x: 0, y: 1.5, width: 180, height: 66.5 },
    hitRegions: [{ kind: 'rect', rect: { x: 60, y: 20, width: 120, height: 48 } }],
  }],
  relationships: [{
    kind: 'relationship',
    entityId: IDS.relationship,
    visibility: 'visible',
    routing: 'curve',
    startArrow: 'circle',
    endArrow: 'triangle',
    source: {
      targetKind: 'topic',
      entityId: IDS.source,
      visibility: 'visible',
      requestedAnchor: 'auto',
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      point: { x: 100, y: 20 },
    },
    target: {
      targetKind: 'topic',
      entityId: IDS.target,
      visibility: 'visible',
      requestedAnchor: 'auto',
      bounds: { x: 200, y: 0, width: 100, height: 40 },
      point: { x: 200, y: 20 },
    },
    controlPoints: [],
    path,
    bounds: path.bounds,
    hitRegions: [{ kind: 'path', polyline: path.hitPolyline, tolerance: 8 }],
  }],
  ordered: [],
};

describe('SemanticOverlaySvg', () => {
  it('converts every renderer-neutral path command to stable SVG syntax', () => {
    expect(semanticGeometryPathToSvg({
      ...path,
      commands: [...path.commands, { kind: 'close' }],
    })).toBe('M 0 1.5 L 10 5 Q 14 8 18 4 C 20 2 24 6 30 5 Z');
  });

  it('tracks the React Flow viewport and exposes selectable semantic shapes', () => {
    const onSelect = vi.fn();
    render(
      <SemanticOverlaySvgContents
        geometry={geometry}
        viewport={{ x: 12, y: -8, zoom: 1.5 }}
        labels={{
          [IDS.boundary]: 'Boundary range',
          [IDS.callout]: '风险提示',
          [IDS.relationship]: '因果关系',
        }}
        styles={{
          [IDS.callout]: {
            opacity: 0.8,
            fill: '#ECFCCB',
            fillOpacity: 0.6,
            stroke: '#65A30D',
            strokeWidth: 4,
            borderRadius: 18,
            color: '#365314',
          },
          [IDS.relationship]: {
            opacity: 0.7,
            stroke: '#0F766E',
            strokeWidth: 5,
            strokeDasharray: '3 2',
          },
        }}
        onSelect={onSelect}
      />,
    );

    const overlay = screen.getByTestId('mindmap-semantic-overlay');
    expect(overlay.querySelector('g')).toHaveAttribute(
      'transform',
      'translate(12 -8) scale(1.5)',
    );
    expect(screen.getByText('风险提示')).toBeInTheDocument();
    expect(screen.getByText('因果关系')).toBeInTheDocument();

    const relationshipPath = overlay.querySelector(
      `[data-semantic-kind="relationship"][data-entity-id="${IDS.relationship}"] > path`,
    );
    expect(relationshipPath).not.toBeNull();
    expect(relationshipPath).toHaveAttribute('stroke', '#0F766E');
    expect(relationshipPath).toHaveAttribute('stroke-dasharray', '3 2');
    expect(relationshipPath).toHaveAttribute(
      'marker-start',
      `url(#mindmap-relationship-${IDS.relationship}-start)`,
    );
    expect(relationshipPath).toHaveAttribute(
      'marker-end',
      `url(#mindmap-relationship-${IDS.relationship}-end)`,
    );
    fireEvent.pointerDown(relationshipPath!);
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'relationship',
      id: IDS.relationship,
    });
    expect(overlay.querySelector('[data-semantic-kind="callout"] rect')).toHaveAttribute(
      'fill',
      '#ECFCCB',
    );
  });

  it('opens context menus for every semantic hit shape with native coordinates and modifiers', () => {
    const onContextMenu = vi.fn();
    const parentContextMenu = vi.fn();
    const { container } = render(
      <div onContextMenu={parentContextMenu}>
        <SemanticOverlaySvgContents
          geometry={geometry}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onContextMenu={onContextMenu}
        />
      </div>,
    );

    const overlay = container.querySelector('[data-testid="mindmap-semantic-overlay"]')!;
    const targets = [
      {
        element: overlay.querySelector('[data-semantic-kind="zone"] > rect'),
        selection: { kind: 'zone', id: IDS.zone },
      },
      {
        element: overlay.querySelector('[data-semantic-kind="boundary"]'),
        selection: { kind: 'boundary', id: IDS.boundary },
      },
      {
        element: overlay.querySelector('[data-summary-part="bracket"]'),
        selection: { kind: 'summary', id: IDS.summary },
      },
      {
        element: overlay.querySelector('[data-semantic-kind="callout"] > rect'),
        selection: { kind: 'callout', id: IDS.callout },
      },
      {
        element: overlay.querySelector('[data-semantic-kind="relationship"] > path'),
        selection: { kind: 'relationship', id: IDS.relationship },
      },
    ] as const;

    targets.forEach(({ element }, index) => {
      expect(element).not.toBeNull();
      expect(fireEvent.contextMenu(element!, {
        clientX: 120 + index,
        clientY: 240 + index,
        altKey: index === 0,
        ctrlKey: index === 1,
        metaKey: index === 2,
        shiftKey: index === 3,
      })).toBe(false);
    });

    expect(parentContextMenu).not.toHaveBeenCalled();
    targets.forEach(({ selection }, index) => {
      expect(onContextMenu).toHaveBeenNthCalledWith(index + 1, selection, {
        clientX: 120 + index,
        clientY: 240 + index,
        altKey: index === 0,
        ctrlKey: index === 1,
        metaKey: index === 2,
        shiftKey: index === 3,
      });
    });
  });

  it('keeps summary connector context menus and existing left-click selection behavior', () => {
    const onContextMenu = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <SemanticOverlaySvgContents
        geometry={geometry}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onContextMenu={onContextMenu}
        onSelect={onSelect}
      />,
    );

    const overlay = container.querySelector('[data-testid="mindmap-semantic-overlay"]')!;
    const summaryPaths = overlay.querySelectorAll('[data-summary-part]');
    expect(summaryPaths).toHaveLength(2);
    expect(summaryPaths[0]).toHaveAttribute('data-summary-part', 'bracket');
    expect(summaryPaths[0]).toHaveAttribute('role', 'button');
    expect(summaryPaths[0]).toHaveAttribute('tabindex', '0');
    expect(summaryPaths[1]).toHaveAttribute('data-summary-part', 'connector');
    fireEvent.contextMenu(summaryPaths[1], { clientX: 9, clientY: 13 });
    expect(onContextMenu).toHaveBeenCalledWith(
      { kind: 'summary', id: IDS.summary },
      expect.objectContaining({ clientX: 9, clientY: 13 }),
    );

    const callout = overlay.querySelector('[data-semantic-kind="callout"] > rect');
    fireEvent.pointerDown(callout!, { button: 0 });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'callout', id: IDS.callout });
  });

  it('makes selected Summaries easy to remove directly from the canvas', () => {
    const onDelete = vi.fn();
    const { container } = render(
      <SemanticOverlaySvgContents
        geometry={geometry}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        currentSelection={{ kind: 'summary', id: IDS.summary }}
        onDelete={onDelete}
      />,
    );

    const hitTarget = container.querySelector('[data-testid="mindmap-semantic-overlay"]')!
      .querySelector('[data-summary-hit-part="bracket"]');
    expect(hitTarget).toHaveAttribute('stroke-width', '28');

    const deleteButton = screen.getByTestId(`mindmap-summary-delete-${IDS.summary}`);
    expect(deleteButton).toHaveAttribute('role', 'button');
    fireEvent.pointerDown(deleteButton, { button: 0 });
    expect(onDelete).toHaveBeenCalledWith({ kind: 'summary', id: IDS.summary });
  });

  it('places Summary range handles on bracket endpoints and lands on real sibling centers', () => {
    const onSummaryRangeDrag = vi.fn();
    const bracket: SemanticGeometryPath = {
      commands: [
        { kind: 'move', to: { x: 8, y: 10 } },
        { kind: 'line', to: { x: 0, y: 10 } },
        { kind: 'line', to: { x: 0, y: 120 } },
        { kind: 'line', to: { x: 8, y: 120 } },
      ],
      hitPolyline: [{ x: 8, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 120 }, { x: 8, y: 120 }],
      bounds: { x: 0, y: 10, width: 8, height: 110 },
    };
    const summaryGeometry: SemanticOverlayGeometryModel = {
      ...geometry,
      summaries: [{
        ...geometry.summaries[0],
        orientation: 'right',
        bracket,
      }],
    };
    const { rerender } = render(
      <SemanticOverlaySvgContents
        currentSelection={{ kind: 'summary', id: IDS.summary }}
        geometry={summaryGeometry}
        summaryRangeAdjustableIds={new Set([IDS.summary])}
        summaryRangeHandleSpecs={{
          [IDS.summary]: {
            axis: 'vertical',
            stepSpacing: 40,
            firstIndex: 1,
            lastIndex: 2,
            siblingTargets: [
              { edgeId: 'summary-edge-0', index: 0, center: 10 },
              { edgeId: 'summary-edge-1', index: 1, center: 45 },
              { edgeId: 'summary-edge-2', index: 2, center: 120 },
              { edgeId: 'summary-edge-3', index: 3, center: 210 },
            ],
            start: { outwardSteps: 1, inwardSteps: 1 },
            end: { outwardSteps: 1, inwardSteps: 1 },
          },
        }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onSummaryRangeDrag={onSummaryRangeDrag}
      />,
    );

    const start = screen.getByTestId(`mindmap-summary-range-handle-start-${IDS.summary}`);
    const end = screen.getByTestId(`mindmap-summary-range-handle-end-${IDS.summary}`);
    expect(start).toHaveAttribute('cx', '0');
    expect(start).toHaveAttribute('cy', '10');
    expect(start).toHaveAttribute('data-summary-range-handle', 'start');
    expect(start).toHaveAttribute('data-summary-range-axis', 'vertical');
    expect(start).toHaveAttribute('data-current-edge-id', 'summary-edge-1');
    expect(end).toHaveAttribute('cx', '0');
    expect(end).toHaveAttribute('cy', '120');

    fireEvent(start, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 45,
    }));
    fireEvent(start, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 0, clientY: 10,
    }));
    expect(onSummaryRangeDrag).toHaveBeenCalledWith(
      IDS.summary,
      'start',
      'outward',
      1,
    );

    rerender(
      <SemanticOverlaySvgContents
        currentSelection={{ kind: 'summary', id: IDS.summary }}
        geometry={summaryGeometry}
        readOnly
        summaryRangeAdjustableIds={new Set([IDS.summary])}
        summaryRangeHandleSpecs={{
          [IDS.summary]: {
            axis: 'vertical',
            stepSpacing: 40,
            firstIndex: 1,
            lastIndex: 2,
            siblingTargets: [],
            start: { outwardSteps: 1, inwardSteps: 1 },
            end: { outwardSteps: 1, inwardSteps: 1 },
          },
        }}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onSummaryRangeDrag={onSummaryRangeDrag}
      />,
    );
    expect(screen.queryByTestId(`mindmap-summary-range-handle-start-${IDS.summary}`))
      .not.toBeInTheDocument();
  });

  it.each([
    ['left', 'vertical', { x: 20, y: 10 }, { x: 20, y: 120 }],
    ['right', 'vertical', { x: 180, y: 10 }, { x: 180, y: 120 }],
    ['top', 'horizontal', { x: 20, y: 10 }, { x: 180, y: 10 }],
    ['bottom', 'horizontal', { x: 20, y: 120 }, { x: 180, y: 120 }],
  ] as const)(
    'anchors %s Summary handles to the first and last bracket endpoints',
    (orientation, axis, startPoint, endPoint) => {
      const bracket: SemanticGeometryPath = {
        commands: [
          { kind: 'move', to: axis === 'vertical'
            ? { x: startPoint.x + 8, y: startPoint.y }
            : { x: startPoint.x, y: startPoint.y + 8 } },
          { kind: 'line', to: startPoint },
          { kind: 'line', to: endPoint },
          { kind: 'line', to: axis === 'vertical'
            ? { x: endPoint.x + 8, y: endPoint.y }
            : { x: endPoint.x, y: endPoint.y + 8 } },
        ],
        hitPolyline: [startPoint, endPoint],
        bounds: {
          x: Math.min(startPoint.x, endPoint.x),
          y: Math.min(startPoint.y, endPoint.y),
          width: Math.abs(endPoint.x - startPoint.x),
          height: Math.abs(endPoint.y - startPoint.y),
        },
      };
      const { container } = render(
        <SemanticOverlaySvgContents
          currentSelection={{ kind: 'summary', id: IDS.summary }}
          geometry={{
            ...geometry,
            summaries: [{ ...geometry.summaries[0], orientation, bracket }],
          }}
          summaryRangeAdjustableIds={new Set([IDS.summary])}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onSummaryRangeDrag={vi.fn()}
        />,
      );
      const start = container.querySelector(
        `[data-testid="mindmap-summary-range-handle-start-${IDS.summary}"]`,
      );
      const end = container.querySelector(
        `[data-testid="mindmap-summary-range-handle-end-${IDS.summary}"]`,
      );
      expect(start).toHaveAttribute('cx', String(startPoint.x));
      expect(start).toHaveAttribute('cy', String(startPoint.y));
      expect(end).toHaveAttribute('cx', String(endPoint.x));
      expect(end).toHaveAttribute('cy', String(endPoint.y));
    },
  );

  it('lands selected range handles on nearest unequal sibling centers in one update', () => {
    const onBoundaryRangeDrag = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = render(
      <SemanticOverlaySvgContents
        boundaryRangeAdjustableIds={new Set([IDS.boundary])}
        boundaryRangeHandleSpecs={{
          [IDS.boundary]: {
            axis: 'horizontal',
            stepSpacing: 40,
            firstIndex: 2,
            lastIndex: 3,
            siblingTargets: [
              { edgeId: 'edge-0', index: 0, center: 10 },
              { edgeId: 'edge-1', index: 1, center: 80 },
              { edgeId: 'edge-2', index: 2, center: 210 },
              { edgeId: 'edge-3', index: 3, center: 600 },
              { edgeId: 'edge-4', index: 4, center: 1_000 },
            ],
            start: { outwardSteps: 2, inwardSteps: 1 },
            end: { outwardSteps: 1, inwardSteps: 1 },
          },
        }}
        currentSelection={{ kind: 'boundary', id: IDS.boundary }}
        geometry={geometry}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onBoundaryRangeDrag={onBoundaryRangeDrag}
        onSelect={onSelect}
      />,
    );

    const start = screen.getByTestId(
      `mindmap-boundary-range-handle-start-${IDS.boundary}`,
    );
    const end = screen.getByTestId(
      `mindmap-boundary-range-handle-end-${IDS.boundary}`,
    );
    expect(start).toHaveAttribute('data-boundary-range-handle', 'start');
    expect(start).toHaveAttribute('data-boundary-id', IDS.boundary);
    expect(start).toHaveAttribute('data-current-edge-id', 'edge-2');

    fireEvent(start, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 210, clientY: 30,
    }));
    fireEvent(start, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 80, clientY: 30,
    }));
    expect(onBoundaryRangeDrag).toHaveBeenNthCalledWith(
      1,
      IDS.boundary,
      'start',
      'outward',
      1,
    );
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent(start, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 210, clientY: 30,
    }));
    fireEvent(start, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 10, clientY: 30,
    }));
    expect(onBoundaryRangeDrag).toHaveBeenNthCalledWith(
      2,
      IDS.boundary,
      'start',
      'outward',
      2,
    );
    fireEvent(end, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 600, clientY: 30,
    }));
    fireEvent(end, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 210, clientY: 30,
    }));
    expect(onBoundaryRangeDrag).toHaveBeenNthCalledWith(
      3,
      IDS.boundary,
      'end',
      'inward',
      1,
    );
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(onBoundaryRangeDrag).toHaveBeenNthCalledWith(
      4,
      IDS.boundary,
      'start',
      'inward',
      1,
    );

    onBoundaryRangeDrag.mockClear();
    rerender(
      <SemanticOverlaySvgContents
        boundaryRangeHandleSpecs={{
          [IDS.boundary]: {
            axis: 'horizontal',
            stepSpacing: 40,
            firstIndex: 0,
            lastIndex: 0,
            siblingTargets: [{ edgeId: 'edge-0', index: 0, center: 10 }],
            start: { outwardSteps: 0, inwardSteps: 0 },
            end: { outwardSteps: 0, inwardSteps: 0 },
          },
        }}
        currentSelection={{ kind: 'boundary', id: IDS.boundary }}
        geometry={geometry}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onBoundaryRangeDrag={onBoundaryRangeDrag}
      />,
    );
    const edgeStart = screen.getByTestId(
      `mindmap-boundary-range-handle-start-${IDS.boundary}`,
    );
    expect(edgeStart).toHaveAttribute('data-outward-steps', '0');
    fireEvent(edgeStart, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 100, clientY: 30,
    }));
    fireEvent(edgeStart, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 60, clientY: 30,
    }));
    expect(onBoundaryRangeDrag).not.toHaveBeenCalled();

    rerender(
      <SemanticOverlaySvgContents
        boundaryRangeAdjustableIds={new Set([IDS.boundary])}
        currentSelection={{ kind: 'boundary', id: IDS.boundary }}
        geometry={geometry}
        readOnly
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onBoundaryRangeDrag={onBoundaryRangeDrag}
      />,
    );
    expect(screen.queryByTestId(
      `mindmap-boundary-range-handle-start-${IDS.boundary}`,
    )).not.toBeInTheDocument();
  });

  it('renders eight Boundary frame handles and commits one zoom-aware resize', () => {
    const onBoundaryFrameResize = vi.fn();
    const resizableGeometry: SemanticOverlayGeometryModel = {
      ...geometry,
      boundaries: geometry.boundaries.map((item) => ({
        ...item,
        memberBounds: { x: 0, y: 0, width: 100, height: 40 },
      })),
    };
    const { container, rerender } = render(
      <SemanticOverlaySvgContents
        currentSelection={{ kind: 'boundary', id: IDS.boundary }}
        geometry={resizableGeometry}
        viewport={{ x: 0, y: 0, zoom: 2 }}
        onBoundaryFrameResize={onBoundaryFrameResize}
      />,
    );

    expect(container.querySelectorAll('[data-boundary-frame-handle]')).toHaveLength(8);
    const east = screen.getByTestId(
      `mindmap-boundary-frame-handle-e-${IDS.boundary}`,
    );
    fireEvent(east, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 220, clientY: 40,
    }));
    fireEvent(east, new MouseEvent('pointermove', {
      bubbles: true, button: 0, clientX: 260, clientY: 40,
    }));
    expect(screen.getByTestId(`mindmap-boundary-frame-preview-${IDS.boundary}`))
      .toHaveAttribute('width', '140');
    fireEvent(east, new MouseEvent('pointerup', {
      bubbles: true, button: 0, clientX: 260, clientY: 40,
    }));
    expect(onBoundaryFrameResize).toHaveBeenCalledTimes(1);
    expect(onBoundaryFrameResize).toHaveBeenCalledWith(IDS.boundary, {
      x: -10,
      y: -10,
      width: 140,
      height: 60,
    });

    rerender(
      <SemanticOverlaySvgContents
        currentSelection={{ kind: 'boundary', id: IDS.boundary }}
        geometry={resizableGeometry}
        readOnly
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onBoundaryFrameResize={onBoundaryFrameResize}
      />,
    );
    expect(container.querySelectorAll('[data-boundary-frame-handle]')).toHaveLength(0);
  });
});
