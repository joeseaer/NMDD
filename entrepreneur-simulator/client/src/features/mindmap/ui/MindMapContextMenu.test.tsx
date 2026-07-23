import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SummaryId, TopicId } from '../domain/types';
import {
  MindMapContextMenu,
  type MindMapContextMenuCapabilities,
  type MindMapContextMenuProps,
} from './MindMapContextMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const topicTarget = { kind: 'topic' as const, id: 'topic-a' as TopicId };

const capabilities: Required<MindMapContextMenuCapabilities> = {
  editTitle: true,
  addChildTopic: true,
  addNextSiblingTopic: true,
  addPreviousSiblingTopic: true,
  insertParentTopic: true,
  copy: true,
  cut: true,
  paste: true,
  deleteElement: true,
  deleteCurrentTopic: true,
  deleteBranch: true,
  toggleCollapse: true,
  createRelationship: true,
  createBoundary: true,
  createSummary: true,
  createCallout: true,
  openFormat: true,
};

const callbacks = () => ({
  onEditTitle: vi.fn(),
  onAddChildTopic: vi.fn(),
  onAddNextSiblingTopic: vi.fn(),
  onAddPreviousSiblingTopic: vi.fn(),
  onInsertParentTopic: vi.fn(),
  onCopy: vi.fn(),
  onCut: vi.fn(),
  onPaste: vi.fn(),
  onDeleteElement: vi.fn(),
  onDeleteCurrentTopic: vi.fn(),
  onDeleteBranch: vi.fn(),
  onToggleCollapse: vi.fn(),
  onCreateRelationship: vi.fn(),
  onCreateBoundary: vi.fn(),
  onCreateSummary: vi.fn(),
  onCreateCallout: vi.fn(),
  onOpenFormat: vi.fn(),
});

const renderMenu = (overrides: Partial<MindMapContextMenuProps> = {}) => {
  const actionCallbacks = callbacks();
  const props: MindMapContextMenuProps = {
    open: true,
    anchor: { clientX: 120, clientY: 80 },
    target: topicTarget,
    selectionCount: 1,
    readOnly: false,
    capabilities,
    ...actionCallbacks,
    onClose: vi.fn(),
    ...overrides,
  };
  const result = render(<MindMapContextMenu {...props} />);
  return { ...result, props, actionCallbacks };
};

