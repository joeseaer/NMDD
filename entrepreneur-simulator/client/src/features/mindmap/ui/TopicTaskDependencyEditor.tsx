import {
  GitBranch,
  Pencil,
  Plus,
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
  MindMapDocumentV1,
  SheetId,
  TaskDependencyId,
  TaskDependencyType,
  TaskId,
  TopicId,
  TopicTask,
} from '../domain/types';
import {
  listTopicTaskDependencies,
  listTopicTaskDependencyCandidates,
  planDeleteTopicTaskDependencyCommand,
  planUpsertTopicTaskDependencyCommand,
  type TopicEnrichmentCommand,
  type TopicTaskDependencyDirection,
  type TopicTaskDependencyView,
} from './enrichmentPlanning';

export interface TopicTaskDependencyEditorProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
  readonly task: TopicTask;
  readonly readOnly: boolean;
  onCommand(command: TopicEnrichmentCommand): void;
}

interface DependencyDraft {
  readonly direction: TopicTaskDependencyDirection;
  readonly otherTaskId: string;
  readonly type: TaskDependencyType;
  readonly lagMinutes: string;
}

const TYPE_LABELS: Readonly<Record<TaskDependencyType, string>> = {
  'finish-start': 'FS · 完成后开始',
  'start-start': 'SS · 同步开始',
  'finish-finish': 'FF · 同步完成',
  'start-finish': 'SF · 开始后完成',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS) as Array<[TaskDependencyType, string]>;

const directionLabel = (direction: TopicTaskDependencyDirection): string => (
  direction === 'predecessor' ? '前置任务（对方 → 当前）' : '后续任务（当前 → 对方）'
);

const lagLabel = (lagMinutes: number | undefined): string => {
  if (!lagMinutes) return '无延迟';
  return lagMinutes > 0 ? `延迟 ${lagMinutes} 分钟` : `提前 ${Math.abs(lagMinutes)} 分钟`;
};

const draftFromView = (view: TopicTaskDependencyView): DependencyDraft => ({
  direction: view.direction,
  otherTaskId: view.otherTaskId,
  type: view.dependency.type,
  lagMinutes: view.dependency.lagMinutes === undefined
    ? '0'
    : String(view.dependency.lagMinutes),
});

