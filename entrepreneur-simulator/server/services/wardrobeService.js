const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { ZipFile } = require('yazl');
const { createClient } = require('@supabase/supabase-js');
const { DEFAULT_USER_ID: OWNER } = require('../config/currentUser');
const { FIELDS, ENUMS, LIMITS, WardrobeError, ensure, normalizeItem, imageInfo, parseBundle } = require('./wardrobeBundle');
const BUCKET = 'wardrobe-images';

function createWardrobeService(client) {
  const db = () => { if (!client) throw new WardrobeError('衣橱数据库尚未配置', 503); return client; };
  const check = ({ data, error }) => {
    if (error) {
      if (error.code === 'P0002') throw new WardrobeError('衣物或搭配不存在', 404);
      if (error.code === '23505') throw new WardrobeError('记录已存在，请刷新后重试', 409);
      if (error.code === '22023') throw new WardrobeError('搭配中包含重复、已删除或无权访问的衣物');
      throw new WardrobeError('衣橱存储操作失败，请检查迁移和存储配置后重试', 503);
    }
    return data;
  };
  const table = () => db().from('wardrobe_items');
  const bucket = () => db().storage.from(BUCKET);
  const publicItem = row => {
    const { user_id, image_object_key, manual_fields, ...item } = row;
    return { ...item, image_url: `/api/wardrobe/items/${row.id}/image?v=${row.image_sha256}` };
  };
  async function getItem(id, includeDeleted = false) {
    let query = table().select('*').eq('user_id', OWNER).eq('id', id);
    if (!includeDeleted) query = query.is('deleted_at', null);
    const row = check(await query.maybeSingle());
    if (!row) throw new WardrobeError('衣物不存在或已删除', 404);
    return row;
  }
  async function allItems(includeDeleted = false) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      let query = table().select('*').eq('user_id', OWNER).order('created_at').order('id').range(offset, offset + 499);
      if (!includeDeleted) query = query.is('deleted_at', null);
      const page = check(await query); rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function listItems(filters = {}) {
    // All filtering is literal (including punctuation), never interpolated into PostgREST expressions.
    const all = await allItems();
    const stats = { total: all.length, categories: new Set(all.map(i => i.category)).size, needs_review: all.filter(i => i.needs_review).length };
    const matching = all.filter(item => {
      for (const key of ['category', 'color_family', 'status']) if (filters[key] && item[key] !== filters[key]) return false;
      for (const [query, field] of [['season', 'seasons'], ['occasion', 'occasions']]) if (filters[query] && !item[field].includes(filters[query])) return false;
      if (filters.needs_review === 'true' && !item.needs_review) return false;
      return !filters.search || item.name.toLocaleLowerCase().includes(String(filters.search).toLocaleLowerCase());
    });
    const page = Math.max(1, Number(filters.page) || 1), pageSize = Math.min(100, Math.max(1, Number(filters.page_size) || 40));
    return { items: matching.slice((page - 1) * pageSize, page * pageSize).map(publicItem), total: matching.length, page, page_size: pageSize, stats };
  }
  async function stageImage(bytes, filename, mime, staged) {
    const info = imageInfo(bytes, filename, mime);
    const existing = check(await table().select('image_object_key').eq('user_id', OWNER).eq('image_sha256', info.sha256).limit(1));
    if (existing.length) return { image_object_key: existing[0].image_object_key, image_sha256: info.sha256 };
    const ownerPrefix = crypto.createHash('sha256').update(OWNER).digest('hex').slice(0, 24);
    // Attempt-unique suffix makes compensation safe across concurrent server instances.
    const key = `${ownerPrefix}/sha256/${info.sha256}/${crypto.randomUUID()}.${info.ext}`;
    check(await bucket().upload(key, bytes, { contentType: info.mime, upsert: false }));
    staged.push(key);
    return { image_object_key: key, image_sha256: info.sha256 };
  }
  async function cleanup(staged) {
    if (!staged.length) return;
    // A request may time out after PostgreSQL committed. Check references before removal.
    const result = await table().select('image_object_key').eq('user_id', OWNER).in('image_object_key', staged);
    if (result.error) return; // Retain uncertain objects for reconciliation; never delete committed images.
    const used = new Set(result.data.map(row => row.image_object_key));
    const unused = staged.filter(key => !used.has(key));
    if (unused.length) await bucket().remove(unused);
  }
  async function importBundle(buffer, mode = 'skip_existing') {
    ensure(['skip_existing', 'update_imported'].includes(mode), 'mode 无效');
    const bundle = await parseBundle(buffer); const staged = []; const images = new Map();
    try {
      const prepared = [];
      for (const item of bundle.items) {
        let image = images.get(item.image_sha256);
        if (!image) { image = await stageImage(item.bytes, item.image_path, item.info.mime, staged); images.set(item.image_sha256, image); }
        prepared.push({ ...Object.fromEntries(FIELDS.map(key => [key, item[key]])), ...image });
      }
      const result = check(await db().rpc('wardrobe_import', { p_owner: OWNER, p_items: prepared, p_mode: mode }));
      return { ...result, warnings: bundle.warnings };
    } finally { await cleanup(staged).catch(() => {}); }
  }
  async function createItem(input, file) {
    ensure(file, '请上传衣物照片');
    const item = normalizeItem({ ...input, external_id: `manual_${crypto.randomUUID()}` }, { image: false });
    const staged = [];
    try {
      const image = await stageImage(file.bytes, file.filename, file.mimetype, staged);
      const row = check(await table().insert({ ...item, ...image, user_id: OWNER, manual_fields: FIELDS.filter(k => k !== 'external_id') }).select('*').single());
      return publicItem(row);
    } finally { await cleanup(staged).catch(() => {}); }
  }
  async function patchItem(id, patch) {
    ensure(patch && typeof patch === 'object' && !Array.isArray(patch), '编辑内容必须是对象');
    const old = await getItem(id);
    const allowed = FIELDS.filter(key => key !== 'external_id');
    const input = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
    ensure(Object.keys(input).length, '没有可更新的衣物字段');
    const normalized = normalizeItem({ ...old, ...input }, { image: false });
    const values = Object.fromEntries(Object.keys(input).map(key => [key, normalized[key]]));
    return publicItem(check(await db().rpc('wardrobe_patch_item', { p_owner: OWNER, p_id: id, p_patch: values })));
  }
  async function deleteItem(id) {
    await getItem(id);
    check(await db().rpc('wardrobe_patch_item', { p_owner: OWNER, p_id: id, p_patch: { deleted_at: new Date().toISOString() } }));
    return { deleted: true };
  }
  async function replaceImage(id, file) {
    await getItem(id); ensure(file, '请选择图片'); const staged = [];
    try {
      const image = await stageImage(file.bytes, file.filename, file.mimetype, staged);
      return publicItem(check(await db().rpc('wardrobe_patch_item', { p_owner: OWNER, p_id: id, p_patch: image })));
    } finally { await cleanup(staged).catch(() => {}); }
  }
  async function getImage(id) {
    const row = await getItem(id, true);
    return loadImage(row);
  }
  async function loadImage(row) {
    const blob = check(await bucket().download(row.image_object_key));
    const bytes = Buffer.from(await blob.arrayBuffer());
    const info = imageInfo(bytes, row.image_object_key);
    ensure(info.sha256 === row.image_sha256, '存储图片校验失败');
    return { bytes, mime: info.mime };
  }
  async function exportBundle() {
    const rows = await allItems(); const images = new Map(); const items = [];
    for (const row of rows) {
      const filename = `images/${row.image_sha256}.${row.image_object_key.split('.').pop()}`;
      images.set(filename, row);
      items.push({ ...Object.fromEntries(FIELDS.map(key => [key, row[key]])), image_path: filename, image_sha256: row.image_sha256 });
    }
    const zip = new ZipFile();
    zip.on('error', error => zip.outputStream.destroy(error));
    zip.addBuffer(Buffer.from(JSON.stringify({ format: 'nmdd-wardrobe', schema_version: 1, batch_id: `export-${crypto.randomUUID()}`, created_at: new Date().toISOString(), source: 'nmdd-export' }, null, 2)), 'manifest.json');
    zip.addBuffer(Buffer.from(JSON.stringify(items, null, 2)), 'items.json');
    for (const [filename, row] of images) zip.addReadStreamLazy(filename, { compress: false }, callback => {
      loadImage(row).then(image => callback(null, Readable.from([image.bytes]))).catch(callback);
    });
    zip.end();
    return zip.outputStream;
  }
  async function listOutfits() {
    const outfits = check(await db().from('wardrobe_outfits').select('*,wardrobe_outfit_items(item_id,position)').eq('user_id', OWNER).order('updated_at', { ascending: false }));
    const rows = await allItems(true); const byId = new Map(rows.map(row => [row.id, publicItem(row)]));
    return outfits.map(({ user_id, wardrobe_outfit_items, ...outfit }) => ({ ...outfit, items: wardrobe_outfit_items.sort((a, b) => a.position - b.position).map(link => ({ item_id: link.item_id, position: link.position, item: byId.get(link.item_id) ?? null })) }));
  }
  async function saveOutfit(id, input) {
    ensure(typeof input?.name === 'string' && input.name.trim() && input.name.length <= 500, '请输入搭配名称（最多 500 字）');
    ensure(ENUMS.occasions.includes(input.occasion), '搭配场景无效');
    ensure(input.notes == null || (typeof input.notes === 'string' && input.notes.length <= 10000), '搭配备注无效');
    ensure(Array.isArray(input.item_ids) && input.item_ids.length >= 1 && input.item_ids.length <= LIMITS.items && input.item_ids.every(v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v)), '请按展示顺序选择 1–100 件衣物');
    const result = check(await db().rpc('wardrobe_save_outfit', { p_owner: OWNER, p_id: id || null, p_name: input.name.trim(), p_occasion: input.occasion, p_notes: input.notes ?? null, p_item_ids: input.item_ids }));
    return { id: result };
  }
  async function deleteOutfit(id) {
    const rows = check(await db().from('wardrobe_outfits').delete().eq('user_id', OWNER).eq('id', id).select('id'));
    if (!rows.length) throw new WardrobeError('搭配不存在', 404);
    return { deleted: true };
  }
  return { listItems, importBundle, createItem, patchItem, deleteItem, replaceImage, getImage, exportBundle, listOutfits, saveOutfit, deleteOutfit };
}
const client = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
module.exports = { ...createWardrobeService(client), createWardrobeService };
