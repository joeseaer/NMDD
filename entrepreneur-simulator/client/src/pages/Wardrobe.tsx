import { useEffect, useRef, useState } from 'react';
import { Archive, Download, Plus, Search, Shirt, Upload } from 'lucide-react';
import { wardrobeApi, download } from '../features/wardrobe/api';
import { limits, parseBundle, type Bundle } from '../features/wardrobe/bundle';
import { categories, colors, occasions, seasons, type ItemList, type WardrobeItem } from '../features/wardrobe/types';
import { buttonClass, inputClass, primaryClass } from '../features/wardrobe/components';
import ImportPanel from '../features/wardrobe/ImportPanel';
import ItemEditor from '../features/wardrobe/ItemEditor';
import OutfitsPanel from '../features/wardrobe/OutfitsPanel';
import InspirationsPanel from '../features/wardrobe/inspirations/InspirationsPanel';
export default function Wardrobe() {
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).has('inspiration') ? 'inspirations' : 'items'), [filters, setFilters] = useState<Record<string, string>>({}), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [data, setData] = useState<ItemList | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null), [editor, setEditor] = useState<WardrobeItem | null | undefined>();
  const zipInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search), id = query.get('item');
    if (!id || query.has('inspiration')) return;
    let alive = true;
    wardrobeApi.get(id).then(item => { if (alive) setEditor(item); }).catch(cause => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, []);
  const closeItem = () => { setEditor(undefined); const url = new URL(window.location.href); url.searchParams.delete('item'); window.history.replaceState(null, '', url); };
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    const timer = setTimeout(() => wardrobeApi.list({ ...filters, page: String(page) }).then(result => { if (alive) { setData(result); if (!result.items.length && page > 1) setPage(1); } }).catch(cause => { if (alive) setError(cause.message); }).finally(() => { if (alive) setLoading(false); }), 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [filters, page, revision]);
  const refresh = () => setRevision(value => value + 1);
  const filter = (key: string, value: string) => { setFilters(current => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next; }); setPage(1); };
  async function selectZip(file: File) { setBusy(true); setError(''); try { if (file.size > limits.zip) throw new Error('ZIP 不能超过 60MB'); setBundle(await parseBundle(new Uint8Array(await file.arrayBuffer()))); } catch (cause) { setError(`导入预览失败：${(cause as Error).message}`); } finally { setBusy(false); if (zipInput.current) zipInput.current.value = ''; } }
  async function exportAll() { setBusy(true); setError(''); try { download(await wardrobeApi.export(), 'nmdd-wardrobe-v1.zip'); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <div className="space-y-6 pb-20">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-sm text-gray-500"><Shirt size={18} />个人中心</div><h1 className="text-2xl font-bold">我的衣橱</h1><p className="mt-2 text-sm text-gray-500">把衣物收进画册，让每一次搭配都有迹可循。</p></div>
      <div className="flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={exportAll}><Download size={16} />导出全部 ZIP</button><button className={buttonClass} disabled={busy} onClick={() => setEditor(null)}><Plus size={16} />新增衣物</button><button className={primaryClass} disabled={busy} onClick={() => zipInput.current?.click()}><Upload size={16} />{busy ? '处理中…' : '批量导入'}</button></div>
      <input ref={zipInput} type="file" accept=".zip,application/zip" aria-label="选择衣橱 ZIP" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void selectZip(file); }} />
    </header>
    <div className="grid grid-cols-3 gap-3">{[[data?.stats.total ?? '—', '衣物总件数'], [data?.stats.categories ?? '—', '衣物分类'], [data?.stats.needs_review ?? '—', '待确认']].map(([value, label]) => <div key={label} className="rounded-xl border border-gray-100 bg-white p-4"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-gray-500 sm:text-sm">{label}</p></div>)}</div>
    <div className="flex gap-5 border-b">{[['items', '我的衣橱'], ['outfits', '穿搭组合'], ['inspirations', '穿搭灵感']].map(([value, label]) => <button key={value} className={`pb-3 text-sm ${tab === value ? 'border-b-2 border-primary font-semibold text-primary' : 'text-gray-500'}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} onClick={refresh}>重新加载</button><button className={buttonClass} onClick={() => download(new Blob([JSON.stringify({ error }, null, 2)], { type: 'application/json' }), 'wardrobe-error.json')}>下载错误信息</button></div></div>}
    {tab === 'items' ? <>
      <div className="flex flex-wrap gap-2">{Object.entries({ '': '全部', ...categories }).map(([key, label]) => <button key={key} onClick={() => filter('category', key)} className={`rounded-full px-4 py-2 text-sm ${(!filters.category ? key === '' : filters.category === key) ? 'bg-primary text-white' : 'border bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"><label className="relative col-span-2 text-sm sm:col-span-3 lg:col-span-2"><span className="sr-only">搜索衣物</span><Search className="absolute left-3 top-4 text-gray-400" size={16} /><input className={`${inputClass} pl-9`} placeholder="按名称搜索衣物" value={filters.search || ''} onChange={e => filter('search', e.target.value)} /></label>
        {Object.entries({ color_family: { label: '全部颜色', values: colors }, season: { label: '全部季节', values: seasons }, occasion: { label: '全部场景', values: occasions }, status: { label: '全部状态', values: { active: '使用中', archived: '已归档' } } }).map(([key, { label, values }]) => <select key={key} aria-label={label} className={inputClass} value={filters[key] || ''} onChange={e => filter(key, e.target.value)}><option value="">{label}</option>{Object.entries(values).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>)}
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500"><label className="flex items-center gap-2"><input type="checkbox" checked={filters.needs_review === 'true'} onChange={e => filter('needs_review', e.target.checked ? 'true' : '')} />仅看待确认</label><button onClick={() => { setFilters({}); setPage(1); }} className="hover:text-primary">清除筛选</button></div>
      {loading && <p role="status" className="py-8 text-center text-gray-500">正在加载衣橱…</p>}
      {!loading && data && !data.items.length && <div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center"><Shirt className="mx-auto mb-4 text-gray-300" size={42} /><h2 className="font-semibold">{data.stats.total ? '没有符合筛选条件的衣物' : '衣橱正在等待第一件衣物'}</h2><p className="my-3 text-sm text-gray-500">将 ChatGPT 整理的 v1 ZIP 导入，或手工上传衣物照片。</p><button className={primaryClass} disabled={busy} onClick={() => zipInput.current?.click()}>导入衣物</button></div>}
      {!loading && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{data?.items.map(item => <button key={item.id} className="group overflow-hidden rounded-2xl border border-gray-100 bg-white text-left transition hover:border-blue-200 hover:shadow-md" onClick={() => setEditor(item)}><div className="relative aspect-square bg-gray-100/60 p-3"><img src={item.image_url} alt={item.name} loading="lazy" className="h-full w-full object-contain" />{item.needs_review && <span className="absolute left-2 top-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">待确认</span>}{item.status === 'archived' && <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-xs text-gray-500"><Archive size={12} />已归档</span>}</div><div className="p-3"><h3 className="truncate text-sm font-medium">{item.name}</h3><p className="mt-1 truncate text-xs text-gray-500">{categories[item.category]} · {item.primary_color}</p></div></button>)}</div>}
      {data && data.total > data.page_size && <div className="flex items-center justify-center gap-4 text-sm"><button className={buttonClass} disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.ceil(data.total / data.page_size)} · {data.total} 件</span><button className={buttonClass} disabled={page * data.page_size >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
    </> : tab === 'outfits' ? <OutfitsPanel key={revision} /> : <InspirationsPanel />}
    {bundle && <ImportPanel initial={bundle} close={() => setBundle(null)} imported={refresh} />}
    {editor !== undefined && <ItemEditor item={editor} close={closeItem} saved={refresh} />}
  </div>;
}
