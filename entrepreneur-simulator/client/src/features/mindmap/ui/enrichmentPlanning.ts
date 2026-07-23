import {
  MIND_MAP_COMMAND_TYPES,
  type BatchUpdateTodosCommand,
  type DeleteLinkCommand,
  type DeleteNoteCommand,
  type DeleteTodoCommand,
  type DeleteTaskCommand,
  type DeleteTaskDependencyCommand,
  type UpdateTopicLabelsCommand,
  type UpsertLinkCommand,
  type UpsertNoteCommand,
  type UpsertTodoCommand,
  type UpsertTaskCommand,
  type UpsertTaskDependencyCommand,
} from '../commands/types';
import { createEntityId } from '../domain/ids';
import { createOrderKeyBetween } from '../domain/orderKey';
import { getChildrenSorted, getTreeRoots } from '../domain/tree';
import type {
  ActorId,
  CommandId,
  LinkId,
  MindMapDocumentV1,
  NoteId,
  RichText,
  SheetId,
  TaskDisplayField,
  TaskDependency,
  TaskDependencyId,
  TaskDependencyType,
  TaskId,
  TaskStatus,
  TopicId,
  TopicLink,
  TopicTask,
  TopicTodo,
  TodoId,
} from '../domain/types';
import { mindMapRichTextToPlainText } from '../view/text';

interface EnrichmentCommandInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly commandId?: CommandId;
  readonly groupId?: string;
  readonly origin?: string;
  readonly timestamp?: string;
}

const commandMetadata = (input: EnrichmentCommandInput) => ({
  commandId: input.commandId ?? createEntityId<'Command'>(),
  sheetId: input.sheetId,
  baseRevision: input.document.contentRevision,
  ...(input.groupId ? { groupId: input.groupId } : {}),
  origin: input.origin ?? 'mindmap-v2-enrichment-panel',
  timestamp: input.timestamp ?? new Date().toISOString(),
});

const getTopic = (input: EnrichmentCommandInput, topicId: TopicId) => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  const topic = sheet.topics[topicId];
  if (!topic) throw new Error(`Topic ${topicId} does not exist.`);
  return { sheet, topic };
};

export interface PlanUpdateTopicLabelsInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly labels: readonly string[];
}

export const normalizeTopicLabels = (labels: readonly string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.trim();
    if (!label || label.length > 256 || /[\u0000-\u001f\u007f]/.test(label)) {
      throw new Error('标签必须是 1–256 个字符，且不能包含控制字符。');
    }
    if (seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  if (result.length > 1024) throw new Error('单个主题最多包含 1024 个标签。');
  return result;
};

export const planUpdateTopicLabelsCommand = (
  input: PlanUpdateTopicLabelsInput,
): UpdateTopicLabelsCommand => {
  getTopic(input, input.topicId);
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.updateTopicLabels,
    payload: {
      topicId: input.topicId,
      labels: normalizeTopicLabels(input.labels),
    },
  };
};

export interface PlanUpsertTopicNoteInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly content: RichText;
  readonly noteId?: NoteId;
}

export const planUpsertTopicNoteCommand = (
  input: PlanUpsertTopicNoteInput,
): UpsertNoteCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const current = Object.values(sheet.notes).find((note) => note.topicId === input.topicId);
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.upsertNote,
    payload: {
      note: {
        id: input.noteId ?? current?.id ?? createEntityId<'Note'>(),
        topicId: input.topicId,
        content: input.content,
      },
    },
  };
};

export interface PlanDeleteTopicNoteInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly noteId?: NoteId;
}

export const planDeleteTopicNoteCommand = (
  input: PlanDeleteTopicNoteInput,
): DeleteNoteCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const noteId = input.noteId
    ?? Object.values(sheet.notes).find((note) => note.topicId === input.topicId)?.id;
  if (!noteId || !sheet.notes[noteId]) throw new Error('当前主题没有可删除的笔记。');
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteNote,
    payload: { noteId },
  };
};

