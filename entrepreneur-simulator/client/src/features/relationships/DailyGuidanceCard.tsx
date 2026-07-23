import { ArrowRight, Bot, ListTodo, Loader2, RefreshCw } from 'lucide-react';
import type { DailyGuidance, PlannerTaskSummary } from './model';
import { SecondaryButton, SurfaceCard, cn, formatDate } from './RelationshipUi';

export function DailyGuidanceCard({
  guidance,
  generating,
  error,
  plannerAvailable,
  tasks,
  onGenerate,
  onOpenPlanner,
}: {
  guidance: DailyGuidance | null;
  generating: boolean;
  error: string | null;
  plannerAvailable: boolean;
  tasks: PlannerTaskSummary[];
  onGenerate: (refresh: boolean) => void | Promise<void>;
  onOpenPlanner: () => void;
}) {
  const dataSources = guidance?.data_sources || [];
  const includedSources = dataSources.filter((source) => source.status !== 'unavailable');
  const unavailableSources = dataSources.filter((source) => source.status === 'unavailable');
  const sourceCount = includedSources.reduce((total, source) => total + (typeof source.count === 'number' ? source.count : 1), 0);

  return (
    <SurfaceCard
      title="今日判断"
      description="AI 综合当前资料；具体执行仍回到首页待办。"
      icon={<Bot className="h-5 w-5" />}
      action={(
        <SecondaryButton type="button" onClick={() => void onGenerate(true)} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {guidance ? '刷新' : '生成'}
        </SecondaryButton>
      )}
    >
      {guidance ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className={cn('rounded-full px-2 py-1 font-medium', guidance.fallback ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
              {guidance.fallback ? '基础建议' : 'AI 已生成'}
            </span>
            {guidance.generated_at ? <span>生成于 {formatDate(guidance.generated_at, true)}</span> : null}
            {sourceCount ? <span>· 参考 {sourceCount} 条信息</span> : null}
          </div>

          {guidance.warning ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{guidance.warning}</div> : null}

          <div className="mt-4 rounded-xl bg-indigo-50 px-4 py-4">
            <div className="text-xs font-semibold text-indigo-600">今天唯一主线</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-indigo-950">{guidance.focus}</p>
          </div>
          <div className="mt-4 space-y-3 text-sm leading-6">
            <div><span className="font-semibold text-gray-950">为什么：</span><span className="text-gray-600">{guidance.why}</span></div>
            <div><span className="font-semibold text-gray-950">今天不要做：</span><span className="text-gray-600">{guidance.avoid}</span></div>
            <div><span className="font-semibold text-gray-950">需要观察：</span><span className="text-gray-600">{guidance.observe}</span></div>
          </div>

          {dataSources.length ? (
            <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">本次读取的数据范围</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {dataSources.map((source, index) => (
                  <span key={`${source.domain}-${source.id || index}`} className={cn('rounded-full px-2.5 py-1 text-xs', source.status === 'unavailable' ? 'bg-red-50 text-red-700' : source.status === 'empty' ? 'bg-gray-200 text-gray-500' : source.status === 'truncated' ? 'bg-amber-100 text-amber-800' : 'bg-white text-gray-700')}>
                    {source.label}{typeof source.count === 'number' ? ` ${source.count}` : ''}{source.status === 'unavailable' ? ' · 未纳入' : source.status === 'truncated' ? ' · 部分读取' : ''}
                  </span>
                ))}
              </div>
              {unavailableSources.length ? <p className="mt-2 text-xs leading-5 text-red-600">有 {unavailableSources.length} 类资料本次未能读取，建议修复后重新生成。</p> : null}
            </details>
          ) : null}

          {guidance.sources.length ? (
            <details className="mt-2 rounded-lg border border-gray-200 px-3 py-2.5">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">直接依据</summary>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-gray-600">
                {guidance.sources.map((source, index) => <li key={`${source.domain}-${source.id || index}`}>· {source.label}</li>)}
              </ul>
            </details>
          ) : null}
        </>
      ) : generating ? (
        <div className="flex min-h-44 flex-col items-center justify-center rounded-xl bg-indigo-50 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-medium text-indigo-950">正在读取目标、人物、互动、项目与复盘资料…</p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-7 text-center">
          <p className="text-sm text-gray-600">今天还没有生成判断。</p>
          <button type="button" onClick={() => void onGenerate(false)} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-700">现在生成</button>
        </div>
      )}

      {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error} {guidance ? '已保留上一次判断。' : ''}</div> : null}

      <div className="mt-5 border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-950"><ListTodo className="h-4 w-4" /> 来自首页的今日待办</div>
          <span className="text-xs text-gray-400">只读</span>
        </div>
        {!plannerAvailable ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">暂时无法读取首页待办，但不影响查看今日判断。</p>
        ) : tasks.length ? (
          <div className="mt-3 space-y-2">
            {tasks.slice(0, 3).map((task) => (
              <div key={task.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-sm leading-5 text-gray-800">{task.title}</div>
                {task.due_at ? <div className="mt-1 text-xs text-gray-400">{formatDate(task.due_at, true)}</div> : null}
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-xs leading-5 text-gray-500">首页今天没有未完成待办。这里不会替你创建第二套任务。</p>}
        <SecondaryButton className="mt-4 w-full justify-center" type="button" onClick={onOpenPlanner}>前往首页执行或调整 <ArrowRight className="h-4 w-4" /></SecondaryButton>
      </div>
    </SurfaceCard>
  );
}
