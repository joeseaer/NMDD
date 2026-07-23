import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeDollarSign, FlaskConical, Lightbulb, Plus, Search, Users, X } from 'lucide-react';
import type { BusinessOpportunity, OpportunityExperiment, OpportunityStage } from './model';
import { OPPORTUNITY_STAGE_LABELS } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import {
  EmptyState,
  ErrorState,
  FieldLabel,
  ListArrow,
  LoadingState,
  OpportunityStageBadge,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
  TextArea,
  TextInput,
  cn,
  formatDate,
} from './RelationshipUi';

const ACTIVE_STAGES: OpportunityStage[] = ['signal', 'problem_hypothesis', 'interview', 'offer_test', 'paid_validation', 'repeatable', 'scaling'];

function OpportunityCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (opportunity: BusinessOpportunity) => void }) {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [customer, setCustomer] = useState('');
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setProblem('');
    setCustomer('');
    setEvidence('');
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="w-full bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="new-opportunity-title">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div><h2 id="new-opportunity-title" className="font-semibold text-gray-950">记录一个机会信号</h2><p className="mt-0.5 text-xs text-gray-500">先记录问题和证据，不急着写商业计划。</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-5">
          <FieldLabel label="机会标题"><TextInput autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="一句话方便自己识别" /></FieldLabel>
          <FieldLabel label="谁遇到了什么问题"><TextArea rows={4} value={problem} onChange={(event) => setProblem(event.target.value)} /></FieldLabel>
          <FieldLabel label="可能的客户"><TextInput value={customer} onChange={(event) => setCustomer(event.target.value)} /></FieldLabel>
          <FieldLabel label="我目前看到的真实证据"><TextArea rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：三位同类用户都在手工整理，每周花费两小时" /></FieldLabel>
          {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <SecondaryButton onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton disabled={saving || !title.trim() || !problem.trim()} onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const opportunity = await relationshipApi.createOpportunity({ title: title.trim(), problem: problem.trim(), customer: customer.trim(), evidence: evidence.trim() });
              onCreated(opportunity);
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '创建失败。');
            } finally {
              setSaving(false);
            }
          }}>{saving ? '记录中…' : '记录信号'}</PrimaryButton>
        </footer>
      </section>
    </div>
  );
}

