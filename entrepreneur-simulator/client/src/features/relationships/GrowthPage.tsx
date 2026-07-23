import { Brain, CheckCircle2, Gauge, Repeat2, Shield, TrendingUp } from 'lucide-react';
import { EMPTY_GROWTH_DATA } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import { EmptyState, ErrorState, LoadingState, PageHeader, SurfaceCard } from './RelationshipUi';

const percent = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
};

export default function GrowthPage() {
  const growth = useRelationshipResource('relationship-growth', relationshipApi.getGrowth);
  const data = growth.data || EMPTY_GROWTH_DATA;
  const judgmentRate = percent(data.independent_judgment_rate);
  const commitmentRate = percent(data.commitment_completion_rate);

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader eyebrow="关系与机会" title="处世成长" description="发现自己跨人物反复出现的模式，并用真实结果训练独立判断。" />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {growth.loading ? <LoadingState label="正在整理你的长期模式…" /> : null}
        {growth.error ? <ErrorState message={growth.error} onRetry={growth.reload} /> : null}
        {growth.data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600"><Repeat2 className="h-4 w-4 text-indigo-600" /> 完整闭环</div>
                <div className="mt-3 text-3xl font-bold text-gray-950">{data.closed_loop_count || 0}</div>
                <div className="mt-1 text-xs text-gray-500">判断 → 行动 → 结果 → 修正</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600"><Brain className="h-4 w-4 text-indigo-600" /> 独立判断比例</div>
                <div className="mt-3 text-3xl font-bold text-gray-950">{judgmentRate === null ? '—' : `${judgmentRate}%`}</div>
                <div className="mt-1 text-xs text-gray-500">最终判断由你确认，而不是直接采用 AI</div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> 承诺完成率</div>
                <div className="mt-3 text-3xl font-bold text-gray-950">{commitmentRate === null ? '—' : `${commitmentRate}%`}</div>
                <div className="mt-1 text-xs text-gray-500">先让自己的可靠性可观察</div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <SurfaceCard title="我的处世原则" description="原则必须有多场景证据，也允许被反例修正。" icon={<Shield className="h-5 w-5" />}>
                {data.principles.length ? (
                  <div className="space-y-3">
                    {data.principles.map((principle) => (
                      <article key={principle.id} className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium leading-6 text-gray-950">{principle.statement}</p>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${principle.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{principle.status === 'confirmed' ? '已验证' : principle.status === 'retired' ? '已退休' : '候选'}</span>
                        </div>
                        <div className="mt-3 flex gap-4 text-xs text-gray-500"><span>{principle.evidence_count} 条支持</span><span>{principle.counterexample_count} 条反例</span></div>
                      </article>
                    ))}
                  </div>
                ) : <EmptyState title="还没有形成个人原则" description="周复盘确认的原则会进入这里，并继续接受真实互动检验。" />}
              </SurfaceCard>

              <SurfaceCard title="我反复出现的模式" description="它们是待验证的行为模式，不是人格诊断。" icon={<TrendingUp className="h-5 w-5" />}>
                {data.patterns.length ? (
                  <div className="space-y-3">
                    {data.patterns.map((pattern) => (
                      <article key={pattern.id} className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium leading-6 text-gray-950">{pattern.statement}</p>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${pattern.status === 'confirmed' ? 'bg-indigo-50 text-indigo-700' : pattern.status === 'rejected' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-800'}`}>{pattern.status === 'confirmed' ? '多次出现' : pattern.status === 'rejected' ? '已否定' : '待验证'}</span>
                        </div>
                        <div className="mt-3 flex gap-4 text-xs text-gray-500"><span>{pattern.evidence_count} 条迹象</span><span>{pattern.counterexample_count} 条反例</span></div>
                        {pattern.next_practice ? <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm leading-6 text-indigo-800">下一次练习：{pattern.next_practice}</div> : null}
                      </article>
                    ))}
                  </div>
                ) : <EmptyState title="还没有足够数据发现模式" description="系统至少需要几次跨人物的判断与结果闭环。" />}
              </SurfaceCard>
            </div>

            <SurfaceCard title="判断校准" description="不是追求每次都猜对，而是知道自己的判断在什么情境下容易偏。" icon={<Gauge className="h-5 w-5" />}>
              {judgmentRate === null && data.calibration.length === 0 ? (
                <EmptyState title="还没有校准样本" description="先在决定卡里写下预期信号，再记录真实结果。" />
              ) : (
                <div className="space-y-4">
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, judgmentRate || 0))}%` }} /></div>
                  <p className="text-sm leading-6 text-gray-600">随着独立判断比例上升，AI 应逐步从“替你分析”退到“检查证据、反证和盲点”。</p>
                </div>
              )}
            </SurfaceCard>
          </>
        ) : null}
      </div>
    </div>
  );
}
