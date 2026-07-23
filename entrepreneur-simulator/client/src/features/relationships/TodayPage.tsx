import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Compass, Pencil } from 'lucide-react';
import { CompassGapCard, type GapScope } from './CompassGapCard';
import { CompassPlanEditor } from './CompassPlanEditor';
import {
  CompassGapEditor,
  DeleteGoalDialog,
  GoalNodeEditor,
  type GoalNodeDraft,
} from './CompassPlanningEditors';
import { DailyGuidanceCard } from './DailyGuidanceCard';
import { GoalTreeCard } from './GoalTreeCard';
import type { CompassGap, CompassPlan, GoalNode, PlanningState } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  SecondaryButton,
  formatDate,
} from './RelationshipUi';

const newId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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

const saveInput = (plan: CompassPlan, planningState: PlanningState) => ({
  title: plan.title,
  horizonDate: plan.horizon_date || null,
  outcomeStatement: plan.outcome_statement,
  successMetrics: plan.success_metrics,
  currentAssets: plan.current_assets,
  currentConstraints: plan.current_constraints,
  ninetyDayBet: plan.ninety_day_bet || null,
  nonNegotiables: plan.non_negotiables,
  planningState,
  expectedVersion: plan.version || undefined,
});

export default function TodayPage() {
  const navigate = useNavigate();
  const compass = useRelationshipResource('relationship-compass-page', relationshipApi.getCompassPage);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [nodeEditor, setNodeEditor] = useState<{ node: GoalNode | null; parentId: string | null } | null>(null);
  const [gapEditor, setGapEditor] = useState<{ scope: GapScope; gap: CompassGap | null } | null>(null);
  const [deleteNode, setDeleteNode] = useState<GoalNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [guidanceGenerating, setGuidanceGenerating] = useState(false);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const automaticGuidanceChecked = useRef(false);
  const guidanceRequestSequence = useRef(0);
  const planRef = useRef<CompassPlan | null>(null);

  const data = compass.data;
  planRef.current = data?.plan || null;
  const planning = data?.plan.planning_state;
  const currentNode = planning?.nodes.find((node) => node.id === planning.current_node_id) || null;
  const selectedNode = planning?.nodes.find((node) => node.id === selectedNodeId)
    || currentNode
    || planning?.nodes[0]
    || null;
  const selectedStageGaps = selectedNode && planning ? planning.stage_gaps[selectedNode.id] || [] : [];

  const persistPlanningState = useCallback(async (nextState: PlanningState) => {
    const currentPlan = planRef.current;
    if (!currentPlan) return null;
    guidanceRequestSequence.current += 1;
    setGuidanceGenerating(false);
    setSaving(true);
    setActionError(null);
    try {
      const stateWithoutGuidance = { ...nextState, daily_guidance: null };
      const savedPlan = await relationshipApi.saveCompass(saveInput(currentPlan, stateWithoutGuidance));
      planRef.current = savedPlan;
      compass.setData((value) => value ? { ...value, plan: savedPlan } : value);
      return savedPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存规划失败。';
      setActionError(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [compass.setData]);

  const generateGuidance = useCallback(async (refresh: boolean) => {
    const requestSequence = ++guidanceRequestSequence.current;
    const requestPlan = planRef.current;
    const requestVersion = requestPlan?.version ?? null;
    setGuidanceGenerating(true);
    setGuidanceError(null);
    try {
      const result = await relationshipApi.generateDailyGuidance(refresh);
      if (guidanceRequestSequence.current !== requestSequence) return;
      const latestPlan = planRef.current;
      if (!latestPlan) return;
      const basedOnVersion = result.based_on_compass_version ?? requestVersion;
      const changedDuringRequest = requestVersion !== null && latestPlan.version !== requestVersion;
      const responseVersion = result.compass_version;
      // A persisted guidance result is based on the version immediately before
      // its own save. On the next page load, basedOnVersion can therefore be one
      // behind while compass_version already equals the version we loaded. That
      // is current, not stale. A real local edit during this request is still
      // rejected by changedDuringRequest below.
      const persistedResultIsCurrent = !changedDuringRequest
        && responseVersion !== null
        && responseVersion >= latestPlan.version;
      const responseIsOlder = basedOnVersion !== null
        && basedOnVersion < latestPlan.version
        && !persistedResultIsCurrent;
      if (result.stale || responseIsOlder || (changedDuringRequest && basedOnVersion !== latestPlan.version)) {
        setGuidanceError('规划在生成期间已经更新，已丢弃旧的今日判断。请重新刷新。');
        return;
      }
      const nextVersion = responseVersion !== null && responseVersion >= latestPlan.version ? responseVersion : latestPlan.version;
      const nextPlan: CompassPlan = {
        ...latestPlan,
        version: nextVersion,
        planning_state: { ...latestPlan.planning_state, daily_guidance: result.guidance },
      };
      planRef.current = nextPlan;
      compass.setData((value) => {
        if (!value) return value;
        const currentVersion = value.plan.version;
        if (basedOnVersion !== null && currentVersion > basedOnVersion && currentVersion !== requestVersion) return value;
        return { ...value, plan: nextPlan };
      });
    } catch (error) {
      if (guidanceRequestSequence.current === requestSequence) setGuidanceError(error instanceof Error ? error.message : '生成今日判断失败。');
    } finally {
      if (guidanceRequestSequence.current === requestSequence) setGuidanceGenerating(false);
    }
  }, [compass.setData]);

  useEffect(() => {
    if (!data || automaticGuidanceChecked.current) return;
    automaticGuidanceChecked.current = true;
    void generateGuidance(false);
  }, [data, generateGuidance]);

  const submitNode = async (draft: GoalNodeDraft) => {
    if (!planning || !nodeEditor) return;
    try {
      if (nodeEditor.node) {
        const nodes = planning.nodes.map((node) => node.id === nodeEditor.node?.id ? { ...node, ...draft } : node);
        await persistPlanningState({ ...planning, nodes });
      } else {
        const siblingOrders = planning.nodes.filter((node) => node.parent_id === draft.parent_id).map((node) => node.sort_order);
        const id = newId('goal');
        const firstNode = planning.nodes.length === 0;
        const nextNode: GoalNode = {
          ...draft,
          id,
          status: firstNode ? 'in_progress' : draft.status,
          sort_order: siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0,
        };
        await persistPlanningState({
          ...planning,
          nodes: [...planning.nodes, nextNode],
          current_node_id: firstNode ? id : planning.current_node_id,
        });
        setSelectedNodeId(id);
      }
      setNodeEditor(null);
    } catch {
      // Error remains visible inside the editor.
    }
  };

  const setCurrent = async (node: GoalNode) => {
    if (!planning) return;
    try {
      await persistPlanningState({
        ...planning,
        current_node_id: node.id,
        nodes: planning.nodes.map((item) => item.id === node.id && item.status === 'planned' ? { ...item, status: 'in_progress' } : item),
      });
      setSelectedNodeId(node.id);
    } catch {
      // A compact page-level error is shown above the cards.
    }
  };

  const confirmDeleteNode = async () => {
    if (!planning || !deleteNode) return;
    const removedIds = descendantsOf(deleteNode.id, planning.nodes).add(deleteNode.id);
    const remainingNodes = planning.nodes.filter((node) => !removedIds.has(node.id));
    const nextStageGaps = Object.fromEntries(Object.entries(planning.stage_gaps).filter(([nodeId]) => !removedIds.has(nodeId)));
    const fallbackCurrent = planning.current_node_id && !removedIds.has(planning.current_node_id)
      ? planning.current_node_id
      : remainingNodes.find((node) => node.id === deleteNode.parent_id)?.id || remainingNodes[0]?.id || null;
    try {
      await persistPlanningState({ ...planning, nodes: remainingNodes, current_node_id: fallbackCurrent, stage_gaps: nextStageGaps });
      setSelectedNodeId(fallbackCurrent);
      setDeleteNode(null);
    } catch {
      // Error remains visible inside the confirmation dialog.
    }
  };

  const submitGap = async (gap: CompassGap) => {
    if (!planning || !gapEditor) return;
    const normalizedGap = { ...gap, id: gap.id || newId('gap') };
    try {
      if (gapEditor.scope === 'overall') {
        const exists = planning.overall_gaps.some((item) => item.id === normalizedGap.id);
        await persistPlanningState({
          ...planning,
          overall_gaps: exists
            ? planning.overall_gaps.map((item) => item.id === normalizedGap.id ? normalizedGap : item)
            : [...planning.overall_gaps, normalizedGap],
        });
      } else if (selectedNode) {
        const currentGaps = planning.stage_gaps[selectedNode.id] || [];
        const exists = currentGaps.some((item) => item.id === normalizedGap.id);
        await persistPlanningState({
          ...planning,
          stage_gaps: {
            ...planning.stage_gaps,
            [selectedNode.id]: exists
              ? currentGaps.map((item) => item.id === normalizedGap.id ? normalizedGap : item)
              : [...currentGaps, normalizedGap],
          },
        });
      }
      setGapEditor(null);
    } catch {
      // Error remains visible inside the editor.
    }
  };

  const deleteGap = async (scope: GapScope, gap: CompassGap) => {
    if (!planning) return;
    try {
      if (scope === 'overall') {
        await persistPlanningState({ ...planning, overall_gaps: planning.overall_gaps.filter((item) => item.id !== gap.id) });
      } else if (selectedNode) {
        await persistPlanningState({
          ...planning,
          stage_gaps: {
            ...planning.stage_gaps,
            [selectedNode.id]: (planning.stage_gaps[selectedNode.id] || []).filter((item) => item.id !== gap.id),
          },
        });
      }
    } catch {
      // A compact page-level error is shown above the cards.
    }
  };

  const deleteDescendantCount = deleteNode && planning ? descendantsOf(deleteNode.id, planning.nodes).size : 0;

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        eyebrow="事业与处世"
        title="罗盘"
        description="看清目标、差距与今天最重要的判断。"
        actions={data ? <SecondaryButton onClick={() => setPlanEditorOpen(true)}><Pencil className="h-4 w-4" /> 调整目标锚点</SecondaryButton> : undefined}
      />

      <div className="space-y-5 p-4 sm:p-6">
        {compass.loading && !data ? <LoadingState label="正在整理目标与当前差距…" /> : null}
        {compass.error ? <ErrorState message={compass.error} onRetry={compass.reload} /> : null}
        {actionError && !nodeEditor && !gapEditor && !deleteNode ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div> : null}

        {data && planning ? (
          <>
            <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-700 to-indigo-950 px-5 py-6 text-white shadow-sm sm:px-7 sm:py-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 max-w-4xl">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200"><Compass className="h-4 w-4" /> 当前主目标</div>
                  <h2 className="mt-3 text-xl font-semibold leading-8 sm:text-2xl sm:leading-9">{data.plan.outcome_statement}</h2>
                  <div className="mt-3 text-sm text-indigo-200">目标日期：{data.plan.horizon_date ? formatDate(data.plan.horizon_date) : '暂未设置'}</div>
                </div>
                <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:w-[430px]">
                  <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                    <div className="text-xs text-indigo-200">当前节点</div>
                    <div className="mt-2 text-sm font-semibold leading-6">{currentNode?.title || '尚未选择'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/10 p-4">
                    <div className="text-xs text-indigo-200">当前节点完成标准</div>
                    <div className="mt-2 text-sm font-semibold leading-6">{currentNode?.completion_standard || '请在目标路线中添加或选择当前节点'}</div>
                  </div>
                </div>
              </div>
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="text-xs font-medium text-indigo-200">什么证据代表真正完成</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.plan.success_metrics.slice(0, 3).map((metric) => <span key={metric} className="inline-flex items-start gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm leading-5 text-white"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> {metric}</span>)}
                  {!data.plan.success_metrics.length ? <span className="text-sm text-indigo-200">尚未设置完成证据。</span> : null}
                </div>
              </div>
            </section>

            <GoalTreeCard
              nodes={planning.nodes}
              currentNodeId={planning.current_node_id}
              selectedNodeId={selectedNode?.id || null}
              saving={saving}
              onSelect={setSelectedNodeId}
              onAddRoot={() => setNodeEditor({ node: null, parentId: null })}
              onAddChild={(parentId) => setNodeEditor({ node: null, parentId })}
              onEdit={(node) => setNodeEditor({ node, parentId: node.parent_id })}
              onSetCurrent={setCurrent}
              onDelete={setDeleteNode}
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
              <CompassGapCard
                selectedNode={selectedNode}
                overallGaps={planning.overall_gaps}
                stageGaps={selectedStageGaps}
                onAdd={(scope) => setGapEditor({ scope, gap: null })}
                onEdit={(scope, gap) => setGapEditor({ scope, gap })}
                onDelete={deleteGap}
              />
              <DailyGuidanceCard
                guidance={planning.daily_guidance || null}
                generating={guidanceGenerating}
                error={guidanceError}
                plannerAvailable={data.planner_available}
                tasks={data.today_tasks}
                onGenerate={generateGuidance}
                onOpenPlanner={() => navigate('/planner')}
              />
            </div>
          </>
        ) : null}
      </div>

      {data ? <CompassPlanEditor open={planEditorOpen} plan={data.plan} onClose={() => setPlanEditorOpen(false)} onSaved={() => compass.reload()} /> : null}
      {planning ? (
        <GoalNodeEditor
          open={Boolean(nodeEditor)}
          node={nodeEditor?.node || null}
          initialParentId={nodeEditor?.parentId || null}
          nodes={planning.nodes}
          saving={saving}
          error={actionError}
          onClose={() => { setNodeEditor(null); setActionError(null); }}
          onSubmit={submitNode}
        />
      ) : null}
      <CompassGapEditor
        open={Boolean(gapEditor)}
        gap={gapEditor?.gap || null}
        scopeLabel={gapEditor?.scope === 'stage' ? `所选阶段：${selectedNode?.title || '未选择'}` : '总体目标差距'}
        saving={saving}
        error={actionError}
        onClose={() => { setGapEditor(null); setActionError(null); }}
        onSubmit={submitGap}
      />
      <DeleteGoalDialog
        open={Boolean(deleteNode)}
        node={deleteNode}
        descendantCount={deleteDescendantCount}
        deleting={saving}
        error={actionError}
        onClose={() => { setDeleteNode(null); setActionError(null); }}
        onConfirm={confirmDeleteNode}
      />
    </div>
  );
}
