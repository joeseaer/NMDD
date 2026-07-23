import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, ImageId } from '../domain/types';
import type { ImageEnrichmentProjection } from './enrichmentProjection';
import { TOPIC_IMAGE_DRAG_MIME, TopicImages } from './TopicImages';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ASSET_ID = 'asset-images-source' as AssetId;

const projectedImage = (
  id: string,
  overrides: Partial<ImageEnrichmentProjection> = {},
): ImageEnrichmentProjection => ({
  id: id as ImageId,
  assetId: ASSET_ID,
  fileName: 'roadmap.png',
  mimeType: 'image/png',
  byteSize: 42,
  missingAsset: false,
  role: 'inline',
  placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
  size: { width: 200, height: 100 },
  intrinsicSize: { width: 400, height: 200 },
  displaySize: { width: 200, height: 100 },
  displaySizeSource: 'explicit',
  alt: 'Road map',
  rendererSource: { status: 'ready', url: 'https://cdn.example.test/roadmap.png' },
  ...overrides,
});

describe('TopicImages', () => {
  it('renders only ordinary images for the requested stack and isolates pointer selection', () => {
    const selected = vi.fn();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    const top = projectedImage('image-top');
    const bottom = projectedImage('image-bottom', {
      placement: { side: 'bottom', align: 'start', offset: { x: 2, y: 3 } },
    });
    const sticker = projectedImage('image-sticker', { role: 'sticker' });
    const deferredLeft = projectedImage('image-left', {
      placement: { side: 'left', align: 'center', offset: { x: 0, y: 0 } },
    });
    const before = JSON.stringify([top, bottom, sticker, deferredLeft]);

    render(
      <div onClick={parentClick} onPointerDown={parentPointerDown}>
        <TopicImages
          images={[top, bottom, sticker, deferredLeft]}
          side="top"
          selectedImageId={top.id}
          onSelect={selected}
        />
      </div>,
    );

    const item = screen.getByTestId(`topic-image-${top.id}`);
    const frame = screen.getByTestId(`topic-image-frame-${top.id}`);
    expect(screen.getByRole('img', { name: 'Road map' })).toHaveAttribute(
      'src',
      'https://cdn.example.test/roadmap.png',
    );
    expect(frame).toHaveStyle({ width: '200px', height: '100px' });
    expect(item).toHaveAttribute('data-topic-image-side', 'top');
    expect(item).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId(`topic-image-${bottom.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`topic-image-${sticker.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`topic-image-${deferredLeft.id}`)).not.toBeInTheDocument();

    fireEvent.pointerDown(item);
    fireEvent.click(item);
    expect(selected).toHaveBeenCalledWith(top.id);
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(JSON.stringify([top, bottom, sticker, deferredLeft])).toBe(before);
  });

  it('renders deterministic accessible placeholders without leaking unavailable locators', () => {
    const unavailable = projectedImage('image-managed', {
      fileName: 'managed.png',
      alt: undefined,
      rendererSource: { status: 'unavailable', reason: 'managed-source' },
    });

    const { container } = render(<TopicImages images={[unavailable]} side="top" />);

    expect(screen.getByRole('img', { name: 'managed.png（图片不可用）' }))
      .toHaveTextContent('图片不可用');
    expect(screen.getByTestId(`topic-image-unavailable-${unavailable.id}`))
      .toHaveAttribute('data-unavailable-reason', 'managed-source');
    expect(container.innerHTML).not.toContain('objectKey');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back accessibly after a remote load error and resets for a changed safe URL', () => {
    const first = projectedImage('image-load-error');
    const view = render(<TopicImages images={[first]} side="top" />);
    fireEvent.error(screen.getByTestId(`topic-image-content-${first.id}`));

    expect(screen.getByRole('img', { name: 'Road map（图片不可用）' }))
      .toBeInTheDocument();
    expect(screen.getByTestId(`topic-image-unavailable-${first.id}`))
      .toHaveAttribute('data-unavailable-reason', 'load-failed');

    const changed = projectedImage('image-load-error', {
      rendererSource: { status: 'ready', url: 'https://cdn.example.test/retry.png' },
    });
    view.rerender(<TopicImages images={[changed]} side="top" />);
    expect(screen.getByRole('img', { name: 'Road map' }))
      .toHaveAttribute('src', 'https://cdn.example.test/retry.png');
  });

  it('returns no wrapper for an empty or deferred-only side', () => {
    const deferred = projectedImage('image-overlay', {
      placement: { side: 'overlay', align: 'center', offset: { x: 0, y: 0 } },
    });
    const { container } = render(<TopicImages images={[deferred]} side="bottom" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders sticker sides separately with canonical offset and four-way controls', () => {
    const move = vi.fn();
    const sticker = projectedImage('image-sticker-right', {
      role: 'sticker',
      alt: '灵感灯泡',
      placement: { side: 'right', align: 'center', offset: { x: 6, y: -4 } },
      displaySize: { width: 84, height: 84 },
    });
    render(
      <TopicImages
        images={[sticker]}
        side="right"
        kind="sticker"
        selectedImageId={sticker.id}
        onMove={move}
      />,
    );

    expect(screen.getByTestId('topic-stickers-right')).toHaveAttribute(
      'data-topic-images-kind',
      'sticker',
    );
    expect(screen.getByTestId(`topic-image-frame-${sticker.id}`)).toHaveStyle({
      transform: 'translate(6px, -4px)',
    });
    expect(screen.getByRole('button', { name: '选择贴纸：灵感灯泡' }))
      .toHaveAttribute('data-topic-image-role', 'sticker');
    expect(screen.getByRole('button', { name: '将贴纸移到主题右侧' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '将贴纸移到主题左侧' }));
    expect(move).toHaveBeenCalledWith(sticker.id, 'left');
  });

  it('previews proportional pointer resize and commits exactly once on pointerup', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const resize = vi.fn();
    const image = projectedImage('image-resize');
    render(
      <TopicImages
        images={[image]}
        side="top"
        selectedImageId={image.id}
        onResizeCommit={resize}
      />,
    );

    const handle = screen.getByTestId(`topic-image-resize-handle-${image.id}`);
    const frame = screen.getByTestId(`topic-image-frame-${image.id}`);
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 130, clientY: 115 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 160, clientY: 130 });

    expect(resize).not.toHaveBeenCalled();
    expect(Number(frame.getAttribute('data-topic-image-preview-width'))).toBeGreaterThan(200);
    expect(Number(frame.getAttribute('data-topic-image-preview-height'))).toBeGreaterThan(100);

    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 160, clientY: 130 });
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(image.id, { width: 260, height: 130 });
  });

  it('emits only the stable internal image drag channel and disables it in read-only mode', () => {
    const image = projectedImage('image-drag');
    const move = vi.fn();
    const parentDragStart = vi.fn();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
    };
    const view = render(
      <div onDragStart={parentDragStart}>
        <TopicImages images={[image]} side="top" onMove={move} />
      </div>,
    );
    const item = screen.getByTestId(`topic-image-${image.id}`);

    expect(item).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(item, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledOnce();
    expect(dataTransfer.setData).toHaveBeenCalledWith(TOPIC_IMAGE_DRAG_MIME, image.id);
    expect(parentDragStart).not.toHaveBeenCalled();

    view.rerender(
      <div onDragStart={parentDragStart}>
        <TopicImages images={[image]} side="top" readOnly onMove={move} />
      </div>,
    );
    const readOnlyItem = screen.getByTestId(`topic-image-${image.id}`);
    expect(readOnlyItem).toHaveAttribute('draggable', 'false');
    expect(fireEvent.dragStart(readOnlyItem, { dataTransfer })).toBe(false);
    expect(dataTransfer.setData).toHaveBeenCalledTimes(1);
    expect(parentDragStart).not.toHaveBeenCalled();
  });

  it('exposes movement, reset, context-menu, and keyboard deletion only while editable', () => {
    const move = vi.fn();
    const reset = vi.fn();
    const remove = vi.fn();
    const image = projectedImage('image-controls');
    const view = render(
      <TopicImages
        images={[image]}
        side="top"
        selectedImageId={image.id}
        onMove={move}
        onResetSize={reset}
        onDelete={remove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '将图片移到主题下方' }));
    expect(move).toHaveBeenCalledWith(image.id, 'bottom');
    fireEvent.click(screen.getByRole('button', { name: '重置图片尺寸' }));
    expect(reset).toHaveBeenCalledWith(image.id);

    const item = screen.getByTestId(`topic-image-${image.id}`);
    fireEvent.contextMenu(item, { clientX: 24, clientY: 48 });
    const menu = screen.getByRole('menu', { name: '图片菜单' });
    expect(menu).toBeInTheDocument();
    expect(menu.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('menuitem', { name: '重置图片尺寸' }));
    expect(reset).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(item, { key: 'Delete' });
    expect(remove).toHaveBeenCalledWith(image.id);

    view.rerender(
      <TopicImages
        images={[image]}
        side="top"
        selectedImageId={image.id}
        readOnly
        onMove={move}
        onResetSize={reset}
        onDelete={remove}
      />,
    );
    expect(screen.getByRole('img', { name: 'Road map' })).toBeVisible();
    expect(screen.queryByTestId(`topic-image-controls-${image.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`topic-image-resize-handle-${image.id}`)).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId(`topic-image-${image.id}`));
    expect(screen.queryByRole('menu', { name: '图片菜单' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId(`topic-image-${image.id}`), { key: 'Delete' });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