describe('MindMapContextMenu', () => {
  it('shows the complete topic command surface and the current fold state', () => {
    renderMenu({ collapsed: true });

    expect(screen.getByRole('menu', { name: '思维导图上下文菜单' }))
      .toHaveAttribute('data-target-kind', 'topic');
    for (const label of [
      '编辑标题',
      '新增子主题',
      '后置同级主题',
      '前置同级主题',
      '插入父主题',
      '复制',
      '剪切',
      '粘贴',
      '仅删除当前主题',
      '删除分支',
      '展开分支',
      '创建关系线',
      '创建边界',
      '创建概要',
      '创建标注',
      '打开格式',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('separator')).toHaveLength(5);
  });

  it('renders target-specific commands for blank canvas and semantic elements', () => {
    const { rerender, props } = renderMenu({ target: null, selectionCount: 0 });

    expect(screen.getByTestId('mindmap-context-menu')).toHaveAttribute('data-target-kind', 'canvas');
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: '粘贴' })).toBeInTheDocument();

    rerender(
      <MindMapContextMenu
        {...props}
        target={{ kind: 'relationship', id: 'relationship-a' as never }}
        selectionCount={1}
      />,
    );

    expect(screen.getByTestId('mindmap-context-menu'))
      .toHaveAttribute('data-target-kind', 'relationship');
    expect(screen.getByRole('menuitem', { name: '编辑标题' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '剪切' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '打开格式' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '新增子主题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '粘贴' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '删除分支' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '创建边界' })).not.toBeInTheDocument();
  });

  it('exposes immediate Summary deletion and reports the selected Summary', async () => {
    const user = userEvent.setup();
    const onDeleteElement = vi.fn();
    const onClose = vi.fn();
    const summaryTarget = { kind: 'summary' as const, id: 'summary-a' as SummaryId };
    renderMenu({
      target: summaryTarget,
      capabilities: { deleteElement: true },
      onDeleteElement,
      onClose,
    });

    const deleteSummary = screen.getByRole('menuitem', { name: '删除' });
    expect(deleteSummary).toHaveAttribute('data-action', 'delete-element');
    expect(deleteSummary).toHaveAttribute('aria-disabled', 'false');

    await user.click(deleteSummary);

    expect(onDeleteElement).toHaveBeenCalledOnce();
    expect(onDeleteElement).toHaveBeenCalledWith({ target: summaryTarget, selectionCount: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Summary deletion visible but disabled in read-only mode', () => {
    const onDeleteElement = vi.fn();
    renderMenu({
      target: { kind: 'summary', id: 'summary-a' as SummaryId },
      readOnly: true,
      capabilities: { deleteElement: true },
      onDeleteElement,
    });

    const deleteSummary = screen.getByRole('menuitem', { name: '删除' });
    expect(deleteSummary).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(deleteSummary);
    expect(onDeleteElement).not.toHaveBeenCalled();
  });

  it('uses capability, multi-selection, and read-only rules without hiding applicable commands', () => {
    const actionCallbacks = callbacks();
    const { rerender } = render(
      <MindMapContextMenu
        open
        anchor={{ clientX: 20, clientY: 20 }}
        target={topicTarget}
        selectionCount={3}
        readOnly={false}
        capabilities={{ ...capabilities, paste: false }}
        {...actionCallbacks}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('menuitem', { name: '编辑标题' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '新增子主题' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '仅删除当前主题' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '复制 3 个元素' }))
      .toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('menuitem', { name: '删除 3 个分支' }))
      .toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('menuitem', { name: '创建关系线' }))
      .toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('menuitem', { name: '粘贴' }))
      .toHaveAttribute('aria-disabled', 'true');

    rerender(
      <MindMapContextMenu
        open
        anchor={{ clientX: 20, clientY: 20 }}
        target={topicTarget}
        selectionCount={1}
        readOnly
        capabilities={capabilities}
        {...actionCallbacks}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('menuitem', { name: '复制' }))
      .toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('menuitem', { name: '查看格式' }))
      .toHaveAttribute('aria-disabled', 'false');
    for (const label of ['编辑标题', '剪切', '粘贴', '删除分支', '折叠分支', '创建关系线']) {
      expect(screen.getByRole('menuitem', { name: label }))
        .toHaveAttribute('aria-disabled', 'true');
    }

    fireEvent.click(screen.getByRole('menuitem', { name: '删除分支' }));
    expect(actionCallbacks.onDeleteBranch).not.toHaveBeenCalled();
  });

  it('dispatches a callback with context and asks the owner to close', async () => {
    const user = userEvent.setup();
    const onPaste = vi.fn();
    const onClose = vi.fn();
    renderMenu({
      target: null,
      selectionCount: 0,
      capabilities: { paste: true },
      onPaste,
      onClose,
    });

    await user.click(screen.getByRole('menuitem', { name: '粘贴' }));
    expect(onPaste).toHaveBeenCalledOnce();
    expect(onPaste).toHaveBeenCalledWith({ target: null, selectionCount: 0 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('implements roving keyboard focus, activation, Escape, and focus restoration', () => {
    const invoker = document.createElement('button');
    invoker.textContent = '打开菜单';
    document.body.append(invoker);
    invoker.focus();
    const onEditTitle = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onEditTitle, onClose });

    const editTitle = screen.getByRole('menuitem', { name: '编辑标题' });
    const addChild = screen.getByRole('menuitem', { name: '新增子主题' });
    const openFormat = screen.getByRole('menuitem', { name: '打开格式' });
    expect(editTitle).toHaveFocus();

    fireEvent.keyDown(editTitle, { key: 'ArrowDown' });
    expect(addChild).toHaveFocus();
    fireEvent.keyDown(addChild, { key: 'End' });
    expect(openFormat).toHaveFocus();
    fireEvent.keyDown(openFormat, { key: 'Home' });
    expect(editTitle).toHaveFocus();
    fireEvent.keyDown(editTitle, { key: 'ArrowUp' });
    expect(openFormat).toHaveFocus();
    fireEvent.keyDown(openFormat, { key: 'Home' });
    fireEvent.keyDown(editTitle, { key: ' ' });

    expect(onEditTitle).toHaveBeenCalledWith({ target: topicTarget, selectionCount: 1 });
    expect(onClose).toHaveBeenCalledOnce();
    expect(invoker).toHaveFocus();
    invoker.remove();
  });

  it('closes on Escape or an outside click and returns focus to the invoker', () => {
    const invoker = document.createElement('button');
    const outside = document.createElement('button');
    document.body.append(invoker, outside);
    invoker.focus();
    const first = renderMenu();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first.props.onClose).toHaveBeenCalledOnce();
    expect(invoker).toHaveFocus();
    first.unmount();

    invoker.focus();
    const second = renderMenu();
    fireEvent.click(outside);
    expect(second.props.onClose).toHaveBeenCalledOnce();
    expect(invoker).toHaveFocus();
    invoker.remove();
    outside.remove();
  });

  it('clamps fixed client coordinates so the menu cannot overflow the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 280,
      bottom: 500,
      left: 0,
      width: 280,
      height: 500,
      toJSON: () => ({}),
    });

    renderMenu({ anchor: { clientX: 310, clientY: 290 } });
    const menu = screen.getByTestId('mindmap-context-menu');
    expect(menu).toHaveStyle({ left: '32px', top: '8px' });
    expect(menu.style.position || menu.className).toBeTruthy();
    expect(menu.style.maxHeight).toBe('calc(100vh - 16px)');
  });
});
