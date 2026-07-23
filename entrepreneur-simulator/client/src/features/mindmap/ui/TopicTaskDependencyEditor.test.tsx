import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeMindMapCommand } from '../commands/engine';
import { MIND_MAP_COMMAND_TYPES } from '../commands/types';
import type {
  MindMapDocumentV1,
  SheetId,
  TaskDependencyId,
  TaskId,
  TopicId,
} from '../domain/types';
import { createMindMapElementsFixture } from '../testing/fixtures';
import { mindMapRichTextToPlainText } from '../view/text';
import type { TopicEnrichmentCommand } from './enrichmentPlanning';
import { TopicTaskSection } from './TopicTaskSection';

afterEach(cleanup);

const fixture = (clearDependencies = false) => {
  const document = createMindMapElementsFixture();
  const sheetId = Object.keys(document.sheets)[0] as SheetId;
  const sheet = document.sheets[sheetId];
  const [dependency] = Object.values(sheet.taskDependencies);
  const task = sheet.tasks[dependency.predecessorTaskId];
  const otherTask = sheet.tasks[dependency.successorTaskId];
  const otherTitle = mindMapRichTextToPlainText(sheet.topics[otherTask.topicId].title);
  const rootTitle = mindMapRichTextToPlainText(sheet.topics[sheet.rootTopicId].title);
  if (clearDependencies) {
    sheet.taskDependencies = {};
  } else {
    const rootTaskId = '018f9000-0000-7000-8000-000000000810' as TaskId;
    const incomingId = '018f9000-0000-7000-8000-000000000811' as TaskDependencyId;
    sheet.tasks[rootTaskId] = {
      id: rootTaskId,
      progress: 0,
      status: 'not-started',
      topicId: sheet.rootTopicId,
    };
    sheet.taskDependencies[incomingId] = {
      id: incomingId,
      predecessorTaskId: rootTaskId,
      successorTaskId: task.id,
      type: 'start-start',
    };
  }
  return { dependency, document, otherTask, otherTitle, rootTitle, sheetId, task };
};

interface HarnessProps {
  readonly initialDocument: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly readOnly?: boolean;
  readonly onCommand?: (command: TopicEnrichmentCommand) => void;
}

const Harness = ({
  initialDocument,
  sheetId,
  topicId,
  readOnly = false,
  onCommand,
}: HarnessProps) => {
  const [document, setDocument] = useState(initialDocument);
  return (
    <TopicTaskSection
      document={document}
      sheetId={sheetId}
      topicId={topicId}
      readOnly={readOnly}
      onCommand={(command) => {
        onCommand?.(command);
        setDocument(executeMindMapCommand(document, command).document);
      }}
    />
  );
};

describe('TopicTaskSection dependency integration', () => {
  it('shows direction/title and edits/deletes one dependency per canonical action', async () => {
    const user = userEvent.setup();
    const data = fixture();
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        initialDocument={data.document}
        sheetId={data.sheetId}
        topicId={data.task.topicId}
        onCommand={onCommand}
      />,
    );

    expect(screen.getByRole('region', { name: 'Task 依赖关系' }))
      .toHaveTextContent('后续任务（当前 → 对方）');
    expect(screen.getByRole('region', { name: 'Task 依赖关系' }))
      .toHaveTextContent('前置任务（对方 → 当前）');
    expect(screen.getByText(data.otherTitle)).toBeInTheDocument();
    expect(screen.getByText(data.rootTitle)).toBeInTheDocument();
    expect(screen.getByText(/FS · 完成后开始/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `编辑依赖 ${data.otherTitle}` }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Task 依赖类型' }), 'start-start');
    const lag = screen.getByRole('spinbutton', { name: 'Task 依赖延迟分钟' });
    await user.clear(lag);
    await user.type(lag, '15');
    await user.click(screen.getByRole('button', { name: '保存依赖' }));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      payload: {
        dependency: {
          id: data.dependency.id,
          lagMinutes: 15,
          type: 'start-start',
        },
      },
      type: MIND_MAP_COMMAND_TYPES.upsertTaskDependency,
    });
    expect(screen.getByText(/SS · 同步开始 · 延迟 15 分钟/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `删除依赖 ${data.otherTitle}` }));
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[1][0]).toMatchObject({
      payload: { dependencyId: data.dependency.id },
      type: MIND_MAP_COMMAND_TYPES.deleteTaskDependency,
    });
    expect(screen.queryByText(data.otherTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task 依赖关系' })).toHaveTextContent('1 条');
  });

  it('creates an incoming dependency from tree-ordered Task candidates, excluding To-dos', async () => {
    const user = userEvent.setup();
    const data = fixture(true);
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        initialDocument={data.document}
        sheetId={data.sheetId}
        topicId={data.task.topicId}
        onCommand={onCommand}
      />,
    );

    await user.click(screen.getByRole('button', { name: '添加前置任务' }));
    const target = screen.getByRole('combobox', { name: 'Task 依赖目标' });
    expect((target as HTMLSelectElement).selectedOptions[0]?.textContent)
      .toContain(data.otherTitle);
    expect(target.querySelectorAll('option')).toHaveLength(
      Object.keys(data.document.sheets[data.sheetId].tasks).length - 1,
    );
    await user.click(screen.getByRole('button', { name: '保存依赖' }));

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0][0]).toMatchObject({
      payload: {
        dependency: {
          predecessorTaskId: data.otherTask.id,
          successorTaskId: data.task.id,
          type: 'finish-start',
        },
      },
      type: MIND_MAP_COMMAND_TYPES.upsertTaskDependency,
    });
    expect(screen.getByText('前置任务（对方 → 当前）')).toBeInTheDocument();
  });

  it('keeps dependencies visible but exposes zero write controls in read-only mode', () => {
    const data = fixture();
    const onCommand = vi.fn<(command: TopicEnrichmentCommand) => void>();
    render(
      <Harness
        initialDocument={data.document}
        sheetId={data.sheetId}
        topicId={data.task.topicId}
        readOnly
        onCommand={onCommand}
      />,
    );
    expect(screen.getByText(data.otherTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /添加前置任务|添加后续任务|编辑依赖|删除依赖|保存依赖/ }))
      .not.toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
  });
});
