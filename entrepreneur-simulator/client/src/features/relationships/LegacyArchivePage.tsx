import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, History, Lock, Search } from 'lucide-react';
import { useState } from 'react';
import type { LegacyPerson } from './model';
import { relationshipApi } from './relationshipApi';
import { useRelationshipResource } from './useRelationshipResource';
import { EmptyState, ErrorState, ListArrow, LoadingState, PageHeader, SurfaceCard, TextInput, cn, formatDate } from './RelationshipUi';

const formatLegacyPrivateInfo = (value?: string | null) => {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return value;
  }
};

function LegacyDetail({ person, onBack }: { person: LegacyPerson; onBack: () => void }) {
  const interactions = useRelationshipResource(`legacy-interactions:${person.id}`, (signal) => relationshipApi.getLegacyInteractions(person.id, signal));
  const privateInfo = formatLegacyPrivateInfo(person.private_info);
  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50">
      <div className="sticky top-0 z-20 flex items-start gap-3 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <button type="button" onClick={onBack} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden" aria-label="返回旧档案列表"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-200 font-semibold text-gray-700">{(person.name || '?').slice(0, 1)}</div>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-bold text-gray-950">{person.name || '未命名'}</h1><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">历史只读</span></div><p className="mt-1 text-sm text-gray-500">{person.identity || person.field || '未设置身份'}</p></div>
      </div>
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          这里仅用于核对迁移前资料，不会生成 AI 内容、自动保存、修改或删除任何旧数据。
        </div>
        <SurfaceCard title="旧版基本资料" icon={<Archive className="h-5 w-5" />}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-3"><dt className="text-xs text-gray-500">身份/领域</dt><dd className="mt-1 text-sm text-gray-900">{[person.identity, person.field].filter(Boolean).join(' · ') || '未记录'}</dd></div>
            <div className="rounded-xl border border-gray-200 p-3"><dt className="text-xs text-gray-500">旧关系强度</dt><dd className="mt-1 text-sm text-gray-900">{typeof person.relationship_strength === 'number' ? `${person.relationship_strength}%（仅作历史参考）` : '未记录'}</dd></div>
            <div className="rounded-xl border border-gray-200 p-3"><dt className="text-xs text-gray-500">旧人格标签</dt><dd className="mt-1 text-sm text-gray-900">{[person.disc_type, person.mbti_type].filter(Boolean).join(' · ') || '未记录'}</dd></div>
            <div className="rounded-xl border border-gray-200 p-3"><dt className="text-xs text-gray-500">最后更新</dt><dd className="mt-1 text-sm text-gray-900">{formatDate(person.updated_at, true)}</dd></div>
          </dl>
          {person.tags?.length ? <div className="mt-4 flex flex-wrap gap-2">{person.tags.map((tag) => <span key={tag} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">#{tag}</span>)}</div> : null}
          {person.notes ? <div className="mt-4 whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700">{person.notes}</div> : null}
        </SurfaceCard>
        <SurfaceCard title="旧版互动记录" icon={<History className="h-5 w-5" />}>
          {interactions.loading ? <LoadingState label="正在读取历史互动…" /> : null}
          {interactions.error ? <ErrorState message={interactions.error} onRetry={interactions.reload} /> : null}
          {interactions.data?.length ? <div className="space-y-3">{interactions.data.map((item) => <article key={item.id} className="rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500">{formatDate(item.occurred_at, true)}{item.context ? ` · ${item.context}` : ''}</div>{item.my_action ? <p className="mt-2 text-sm leading-6 text-gray-700"><span className="font-medium">我：</span>{item.my_action}</p> : null}{item.their_reaction ? <p className="mt-1 text-sm leading-6 text-gray-700"><span className="font-medium">对方：</span>{item.their_reaction}</p> : null}</article>)}</div> : !interactions.loading ? <p className="text-sm text-gray-500">没有历史互动。</p> : null}
        </SurfaceCard>
        {privateInfo ? (
          <SurfaceCard title="旧版完整扩展字段" description="原样只读展示，方便核对迁移是否遗漏。" icon={<Lock className="h-5 w-5" />}>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-gray-700">展开原始资料</summary>
              <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-950 p-4 text-xs leading-5 text-gray-100">{privateInfo}</pre>
            </details>
          </SurfaceCard>
        ) : null}
      </div>
    </main>
  );
}

export default function LegacyArchivePage() {
  const navigate = useNavigate();
  const { legacyPersonId } = useParams<{ legacyPersonId?: string }>();
  const people = useRelationshipResource('legacy-people', relationshipApi.getLegacyPeople);
  const [search, setSearch] = useState('');
  const visible = (people.data || []).filter((person) => !search.trim() || `${person.name || ''} ${person.identity || ''} ${(person.tags || []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = (people.data || []).find((person) => person.id === legacyPersonId) || null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
      {!legacyPersonId ? <PageHeader eyebrow="人物" title="旧档案（只读）" description="保留迁移前投入的全部资料；新版不会在这里写入任何内容。" /> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden border-t border-gray-200 bg-white">
        <aside className={cn('w-full shrink-0 border-r border-gray-200 bg-white lg:flex lg:w-80 lg:flex-col', legacyPersonId ? 'hidden' : 'flex flex-col')}>
          <div className="border-b border-gray-200 p-4"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索旧档案" className="pl-9" /></div></div>
          <div className="flex-1 overflow-y-auto p-2">
            {people.loading ? <LoadingState label="正在读取旧档案…" /> : null}
            {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> : null}
            {!people.loading && !visible.length ? <EmptyState title="没有旧档案" description="备份仍保存在本地；这里只显示旧人物表中的内容。" /> : null}
            <div className="space-y-1">{visible.map((person) => <button key={person.id} type="button" onClick={() => navigate(`/relationships/legacy/${encodeURIComponent(person.id)}`)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-3 text-left hover:border-gray-200 hover:bg-gray-50"><div className="min-w-0"><div className="truncate font-medium text-gray-950">{person.name || '未命名'}</div><div className="mt-1 truncate text-xs text-gray-500">{person.identity || person.field || '未设置身份'}</div></div><ListArrow /></button>)}</div>
          </div>
        </aside>
        {selected ? <LegacyDetail person={selected} onBack={() => navigate('/relationships/legacy')} /> : legacyPersonId && people.loading ? <main className="min-w-0 flex-1"><LoadingState /></main> : <main className="hidden min-w-0 flex-1 items-center justify-center bg-gray-50 lg:flex"><EmptyState title="选择一份旧档案" description="旧资料只读展示，不触发 AI、自动保存或删除。" /></main>}
      </div>
    </div>
  );
}
