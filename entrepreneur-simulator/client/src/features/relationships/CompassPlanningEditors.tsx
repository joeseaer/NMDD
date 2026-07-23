import { FormEvent, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CompassGap, GoalNode, GoalNodeStatus } from './model';
import {
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
} from './RelationshipUi';

export type GoalNodeDraft = Omit<GoalNode, 'id' | 'sort_order'>;

const EMPTY_GOAL: GoalNodeDraft = {
  parent_id: null,
  title: '',
  status: 'planned',
  current_fact: '',
  completion_standard: '',
  missing_evidence: '',
  next_validation: '',
};

const STATUS_OPTIONS: Array<{ value: GoalNodeStatus; label: string }> = [
  { value: 'planned', label: '计划中' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'paused', label: '已暂停' },
];

const descendantsOf = (nodeId: string, nodes: GoalNode[]) => {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    nodes.filter((node) => node.parent_id === parentId).forEach((node) => {
      if (result.has(node.id)) return;
      result.add(node.id);
      visit(node.id);
    });
  };
  visit(nodeId);
  return result;
};

export function GoalNodeEditor({
  open,
  node,
  initialParentId,
  nodes,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  node: GoalNode | null;
  initialParentId?: string | null;
  nodes: GoalNode[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: GoalNodeDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<GoalNodeDraft>(EMPTY_GOAL);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(node ? {
      parent_id: node.parent_id,
      title: node.title,
      status: node.status,
      current_fact: node.current_fact,
      completion_standard: node.completion_standard,
      missing_evidence: node.missing_evidence,
      next_validation: node.next_validation,
    } : { ...EMPTY_GOAL, parent_id: initialParentId || null });
    setLocalError(null);
  }, [initialParentId, node, open]);

  const blockedParentIds = useMemo(() => node ? descendantsOf(node.id, nodes) : new Set<string>(), [node, nodes]);
  const parentOptions = nodes.filter((candidate) => candidate.id !== node?.id && !blockedParentIds.has(candidate.id));

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setLocalError('请先填写目标名称。');
      return;
    }
    setLocalError(null);
    void onSubmit({
      ...draft,
      title: draft.title.trim(),
      current_fact: draft.current_fact.trim(),
      completion_standard: draft.completion_standard.trim(),
      missing_evidence: draft.missing_evidence.trim(),
      next_validation: draft.next_validation.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 sm:items-center sm:p-6" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-node-editor-title"
        onSubmit={submit}
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 id="goal-node-editor-title" className="font-semibold text-gray-950">{node ? '编辑目标' : '添加目标'}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">目标可以分支；四项内容用来判断这个节点是否真的向前推进。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <FieldLabel label="目标名称">
            <TextInput value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} autoFocus />
          </FieldLabel>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="上级目标" hint="选择上级目标即可形成支线">
              <select
                value={draft.parent_id || ''}
                onChange={(event) => setDraft((value) => ({ ...value, parent_id: event.target.value || null }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">无（一级目标）</option>
                {parentOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              </select>
            </FieldLabel>
            <FieldLabel label="状态">
              <select
                value={draft.status}
                onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as GoalNodeStatus }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              >
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FieldLabel>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="当前事实">
              <TextArea rows={4} value={draft.current_fact} onChange={(event) => setDraft((value) => ({ ...value, current_fact: event.target.value }))} />
            </FieldLabel>
            <FieldLabel label="完成标准">
              <TextArea rows={4} value={draft.completion_standard} onChange={(event) => setDraft((value) => ({ ...value, completion_standard: event.target.value }))} />
            </FieldLabel>
            <FieldLabel label="还缺什么">
              <TextArea rows={4} value={draft.missing_evidence} onChange={(event) => setDraft((value) => ({ ...value, missing_evidence: event.target.value }))} />
            </FieldLabel>
            <FieldLabel label="下一步如何验证">
              <TextArea rows={4} value={draft.next_validation} onChange={(event) => setDraft((value) => ({ ...value, next_validation: event.target.value }))} />
            </FieldLabel>
          </div>

          {localError || error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{localError || error}</div> : null}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4 sm:px-6">
          <SecondaryButton type="button" onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? '保存中…' : '保存目标'}</PrimaryButton>
        </div>
      </form>
    </div>
  );
}

const EMPTY_GAP: CompassGap = {
  id: '',
  label: '',
  current_state: '',
  target_state: '',
  primary_gap: '',
  next_evidence: '',
  current_value: null,
  target_value: null,
  unit: null,
};

export function CompassGapEditor({
  open,
  gap,
  scopeLabel,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  gap: CompassGap | null;
  scopeLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: CompassGap) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(EMPTY_GAP);
  const [currentValue, setCurrentValue] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(gap || EMPTY_GAP);
    setCurrentValue(typeof gap?.current_value === 'number' ? String(gap.current_value) : '');
    setTargetValue(typeof gap?.target_value === 'number' ? String(gap.target_value) : '');
    setLocalError(null);
  }, [gap, open]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.label.trim()) {
      setLocalError('请先填写差距维度。');
      return;
    }
    const hasCurrent = currentValue.trim() !== '';
    const hasTarget = targetValue.trim() !== '';
    if (hasCurrent !== hasTarget) {
      setLocalError('如需量化，请同时填写当前值和目标值。');
      return;
    }
    const parsedCurrent = hasCurrent ? Number(currentValue) : null;
    const parsedTarget = hasTarget ? Number(targetValue) : null;
    if ((parsedCurrent !== null && !Number.isFinite(parsedCurrent)) || (parsedTarget !== null && !Number.isFinite(parsedTarget))) {
      setLocalError('量化数值必须有效。');
      return;
    }
    setLocalError(null);
    void onSubmit({
      ...draft,
      label: draft.label.trim(),
      current_state: draft.current_state.trim(),
      target_state: draft.target_state.trim(),
      primary_gap: draft.primary_gap.trim(),
      next_evidence: draft.next_evidence.trim(),
      current_value: parsedCurrent,
      target_value: parsedTarget,
      unit: draft.unit?.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 sm:items-center sm:p-6" role="presentation">
      <form role="dialog" aria-modal="true" aria-labelledby="gap-editor-title" onSubmit={submit} className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 id="gap-editor-title" className="font-semibold text-gray-950">{gap ? '编辑差距' : '添加差距'}</h2>
            <p className="mt-1 text-xs text-gray-500">{scopeLabel}</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <FieldLabel label="差距维度"><TextInput value={draft.label} onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))} autoFocus /></FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="当前状态"><TextArea rows={3} value={draft.current_state} onChange={(event) => setDraft((value) => ({ ...value, current_state: event.target.value }))} /></FieldLabel>
            <FieldLabel label="目标状态"><TextArea rows={3} value={draft.target_state} onChange={(event) => setDraft((value) => ({ ...value, target_state: event.target.value }))} /></FieldLabel>
            <FieldLabel label="主要差距"><TextArea rows={3} value={draft.primary_gap} onChange={(event) => setDraft((value) => ({ ...value, primary_gap: event.target.value }))} /></FieldLabel>
            <FieldLabel label="下一项证据"><TextArea rows={3} value={draft.next_evidence} onChange={(event) => setDraft((value) => ({ ...value, next_evidence: event.target.value }))} /></FieldLabel>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldLabel label="当前值" hint="可选"><TextInput inputMode="decimal" value={currentValue} onChange={(event) => setCurrentValue(event.target.value)} /></FieldLabel>
            <FieldLabel label="目标值" hint="可选"><TextInput inputMode="decimal" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} /></FieldLabel>
            <FieldLabel label="单位" hint="如 人、次、元"><TextInput value={draft.unit || ''} onChange={(event) => setDraft((value) => ({ ...value, unit: event.target.value }))} /></FieldLabel>
          </div>
          {localError || error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{localError || error}</div> : null}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4 sm:px-6">
          <SecondaryButton type="button" onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? '保存中…' : '保存差距'}</PrimaryButton>
        </div>
      </form>
    </div>
  );
}

export function DeleteGoalDialog({
  open,
  node,
  descendantCount,
  deleting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  node: GoalNode | null;
  descendantCount: number;
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!open || !node) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 sm:items-center sm:p-6" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-goal-title" className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6">
        <h2 id="delete-goal-title" className="font-semibold text-gray-950">删除“{node.title}”？</h2>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          {descendantCount ? `这会同时删除它下面的 ${descendantCount} 个子目标和对应阶段差距。` : '这个目标和对应阶段差距会被删除。'} 此操作保存后无法撤销。
        </p>
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <SecondaryButton type="button" onClick={onClose} disabled={deleting}>取消</SecondaryButton>
          <button type="button" onClick={() => void onConfirm()} disabled={deleting} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
            {deleting ? '删除中…' : descendantCount ? '删除整条支线' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
