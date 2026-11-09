const crypto = require('node:crypto');
const yauzl = require('yauzl');
const yazl = require('yazl');

const MB = 1024 * 1024;
const LIMITS = { zip: 60 * MB, image: 8 * MB, expanded: 150 * MB, items: 100, json: 2 * MB, entries: 205 };
const ENUMS = {
  category: ['tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'other'],
  color_family: ['black', 'white', 'gray', 'blue', 'brown', 'beige', 'green', 'red', 'yellow', 'purple', 'orange', 'pink', 'multicolor', 'other'],
  fit: ['slim', 'regular', 'straight', 'relaxed', 'oversized', 'unknown'],
  pattern: ['solid', 'striped', 'checked', 'printed', 'other', 'unknown'],
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  occasions: ['academic_conference', 'business_social', 'daily', 'other'],
  status: ['active', 'archived'],
};
const TEXT = ['external_id', 'name', 'subcategory', 'primary_color', 'brand', 'size', 'material', 'notes'];
const FIELDS = [...TEXT, 'category', 'color_family', 'fit', 'pattern', 'seasons', 'style_tags', 'occasions', 'formality', 'status', 'needs_review'];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255]; return (value ^ 0xffffffff) >>> 0; }
class WardrobeError extends Error {
  constructor(message, statusCode = 400, details = []) { super(message); this.statusCode = statusCode; this.details = details; }
}
const ensure = (condition, message) => { if (!condition) throw new WardrobeError(message); };
const record = v => v && typeof v === 'object' && !Array.isArray(v);
function safePath(value) {
  return typeof value === 'string' && value.length <= 240 && !/[\\\x00-\x1f:]/.test(value)
    && !value.startsWith('/') && value.split('/').every(s => s && s !== '.' && s !== '..');
}
function normalizeItem(input, { image = true } = {}) {
  ensure(record(input), '衣物记录必须是对象');
  const result = {};
  for (const key of TEXT) {
    const value = input[key] ?? null;
    ensure(value === null || (typeof value === 'string' && value.length <= (key === 'notes' ? 10000 : 500)), `${key} 文本无效或过长`);
    result[key] = typeof value === 'string' ? value.trim() : null;
  }
  for (const key of ['external_id', 'name', 'primary_color']) ensure(result[key], `${key} 必填`);
  for (const [key, values] of Object.entries(ENUMS)) {
    if (key === 'seasons' || key === 'occasions') continue;
    const value = input[key] ?? (key === 'status' ? 'active' : null);
    ensure((value === null && key !== 'category') || values.includes(value), `${key} 枚举无效`);
    result[key] = value;
  }
  for (const key of ['seasons', 'occasions', 'style_tags']) {
    const value = input[key] ?? [];
    ensure(Array.isArray(value) && value.length <= 40 && value.every(v => typeof v === 'string' && v.length <= 100 && (!ENUMS[key] || ENUMS[key].includes(v))), `${key} 数组无效`);
    result[key] = [...new Set(value)];
  }
  ensure(input.formality == null || (Number.isInteger(input.formality) && input.formality >= 1 && input.formality <= 5), 'formality 必须是 1–5 整数');
  result.formality = input.formality ?? null;
  ensure(input.needs_review == null || typeof input.needs_review === 'boolean', 'needs_review 必须是布尔值');
  result.needs_review = input.needs_review ?? false;
  if (image) {
    ensure(safePath(input.image_path) && /^images\/.+\.(jpe?g|png|webp)$/i.test(input.image_path), 'image_path 必须是 images/ 下的相对图片路径');
    ensure(input.image_sha256 == null || /^[a-f0-9]{64}$/.test(input.image_sha256), 'image_sha256 格式错误');
    result.image_path = input.image_path;
    result.image_sha256 = input.image_sha256 ?? null;
  }
  return result;
}
function imageInfo(bytes, filename, suppliedMime) {
  ensure(bytes.length > 0 && bytes.length <= LIMITS.image, '单张图片必须为 1 字节至 8MB');
  let ext;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') ext = 'png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = 'jpg';
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) ext = 'webp';
  ensure(ext, '图片文件头无效，仅支持 JPG、PNG、WebP');
  const suffix = String(filename).split('.').pop().toLowerCase().replace('jpeg', 'jpg');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  ensure(suffix === ext && (!suppliedMime || suppliedMime === mime || suppliedMime === 'application/octet-stream'), '图片后缀或 MIME 与文件头不匹配');
  return { ext, mime, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
async function readZip(buffer) {
  ensure(buffer.length <= LIMITS.zip, 'ZIP 超过 60MB');
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (e, z) => e ? reject(new WardrobeError('无效 ZIP')) : resolve(z)));
  return new Promise((resolve, reject) => {
    const files = new Map(); let total = 0; let entries = 0; let ended = false;
    const fail = error => { if (ended) return; ended = true; zip.close(); reject(error instanceof WardrobeError ? error : new WardrobeError('ZIP 损坏或解压失败')); };
    zip.on('error', fail);
    zip.on('end', () => { if (!ended) { ended = true; resolve(files); } });
    zip.on('entry', entry => {
      try {
        ensure(++entries <= LIMITS.entries, 'ZIP 文件数量超限');
        const name = entry.fileName;
        ensure(safePath(name.replace(/\/$/, '')), 'ZIP 包含不安全路径');
        ensure(!files.has(name), 'ZIP 包含重复文件名');
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
        ensure(!kind || kind === 0x8000 || kind === 0x4000, 'ZIP 不允许链接或特殊文件');
        ensure(!(entry.generalPurposeBitFlag & 1), 'ZIP 不允许加密');
        const directory = name.endsWith('/');
        ensure(kind !== 0x4000 || directory, 'ZIP 目录属性与文件名不匹配');
        ensure(!directory || name === 'images/', 'ZIP 目录无效');
        ensure(directory || ['manifest.json', 'items.json'].includes(name) || /^images\/.+\.(jpe?g|png|webp)$/i.test(name), 'ZIP 包含不支持的文件');
        const max = name.startsWith('images/') ? LIMITS.image : LIMITS.json;
        ensure(entry.uncompressedSize <= max && (total += entry.uncompressedSize) <= LIMITS.expanded, 'ZIP 解压大小超限');
        if (directory) { files.set(name, Buffer.alloc(0)); zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = []; let size = 0;
          stream.on('data', chunk => { size += chunk.length; if (size > max || size > entry.uncompressedSize) { stream.destroy(); fail(new WardrobeError('ZIP 实际解压大小超限')); } else chunks.push(chunk); });
          stream.on('error', fail);
          stream.on('end', () => {
            if (ended) return;
            const bytes = Buffer.concat(chunks);
            if (crc32(bytes) !== entry.crc32) return fail(new WardrobeError('ZIP 文件 CRC 校验失败'));
            files.set(name, bytes); zip.readEntry();
          });
        });
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}
async function parseBundle(buffer) {
  const files = await readZip(buffer);
  let manifest, items;
  try { const decoder = new TextDecoder('utf-8', { fatal: true }); manifest = JSON.parse(decoder.decode(files.get('manifest.json'))); items = JSON.parse(decoder.decode(files.get('items.json'))); }
  catch { throw new WardrobeError('根目录必须包含有效 UTF-8 manifest.json 和 items.json'); }
  ensure(record(manifest) && manifest.format === 'nmdd-wardrobe' && manifest.schema_version === 1, '不支持的 format 或 schema_version（需要 v1）');
  ensure(typeof manifest.batch_id === 'string' && manifest.batch_id.trim() && manifest.batch_id.length <= 200 && typeof manifest.source === 'string' && manifest.source.length <= 200 && typeof manifest.created_at === 'string' && Number.isFinite(Date.parse(manifest.created_at)), 'manifest 元数据无效');
  ensure(Array.isArray(items) && items.length <= LIMITS.items, 'items.json 必须是最多 100 件的数组');
  const seen = new Set(); const errors = []; const warnings = [];
  const normalized = items.map((raw, index) => {
    try {
      const item = normalizeItem(raw);
      ensure(!seen.has(item.external_id), '重复 external_id'); seen.add(item.external_id);
      const bytes = files.get(item.image_path); ensure(bytes, '图片文件缺失');
      const info = imageInfo(bytes, item.image_path);
      ensure(!item.image_sha256 || item.image_sha256 === info.sha256, '图片 SHA-256 不匹配');
      const unknown = Object.keys(raw).filter(k => !FIELDS.includes(k) && !['image_path', 'image_sha256'].includes(k));
      if (unknown.length) warnings.push({ index, fields: unknown, message: '已忽略额外字段' });
      return { ...item, image_sha256: info.sha256, bytes, info };
    } catch (error) { errors.push({ index, external_id: typeof raw?.external_id === 'string' ? raw.external_id : null, message: error.message }); return null; }
  });
  if (errors.length) throw new WardrobeError('整批校验失败，未写入任何衣物', 400, errors);
  // Even unreferenced image files must be safe raster images.
  for (const [name, bytes] of files) if (name.startsWith('images/') && !name.endsWith('/')) imageInfo(bytes, name);
  return { manifest, items: normalized, warnings };
}
function zipFiles(files, options) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile(); const chunks = [];
    zip.outputStream.on('data', chunk => chunks.push(chunk));
    zip.outputStream.on('error', reject); zip.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, bytes] of files) zip.addBuffer(bytes, name, options);
    zip.end();
  });
}
module.exports = { LIMITS, ENUMS, FIELDS, WardrobeError, ensure, normalizeItem, imageInfo, parseBundle, readZip, zipFiles };
