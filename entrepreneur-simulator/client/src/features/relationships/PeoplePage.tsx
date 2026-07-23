import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarClock,
  CircleHelp,
  History,
  MessageSquarePlus,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { AttentionState, ClaimStatus, Interaction, PersonClaim, PersonSummary, PersonWorkspace, PrimaryRelationshipContext } from './model';
import { ATTENTION_LABELS } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import { QuickCaptureSheet } from './QuickCaptureSheet';
import DecisionPanel from './DecisionPanel';
import PeopleOverviewPage from './PeopleOverviewPage';
import {
  AttentionBadge,
  ConfidenceBadge,
  EmptyState,
  ErrorState,
  FieldLabel,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
  TextArea,
  TextInput,
  cn,
  formatDate,
} from './RelationshipUi';

type PersonTab = 'overview' | 'evidence' | 'decisions' | 'interactions';
const PERSON_TABS: Array<{ id: PersonTab; label: string }> = [
  { id: 'overview', label: '现在怎么相处' },
  { id: 'evidence', label: '当前理解' },
  { id: 'decisions', label: '决定与结果' },
  { id: 'interactions', label: '互动记录' },
];

const isPersonTab = (value: string | undefined): value is PersonTab => PERSON_TABS.some((tab) => tab.id === value);

function PersonCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (person: PersonSummary) => void }) {
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('');
  const [roles, setRoles] = useState('');
  const [focusReason, setFocusReason] = useState('');
  const [attentionState, setAttentionState] = useState<AttentionState>('observe');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setIdentity('');
    setRoles('');
    setFocusReason('');
    setAttentionState('observe');
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="w-full bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="new-person-title">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="new-person-title" className="font-semibold text-gray-950">新建轻档案</h2>
            <p className="mt-0.5 text-xs text-gray-500">先记住这个人为什么与当前阶段有关，之后再用互动补充证据。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-5">
          <FieldLabel label="姓名或称呼"><TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} /></FieldLabel>
          <FieldLabel label="身份"><TextInput value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="例如：同学、导师、潜在客户" /></FieldLabel>
          <FieldLabel label="关系角色" hint="用逗号分隔"><TextInput value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="朋友，合作方" /></FieldLabel>
          <FieldLabel label="为什么现在值得记住"><TextArea rows={3} value={focusReason} onChange={(event) => setFocusReason(event.target.value)} /></FieldLabel>
          <FieldLabel label="当前关注状态">
            <select value={attentionState} onChange={(event) => setAttentionState(event.target.value as AttentionState)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {Object.entries(ATTENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FieldLabel>
          {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <SecondaryButton onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton disabled={saving || !name.trim()} onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const person = await relationshipApi.createPerson({
                name: name.trim(),
                identity: identity.trim(),
                relationshipRoles: roles.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                focusReason: focusReason.trim(),
                attentionState,
              });
              onCreated(person);
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '创建失败。');
            } finally {
              setSaving(false);
            }
          }}>{saving ? '创建中…' : '创建档案'}</PrimaryButton>
        </footer>
      </section>
    </div>
  );
}

function BriefValue({ label, value, empty = '尚未形成判断' }: { label: string; value?: string | null; empty?: string }) {
  return <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-xs font-medium text-gray-500">{label}</div><p className="mt-1 text-sm leading-6 text-gray-800">{value || empty}</p></div>;
}

