import { parseApiErrorMessage } from '../../services/api';
import { apiFetch as fetch } from '../../services/apiFetch';
import type { BundleItem, ImportReport, ItemList, Outfit, OutfitInput, WardrobeItem } from './types';
export class WardrobeApiError extends Error { constructor(message: string, public report?: ImportReport) { super(message); } }
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/wardrobe${path}`, { credentials: 'same-origin', ...options });
  if (!response.ok) {
    const text = await response.text(); let report: ImportReport | undefined;
    try { const json = JSON.parse(text); if (Array.isArray(json.errors)) report = json; } catch { /* proxy errors are plain text */ }
    throw new WardrobeApiError(parseApiErrorMessage(text, '衣橱请求失败'), report);
  }
  return response.json();
}
const json = (method: string, data: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const wardrobeApi = {
  list: (filters: Record<string, string>) => request<ItemList>(`/items?${new URLSearchParams(filters)}`),
  patch: (id: string, data: Partial<BundleItem>) => request<WardrobeItem>(`/items/${id}`, json('PATCH', data)),
  remove: (id: string) => request(`/items/${id}`, { method: 'DELETE' }),
  create: (data: Partial<BundleItem>, file: File) => { const body = new FormData(); body.append('data', JSON.stringify(data)); body.append('file', file); return request<WardrobeItem>('/items', { method: 'POST', body }); },
  image: (id: string, file: File) => { const body = new FormData(); body.append('file', file); return request<WardrobeItem>(`/items/${id}/image`, { method: 'POST', body }); },
  import: (file: Blob, mode: string) => { const body = new FormData(); body.append('file', file, 'nmdd-wardrobe-v1.zip'); return request<ImportReport>(`/import?mode=${mode}`, { method: 'POST', body }); },
  outfits: () => request<Outfit[]>('/outfits'),
  saveOutfit: (id: string | null, data: OutfitInput) => request(id ? `/outfits/${id}` : '/outfits', json(id ? 'PATCH' : 'POST', data)),
  removeOutfit: (id: string) => request(`/outfits/${id}`, { method: 'DELETE' }),
  export: async () => { const response = await fetch('/api/wardrobe/export', { credentials: 'same-origin' }); if (!response.ok) throw new Error(parseApiErrorMessage(await response.text(), '导出失败')); return response.blob(); },
};
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
