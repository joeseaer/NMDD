// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordRecentlyUsedSticker } from '../catalog/stickerRecentStore';
import { STICKER_CATALOG_DRAG_MIME, StickerCatalogPanel } from './StickerCatalogPanel';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('StickerCatalogPanel', () => {
  it('inserts and drags only stable IDs from the licensed release manifest', () => {
    const insert = vi.fn();
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    render(<StickerCatalogPanel onClose={vi.fn()} onInsert={insert} />);

    const catalog = screen.getByTestId('mindmap-sticker-catalog');
    expect(catalog).toHaveAttribute('data-catalog-result-count', '468');
    expect(screen.getByText('468 项许可素材 · 13 类 · 同源安全导出')).toBeVisible();
    const sticker = screen.getByRole('button', { name: '插入贴纸：灵感灯泡' });
    fireEvent.click(sticker);
    expect(insert).toHaveBeenCalledWith('idea-lightbulb');
    fireEvent.dragStart(sticker, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      STICKER_CATALOG_DRAG_MIME,
      'idea-lightbulb',
    );
  });

  it('searches labels and aliases, then combines category and kind filters', () => {
    render(<StickerCatalogPanel onClose={vi.fn()} onInsert={vi.fn()} />);
    const catalog = screen.getByTestId('mindmap-sticker-catalog');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索贴纸与插画' }), {
      target: { value: '火箭' },
    });
    expect(catalog).toHaveAttribute('data-catalog-result-count', '1');
    expect(screen.getByRole('button', { name: '插入插画：火箭' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '清除贴纸搜索' }));
    fireEvent.change(screen.getByRole('combobox', { name: '筛选素材分类' }), {
      target: { value: 'travel' },
    });
    expect(catalog).toHaveAttribute('data-catalog-result-count', '36');
    fireEvent.change(screen.getByRole('combobox', { name: '筛选素材类型' }), {
      target: { value: 'illustration' },
    });
    expect(catalog).toHaveAttribute('data-catalog-result-count', '3');
  });

  it('keeps successful-use recents and user favorites outside the document', () => {
    render(<StickerCatalogPanel onClose={vi.fn()} onInsert={vi.fn()} />);
    act(() => {
      recordRecentlyUsedSticker('idea-lightbulb');
    });
    fireEvent.click(screen.getByRole('button', { name: '最近 1' }));
    expect(screen.getByTestId('mindmap-sticker-catalog'))
      .toHaveAttribute('data-catalog-result-count', '1');
    expect(screen.getByRole('button', { name: '插入贴纸：灵感灯泡' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '收藏：灵感灯泡' }));
    fireEvent.click(screen.getByRole('button', { name: '收藏 1' }));
    expect(screen.getByTestId('mindmap-sticker-catalog'))
      .toHaveAttribute('data-catalog-result-count', '1');
    expect(screen.getByRole('button', { name: '取消收藏：灵感灯泡' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('uses a four-column roving keyboard grid and Escape clears before closing', () => {
    const close = vi.fn();
    render(<StickerCatalogPanel onClose={close} onInsert={vi.fn()} />);
    const first = screen.getByRole('grid', { name: '贴纸与插画搜索结果' })
      .querySelector<HTMLButtonElement>('[data-catalog-grid-index="0"]');
    expect(first).not.toBeNull();
    if (!first) throw new Error('Catalog has no first grid item.');
    first.focus();
    fireEvent.keyDown(screen.getByRole('grid', { name: '贴纸与插画搜索结果' }), {
      key: 'ArrowRight',
    });
    expect(document.activeElement).toHaveAttribute('data-catalog-grid-index', '1');

    const search = screen.getByRole('searchbox', { name: '搜索贴纸与插画' });
    fireEvent.change(search, { target: { value: '火箭' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('blocks insert and drag while read-only or busy', () => {
    const insert = vi.fn();
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    const view = render(
      <StickerCatalogPanel readOnly onClose={vi.fn()} onInsert={insert} />,
    );
    const sticker = screen.getByRole('button', { name: '插入贴纸：灵感灯泡' });
    expect(sticker).toBeDisabled();
    expect(fireEvent.dragStart(sticker, { dataTransfer })).toBe(false);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(screen.getByText('只读模式可浏览目录，但不能插入或拖放素材。')).toBeVisible();

    view.rerender(
      <StickerCatalogPanel busy onClose={vi.fn()} onInsert={insert} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('正在添加贴纸');
  });
});
