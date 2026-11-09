import { useEffect, useMemo, useState } from 'react';
import { wardrobeApi } from './api';
import { imageMime, limits, validateItems } from './bundle';
import type { BundleItem, WardrobeItem } from './types';
import { Modal, CommonFields, DetailFields, buttonClass, primaryClass } from './components';
export default function ItemEditor({ item, close, saved }: { item: WardrobeItem | null; close: () => void; saved: () => void }) {
  const [draft, setDraft] = useState<Partial<BundleItem>>(item || { name: '', category: 'tops', primary_color: '', status: 'active', needs_review: false });
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const url = useMemo(() => file ? URL.createObjectURL(file) : item?.image_url, [file, item]);
  useEffect(() => () => { if (file && url) URL.revokeObjectURL(url); }, [file, url]);
  const change = (patch: Partial<BundleItem>) => setDraft(value => ({ ...value, ...patch }));
  async function save() {
    setBusy(true); setError('');
    try {
      validateItems([{ ...draft, external_id: item?.external_id || 'manual_preview', image_path: 'images/preview.png' }]);
      if (file) { if (file.size > limits.image) throw new Error('单张图片不能超过 8MB'); imageMime(new Uint8Array(await file.arrayBuffer()), file.name); }
      if (item) {
        // Send only changed fields, so untouched AI values remain eligible for explicit re-import updates.
        const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) => !['external_id','image_path','image_sha256','id','image_url','updated_at','created_at','deleted_at'].includes(key) && JSON.stringify(value) !== JSON.stringify(item[key as keyof WardrobeItem])));
        if (Object.keys(patch).length) await wardrobeApi.patch(item.id, patch);
        if (file) await wardrobeApi.image(item.id, file);
      } else { if (!file) throw new Error('请上传衣物照片'); await wardrobeApi.create(draft, file); }
      saved(); close();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function remove() { setBusy(true); try { await wardrobeApi.remove(item!.id); saved(); close(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  return <Modal title={item ? '衣物详情与编辑' : '手工新增衣物'} close={close} busy={busy}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
      {url && <img src={url} alt={draft.name || '衣物照片'} className="mb-4 h-56 w-full rounded-xl bg-gray-50 object-contain" />}
      <label className="mb-5 block text-sm text-gray-600">{item ? '更换照片' : '衣物照片（必选）'}<input type="file" accept="image/jpeg,image/png,image/webp" className={`${buttonClass} mt-2 w-full`} onChange={e => { const next = e.target.files?.[0]; if (next && next.size > limits.image) { setError('单张图片不能超过 8MB'); e.target.value = ''; } else { setError(''); setFile(next || null); } }} /></label>
      <CommonFields item={draft} change={change} /><DetailFields item={draft} change={change} />
      {item && <p className="mt-4 break-all text-xs text-gray-400">稳定编号：{item.external_id}</p>}
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    <div className="sticky bottom-0 mt-5 flex flex-wrap justify-between gap-2 border-t bg-white py-4">
      {item && <button type="button" disabled={busy} className={buttonClass} onClick={() => { setConfirmDelete(true); }}>删除衣物</button>}
      <button disabled={busy} className={`${primaryClass} ml-auto`}>{busy ? '保存中…' : '保存衣物'}</button>
    </div></form>
    {confirmDelete && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm"><p>确认删除这件衣物？搭配中会保留失效提示，照片与数据仍受全量备份保护。</p><div className="mt-3 flex gap-2"><button disabled={busy} className={buttonClass} onClick={() => setConfirmDelete(false)}>取消</button><button disabled={busy} className={buttonClass} onClick={remove}>确认删除</button></div></div>}
  </Modal>;
}
