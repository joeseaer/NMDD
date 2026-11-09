import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search, Shirt, ZoomIn } from 'lucide-react';
import { wardrobeApi } from './api';
import { categories, occasions, type Outfit, type OutfitInput, type WardrobeItem } from './types';
import { Modal, Select, buttonClass, inputClass, primaryClass } from './components';
function OutfitEditor({ outfit, close, saved }: { outfit: Outfit | null; close: () => void; saved: () => void }) {
  const [draft, setDraft] = useState<OutfitInput>({ name: outfit?.name || '', occasion: outfit?.occasion || 'academic_conference', notes: outfit?.notes || '', item_ids: outfit?.items.map(link => link.item_id) || [] });
  const [items, setItems] = useState<WardrobeItem[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'gallery' | 'selection'>('gallery');
  const galleryScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { galleryScrollRef.current?.scrollTo({ top: 0 }); }, [category, search]);
  useEffect(() => {
    let alive = true;
    (async () => { const rows = []; for (let page = 1; ; page++) { const data = await wardrobeApi.list({ page: String(page), page_size: '100' }); rows.push(...data.items); if (rows.length >= data.total) break; } if (alive) setItems(rows); })()
      .catch(cause => { if (alive) setError(cause.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  function move(index: number, delta: number) { const ids = [...draft.item_ids]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; setDraft({ ...draft, item_ids: ids }); }
  async function save() { setBusy(true); setError(''); try { await wardrobeApi.saveOutfit(outfit?.id || null, draft); saved(); close(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  const itemsById = new Map(items.map(item => [item.id, item]));
  const visibleItems = items.filter(item => (!category || item.category === category) && item.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Modal title={outfit ? '编辑穿搭组合' : '新建穿搭组合'} layout="workspace" close={close} busy={busy}>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy || loading} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_8rem] gap-3 border-b px-4 py-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:px-6">
          <label className="block min-w-0 text-sm text-gray-600">搭配名称<input required maxLength={500} className={inputClass} value={draft.name} placeholder="为这套搭配起个名字" onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <Select label="场景" values={occasions} value={draft.occasion} onChange={value => setDraft({ ...draft, occasion: value as OutfitInput['occasion'] })} />
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b px-4 py-2 lg:hidden">
          <button type="button" aria-pressed={mobilePanel === 'gallery'} className={`${buttonClass} ${mobilePanel === 'gallery' ? 'border-primary bg-primary/5 text-primary' : ''}`} onClick={() => setMobilePanel('gallery')}>衣物画册</button>
          <button type="button" aria-pressed={mobilePanel === 'selection'} className={`${buttonClass} ${mobilePanel === 'selection' ? 'border-primary bg-primary/5 text-primary' : ''}`} onClick={() => setMobilePanel('selection')}>已选搭配（{draft.item_ids.length}）</button>
        </div>
        <div className="flex min-h-0 flex-1">
          <section aria-label="可选衣物画册" className={`${mobilePanel === 'gallery' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col lg:flex`}>
            <div className="shrink-0 space-y-3 border-b px-4 py-3 sm:px-6">
              <label className="relative block text-sm"><span className="sr-only">查找可选衣物</span><Search size={16} className="pointer-events-none absolute left-3 top-4 text-gray-400" /><input className={`${inputClass} pl-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索衣物名称" /></label>
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label="衣物类别筛选">{Object.entries({ '': '全部', ...categories }).map(([key, label]) => <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${category === key ? 'bg-primary text-white' : 'border text-gray-600 hover:bg-gray-50'}`}>{label}</button>)}</div>
            </div>
            <div ref={galleryScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gray-50/70 p-4 sm:p-6">
              {loading && <p role="status" className="py-8 text-center text-sm text-gray-500">正在加载衣物…</p>}
              {!loading && <>
                <p className="mb-3 text-xs text-gray-500">{visibleItems.length} 件可选衣物 · 勾选图片加入搭配</p>
                <div className="grid grid-cols-2 items-start gap-3 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleItems.map(item => {
                    const selected = draft.item_ids.includes(item.id);
                    return <article key={item.id} className={`min-w-0 overflow-hidden rounded-xl border bg-white transition ${selected ? 'border-primary ring-2 ring-primary/15' : 'border-gray-200 hover:border-blue-300'}`}>
                      <label className="relative block cursor-pointer">
                        <input type="checkbox" aria-label={item.name} checked={selected} disabled={!selected && draft.item_ids.length >= 100} className="absolute left-3 top-3 z-10 h-5 w-5 accent-primary" onChange={e => setDraft(current => ({ ...current, item_ids: e.target.checked ? [...current.item_ids, item.id] : current.item_ids.filter(id => id !== item.id) }))} />
                        <div className="aspect-[4/5] bg-gray-100/60 p-3"><img src={item.image_url} alt={item.name} loading="lazy" className="h-full w-full object-contain" /></div>
                        <div className="px-3 pb-2 pt-3"><h3 className="break-words text-sm font-medium leading-5">{item.name}</h3><p className="mt-1 text-xs text-gray-500">{categories[item.category]} · {item.primary_color}</p>{item.status === 'archived' && <p className="mt-1 text-xs text-amber-700">已归档</p>}</div>
                      </label>
                      <a href={item.image_url} target="_blank" rel="noreferrer" aria-label={`查看${item.name}大图`} className="flex items-center justify-center gap-1.5 border-t px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 hover:text-primary"><ZoomIn size={14} />查看大图</a>
                    </article>;
                  })}
                </div>
                {!visibleItems.length && <div className="py-12 text-center text-sm text-gray-500">{items.length ? '没有符合条件的衣物，试试其他分类或名称。' : '衣橱里还没有可选衣物，请先导入或新增衣物。'}</div>}
              </>}
            </div>
          </section>
          <aside aria-label="已选搭配与备注" className={`${mobilePanel === 'selection' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 sm:p-6 lg:flex lg:w-[340px] lg:flex-none lg:border-l xl:w-[380px]`}>
            <div className="mb-4"><h3 className="font-semibold">已选搭配 · {draft.item_ids.length} 件</h3><p className="mt-1 text-xs leading-5 text-gray-500">按展示顺序排列，可上下调整或移除。</p></div>
            {!draft.item_ids.length && <div className="mb-5 rounded-xl border border-dashed px-4 py-8 text-center"><Shirt size={32} className="mx-auto mb-3 text-gray-300" /><p className="text-sm text-gray-500">在画册中勾选衣物，组成你的搭配。</p></div>}
            <ol className="space-y-3">{draft.item_ids.map((id, index) => {
              const item = itemsById.get(id);
              return <li key={id} className="flex min-w-0 gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-50">{item ? <img src={item.image_url} alt="" className="h-full w-full object-contain" /> : <Shirt size={24} className="text-gray-300" />}</div>
                <div className="min-w-0 flex-1"><p className="break-words font-medium leading-5">{index + 1}. {item?.name || (loading ? '正在加载衣物…' : '已删除或失效衣物（请移除）')}</p>{item?.status === 'archived' && <p className="mt-1 text-xs text-amber-700">已归档</p>}
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={index === 0} aria-label={`上移第 ${index + 1} 件`} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" className={buttonClass} disabled={index === draft.item_ids.length - 1} aria-label={`下移第 ${index + 1} 件`} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button type="button" className="text-xs text-gray-500 hover:text-red-600" onClick={() => setDraft(current => ({ ...current, item_ids: current.item_ids.filter(value => value !== id) }))}>移除</button></div>
                </div>
              </li>;
            })}</ol>
            <label className="mt-5 block text-sm text-gray-600">搭配备注<textarea maxLength={10000} rows={3} className={inputClass} value={draft.notes} placeholder="记录这套搭配的想法或使用场合" onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
          </aside>
        </div>
      </fieldset>
      {error && <p role="alert" className="max-h-24 shrink-0 overflow-y-auto border-t px-4 py-2 text-sm text-red-600 sm:px-6">{error}</p>}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <p className="text-sm text-gray-500">已选 <span className="font-semibold text-gray-900">{draft.item_ids.length}</span> / 100 件</p>
        <button className={primaryClass} disabled={busy || loading || draft.item_ids.length === 0 || draft.item_ids.some(id => !itemsById.has(id))}>{busy ? '保存中…' : '保存搭配'}</button>
      </footer>
    </form>
  </Modal>;
}
export default function OutfitsPanel() {
  const [outfits, setOutfits] = useState<Outfit[]>([]), [editor, setEditor] = useState<Outfit | null | undefined>(), [error, setError] = useState(''), [loading, setLoading] = useState(true), [deleting, setDeleting] = useState<string | null>(null);
  async function load() { setLoading(true); setError(''); try { setOutfits(await wardrobeApi.outfits()); } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function remove(id: string) { try { await wardrobeApi.removeOutfit(id); setDeleting(null); await load(); } catch (cause) { setError((cause as Error).message); } }
  return <section className="space-y-4"><div className="flex items-center justify-between"><p className="text-sm text-gray-500">按场景保存搭配，自行选择衣物与展示顺序。</p><button className={primaryClass} onClick={() => setEditor(null)}>新建搭配</button></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}{loading && <p role="status">正在加载搭配…</p>}
    {!loading && !outfits.length && <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-gray-500">还没有穿搭组合。新建一个学术会议、商务社交或日常搭配吧。</div>}
    <div className="grid gap-4 lg:grid-cols-2">{outfits.map(outfit => <article key={outfit.id} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{outfit.name}</h3><p className="text-sm text-gray-500">{occasions[outfit.occasion]}</p></div><button className={buttonClass} onClick={() => setEditor(outfit)}>编辑搭配</button></div>
      <div className="my-4 flex gap-3 overflow-x-auto">{outfit.items.map(link => <div key={link.item_id} className="w-28 shrink-0 text-xs"><div className="flex h-28 items-center justify-center rounded-lg bg-gray-50">{link.item && !link.item.deleted_at ? <img src={link.item.image_url} alt={link.item.name} className="h-full w-full object-contain" /> : <span className="text-red-500">已删除 / 失效</span>}</div><p className="mt-2">{link.item?.name || '失效衣物'}</p>{link.item?.status === 'archived' && <span className="text-amber-700">已归档</span>}</div>)}</div>
      {outfit.notes && <p className="mb-3 whitespace-pre-wrap text-sm text-gray-500">{outfit.notes}</p>}
      {deleting === outfit.id ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>确认删除此搭配？</span><button className={buttonClass} onClick={() => remove(outfit.id)}>确认删除搭配</button><button className={buttonClass} onClick={() => setDeleting(null)}>取消</button></div> : <button className="text-sm text-gray-500 hover:text-red-600" onClick={() => setDeleting(outfit.id)}>删除搭配</button>}
    </article>)}</div>
    {editor !== undefined && <OutfitEditor outfit={editor} close={() => setEditor(undefined)} saved={() => void load()} />}
  </section>;
}
