import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createMindMapBlockDocument } from '../domain/createDocument';
import type {
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  TaskId,
} from '../domain/types';
import {
  MindMapV2NodeView,
  type MindMapV2NodeViewProps,
} from './MindMapV2NodeView';

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
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.removeAttribute('data-mindmap-fullscreen-open');
});

const createNodeViewProps = (
  blockId: string,
  idSuffix: string,
): MindMapV2NodeViewProps => {
  let idIndex = 0;
  const document = createMindMapBlockDocument({
    idFactory: () => `018f0000-0000-7000-8000-${idSuffix}${String(++idIndex).padStart(2, '0')}`,
  });

  return {
    node: { attrs: { data: document, blockId } },
    updateAttributes: vi.fn(),
    editor: { isEditable: true, on: vi.fn(), off: vi.fn() },
    selected: false,
  } as unknown as MindMapV2NodeViewProps;
};

const enterMindMapWorkspace = (): HTMLElement => {
  fireEvent.click(screen.getByTestId('mindmap-v2-enter-fullscreen'));
  return screen.getByTestId('mindmap-v2-fullscreen-layer');
};

describe('MindMapV2NodeView presentation contracts', () => {
  it('renders a directly visible embedded preview with the document-layout minimum height', () => {
    render(<MindMapV2NodeView {...createNodeViewProps('embedded-map', '0000000011')} />);

    const preview = screen.getByTestId('mindmap-v2-embedded-preview');
    expect(preview).toHaveAttribute('data-mindmap-presentation', 'embedded');
    expect(preview).toHaveAttribute('data-mindmap-chrome', 'preview');
    expect(preview).toHaveClass('h-[clamp(440px,52vh,560px)]', 'min-h-[440px]');
    expect(preview.closest('[data-type="mind-map"]')).not.toBeNull();

    const canvas = within(preview).getByTestId('mindmap-v2-canvas');
    expect(canvas).toBeVisible();
    expect(within(preview).queryByTestId('mindmap-format-panel')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('mindmap-semantic-panel')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('mindmap-semantic-properties')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('mindmap-search-outliner-panel')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('mindmap-canvas-navigation')).not.toBeInTheDocument();
    expect(
      within(preview).getAllByRole('button', { name: '中心主题' })
        .some((element) => element.getAttribute('title') === '中心主题'),
    ).toBe(true);
  });

  it('keeps the root card visible and prefilled while its dark editor opens in a toolbar', async () => {
    render(<MindMapV2NodeView {...createNodeViewProps('root-editor-map', '0000000013')} />);
    const rootButton = screen.getAllByRole('button', { name: '中心主题' })
      .find((element) => element.getAttribute('title') === '中心主题');
    expect(rootButton).toBeDefined();
    fireEvent.doubleClick(rootButton!);

    const editor = await screen.findByLabelText('编辑主题标题');
    expect(editor).toHaveTextContent('中心主题');
    expect(editor).toHaveClass('text-slate-900');
    expect(rootButton).toBeVisible();
    expect(screen.getByTestId('mindmap-topic-title-editor-popover')).toBeInTheDocument();
  });

  it('routes local image insertion to the root topic when nothing is selected', () => {
    render(<MindMapV2NodeView {...createNodeViewProps('root-image-map', '0000000014')} />);
    const input = screen.getByTestId('mindmap-local-image-input') as HTMLInputElement;
    const openChooser = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    const insertImage = screen.getByTestId('mindmap-insert-local-image');
    expect(insertImage).toBeEnabled();

    fireEvent.click(insertImage);

    expect(openChooser).toHaveBeenCalledTimes(1);
    const root = screen.getAllByRole('treeitem')
      .find((element) => element.getAttribute('data-topic-role') === 'central');
    expect(root).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps image and tree-table actions available from an embedded mind map', () => {
    render(<MindMapV2NodeView {...createNodeViewProps('embedded-table-map', '0000000016')} />);

    expect(screen.getByTestId('mindmap-insert-local-image')).toBeEnabled();
    expect(screen.getByTestId('mindmap-toggle-tree-table')).toBeEnabled();
    expect(screen.getByLabelText('转换为树形表格')).toBeInTheDocument();
  });

  it('opens the fullscreen search workspace when Ctrl+F starts in the embedded preview', () => {
    render(<MindMapV2NodeView {...createNodeViewProps('embedded-search-map', '0000000015')} />);
    const canvas = screen.getByTestId('mindmap-v2-canvas');

    fireEvent.keyDown(canvas, { key: 'f', code: 'KeyF', ctrlKey: true });

    const layer = screen.getByTestId('mindmap-v2-fullscreen-layer');
    expect(within(layer).getByTestId('mindmap-search-outliner-panel')).toBeInTheDocument();
  });

  it('ports fullscreen into a viewport overlay with independent compact chrome and restores body scrolling', () => {
    document.body.style.overflow = 'auto';
    render(
      <main data-testid="document-layout" data-document-layout="page-and-sidebars">
        <h1>外层文档标题</h1>
        <MindMapV2NodeView {...createNodeViewProps('fullscreen-map', '0000000012')} />
      </main>,
    );

    const documentLayout = screen.getByTestId('document-layout');
    fireEvent.click(screen.getByTestId('mindmap-v2-enter-fullscreen'));

    const layer = screen.getByTestId('mindmap-v2-fullscreen-layer');
    expect(layer.parentElement).toBe(document.body);
    expect(documentLayout).not.toContainElement(layer);
    expect(within(documentLayout).getByTestId('mindmap-v2-fullscreen-placeholder'))
      .toHaveClass('h-[clamp(440px,52vh,560px)]', 'min-h-[440px]');
    expect(layer).toHaveAttribute('role', 'dialog');
    expect(layer).toHaveAttribute('aria-modal', 'true');
    expect(layer).toHaveAttribute('data-mindmap-presentation', 'fullscreen');
    expect(layer).toHaveClass('fixed', 'inset-0', 'h-[100dvh]');

    const compactTopbar = within(layer).getByTestId('mindmap-v2-fullscreen-topbar');
    expect(compactTopbar).toHaveAttribute('data-mindmap-chrome', 'compact');
    expect(within(layer).queryByText('外层文档标题')).not.toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(document.body).toHaveAttribute('data-mindmap-fullscreen-open', 'true');
    expect(documentLayout.parentElement).toHaveAttribute('inert');
    expect(documentLayout.parentElement).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(within(compactTopbar).getByTestId('mindmap-v2-exit-fullscreen'));

    expect(screen.queryByTestId('mindmap-v2-fullscreen-layer')).not.toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: 'auto' });
    expect(document.body).not.toHaveAttribute('data-mindmap-fullscreen-open');
    expect(documentLayout.parentElement).not.toHaveAttribute('inert');
    expect(documentLayout.parentElement).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('mindmap-v2-embedded-preview')).toBeVisible();
  });
});

