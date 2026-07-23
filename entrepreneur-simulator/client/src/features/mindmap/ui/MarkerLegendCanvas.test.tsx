import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SheetId } from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { MarkerLegendCanvas } from './MarkerLegendCanvas';

afterEach(cleanup);

const originalPointerEvent = globalThis.PointerEvent;
beforeAll(() => {
  if (!globalThis.PointerEvent) {
    Object.defineProperty(globalThis, 'PointerEvent', {
      configurable: true,
      value: MouseEvent,
    });
  }
});
afterAll(() => {
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: originalPointerEvent,
  });
});

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  return { document, sheetId };
};

describe('MarkerLegendCanvas', () => {
  it('renders readable names at transformed content coordinates, not color alone', () => {
    const { document, sheetId } = setup();
    render(
      <MarkerLegendCanvas
        document={document}
        sheetId={sheetId}
        readOnly={false}
        viewport={{ x: 10, y: 20, zoom: 0.5 }}
      />,
    );

    const legend = screen.getByTestId('mindmap-marker-legend-canvas');
    expect(legend).toHaveStyle({ left: '350px', top: '-90px', transform: 'scale(0.5)' });
    expect(legend).toHaveAttribute('data-content-x', '680');
    expect(screen.getByLabelText('Priority 1（Priority）')).toHaveTextContent('Priority 1');
    expect(screen.getByLabelText('Priority 1（Priority）')).toHaveTextContent('Priority');
  });

  it('keeps pointermove preview-only and emits exactly one content-coordinate move on pointerup', () => {
    const { document, sheetId } = setup();
    const onMove = vi.fn();
    render(
      <MarkerLegendCanvas
        document={document}
        sheetId={sheetId}
        readOnly={false}
        viewport={{ x: 0, y: 0, zoom: 2 }}
        onMove={onMove}
      />,
    );

    const legend = screen.getByTestId('mindmap-marker-legend-canvas');
    const handle = screen.getByLabelText('拖动标记图例');
    fireEvent.pointerDown(handle, {
      pointerId: 7,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(legend, { pointerId: 7, clientX: 120, clientY: 110 });
    fireEvent.pointerMove(legend, { pointerId: 7, clientX: 140, clientY: 120 });
    expect(onMove).not.toHaveBeenCalled();
    expect(legend).toHaveAttribute('data-content-x', '700');
    expect(legend).toHaveAttribute('data-content-y', '-210');

    fireEvent.pointerUp(legend, { pointerId: 7, clientX: 140, clientY: 120 });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ x: 700, y: -210 });
  });

  it('does not start a content drag in read-only mode and hides when visible=false', () => {
    const { document, sheetId } = setup();
    const onMove = vi.fn();
    const { rerender } = render(
      <MarkerLegendCanvas
        document={document}
        sheetId={sheetId}
        readOnly
        viewport={{ x: 0, y: 0, zoom: 1 }}
        onMove={onMove}
      />,
    );
    const legend = screen.getByTestId('mindmap-marker-legend-canvas');
    fireEvent.pointerDown(screen.getByLabelText('标记图例标题'), {
      pointerId: 2,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(legend, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(legend, { pointerId: 2, clientX: 100, clientY: 100 });
    expect(onMove).not.toHaveBeenCalled();

    document.sheets[sheetId].markerLegend.visible = false;
    rerender(
      <MarkerLegendCanvas
        document={document}
        sheetId={sheetId}
        readOnly
        viewport={{ x: 0, y: 0, zoom: 1 }}
      />,
    );
    expect(screen.queryByTestId('mindmap-marker-legend-canvas')).not.toBeInTheDocument();
  });
});
