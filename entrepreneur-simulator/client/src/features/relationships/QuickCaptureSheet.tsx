import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, PenLine, Sparkles, X } from 'lucide-react';
import type { ExtractedInteractionDraft, Interaction } from './model';
import { createClientRequestId, relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import {
  ErrorState,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
  formatDate,
  splitLines,
} from './RelationshipUi';

type CaptureStep = 'compose' | 'review' | 'success';

export function QuickCaptureSheet({
  open,
  personId,
  onClose,
  onSaved,
}: {
  open: boolean;
  personId?: string;
  onClose: () => void;
  onSaved?: (interaction: Interaction) => void;
}) {
  const people = useRelationshipResource(open && !personId ? 'capture-people' : null, (signal) => relationshipApi.getPeople({}, signal));
  const [selectedPersonId, setSelectedPersonId] = useState(personId || '');
  const [rawText, setRawText] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [requestId, setRequestId] = useState(createClientRequestId);
  const [draft, setDraft] = useState<ExtractedInteractionDraft | null>(null);
  const [step, setStep] = useState<CaptureStep>('compose');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedPersonId(personId || '');
    setRawText('');
    setOccurredAt(new Date().toISOString().slice(0, 16));
    setRequestId(createClientRequestId());
    setDraft(null);
    setStep('compose');
    setExtracting(false);
    setSaving(false);
    setError(null);
  }, [open, personId]);

  useEffect(() => {
    if (!open) requestController.current?.abort();
    return () => requestController.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !extracting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [extracting, onClose, open, saving]);

  if (!open) return null;

  const handleExtract = async () => {
    const targetPersonId = personId || selectedPersonId;
    if (!targetPersonId) {
      setError('请选择这次互动对应的人物。');
      return;
    }
    if (!rawText.trim()) {
      setError('请先写下刚才发生了什么。');
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setExtracting(true);
    setError(null);
    try {
      const proposal = await relationshipApi.extractInteraction({
        personId: targetPersonId,
        text: rawText.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
        clientRequestId: requestId,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setDraft(proposal);
      setStep('review');
    } catch (nextError) {
      if (controller.signal.aborted) return;
      setError(nextError instanceof Error ? nextError.message : 'AI 提取失败，请稍后重试。');
    } finally {
      if (!controller.signal.aborted) setExtracting(false);
    }
  };

  const handleManualReview = () => {
    const targetPersonId = personId || selectedPersonId;
    if (!targetPersonId) {
      setError('请选择这次互动对应的人物。');
      return;
    }
    if (!rawText.trim()) {
      setError('请先写下刚才发生了什么。');
      return;
    }
    setError(null);
    setDraft({
      proposal_id: '',
      person_id: targetPersonId,
      occurred_at: new Date(occurredAt).toISOString(),
      context: '',
      facts: splitLines(rawText),
      my_action: '',
      their_reaction: '',
      my_feelings: [],
      interpretation: '',
      commitments: [],
      opportunity_signals: [],
      hypothesis_updates: [],
      duplicate_candidates: [],
    });
    setStep('review');
  };

  const handleConfirm = async () => {
    if (!draft) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setSaving(true);
    setError(null);
    try {
      const interaction = draft.proposal_id
        ? await relationshipApi.confirmInteraction({ personId: draft.person_id, clientRequestId: requestId, draft }, controller.signal)
        : await relationshipApi.saveManualInteraction({ personId: draft.person_id, clientRequestId: requestId, draft }, controller.signal);
      if (controller.signal.aborted) return;
      onSaved?.(interaction);
      setStep('success');
    } catch (nextError) {
      if (controller.signal.aborted) return;
      setError(nextError instanceof Error ? nextError.message : '保存失败，请稍后重试。');
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const updateDraft = (patch: Partial<ExtractedInteractionDraft>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving && !extracting) onClose();
    }}>
      <section
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {step === 'review' ? (
              <button type="button" onClick={() => setStep('compose')} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="返回原始记录">
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : null}
            <div>
              <h2 id="quick-capture-title" className="font-semibold text-gray-950">60秒互动记录</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {step === 'compose' ? '可以自己整理，也可以让 AI 生成待确认草稿。' : step === 'review' ? '检查事实、感受与解释，再由你确认保存。' : '互动已经进入正式时间线。'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving || extracting} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="关闭快速记录">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 'compose' ? (
            <div className="space-y-5">
              {!personId ? (
                <FieldLabel label="互动对象">
                  <select
                    aria-label="互动对象"
                    value={selectedPersonId}
                    onChange={(event) => setSelectedPersonId(event.target.value)}
                    className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">选择人物</option>
                    {(people.data || []).map((person) => <option key={person.id} value={person.id}>{person.name}{person.identity ? ` · ${person.identity}` : ''}</option>)}
                  </select>
                </FieldLabel>
              ) : null}
              <FieldLabel label="互动时间">
                <TextInput type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
              </FieldLabel>
              <FieldLabel label="刚才发生了什么？" hint="事实、你的做法、对方反应">
                <TextArea
                  autoFocus
                  rows={8}
                  value={rawText}
                  onChange={(event) => setRawText(event.target.value)}
                  placeholder="例如：今天聊到项目推进。我提出先做一次小范围付费试验，对方没有立即答应，但问了价格和交付时间；我答应周五发一页方案。"
                />
              </FieldLabel>
              {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> : null}
              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div> : null}
            </div>
          ) : null}

          {step === 'review' && draft ? (
            <div className="space-y-5">
              {draft.warnings?.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                  <div className="font-semibold">
                    {draft.warnings.some((warning) => warning.includes('规则草稿')) ? '基础整理 · 非 AI' : '这份草稿需要额外核对'}
                  </div>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-800">
                    {draft.warnings.map((warning, index) => <li key={`${warning}-${index}`}>· {warning}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                下面仍是待确认草稿。只有点击“确认并保存”后，才会创建正式互动、承诺和机会信号。
              </div>
              <FieldLabel label="一句话互动摘要">
                <TextInput value={draft.context || ''} onChange={(event) => updateDraft({ context: event.target.value })} />
              </FieldLabel>
              <FieldLabel label="可观察事实" hint="每行一条">
                <TextArea rows={4} value={draft.facts.join('\n')} onChange={(event) => updateDraft({ facts: splitLines(event.target.value) })} />
              </FieldLabel>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label="我的行为">
                  <TextArea rows={4} value={draft.my_action || ''} onChange={(event) => updateDraft({ my_action: event.target.value })} />
                </FieldLabel>
                <FieldLabel label="对方可观察反应">
                  <TextArea rows={4} value={draft.their_reaction || ''} onChange={(event) => updateDraft({ their_reaction: event.target.value })} />
                </FieldLabel>
              </div>
              <FieldLabel label="我的感受" hint="感受属于你的真实体验，但不是对方意图的证据；每行一条">
                <TextArea rows={3} value={(draft.my_feelings || []).join('\n')} onChange={(event) => updateDraft({ my_feelings: splitLines(event.target.value) })} />
              </FieldLabel>
              <FieldLabel label="我的解释或判断" hint="它不是事实，保留不确定性，也允许以后被推翻">
                <TextArea rows={3} value={draft.interpretation || ''} onChange={(event) => updateDraft({ interpretation: event.target.value })} />
              </FieldLabel>
              <FieldLabel label="潜在商业信号" hint="每行一条；不确定可以删除">
                <TextArea rows={3} value={draft.opportunity_signals.join('\n')} onChange={(event) => updateDraft({ opportunity_signals: splitLines(event.target.value) })} />
              </FieldLabel>
              {draft.commitments.length > 0 ? (
                <div>
                  <div className="text-sm font-medium text-gray-800">提取到的承诺</div>
                  <div className="mt-2 space-y-2">
                    {draft.commitments.map((item, index) => (
                      <div key={`${item.title}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <span className="font-medium">{item.owner === 'me' ? '我' : item.owner === 'them' ? '对方' : '双方'}：</span>{item.title}
                        {item.due_at ? <span className="ml-2 text-xs text-gray-500">{formatDate(item.due_at)}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {draft.duplicate_candidates.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">发现可能重复的互动</div>
                  <p className="mt-1 text-xs text-amber-700">请确认内容确实是新互动；服务端会使用同一请求编号避免重复创建。</p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    {draft.duplicate_candidates.map((item) => <li key={item.id}>· {item.summary}</li>)}
                  </ul>
                </div>
              ) : null}
              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div> : null}
            </div>
          ) : null}

          {step === 'success' ? (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <h3 className="mt-4 text-lg font-semibold text-gray-950">已经保存</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-600">这次互动已经进入人物时间线，可继续在人物工作台验证判断或制定下一步。</p>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
          {step === 'compose' ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <SecondaryButton onClick={handleManualReview} disabled={extracting || !rawText.trim()} className="w-full sm:w-auto sm:min-w-36">
                <PenLine className="h-4 w-4" /> 手动整理
              </SecondaryButton>
              <PrimaryButton onClick={() => void handleExtract()} disabled={extracting || !rawText.trim()} className="w-full sm:w-auto sm:min-w-40">
                <Sparkles className="h-4 w-4" /> {extracting ? '整理草稿中…' : 'AI 帮我整理'}
              </PrimaryButton>
            </div>
          ) : null}
          {step === 'review' ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <SecondaryButton onClick={() => setStep('compose')} disabled={saving}>返回修改原文</SecondaryButton>
              <PrimaryButton onClick={() => void handleConfirm()} disabled={saving}>{saving ? '保存中…' : '确认并保存'}</PrimaryButton>
            </div>
          ) : null}
          {step === 'success' ? <PrimaryButton onClick={onClose} className="w-full sm:w-auto">完成</PrimaryButton> : null}
        </footer>
      </section>
    </div>
  );
}
