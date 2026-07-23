import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import type {
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  SheetId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { MarkerLegendPanel } from './MarkerLegendPanel';

const IDS = {
  customGroup: '018f0000-0000-7000-8000-00000000b001' as MarkerGroupId,
  customDefinition: '018f0000-0000-7000-8000-00000000b002' as MarkerDefinitionId,
  secondDefinition: '018f0000-0000-7000-8000-00000000b003' as MarkerDefinitionId,
  customMarker: '018f0000-0000-7000-8000-00000000b004' as MarkerInstanceId,
};

afterEach(cleanup);

const setup = () => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const currentMarker = Object.values(sheet.markerInstances)[0];
  const currentDefinition = document.markerDefinitions[currentMarker.markerDefinitionId];
  return { document, sheet, sheetId, currentMarker, currentDefinition };
};

describe('MarkerLegendPanel', () => {
  it('filters the marker catalog by display name and builtin key while preserving shared vector icons', async () => {
    const user = userEvent.setup();
    const { document, sheetId, currentMarker, currentDefinition } = setup();
    document.markerDefinitions[IDS.secondDefinition] = {
      id: IDS.secondDefinition,
      groupId: currentDefinition.groupId,
      orderKey: 'b',
      name: 'Priority 2',
      source: { kind: 'builtin', key: 'priority-2' },
      semanticValue: 2,
    };
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly={false}
        onCommand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const catalog = screen.getByRole('region', { name: '主题标记' });
    const search = within(catalog).getByRole('searchbox', { name: '搜索标记目录' });

    await user.type(search, 'Priority 2');
    expect(within(catalog).getByRole('button', {
      name: '应用或替换为标记：Priority 2（Priority）',
    })).toBeInTheDocument();
    expect(within(catalog).queryByRole('button', {
      name: `移除标记：${currentDefinition.name}（Priority）`,
    })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'priority-1');
    const priorityOne = within(catalog).getByRole('button', {
      name: `移除标记：${currentDefinition.name}（Priority）`,
    });
    const sharedIcon = priorityOne.querySelector(
      'svg[data-marker-visual-key="priority-1"]',
    );
    expect(sharedIcon).toBeInTheDocument();
    expect(sharedIcon?.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(within(catalog).queryByRole('button', {
      name: '应用或替换为标记：Priority 2（Priority）',
    })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'does-not-exist');
    expect(within(catalog).getByText('没有匹配的标记。')).toBeInTheDocument();
    expect(within(catalog).queryByRole('button', {
      name: /标记：Priority/,
    })).not.toBeInTheDocument();
  });

  it('removes an active marker and atomically replaces an exclusive-group marker with the stable instance ID', async () => {
    const user = userEvent.setup();
    const { document, sheetId, currentMarker, currentDefinition } = setup();
    document.markerDefinitions[IDS.secondDefinition] = {
      id: IDS.secondDefinition,
      groupId: currentDefinition.groupId,
      orderKey: 'b',
      name: 'Priority 2',
      source: { kind: 'builtin', key: 'priority-2' },
      semanticValue: 2,
    };
    const onCommand = vi.fn();
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly={false}
        onCommand={onCommand}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', {
      name: `移除标记：${currentDefinition.name}（Priority）`,
    }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.detachMarker,
      payload: { markerInstanceId: currentMarker.id },
    }));

    await user.click(screen.getByRole('button', {
      name: '应用或替换为标记：Priority 2（Priority）',
    }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.updateMarker,
      payload: {
        marker: expect.objectContaining({
          id: currentMarker.id,
          markerDefinitionId: IDS.secondDefinition,
          orderKey: currentMarker.orderKey,
        }),
      },
    }));
  });

  it('installs every missing standard group in one command and exposes all five product groups', async () => {
    const user = userEvent.setup();
    const { document, sheetId, currentMarker } = setup();
    const onCommand = vi.fn();
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly={false}
        onCommand={onCommand}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/优先级 ✓/)).toHaveTextContent('进度');
    expect(screen.getByText(/优先级 ✓/)).toHaveTextContent('旗帜');
    expect(screen.getByText(/优先级 ✓/)).toHaveTextContent('星标');
    expect(screen.getByText(/优先级 ✓/)).toHaveTextContent('箭头');
    await user.click(screen.getByRole('button', { name: '安装缺少的标准标记组' }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    const command = onCommand.mock.calls[0][0];
    expect(command.type).toBe(MIND_MAP_COMMAND_TYPES.createMarkerGroup);
    expect(command.payload.groups.map((group: { name: string }) => group.name))
      .toEqual(['进度', '旗帜', '星标', '箭头']);
  });

  it('creates, renames, reorders and confirms deletion of custom groups/definitions with impact counts', async () => {
    const user = userEvent.setup();
    const { document, sheet, sheetId, currentMarker } = setup();
    document.markerGroups[IDS.customGroup] = {
      id: IDS.customGroup,
      orderKey: 'z',
      name: '风险',
      kind: 'custom',
      exclusive: false,
    };
    document.markerDefinitions[IDS.customDefinition] = {
      id: IDS.customDefinition,
      groupId: IDS.customGroup,
      orderKey: 'a',
      name: '高风险',
      source: { kind: 'builtin', key: 'custom-triangle' },
    };
    sheet.markerInstances[IDS.customMarker] = {
      id: IDS.customMarker,
      topicId: currentMarker.topicId,
      markerDefinitionId: IDS.customDefinition,
      orderKey: 'z',
    };
    sheet.markerLegend.itemOrder = [currentMarker.markerDefinitionId, IDS.customDefinition];
    const onCommand = vi.fn();
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly={false}
        onCommand={onCommand}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '重命名标记组 风险' }));
    await user.clear(screen.getByRole('textbox', { name: '标记组新名称' }));
    await user.type(screen.getByRole('textbox', { name: '标记组新名称' }), '风险等级');
    await user.click(screen.getByRole('button', { name: '保存标记组名称' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.renameMarkerGroup,
      payload: { groupId: IDS.customGroup, name: '风险等级' },
    }));

    await user.click(screen.getByRole('button', { name: '添加自定义标记' }));
    await user.type(screen.getByRole('textbox', { name: '新标记名称' }), '低风险');
    await user.selectOptions(screen.getByRole('combobox', { name: '新标记图形' }), 'custom-circle');
    await user.click(screen.getByRole('button', { name: '保存标记' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.createMarkerDefinition,
      payload: { definition: expect.objectContaining({
        groupId: IDS.customGroup,
        name: '低风险',
        source: { kind: 'builtin', key: 'custom-circle' },
      }) },
    }));

    await user.click(screen.getByRole('button', { name: '重命名标记 高风险' }));
    await user.clear(screen.getByRole('textbox', { name: '标记新名称' }));
    await user.type(screen.getByRole('textbox', { name: '标记新名称' }), '严重风险');
    await user.click(screen.getByRole('button', { name: '保存标记名称' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.updateMarkerDefinition,
      payload: { definition: expect.objectContaining({ id: IDS.customDefinition, name: '严重风险' }) },
    }));

    await user.click(screen.getByRole('button', { name: '删除标记组 风险' }));
    expect(screen.getByRole('alertdialog', { name: '确认删除标记组 风险' }))
      .toHaveTextContent('将删除 1 个定义、1 个主题实例，并从 1 个图例位置清理引用');
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.deleteMarkerGroup,
      payload: { groupId: IDS.customGroup },
    }));
  });

  it('edits visible/title/x/y/itemOrder through distinct legend commands', async () => {
    const user = userEvent.setup();
    const { document, sheetId, currentMarker } = setup();
    const onCommand = vi.fn();
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly={false}
        onCommand={onCommand}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: '显示标记图例' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.patchMarkerLegend,
      payload: { patch: { visible: false } },
    }));
    const title = screen.getByRole('textbox', { name: '标记图例标题' });
    await user.clear(title);
    await user.type(title, '项目风险');
    await user.click(screen.getByRole('button', { name: '保存标记图例标题' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.patchMarkerLegend,
      payload: { patch: { title: '项目风险' } },
    }));

    fireEvent.change(screen.getByRole('spinbutton', { name: '标记图例 X 坐标' }), { target: { value: '300' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '标记图例 Y 坐标' }), { target: { value: '-120' } });
    await user.click(screen.getByRole('button', { name: '移动' }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.moveMarkerLegend,
      payload: { position: { x: 300, y: -120 } },
    }));

    await user.click(screen.getByRole('checkbox', { name: `图例包含 ${currentDefinitionName(document, currentMarker.markerDefinitionId)}` }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: MIND_MAP_COMMAND_TYPES.reorderMarkerLegendItems,
      payload: { itemOrder: [] },
    }));
  });

  it('keeps marker and legend values readable in read-only mode with no write controls', () => {
    const { document, sheetId, currentMarker, currentDefinition } = setup();
    render(
      <MarkerLegendPanel
        document={document}
        sheetId={sheetId}
        topicId={currentMarker.topicId}
        readOnly
        onCommand={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(`${currentDefinition.name}，已应用`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /应用或替换为标记|移除标记/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装缺少的标准标记组' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '显示标记图例' })).not.toBeInTheDocument();
    expect(screen.getByText('已显示')).toBeInTheDocument();
    expect(screen.getByText(/x 680 · y -220/)).toBeInTheDocument();
  });
});

const currentDefinitionName = (
  document: ReturnType<typeof createMindMapElementsFixture>,
  id: MarkerDefinitionId,
): string => document.markerDefinitions[id].name;
