import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  ChevronDown,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AttentionRecommendation, PersonSummary } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import {
  AttentionBadge,
  EmptyState,
  ErrorState,
  FieldLabel,
  LoadingState,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
  TextArea,
  TextInput,
  cn,
  formatDate,
} from './RelationshipUi';

const SOURCE_LABELS: Record<string, string> = {
  goals: '目标与差距',
  people: '人物资料',
  interactions: '互动记录',
  commitments: '承诺',
  opportunities: '机会与项目',
  reviews: '复盘',
  growth: '处事原则与盲点',
  planner: '首页待办',
  life_documents: '生活资料',
};

const confidenceLabel = (value?: string | null) => {
  if (value === 'strong') return '依据较充分';
  if (value === 'moderate') return '初步可用';
  return '仍需验证';
};

const identityLine = (person: PersonSummary) => person.identity || person.roles.join(' · ') || '尚未设置关系角色';

const replacePerson = (people: PersonSummary[], person: PersonSummary) => {
  const exists = people.some((item) => item.id === person.id);
  return exists ? people.map((item) => item.id === person.id ? person : item) : [person, ...people];
};

function AttentionEditorDialog({
  open,
  title,
  description,
  initialReason,
  initialObserve,
  confirmLabel,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initialReason?: string | null;
  initialObserve?: string | null;
  confirmLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string, observeNext: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState(initialReason || '');
  const [observeNext, setObserveNext] = useState(initialObserve || '');

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="flex max-h-[92dvh] w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="attention-editor-title">
        <header className="shrink-0 border-b border-gray-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="attention-editor-title" className="font-semibold text-gray-950">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <FieldLabel label="为什么现在关注">
            <TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="它与我当前的目标、责任、情感或风险有什么关系？" />
          </FieldLabel>
          <FieldLabel label="下一次只观察什么" hint="只保留一个可验证信号">
            <TextArea rows={3} value={observeNext} onChange={(event) => setObserveNext(event.target.value)} placeholder="例如：提出具体请求后，对方是否愿意给出明确回应" />
          </FieldLabel>
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div> : null}
        </div>
        <footer className="shrink-0 border-t border-gray-200 bg-white px-5 py-4">
          <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose} disabled={saving}>取消</SecondaryButton>
          <PrimaryButton type="button" onClick={() => void onSubmit(reason.trim(), observeNext.trim())} disabled={saving || !reason.trim() || !observeNext.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{saving ? '保存中…' : confirmLabel}
          </PrimaryButton>
          </div>
        </footer>
      </section>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  runStatus,
  busy,
  onAccept,
  onEditAccept,
  onDismiss,
  onOpenPerson,
}: {
  recommendation: AttentionRecommendation;
  runStatus?: 'ai' | 'fallback' | 'empty';
  busy: boolean;
  onAccept: () => void;
  onEditAccept: () => void;
  onDismiss: () => void;
  onOpenPerson: () => void;
}) {
  const person = recommendation.person;
  const why = recommendation.why_now || recommendation.reason || '本条建议尚未说明原因。';
  return (
    <article className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/70 p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <button type="button" onClick={onOpenPerson} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700" aria-label={`打开${person.name}的人物详情`}>
          {person.name.slice(0, 1)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onOpenPerson} className="font-semibold text-gray-950 hover:text-indigo-700">{person.name}</button>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', runStatus === 'ai' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600')}>
              {runStatus === 'ai' ? confidenceLabel(recommendation.confidence) : '规则候选 · 非 AI'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">{identityLine(person)}</p>
          {recommendation.life_domains.length ? <div className="mt-2 flex flex-wrap gap-1.5">{recommendation.life_domains.map((domain) => <span key={domain} className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500 ring-1 ring-gray-200">{domain}</span>)}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/90 p-3 ring-1 ring-gray-100">
          <div className="text-xs font-medium text-gray-500">为什么现在</div>
          <p className="mt-1.5 text-sm leading-6 text-gray-800">{why}</p>
          {recommendation.reason && recommendation.why_now && recommendation.reason !== recommendation.why_now ? <p className="mt-2 text-xs leading-5 text-gray-500">{recommendation.reason}</p> : null}
        </div>
        <div className="rounded-xl bg-white/90 p-3 ring-1 ring-gray-100">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Eye className="h-3.5 w-3.5" /> 下一次只观察</div>
          <p className="mt-1.5 text-sm leading-6 text-gray-800">{recommendation.observe_next || '尚待设定'}</p>
        </div>
      </div>

      {recommendation.evidence_refs.length ? (
        <details className="mt-3 rounded-lg border border-gray-200 bg-white/70 px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-gray-600">
            <span>查看依据 · {recommendation.evidence_refs.length} 条</span><ChevronDown className="h-4 w-4" />
          </summary>
          <ul className="mt-2 space-y-2 text-xs leading-5 text-gray-600">
            {recommendation.evidence_refs.map((evidence, index) => (
              <li key={`${evidence.type}-${evidence.id || index}`} className="rounded-md bg-gray-50 px-2.5 py-2">
                <div className="font-medium text-gray-700">{evidence.label}</div>
                {evidence.summary && evidence.summary !== evidence.label ? <div className="mt-0.5 text-gray-500">{evidence.summary}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <PrimaryButton type="button" onClick={onAccept} disabled={busy}><UserPlus className="h-4 w-4" /> 加入关注</PrimaryButton>
        <SecondaryButton type="button" onClick={onEditAccept} disabled={busy}><Pencil className="h-4 w-4" /> 编辑后加入</SecondaryButton>
        <button type="button" onClick={onDismiss} disabled={busy} className="min-h-10 rounded-lg px-3 text-sm font-medium text-gray-500 hover:bg-white hover:text-gray-800 disabled:opacity-50">暂不关注</button>
      </div>
    </article>
  );
}

function AttentionPersonCard({
  person,
  busy,
  onOpen,
  onEdit,
  onRemove,
}: {
  person: PersonSummary;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <button type="button" onClick={onOpen} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 font-semibold text-gray-700" aria-label={`打开${person.name}的人物详情`}>{person.name.slice(0, 1)}</button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onOpen} className="truncate font-semibold text-gray-950 hover:text-indigo-700">{person.name}</button>
            <AttentionBadge state={person.attention_state} />
          </div>
          <p className="mt-1 truncate text-xs text-gray-500">{identityLine(person)}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div>
          <div className="text-xs font-medium text-gray-500">为什么现在关注</div>
          <p className="mt-1 text-sm leading-6 text-gray-800">{person.focus_reason || '尚未写明关注原因'}</p>
        </div>
        <div className="rounded-xl bg-indigo-50 px-3 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-600"><Eye className="h-3.5 w-3.5" /> 下一次只观察</div>
          <p className="mt-1 text-sm leading-6 text-indigo-950">{person.observe_next || '尚待设定'}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <SecondaryButton type="button" onClick={onEdit} disabled={busy}><Pencil className="h-4 w-4" /> 调整</SecondaryButton>
        {person.attention_state === 'focus' ? <button type="button" onClick={onRemove} disabled={busy} className="min-h-10 rounded-lg px-3 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50">移回关系库</button> : null}
        {person.attention_state === 'repair' || person.attention_state === 'boundary' ? <span className="text-xs leading-5 text-gray-500">相处策略需在人物页调整</span> : null}
        <button type="button" onClick={onOpen} className="ml-auto inline-flex min-h-10 items-center gap-1 px-1 text-sm font-medium text-indigo-600 hover:text-indigo-700">打开人物 <ArrowRight className="h-4 w-4" /></button>
      </div>
    </article>
  );
}

type EditorState =
  | { kind: 'recommendation'; recommendation: AttentionRecommendation }
  | { kind: 'person'; person: PersonSummary; action: 'add' | 'edit' }
  | null;

export default function PeopleOverviewPage({
  onCreate,
  onOpenPerson,
  onOpenLegacy,
}: {
  onCreate: () => void;
  onOpenPerson: (person: PersonSummary) => void;
  onOpenLegacy: () => void;
}) {
  const overview = useRelationshipResource('people-overview', relationshipApi.getPeopleOverview);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);

  const data = overview.data;
  const roles = useMemo(() => Array.from(new Set((data?.library_people || []).flatMap((person) => person.roles))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [data?.library_people]);
  const filteredLibrary = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    return (data?.library_people || []).filter((person) => {
      if (roleFilter && !person.roles.includes(roleFilter)) return false;
      if (!keyword) return true;
      return [person.name, person.identity, person.field, ...person.roles, ...person.tags]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('zh-CN').includes(keyword));
    });
  }, [data?.library_people, roleFilter, search]);

  const updateAfterAttentionChange = (person: PersonSummary, current: boolean) => {
    overview.setData((value) => {
      if (!value) return value;
      const withoutAttention = value.attention_people.filter((item) => item.id !== person.id);
      const withoutLibrary = value.library_people.filter((item) => item.id !== person.id);
      const attentionPeople = current ? replacePerson(withoutAttention, person) : withoutAttention;
      const libraryPeople = current ? withoutLibrary : replacePerson(withoutLibrary, person);
      const recommendations = current
        ? value.recommendations.filter((item) => item.person_id !== person.id)
        : value.recommendations;
      return {
        ...value,
        recommendations,
        attention_people: attentionPeople,
        library_people: libraryPeople,
        counts: {
          ...value.counts,
          attention: attentionPeople.length,
          library: libraryPeople.length,
          recommendations: recommendations.length,
        },
      };
    });
  };

  const decide = async (recommendation: AttentionRecommendation, decision: 'accept' | 'dismiss', reason?: string, observeNext?: string) => {
    setBusyKey(`recommendation:${recommendation.id}`);
    setActionError(null);
    try {
      const result = await relationshipApi.decideAttentionRecommendation(recommendation.id, {
        decision,
        reason,
        observeNext,
        expectedVersion: recommendation.version,
      });
      overview.setData((value) => value ? {
        ...value,
        recommendations: value.recommendations.filter((item) => item.id !== recommendation.id),
        counts: { ...value.counts, recommendations: Math.max(0, value.counts.recommendations - 1) },
      } : value);
      if (decision === 'accept') {
        const person = result.person || {
          ...recommendation.person,
          attention_state: 'focus' as const,
          attention_layer: 'current' as const,
          current_attention: true,
          focus_reason: reason || recommendation.why_now || recommendation.reason,
          observe_next: observeNext || recommendation.observe_next,
        };
        updateAfterAttentionChange(person, true);
      }
      setEditor(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新关注建议失败。');
    } finally {
      setBusyKey(null);
    }
  };

  const updateAttention = async (person: PersonSummary, current: boolean, reason?: string, observeNext?: string) => {
    setBusyKey(`person:${person.id}`);
    setActionError(null);
    try {
      const result = await relationshipApi.updatePersonAttention(person.id, {
        attentionState: current ? (person.current_attention ? person.attention_state : 'focus') : 'observe',
        focusReason: reason ?? person.focus_reason ?? '',
        observeNext: observeNext ?? person.observe_next ?? '',
        contextId: person.primary_context_id || undefined,
        expectedVersion: person.context_version,
      });
      updateAfterAttentionChange(result, current);
      setEditor(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新关注状态失败。');
    } finally {
      setBusyKey(null);
    }
  };

  const generate = async (refresh: boolean) => {
    setGenerating(true);
    setActionError(null);
    try {
      overview.setData(await relationshipApi.generateAttentionRecommendations(refresh));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '生成关注建议失败。');
    } finally {
      setGenerating(false);
    }
  };

  const run = data?.recommendation_run || null;
  const sourceEntries = Object.entries(run?.source_status || {});
  const trackedCount = data?.counts.tracked ?? 0;

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-gray-50">
      <PageHeader
        eyebrow="完整人生 · 关系注意力"
        title="人物"
        description="现在关注谁、为什么，以及下一次只观察什么。"
        actions={<PrimaryButton type="button" onClick={onCreate}><Plus className="h-4 w-4" /> 新建人物</PrimaryButton>}
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {overview.loading && !data ? <LoadingState label="正在整理人物与当前关系信号…" /> : null}
        {overview.error ? <ErrorState message={overview.error} onRetry={overview.reload} /> : null}
        {actionError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{actionError}</div> : null}
        {data?.warning ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">{data.warning}</div> : null}

        {data ? (
          <>
            <SurfaceCard
              title="AI 待确认建议"
              description="系统可以提出注意力建议，但只有你确认后才会改变关注名单。"
              icon={run?.status === 'ai' ? <Sparkles className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
              action={<SecondaryButton type="button" onClick={() => void generate(Boolean(run))} disabled={generating || trackedCount === 0}>{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{run ? '刷新建议' : '生成建议'}</SecondaryButton>}
            >
              {run ? (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className={cn('rounded-full px-2.5 py-1 font-medium', run.status === 'ai' ? 'bg-emerald-100 text-emerald-700' : run.status === 'fallback' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600')}>
                    {run.status === 'ai' ? 'AI 已生成' : run.status === 'fallback' ? '基础筛选 · 非 AI' : '本轮无新增建议'}
                  </span>
                  {run.generated_at ? <span>生成于 {formatDate(run.generated_at, true)}</span> : null}
                  {data.cached ? <span>· 当前快照缓存</span> : null}
                  {sourceEntries.length ? (
                    <details className="relative">
                      <summary className="cursor-pointer font-medium text-indigo-600">查看读取范围</summary>
                      <div className="mt-2 flex max-w-2xl flex-wrap gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                        {sourceEntries.map(([domain, source]) => <span key={domain} className={cn('rounded-full bg-white px-2 py-1', source.available ? 'text-gray-600' : 'text-red-600')}>{SOURCE_LABELS[domain] || domain} {source.count}{source.available ? '' : ' · 未读取'}</span>)}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {run?.warning ? <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{run.warning}</div> : null}

              {data.recommendations.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {data.recommendations.map((recommendation) => (
                    <RecommendationCard
                      key={recommendation.id}
                      recommendation={recommendation}
                      runStatus={run?.status}
                      busy={busyKey === `recommendation:${recommendation.id}`}
                      onAccept={() => {
                        const reason = recommendation.why_now || recommendation.reason || '';
                        const observeNext = recommendation.observe_next || '';
                        if (!reason || !observeNext) setEditor({ kind: 'recommendation', recommendation });
                        else void decide(recommendation, 'accept', reason, observeNext);
                      }}
                      onEditAccept={() => setEditor({ kind: 'recommendation', recommendation })}
                      onDismiss={() => void decide(recommendation, 'dismiss')}
                      onOpenPerson={() => onOpenPerson(recommendation.person)}
                    />
                  ))}
                </div>
              ) : trackedCount === 0 ? (
                <EmptyState title="还没有人物" description="先建立一份轻档案，之后 AI 才能根据真实互动提出关注建议。" action={<PrimaryButton type="button" onClick={onCreate}><Plus className="h-4 w-4" /> 新建第一个人物</PrimaryButton>} />
              ) : run ? (
                <EmptyState title={run.status === 'fallback' ? '基础筛选没有发现明确候选' : '本轮没有建议新增关注'} description={run.status === 'fallback' ? 'AI 本次不可用，规则结果不会冒充 AI 判断。你仍可从关系库手动加入。' : '这不代表关系不重要，只表示当前资料里没有足够理由改变注意力分配。'} />
              ) : (
                <EmptyState title="尚未生成关注建议" description="AI 会读取目标、人物、互动、承诺、机会与复盘；生成后仍由你决定。" action={<SecondaryButton type="button" onClick={() => void generate(false)} disabled={generating}>生成一次建议</SecondaryButton>} />
              )}
            </SurfaceCard>

            <section aria-labelledby="current-attention-title">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <div className="flex items-center gap-2"><Users className="h-5 w-5 text-indigo-600" /><h2 id="current-attention-title" className="text-lg font-semibold text-gray-950">当前关注</h2><span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{data.attention_people.length}</span></div>
                  <p className="mt-1 text-sm text-gray-500">不是永久的重要性排名，只表示现在值得投入注意力。</p>
                </div>
              </div>
              {data.attention_people.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.attention_people.map((person) => <AttentionPersonCard key={person.id} person={person} busy={busyKey === `person:${person.id}`} onOpen={() => onOpenPerson(person)} onEdit={() => setEditor({ kind: 'person', person, action: 'edit' })} onRemove={() => void updateAttention(person, false)} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white"><EmptyState title="当前没有重点关注的人" description="你可以确认 AI 建议，也可以从关系库手动加入。" /></div>
              )}
            </section>

            <SurfaceCard
              title="关系库"
              description="暂时不需要重点投入，但值得保留长期联系的人。"
              icon={<Users className="h-5 w-5" />}
              action={<SecondaryButton type="button" onClick={onCreate}><Plus className="h-4 w-4" /> 新建</SecondaryButton>}
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名、身份或标签" className="pl-9" aria-label="搜索关系库" />
                </div>
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700" aria-label="筛选关系角色">
                  <option value="">全部关系角色</option>
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {filteredLibrary.map((person) => (
                  <article key={person.id} className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
                    <button type="button" onClick={() => onOpenPerson(person)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 font-semibold text-gray-600">{person.name.slice(0, 1)}</span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-gray-950">{person.name}</span><AttentionBadge state={person.attention_state} /></span>
                        <span className="mt-1 block truncate text-xs text-gray-500">{identityLine(person)}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                      <span className="text-xs text-gray-400">最近互动：{formatDate(person.last_interaction_at)}</span>
                      <SecondaryButton type="button" onClick={() => setEditor({ kind: 'person', person, action: 'add' })} disabled={busyKey === `person:${person.id}`}><UserPlus className="h-4 w-4" /> 加入关注</SecondaryButton>
                    </div>
                  </article>
                ))}
                {!filteredLibrary.length ? <EmptyState title={data.library_people.length ? '没有符合条件的人物' : '关系库暂时为空'} description={data.library_people.length ? '换一个关键词或关系角色试试。' : '已进入当前关注的人不会在这里重复出现。'} /> : null}
              </div>
              <div className="mt-4 flex justify-center">
                <button type="button" onClick={onOpenLegacy} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-800">查看旧档案（只读） <ArrowRight className="h-4 w-4" /></button>
              </div>
            </SurfaceCard>
          </>
        ) : null}
      </div>

      {editor ? (
        <AttentionEditorDialog
          key={editor.kind === 'recommendation' ? `recommendation-${editor.recommendation.id}` : `person-${editor.person.id}-${editor.action}`}
          open
          title={editor.kind === 'recommendation' ? `确认关注 ${editor.recommendation.person.name}` : editor.action === 'add' ? `加入关注：${editor.person.name}` : `调整关注：${editor.person.name}`}
          description={editor.kind === 'recommendation' ? '你可以修正 AI 的理由与观察信号，再决定是否加入。' : '只记录当前阶段的理由与一个可验证信号，不给关系做永久定论。'}
          initialReason={editor.kind === 'recommendation' ? editor.recommendation.why_now || editor.recommendation.reason : editor.person.focus_reason}
          initialObserve={editor.kind === 'recommendation' ? editor.recommendation.observe_next : editor.person.observe_next}
          confirmLabel={editor.kind === 'recommendation' ? '确认并加入' : editor.action === 'add' ? '加入当前关注' : '保存调整'}
          saving={busyKey !== null}
          error={actionError}
          onClose={() => { if (!busyKey) { setEditor(null); setActionError(null); } }}
          onSubmit={(reason, observeNext) => editor.kind === 'recommendation'
            ? decide(editor.recommendation, 'accept', reason, observeNext)
            : updateAttention(editor.person, true, reason, observeNext)}
        />
      ) : null}
    </main>
  );
}