export interface NormalizedExternalTopicLink {
  readonly kind: 'web' | 'email';
  readonly href: string;
}

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DOMAIN_LIKE = /^(?:localhost|(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#].*)?$/iu;

const createOrderKeyAfter = (last: string | undefined): ReturnType<typeof createOrderKeyBetween> => {
  if (last === undefined) return createOrderKeyBetween();
  try {
    return createOrderKeyBetween(last as ReturnType<typeof createOrderKeyBetween>, null);
  } catch {
    if (last.length < 256) return `${last}~` as ReturnType<typeof createOrderKeyBetween>;
    throw new Error('链接顺序空间已用尽，请先重排链接后再添加。');
  }
};

/** Normalizes only browser-safe external links; local files require a desktop bridge. */
export const normalizeExternalTopicLink = (raw: string): NormalizedExternalTopicLink => {
  let href = raw.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) {
    throw new Error('请输入有效的网页或邮箱地址。');
  }
  if (EMAIL_ADDRESS.test(href)) href = `mailto:${href}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && DOMAIN_LIKE.test(href)) href = `https://${href}`;

  if (/^mailto:/i.test(href)) {
    const address = href.slice('mailto:'.length).split('?')[0];
    if (!EMAIL_ADDRESS.test(address)) throw new Error('邮箱链接格式不正确。');
    return { kind: 'email', href };
  }
  if (!/^https?:\/\//i.test(href)) {
    throw new Error('仅支持 http、https 和 mailto；本地文件需要桌面权限桥接。');
  }
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsafe');
    if (!url.hostname) throw new Error('missing host');
    return { kind: 'web', href: url.toString() };
  } catch {
    throw new Error('网页链接格式不正确。');
  }
};

export interface PlanUpsertExternalTopicLinkInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly href: string;
  readonly title?: string;
  readonly linkId?: LinkId;
}

export const planUpsertExternalTopicLinkCommand = (
  input: PlanUpsertExternalTopicLinkInput,
): UpsertLinkCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const normalized = normalizeExternalTopicLink(input.href);
  const existing = input.linkId ? sheet.links[input.linkId] : undefined;
  if (existing && existing.topicId !== input.topicId) throw new Error('不能把链接移动到其他主题。');
  const topicLinks = Object.values(sheet.links)
    .filter((link) => link.topicId === input.topicId)
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
  const lastLink = topicLinks.length > 0 ? topicLinks[topicLinks.length - 1] : undefined;
  const orderKey = existing?.orderKey
    ?? createOrderKeyAfter(lastLink?.orderKey);
  const title = input.title?.trim();
  const link: TopicLink = {
    id: input.linkId ?? createEntityId<'Link'>(),
    topicId: input.topicId,
    orderKey,
    kind: normalized.kind,
    href: normalized.href,
    status: 'active',
    ...(title ? { title: title.slice(0, 4096) } : {}),
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.upsertLink,
    payload: { link },
  };
};

export interface PlanDeleteTopicLinkInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly linkId: LinkId;
}

export const planDeleteTopicLinkCommand = (
  input: PlanDeleteTopicLinkInput,
): DeleteLinkCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const link = sheet.links[input.linkId];
  if (!link || link.topicId !== input.topicId) throw new Error('当前主题没有该链接。');
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteLink,
    payload: { linkId: input.linkId },
  };
};

export interface PlanUpsertTopicTodoInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly completed: boolean;
  readonly todoId?: TodoId;
  /** Mainly for deterministic import/replay tests; normally the command timestamp is used. */
  readonly completedAt?: string;
}

export const planUpsertTopicTodoCommand = (
  input: PlanUpsertTopicTodoInput,
): UpsertTodoCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const current = Object.values(sheet.todos)
    .find((todo) => todo.topicId === input.topicId);
  if (input.todoId && current && input.todoId !== current.id) {
    throw new Error('每个主题只能有一个待办。');
  }
  const byRequestedId = input.todoId ? sheet.todos[input.todoId] : undefined;
  if (byRequestedId && byRequestedId.topicId !== input.topicId) {
    throw new Error('不能把待办移动到其他主题。');
  }
  const timestamp = input.timestamp ?? new Date().toISOString();
  const todo: TopicTodo = {
    ...(current ?? byRequestedId ?? {}),
    id: input.todoId ?? current?.id ?? createEntityId<'Todo'>(),
    topicId: input.topicId,
    completed: input.completed,
    ...(input.completed
      ? {
          completedAt: input.completedAt
            ?? (current?.completed ? current.completedAt : undefined)
            ?? timestamp,
        }
      : {}),
  };
  if (!input.completed) delete todo.completedAt;
  return {
    ...commandMetadata({ ...input, timestamp }),
    type: MIND_MAP_COMMAND_TYPES.upsertTodo,
    payload: { todo },
  };
};

export interface PlanDeleteTopicTodoInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly todoId?: TodoId;
}