function RelationshipBriefDialog({
  open,
  context,
  onClose,
  onSaved,
}: {
  open: boolean;
  context: PrimaryRelationshipContext | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [attentionState, setAttentionState] = useState<AttentionState>('observe');
  const [why, setWhy] = useState('');
  const [currentState, setCurrentState] = useState('');
  const [currentGoal, setCurrentGoal] = useState('');
  const [observeNext, setObserveNext] = useState('');
  const [mutualValue, setMutualValue] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAttentionState(context?.attention_status || 'observe');
    setWhy(context?.why || '');
    setCurrentState(context?.current_state || '');
    setCurrentGoal(context?.current_goal || '');
    setObserveNext(context?.observe_next || '');
    setMutualValue(context?.mutual_value || '');
    setBoundaries((context?.boundaries || []).join('\n'));
    setSaving(false);
    setError(null);
  }, [context, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="max-h-[92dvh] w-full overflow-y-auto bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="edit-relationship-brief-title">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 id="edit-relationship-brief-title" className="font-semibold text-gray-950">编辑关系简报</h2>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">这是你对当前关系的行动定义，可以随证据变化而调整。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        {context ? (
          <>
            <div className="space-y-4 p-5">
              <FieldLabel label="关注状态">
                <select value={attentionState} onChange={(event) => setAttentionState(event.target.value as AttentionState)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  {Object.entries(ATTENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </FieldLabel>
              <FieldLabel label="为什么现在重要"><TextArea rows={3} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="与我当前阶段、目标或责任有什么关系？" /></FieldLabel>
              <FieldLabel label="当前关系状态"><TextArea rows={3} value={currentState} onChange={(event) => setCurrentState(event.target.value)} placeholder="只写当前能确认的状态，不给关系贴永久标签。" /></FieldLabel>
              <FieldLabel label="我在这段关系中的当前目标"><TextArea rows={3} value={currentGoal} onChange={(event) => setCurrentGoal(event.target.value)} /></FieldLabel>
              <FieldLabel label="下一次只观察什么" hint="只写一个可被现实验证的信号"><TextArea rows={3} value={observeNext} onChange={(event) => setObserveNext(event.target.value)} placeholder="例如：提出一个明确的小请求后，对方是否愿意确认时间。" /></FieldLabel>
              <FieldLabel label="双方的需要与期待" hint="写清彼此真正关心什么，而不只写我想得到什么"><TextArea rows={3} value={mutualValue} onChange={(event) => setMutualValue(event.target.value)} /></FieldLabel>
              <FieldLabel label="边界与停止条件" hint="每行一条"><TextArea rows={4} value={boundaries} onChange={(event) => setBoundaries(event.target.value)} placeholder={'不承诺无法兑现的事\n连续两次明确拒绝后停止推进'} /></FieldLabel>
              {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
            </div>
            <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white px-5 py-4">
              <SecondaryButton onClick={onClose} disabled={saving}>取消</SecondaryButton>
              <PrimaryButton disabled={saving} onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await relationshipApi.updateContext(context.id, {
                    attentionStatus: attentionState,
                    whyMattersNow: why.trim(),
                    currentState: currentState.trim(),
                    currentGoal: currentGoal.trim(),
                    observeNext: observeNext.trim(),
                    mutualValue: mutualValue.trim(),
                    boundaries: boundaries.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                    expectedVersion: context.version,
                  });
                  onSaved();
                  onClose();
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : '保存关系简报失败。');
                } finally {
                  setSaving(false);
                }
              }}>{saving ? '保存中…' : '保存简报'}</PrimaryButton>
            </footer>
          </>
        ) : (
          <div className="p-6">
            <EmptyState title="当前没有可编辑的主关系情境" description="这个人物可能来自旧档案；旧资料仍保持只读，避免在迁移前误写。" action={<SecondaryButton onClick={onClose}>关闭</SecondaryButton>} />
          </div>
        )}
      </section>
    </div>
  );
}

