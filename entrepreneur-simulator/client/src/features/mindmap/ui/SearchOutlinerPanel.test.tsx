import { createRef } from 'react';
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createMindMapSheet,
  createNewMindMapDocument,
  createTopic,
} from '../domain/defaults';
import type * as Domain from '../domain/types';
import {
  SearchOutlinerPanel,
  type SearchOutlinerPanelHandle,
} from './SearchOutlinerPanel';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f6000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

const createMixedRichTitle = (): Domain.RichText => ({
  type: 'doc',
  version: 1,
  blocks: [
    {
      type: 'paragraph',
      align: 'center',
      children: [
        {
          type: 'text',
          text: '混合样式',
          marks: [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'color', value: '#2563EB' },
          ],
        },
        { type: 'hardBreak' },
        { type: 'text', text: '第二行', marks: [{ type: 'underline' }] },
      ],
    },
    {
      type: 'bulletList',
      items: [{
        type: 'listItem',
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text: '列表项' }],
        }],
      }],
    },
  ],
});

beforeAll(() => {
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterator() { return; },
    }) as DOMRectList;
  }
  document.elementFromPoint = () => document.querySelector('[contenteditable="true"]');
});

interface PanelFixture {
  readonly document: Domain.MindMapDocumentV1;
  readonly firstSheetId: Domain.SheetId;
  readonly secondSheetId: Domain.SheetId;
  readonly branchId: Domain.TopicId;
  readonly childId: Domain.TopicId;
  readonly siblingId: Domain.TopicId;
  readonly secondRootId: Domain.TopicId;
}

const createPanelFixture = (): PanelFixture => {
  const firstSheetId = id<'Sheet'>(1);
  const firstRootId = id<'Topic'>(2);
  const themeId = id<'Theme'>(3);
  const document = createNewMindMapDocument({
    documentId: id<'Document'>(4),
    sheetId: firstSheetId,
    rootTopicId: firstRootId,
    themeId,
    sheetOrderKey: 'a',
    sheetTitle: '产品规划',
    rootTitle: '产品',
  });
  const firstSheet = document.sheets[firstSheetId];
  const branchId = id<'Topic'>(5);
  const childId = id<'Topic'>(6);
  const siblingId = id<'Topic'>(7);
  firstSheet.topics[branchId] = createTopic({ id: branchId, title: 'Roadmap' });
  firstSheet.topics[childId] = createTopic({ id: childId, title: 'Road Plan' });
  firstSheet.topics[siblingId] = createTopic({ id: siblingId, title: 'ROAD' });
  firstSheet.treeEdges[id<'TreeEdge'>(8)] = {
    id: id<'TreeEdge'>(8),
    parentTopicId: firstRootId,
    childTopicId: branchId,
    orderKey: 'a',
    side: 'right',
  };
  firstSheet.treeEdges[id<'TreeEdge'>(9)] = {
    id: id<'TreeEdge'>(9),
    parentTopicId: branchId,
    childTopicId: childId,
    orderKey: 'a',
    side: 'right',
  };
  firstSheet.treeEdges[id<'TreeEdge'>(10)] = {
    id: id<'TreeEdge'>(10),
    parentTopicId: firstRootId,
    childTopicId: siblingId,
    orderKey: 'b',
    side: 'right',
  };

  const secondSheetId = id<'Sheet'>(11);
  const secondRootId = id<'Topic'>(12);
  document.sheets[secondSheetId] = createMindMapSheet({
    id: secondSheetId,
    orderKey: 'b',
    rootTopicId: secondRootId,
    themeId,
    title: '海外计划',
    rootTitle: 'roadmap abroad',
  });

  return {
    document,
    firstSheetId,
    secondSheetId,
    branchId,
    childId,
    siblingId,
    secondRootId,
  };
};

afterEach(cleanup);