export const planDeleteTopicTodoCommand = (
  input: PlanDeleteTopicTodoInput,
): DeleteTodoCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const todoId = input.todoId
    ?? Object.values(sheet.todos).find((todo) => todo.topicId === input.topicId)?.id;
  const todo = todoId ? sheet.todos[todoId] : undefined;
  if (!todo || todo.topicId !== input.topicId) {
    throw new Error('当前主题没有可删除的待办。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteTodo,
    payload: { todoId: todo.id },
  };
};

export type TopicTodoBulkAction = 'apply' | 'remove' | 'complete' | 'reopen';

export interface PlanBatchTopicTodosInput extends EnrichmentCommandInput {
  readonly topicIds: readonly TopicId[];
  readonly action: TopicTodoBulkAction;
}

/**
 * Plans one atomic bulk To-do mutation. Selection IDs are de-duplicated before
 * any entity IDs are allocated, so a parent/child mixed selection can never
 * create or update the same Topic To-do twice.
 */
export const planBatchTopicTodosCommand = (
  input: PlanBatchTopicTodosInput,
): BatchUpdateTodosCommand => {
  const sheet = input.document.sheets[input.sheetId];
  if (!sheet) throw new Error(`Sheet ${input.sheetId} does not exist.`);
  const topicIds = [...new Set(input.topicIds)];
  if (topicIds.length === 0) throw new Error('至少选择一个主题。');
  for (const topicId of topicIds) getTopic(input, topicId);

  const timestamp = input.timestamp ?? new Date().toISOString();
  const todoByTopicId = new Map(
    Object.values(sheet.todos).map((todo) => [todo.topicId, todo] as const),
  );
  const upserts: TopicTodo[] = [];
  const deleteTodoIds: TodoId[] = [];

  for (const topicId of topicIds) {
    const current = todoByTopicId.get(topicId);
    if (input.action === 'apply') {
      if (!current) {
        upserts.push({
          id: createEntityId<'Todo'>(),
          topicId,
          completed: false,
        });
      }
      continue;
    }
    if (input.action === 'remove') {
      if (current) deleteTodoIds.push(current.id);
      continue;
    }
    if (!current) continue;
    if (input.action === 'complete') {
      if (!current.completed) {
        upserts.push({ ...current, completed: true, completedAt: timestamp });
      }
      continue;
    }
    if (current.completed) {
      const reopened: TopicTodo = { ...current, completed: false };
      delete reopened.completedAt;
      upserts.push(reopened);
    }
  }

  if (upserts.length === 0 && deleteTodoIds.length === 0) {
    throw new Error('所选主题无需执行该待办操作。');
  }
  return {
    ...commandMetadata({ ...input, timestamp }),
    type: MIND_MAP_COMMAND_TYPES.batchUpdateTodos,
    payload: { upserts, deleteTodoIds },
  };
};

export interface PlanDirectChildTodosCompletionInput extends EnrichmentCommandInput {
  readonly parentTopicId: TopicId;
  readonly completed: boolean;
}

/**
 * Completes/reopens only existing To-dos on direct structural children. It
 * intentionally never creates a To-do, Task, due date, or dependency field.
 */
export const planDirectChildTodosCompletionCommand = (
  input: PlanDirectChildTodosCompletionInput,
): BatchUpdateTodosCommand => {
  const { sheet } = getTopic(input, input.parentTopicId);
  const childTopicIdsWithTodo = getChildrenSorted(sheet, input.parentTopicId)
    .map((topic) => topic.id)
    .filter((topicId) => Object.values(sheet.todos).some((todo) => todo.topicId === topicId));
  return planBatchTopicTodosCommand({
    ...input,
    topicIds: childTopicIdsWithTodo,
    action: input.completed ? 'complete' : 'reopen',
  });
};

const TASK_DISPLAY_FIELDS = new Set<TaskDisplayField>([
  'status',
  'progress',
  'priority',
  'assignees',
  'start-date',
  'due-date',
  'duration',
  'dependencies',
  'creator',
]);

const normalizeTaskProgress = (status: TaskStatus, progressPercent: number): number => {
  if (!Number.isFinite(progressPercent)) throw new Error('任务进度必须是有限数字。');
  if (status === 'not-started' && progressPercent !== 0) {
    throw new Error('未开始任务的进度必须是 0%。');
  }
  if (status === 'done' && progressPercent !== 100) {
    throw new Error('已完成任务的进度必须是 100%。');
  }
  if (status === 'in-progress' && !(progressPercent > 0 && progressPercent < 100)) {
    throw new Error('进行中任务的进度必须介于 1% 和 99% 之间。');
  }
  if (
    (status === 'blocked' || status === 'cancelled')
    && !(progressPercent >= 0 && progressPercent < 100)
  ) {
    throw new Error('已阻塞或已取消任务可保留 0%–99% 进度，但不能伪装成已完成。');
  }
  return progressPercent / 100;
};