describe('MindMapV2NodeView diagnostics', () => {
  it('shows preserved read-only diagnostics and never overwrites invalid payloads', () => {
    const updateAttributes = vi.fn();
    const invalidPayload = '{"schema":"broken"';
    const props = {
      node: { attrs: { data: invalidPayload, blockId: 'broken-map' } },
      updateAttributes,
      editor: { isEditable: true, on: vi.fn(), off: vi.fn() },
      selected: false,
    } as unknown as MindMapV2NodeViewProps;

    render(<MindMapV2NodeView {...props} />);

    expect(screen.getByTestId('mindmap-v2-diagnostic')).toHaveTextContent(
      '只读诊断模式',
    );
    expect(screen.getByText(invalidPayload)).toBeInTheDocument();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('reacts to editor editable updates and disables semantic mutations', () => {
    const ids = [
      '018f0000-0000-7000-8000-000000000001',
      '018f0000-0000-7000-8000-000000000002',
      '018f0000-0000-7000-8000-000000000003',
      '018f0000-0000-7000-8000-000000000004',
    ];
    let idIndex = 0;
    const document = createMindMapBlockDocument({ idFactory: () => ids[idIndex++] });
    let editable = true;
    const editorListeners = new Map<string, Set<() => void>>();
    const editor = {
      get isEditable() {
        return editable;
      },
      on: vi.fn((event: string, listener: () => void) => {
        const listeners = editorListeners.get(event) ?? new Set<() => void>();
        listeners.add(listener);
        editorListeners.set(event, listeners);
      }),
      off: vi.fn((event: string, listener: () => void) => {
        editorListeners.get(event)?.delete(listener);
      }),
    };
    const props = {
      node: { attrs: { data: document, blockId: 'editable-map' } },
      updateAttributes: vi.fn(),
      editor,
      selected: false,
    } as unknown as MindMapV2NodeViewProps;

    render(<MindMapV2NodeView {...props} />);
    expect(screen.getByTestId('mindmap-v2-canvas')).toHaveAttribute('data-read-only', 'false');

    act(() => {
      editable = false;
      editorListeners.get('update')?.forEach((listener) => listener());
    });

    expect(screen.getByTestId('mindmap-v2-canvas')).toHaveAttribute('data-read-only', 'true');
    enterMindMapWorkspace();
    expect(screen.getByTestId('mindmap-create-boundary')).toBeDisabled();
    expect(screen.getByTitle('新增子主题 (Tab)')).toBeDisabled();
  });

  it('ACC-SEM-019 opens Todo from the toolbar and reopens it from the node badge', () => {
    const ids = [
      '018f0000-0000-7000-8000-000000000101',
      '018f0000-0000-7000-8000-000000000102',
      '018f0000-0000-7000-8000-000000000103',
      '018f0000-0000-7000-8000-000000000104',
    ];
    let idIndex = 0;
    const document = createMindMapBlockDocument({ idFactory: () => ids[idIndex++] });
    const props = {
      node: { attrs: { data: document, blockId: 'todo-map' } },
      updateAttributes: vi.fn(),
      editor: { isEditable: true, on: vi.fn(), off: vi.fn() },
      selected: false,
    } as unknown as MindMapV2NodeViewProps;

    render(<MindMapV2NodeView {...props} />);
    const topicTitle = screen.getAllByRole('button', { name: '中心主题' })
      .find((element) => element.getAttribute('title') === '中心主题');
    expect(topicTitle).toBeDefined();
    fireEvent.click(topicTitle!);
    enterMindMapWorkspace();
    const toolbarEntry = screen.getByRole('button', { name: '打开主题待办' });
    expect(toolbarEntry).toBeEnabled();
    fireEvent.click(toolbarEntry);
    expect(screen.getByTestId('mindmap-topic-enrichment-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加待办' }));
    expect(screen.getByTestId('mindmap-topic-todo')).toHaveTextContent('未完成');
    fireEvent.click(screen.getByRole('button', { name: '关闭主题内容' }));

    const todoBadge = screen.getByRole('button', { name: '待办：未完成' });
    expect(todoBadge).toHaveAttribute('data-topic-enrichment-kind', 'todo');
    fireEvent.click(todoBadge);
    expect(screen.getByRole('tab', { name: '待办' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('ACC-SEM-028 opens Task from the toolbar and reopens the editor from its node badge', () => {
    const ids = [
      '018f0000-0000-7000-8000-000000000201',
      '018f0000-0000-7000-8000-000000000202',
      '018f0000-0000-7000-8000-000000000203',
      '018f0000-0000-7000-8000-000000000204',
    ];
    let idIndex = 0;
    const document = createMindMapBlockDocument({ idFactory: () => ids[idIndex++] });
    const sheet = Object.values(document.sheets)[0];
    const taskId = '018f0000-0000-7000-8000-000000000205' as TaskId;
    sheet.tasks[taskId] = {
      id: taskId,
      topicId: sheet.rootTopicId,
      status: 'in-progress',
      progress: 0.35,
      priority: 2,
      displayFields: ['status', 'progress'],
    };
    const props = {
      node: { attrs: { data: document, blockId: 'task-map' } },
      updateAttributes: vi.fn(),
      editor: { isEditable: true, on: vi.fn(), off: vi.fn() },
      selected: false,
    } as unknown as MindMapV2NodeViewProps;

    render(<MindMapV2NodeView {...props} />);
    const topicTitle = screen.getAllByRole('button', { name: '中心主题' })
      .find((element) => element.getAttribute('title') === '中心主题');
    expect(topicTitle).toBeDefined();
    fireEvent.click(topicTitle!);
    enterMindMapWorkspace();
    const toolbarEntry = screen.getByRole('button', { name: '打开主题任务' });
    expect(toolbarEntry).toBeEnabled();
    fireEvent.click(toolbarEntry);
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mindmap-topic-task')).toHaveTextContent('35%');
    fireEvent.click(screen.getByRole('button', { name: '关闭主题内容' }));

    const taskBadge = screen.getByRole('button', {
      name: '任务：进行中，进度 35%，优先级 2',
    });
    expect(taskBadge).toHaveAttribute('data-topic-enrichment-kind', 'task');
    fireEvent.click(taskBadge);
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens Marker/Legend from the toolbar and reopens the same panel from an accessible marker badge', () => {
    const ids = [
      '018f0000-0000-7000-8000-000000000301',
      '018f0000-0000-7000-8000-000000000302',
      '018f0000-0000-7000-8000-000000000303',
      '018f0000-0000-7000-8000-000000000304',
    ];
    let idIndex = 0;
    const document = createMindMapBlockDocument({ idFactory: () => ids[idIndex++] });
    const sheet = Object.values(document.sheets)[0];
    const groupId = '018f0000-0000-7000-8000-000000000305' as MarkerGroupId;
    const definitionId = '018f0000-0000-7000-8000-000000000306' as MarkerDefinitionId;
    const markerId = '018f0000-0000-7000-8000-000000000307' as MarkerInstanceId;
    document.markerGroups[groupId] = {
      id: groupId,
      orderKey: 'a',
      name: '优先级',
      kind: 'builtin',
      exclusive: true,
      extensions: { 'io.xmind.source-id': 'priority' },
    };
    document.markerDefinitions[definitionId] = {
      id: definitionId,
      groupId,
      orderKey: 'a',
      name: '优先级 1',
      source: { kind: 'builtin', key: 'priority-1' },
      semanticValue: 1,
    };
    sheet.markerInstances[markerId] = {
      id: markerId,
      topicId: sheet.rootTopicId,
      markerDefinitionId: definitionId,
      orderKey: 'a',
    };
    sheet.markerLegend = {
      visible: true,
      title: '项目图例',
      position: { x: 120, y: 80 },
      itemOrder: [definitionId],
    };
    const props = {
      node: { attrs: { data: document, blockId: 'marker-map' } },
      updateAttributes: vi.fn(),
      editor: { isEditable: true, on: vi.fn(), off: vi.fn() },
      selected: false,
    } as unknown as MindMapV2NodeViewProps;

    render(<MindMapV2NodeView {...props} />);
    expect(screen.getByTestId('mindmap-marker-legend-canvas')).toHaveAccessibleName('项目图例');
    const topicTitle = screen.getAllByRole('button', { name: '中心主题' })
      .find((element) => element.getAttribute('title') === '中心主题');
    fireEvent.click(topicTitle!);
    enterMindMapWorkspace();
    const toolbarEntry = screen.getByRole('button', { name: '打开标记与图例' });
    fireEvent.click(toolbarEntry);
    expect(screen.getByTestId('mindmap-marker-legend-panel')).toHaveAccessibleName('标记与图例');
    expect(screen.getByRole('button', { name: '移除标记：优先级 1（优先级）' }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '关闭标记与图例' }));

    const markerBadge = screen.getByRole('button', { name: /^标记：优先级 1（优先级）/ });
    expect(markerBadge).toHaveAttribute('data-topic-enrichment-kind', 'marker');
    fireEvent.click(markerBadge);
    expect(screen.getByTestId('mindmap-marker-legend-panel')).toBeInTheDocument();
  });
});
