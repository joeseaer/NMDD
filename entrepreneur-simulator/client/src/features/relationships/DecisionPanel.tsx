import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Flag, RotateCcw, Send } from 'lucide-react';
import type { DecisionProposal, RelationshipDecision } from './model';
import { decisionProposalFromForm, relationshipApi } from './relationshipApi';
import {
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
  TextArea,
  TextInput,
  formatDate,
  splitLines,
} from './RelationshipUi';

type RelationshipMode = 'long_term' | 'transaction' | 'mixed';

const emptyForm = {
  goal: '',
  whyNow: '',
  relationshipMode: 'long_term' as RelationshipMode,
  mutualValue: '',
  chosenAction: '',
  positiveSignals: '',
  neutralSignals: '',
  negativeSignals: '',
  boundaries: '',
  stopConditions: '',
};

function OutcomeEditor({ decision, onSaved }: { decision: RelationshipDecision; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [actualResponse, setActualResponse] = useState('');
  const [result, setResult] = useState<'positive' | 'neutral' | 'negative' | 'mixed'>('neutral');
  const [matchedExpectation, setMatchedExpectation] = useState<boolean | undefined>(undefined);
  const [learning, setLearning] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decision.outcome) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4" /> 已完成结果复盘</div>
        <p className="mt-2 text-sm leading-6 text-emerald-900">{decision.outcome.actual_result}</p>
        {decision.outcome.lesson ? <p className="mt-2 text-xs leading-5 text-emerald-800">学到：{decision.outcome.lesson}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 items-center gap-2 text-sm font-medium text-indigo-700">
        <RotateCcw className="h-4 w-4" /> 记录真实结果 {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="mt-3 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <FieldLabel label="真实发生了什么">
            <TextArea rows={4} value={actualResponse} onChange={(event) => setActualResponse(event.target.value)} />
          </FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="结果">
              <select value={result} onChange={(event) => setResult(event.target.value as typeof result)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="positive">积极</option>
                <option value="neutral">中性</option>
                <option value="negative">负面</option>
                <option value="mixed">混合</option>
              </select>
            </FieldLabel>
            <FieldLabel label="符合原先预期吗">
              <select value={matchedExpectation === undefined ? '' : String(matchedExpectation)} onChange={(event) => setMatchedExpectation(event.target.value === '' ? undefined : event.target.value === 'true')} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">仍不确定</option>
                <option value="true">符合</option>
                <option value="false">不符合</option>
              </select>
            </FieldLabel>
          </div>
          <FieldLabel label="这让我明白了什么">
            <TextArea rows={3} value={learning} onChange={(event) => setLearning(event.target.value)} />
          </FieldLabel>
          <FieldLabel label="下一步">
            <TextInput value={nextStep} onChange={(event) => setNextStep(event.target.value)} />
          </FieldLabel>
          {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
          <PrimaryButton
            disabled={saving || !actualResponse.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await relationshipApi.recordDecisionOutcome(decision.id, { actualResponse, result, matchedExpectation, learning, nextStep });
                onSaved();
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '保存结果失败。');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '保存中…' : '保存结果复盘'}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}

export default function DecisionPanel({ personId, decisions, onSaved }: { personId: string; decisions: RelationshipDecision[]; onSaved: () => void }) {
  const [form, setForm] = useState(emptyForm);
  const [proposal, setProposal] = useState<DecisionProposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const buildPreview = () => {
    setError(null);
    if (!form.goal.trim() || !form.chosenAction.trim()) {
      setError('请先写清目标和你准备采取的最小下一步。');
      return;
    }
    setProposal(decisionProposalFromForm({
      goal: form.goal.trim(),
      whyNow: form.whyNow.trim(),
      relationshipMode: form.relationshipMode,
      mutualValue: form.mutualValue.trim(),
      chosenAction: form.chosenAction.trim(),
      positiveSignals: splitLines(form.positiveSignals),
      neutralSignals: splitLines(form.neutralSignals),
      negativeSignals: splitLines(form.negativeSignals),
      boundaries: splitLines(form.boundaries),
      stopConditions: splitLines(form.stopConditions),
    }, personId));
  };

  const saveDecision = async () => {
    if (!proposal) return;
    setSaving(true);
    setError(null);
    try {
      await relationshipApi.createDecision({
        personId,
        goal: form.goal.trim(),
        whyNow: form.whyNow.trim(),
        relationshipMode: form.relationshipMode,
        mutualValue: form.mutualValue.trim(),
        chosenAction: form.chosenAction.trim(),
        positiveSignals: splitLines(form.positiveSignals),
        neutralSignals: splitLines(form.neutralSignals),
        negativeSignals: splitLines(form.negativeSignals),
        boundaries: splitLines(form.boundaries),
        stopConditions: splitLines(form.stopConditions),
      });
      setForm(emptyForm);
      setProposal(null);
      onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存决定失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SurfaceCard title="做出一个可验证的决定" description="先由你明确目标、边界和反馈信号，再确认保存。" icon={<Flag className="h-5 w-5" />}>
        {!proposal ? (
          <div className="space-y-4">
            <FieldLabel label="这次希望得到什么可观察结果">
              <TextArea rows={3} value={form.goal} onChange={(event) => updateForm('goal', event.target.value)} />
            </FieldLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="为什么是现在">
                <TextInput value={form.whyNow} onChange={(event) => updateForm('whyNow', event.target.value)} />
              </FieldLabel>
              <FieldLabel label="关系模式">
                <select value={form.relationshipMode} onChange={(event) => updateForm('relationshipMode', event.target.value as RelationshipMode)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="long_term">经营长期关系</option>
                  <option value="transaction">处理一件具体事情</option>
                  <option value="mixed">两者都有</option>
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label="双方的需要与期待">
              <TextArea rows={3} value={form.mutualValue} onChange={(event) => updateForm('mutualValue', event.target.value)} />
            </FieldLabel>
            <FieldLabel label="最小、自然的下一步">
              <TextArea rows={3} value={form.chosenAction} onChange={(event) => updateForm('chosenAction', event.target.value)} />
            </FieldLabel>
            <div className="grid gap-4 lg:grid-cols-3">
              <FieldLabel label="积极信号" hint="每行一条"><TextArea rows={3} value={form.positiveSignals} onChange={(event) => updateForm('positiveSignals', event.target.value)} /></FieldLabel>
              <FieldLabel label="中性信号" hint="每行一条"><TextArea rows={3} value={form.neutralSignals} onChange={(event) => updateForm('neutralSignals', event.target.value)} /></FieldLabel>
              <FieldLabel label="负面信号" hint="每行一条"><TextArea rows={3} value={form.negativeSignals} onChange={(event) => updateForm('negativeSignals', event.target.value)} /></FieldLabel>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="不突破的边界" hint="每行一条"><TextArea rows={3} value={form.boundaries} onChange={(event) => updateForm('boundaries', event.target.value)} /></FieldLabel>
              <FieldLabel label="调整或停止条件" hint="每行一条"><TextArea rows={3} value={form.stopConditions} onChange={(event) => updateForm('stopConditions', event.target.value)} /></FieldLabel>
            </div>
            {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
            <PrimaryButton onClick={buildPreview}><Send className="h-4 w-4" /> 预览我的决定</PrimaryButton>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">待确认决定</div>
              <h3 className="mt-2 font-semibold text-indigo-950">{proposal.goal}</h3>
              <p className="mt-2 text-sm leading-6 text-indigo-900">下一步：{proposal.next_step}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-4"><div className="text-xs font-medium text-gray-500">互惠价值</div><p className="mt-2 text-sm leading-6 text-gray-800">{proposal.mutual_value || '尚未写明'}</p></div>
              <div className="rounded-xl border border-gray-200 p-4"><div className="text-xs font-medium text-gray-500">停止条件</div><p className="mt-2 text-sm leading-6 text-gray-800">{proposal.stop_conditions.join('；') || '尚未写明'}</p></div>
            </div>
            <p className="text-sm leading-6 text-gray-600">这仍是你的草稿。确认后才会创建正式决定，并可在真实互动后记录结果。</p>
            {error ? <div className="text-sm text-red-700" role="alert">{error}</div> : null}
            <div className="flex flex-wrap gap-2">
              <SecondaryButton onClick={() => setProposal(null)} disabled={saving}>返回修改</SecondaryButton>
              <PrimaryButton onClick={() => void saveDecision()} disabled={saving}>{saving ? '保存中…' : '确认并保存决定'}</PrimaryButton>
            </div>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard title="决定与真实结果" description="用真实反馈校准判断，不以漂亮分析代替结果。">
        {decisions.length ? (
          <div className="space-y-3">
            {decisions.map((decision) => (
              <article key={decision.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-gray-950">{decision.goal}</div>
                    <p className="mt-1 text-sm leading-6 text-gray-600">下一步：{decision.next_step || '未设置'}</p>
                  </div>
                  <div className="text-xs text-gray-500">{formatDate(decision.created_at)}</div>
                </div>
                {decision.feedback_signals.length ? <div className="mt-3 text-xs leading-5 text-gray-500">观察信号：{decision.feedback_signals.join('；')}</div> : null}
                <OutcomeEditor decision={decision} onSaved={onSaved} />
              </article>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">还没有正式决定。先从一个具体目标和最小下一步开始。</p>}
      </SurfaceCard>
    </div>
  );
}
