import { useEffect, useMemo, useState } from 'react';
import { wardrobeApi, download, WardrobeApiError } from './api';
import { rebuildBundle, imageMime, type Bundle } from './bundle';
import { type ImportReport } from './types';
import { Modal, CommonFields, buttonClass, primaryClass } from './components';
export default function ImportPanel({ initial, close, imported }: { initial: Bundle; close: () => void; imported: () => void }) {
  const [bundle, setBundle] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [mode, setMode] = useState('skip_existing'), [report, setReport] = useState<ImportReport | null>(null);
  const urls = useMemo(() => Object.fromEntries(initial.items.map(item => [item.image_path, URL.createObjectURL(new Blob([new Uint8Array(initial.files[item.image_path])], { type: imageMime(initial.files[item.image_path], item.image_path) }))])), [initial]);
  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), [urls]);
  async function submit() {
    setBusy(true); setError(''); setReport(null);
    try { const result = await wardrobeApi.import(await rebuildBundle(bundle), mode); setReport(result); imported(); }
    catch (cause) { setError((cause as Error).message); if (cause instanceof WardrobeApiError && cause.report) setReport(cause.report); }
    finally { setBusy(false); }
  }
  return <Modal title="批量导入预览" wide close={close} busy={busy}>
    <p className="mb-4 text-sm text-gray-500">共 {bundle.items.length} 件。先核对名称、类别和颜色，确认后保存到衣橱。每批最多 100 件、ZIP 60MB、单图 8MB。</p>
    {bundle.warnings.length > 0 && <details className="mb-4 text-sm text-amber-700"><summary>额外字段提示（{bundle.warnings.length}）</summary>{bundle.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
    <fieldset disabled={busy || !!report && !report.failed} className="space-y-4 disabled:opacity-70">
      {bundle.items.map((item, index) => <div key={item.external_id} className="rounded-xl border border-gray-200 p-3 sm:flex sm:gap-4">
        <img src={urls[item.image_path]} alt={item.name} className="mb-3 h-36 w-full rounded-lg bg-gray-50 object-contain sm:mb-0 sm:w-32" />
        <div className="flex-1"><p className="mb-2 break-all text-xs text-gray-400">{item.external_id}{item.needs_review ? ' · 待核验' : ''}</p><CommonFields item={item} prefix={`${index + 1}. `} change={patch => setBundle(current => ({ ...current, items: current.items.map((value, i) => i === index ? { ...value, ...patch } : value) }))} /></div>
      </div>)}
      <div className="rounded-xl bg-gray-50 p-4 text-sm"><label className="block"><input type="radio" name="import-mode" checked={mode === 'skip_existing'} onChange={() => setMode('skip_existing')} /> 跳过已存在（默认）</label><label className="mt-2 block"><input type="radio" name="import-mode" checked={mode === 'update_imported'} onChange={() => setMode('update_imported')} /> 更新 AI 导入字段（保留手工编辑字段）</label></div>
    </fieldset>
    {error && <p role="alert" className="my-4 text-sm text-red-600">{error}</p>}
    {report && <div role="status" className="my-4 rounded-xl bg-blue-50 p-4 text-sm"><p>新增 {report.created} · 跳过 {report.skipped} · 更新 {report.updated} · 错误 {report.failed}</p>{report.errors.map((e, i) => <p key={i} className="mt-2 text-red-600">{e.external_id || (e.index == null ? '' : `第 ${e.index + 1} 件`)}：{e.message}</p>)}<button className={`${buttonClass} mt-3`} onClick={() => download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'wardrobe-import-report.json')}>下载结果与错误报告</button></div>}
    <div className="sticky bottom-0 mt-5 flex justify-end gap-3 border-t bg-white py-4"><button className={buttonClass} disabled={busy} onClick={close}>关闭</button><button className={primaryClass} disabled={busy || !!report && report.failed === 0 || bundle.items.length === 0} onClick={submit}>{busy ? '正在校验并导入…' : '确认导入'}</button></div>
  </Modal>;
}
