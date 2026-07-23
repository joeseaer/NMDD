import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeMindMapCommand } from '../commands/engine';
import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import type { MindMapDocumentV1, SheetId, TodoId, TopicId } from '../domain/types';
import { getChildrenSorted } from '../domain/tree';
import { createMindMapElementsFixture } from '../testing/fixtures';
import type { TopicEnrichmentCommand } from './enrichmentPlanning';
import { TopicEnrichmentPanel } from './TopicEnrichmentPanel';

afterEach(cleanup);

interface Fixture {
  document: MindMapDocumentV1;
  sheetId: SheetId;
  rootId: TopicId;
  childIds: readonly [TopicId, TopicId];
}

const createFixture = (withChildTodos = false): Fixture => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const children = getChildrenSorted(sheet, sheet.rootTopicId);
  if (!children[0] || !children[1]) throw new Error('Fixture requires two direct children.');
  sheet.todos = {};
  if (withChildTodos) {
    const firstId = '018f0000-0000-7000-8000-000000009930' as TodoId;
    const secondId = '018f0000-0000-7000-8000-000000009931' as TodoId;
    sheet.todos[firstId] = { id: firstId, topicId: children[0].id, completed: false };
    sheet.todos[secondId] = { id: secondId, topicId: children[1].id, completed: false };
  }
  return {
    document,
    sheetId,
    rootId: sheet.rootTopicId,
    childIds: [children[0].id, children[1].id],
  };
};

interface HarnessProps extends Fixture {
  selectedTopicIds: readonly TopicId[];
  readOnly?: boolean;
  onCommand?: (command: TopicEnrichmentCommand) => void;
}

const Harness = ({
  document: initialDocument,
  sheetId,
  rootId,
  selectedTopicIds,
  readOnly = false,
  onCommand,
}: HarnessProps) => {
  const [document, setDocument] = useState(initialDocument);
  return (
    <TopicEnrichmentPanel
      document={document}
      sheetId={sheetId}
      topicId={rootId}
      selectedTopicIds={selectedTopicIds}
      section="todo"
      readOnly={readOnly}
      onSectionChange={() => undefined}
      onCommand={(command) => {
        onCommand?.(command);
        setDocument(executeMindMapCommand(document, command).document);
      }}
      onClose={() => undefined}
    />
  );
};

describe('ACC-SEM-019 full bulk To-do UI', () => {
  it('offers explicit multi-selection apply, complete, reopen, and remove actions as one command per click', async () => {
    const user = userEvent.setup();
    const fixture = createFixture();
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        {...fixture}
        selectedTopicIds={[fixture.rootId, fixture.childIds[0], fixture.childIds[0]]}
        onCommand={onCommand}
      />,
    );

    expect(screen.getByTestId('mindmap-bulk-todo-controls')).toHaveTextContent('已选择 2 个主题');
    await user.click(screen.getByRole('button', { name: '批量应用待办 (2)' }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.batchUpdateTodos,
      payload: { upserts: expect.arrayContaining([expect.objectContaining({ completed: false })]) },
    });

    await user.click(screen.getByRole('button', { name: '批量标记已完成 (2)' }));
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('mindmap-bulk-todo-controls')).toHaveTextContent('完成 2');

    await user.click(screen.getByRole('button', { name: '批量标记未完成 (2)' }));
    expect(onCommand).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('mindmap-bulk-todo-controls')).toHaveTextContent('完成 0');

    await user.click(screen.getByRole('button', { name: '批量移除待办 (2)' }));
    expect(onCommand).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('mindmap-bulk-todo-controls')).toHaveTextContent('待办 0');
    expect(onCommand.mock.calls.every(([command]) =>
      command.type === MIND_MAP_COMMAND_TYPES.batchUpdateTodos)).toBe(true);
  });

  it('completes and cancels all direct-child To-dos while progress updates immediately', async () => {
    const user = userEvent.setup();
    const fixture = createFixture(true);
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        {...fixture}
        selectedTopicIds={[fixture.rootId]}
        onCommand={onCommand}
      />,
    );

    expect(screen.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '0%');
    await user.click(screen.getByRole('button', { name: '完成全部直属子项' }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      type: MIND_MAP_COMMAND_TYPES.batchUpdateTodos,
      payload: { upserts: [expect.any(Object), expect.any(Object)] },
    });
    expect(screen.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '100%');

    await user.click(screen.getByRole('button', { name: '取消全部直属子项完成' }));
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '0%');
  });

  it('shows multi-selection counts but exposes zero mutation controls in read-only mode', () => {
    const fixture = createFixture();
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        {...fixture}
        selectedTopicIds={[fixture.rootId, fixture.childIds[0]]}
        readOnly
        onCommand={onCommand}
      />,
    );
    expect(screen.getByTestId('mindmap-bulk-todo-controls')).toHaveTextContent('只读模式不会创建批量事务');
    expect(screen.queryByRole('button', { name: /批量/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全部直属子项/ })).not.toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
