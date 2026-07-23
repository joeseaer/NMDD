import { useEffect, useState } from 'react';
import { ArrowRight, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { CompassGap, GoalNode } from './model';
import { SecondaryButton, SurfaceCard, cn } from './RelationshipUi';

const quantitativeProgress = (gap: CompassGap) => {
  if (typeof gap.current_value !== 'number' || typeof gap.target_value !== 'number' || !Number.isFinite(gap.current_value) || !Number.isFinite(gap.target_value)) return null;
  if (gap.current_value < 0 || gap.target_value <= 0 || gap.current_value > gap.target_value) return null;
  return Math.max(0, Math.min(100, (gap.current_value / gap.target_value) * 100));
};

const hasNumericValues = (gap: CompassGap) => typeof gap.current_value === 'number'
  && typeof gap.target_value === 'number'
  && Number.isFinite(gap.current_value)
  && Number.isFinite(gap.target_value);

export type GapScope = 'stage' | 'overall';

export function CompassGapCard({
  selectedNode,
  overallGaps,
  stageGaps,
  onAdd,
  onEdit,
  onDelete,
}: {
  selectedNode: GoalNode | null;
  overallGaps: CompassGap[];
  stageGaps: CompassGap[];
  onAdd: (scope: GapScope) => void;
  onEdit: (scope: GapScope, gap: CompassGap) => void;
  onDelete: (scope: GapScope, gap: CompassGap) => void | Promise<void>;
}) {
  const [scope, setScope] = useState<GapScope>('stage');
  useEffect(() => {
    if (!selectedNode && scope === 'stage') setScope('overall');
  }, [selectedNode, scope]);

  const gaps = scope === 'stage' ? stageGaps : overallGaps;
  const title = scope === 'stage' ? `所选阶段${selectedNode ? ` · ${selectedNode.title}` : ''}` : '总体目标';

  return (
    <SurfaceCard
      title="目标差距"
      description="总体看方向，当前阶段看可验证的进展。"
      icon={<Target className="h-5 w-5" />}
      action={(
        <SecondaryButton type="button" onClick={() => onAdd(scope)} disabled={scope === 'stage' && !selectedNode}>
          <Plus className="h-4 w-4" /> 添加
        </SecondaryButton>
      )}
    >
      <div className="flex rounded-xl bg-gray-100 p-1" role="tablist" aria-label="差距范围">
        <button type="button" role="tab" aria-selected={scope === 'stage'} disabled={!selectedNode} onClick={() => setScope('stage')} className={cn('flex-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50', scope === 'stage' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>所选阶段</button>
        <button type="button" role="tab" aria-selected={scope === 'overall'} onClick={() => setScope('overall')} className={cn('flex-1 rounded-lg px-3 py-2 text-sm font-medium transition', scope === 'overall' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>总体目标</button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-950">{title}</div>
          <div className="mt-0.5 text-xs text-gray-500">{scope === 'stage' ? '只有明确数值的指标才显示进度。' : '这里不把不同维度硬算成一个总分。'}</div>
        </div>
      </div>

      {!gaps.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 px-4 py-7 text-center">
          <p className="text-sm text-gray-600">{scope === 'stage' ? '这个阶段还没有衡量指标。' : '还没有记录总体差距。'}</p>
          <button type="button" onClick={() => onAdd(scope)} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-700" disabled={scope === 'stage' && !selectedNode}>添加第一项</button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-gray-100">
          {gaps.map((gap) => {
            const progress = quantitativeProgress(gap);
            return (
              <div key={gap.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-950">{gap.label}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-sm leading-6 text-gray-600">
                      <span>{gap.current_state || '尚未记录当前状态'}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
                      <span className="text-gray-900">{gap.target_state || '尚未记录目标状态'}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`编辑 ${gap.label}`} onClick={() => onEdit(scope, gap)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil className="h-4 w-4" /></button>
                    <button type="button" aria-label={`删除 ${gap.label}`} onClick={() => void onDelete(scope, gap)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>

                {hasNumericValues(gap) ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{gap.current_value}{gap.unit || ''}</span>
                      <span>目标 {gap.target_value}{gap.unit || ''}</span>
                    </div>
                    {progress !== null ? <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" data-testid={`gap-progress-${gap.id}`}><div className="h-full rounded-full bg-indigo-500" style={{ width: `${progress}%` }} /></div> : null}
                  </div>
                ) : null}

                {(gap.primary_gap || gap.next_evidence) ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><span className="font-semibold">主要差距：</span>{gap.primary_gap || '尚未填写'}</div>
                    <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900"><span className="font-semibold">下一项证据：</span>{gap.next_evidence || '尚未填写'}</div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
}