const normalizeTaskDate = (value: string | undefined, label: string): string | undefined => {
  const date = value?.trim();
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label}必须是 YYYY-MM-DD。`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label}不是有效日期。`);
  }
  return date;
};

export interface PlanUpsertTopicTaskInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly taskId?: TaskId;
  readonly status: TaskStatus;
  /** User-facing percentage. Canonical storage remains a 0..1 fraction. */
  readonly progressPercent: number;
  readonly priority?: 1 | 2 | 3 | 4 | 5;
  readonly startDate?: string;
  readonly dueDate?: string;
  readonly durationMinutes?: number;
  readonly milestone?: boolean;
  readonly assigneeIds?: readonly ActorId[];
  readonly displayFields?: readonly TaskDisplayField[];
}

/** Plans a stable-ID Topic Task replacement without coupling it to TopicTodo. */
export const planUpsertTopicTaskCommand = (
  input: PlanUpsertTopicTaskInput,
): UpsertTaskCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const current = Object.values(sheet.tasks).find((task) => task.topicId === input.topicId);
  if (input.taskId && current && input.taskId !== current.id) {
    throw new Error('每个主题只能有一个任务；编辑时必须保留原任务 ID。');
  }
  const byRequestedId = input.taskId ? sheet.tasks[input.taskId] : undefined;
  if (byRequestedId && byRequestedId.topicId !== input.topicId) {
    throw new Error('不能把任务移动到其他主题。');
  }

  const startDate = normalizeTaskDate(input.startDate, '开始日期');
  const dueDate = normalizeTaskDate(input.dueDate, '截止日期');
  if (startDate && dueDate && dueDate < startDate) {
    throw new Error('截止日期不能早于开始日期。');
  }
  if (
    input.durationMinutes !== undefined
    && (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0)
  ) {
    throw new Error('工期必须是大于 0 的整数分钟数。');
  }
  if (
    input.priority !== undefined
    && (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5)
  ) {
    throw new Error('任务优先级必须介于 1 和 5 之间。');
  }

  const assigneeIds = [...new Set(input.assigneeIds ?? [])];
  for (const actorId of assigneeIds) {
    if (!input.document.actors[actorId]) throw new Error(`任务负责人 ${actorId} 不存在。`);
  }
  const displayFields = [...new Set(input.displayFields ?? [])];
  for (const displayField of displayFields) {
    if (!TASK_DISPLAY_FIELDS.has(displayField)) {
      throw new Error(`未知任务显示字段 ${displayField}。`);
    }
  }

  const previous = current ?? byRequestedId;
  if (displayFields.includes('creator')) {
    const createdBy = previous?.audit?.createdBy;
    if (!createdBy || !input.document.actors[createdBy]) {
      throw new Error('显示创建者前，任务必须具有可解析的 audit.createdBy。');
    }
  }
  const task: TopicTask = {
    id: input.taskId ?? current?.id ?? createEntityId<'Task'>(),
    topicId: input.topicId,
    status: input.status,
    progress: normalizeTaskProgress(input.status, input.progressPercent),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(input.durationMinutes !== undefined
      ? { durationMinutes: input.durationMinutes }
      : {}),
    ...(input.milestone ? { milestone: true } : {}),
    ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
    ...(displayFields.length > 0 ? { displayFields } : {}),
    ...(previous?.audit ? { audit: { ...previous.audit } } : {}),
    ...(previous?.extensions ? { extensions: { ...previous.extensions } } : {}),
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.upsertTask,
    payload: { task },
  };
};

export interface PlanDeleteTopicTaskInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly taskId?: TaskId;
}

export const planDeleteTopicTaskCommand = (
  input: PlanDeleteTopicTaskInput,
): DeleteTaskCommand => {
  const { sheet } = getTopic(input, input.topicId);
  const taskId = input.taskId
    ?? Object.values(sheet.tasks).find((task) => task.topicId === input.topicId)?.id;
  const task = taskId ? sheet.tasks[taskId] : undefined;
  if (!task || task.topicId !== input.topicId) throw new Error('当前主题没有可删除的任务。');
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteTask,
    payload: { taskId: task.id },
  };
};

