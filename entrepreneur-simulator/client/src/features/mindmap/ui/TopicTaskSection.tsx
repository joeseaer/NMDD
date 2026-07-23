import {
  ClipboardList,
  Pencil,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import type {
  ActorId,
  MindMapDocumentV1,
  SheetId,
  TaskDisplayField,
  TaskStatus,
  TopicId,
  TopicTask,
} from '../domain/types';
import {
  planDeleteTopicTaskCommand,
  planUpsertTopicTaskCommand,
  type TopicEnrichmentCommand,
} from './enrichmentPlanning';
import { TopicTaskDependencyEditor } from './TopicTaskDependencyEditor';

export interface TopicTaskSectionProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly readOnly: boolean;
  onCommand(command: TopicEnrichmentCommand): void;
}

interface TaskDraft {
  readonly status: TaskStatus;
  readonly progressPercent: string;
  readonly priority: '' | '1' | '2' | '3' | '4' | '5';
  readonly startDate: string;
  readonly dueDate: string;
  readonly durationMinutes: string;
  readonly milestone: boolean;
  readonly assigneeIds: readonly ActorId[];
  readonly displayFields: readonly TaskDisplayField[];
}

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  'not-started': '未开始',
  'in-progress': '进行中',
  blocked: '已阻塞',
  done: '已完成',
  cancelled: '已取消',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS) as Array<[
  TaskStatus,
  string,
]>;

const DISPLAY_FIELD_OPTIONS: ReadonlyArray<{
  readonly value: TaskDisplayField;
  readonly label: string;
}> = [
  { value: 'status', label: '状态' },
  { value: 'progress', label: '进度' },
  { value: 'priority', label: '优先级' },
  { value: 'assignees', label: '负责人' },
  { value: 'start-date', label: '开始日期' },
  { value: 'due-date', label: '截止日期' },
  { value: 'duration', label: '工期' },
  { value: 'dependencies', label: '依赖关系' },
  { value: 'creator', label: '创建者' },
];

const percentText = (task: TopicTask): string => {
  const percentage = Math.round(task.progress * 10_000) / 100;
  return Number.isInteger(percentage) ? String(percentage) : percentage.toFixed(2);
};

const draftFromTask = (task?: TopicTask): TaskDraft => ({
  status: task?.status ?? 'not-started',
  progressPercent: task ? percentText(task) : '0',
  priority: task?.priority ? String(task.priority) as TaskDraft['priority'] : '',
  startDate: task?.startDate ?? '',
  dueDate: task?.dueDate ?? '',
  durationMinutes: task?.durationMinutes === undefined ? '' : String(task.durationMinutes),
  milestone: task?.milestone ?? false,
  assigneeIds: [...(task?.assigneeIds ?? [])],
  displayFields: [...(task?.displayFields ?? ['status', 'progress'])],
});

const progressForStatus = (status: TaskStatus, currentText: string): string => {
  const current = Number(currentText);
  if (status === 'not-started') return '0';
  if (status === 'done') return '100';
  if (status === 'in-progress') {
    if (!Number.isFinite(current) || current <= 0 || current >= 100) return '1';
    return String(current);
  }
  if (!Number.isFinite(current) || current < 0) return '0';
  if (current >= 100) return '99';
  return String(current);
};

const toggleValue = <T extends string>(values: readonly T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];

const taskSummary = (
  document: MindMapDocumentV1,
  task: TopicTask,
): string[] => {
  const values: string[] = [];
  if (task.priority) values.push(`优先级 ${task.priority}`);
  if (task.startDate) values.push(`开始 ${task.startDate}`);
  if (task.dueDate) values.push(`截止 ${task.dueDate}`);
  if (task.durationMinutes) values.push(`工期 ${task.durationMinutes} 分钟`);
  if (task.milestone) values.push('里程碑');
  const names = (task.assigneeIds ?? [])
    .map((actorId) => document.actors[actorId]?.displayName || '缺失负责人');
  if (names.length > 0) values.push(`负责人 ${names.join('、')}`);
  return values;
};

