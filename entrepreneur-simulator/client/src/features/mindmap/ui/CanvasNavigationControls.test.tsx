import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactFlowInstance } from 'reactflow';

import {
  calculateSafeFitViewport,
  CanvasNavigationControls,
  clampCanvasZoom,
  createReactFlowCanvasNavigationHandlers,
  DEFAULT_CANVAS_SAFE_AREA,
  formatCanvasZoomPercentage,
  offsetViewportForSafeArea,
  parseCanvasZoomPercentage,
  resolveCanvasSafeArea,
} from './CanvasNavigationControls';

afterEach(cleanup);

describe('canvas navigation geometry', () => {
  it('parses, formats and clamps the full 10%–500% range', () => {
    expect(parseCanvasZoomPercentage('10%')).toBe(0.1);
    expect(parseCanvasZoomPercentage(' 125.5％ ')).toBe(1.255);
    expect(parseCanvasZoomPercentage('750')).toBe(5);
    expect(parseCanvasZoomPercentage('-20%')).toBe(0.1);
    expect(parseCanvasZoomPercentage('not-a-number')).toBeNull();
    expect(formatCanvasZoomPercentage(1.255)).toBe('125.5%');
    expect(clampCanvasZoom(Number.NaN)).toBe(1);
  });

  it('fits bounds inside asymmetric left/right safe areas', () => {
    const viewport = calculateSafeFitViewport({
      bounds: { x: 0, y: 0, width: 400, height: 200 },
      viewportSize: { width: 1_000, height: 600 },
      safeArea: { left: 48, right: 300, top: 16, bottom: 16 },
      padding: 20,
    });

    expect(viewport).toEqual({ x: 68, y: 147, zoom: 1.53 });
    const screenLeft = viewport.x;
    const screenRight = viewport.x + 400 * viewport.zoom;
    expect(screenLeft).toBeGreaterThanOrEqual(48 + 20);
    expect(screenRight).toBeLessThanOrEqual(1_000 - 300 - 20);
    expect(DEFAULT_CANVAS_SAFE_AREA.left).toBe(48);
  });

  it('normalizes invalid insets and rejects unsafe fit inputs', () => {
    expect(resolveCanvasSafeArea({ left: Number.NaN, right: -1, bottom: 0 })).toEqual({
      top: 16,
      right: 16,
      bottom: 0,
      left: 48,
    });
    expect(() => calculateSafeFitViewport({
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      viewportSize: { width: 0, height: 600 },
    })).toThrow(RangeError);
    expect(offsetViewportForSafeArea(
      { x: -10, y: 20, zoom: 1.2 },
      { left: 48, right: 200, top: 20, bottom: 60 },
    )).toEqual({ x: -86, y: 0, zoom: 1.2 });
  });

  it('adapts exact Safe Fit and fallback offset to a ReactFlowInstance', () => {
    const instance = {
      getNodes: vi.fn(() => []),
      getViewport: vi.fn(() => ({ x: -10, y: 20, zoom: 1.2 })),
      fitView: vi.fn(() => true),
      setViewport: vi.fn(),
      zoomTo: vi.fn(),
    } as unknown as ReactFlowInstance;
    const handlers = createReactFlowCanvasNavigationHandlers(instance, {
      safeArea: { left: 48, right: 300 },
      getViewportSize: () => ({ width: 1_000, height: 600 }),
      getContentBounds: () => ({ x: 0, y: 0, width: 400, height: 200 }),
      fitPadding: 20,
      duration: 120,
    });

    handlers.onFitView();
    expect(instance.fitView).not.toHaveBeenCalled();
    expect(instance.setViewport).toHaveBeenCalledWith(
      { x: 68, y: 147, zoom: 1.53 },
      { duration: 120 },
    );
    handlers.onZoomChange(9);
    expect(instance.zoomTo).toHaveBeenCalledWith(5, { duration: 120 });
    handlers.onResetZoom();
    expect(instance.zoomTo).toHaveBeenLastCalledWith(1, { duration: 120 });

    vi.mocked(instance.setViewport).mockClear();
    const fallback = createReactFlowCanvasNavigationHandlers(instance, {
      safeArea: { left: 48, right: 200, top: 20, bottom: 60 },
      duration: 80,
    });
    fallback.onFitView();
    expect(instance.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: 0.12,
      duration: 0,
    }));
    expect(instance.setViewport).toHaveBeenCalledWith(
      { x: -86, y: 0, zoom: 1.2 },
      { duration: 80 },
    );
  });
});

describe('CanvasNavigationControls', () => {
  it('exposes keyboard-accessible zoom, Fit, 100%, and focus controls', () => {
    const onZoomChange = vi.fn();
    const onFitView = vi.fn();
    const onResetZoom = vi.fn();
    const onFocusBranch = vi.fn();
    const onExitFocusBranch = vi.fn();
    const { rerender } = render(
      <CanvasNavigationControls
        zoom={1.25}
        safeArea={{ left: 96, right: 320 }}
        canFocusBranch
        onZoomChange={onZoomChange}
        onFitView={onFitView}
        onResetZoom={onResetZoom}
        onFocusBranch={onFocusBranch}
        onExitFocusBranch={onExitFocusBranch}
      />,
    );

    const toolbar = screen.getByRole('toolbar', { name: '画布导航' });
    expect(toolbar).toHaveStyle({ left: '96px', bottom: '16px' });
    expect(toolbar).toHaveAttribute('data-safe-area-right', '320');
    expect(screen.getByRole('textbox', { name: '缩放百分比' })).toHaveValue('125%');

    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.15);
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.35);
    fireEvent.click(screen.getByRole('button', { name: '适应安全画布' }));
    expect(onFitView).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重置为 100%' }));
    expect(onResetZoom).toHaveBeenCalledOnce();

    const focusButton = screen.getByRole('button', { name: '聚焦分支' });
    expect(focusButton).toHaveAttribute('title', '仅显示所选分支（Ctrl+;）');
    fireEvent.click(focusButton);
    expect(onFocusBranch).toHaveBeenCalledOnce();

    rerender(
      <CanvasNavigationControls
        zoom={1.25}
        isBranchFocused
        focusedBranchLabel="Roadmap"
        onZoomChange={onZoomChange}
        onFitView={onFitView}
        onFocusBranch={onFocusBranch}
        onExitFocusBranch={onExitFocusBranch}
      />,
    );
    const exitButton = screen.getByRole('button', { name: '退出聚焦' });
    expect(exitButton).toHaveAttribute('aria-pressed', 'true');
    expect(exitButton).toHaveAttribute('title', '退出仅显示分支：Roadmap');
    fireEvent.click(exitButton);
    expect(onExitFocusBranch).toHaveBeenCalledOnce();
  });

  it('commits percentage input, clamps it, cancels with Escape, and disables limits', () => {
    const onZoomChange = vi.fn();
    const props = {
      onZoomChange,
      onFitView: vi.fn(),
    };
    const { rerender } = render(<CanvasNavigationControls zoom={1} {...props} />);
    const input = screen.getByRole('textbox', { name: '缩放百分比' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '650%' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onZoomChange).toHaveBeenLastCalledWith(5);
    expect(input).toHaveValue('500%');

    onZoomChange.mockClear();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '42%' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onZoomChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('100%');

    rerender(<CanvasNavigationControls zoom={0.1} {...props} />);
    expect(screen.getByRole('button', { name: '缩小' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '聚焦分支' })).toBeDisabled();
    rerender(<CanvasNavigationControls zoom={5} {...props} />);
    expect(screen.getByRole('button', { name: '放大' })).toBeDisabled();
  });
});