export type TopicTaskDependencyDirection = 'predecessor' | 'successor';

export interface TopicTaskDependencyCandidate {
  readonly taskId: TaskId;
  readonly topicId: TopicId;
  readonly topicTitle: string;
  readonly depth: number;
  readonly path: readonly string[];
}

export interface TopicTaskDependencyView {
  readonly dependency: TaskDependency;
  /** Direction relative to the Task owned by the current Topic. */
  readonly direction: TopicTaskDependencyDirection;
  readonly otherTaskId: TaskId;
  readonly otherTopicId: TopicId;
  readonly otherTopicTitle: string;
}

interface TopicTaskDependencyContextInput {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId: TopicId;
}

const taskForTopic = (
  document: MindMapDocumentV1,
  sheetId: SheetId,
  topicId: TopicId,
): TopicTask => {
  const sheet = document.sheets[sheetId];
  if (!sheet) throw new Error(`Sheet ${sheetId} does not exist.`);
  if (!sheet.topics[topicId]) throw new Error(`Topic ${topicId} does not exist.`);
  const task = Object.values(sheet.tasks).find((candidate) => candidate.topicId === topicId);
  if (!task) throw new Error('当前主题没有可建立依赖的 Task。');
  return task;
};

const topicPlainTitle = (document: MindMapDocumentV1, sheetId: SheetId, topicId: TopicId): string => {
  const topic = document.sheets[sheetId]?.topics[topicId];
  return mindMapRichTextToPlainText(topic?.title).trim() || '未命名主题';
};

/** Lists only canonical Tasks, never lightweight To-dos, in Sheet tree order. */
export const listTopicTaskDependencyCandidates = (
  input: TopicTaskDependencyContextInput,
): TopicTaskDependencyCandidate[] => {
  const sheet = input.document.sheets[input.sheetId];
  const currentTask = taskForTopic(input.document, input.sheetId, input.topicId);
  const taskByTopicId = new Map<TopicId, TopicTask>();
  for (const task of Object.values(sheet.tasks)) taskByTopicId.set(task.topicId, task);
  const candidates: TopicTaskDependencyCandidate[] = [];
  const visited = new Set<TopicId>();
  const visit = (topicId: TopicId, ancestors: readonly string[], depth: number): void => {
    const topic = sheet.topics[topicId];
    if (!topic || visited.has(topicId)) return;
    visited.add(topicId);
    const title = topicPlainTitle(input.document, input.sheetId, topicId);
    const path = [...ancestors, title];
    const task = taskByTopicId.get(topicId);
    if (task && task.id !== currentTask.id) {
      candidates.push({ taskId: task.id, topicId, topicTitle: title, depth, path });
    }
    for (const child of getChildrenSorted(sheet, topicId)) {
      visit(child.id, path, depth + 1);
    }
  };
  for (const root of getTreeRoots(sheet)) visit(root.id, [], 0);
  for (const topic of Object.values(sheet.topics).sort((left, right) => left.id.localeCompare(right.id))) {
    visit(topic.id, [], 0);
  }
  return candidates;
};

/** Projects all incoming and outgoing dependencies with stable, human-readable titles. */
export const listTopicTaskDependencies = (
  input: TopicTaskDependencyContextInput,
): TopicTaskDependencyView[] => {
  const sheet = input.document.sheets[input.sheetId];
  const currentTask = taskForTopic(input.document, input.sheetId, input.topicId);
  const candidateOrder = new Map(
    listTopicTaskDependencyCandidates(input).map((candidate, index) => [candidate.taskId, index]),
  );
  const views: TopicTaskDependencyView[] = [];
  for (const dependency of Object.values(sheet.taskDependencies)) {
    const direction = dependency.successorTaskId === currentTask.id
      ? 'predecessor' as const
      : dependency.predecessorTaskId === currentTask.id
        ? 'successor' as const
        : undefined;
    if (!direction) continue;
    const otherTaskId = direction === 'predecessor'
      ? dependency.predecessorTaskId
      : dependency.successorTaskId;
    const otherTask = sheet.tasks[otherTaskId];
    if (!otherTask) continue;
    views.push({
      dependency,
      direction,
      otherTaskId,
      otherTopicId: otherTask.topicId,
      otherTopicTitle: topicPlainTitle(input.document, input.sheetId, otherTask.topicId),
    });
  }
  return views.sort((left, right) => (
    (left.direction === right.direction ? 0 : left.direction === 'predecessor' ? -1 : 1)
    || (candidateOrder.get(left.otherTaskId) ?? Number.MAX_SAFE_INTEGER)
      - (candidateOrder.get(right.otherTaskId) ?? Number.MAX_SAFE_INTEGER)
    || left.dependency.id.localeCompare(right.dependency.id)
  ));
};

