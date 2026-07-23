import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { CompassPlan } from './model';
import { relationshipApi } from './relationshipApi';
import {
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
  splitLines,
} from './RelationshipUi';

const lines = (value: string[]) => value.join('\n');

export function CompassPlanEditor({
  open,
  plan,
  onClose,
  onSaved,
}: {
  open: boolean;
  plan: CompassPlan;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [outcome, setOutcome] = useState(plan.outcome_statement);
  const [horizonDate, setHorizonDate] = useState(plan.horizon_date || '');
  const [focus, setFocus] = useState(plan.ninety_day_bet || '');
  const [successMetrics, setSuccessMetrics] = useState(lines(plan.success_metrics));
  const [assets, setAssets] = useState(lines(plan.current_assets));
  const [constraints, setConstraints] = useState(lines(plan.current_constraints));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOutcome(plan.outcome_statement);
    setHorizonDate(plan.horizon_date || '');
    setFocus(plan.ninety_day_bet || '');
    setSuccessMetrics(lines(plan.success_metrics));
    setAssets(lines(plan.current_assets));
    setConstraints(lines(plan.current_constraints));
    setError(null);
  }, [open, plan]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!outcome.trim()) {
      setError('请先写清楚完成目标后的现实画面。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await relationshipApi.saveCompass({
        title: plan.title,
        horizonDate: horizonDate || null,
        outcomeStatement: outcome,
        successMetrics: splitLines(successMetrics),
        currentAssets: splitLines(assets),
        currentConstraints: splitLines(constraints),
        ninetyDayBet: focus || null,
        nonNegotiables: plan.non_negotiables,
        planningState: { ...plan.planning_state, daily_guidance: null },
        expectedVersion: plan.version || undefined,
      });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存目标失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 p-0 sm:items-center sm:p-6" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="compass-editor-title"
        onSubmit={submit}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 id="compass-editor-title" className="font-semibold text-gray-950">调整目标锚点</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">只修改目标、现实基线和当前阶段；具体执行仍放在首页待办。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <FieldLabel label="完成目标后的现实画面">
            <TextArea rows={4} value={outcome} onChange={(event) => setOutcome(event.target.value)} autoFocus />
          </FieldLabel>

          <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <FieldLabel label="目标日期">
              <TextInput type="date" value={horizonDate} onChange={(event) => setHorizonDate(event.target.value)} />
            </FieldLabel>
            <FieldLabel label="当前阶段重点">
              <TextInput value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="这一阶段最需要取得什么现实结果？" />
            </FieldLabel>
          </div>

          <FieldLabel label="什么证据代表真正完成" hint="每行一条，最多保留最关键的三项">
            <TextArea rows={4} value={successMetrics} onChange={(event) => setSuccessMetrics(event.target.value)} />
          </FieldLabel>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="当前已有条件" hint="每行一条">
              <TextArea rows={5} value={assets} onChange={(event) => setAssets(event.target.value)} />
            </FieldLabel>
            <FieldLabel label="当前现实约束" hint="每行一条">
              <TextArea rows={5} value={constraints} onChange={(event) => setConstraints(event.target.value)} />
            </FieldLabel>
          </div>

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4 sm:px-6">
          <SecondaryButton type="button" onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? '保存中…' : '保存调整'}</PrimaryButton>
        </div>
      </form>
    </div>
  );
}
