import { useEffect, useState } from 'react';
import { wardrobeApi } from './api';
import { occasions, type Outfit, type OutfitInput, type WardrobeItem } from './types';
import { Modal, Select, buttonClass, inputClass, primaryClass } from './components';
function OutfitEditor({ outfit, close, saved }: { outfit: Outfit | null; close: () => void; saved: () => void }) {
  const [draft, setDraft] = useState<OutfitInput>({ name: outfit?.name || '', occasion: outfit?.occasion || 'academic_conference', notes: outfit?.notes || '', item_ids: outfit?.items.map(link => link.item_id) || [] });
  const [items, setItems] = useState<WardrobeItem[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => { const rows = []; for (let page = 1; ; page++) { const data = await wardrobeApi.list({ page: String(page), page_size: '100' }); rows.push(...data.items); if (rows.length >= data.total) break; } if (alive) setItems(rows); })()
      .catch(cause => { if (alive) setError(cause.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  function move(index: number, delta: number) { const ids = [...draft.item_ids]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; setDraft({ ...draft, item_ids: ids }); }
  async function save() { setBusy(true); setError(''); try { await wardrobeApi.saveOutfit(outfit?.id || null, draft); saved(); close(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <Modal title={outfit ? '编辑穿搭组合' : '新建穿搭组合'} close={close} busy={busy}>
    <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || loading} className="space-y-4">
      <label className="block text-sm">搭配名称<input required maxLength={500} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <Select label="场景" values={occasions} value={draft.occasion} onChange={value => setDraft({ ...draft, occasion: value as OutfitInput['occasion'] })} />
      <label className="block text-sm">搭配备注<textarea maxLength={10000} className={inputClass} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
      <p className="text-sm text-gray-500">已选 {draft.item_ids.length} 件，可上下调整展示顺序。</p>
      <ol className="space-y-2">{draft.item_ids.map((id, index) => { const item = items.find(value => value.id === id); return <li key={id} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 text-sm"><span className="min-w-0 flex-1 truncate">{index + 1}. {item?.name || '已删除或失效衣物（请移除）'}{item?.status === 'archived' ? ' · 已归档' : ''}</span><button type="button" className={buttonClass} disabled={index === 0} aria-label={`上移第 ${index + 1} 件`} onClick={() => move(index, -1)}>↑</button><button type="button" className={buttonClass} disabled={index === draft.item_ids.length - 1} aria-label={`下移第 ${index + 1} 件`} onClick={() => move(index, 1)}>↓</button><button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, item_ids: draft.item_ids.filter(v => v !== id) })}>移除</button></li>; })}</ol>
      <label className="block text-sm">查找可选衣物<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索衣物名称" /></label>
      <div className="max-h-72 space-y-2 overflow-y-auto">{items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <label key={item.id} className="flex items-center gap-3 rounded-lg border p-2 text-sm"><input type="checkbox" checked={draft.item_ids.includes(item.id)} onChange={e => setDraft({ ...draft, item_ids: e.target.checked ? [...draft.item_ids, item.id] : draft.item_ids.filter(id => id !== item.id) })} /><img src={item.image_url} alt="" className="h-12 w-12 bg-gray-50 object-contain" /><span>{item.name}{item.status === 'archived' ? ' · 已归档' : ''}</span></label>)}</div>
    </fieldset>
    {loading && <p role="status" className="my-3 text-sm">正在加载衣物…</p>}{error && <p role="alert" className="my-3 text-sm text-red-600">{error}</p>}
    <button className={`${primaryClass} mt-5 w-full`} disabled={busy || loading || draft.item_ids.length === 0 || draft.item_ids.some(id => !items.some(item => item.id === id))}>{busy ? '保存中…' : '保存搭配'}</button></form>
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
