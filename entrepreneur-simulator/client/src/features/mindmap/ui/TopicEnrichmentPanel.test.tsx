import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeMindMapCommand } from '../commands/engine';
import type { ActorId, MindMapDocumentV1, SheetId, TopicId } from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import type { TopicEnrichmentCommand } from './enrichmentPlanning';
import {
  TopicEnrichmentPanel,
  type TopicEnrichmentSection,
} from './TopicEnrichmentPanel';

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

const fixture = () => {
  const document = createMindMapElementsFixture();
  const actorId = '018f0000-0000-7000-8000-000000009930' as ActorId;
  document.actors[actorId] = {
    id: actorId,
    displayName: 'Ada Task Owner',
    email: 'ada.task@example.test',
    status: 'active',
  };
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const noteTopicIds = new Set(Object.values(sheet.notes).map((note) => note.topicId));
  const taskTopicIds = new Set(Object.values(sheet.tasks).map((task) => task.topicId));
  const topicId = (Object.keys(sheet.topics) as TopicId[])
    .find((candidate) => !noteTopicIds.has(candidate) && !taskTopicIds.has(candidate))!;
  return { actorId, document, sheetId, topicId };
};

interface HarnessProps {
  readonly initialSection?: TopicEnrichmentSection;
  readonly readOnly?: boolean;
  readonly onApplied?: (document: MindMapDocumentV1) => void;
}

const Harness = ({
  initialSection = 'labels',
  readOnly = false,
  onApplied,
}: HarnessProps) => {
  const initial = fixture();
  const [document, setDocument] = useState(initial.document);
  const [section, setSection] = useState<TopicEnrichmentSection>(initialSection);
  const dispatch = (command: TopicEnrichmentCommand): void => {
    const next = executeMindMapCommand(document, command).document;
    setDocument(next);
    onApplied?.(next);
  };
  return (
    <TopicEnrichmentPanel
      document={document}
      sheetId={initial.sheetId}
      topicId={initial.topicId}
      section={section}
      readOnly={readOnly}
      onSectionChange={setSection}
      onCommand={dispatch}
      onClose={() => undefined}
    />
  );
};