const TASK_DEPENDENCY_TYPES = new Set<TaskDependencyType>([
  'finish-start',
  'start-start',
  'finish-finish',
  'start-finish',
]);

export interface PlanUpsertTopicTaskDependencyInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly direction: TopicTaskDependencyDirection;
  readonly otherTaskId: TaskId;
  readonly type: TaskDependencyType;
  readonly lagMinutes?: number;
  readonly dependencyId?: TaskDependencyId;
}

/** Plans one stable-ID dependency edit relative to the current Topic's Task. */
export const planUpsertTopicTaskDependencyCommand = (
  input: PlanUpsertTopicTaskDependencyInput,
): UpsertTaskDependencyCommand => {
  const sheet = input.document.sheets[input.sheetId];
  const currentTask = taskForTopic(input.document, input.sheetId, input.topicId);
  const otherTask = sheet.tasks[input.otherTaskId];
  if (!otherTask) throw new Error('依赖目标必须是当前 Sheet 中已有的 Task。');
  if (otherTask.id === currentTask.id) throw new Error('Task 不能依赖自身。');
  if (!TASK_DEPENDENCY_TYPES.has(input.type)) throw new Error('未知的 Task 依赖类型。');
  if (
    input.lagMinutes !== undefined
    && (
      !Number.isSafeInteger(input.lagMinutes)
      || input.lagMinutes < -525_960_000
      || input.lagMinutes > 525_960_000
    )
  ) {
    throw new Error('依赖延迟必须是 -525960000 至 525960000 之间的整数分钟数。');
  }
  const existing = input.dependencyId
    ? sheet.taskDependencies[input.dependencyId]
    : undefined;
  if (input.dependencyId && !existing) throw new Error('要编辑的 Task 依赖不存在。');
  if (
    existing
    && existing.predecessorTaskId !== currentTask.id
    && existing.successorTaskId !== currentTask.id
  ) {
    throw new Error('不能从当前主题编辑其他 Task 的依赖。');
  }
  const dependency: TaskDependency = {
    id: existing?.id ?? createEntityId<'TaskDependency'>(),
    predecessorTaskId: input.direction === 'predecessor' ? otherTask.id : currentTask.id,
    successorTaskId: input.direction === 'predecessor' ? currentTask.id : otherTask.id,
    type: input.type,
    ...(input.lagMinutes === undefined || input.lagMinutes === 0
      ? {}
      : { lagMinutes: input.lagMinutes }),
    ...(existing?.audit ? { audit: { ...existing.audit } } : {}),
    ...(existing?.extensions ? { extensions: { ...existing.extensions } } : {}),
  };
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.upsertTaskDependency,
    payload: { dependency },
  };
};

export interface PlanDeleteTopicTaskDependencyInput extends EnrichmentCommandInput {
  readonly topicId: TopicId;
  readonly dependencyId: TaskDependencyId;
}

export const planDeleteTopicTaskDependencyCommand = (
  input: PlanDeleteTopicTaskDependencyInput,
): DeleteTaskDependencyCommand => {
  const sheet = input.document.sheets[input.sheetId];
  const currentTask = taskForTopic(input.document, input.sheetId, input.topicId);
  const dependency = sheet.taskDependencies[input.dependencyId];
  if (!dependency) throw new Error('要删除的 Task 依赖不存在。');
  if (
    dependency.predecessorTaskId !== currentTask.id
    && dependency.successorTaskId !== currentTask.id
  ) {
    throw new Error('不能从当前主题删除其他 Task 的依赖。');
  }
  return {
    ...commandMetadata(input),
    type: MIND_MAP_COMMAND_TYPES.deleteTaskDependency,
    payload: { dependencyId: dependency.id },
  };
};

export type TopicEnrichmentCommand =
  | UpdateTopicLabelsCommand
  | UpsertNoteCommand
  | DeleteNoteCommand
  | UpsertLinkCommand
  | DeleteLinkCommand
  | UpsertTodoCommand
  | DeleteTodoCommand
  | BatchUpdateTodosCommand
  | UpsertTaskCommand
  | DeleteTaskCommand
  | UpsertTaskDependencyCommand
  | DeleteTaskDependencyCommand;