describe('SearchOutlinerPanel', () => {
  it('wires literal search options, three scopes, cursor navigation, and selection', () => {
    const fixture = createPanelFixture();
    const onSelect = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        branchRootTopicId={fixture.branchId}
        onSelect={onSelect}
      />,
    );

    const input = screen.getByRole('searchbox', { name: '搜索主题和内容' });
    fireEvent.change(input, { target: { value: 'road' } });
    expect(screen.getByLabelText('搜索结果 0 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一个搜索结果' }));
    expect(onSelect).toHaveBeenLastCalledWith(
      { kind: 'topic', id: fixture.branchId },
      fixture.firstSheetId,
    );
    expect(screen.getByLabelText('搜索结果 1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全词匹配' }));
    expect(screen.getByLabelText('搜索结果 0 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '区分大小写' }));
    expect(screen.getByText('未找到匹配内容')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '区分大小写' }));
    fireEvent.click(screen.getByRole('button', { name: '全词匹配' }));
    fireEvent.change(screen.getByRole('combobox', { name: '搜索范围' }), {
      target: { value: 'all-sheets' },
    });
    expect(screen.getByLabelText('搜索结果 0 / 4')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '搜索范围' }), {
      target: { value: 'branch' },
    });
    expect(screen.getByLabelText('搜索结果 0 / 2')).toBeInTheDocument();
    const resultList = screen.getByTestId('mindmap-search-results');
    fireEvent.click(within(resultList).getByRole('button', {
      name: '打开搜索结果 Road Plan（产品规划）',
    }));
    expect(onSelect).toHaveBeenLastCalledWith(
      { kind: 'topic', id: fixture.childId },
      fixture.firstSheetId,
    );
    expect(screen.getByLabelText('搜索结果 2 / 2')).toBeInTheDocument();
  });

  it('filters exact semantic fields so labels, notes, markers, To-dos and Tasks can be highlighted independently', async () => {
    const fixture = createPanelFixture();
    fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].labels = ['road'];
    const onFilterChange = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        onSelect={vi.fn()}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索主题和内容' }), {
      target: { value: 'road' },
    });
    expect(screen.getByLabelText('搜索结果 0 / 3')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '搜索内容类型' }), {
      target: { value: 'label' },
    });
    expect(screen.getByLabelText('搜索结果 0 / 1')).toBeInTheDocument();
    const results = screen.getByTestId('mindmap-search-results');
    const labelResult = within(results).getByRole('button', {
      name: '打开搜索结果 Roadmap（产品规划）',
    });
    expect(labelResult).toHaveTextContent('标签');
    await waitFor(() => expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({
      active: true,
      mode: 'dim',
      sheets: expect.objectContaining({
        [fixture.firstSheetId]: expect.objectContaining({
          matchedTopicIds: [fixture.branchId],
        }),
      }),
    })));

    fireEvent.change(screen.getByRole('combobox', { name: '搜索内容类型' }), {
      target: { value: 'note' },
    });
    expect(screen.getByText('未找到匹配内容')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索主题和内容' }), {
      target: { value: '' },
    });
    await waitFor(() => expect(onFilterChange).toHaveBeenLastCalledWith(undefined));
  });

  it('keeps multi-Sheet disclosure local and allows selection in read-only mode', () => {
    const fixture = createPanelFixture();
    const before = JSON.stringify(fixture.document);
    const onSelect = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        readOnly
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId('mindmap-search-outliner-panel'))
      .toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId(`outliner-sheet-${fixture.firstSheetId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`outliner-sheet-${fixture.secondSheetId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`outliner-topic-${fixture.firstSheetId}-${fixture.childId}`))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '折叠主题 Roadmap' }));
    expect(screen.queryByTestId(`outliner-topic-${fixture.firstSheetId}-${fixture.childId}`))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开主题 Roadmap' }));
    expect(screen.getByTestId(`outliner-topic-${fixture.firstSheetId}-${fixture.childId}`))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '折叠 Sheet 产品规划' }));
    expect(screen.queryByTestId(`outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`))
      .not.toBeInTheDocument();
    expect(screen.getByTestId(`outliner-topic-${fixture.secondSheetId}-${fixture.secondRootId}`))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: '选择主题 roadmap abroad（海外计划）',
    }));
    expect(onSelect).toHaveBeenCalledWith(
      { kind: 'topic', id: fixture.secondRootId },
      fixture.secondSheetId,
    );
    expect(screen.getByRole('searchbox', { name: '搜索主题和内容' })).toBeEnabled();
    expect(JSON.stringify(fixture.document)).toBe(before);
  });

  it('opens and focuses the search field through its Ctrl+F integration handle', () => {
    const fixture = createPanelFixture();
    const panelRef = createRef<SearchOutlinerPanelHandle>();
    const onCollapsedChange = vi.fn();
    render(
      <SearchOutlinerPanel
        ref={panelRef}
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        defaultCollapsed
        onSelect={vi.fn()}
        onCollapsedChange={onCollapsedChange}
      />,
    );

    expect(screen.queryByRole('searchbox', { name: '搜索主题和内容' }))
      .not.toBeInTheDocument();
    act(() => panelRef.current?.focusSearch());
    const input = screen.getByRole('searchbox', { name: '搜索主题和内容' });
    expect(input).toHaveFocus();
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(input, { target: { value: 'road' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('搜索结果 1 / 3')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  it('edits canonical RichText through double-click, F2 or Enter and commits only changes', async () => {
    const user = userEvent.setup();
    const fixture = createPanelFixture();
    const before = JSON.stringify(fixture.document);
    const onUpdateTopicTitle = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        selectedTopic={{ sheetId: fixture.firstSheetId, topicId: fixture.branchId }}
        onSelect={vi.fn()}
        onUpdateTopicTitle={onUpdateTopicTitle}
      />,
    );

    const titleButton = screen.getByRole('button', {
      name: '选择主题 Roadmap（产品规划）',
    });
    expect(titleButton).toHaveAttribute(
      'aria-keyshortcuts',
      'F2 Enter Tab Shift+Tab Alt+ArrowUp Alt+ArrowDown',
    );
    fireEvent.doubleClick(titleButton);
    const editor = screen.getByRole('textbox', { name: '编辑主题标题 Roadmap' });
    await user.click(editor);
    expect(editor).toHaveFocus();
    await user.keyboard('{Control>}a{/Control}路线图{Enter}');
    expect(onUpdateTopicTitle).toHaveBeenCalledWith({
      kind: 'update-title',
      sheetId: fixture.firstSheetId,
      topicId: fixture.branchId,
      title: {
        type: 'doc',
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{ type: 'text', text: '路线图' }],
        }],
      },
      source: 'editor',
    });
    await waitFor(() => expect(screen.queryByRole('textbox', {
      name: '编辑主题标题 Roadmap',
    })).not.toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 Roadmap（产品规划）',
    }), { key: 'F2' });
    await user.click(screen.getByRole('textbox', { name: '编辑主题标题 Roadmap' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox', {
      name: '编辑主题标题 Roadmap',
    })).not.toBeInTheDocument());
    expect(onUpdateTopicTitle).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 Roadmap（产品规划）',
    }), { key: 'Enter' });
    fireEvent.blur(screen.getByRole('textbox', { name: '编辑主题标题 Roadmap' }));
    expect(onUpdateTopicTitle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.document)).toBe(before);
  });

  it('preserves mixed marks, hard breaks and list blocks while editing in Outliner', async () => {
    const user = userEvent.setup();
    const fixture = createPanelFixture();
    const mixedTitle = createMixedRichTitle();
    fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].title
      = structuredClone(mixedTitle);
    const onUpdateTopicTitle = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        selectedTopic={{ sheetId: fixture.firstSheetId, topicId: fixture.branchId }}
        onSelect={vi.fn()}
        onUpdateTopicTitle={onUpdateTopicTitle}
      />,
    );

    const row = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`,
    );
    fireEvent.doubleClick(within(row).getByRole('button', { name: /^选择主题/ }));
    const editor = screen.getByRole('textbox', { name: /^编辑主题标题/ });
    await user.click(editor);
    expect(editor).toHaveFocus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: '删除线' }));
    await user.keyboard('{Enter}');

    expect(onUpdateTopicTitle).toHaveBeenCalledTimes(1);
    const intent = onUpdateTopicTitle.mock.calls[0][0] as {
      title: Domain.RichText;
    };
    expect(intent.title.blocks.map((block) => block.type))
      .toEqual(['paragraph', 'bulletList']);
    const firstBlock = intent.title.blocks[0];
    expect(firstBlock.type).toBe('paragraph');
    if (firstBlock.type === 'paragraph') {
      expect(firstBlock.align).toBe('center');
      expect(firstBlock.children[0]).toMatchObject({
        type: 'text',
        text: '混合样式',
        marks: expect.arrayContaining([
          { type: 'bold' },
          { type: 'italic' },
          { type: 'color', value: '#2563EB' },
          { type: 'strike' },
        ]),
      });
      expect(firstBlock.children[1]).toEqual({ type: 'hardBreak' });
      expect(firstBlock.children[2]).toMatchObject({
        type: 'text',
        text: '第二行',
        marks: expect.arrayContaining([{ type: 'underline' }, { type: 'strike' }]),
      });
    }
    const listBlock = intent.title.blocks[1];
    expect(listBlock.type).toBe('bulletList');
    if (listBlock.type === 'bulletList') {
      expect(listBlock.items[0].children[0]).toMatchObject({
        type: 'paragraph',
        children: [{
          type: 'text',
          text: '列表项',
          marks: expect.arrayContaining([{ type: 'strike' }]),
        }],
      });
    }
  });

  it('emits deterministic Tab, Shift+Tab and Alt+Arrow structural intents', async () => {
    const user = userEvent.setup();
    const fixture = createPanelFixture();
    const onUpdateTopicTitle = vi.fn();
    const onReparentTopic = vi.fn();
    const onReorderTopic = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        selectedTopic={{ sheetId: fixture.firstSheetId, topicId: fixture.siblingId }}
        onSelect={vi.fn()}
        onUpdateTopicTitle={onUpdateTopicTitle}
        onReparentTopic={onReparentTopic}
        onReorderTopic={onReorderTopic}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 ROAD（产品规划）',
    }), { key: 'Tab' });
    expect(onReparentTopic).toHaveBeenLastCalledWith({
      kind: 'reparent',
      sheetId: fixture.firstSheetId,
      topicId: fixture.siblingId,
      parentTopicId: fixture.branchId,
      index: 1,
      source: 'keyboard',
    });

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 Road Plan（产品规划）',
    }), { key: 'Tab', shiftKey: true });
    expect(onReparentTopic).toHaveBeenLastCalledWith({
      kind: 'reparent',
      sheetId: fixture.firstSheetId,
      topicId: fixture.childId,
      parentTopicId: fixture.document.sheets[fixture.firstSheetId].rootTopicId,
      index: 1,
      source: 'keyboard',
    });

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 ROAD（产品规划）',
    }), { key: 'ArrowUp', altKey: true });
    expect(onReorderTopic).toHaveBeenLastCalledWith({
      kind: 'reorder',
      sheetId: fixture.firstSheetId,
      topicId: fixture.siblingId,
      index: 0,
      source: 'keyboard',
    });

    fireEvent.click(screen.getByRole('button', { name: '上移主题 ROAD' }));
    expect(onReorderTopic).toHaveBeenLastCalledWith(expect.objectContaining({
      topicId: fixture.siblingId,
      index: 0,
      source: 'button',
    }));

    fireEvent.keyDown(screen.getByRole('button', {
      name: '选择主题 ROAD（产品规划）',
    }), { key: 'Enter' });
    const editor = screen.getByRole('textbox', { name: '编辑主题标题 ROAD' });
    await user.click(editor);
    expect(editor).toHaveFocus();
    await user.keyboard('{Control>}a{/Control}执行路线{Tab}');
    expect(onUpdateTopicTitle).toHaveBeenCalledWith(expect.objectContaining({
      topicId: fixture.siblingId,
      title: {
        type: 'doc',
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{ type: 'text', text: '执行路线' }],
        }],
      },
    }));
    expect(onReparentTopic).toHaveBeenLastCalledWith(expect.objectContaining({
      topicId: fixture.siblingId,
      parentTopicId: fixture.branchId,
      source: 'keyboard',
    }));
  });

  it('shows and emits before, inside and after drag targets across levels', () => {
    const fixture = createPanelFixture();
    const onReorderTopic = vi.fn();
    const onReparentTopic = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        onSelect={vi.fn()}
        onReparentTopic={onReparentTopic}
        onReorderTopic={onReorderTopic}
      />,
    );
    const sibling = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.siblingId}`,
    );
    const branch = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`,
    );
    const child = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.childId}`,
    );
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(),
      setData: vi.fn(),
    };
    const bounds = {
      top: 0,
      bottom: 90,
      left: 0,
      right: 100,
      width: 100,
      height: 90,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(branch, 'getBoundingClientRect').mockReturnValue(bounds);
    vi.spyOn(sibling, 'getBoundingClientRect').mockReturnValue(bounds);

    expect(sibling).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(sibling, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'text/plain',
      `${fixture.firstSheetId}:${fixture.siblingId}`,
    );
    expect(sibling).toHaveAttribute('data-dragging', 'true');
    const beforeDragOver = createEvent.dragOver(branch, { dataTransfer });
    Object.defineProperty(beforeDragOver, 'clientY', { value: 10 });
    fireEvent(branch, beforeDragOver);
    expect(branch).toHaveAttribute('data-drop-position', 'before');
    expect(branch).toHaveClass('shadow-[inset_0_2px_0_#3b82f6]');
    const beforeDrop = createEvent.drop(branch, { dataTransfer });
    Object.defineProperty(beforeDrop, 'clientY', { value: 10 });
    fireEvent(branch, beforeDrop);
    expect(onReorderTopic).toHaveBeenCalledWith({
      kind: 'reorder',
      sheetId: fixture.firstSheetId,
      topicId: fixture.siblingId,
      index: 0,
      source: 'drag',
    });
    expect(branch).not.toHaveAttribute('data-drop-position');

    onReorderTopic.mockClear();
    fireEvent.dragStart(sibling, { dataTransfer });
    const insideDragOver = createEvent.dragOver(branch, { dataTransfer });
    Object.defineProperty(insideDragOver, 'clientY', { value: 45 });
    fireEvent(branch, insideDragOver);
    expect(branch).toHaveAttribute('data-drop-position', 'inside');
    expect(branch).toHaveClass('ring-blue-400');
    const insideDrop = createEvent.drop(branch, { dataTransfer });
    Object.defineProperty(insideDrop, 'clientY', { value: 45 });
    fireEvent(branch, insideDrop);
    expect(onReparentTopic).toHaveBeenLastCalledWith({
      kind: 'reparent',
      sheetId: fixture.firstSheetId,
      topicId: fixture.siblingId,
      parentTopicId: fixture.branchId,
      index: 1,
      source: 'drag',
    });

    onReparentTopic.mockClear();
    fireEvent.dragStart(child, { dataTransfer });
    const afterDragOver = createEvent.dragOver(sibling, { dataTransfer });
    Object.defineProperty(afterDragOver, 'clientY', { value: 80 });
    fireEvent(sibling, afterDragOver);
    expect(sibling).toHaveAttribute('data-drop-position', 'after');
    expect(sibling).toHaveClass('shadow-[inset_0_-2px_0_#3b82f6]');
    const afterDrop = createEvent.drop(sibling, { dataTransfer });
    Object.defineProperty(afterDrop, 'clientY', { value: 80 });
    fireEvent(sibling, afterDrop);
    expect(onReparentTopic).toHaveBeenLastCalledWith({
      kind: 'reparent',
      sheetId: fixture.firstSheetId,
      topicId: fixture.childId,
      parentTopicId: fixture.document.sheets[fixture.firstSheetId].rootTopicId,
      index: 2,
      side: 'right',
      source: 'drag',
    });
    expect(onReorderTopic).not.toHaveBeenCalled();
  });

  it('rejects root, descendant-cycle and cross-Sheet drag targets', () => {
    const fixture = createPanelFixture();
    const onReorderTopic = vi.fn();
    const onReparentTopic = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        onSelect={vi.fn()}
        onReparentTopic={onReparentTopic}
        onReorderTopic={onReorderTopic}
      />,
    );
    const rootId = fixture.document.sheets[fixture.firstSheetId].rootTopicId;
    const root = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${rootId}`,
    );
    const branch = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`,
    );
    const child = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.childId}`,
    );
    const secondRoot = screen.getByTestId(
      `outliner-topic-${fixture.secondSheetId}-${fixture.secondRootId}`,
    );
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(),
      setData: vi.fn(),
    };
    const bounds = {
      top: 0,
      bottom: 90,
      left: 0,
      right: 100,
      width: 100,
      height: 90,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(bounds);
    vi.spyOn(secondRoot, 'getBoundingClientRect').mockReturnValue(bounds);

    expect(root).toHaveAttribute('draggable', 'false');
    fireEvent.dragStart(root, { dataTransfer });
    expect(root).toHaveAttribute('data-dragging', 'false');

    fireEvent.dragStart(branch, { dataTransfer });
    fireEvent.dragOver(child, { clientY: 45, dataTransfer });
    fireEvent.drop(child, { clientY: 45, dataTransfer });
    expect(child).not.toHaveAttribute('data-drop-position');

    fireEvent.dragStart(branch, { dataTransfer });
    fireEvent.dragOver(secondRoot, { clientY: 45, dataTransfer });
    fireEvent.drop(secondRoot, { clientY: 45, dataTransfer });
    expect(secondRoot).not.toHaveAttribute('data-drop-position');
    expect(onReparentTopic).not.toHaveBeenCalled();
    expect(onReorderTopic).not.toHaveBeenCalled();
  });

  it('blocks every edit, structure button, shortcut and drag callback in read-only mode', () => {
    const fixture = createPanelFixture();
    fixture.document.sheets[fixture.firstSheetId].topics[fixture.branchId].title
      = createMixedRichTitle();
    const before = JSON.stringify(fixture.document);
    const onUpdateTopicTitle = vi.fn();
    const onReparentTopic = vi.fn();
    const onReorderTopic = vi.fn();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        selectedTopic={{ sheetId: fixture.firstSheetId, topicId: fixture.siblingId }}
        readOnly
        onSelect={vi.fn()}
        onUpdateTopicTitle={onUpdateTopicTitle}
        onReparentTopic={onReparentTopic}
        onReorderTopic={onReorderTopic}
      />,
    );

    const titleButton = screen.getByRole('button', {
      name: '选择主题 ROAD（产品规划）',
    });
    const richTitleRow = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`,
    );
    fireEvent.doubleClick(within(richTitleRow).getByRole('button', { name: /^选择主题/ }));
    fireEvent.doubleClick(titleButton);
    for (const keyEvent of [
      { key: 'F2' },
      { key: 'Enter' },
      { key: 'Tab' },
      { key: 'Tab', shiftKey: true },
      { key: 'ArrowUp', altKey: true },
      { key: 'ArrowDown', altKey: true },
    ]) fireEvent.keyDown(titleButton, keyEvent);
    expect(screen.queryByRole('textbox', { name: /编辑主题标题/ })).not.toBeInTheDocument();

    for (const action of ['提升主题 ROAD', '缩进主题 ROAD', '上移主题 ROAD', '下移主题 ROAD']) {
      const button = screen.getByRole('button', { name: action });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    const source = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.siblingId}`,
    );
    const target = screen.getByTestId(
      `outliner-topic-${fixture.firstSheetId}-${fixture.branchId}`,
    );
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(),
      setData: vi.fn(),
    };
    expect(source).toHaveAttribute('draggable', 'false');
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { clientY: -1, dataTransfer });
    fireEvent.drop(target, { clientY: -1, dataTransfer });

    expect(onUpdateTopicTitle).not.toHaveBeenCalled();
    expect(onReparentTopic).not.toHaveBeenCalled();
    expect(onReorderTopic).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.document)).toBe(before);
  });

  it('disables branch scope when no valid branch root is provided', () => {
    const fixture = createPanelFixture();
    render(
      <SearchOutlinerPanel
        document={fixture.document}
        activeSheetId={fixture.firstSheetId}
        onSelect={vi.fn()}
      />,
    );

    const scope = screen.getByRole('combobox', { name: '搜索范围' });
    expect(within(scope).getByRole('option', { name: '当前分支' })).toBeDisabled();
    expect(scope).toHaveValue('sheet');
  });
});