describe('TopicEnrichmentPanel', () => {
  it('ACC-SEM-015 adds and removes searchable labels through canonical commands', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('textbox', { name: '新标签' }), '  产品  ');
    await user.click(screen.getByRole('button', { name: '添加标签' }));
    expect(screen.getByText('产品')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除标签 产品' }));
    expect(screen.queryByText('产品')).not.toBeInTheDocument();
    expect(screen.getByText('暂无标签')).toBeInTheDocument();
  });

  it('adds comma-separated labels and reorders them with one canonical update per action', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn<(document: MindMapDocumentV1) => void>();
    render(<Harness onApplied={onApplied} />);

    await user.type(screen.getByRole('textbox', { name: '新标签' }), '产品, 增长，复盘');
    await user.click(screen.getByRole('button', { name: '添加标签' }));
    let latest = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    expect(latest?.sheets[fixture().sheetId].topics[fixture().topicId].labels)
      .toEqual(['产品', '增长', '复盘']);

    await user.click(screen.getByRole('button', { name: '前移标签 复盘' }));
    latest = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    expect(latest?.sheets[fixture().sheetId].topics[fixture().topicId].labels)
      .toEqual(['产品', '复盘', '增长']);
    expect(screen.getByRole('button', { name: '前移标签 产品' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '后移标签 增长' })).toBeDisabled();
  });

  it('ACC-SEM-015 edits a long-form Note where Enter creates content and Ctrl+Enter commits', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(<Harness initialSection="note" onApplied={onApplied} />);

    await user.click(screen.getByRole('button', { name: '添加笔记' }));
    const editor = screen.getByRole('textbox', { name: '编辑主题笔记' });
    await user.type(editor, '第一段{Enter}第二段');
    expect(editor).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('document', { name: '主题笔记内容' })).toHaveTextContent('第一段');
    expect(screen.getByRole('document', { name: '主题笔记内容' })).toHaveTextContent('第二段');
  });

  it('ACC-KBD-022 rejects dangerous URLs, then creates and edits a safe Link', async () => {
    const user = userEvent.setup();
    render(<Harness initialSection="links" />);

    const href = screen.getByRole('textbox', { name: '链接地址' });
    await user.type(href, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: '添加链接' }));
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持 http、https 和 mailto');

    await user.clear(href);
    await user.type(href, 'example.com/docs');
    await user.type(screen.getByRole('textbox', { name: '链接标题' }), '产品文档');
    await user.click(screen.getByRole('button', { name: '添加链接' }));
    expect(screen.getByText('产品文档')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑链接 产品文档' }));
    const editHref = screen.getByRole('textbox', { name: '链接地址' });
    await user.clear(editHref);
    await user.type(editHref, 'owner@example.com');
    await user.click(screen.getByRole('button', { name: '保存链接' }));
    expect(screen.getByText('邮箱')).toBeInTheDocument();
  });

  it('creates and retargets an internal Topic/Sheet Link in place', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn<(document: MindMapDocumentV1) => void>();
    render(<Harness initialSection="links" onApplied={onApplied} />);

    await user.click(screen.getByRole('button', { name: '添加内部链接' }));
    await user.type(screen.getByRole('textbox', { name: '搜索 Sheet 或主题' }), '市场发布');
    const marketTarget = screen.getAllByRole('option')
      .find((option) => option.textContent?.startsWith('市场发布'));
    expect(marketTarget).toBeDefined();
    await user.click(marketTarget!);
    await user.type(screen.getByRole('textbox', { name: '内部链接显示标题' }), '查看发布计划');
    await user.click(screen.getByRole('button', { name: '保存内部链接' }));

    expect(screen.getByText('查看发布计划')).toBeInTheDocument();
    const createdDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const createdLink = createdDocument
      ? Object.values(createdDocument.sheets[fixture().sheetId].links)
          .find((link) => link.topicId === fixture().topicId && link.title === '查看发布计划')
      : undefined;
    expect(createdLink).toMatchObject({ kind: 'topic', status: 'active' });

    await user.click(screen.getByRole('button', { name: '编辑链接 查看发布计划' }));
    await user.clear(screen.getByRole('textbox', { name: '搜索 Sheet 或主题' }));
    await user.type(screen.getByRole('textbox', { name: '搜索 Sheet 或主题' }), '主画布');
    await user.click(screen.getByRole('option', { name: /整个 Sheet/ }));
    await user.clear(screen.getByRole('textbox', { name: '内部链接显示标题' }));
    await user.type(screen.getByRole('textbox', { name: '内部链接显示标题' }), '返回画布');
    await user.click(screen.getByRole('button', { name: '更新内部链接' }));

    const updatedDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const updatedLink = updatedDocument
      ? updatedDocument.sheets[fixture().sheetId].links[createdLink!.id]
      : undefined;
    expect(updatedLink).toMatchObject({
      id: createdLink?.id,
      kind: 'sheet',
      targetSheetId: fixture().sheetId,
      title: '返回画布',
      status: 'active',
    });
  });

  it('ACC-SEM-015 read-only mode exposes content but no mutating controls', () => {
    render(<Harness readOnly />);
    expect(screen.queryByRole('textbox', { name: '新标签' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加标签' })).not.toBeInTheDocument();
  });

  it('ACC-SEM-019 creates, toggles, and deletes the canonical Topic To-do', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn<(document: MindMapDocumentV1) => void>();
    render(<Harness initialSection="todo" onApplied={onApplied} />);

    expect(screen.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '0%');
    await user.click(screen.getByRole('button', { name: '添加待办' }));
    expect(screen.getByTestId('mindmap-topic-todo')).toHaveTextContent('未完成');

    await user.click(screen.getByRole('button', { name: '标记待办为已完成' }));
    expect(screen.getByTestId('mindmap-topic-todo')).toHaveTextContent('已完成');
    const completedDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const completedTodo = completedDocument
      ? Object.values(completedDocument.sheets[Object.keys(completedDocument.sheets)[0] as SheetId].todos)
          .find((todo) => todo.topicId === fixture().topicId)
      : undefined;
    expect(completedTodo).toMatchObject({ completed: true });
    expect(completedTodo?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await user.click(screen.getByRole('button', { name: '标记待办为未完成' }));
    expect(screen.getByTestId('mindmap-topic-todo')).toHaveTextContent('未完成');
    const reopenedDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const reopenedTodo = reopenedDocument
      ? Object.values(reopenedDocument.sheets[Object.keys(reopenedDocument.sheets)[0] as SheetId].todos)
          .find((todo) => todo.topicId === fixture().topicId)
      : undefined;
    expect(reopenedTodo).toMatchObject({ completed: false });
    expect(reopenedTodo?.completedAt).toBeUndefined();

    await user.click(screen.getByRole('button', { name: '删除待办' }));
    expect(screen.queryByTestId('mindmap-topic-todo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加待办' })).toBeInTheDocument();
  });

  it('ACC-SEM-019 keeps To-do status visible without mutation controls in read-only mode', () => {
    render(<Harness initialSection="todo" readOnly />);
    expect(screen.getByText(/待办是独立的轻量完成状态/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加待办' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /标记待办/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除待办' })).not.toBeInTheDocument();
  });

  it('ACC-SEM-028 creates, validates, edits, and deletes a full Task independently from To-do', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn<(document: MindMapDocumentV1) => void>();
    render(<Harness initialSection="task" onApplied={onApplied} />);

    expect(screen.getByText(/它与轻量待办互相独立/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '添加任务' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '任务状态' }), 'in-progress');
    const progress = screen.getByRole('spinbutton', { name: '任务进度百分比' });
    await user.clear(progress);
    await user.type(progress, '35');
    await user.selectOptions(screen.getByRole('combobox', { name: '任务优先级' }), '2');
    fireEvent.change(screen.getByLabelText('任务开始日期'), { target: { value: '2026-07-20' } });
    fireEvent.change(screen.getByLabelText('任务截止日期'), { target: { value: '2026-07-25' } });
    await user.type(screen.getByRole('spinbutton', { name: '任务工期分钟' }), '240');
    await user.click(screen.getByRole('checkbox', { name: '标记为里程碑' }));
    await user.click(screen.getByRole('checkbox', { name: '任务负责人 Ada Task Owner' }));
    await user.click(screen.getByRole('checkbox', { name: '显示任务字段 优先级' }));
    await user.click(screen.getByRole('button', { name: '保存任务' }));

    expect(screen.getByTestId('mindmap-topic-task')).toHaveTextContent('进行中');
    expect(screen.getByTestId('mindmap-topic-task')).toHaveTextContent('35%');
    const createdDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const createdTask = createdDocument
      ? Object.values(createdDocument.sheets[fixture().sheetId].tasks)
          .find((task) => task.topicId === fixture().topicId)
      : undefined;
    expect(createdTask).toMatchObject({
      status: 'in-progress',
      progress: 0.35,
      priority: 2,
      startDate: '2026-07-20',
      dueDate: '2026-07-25',
      durationMinutes: 240,
      milestone: true,
      assigneeIds: [fixture().actorId],
    });

    await user.click(screen.getByRole('button', { name: '编辑任务' }));
    fireEvent.change(screen.getByLabelText('任务开始日期'), { target: { value: '2026-07-26' } });
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    expect(screen.getByRole('alert')).toHaveTextContent('截止日期不能早于开始日期');

    fireEvent.change(screen.getByLabelText('任务截止日期'), { target: { value: '2026-07-30' } });
    await user.selectOptions(screen.getByRole('combobox', { name: '任务状态' }), 'blocked');
    expect(screen.getByRole('spinbutton', { name: '任务进度百分比' })).toHaveValue(35);
    await user.click(screen.getByRole('button', { name: '保存任务' }));
    const editedDocument = onApplied.mock.calls[onApplied.mock.calls.length - 1]?.[0];
    const editedTask = editedDocument
      ? Object.values(editedDocument.sheets[fixture().sheetId].tasks)
          .find((task) => task.topicId === fixture().topicId)
      : undefined;
    expect(editedTask).toMatchObject({ id: createdTask?.id, status: 'blocked', progress: 0.35 });

    await user.click(screen.getByRole('button', { name: '删除任务' }));
    expect(screen.queryByTestId('mindmap-topic-task')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加任务' })).toBeInTheDocument();
  });

  it('shows Task data but no Task mutation controls in read-only mode', () => {
    render(<Harness initialSection="task" readOnly />);
    expect(screen.getByText(/Task 是项目管理对象/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除任务' })).not.toBeInTheDocument();
  });
});