function ClaimCard({ claim }: { claim: PersonClaim }) {
  return (
    <article className="rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{claim.context}</div>
        <ConfidenceBadge level={claim.confidence} />
      </div>
      <p className="mt-2 text-sm font-medium leading-6 text-gray-950">{claim.statement}</p>
      {claim.suggested_approach ? <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-800">相处建议：{claim.suggested_approach}</div> : null}
      {claim.alternative_explanations.length ? <div className="mt-3 text-xs leading-5 text-gray-500">替代解释：{claim.alternative_explanations.join('；')}</div> : null}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>{claim.evidence.length} 条证据</span><span>最后验证：{formatDate(claim.last_verified_at)}</span>
      </div>
    </article>
  );
}

function OverviewTab({
  workspace,
  onOpenCapture,
  onOpenDecisions,
  onOpenUnderstanding,
  onOpenInteractions,
  onEditBrief,
}: {
  workspace: PersonWorkspace;
  onOpenCapture: () => void;
  onOpenDecisions: () => void;
  onOpenUnderstanding: () => void;
  onOpenInteractions: () => void;
  onEditBrief: () => void;
}) {
  const currentDecision = workspace.next_action;
  const currentGoal = workspace.brief.current_goal || currentDecision?.goal;
  const plannedApproach = currentDecision?.next_step || currentDecision?.recommendation;
  const boundaries = Array.from(new Set([
    ...(workspace.primary_context?.boundaries || []),
    ...(currentDecision?.boundaries || []),
  ].map((item) => item.trim()).filter(Boolean)));
  const stopConditions = Array.from(new Set((currentDecision?.stop_conditions || []).map((item) => item.trim()).filter(Boolean)));
  const openCommitments = workspace.commitments.filter((item) => item.status === 'open');
  const recentInteractions = [...workspace.interactions]
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))
    .slice(0, 3);

  return (
    <div className="space-y-5">
      <SurfaceCard title="这一次，怎么和这个人相处" description="先明确目标、动作和一个观察信号；互动结束后再用真实反应修正。" icon={<Sparkles className="h-5 w-5" />}>
        <div className="grid gap-3 lg:grid-cols-3" data-testid="relationship-judgment-core">
          <BriefValue label="我现在想达成什么" value={currentGoal} empty="尚未明确这次互动想达成什么" />
          <BriefValue label="我准备怎么做" value={plannedApproach} empty="尚未选择一个具体、自然的行动" />
          <BriefValue label="下一次只观察什么" value={workspace.brief.observe_next} empty="尚未设置一个可验证信号" />
        </div>
        <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 md:grid-cols-2" aria-label="边界与停止条件">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-900">这次要守住的边界</div>
            {boundaries.length ? (
              <ul className="mt-2 space-y-1.5 text-sm leading-6 text-amber-950">{boundaries.map((item) => <li key={item}>· {item}</li>)}</ul>
            ) : <p className="mt-2 text-sm leading-6 text-amber-800">尚未设置边界；如果这次有风险，先补充再行动。</p>}
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold text-rose-900">出现什么就停止或退一步</div>
            {stopConditions.length ? (
              <ul className="mt-2 space-y-1.5 text-sm leading-6 text-rose-950">{stopConditions.map((item) => <li key={item}>· {item}</li>)}</ul>
            ) : <p className="mt-2 text-sm leading-6 text-rose-800">尚未设置停止条件。</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap">
          <SecondaryButton onClick={onEditBrief} className="w-full sm:w-auto"><Pencil className="h-4 w-4" /> 调整关系简报</SecondaryButton>
          <PrimaryButton onClick={onOpenDecisions} className="w-full sm:w-auto">做出决定</PrimaryButton>
          <SecondaryButton onClick={onOpenCapture} className="w-full sm:w-auto"><MessageSquarePlus className="h-4 w-4" /> 记录互动</SecondaryButton>
        </div>
      </SurfaceCard>

      <SurfaceCard title="我目前怎么理解这个人" description="只保留当前状态和可验证判断，不把阶段性表现写成人格定论。" icon={<BookOpenCheck className="h-5 w-5" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <BriefValue label="当前关系状态" value={workspace.brief.current_state} empty="尚未记录当前关系状态" />
          <BriefValue label="最近一次互动" value={workspace.brief.recent_change} empty="还没有记录最近一次真实互动" />
        </div>
        <div className="mt-5 grid gap-5 border-t border-gray-100 pt-5 xl:grid-cols-2">
          <section aria-labelledby="confirmed-guides-heading">
            <div className="mb-3 flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <h3 id="confirmed-guides-heading" className="text-sm font-semibold text-gray-950">已验证的相处方式</h3>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">有真实证据支持，并标明适用情境。</p>
              </div>
            </div>
            {workspace.confirmed_guides.length ? <div className="space-y-3">{workspace.confirmed_guides.slice(0, 2).map((claim) => <ClaimCard key={claim.id} claim={claim} />)}</div> : <EmptyState title="还没有已验证方式" description="记录真实互动后，再从结果中沉淀相处方法。" />}
          </section>
          <section aria-labelledby="hypotheses-heading">
            <div className="mb-3 flex items-start gap-2">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <h3 id="hypotheses-heading" className="text-sm font-semibold text-gray-950">待验证假设</h3>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">这只是待观察的问题，不是对这个人的定论。</p>
              </div>
            </div>
            {workspace.hypotheses.length ? <div className="space-y-3">{workspace.hypotheses.slice(0, 2).map((claim) => <ClaimCard key={claim.id} claim={claim} />)}</div> : <EmptyState title="没有待验证假设" description="不必为了填满档案而强行判断。" />}
          </section>
        </div>
        <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
          <SecondaryButton onClick={onOpenUnderstanding} className="w-full sm:w-auto">查看并校准全部判断</SecondaryButton>
        </div>
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SurfaceCard title="未完成承诺" description={openCommitments.length > 3 ? '显示当前记录中最近 3 项' : '只保留仍需兑现的事项'} icon={<CalendarClock className="h-5 w-5" />}>
          {openCommitments.length ? (
            <div className="space-y-2">{openCommitments.slice(0, 3).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 px-3 py-3 text-sm"><div className="min-w-0"><div className="font-medium leading-5 text-gray-900">{item.title}</div><div className="mt-1 text-xs text-gray-500">{item.owner === 'me' ? '我承诺' : item.owner === 'them' ? '对方承诺' : '双方承诺'}</div></div><span className="shrink-0 text-xs text-gray-500">{formatDate(item.due_at)}</span></div>)}</div>
          ) : <p className="text-sm text-gray-500">当前没有未完成承诺。</p>}
        </SurfaceCard>
        <SurfaceCard title="最近互动" description={workspace.interactions.length > 3 ? '显示最近 3 次互动' : '用真实反应校准原先判断'} icon={<History className="h-5 w-5" />}>
          {recentInteractions.length ? (
            <div className="space-y-2">
              {recentInteractions.map((interaction) => (
                <div key={interaction.id} className="rounded-xl border border-gray-200 px-3 py-3">
                  <div className="text-xs text-gray-500">{formatDate(interaction.occurred_at, true)}{interaction.context ? ` · ${interaction.context}` : ''}</div>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-gray-800">{interaction.facts[0] || interaction.actual_result || interaction.their_reaction || '这次互动还没有事实摘要'}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500">还没有互动记录。</p>}
          <div className="mt-3 flex justify-end border-t border-gray-100 pt-3"><SecondaryButton onClick={onOpenInteractions} className="w-full sm:w-auto">查看全部互动</SecondaryButton></div>
        </SurfaceCard>
      </div>
    </div>
  );
}

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  proposed: '待验证',
  testing: '验证中',
  mixed: '证据混合',
  supported: '已有支持',
  contradicted: '已被反证',
  retired: '停止使用',
};

function NewClaimDialog({
  open,
  personId,
  contextId,
  onClose,
  onSaved,
}: {
  open: boolean;
  personId: string;
  contextId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [situation, setSituation] = useState('');
  const [statement, setStatement] = useState('');
  const [alternatives, setAlternatives] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSituation('');
    setStatement('');
    setAlternatives('');
    setSaving(false);
    setError(null);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="w-full bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="new-claim-title">
        <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="new-claim-title" className="font-semibold text-gray-950">新增待验证判断</h2>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">先把它当作一个问题，不当作对这个人的定论。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-5">
          <FieldLabel label="适用情境"><TextInput autoFocus value={situation} onChange={(event) => setSituation(event.target.value)} placeholder="例如：讨论合作分工时、对方忙碌时" /></FieldLabel>
          <FieldLabel label="我的待验证判断"><TextArea rows={4} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="例如：在目标明确、时间可控时，对方更愿意提供具体帮助。" /></FieldLabel>
          <FieldLabel label="还有哪些可能解释" hint="每行一条"><TextArea rows={4} value={alternatives} onChange={(event) => setAlternatives(event.target.value)} placeholder={'这次只是对方刚好有空\n对方更重视事情本身，而非相处方式'} /></FieldLabel>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">保存后状态只是“待验证”。AI 可以帮助整理信息，但不会自动把它升级为已支持判断。</div>
          {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <SecondaryButton disabled={saving} onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton disabled={saving || !situation.trim() || !statement.trim()} onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await relationshipApi.createClaim(personId, {
                contextId,
                situation: situation.trim(),
                statement: statement.trim(),
                alternativeExplanations: alternatives.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
              });
              onSaved();
              onClose();
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '新增判断失败。');
            } finally {
              setSaving(false);
            }
          }}>{saving ? '保存中…' : '保存为待验证判断'}</PrimaryButton>
        </footer>
      </section>
    </div>
  );
}

function interactionOptionLabel(interaction: Interaction) {
  const summary = interaction.facts[0] || interaction.context || interaction.their_reaction || '互动记录';
  return `${formatDate(interaction.occurred_at)} · ${summary.slice(0, 42)}`;
}

function ClaimEvidenceCard({ claim, interactions, onChanged }: { claim: PersonClaim; interactions: Interaction[]; onChanged: () => void }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [direction, setDirection] = useState<'support' | 'counter'>('support');
  const [content, setContent] = useState('');
  const [interactionId, setInteractionId] = useState('');
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSupport = claim.evidence.some((item) => item.direction === 'support');
  const hasCounter = claim.evidence.some((item) => item.direction === 'counter');

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{claim.context}</div>
          <p className="mt-2 text-sm font-medium leading-6 text-gray-950">{claim.statement}</p>
        </div>
        <label className="shrink-0">
          <span className="sr-only">判断状态</span>
          <select
            aria-label={`“${claim.statement}”的判断状态`}
            value={claim.status}
            disabled={savingStatus}
            onChange={async (event) => {
              const status = event.target.value as ClaimStatus;
              setSavingStatus(true);
              setError(null);
              try {
                await relationshipApi.updateClaim(claim.id, {
                  status,
                  userConfirmed: status === 'supported' || status === 'contradicted' ? true : undefined,
                  expectedVersion: claim.version,
                });
                onChanged();
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '更新判断状态失败。');
              } finally {
                setSavingStatus(false);
              }
            }}
            className="min-h-9 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
          >
            {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value} disabled={(value === 'supported' && !hasSupport) || (value === 'contradicted' && !hasCounter)}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {claim.alternative_explanations.length ? <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600"><span className="font-medium text-gray-700">替代解释：</span>{claim.alternative_explanations.join('；')}</div> : null}

      <div className="mt-4 space-y-2">
        {claim.evidence.map((item) => {
          const sourceInteraction = item.source_id ? interactions.find((interaction) => interaction.id === item.source_id) : null;
          const label = item.direction === 'support' ? '支持证据' : item.direction === 'counter' ? '反证' : '中性信息';
          const color = item.direction === 'support' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : item.direction === 'counter' ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-gray-200 bg-gray-50 text-gray-800';
          return (
            <div key={item.id} className={cn('rounded-xl border px-3 py-3 text-xs leading-5', color)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{label}</span>
                <span className="opacity-70">{sourceInteraction ? `关联互动 · ${formatDate(sourceInteraction.occurred_at)}` : item.source_type === 'direct_statement' ? '对方直接表达' : '手动确认'}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{item.excerpt}</p>
            </div>
          );
        })}
        {!claim.evidence.length ? <div className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-xs leading-5 text-gray-500">还没有证据。记录原话、行为或互动结果，再由你决定它支持还是反驳这个判断。</div> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <div className="text-xs text-gray-400">{claim.evidence.length} 条证据 · {CLAIM_STATUS_LABELS[claim.status]} · {formatDate(claim.last_verified_at)}</div>
        <SecondaryButton className="min-h-9 px-3 py-1.5" onClick={() => { setEvidenceOpen((value) => !value); setError(null); }}><Plus className="h-4 w-4" /> 新增支持或反证</SecondaryButton>
      </div>

      {evidenceOpen ? (
        <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="证据方向">
              <select value={direction} onChange={(event) => setDirection(event.target.value as 'support' | 'counter')} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="support">支持这个判断</option>
                <option value="counter">反驳或削弱这个判断</option>
              </select>
            </FieldLabel>
            <FieldLabel label="关联已有互动" hint="可选">
              <select value={interactionId} onChange={(event) => setInteractionId(event.target.value)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">不关联互动</option>
                {interactions.map((interaction) => <option key={interaction.id} value={interaction.id}>{interactionOptionLabel(interaction)}</option>)}
              </select>
            </FieldLabel>
          </div>
          <FieldLabel label="证据原文" hint="写可观察行为、原话或结果"><TextArea rows={3} value={content} onChange={(event) => setContent(event.target.value)} placeholder="例如：我明确说明截止时间后，对方当天回复并按时提交。" /></FieldLabel>
          <div className="text-xs leading-5 text-gray-500">新增证据不会自动改变判断状态。只有你可以把它改为“已有支持”或“已被反证”。</div>
          {error ? <div className="text-xs text-red-700" role="alert">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <SecondaryButton disabled={savingEvidence} onClick={() => { setEvidenceOpen(false); setError(null); }}>取消</SecondaryButton>
            <PrimaryButton disabled={savingEvidence || !content.trim()} onClick={async () => {
              setSavingEvidence(true);
              setError(null);
              try {
                const sourceInteraction = interactionId ? interactions.find((interaction) => interaction.id === interactionId) : null;
                await relationshipApi.addClaimEvidence(claim.id, {
                  direction,
                  content: content.trim(),
                  interactionId: interactionId || undefined,
                  occurredAt: sourceInteraction?.occurred_at,
                });
                setContent('');
                setInteractionId('');
                setEvidenceOpen(false);
                onChanged();
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '新增证据失败。');
              } finally {
                setSavingEvidence(false);
              }
            }}>{savingEvidence ? '保存中…' : '确认保存证据'}</PrimaryButton>
          </div>
        </div>
      ) : error ? <div className="mt-3 text-xs text-red-700" role="alert">{error}</div> : null}

      {!hasSupport || !hasCounter ? <div className="mt-3 text-[11px] leading-5 text-gray-400">标记“已有支持”前至少需要一条支持证据；标记“已被反证”前至少需要一条反证。</div> : null}
    </article>
  );
}

function EvidenceTab({ workspace, onChanged }: { workspace: PersonWorkspace; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const claims = [...workspace.confirmed_guides, ...workspace.hypotheses];
  return (
    <div className="space-y-5">
      <SurfaceCard title="校准当前理解" description="把判断写成可验证假设，并同时主动寻找支持证据和反证。" icon={<BookOpenCheck className="h-5 w-5" />} action={<PrimaryButton onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> 新增待验证判断</PrimaryButton>}>
        {claims.length ? <div className="space-y-3">{claims.map((claim) => <ClaimEvidenceCard key={claim.id} claim={claim} interactions={workspace.interactions} onChanged={onChanged} />)}</div> : <EmptyState title="证据仍不足" description="可以先提出一个具体、可被现实推翻的判断，不必给对方贴人格标签。" action={<SecondaryButton onClick={() => setCreateOpen(true)}>提出第一个待验证判断</SecondaryButton>} />}
      </SurfaceCard>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        “本人说自己重视承诺”与“多次实际守约”会作为不同证据保存。MBTI、DISC 等旧标签只作为历史参考，不自动生成新判断。
      </div>
      <SurfaceCard title="历史结论" description="这些判断已被反证或停止使用，不再进入当前相处模型。" icon={<History className="h-5 w-5" />}>
        {workspace.inactive_claims.length ? (
          <div className="space-y-2">
            {workspace.inactive_claims.map((claim) => (
              <article key={claim.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-500">{claim.context}</span>
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600">{CLAIM_STATUS_LABELS[claim.status]}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-700">{claim.statement}</p>
              </article>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">还没有被反证或停止使用的历史结论。</p>}
      </SurfaceCard>
      <NewClaimDialog open={createOpen} personId={workspace.person.id} contextId={workspace.primary_context?.id} onClose={() => setCreateOpen(false)} onSaved={onChanged} />
    </div>
  );
}

function InteractionsTab({ workspace }: { workspace: PersonWorkspace }) {
  return (
    <div className="space-y-5">
      <SurfaceCard title="互动时间线" description="复盘预期与真实反应，不使用关系百分比倒推趋势。" icon={<History className="h-5 w-5" />}>
        {workspace.interactions.length ? (
          <div className="relative space-y-5 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-gray-200">
            {workspace.interactions.map((interaction) => (
              <article key={interaction.id} className="relative pl-7">
                <div className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-indigo-600 bg-white" />
                <div className="text-xs text-gray-500">{formatDate(interaction.occurred_at, true)}{interaction.context ? ` · ${interaction.context}` : ''}</div>
                <div className="mt-2 rounded-xl border border-gray-200 p-4">
                  {interaction.facts.length ? <div className="text-sm leading-6 text-gray-800">{interaction.facts.join('；')}</div> : null}
                  {interaction.my_action ? <p className="mt-2 text-sm leading-6 text-gray-600"><span className="font-medium text-gray-800">我：</span>{interaction.my_action}</p> : null}
                  {interaction.their_reaction ? <p className="mt-1 text-sm leading-6 text-gray-600"><span className="font-medium text-gray-800">对方：</span>{interaction.their_reaction}</p> : null}
                  {interaction.my_feelings?.length ? <p className="mt-3 border-t border-gray-100 pt-3 text-xs leading-5 text-gray-500"><span className="font-medium text-gray-700">我的感受：</span>{interaction.my_feelings.join('；')}</p> : null}
                  {interaction.interpretation ? <p className={cn('text-xs leading-5 text-gray-500', interaction.my_feelings?.length ? 'mt-1' : 'mt-3 border-t border-gray-100 pt-3')}><span className="font-medium text-gray-700">我的解释或判断：</span>{interaction.interpretation}</p> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState title="还没有互动记录" description="完成一次 60 秒记录后，真实时间线会从这里开始。" />}
      </SurfaceCard>
    </div>
  );
}

function PersonWorkspacePanel({ personId, tab, onBack }: { personId: string; tab: PersonTab; onBack: () => void }) {
  const navigate = useNavigate();
  const workspace = useRelationshipResource(`person-workspace:${personId}`, (signal) => relationshipApi.getPersonWorkspace(personId, signal));
  const [captureOpen, setCaptureOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  if (workspace.loading && !workspace.data) return <main className="min-w-0 flex-1 overflow-x-hidden bg-gray-50"><div className="p-4"><SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> 返回人物总览</SecondaryButton></div><LoadingState label="正在打开人物工作台…" /></main>;
  if (workspace.error) return <main className="min-w-0 flex-1 overflow-x-hidden bg-gray-50 p-4"><SecondaryButton onClick={onBack}><ArrowLeft className="h-4 w-4" /> 返回人物总览</SecondaryButton><div className="mt-4"><ErrorState message={workspace.error} onRetry={workspace.reload} /></div></main>;
  if (!workspace.data) return null;

  const data = workspace.data;
  return (
    <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-gray-50" data-testid="person-workspace">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="min-w-0">
            <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-950" aria-label="返回人物总览"><ArrowLeft className="h-4 w-4" /> 返回人物总览</button>
            <div className="mt-2 flex min-w-0 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700">{data.person.name.slice(0, 1)}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-bold text-gray-950">{data.person.name}</h1><AttentionBadge state={data.person.attention_state} /></div>
                <p className="mt-1 break-words text-sm text-gray-500">{data.person.identity || data.person.roles.join(' · ') || '未设置身份'}</p>
                <p className="mt-1 text-xs leading-5 text-gray-400">每次只做一个关系判断，再用真实互动校准。</p>
              </div>
            </div>
          </div>
          <PrimaryButton onClick={() => setCaptureOpen(true)} className="w-full shrink-0 sm:w-auto"><MessageSquarePlus className="h-4 w-4" /> 记录互动</PrimaryButton>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6" aria-label="人物工作台页签">
          {PERSON_TABS.map((item) => (
            <button key={item.id} type="button" onClick={() => navigate(`/relationships/people/${encodeURIComponent(personId)}/${item.id}`)} className={cn('min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium', tab === item.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-900')}>{item.label}</button>
          ))}
        </nav>
      </div>
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        {tab === 'overview' ? <OverviewTab workspace={data} onOpenCapture={() => setCaptureOpen(true)} onOpenDecisions={() => navigate(`/relationships/people/${personId}/decisions`)} onOpenUnderstanding={() => navigate(`/relationships/people/${personId}/evidence`)} onOpenInteractions={() => navigate(`/relationships/people/${personId}/interactions`)} onEditBrief={() => setBriefOpen(true)} /> : null}
        {tab === 'evidence' ? <EvidenceTab workspace={data} onChanged={workspace.reload} /> : null}
        {tab === 'decisions' ? <DecisionPanel personId={personId} decisions={data.decisions} onSaved={workspace.reload} /> : null}
        {tab === 'interactions' ? <InteractionsTab workspace={data} /> : null}
      </div>
      <QuickCaptureSheet open={captureOpen} personId={personId} onClose={() => setCaptureOpen(false)} onSaved={() => workspace.reload()} />
      <RelationshipBriefDialog open={briefOpen} context={data.primary_context} onClose={() => setBriefOpen(false)} onSaved={workspace.reload} />
    </main>
  );
}

function PeopleWorkspaceDirectory({ personId, tab }: { personId: string; tab: PersonTab }) {
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-gray-50">
      <PersonWorkspacePanel personId={personId} tab={tab} onBack={() => navigate('/relationships/people')} />
    </div>
  );
}

export default function PeoplePage() {
  const navigate = useNavigate();
  const { personId, tab: tabParam } = useParams<{ personId?: string; tab?: string }>();
  const tab: PersonTab = isPersonTab(tabParam) ? tabParam : 'overview';
  const [createOpen, setCreateOpen] = useState(false);

  if (personId) return <PeopleWorkspaceDirectory personId={personId} tab={tab} />;

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gray-50">
      <PeopleOverviewPage
        onCreate={() => setCreateOpen(true)}
        onOpenPerson={(person) => navigate(`/relationships/people/${encodeURIComponent(person.id)}/overview`)}
        onOpenLegacy={() => navigate('/relationships/legacy')}
      />
      <PersonCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(person) => {
        setCreateOpen(false);
        navigate(`/relationships/people/${encodeURIComponent(person.id)}/overview`);
      }} />
    </div>
  );
}
