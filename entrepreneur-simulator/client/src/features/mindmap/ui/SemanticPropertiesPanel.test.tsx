import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import type { ElementRef, SheetId } from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import { SemanticPropertiesPanel } from './SemanticPropertiesPanel';

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

afterEach(cleanup);

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const refs = {
    relationship: {
      kind: 'relationship',
      id: Object.values(sheet.relationships)[0].id,
    } as const,
    boundary: {
      kind: 'boundary',
      id: Object.values(sheet.boundaries)[0].id,
    } as const,
    summary: {
      kind: 'summary',
      id: Object.values(sheet.summaries)[0].id,
    } as const,
    callout: {
      kind: 'callout',
      id: Object.values(sheet.callouts)[0].id,
    } as const,
    zone: {
      kind: 'zone',
      id: Object.values(sheet.zones)[0].id,
    } as const,
  };
  return { document, sheetId, refs };
};

describe('SemanticPropertiesPanel', () => {
  it('renders Relationship controls and emits one planned command per committed field', async () => {
    const user = userEvent.setup();
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.relationship}
        readOnly={false}
        onCommand={onCommand}
      />,
    );

    expect(screen.getByRole('document', { name: '关系标题' })).toHaveTextContent('依赖');
    expect(screen.getByRole('combobox', { name: '关系路径' })).toHaveValue('curve');
    expect(screen.getByRole('combobox', { name: '关系线型' })).toHaveValue('default');
    expect(screen.getByRole('combobox', { name: '关系起点箭头' })).toHaveValue('none');
    expect(screen.getByRole('combobox', { name: '关系终点箭头' })).toHaveValue('triangle');

    await user.selectOptions(screen.getByRole('combobox', { name: '关系路径' }), 'orthogonal');
    await user.selectOptions(screen.getByRole('combobox', { name: '关系线型' }), 'dashed');
    await user.selectOptions(screen.getByRole('combobox', { name: '关系起点箭头' }), 'diamond');

    expect(onCommand).toHaveBeenCalledTimes(3);
    expect(onCommand.mock.calls.map(([command]) => command.type)).toEqual([
      MIND_MAP_COMMAND_TYPES.updateRelationship,
      MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      MIND_MAP_COMMAND_TYPES.updateRelationship,
    ]);
    expect(onCommand.mock.calls[0][0].payload.relationship.routing).toBe('orthogonal');
    expect(onCommand.mock.calls[1][0].payload.replacements).toHaveLength(1);
    expect(onCommand.mock.calls[2][0].payload.relationship.startArrow).toBe('diamond');
  });

  it('commits canonical rich content once from the embedded editor', async () => {
    const user = userEvent.setup();
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.relationship}
        readOnly={false}
        onCommand={onCommand}
      />,
    );

    await user.click(screen.getByRole('button', { name: '编辑关系标题' }));
    const editor = await screen.findByRole('textbox', { name: '编辑关系标题' });
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}新的关系标题{Enter}');

    expect(onCommand).toHaveBeenCalledTimes(1);
    const command = onCommand.mock.calls[0][0];
    expect(command.type).toBe(MIND_MAP_COMMAND_TYPES.updateRelationship);
    expect(mindMapRichTextToPlainText(command.payload.relationship.title)).toBe('新的关系标题');
  });

  it('edits Relationship color and width through one style command each', async () => {
    const user = userEvent.setup();
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.relationship}
        readOnly={false}
        onCommand={onCommand}
      />,
    );

    fireEvent.change(screen.getByLabelText('关系线颜色'), {
      target: { value: '#aabbcc' },
    });
    const width = screen.getByRole('spinbutton', { name: '关系线粗细' });
    await user.type(width, '4.5');
    await user.tab();

    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      payload: {
        replacements: [{
          binding: {
            overrides: {
              connector: { color: { kind: 'literal', value: '#AABBCC' } },
            },
          },
        }],
      },
    });
    expect(onCommand.mock.calls[1][0]).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      payload: {
        replacements: [{
          binding: { overrides: { connector: { width: 4.5 } } },
        }],
      },
    });
  });

  it.each([
    ['boundary', '边界', '编辑边界标题'],
    ['summary', '概要', '编辑概要内容'],
    ['callout', '标注', '编辑标注内容'],
    ['zone', '区域', '编辑区域标题'],
  ] as const)('binds the selected %s entity to its own content control', (kind, heading, editLabel) => {
    const { document, sheetId, refs } = setup();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs[kind]}
        readOnly={false}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: editLabel })).toBeEnabled();
    expect(screen.queryByRole('combobox', { name: '关系路径' })).not.toBeInTheDocument();
  });

  it('exposes Summary orientation, line style, color, width, and result-topic meaning', async () => {
    const user = userEvent.setup();
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.summary}
        readOnly={false}
        onCommand={onCommand}
      />,
    );

    expect(screen.getByTestId('mindmap-summary-result-content-note'))
      .toHaveTextContent('概要结果主题内容');
    expect(screen.getByRole('combobox', { name: '概要方向' })).toHaveValue('right');
    expect(screen.getByRole('combobox', { name: '概要线型' })).toHaveValue('default');
    expect(screen.getByLabelText('概要线颜色')).toHaveValue('#8b5cf6');
    expect(screen.getByRole('spinbutton', { name: '概要线粗细' })).toHaveValue(2);

    await user.selectOptions(screen.getByRole('combobox', { name: '概要方向' }), 'bottom');
    fireEvent.change(screen.getByLabelText('概要线颜色'), {
      target: { value: '#a855f7' },
    });
    const width = screen.getByRole('spinbutton', { name: '概要线粗细' });
    await user.clear(width);
    await user.type(width, '4');
    await user.tab();
    await user.selectOptions(screen.getByRole('combobox', { name: '概要线型' }), 'dashed');

    expect(onCommand.mock.calls.map(([command]) => command.type)).toEqual([
      MIND_MAP_COMMAND_TYPES.updateSummary,
      MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      MIND_MAP_COMMAND_TYPES.updateStyleBindings,
    ]);
    expect(onCommand.mock.calls[0][0].payload.summary.orientation).toBe('bottom');
    expect(onCommand.mock.calls[1][0].payload.replacements[0].binding.overrides.border.color)
      .toEqual({ kind: 'literal', value: '#A855F7' });
    expect(onCommand.mock.calls[2][0].payload.replacements[0].binding.overrides.border.width)
      .toBe(4);
    expect(onCommand.mock.calls[3][0].payload.replacements[0].binding.overrides.border.dash)
      .toEqual([6, 4]);
  });

  it('treats duplicate Boundary color input events as a harmless no-op', () => {
    const { document, sheetId, refs } = setup();
    const boundary = document.sheets[sheetId].boundaries[refs.boundary.id];
    boundary.style = {
      overrides: {
        fill: { color: { kind: 'literal', value: '#DDEEFF' } },
      },
    };
    const onCommand = vi.fn();
    const { container } = render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.boundary}
        readOnly={false}
        onCommand={onCommand}
      />,
    );
    const fill = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(fill).not.toBeNull();
    expect(fill).toHaveValue('#ddeeff');
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!nativeValueSetter) throw new Error('Native input value setter is unavailable.');
    nativeValueSetter.call(fill, '#000000');
    fireEvent.input(fill!);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.updateStyleBindings,
      payload: {
        replacements: [{ binding: { overrides: { fill: { color: {
          kind: 'literal', value: '#000000',
        } } } } }],
      },
    });
    onCommand.mockClear();
    expect(() => {
      // The tracker sees a real #000000 -> #ddeeff change, while canonical
      // model input remains #DDEEFF. This exercises the no-op planner path.
      nativeValueSetter.call(fill, '#ddeeff');
      fireEvent.input(fill!);
    }).not.toThrow();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('disables every mutation affordance in read-only mode', async () => {
    const user = userEvent.setup();
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.relationship}
        readOnly
        onCommand={onCommand}
      />,
    );

    expect(screen.getByRole('button', { name: '编辑关系标题' })).toBeDisabled();
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled();
    expect(screen.getByLabelText('关系线颜色')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '关系线粗细' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重置关系线颜色' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '编辑关系标题' }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('只读模式');
  });

  it('disables all Summary-specific controls in read-only mode', () => {
    const { document, sheetId, refs } = setup();
    const onCommand = vi.fn();
    render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={refs.summary}
        readOnly
        onCommand={onCommand}
      />,
    );

    expect(screen.getByRole('button', { name: '编辑概要内容' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '概要方向' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '概要线型' })).toBeDisabled();
    expect(screen.getByLabelText('概要线颜色')).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '概要线粗细' })).toBeDisabled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('shows a stable empty state for unsupported or stale selection', () => {
    const { document, sheetId } = setup();
    const stale = { kind: 'zone', id: 'missing-zone' } as ElementRef;
    const { rerender } = render(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={stale}
        readOnly={false}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText(/选择关系、边界、概要/)).toBeInTheDocument();

    rerender(
      <SemanticPropertiesPanel
        document={document}
        sheetId={sheetId}
        selection={{ kind: 'topic', id: document.sheets[sheetId].rootTopicId }}
        readOnly={false}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});