export const TopicTaskDependencyEditor = ({
  document,
  sheetId,
  topicId,
  task,
  readOnly,
  onCommand,
}: TopicTaskDependencyEditorProps) => {
  const context = useMemo(() => ({ document, sheetId, topicId }), [document, sheetId, topicId]);
  const candidates = useMemo(
    () => listTopicTaskDependencyCandidates(context),
    [context],
  );
  const dependencies = useMemo(
    () => listTopicTaskDependencies(context),
    [context],
  );
  const [draft, setDraft] = useState<DependencyDraft | null>(null);
  const [editingDependencyId, setEditingDependencyId] = useState<TaskDependencyId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setEditingDependencyId(null);
    setError(null);
  }, [sheetId, task.id, topicId]);

  const beginCreate = (direction: TopicTaskDependencyDirection): void => {
    if (readOnly) return;
    const candidate = candidates[0];
    if (!candidate) {
      setError('当前 Sheet 需要至少另一个带 Task 的主题才能建立依赖。');
      return;
    }
    setEditingDependencyId(null);
    setDraft({
      direction,
      otherTaskId: candidate.taskId,
      type: 'finish-start',
      lagMinutes: '0',
    });
    setError(null);
  };

  const beginEdit = (view: TopicTaskDependencyView): void => {
    if (readOnly) return;
    setEditingDependencyId(view.dependency.id);
    setDraft(draftFromView(view));
    setError(null);
  };

  const cancelEdit = (): void => {
    setEditingDependencyId(null);
    setDraft(null);
    setError(null);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (readOnly || !draft) return;
    try {
      const lagMinutes = Number(draft.lagMinutes.trim() || '0');
      onCommand(planUpsertTopicTaskDependencyCommand({
        document,
        sheetId,
        topicId,
        direction: draft.direction,
        otherTaskId: draft.otherTaskId as TaskId,
        type: draft.type,
        lagMinutes,
        ...(editingDependencyId ? { dependencyId: editingDependencyId } : {}),
      }));
      setEditingDependencyId(null);
      setDraft(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = (dependencyId: TaskDependencyId): void => {
    if (readOnly) return;
    try {
      onCommand(planDeleteTopicTaskDependencyCommand({
        document,
        sheetId,
        topicId,
        dependencyId,
      }));
      if (editingDependencyId === dependencyId) cancelEdit();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section
      className="mt-3 border-t border-indigo-100 pt-3"
      aria-label="Task 依赖关系"
      data-testid="mindmap-topic-task-dependencies"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitBranch size={14} className="shrink-0 text-indigo-500" aria-hidden="true" />
          <h4 className="text-[11px] font-semibold text-slate-700">依赖关系</h4>
        </div>
        <span className="text-[9px] tabular-nums text-slate-400">{dependencies.length} 条</span>
      </div>

      {dependencies.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {dependencies.map((view) => (
            <li
              key={view.dependency.id}
              className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2"
              data-testid={`mindmap-task-dependency-${view.dependency.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-indigo-700">
                    {directionLabel(view.direction)}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-700">
                    {view.otherTopicTitle}
                  </p>
                  <p className="mt-0.5 text-[9px] text-slate-500">
                    {TYPE_LABELS[view.dependency.type]} · {lagLabel(view.dependency.lagMinutes)}
                  </p>
                </div>
                {!readOnly ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-indigo-600"
                      aria-label={`编辑依赖 ${view.otherTopicTitle}`}
                      onClick={() => beginEdit(view)}
                    >
                      <Pencil size={11} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-100 bg-white p-1 text-red-500 hover:bg-red-50"
                      aria-label={`删除依赖 ${view.otherTopicTitle}`}
                      onClick={() => remove(view.dependency.id)}
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] text-slate-400">尚未设置前置或后续 Task。</p>
      )}

      {!readOnly && !draft ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-200 px-2 py-1.5 text-[10px] text-indigo-700 hover:bg-indigo-50"
            onClick={() => beginCreate('predecessor')}
          >
            <Plus size={11} aria-hidden="true" />添加前置任务
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-200 px-2 py-1.5 text-[10px] text-indigo-700 hover:bg-indigo-50"
            onClick={() => beginCreate('successor')}
          >
            <Plus size={11} aria-hidden="true" />添加后续任务
          </button>
        </div>
      ) : null}

      {!readOnly && draft ? (
        <form className="mt-2 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-2.5" onSubmit={submit}>
          <label className="block text-[10px] font-medium text-slate-600">
            方向
            <select
              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              aria-label="Task 依赖方向"
              value={draft.direction}
              onChange={(event) => {
                const direction = event.currentTarget.value as TopicTaskDependencyDirection;
                setDraft((previous) => previous ? { ...previous, direction } : previous);
              }}
            >
              <option value="predecessor">前置任务（对方 → 当前）</option>
              <option value="successor">后续任务（当前 → 对方）</option>
            </select>
          </label>

          <label className="block text-[10px] font-medium text-slate-600">
            关联 Topic Task
            <select
              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
              aria-label="Task 依赖目标"
              value={draft.otherTaskId}
              onChange={(event) => {
                const otherTaskId = event.currentTarget.value;
                setDraft((previous) => previous ? { ...previous, otherTaskId } : previous);
              }}
            >
              {candidates.map((candidate) => (
                <option key={candidate.taskId} value={candidate.taskId}>
                  {candidate.path.join(' / ')}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-medium text-slate-600">
              类型
              <select
                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                aria-label="Task 依赖类型"
                value={draft.type}
                onChange={(event) => {
                  const type = event.currentTarget.value as TaskDependencyType;
                  setDraft((previous) => previous ? { ...previous, type } : previous);
                }}
              >
                {TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-medium text-slate-600">
              延迟（分钟，可为负）
              <input
                type="number"
                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
                aria-label="Task 依赖延迟分钟"
                min="-525960000"
                max="525960000"
                step="1"
                value={draft.lagMinutes}
                onChange={(event) => {
                  const lagMinutes = event.currentTarget.value;
                  setDraft((previous) => previous ? { ...previous, lagMinutes } : previous);
                }}
              />
            </label>
          </div>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600"
              onClick={cancelEdit}
            >
              <X size={11} aria-hidden="true" />取消
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1.5 text-[10px] font-medium text-white"
            >
              <Save size={11} aria-hidden="true" />保存依赖
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[10px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
