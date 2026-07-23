import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMindMapSheet } from '../domain/defaults';
import { createEntityId } from '../domain/ids';
import type { OrderKey } from '../domain/types';
import { createMindMapV1SmallFixture } from '../testing/fixtures';
import { InternalLinkPicker } from './InternalLinkPicker';

afterEach(cleanup);

const fixture = () => {
  const document = createMindMapV1SmallFixture();
  const first = Object.values(document.sheets)[0]!;
  const second = createMindMapSheet({
    id: createEntityId<'Sheet'>(),
    rootTopicId: createEntityId<'Topic'>(),
    themeId: first.themeId,
    orderKey: 'z' as OrderKey,
    title: '市场计划',
    rootTitle: '渠道策略',
  });
  document.sheets[second.id] = second;
  return { document, first, second };
};

describe('InternalLinkPicker', () => {
  it('searches paths and submits a cross-Sheet Topic target with an optional title', async () => {
    const user = userEvent.setup();
    const { document, second } = fixture();
    const onSubmit = vi.fn();
    render(
      <InternalLinkPicker document={document} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByRole('textbox', { name: '搜索 Sheet 或主题' }), '市场 渠道');
    const option = screen.getByRole('option', { name: /渠道策略/ });
    expect(option).toHaveTextContent('市场计划 / 渠道策略');
    await user.click(option);
    await user.type(screen.getByRole('textbox', { name: '内部链接显示标题' }), '查看渠道');
    await user.click(screen.getByRole('button', { name: '保存内部链接' }));

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'topic',
      targetSheetId: second.id,
      targetTopicId: second.rootTopicId,
    }, '查看渠道');
  });

  it('keeps an existing target selected while filtering and can retarget to a Sheet', async () => {
    const user = userEvent.setup();
    const { document, first, second } = fixture();
    const onSubmit = vi.fn();
    render(
      <InternalLinkPicker
        document={document}
        initialTarget={{ kind: 'topic', targetSheetId: first.id, targetTopicId: first.rootTopicId }}
        initialTitle="旧标题"
        submitLabel="更新内部链接"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const selected = within(screen.getByRole('listbox', { name: '内部链接目标' }))
      .getAllByRole('option')
      .find((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveTextContent('创业模拟器');
    await user.type(screen.getByRole('textbox', { name: '搜索 Sheet 或主题' }), '市场计划');
    const sheetOption = screen.getByRole('option', { name: /整个 Sheet/ });
    await user.click(sheetOption);
    await user.clear(screen.getByRole('textbox', { name: '内部链接显示标题' }));
    await user.click(screen.getByRole('button', { name: '更新内部链接' }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: 'sheet', targetSheetId: second.id }, '');
  });

  it('reports a missing selection and exposes both cancel controls', async () => {
    const user = userEvent.setup();
    const { document } = fixture();
    const onCancel = vi.fn();
    render(
      <InternalLinkPicker document={document} onSubmit={vi.fn()} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole('button', { name: '保存内部链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请选择一个仍然存在的 Sheet 或主题');
    await user.click(screen.getByRole('button', { name: '取消内部链接' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
