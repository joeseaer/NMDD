import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { categories, colors, fits, patterns, seasons, occasions, type BundleItem } from './types';
export const inputClass = 'mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
export const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-wait';
export const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-wait';
export function Modal({ title, close, busy = false, children, wide = false }: { title: string; close: () => void; busy?: boolean; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`h-full w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} overflow-y-auto bg-white p-4 shadow-xl sm:p-6`} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) close();
      if (event.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{title}</h2><button disabled={busy} className={buttonClass} onClick={close} aria-label="关闭"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
export function Select({ label, value, values, onChange, optional = false }: { label: string; value: string; values: Record<string, string>; onChange: (value: string) => void; optional?: boolean }) {
  return <label className="block text-sm text-gray-600">{label}<select aria-label={label} className={inputClass} value={value} onChange={event => onChange(event.target.value)}>{optional && <option value="">未填写</option>}{Object.entries(values).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
export function CommonFields({ item, change, prefix = '' }: { item: Partial<BundleItem>; change: (patch: Partial<BundleItem>) => void; prefix?: string }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label className="text-sm text-gray-600">{prefix}名称<input required maxLength={500} className={inputClass} value={item.name || ''} onChange={e => change({ name: e.target.value })} /></label>
    <Select label={`${prefix}类别`} value={item.category || 'other'} values={categories} onChange={value => change({ category: value as BundleItem['category'] })} />
    <label className="text-sm text-gray-600">{prefix}颜色<input required maxLength={500} className={inputClass} value={item.primary_color || ''} onChange={e => change({ primary_color: e.target.value })} /></label>
    <Select label={`${prefix}颜色族`} optional value={item.color_family || ''} values={colors} onChange={value => change({ color_family: (value || null) as BundleItem['color_family'] })} />
  </div>;
}
export function DetailFields({ item, change }: { item: Partial<BundleItem>; change: (patch: Partial<BundleItem>) => void }) {
  return <div className="mt-3 space-y-4">
    <div className="grid grid-cols-2 gap-3">{(['subcategory', 'brand', 'size', 'material'] as const).map((key, i) => <label key={key} className="text-sm text-gray-600">{['子类别', '品牌', '尺码', '材质'][i]}<input maxLength={500} className={inputClass} value={item[key] || ''} placeholder="未核实可留空" onChange={e => change({ [key]: e.target.value || null })} /></label>)}
      <Select label="版型" optional value={item.fit || ''} values={fits} onChange={value => change({ fit: (value || null) as BundleItem['fit'] })} />
      <Select label="图案" optional value={item.pattern || ''} values={patterns} onChange={value => change({ pattern: (value || null) as BundleItem['pattern'] })} />
      <Select label="正式程度" optional value={item.formality?.toString() || ''} values={{ '1': '1 · 非常休闲', '2': '2 · 休闲', '3': '3 · 中等', '4': '4 · 正式', '5': '5 · 高度正式' }} onChange={value => change({ formality: value ? Number(value) : null })} />
      <Select label="状态" value={item.status || 'active'} values={{ active: '使用中', archived: '已归档' }} onChange={value => change({ status: value as BundleItem['status'] })} />
    </div>
    {(['seasons', 'occasions'] as const).map(key => <fieldset key={key}><legend className="mb-2 text-sm text-gray-600">{key === 'seasons' ? '季节' : '适用场景'}</legend><div className="flex flex-wrap gap-3">{Object.entries(key === 'seasons' ? seasons : occasions).map(([value, label]) => <label key={value} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={(item[key] as string[] | undefined)?.includes(value) || false} onChange={e => {
      const current = item[key] || []; change({ [key]: e.target.checked ? [...current, value] : current.filter(v => v !== value) });
    }} />{label}</label>)}</div></fieldset>)}
    <label className="block text-sm text-gray-600">风格标签（用逗号分隔）<input className={inputClass} value={(item.style_tags || []).join(',')} onChange={e => change({ style_tags: e.target.value.split(/[,，]/).filter(Boolean) })} /></label>
    <label className="block text-sm text-gray-600">备注<textarea maxLength={10000} rows={3} className={inputClass} value={item.notes || ''} onChange={e => change({ notes: e.target.value || null })} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.needs_review || false} onChange={e => change({ needs_review: e.target.checked })} />识别信息待核验</label>
  </div>;
}