function EvidenceLadder({ stage }: { stage: OpportunityStage }) {
  const stages: Array<{ id: OpportunityStage; label: string }> = [
    { id: 'signal', label: '单次信号' },
    { id: 'problem_hypothesis', label: '问题假设' },
    { id: 'interview', label: '多人访谈' },
    { id: 'offer_test', label: '报价测试' },
    { id: 'paid_validation', label: '真实付款' },
    { id: 'repeatable', label: '复购/转介绍' },
  ];
  const current = stages.findIndex((item) => item.id === stage);
  return (
    <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {stages.map((item, index) => (
        <li key={item.id} className={cn('rounded-xl border px-3 py-3 text-xs font-medium', index <= current ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-500')}>
          <div className="text-[10px] uppercase tracking-wide opacity-70">第 {index + 1} 阶</div>
          <div className="mt-1">{item.label}</div>
        </li>
      ))}
    </ol>
  );
}

function ExperimentComposer({ opportunityId, onSaved }: { opportunityId: string; onSaved: () => void }) {
  const [type, setType] = useState<'interview' | 'offer' | 'preorder' | 'delivery' | 'payment' | 'repeat' | 'referral'>('interview');
  const [hypothesis, setHypothesis] = useState('');
  const [method, setMethod] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [plannedAt, setPlannedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label="验证类型">
          <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="interview">客户访谈</option><option value="offer">报价</option><option value="preorder">预售</option><option value="delivery">小额交付</option><option value="payment">付款验证</option><option value="repeat">复购</option><option value="referral">转介绍</option>
          </select>
        </FieldLabel>
        <FieldLabel label="计划日期"><TextInput type="date" value={plannedAt} onChange={(event) => setPlannedAt(event.target.value)} /></FieldLabel>
      </div>
      <FieldLabel label="我要验证的假设"><TextArea rows={2} value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} /></FieldLabel>
      <FieldLabel label="最低成本做法"><TextArea rows={3} value={method} onChange={(event) => setMethod(event.target.value)} /></FieldLabel>
      <FieldLabel label="什么结果才算通过"><TextArea rows={2} value={successCriteria} onChange={(event) => setSuccessCriteria(event.target.value)} /></FieldLabel>
      {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
      <PrimaryButton disabled={saving || !hypothesis.trim() || !method.trim() || !successCriteria.trim()} onClick={async () => {
        setSaving(true);
        setError(null);
        try {
          await relationshipApi.createExperiment(opportunityId, { type, hypothesis: hypothesis.trim(), method: method.trim(), successCriteria: successCriteria.trim(), plannedAt: plannedAt || undefined });
          setHypothesis(''); setMethod(''); setSuccessCriteria(''); setPlannedAt('');
          onSaved();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : '创建实验失败。');
        } finally {
          setSaving(false);
        }
      }}><FlaskConical className="h-4 w-4" /> {saving ? '创建中…' : '创建验证实验'}</PrimaryButton>
    </div>
  );
}

const EXPERIMENT_STATUS_LABELS: Record<OpportunityExperiment['status'], string> = {
  planned: '待执行',
  running: '进行中',
  completed: '已复盘',
  cancelled: '已取消',
};

const NEXT_DECISION_LABELS = {
  continue: '继续验证',
  adjust: '调整假设',
  stop: '停止投入',
} as const;

function ExperimentOutcomeEditor({ experiment, onSaved }: { experiment: OpportunityExperiment; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const [evidence, setEvidence] = useState('');
  const [amount, setAmount] = useState('');
  const [nextDecision, setNextDecision] = useState<keyof typeof NEXT_DECISION_LABELS>('adjust');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (experiment.status === 'completed') {
    return (
      <div className="mt-3 space-y-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-950">
        <div><span className="font-medium">实际结果：</span>{experiment.result || '已完成，未补充文字结果'}</div>
        {experiment.evidence ? <div><span className="font-medium">新增证据：</span>{experiment.evidence}</div> : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {typeof experiment.payment_amount === 'number' ? <span className="font-semibold text-emerald-800">收款 ¥{experiment.payment_amount.toLocaleString('zh-CN')}</span> : null}
          {experiment.next_decision ? <span>下一判断：{NEXT_DECISION_LABELS[experiment.next_decision]}</span> : null}
        </div>
      </div>
    );
  }

  if (experiment.status === 'cancelled') return null;

  if (!open) {
    return <SecondaryButton className="mt-3 w-full justify-center" onClick={() => setOpen(true)}>记录实验结果</SecondaryButton>;
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <FieldLabel label="实际发生了什么">
        <TextArea rows={3} value={result} onChange={(event) => setResult(event.target.value)} placeholder="记录客户的真实行为、回复或拒绝，不只写自己的感受。" />
      </FieldLabel>
      <FieldLabel label="它增加或推翻了什么证据">
        <TextArea rows={2} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：愿意付 500 元试用；或三人都认为问题不紧急。" />
      </FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="本次真实收款（元，可空）">
          <TextInput type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="基于证据，下一步">
          <select value={nextDecision} onChange={(event) => setNextDecision(event.target.value as keyof typeof NEXT_DECISION_LABELS)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {Object.entries(NEXT_DECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FieldLabel>
      </div>
      {error ? <div className="text-xs text-red-700" role="alert">{error}</div> : null}
      <div className="flex justify-end gap-2">
        <SecondaryButton disabled={saving} onClick={() => { setOpen(false); setError(null); }}>取消</SecondaryButton>
        <PrimaryButton disabled={saving || !result.trim()} onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            const parsedAmount = amount.trim() ? Number(amount) : null;
            if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
              throw new Error('收款金额需要是大于等于 0 的数字。');
            }
            await relationshipApi.recordExperimentOutcome(experiment.id, {
              result: result.trim(),
              evidence: evidence.trim() || undefined,
              amountCents: parsedAmount === null ? undefined : Math.round(parsedAmount * 100),
              currency: 'CNY',
              nextDecision,
            });
            onSaved();
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '记录结果失败。');
          } finally {
            setSaving(false);
          }
        }}>{saving ? '保存中…' : '确认并完成复盘'}</PrimaryButton>
      </div>
    </div>
  );
}

function OpportunityDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const opportunity = useRelationshipResource(`opportunity:${id}`, (signal) => relationshipApi.getOpportunity(id, signal));
  const [updatingStage, setUpdatingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  if (opportunity.loading && !opportunity.data) return <main className="min-w-0 flex-1 bg-gray-50"><LoadingState label="正在打开机会详情…" /></main>;
  if (opportunity.error) return <main className="min-w-0 flex-1 bg-gray-50 p-4"><ErrorState message={opportunity.error} onRetry={opportunity.reload} /></main>;
  if (!opportunity.data) return null;
  const data = opportunity.data;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button type="button" onClick={onBack} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden" aria-label="返回机会列表"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-bold text-gray-950">{data.title}</h1><OpportunityStageBadge stage={data.stage} /></div><p className="mt-1 text-sm text-gray-500">最后更新：{formatDate(data.updated_at)}</p></div>
          </div>
          <select aria-label="机会阶段" value={data.stage} disabled={updatingStage} onChange={async (event) => {
            const stage = event.target.value as OpportunityStage;
            setUpdatingStage(true); setStageError(null);
            try {
              await relationshipApi.updateOpportunity(data.id, { stage, version: data.version });
              opportunity.reload();
            } catch (nextError) {
              setStageError(nextError instanceof Error ? nextError.message : '更新阶段失败。');
            } finally {
              setUpdatingStage(false);
            }
          }} className="min-h-10 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {Object.entries(OPPORTUNITY_STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {stageError ? <div className="mt-2 text-xs text-red-700">{stageError}</div> : null}
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <SurfaceCard title="证据阶梯" description="推进阶段需要真实行为、报价或付款证据，而不是好评。"><EvidenceLadder stage={data.stage} /></SurfaceCard>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="space-y-5">
            <SurfaceCard title="问题与客户" icon={<Lightbulb className="h-5 w-5" />}>
              <div className="space-y-4">
                <div><div className="text-xs font-medium text-gray-500">谁遇到了什么问题</div><p className="mt-1 text-sm leading-6 text-gray-900">{data.problem || '尚未写清'}</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 p-3"><div className="text-xs text-gray-500">可能客户</div><div className="mt-1 text-sm text-gray-800">{data.customer || '未知'}</div></div>
                  <div className="rounded-xl border border-gray-200 p-3"><div className="text-xs text-gray-500">当前替代方式</div><div className="mt-1 text-sm text-gray-800">{data.current_workaround || '未知'}</div></div>
                  <div className="rounded-xl border border-gray-200 p-3"><div className="text-xs text-gray-500">付款者</div><div className="mt-1 text-sm text-gray-800">{data.payer_role || '尚未验证'}</div></div>
                  <div className="rounded-xl border border-gray-200 p-3"><div className="text-xs text-gray-500">当前最缺证据</div><div className="mt-1 text-sm text-gray-800">{data.missing_evidence || '尚未判断'}</div></div>
                </div>
              </div>
            </SurfaceCard>
            <SurfaceCard title="真实证据" description="抱怨、替代成本、报价、付款、复购必须区分。" icon={<BadgeDollarSign className="h-5 w-5" />}>
              {data.evidence.length ? <div className="space-y-2">{data.evidence.map((item) => <div key={item.id} className="rounded-xl border border-gray-200 px-4 py-3"><div className="flex items-center justify-between gap-3"><div className="text-xs font-medium text-indigo-700">{item.kind}</div><div className="text-xs text-gray-400">{formatDate(item.occurred_at)}</div></div><p className="mt-2 text-sm leading-6 text-gray-800">{item.summary}</p>{typeof item.amount === 'number' ? <div className="mt-2 text-sm font-semibold text-emerald-700">¥{item.amount.toLocaleString('zh-CN')}</div> : null}</div>)}</div> : <EmptyState title="还没有足够证据" description="下一步应优先访谈、报价或小额服务，而不是继续开发。" />}
            </SurfaceCard>
          </div>
          <div className="space-y-5">
            <SurfaceCard title="下一项最低成本验证" icon={<FlaskConical className="h-5 w-5" />}><ExperimentComposer opportunityId={data.id} onSaved={opportunity.reload} /></SurfaceCard>
            <SurfaceCard title="实验记录">
              {data.experiments.length ? <div className="space-y-2">{data.experiments.map((experiment) => <div key={experiment.id} className="rounded-xl border border-gray-200 p-3"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-gray-900">{experiment.hypothesis}</span><span className="shrink-0 text-xs text-gray-500">{EXPERIMENT_STATUS_LABELS[experiment.status]}</span></div><p className="mt-2 text-xs leading-5 text-gray-600">{experiment.method}</p><div className="mt-2 text-xs text-gray-400">通过标准：{experiment.success_signal}</div><ExperimentOutcomeEditor experiment={experiment} onSaved={opportunity.reload} /></div>)}</div> : <p className="text-sm text-gray-500">还没有实验。</p>}
            </SurfaceCard>
            <SurfaceCard title="相关人物" icon={<Users className="h-5 w-5" />}>
              {data.related_people.length ? <div className="space-y-2">{data.related_people.map((person) => <div key={person.id} className="rounded-xl border border-gray-200 px-3 py-3"><div className="font-medium text-gray-900">{person.name}</div><div className="mt-1 text-xs text-gray-500">{person.roles.join(' · ') || person.identity}</div></div>)}</div> : <p className="text-sm text-gray-500">还没有关联人物。</p>}
            </SurfaceCard>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OpportunitiesPage() {
  const navigate = useNavigate();
  const { opportunityId } = useParams<{ opportunityId?: string }>();
  const opportunities = useRelationshipResource('opportunity-list', relationshipApi.getOpportunities);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const visible = (opportunities.data || []).filter((item) => !search.trim() || `${item.title} ${item.problem} ${item.customer || ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
      {!opportunityId ? <PageHeader eyebrow="关系与机会" title="机会雷达" description="把真实问题推进到访谈、报价、付款和复购证据。" actions={<PrimaryButton onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> 记录机会信号</PrimaryButton>} /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden border-t border-gray-200 bg-white">
        <aside className={cn('w-full shrink-0 border-r border-gray-200 bg-white lg:flex lg:w-80 lg:flex-col', opportunityId ? 'hidden' : 'flex flex-col')}>
          <div className="border-b border-gray-200 p-4">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题或客户" className="pl-9" /></div>
            <div className="mt-3 flex flex-wrap gap-1.5">{ACTIVE_STAGES.map((stage) => <span key={stage} className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">{OPPORTUNITY_STAGE_LABELS[stage]}</span>)}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {opportunities.loading && !opportunities.data ? <LoadingState label="正在读取机会…" /> : null}
            {opportunities.error ? <ErrorState message={opportunities.error} onRetry={opportunities.reload} /> : null}
            {!opportunities.loading && !visible.length ? <EmptyState title="还没有机会信号" description="一次真实抱怨也可以先记录，但不要把它当作已验证需求。" /> : null}
            <div className="space-y-1">{visible.map((item) => <button key={item.id} type="button" onClick={() => navigate(`/relationships/opportunities/${encodeURIComponent(item.id)}`)} className={cn('w-full rounded-xl border p-3 text-left transition', opportunityId === item.id ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:border-gray-200 hover:bg-gray-50')}><div className="flex items-start justify-between gap-2"><div className="font-medium text-gray-950">{item.title}</div><OpportunityStageBadge stage={item.stage} /></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-600">{item.problem || '尚未写清问题'}</p><div className="mt-2 flex items-center justify-between text-xs text-gray-400"><span>{item.evidence.length} 条证据</span><ListArrow /></div></button>)}</div>
          </div>
        </aside>
        {opportunityId ? <OpportunityDetail id={opportunityId} onBack={() => navigate('/relationships/opportunities')} /> : <main className="hidden min-w-0 flex-1 items-center justify-center bg-gray-50 lg:flex"><EmptyState title="选择一个机会" description="打开详情查看证据阶梯和下一项最低成本验证。" /></main>}
      </div>
      <OpportunityCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(opportunity) => { setCreateOpen(false); opportunities.reload(); navigate(`/relationships/opportunities/${opportunity.id}`); }} />
    </div>
  );
}
