import { Unzip, UnzipInflate, zip, strToU8 } from 'fflate';
import { categories, colors, fits, patterns, seasons, occasions, type BundleItem } from './types';
export const limits = { zip: 60 * 1024 ** 2, image: 8 * 1024 ** 2, expanded: 150 * 1024 ** 2, json: 2 * 1024 ** 2, items: 100 };
export type Bundle = { manifest: Record<string, unknown>; items: BundleItem[]; files: Record<string, Uint8Array>; warnings: string[] };
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
function crc32(bytes: Uint8Array) { let value = 0xffffffff; for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]; return (value ^ 0xffffffff) >>> 0; }
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
export function safePath(path: string) { return path.length <= 240 && !/[\\\x00-\x1f:]/.test(path) && !path.startsWith('/') && path.split('/').every(s => s && s !== '.' && s !== '..'); }
export function validateItems(raw: unknown): BundleItem[] {
  assert(Array.isArray(raw) && raw.length <= limits.items, '每批最多 100 件衣物');
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const prefix = `第 ${index + 1} 件：`;
    assert(item && typeof item === 'object' && !Array.isArray(item), prefix + '记录必须为对象');
    for (const key of ['external_id', 'name', 'primary_color']) assert(typeof item[key] === 'string' && item[key].trim() && item[key].length <= 500, prefix + `${key} 必填且不超过 500 字`);
    assert(!seen.has(item.external_id), prefix + 'external_id 重复'); seen.add(item.external_id);
    const enums: Record<string, object> = { category: categories, color_family: colors, fit: fits, pattern: patterns, status: { active: '', archived: '' } };
    for (const [key, values] of Object.entries(enums)) assert((item[key] == null && key !== 'category') || (typeof item[key] === 'string' && Object.prototype.hasOwnProperty.call(values, item[key])), prefix + `${key} 无效`);
    for (const [key, values] of Object.entries({ seasons, occasions, style_tags: null })) assert(item[key] == null || (Array.isArray(item[key]) && item[key].length <= 40 && item[key].every((v: unknown) => typeof v === 'string' && v.length <= 100 && (!values || Object.prototype.hasOwnProperty.call(values, v)))), prefix + `${key} 无效`);
    for (const key of ['subcategory', 'brand', 'size', 'material', 'notes']) assert(item[key] == null || (typeof item[key] === 'string' && item[key].length <= (key === 'notes' ? 10000 : 500)), prefix + `${key} 文本无效`);
    assert(item.formality == null || (Number.isInteger(item.formality) && item.formality >= 1 && item.formality <= 5), prefix + '正式程度必须为 1–5');
    assert(item.needs_review == null || typeof item.needs_review === 'boolean', prefix + 'needs_review 必须为布尔值');
    assert(typeof item.image_path === 'string' && safePath(item.image_path) && /^images\/.+\.(jpe?g|png|webp)$/i.test(item.image_path), prefix + 'image_path 必须是 images/ 下的相对路径');
    assert(item.image_sha256 == null || (typeof item.image_sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.image_sha256)), prefix + 'image_sha256 格式无效');
    return { ...item, status: item.status ?? 'active', needs_review: item.needs_review ?? false, seasons: item.seasons ?? [], occasions: item.occasions ?? [], style_tags: item.style_tags ?? [] };
  });
}
export function imageMime(bytes: Uint8Array, filename: string) {
  assert(bytes.length > 0 && bytes.length <= limits.image, '单张图片不能超过 8MB');
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const ext = bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) && ascii(12,16) === 'IHDR' ? 'png'
    : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : bytes.length >= 16 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12,16)) ? 'webp' : null;
  assert(ext && filename.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg') === ext, '图片文件头与后缀不匹配，仅支持 JPG、PNG、WebP');
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}
function directory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  assert(end >= 0 && end >= bytes.length - 65557, '无效 ZIP');
  assert(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, '不支持分卷 ZIP');
  const count = view.getUint16(end + 10, true); assert(count <= 205, 'ZIP 文件数量超限');
  let pos = view.getUint32(end + 16, true), total = 0;
  const entries = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    assert(pos + 46 <= end && view.getUint32(pos, true) === 0x02014b50, 'ZIP 目录损坏或不支持 ZIP64');
    const nameSize = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
    const size = view.getUint32(pos + 24, true), attr = view.getUint32(pos + 38, true), kind = (attr >>> 16) & 0xf000;
    assert(pos + 46 + nameSize + extra + comment <= end, 'ZIP 目录损坏');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pos + 46, pos + 46 + nameSize));
    assert(safePath(name.replace(/\/$/, '')) && !entries.has(name), 'ZIP 路径不安全或文件名重复');
    assert(!kind || kind === 0x8000 || kind === 0x4000, 'ZIP 不允许链接或特殊文件');
    assert(!(view.getUint16(pos + 8, true) & 1), 'ZIP 不允许加密');
    assert(name === 'manifest.json' || name === 'items.json' || name === 'images/' || /^images\/.+\.(jpe?g|png|webp)$/i.test(name), 'ZIP 包含不支持的文件');
    assert(size <= (name.startsWith('images/') ? limits.image : limits.json) && (total += size) <= limits.expanded, 'ZIP 解压大小超限');
    entries.set(name, { size, crc: view.getUint32(pos + 16, true) }); pos += 46 + nameSize + extra + comment;
  }
  assert(pos === view.getUint32(end + 16, true) + view.getUint32(end + 12, true) && pos <= end && entries.has('manifest.json') && entries.has('items.json'), 'ZIP 根目录缺少 manifest.json 或 items.json');
  return entries;
}
export async function parseBundle(bytes: Uint8Array): Promise<Bundle> {
  assert(bytes.length <= limits.zip, 'ZIP 不能超过 60MB');
  const entries = directory(bytes), files: Record<string, Uint8Array> = Object.create(null);
  let total = 0; let failure: Error | undefined;
  const unzip = new Unzip(file => {
    if (failure) return;
    if (!entries.has(file.name) || Object.prototype.hasOwnProperty.call(files, file.name)) { failure = new Error('ZIP 本地文件与目录不一致'); return; }
    const chunks: Uint8Array[] = []; let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) { failure = error; return; }
      size += chunk.length; total += chunk.length;
      if (size > entries.get(file.name)!.size || total > limits.expanded) { failure = new Error('ZIP 实际解压大小超限'); file.terminate(); return; }
      chunks.push(chunk);
      if (final) {
        if (size !== entries.get(file.name)!.size) { failure = new Error('ZIP 文件大小不匹配'); return; }
        const output = new Uint8Array(size); let offset = 0;
        chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.length; });
        if (crc32(output) !== entries.get(file.name)!.crc) { failure = new Error('ZIP 文件 CRC 校验失败'); return; }
        files[file.name] = output;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    unzip.push(bytes.subarray(offset, offset + 32768), offset + 32768 >= bytes.length);
    if (failure) throw failure;
    if (offset % (1024 * 1024) === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert(Object.keys(files).length === entries.size, 'ZIP 文件不完整');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const manifest = JSON.parse(decoder.decode(files['manifest.json']));
  assert(manifest?.format === 'nmdd-wardrobe' && manifest.schema_version === 1, '需要 nmdd-wardrobe schema_version=1');
  assert(typeof manifest.batch_id === 'string' && manifest.batch_id.trim() && manifest.batch_id.length <= 200 && typeof manifest.source === 'string' && manifest.source.length <= 200 && typeof manifest.created_at === 'string' && Number.isFinite(Date.parse(manifest.created_at)), 'manifest 元数据无效');
  const items = validateItems(JSON.parse(decoder.decode(files['items.json'])));
  for (const [name, image] of Object.entries(files)) if (name.startsWith('images/') && !name.endsWith('/')) imageMime(image, name);
  for (const item of items) assert(files[item.image_path], `${item.external_id} 缺少图片`);
  // Hash validation is repeated on the server; preview also catches stale hashes.
  if (globalThis.crypto?.subtle) for (const item of items) if (item.image_sha256) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(files[item.image_path]))), b => b.toString(16).padStart(2, '0')).join('');
    assert(hash === item.image_sha256, `${item.external_id} 图片 SHA-256 不匹配`);
  }
  const known = new Set(['external_id','name','category','subcategory','color_family','primary_color','fit','pattern','seasons','style_tags','occasions','formality','brand','size','material','notes','status','needs_review','image_path','image_sha256']);
  const warnings = items.flatMap(item => Object.keys(item).filter(key => !known.has(key)).map(key => `${item.external_id}：额外字段 ${key} 将被忽略`));
  return { manifest, items, files, warnings };
}
export async function rebuildBundle(bundle: Bundle): Promise<Blob> {
  const items = validateItems(bundle.items);
  const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(bundle.manifest)), 'items.json': strToU8(JSON.stringify(items)) };
  for (const item of items) { assert(bundle.files[item.image_path], '缺少图片'); files[item.image_path] = bundle.files[item.image_path]; }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
  assert(bytes.length <= limits.zip, '校正后的 ZIP 超过 60MB，请拆分批次');
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}
