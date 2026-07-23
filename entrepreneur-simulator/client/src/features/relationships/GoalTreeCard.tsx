import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  GitBranch,
  Pause,
  Pencil,
  Plus,
  Target,
  Trash2,
} from 'lucide-react';
import type { GoalNode } from './model';
import { SecondaryButton, SurfaceCard, cn } from './RelationshipUi';

const STATUS_LABELS: Record<GoalNode['status'], string> = {
  planned: '计划中',
  in_progress: '进行中',
  completed: '已完成',
  paused: '已暂停',
};

const statusIcon = (status: GoalNode['status']) => {
  if (status === 'completed') return <Check className="h-3.5 w-3.5" />;
  if (status === 'in_progress') return <Target className="h-3.5 w-3.5" />;
  if (status === 'paused') return <Pause className="h-3.5 w-3.5" />;
  return <Circle className="h-2.5 w-2.5" />;
};

const statusTone = (status: GoalNode['status']) => {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'in_progress') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-gray-200 bg-white text-gray-500';
};

export function GoalTreeCard({
  nodes,
  currentNodeId,
  selectedNodeId,
  saving,
  onSelect,
  onAddRoot,
  onAddChild,
  onEdit,
  onSetCurrent,
  onDelete,
}: {
  nodes: GoalNode[];
  currentNodeId: string | null;
  selectedNodeId: string | null;
  saving: boolean;
  onSelect: (id: string) => void;
  onAddRoot: () => void;
  onAddChild: (parentId: string) => void;
  onEdit: (node: GoalNode) => void;
  onSetCurrent: (node: GoalNode) => void | Promise<void>;
  onDelete: (node: GoalNode) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, GoalNode[]>();
    nodes.forEach((node) => {
      const parent = node.parent_id && nodeIds.has(node.parent_id) ? node.parent_id : null;
      map.set(parent, [...(map.get(parent) || []), node]);
    });
    map.forEach((children, parent) => map.set(parent, children.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'zh-CN'))));
    return map;
  }, [nodeIds, nodes]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
    || nodes.find((node) => node.id === currentNodeId)
    || nodes[0]
    || null;

  const toggle = (nodeId: string) => setCollapsed((value) => {
    const next = new Set(value);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
  });

  const renderBranch = (parentId: string | null, depth: number, ancestors: Set<string>): React.ReactNode => (
    (childrenByParent.get(parentId) || []).map((node) => {
      if (ancestors.has(node.id)) return null;
      const children = childrenByParent.get(node.id) || [];
      const isCollapsed = collapsed.has(node.id);
      const isSelected = selectedNode?.id === node.id;
      const isCurrent = currentNodeId === node.id;
      const nextAncestors = new Set(ancestors).add(node.id);
      return (
        <div key={node.id}>
          <div className="flex items-center gap-1.5" style={{ paddingLeft: Math.min(depth, 6) * 20 }}>
            {children.length ? (
              <button type="button" aria-label={isCollapsed ? `展开 ${node.title}` : `收起 ${node.title}`} aria-expanded={!isCollapsed} onClick={() => toggle(node.id)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            ) : <span className="w-6" />}
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition',
                isSelected ? 'border-indigo-300 bg-indigo-50 shadow-sm' : 'border-transparent hover:border-gray-200 hover:bg-gray-50',
              )}
            >
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', statusTone(node.status))}>{statusIcon(node.status)}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{node.title}</span>
              {isCurrent ? <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">当前</span> : null}
            </button>
          </div>
          {!isCollapsed ? renderBranch(node.id, depth + 1, nextAncestors) : null}
        </div>
      );
    })
  );

  return (
    <SurfaceCard
      title="目标路线"
      description="目标可以分支；当前节点决定你此刻衡量什么。"
      icon={<GitBranch className="h-5 w-5" />}
      action={<SecondaryButton type="button" onClick={onAddRoot}><Plus className="h-4 w-4" /> 添加一级目标</SecondaryButton>}
    >
      {!nodes.length ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-5 py-8 text-center">
          <div className="text-sm font-medium text-gray-900">还没有目标路线</div>
          <p className="mt-2 text-xs leading-5 text-gray-500">先添加一个阶段目标，再从它下面继续拆解或长出支线。</p>
          <SecondaryButton type="button" className="mt-4" onClick={onAddRoot}><Plus className="h-4 w-4" /> 添加第一个目标</SecondaryButton>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-1 overflow-x-hidden rounded-xl border border-gray-200 bg-white p-2" aria-label="目标树">
            {renderBranch(null, 0, new Set())}
          </div>

          {selectedNode ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-950">{selectedNode.title}</h3>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', statusTone(selectedNode.status))}>{STATUS_LABELS[selectedNode.status]}</span>
                    {selectedNode.id === currentNodeId ? <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white">当前节点</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton type="button" onClick={() => onAddChild(selectedNode.id)}><Plus className="h-4 w-4" /> 子目标</SecondaryButton>
                  <SecondaryButton type="button" onClick={() => onEdit(selectedNode)}><Pencil className="h-4 w-4" /> 编辑</SecondaryButton>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ['当前事实', selectedNode.current_fact],
                  ['完成标准', selectedNode.completion_standard],
                  ['还缺什么', selectedNode.missing_evidence],
                  ['下一步如何验证', selectedNode.next_validation],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white px-3 py-3">
                    <div className="text-xs font-medium text-gray-500">{label}</div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-gray-800">{value || '尚未填写'}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <button type="button" onClick={() => onDelete(selectedNode)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                  <Trash2 className="h-4 w-4" /> 删除
                </button>
                {selectedNode.id !== currentNodeId ? (
                  <SecondaryButton type="button" onClick={() => void onSetCurrent(selectedNode)} disabled={saving}><Target className="h-4 w-4" /> 设为当前节点</SecondaryButton>
                ) : <span className="text-xs text-indigo-600">当前阶段差距与今日判断都以此节点为准</span>}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </SurfaceCard>
  );
}
