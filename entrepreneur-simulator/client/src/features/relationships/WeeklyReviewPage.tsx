import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck2, CheckCircle2, Eye, Lightbulb, RefreshCw, Sparkles, Target, Users } from 'lucide-react';
import type { WeeklyReviewDraft } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import {
  EmptyState,
  ErrorState,
  FieldLabel,
  LoadingState,
  PageHeader,
  PrimaryButton,
  SurfaceCard,
  TextArea,
  TextInput,
  formatDate,
} from './RelationshipUi';

const joinAction = (review: WeeklyReviewDraft, index: number) => review.relationship_actions[index]?.title || '';

export default function WeeklyReviewPage() {
  const review = useRelationshipResource('weekly-review-current', relationshipApi.getCurrentWeeklyReview);
  const [workingDraft, setWorkingDraft] = useState<WeeklyReviewDraft | null>(null);
  const [principle, setPrinciple] = useState('');
  const [blindSpot, setBlindSpot] = useState('');
  const [actions, setActions] = useState(['', '', '']);
  const [experiment, setExperiment] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = review.data;
    if (!next) return;
    setWorkingDraft(next);
    setPrinciple(next.principle_candidate || '');
    setBlindSpot(next.self_pattern_candidate || '');
    setActions([joinAction(next, 0), joinAction(next, 1), joinAction(next, 2)]);
    setExperiment(next.opportunity_experiment || '');
  }, [review.data]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const draft = await relationshipApi.generateWeeklyReview();
      setWorkingDraft(draft);
      setPrinciple(draft.principle_candidate || '');
      setBlindSpot(draft.self_pattern_candidate || '');
      setActions([joinAction(draft, 0), joinAction(draft, 1), joinAction(draft, 2)]);
      setExperiment(draft.opportunity_experiment || '');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '生成复盘草稿失败。');
    } finally {
      setGenerating(false);
    }
  };

  const confirm = async () => {
    if (!workingDraft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await relationshipApi.confirmWeeklyReview(workingDraft.id, {
        principle: principle.trim(),
        selfBlindSpot: blindSpot.trim(),
        relationshipActions: actions.map((title) => title.trim()).filter(Boolean).slice(0, 3).map((title) => ({ title })),
        opportunityExperiment: experiment.trim() || undefined,
      });
      setWorkingDraft(saved);
      review.reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '确认周复盘失败。');
    } finally {
      setSaving(false);
    }
  };

  const draft = workingDraft;

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader eyebrow="关系与机会" title="周复盘" description="把单个人的经历沉淀成自己的处世原则、盲点和商业判断。" actions={draft?.status !== 'completed' ? <PrimaryButton onClick={() => void generate()} disabled={generating}><RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} /> {draft ? '重新生成草稿' : '生成本周草稿'}</PrimaryButton> : undefined} />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {review.loading && !draft ? <LoadingState label="正在读取本周复盘…" /> : null}
        {review.error && !draft ? <ErrorState message={review.error} onRetry={review.reload} /> : null}
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div> : null}

        {!review.loading && !draft ? (
          <SurfaceCard>
            <EmptyState title="本周还没有复盘草稿" description="AI 会先汇总变化、承诺、反证和机会信号；草稿不会直接成为你的正式结论。" action={<PrimaryButton onClick={() => void generate()} disabled={generating}><Sparkles className="h-4 w-4" /> {generating ? '整理中…' : '生成草稿'}</PrimaryButton>} />
          </SurfaceCard>
        ) : null}

        {draft ? (
          <>
            <div className={`rounded-2xl border px-5 py-4 ${draft.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50'}`}>
              <div className="flex items-center gap-3">
                {draft.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : <Sparkles className="h-5 w-5 text-indigo-700" />}
                <div>
                  <div className={`font-semibold ${draft.status === 'completed' ? 'text-emerald-950' : 'text-indigo-950'}`}>{draft.status === 'completed' ? '本周复盘已确认' : '这是待确认草稿'}</div>
                  <div className={`mt-0.5 text-sm ${draft.status === 'completed' ? 'text-emerald-800' : 'text-indigo-800'}`}>{formatDate(draft.week_start)} — {formatDate(draft.week_end)}{draft.status === 'draft' ? ' · 修改后再确认，AI 不会替你定论。' : ''}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SurfaceCard title="重要变化" icon={<Eye className="h-5 w-5" />}>
                {draft.important_changes.length ? <ul className="space-y-2 text-sm leading-6 text-gray-700">{draft.important_changes.map((item, index) => <li key={`${item}-${index}`} className="rounded-xl border border-gray-200 px-3 py-2">{item}</li>)}</ul> : <p className="text-sm text-gray-500">本周没有足够证据判断明显变化。</p>}
              </SurfaceCard>
              <SurfaceCard title="被忽略或失衡的关系" icon={<Users className="h-5 w-5" />}>
                {[...draft.neglected_relationships, ...draft.asymmetry_warnings].length ? <ul className="space-y-2 text-sm leading-6 text-gray-700">{[...draft.neglected_relationships, ...draft.asymmetry_warnings].map((item, index) => <li key={`${item}-${index}`} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-700" />{item}</li>)}</ul> : <p className="text-sm text-gray-500">本周没有明确警报。</p>}
              </SurfaceCard>
              <SurfaceCard title="未完成承诺" icon={<CalendarCheck2 className="h-5 w-5" />}>
                {draft.open_commitments.length ? <div className="space-y-2">{draft.open_commitments.map((item) => <div key={item.id} className="flex justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm"><span>{item.title}</span><span className="shrink-0 text-xs text-gray-500">{formatDate(item.due_at)}</span></div>)}</div> : <p className="text-sm text-gray-500">当前没有未完成承诺。</p>}
              </SurfaceCard>
              <SurfaceCard title="商业机会信号" icon={<Lightbulb className="h-5 w-5" />}>
                {draft.opportunity_signals.length ? <ul className="space-y-2 text-sm leading-6 text-gray-700">{draft.opportunity_signals.map((item, index) => <li key={`${item}-${index}`} className="rounded-xl border border-gray-200 px-3 py-2">{item}</li>)}</ul> : <p className="text-sm text-gray-500">本周还没有需要推进的商业信号。</p>}
              </SurfaceCard>
            </div>

            <SurfaceCard title="由你确认的本周结论" description="最终只留下一个原则、一个盲点、最多三个关系行动和一个商业实验。" icon={<Target className="h-5 w-5" />}>
              <div className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <FieldLabel label="一条可复用处世原则"><TextArea rows={4} value={principle} disabled={draft.status === 'completed'} onChange={(event) => setPrinciple(event.target.value)} /></FieldLabel>
                  <FieldLabel label="一个自己的盲点"><TextArea rows={4} value={blindSpot} disabled={draft.status === 'completed'} onChange={(event) => setBlindSpot(event.target.value)} /></FieldLabel>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-800">下周关系行动（最多三个）</div>
                  <div className="mt-2 grid gap-2 lg:grid-cols-3">{actions.map((action, index) => <TextInput key={index} disabled={draft.status === 'completed'} value={action} onChange={(event) => setActions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`行动 ${index + 1}`} />)}</div>
                </div>
                <FieldLabel label="一个商业机会验证动作"><TextInput value={experiment} disabled={draft.status === 'completed'} onChange={(event) => setExperiment(event.target.value)} placeholder="例如：向两位相似客户展示报价并记录真实反应" /></FieldLabel>
                {draft.status === 'draft' ? <PrimaryButton onClick={() => void confirm()} disabled={saving || (!principle.trim() && !blindSpot.trim() && actions.every((item) => !item.trim()) && !experiment.trim())}>{saving ? '确认中…' : '确认复盘并创建下周行动'}</PrimaryButton> : null}
              </div>
            </SurfaceCard>
          </>
        ) : null}
      </div>
    </div>
  );
}