export const TopicTaskSection = ({
  document,
  sheetId,
  topicId,
  readOnly,
  onCommand,
}: TopicTaskSectionProps) => {
  const sheet = document.sheets[sheetId];
  const task = useMemo(() => sheet
    ? Object.values(sheet.tasks).find((candidate) => candidate.topicId === topicId)
    : undefined, [sheet, topicId]);
  const actors = useMemo(() => Object.values(document.actors)
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id)),
  [document.actors]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(task));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(draftFromTask(task));
    setError(null);
  }, [sheetId, task?.id, topicId]);

  if (!sheet?.topics[topicId]) return null;

  const beginEdit = (): void => {
    setDraft(draftFromTask(task));
    setError(null);
    setEditing(true);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (readOnly) return;
    try {
      const durationMinutes = draft.durationMinutes.trim()
        ? Number(draft.durationMinutes)
        : undefined;
      const priority = draft.priority
        ? Number(draft.priority) as 1 | 2 | 3 | 4 | 5
        : undefined;
      onCommand(planUpsertTopicTaskCommand({
        document,
        sheetId,
        topicId,
        ...(task ? { taskId: task.id } : {}),
        status: draft.status,
        progressPercent: Number(draft.progressPercent),
        ...(priority ? { priority } : {}),
        startDate: draft.startDate,
        dueDate: draft.dueDate,
        ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        milestone: draft.milestone,
        assigneeIds: draft.assigneeIds,
        displayFields: draft.displayFields,
      }));
      setEditing(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = (): void => {
    if (!task || readOnly) return;
    try {
      onCommand(planDeleteTopicTaskCommand({
        document,
        sheetId,
        topicId,
        taskId: task.id,
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const creatorId = task?.audit?.createdBy;
  const creatorAvailable = Boolean(creatorId && document.actors[creatorId]);

  return (
    <section aria-label="主题任务" data-testid="mindmap-topic-task-section">
      <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] leading-4 text-indigo-800">
        Task 是项目管理对象，包含进度、日期和负责人；它与轻量待办互相独立，不会自动同步状态。
      </div>

      {editing && !readOnly ? (
        <form className="space-y-3" aria-label="编辑主题任务" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-slate-600">
              状态
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
                aria-label="任务状态"
                value={draft.status}
                onChange={(event) => {
                  const status = event.currentTarget.value as TaskStatus;
                  setDraft((previous) => ({
                    ...previous,
                    status,
                    progressPercent: progressForStatus(status, previous.progressPercent),
                  }));
                }}
              >
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              进度（%）
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-blue-400 disabled:bg-slate-50"
                aria-label="任务进度百分比"
                min={draft.status === 'in-progress' ? 1 : 0}
                max={draft.status === 'done' ? 100 : draft.status === 'not-started' ? 0 : 99}
                step="1"
                disabled={draft.status === 'not-started' || draft.status === 'done'}
                value={draft.progressPercent}
                onChange={(event) => {
                  const progressPercent = event.currentTarget.value;
                  setDraft((previous) => ({ ...previous, progressPercent }));
                }}
              />
            </label>
          </div>

          <label className="block text-[11px] font-medium text-slate-600">
            优先级
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-blue-400"
              aria-label="任务优先级"
              value={draft.priority}
              onChange={(event) => {
                const priority = event.currentTarget.value as TaskDraft['priority'];
                setDraft((previous) => ({ ...previous, priority }));
              }}
            >
              <option value="">未设置</option>
              {[1, 2, 3, 4, 5].map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-slate-600">
              开始日期
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-blue-400"
                aria-label="任务开始日期"
                value={draft.startDate}
                onChange={(event) => {
                  const startDate = event.currentTarget.value;
                  setDraft((previous) => ({ ...previous, startDate }));
                }}
              />
            </label>
            <label className="text-[11px] font-medium text-slate-600">
              截止日期
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-blue-400"
                aria-label="任务截止日期"
                value={draft.dueDate}
                onChange={(event) => {
                  const dueDate = event.currentTarget.value;
                  setDraft((previous) => ({ ...previous, dueDate }));
                }}
              />
            </label>
          </div>

          <label className="block text-[11px] font-medium text-slate-600">
            工期（分钟）
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-blue-400"
              aria-label="任务工期分钟"
              min="1"
              step="1"
              value={draft.durationMinutes}
              onChange={(event) => {
                const durationMinutes = event.currentTarget.value;
                setDraft((previous) => ({ ...previous, durationMinutes }));
              }}
            />
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              aria-label="标记为里程碑"
              checked={draft.milestone}
              onChange={(event) => {
                const milestone = event.currentTarget.checked;
                setDraft((previous) => ({ ...previous, milestone }));
              }}
            />
            标记为里程碑
          </label>

          <fieldset className="rounded-lg border border-slate-200 p-2.5">
            <legend className="px-1 text-[11px] font-medium text-slate-600">负责人</legend>
            {actors.length > 0 ? (
              <div className="space-y-1.5">
                {actors.map((actor) => (
                  <label key={actor.id} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      aria-label={`任务负责人 ${actor.displayName}`}
                      checked={draft.assigneeIds.includes(actor.id)}
                      onChange={() => setDraft((previous) => ({
                        ...previous,
                        assigneeIds: toggleValue(previous.assigneeIds, actor.id),
                      }))}
                    />
                    <span className="min-w-0 flex-1 truncate">{actor.displayName}</span>
                    <span className="text-[9px] text-slate-400">{actor.status}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400">文档中暂无可分配成员。</p>
            )}
          </fieldset>

          <fieldset className="rounded-lg border border-slate-200 p-2.5">
            <legend className="px-1 text-[11px] font-medium text-slate-600">节点显示字段</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {DISPLAY_FIELD_OPTIONS.map(({ value, label }) => {
                const creatorUnavailable = value === 'creator' && !creatorAvailable;
                return (
                  <label
                    key={value}
                    className={`flex items-center gap-1.5 text-[11px] ${creatorUnavailable
                      ? 'text-slate-300'
                      : 'text-slate-700'}`}
                    title={creatorUnavailable ? '当前 Task 没有可解析的创建者元数据' : undefined}
                  >
                    <input
                      type="checkbox"
                      aria-label={`显示任务字段 ${label}`}
                      disabled={creatorUnavailable}
                      checked={draft.displayFields.includes(value)}
                      onChange={() => setDraft((previous) => ({
                        ...previous,
                        displayFields: toggleValue(previous.displayFields, value),
                      }))}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              <X size={13} aria-hidden="true" />取消
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white"
            >
              <Save size={13} aria-hidden="true" />保存任务
            </button>
          </div>
        </form>
      ) : task ? (
        <div className="rounded-xl border border-indigo-200 bg-white p-3" data-testid="mindmap-topic-task">
          <div className="flex items-start gap-2">
            <ClipboardList size={18} className="mt-0.5 shrink-0 text-indigo-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">{STATUS_LABELS[task.status]}</p>
                <span className="text-xs font-semibold tabular-nums text-indigo-700">{percentText(task)}%</span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label="主题任务进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={task.progress * 100}
              >
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${task.progress * 100}%` }}
                />
              </div>
              {taskSummary(document, task).length > 0 ? (
                <ul className="mt-2 space-y-1 text-[10px] text-slate-500">
                  {taskSummary(document, task).map((value) => <li key={value}>{value}</li>)}
                </ul>
              ) : null}
              {task.displayFields && task.displayFields.length > 0 ? (
                <p className="mt-2 text-[9px] text-slate-400">
                  节点字段：{task.displayFields
                    .map((field) => DISPLAY_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field)
                    .join('、')}
                </p>
              ) : null}
            </div>
          </div>
          <TopicTaskDependencyEditor
            document={document}
            sheetId={sheetId}
            topicId={topicId}
            task={task}
            readOnly={readOnly}
            onCommand={onCommand}
          />
          {!readOnly ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                onClick={beginEdit}
              >
                <Pencil size={13} aria-hidden="true" />编辑任务
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                onClick={remove}
              >
                <Trash2 size={13} aria-hidden="true" />删除任务
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center">
          <ClipboardList size={22} className="mx-auto text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-xs text-slate-500">当前主题没有 Task。</p>
          {!readOnly ? (
            <button
              type="button"
              className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white"
              onClick={beginEdit}
            >
              添加任务
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
