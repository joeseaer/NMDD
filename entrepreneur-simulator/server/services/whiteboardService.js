const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const WHITEBOARD_ASSET_BUCKET = 'whiteboard-assets';
const WHITEBOARD_ASSET_BUCKET_OPTIONS = Object.freeze({
  public: false,
  fileSizeLimit: 15 * 1024 * 1024,
  allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
});
const WHITEBOARD_SCENE_SCHEMA_VERSION = 1;
const WHITEBOARD_SCENE_MAX_BYTES = 5 * 1024 * 1024;
const WHITEBOARD_TITLE_MAX_LENGTH = 120;
const WHITEBOARD_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const WHITEBOARD_ASSET_KEY_PATTERN = /^assets\/sha256\/([a-f0-9]{64})\.(gif|jpg|png|webp)$/;
const WHITEBOARD_PREVIEW_KEY_PATTERN = /^previews\/([0-9a-f-]{36})\/([1-9][0-9]*)\.png$/;

const MIME_BY_EXTENSION = Object.freeze({
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
let storageReady = false;

class WhiteboardError extends Error {
  constructor(message, { code = 'WHITEBOARD_ERROR', statusCode = 400, details } = {}) {
    super(message);
    this.name = 'WhiteboardError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class WhiteboardNotFoundError extends WhiteboardError {
  constructor(id) {
    super('白板不存在或已被删除', {
      code: 'WHITEBOARD_NOT_FOUND',
      statusCode: 404,
      details: { id },
    });
    this.name = 'WhiteboardNotFoundError';
  }
}

class WhiteboardRevisionConflictError extends WhiteboardError {
  constructor({ id, expectedRevision, currentRevision }) {
    super('白板已在另一个窗口中更新，请重新加载后再保存', {
      code: 'WHITEBOARD_REVISION_CONFLICT',
      statusCode: 409,
      details: {
        id,
        expected_revision: expectedRevision,
        current_revision: currentRevision,
      },
    });
    this.name = 'WhiteboardRevisionConflictError';
  }
}

const assertDatabase = () => {
  if (!supabase) {
    throw new WhiteboardError('白板数据库连接尚未配置', {
      code: 'WHITEBOARD_DATABASE_UNAVAILABLE',
      statusCode: 503,
    });
  }
  return supabase;
};

const isRecord = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeTitle = (value, fallback = '未命名白板') => {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  return Array.from(title).slice(0, WHITEBOARD_TITLE_MAX_LENGTH).join('');
};

const normalizePositiveInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new WhiteboardError(`${field} 必须是正整数`, {
      code: 'INVALID_WHITEBOARD_REVISION',
      statusCode: 400,
    });
  }
  return parsed;
};

const normalizeScene = (value) => {
  const scene = isRecord(value) ? value : {};
  if (!Array.isArray(scene.elements) || !isRecord(scene.appState || {})) {
    throw new WhiteboardError('白板场景格式无效', {
      code: 'INVALID_WHITEBOARD_SCENE',
      statusCode: 400,
    });
  }

  const normalized = {
    type: 'excalidraw',
    version: 2,
    source: 'nmdd',
    elements: scene.elements.filter((element) => isRecord(element) && element.isDeleted !== true),
    appState: { ...(scene.appState || {}) },
  };
  delete normalized.appState.collaborators;
  delete normalized.appState.selectedElementIds;
  delete normalized.appState.selectedGroupIds;
  delete normalized.appState.editingElement;
  delete normalized.appState.editingGroupId;

  const byteSize = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (byteSize > WHITEBOARD_SCENE_MAX_BYTES) {
    throw new WhiteboardError('白板场景超过 5MB 保存限制', {
      code: 'WHITEBOARD_SCENE_TOO_LARGE',
      statusCode: 413,
    });
  }
  return normalized;
};

const emptyScene = () => normalizeScene({ elements: [], appState: {} });

const initStorage = async () => {
  storageReady = false;
  if (!supabase) return false;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const existing = (buckets || []).find((bucket) => bucket.name === WHITEBOARD_ASSET_BUCKET);
  if (!existing) {
    const { error } = await supabase.storage.createBucket(
      WHITEBOARD_ASSET_BUCKET,
      WHITEBOARD_ASSET_BUCKET_OPTIONS,
    );
    if (error) throw error;
  } else {
    const { error } = await supabase.storage.updateBucket(
      WHITEBOARD_ASSET_BUCKET,
      WHITEBOARD_ASSET_BUCKET_OPTIONS,
    );
    if (error) throw error;
  }
  storageReady = true;
  return true;
};

const listWhiteboards = async (userId) => {
  const client = assertDatabase();
  const { data, error } = await client
    .from('whiteboards')
    .select('id,user_id,title,scene_schema_version,content_revision,preview_revision,created_at,updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

const getWhiteboardRow = async (id, userId, { includeDeleted = false } = {}) => {
  const client = assertDatabase();
  let query = client
    .from('whiteboards')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId);
  if (!includeDeleted) query = query.is('deleted_at', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new WhiteboardNotFoundError(id);
  return data;
};

const getWhiteboard = async (id, userId) => {
  const client = assertDatabase();
  const board = await getWhiteboardRow(id, userId);
  const { data: assets, error } = await client
    .from('whiteboard_assets')
    .select('file_id,mime_type,byte_size,sha256,file_metadata,created_at')
    .eq('whiteboard_id', id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return { ...board, assets: assets || [] };
};

const getWhiteboardMetadata = async (id, userId) => {
  const client = assertDatabase();
  const { data, error } = await client
    .from('whiteboards')
    .select('id,user_id,title,scene_schema_version,content_revision,preview_revision,created_at,updated_at')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new WhiteboardNotFoundError(id);
  return data;
};

const createWhiteboard = async ({ userId, title, scene }) => {
  const client = assertDatabase();
  const payload = {
    user_id: userId,
    title: normalizeTitle(title),
    scene_json: scene ? normalizeScene(scene) : emptyScene(),
    scene_schema_version: WHITEBOARD_SCENE_SCHEMA_VERSION,
  };
  const { data, error } = await client
    .from('whiteboards')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return { ...data, assets: [] };
};

const updateWhiteboard = async ({ id, userId, title, scene, expectedRevision }) => {
  const client = assertDatabase();
  const expected = normalizePositiveInteger(expectedRevision, 'expected_revision');
  const payload = {};
  if (title !== undefined) payload.title = normalizeTitle(title);
  if (scene !== undefined) {
    payload.scene_json = normalizeScene(scene);
    payload.scene_schema_version = WHITEBOARD_SCENE_SCHEMA_VERSION;
  }
  if (Object.keys(payload).length === 0) {
    throw new WhiteboardError('没有可保存的白板更改', {
      code: 'EMPTY_WHITEBOARD_UPDATE',
      statusCode: 400,
    });
  }

  const { data, error } = await client
    .from('whiteboards')
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .eq('content_revision', expected)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  let latest = null;
  try {
    latest = await getWhiteboardRow(id, userId);
  } catch (notFoundError) {
    if (notFoundError instanceof WhiteboardNotFoundError) throw notFoundError;
    throw notFoundError;
  }
  throw new WhiteboardRevisionConflictError({
    id,
    expectedRevision: expected,
    currentRevision: latest.content_revision,
  });
};

const duplicateWhiteboard = async ({ id, userId, title }) => {
  const client = assertDatabase();
  const source = await getWhiteboardRow(id, userId);
  const duplicate = await createWhiteboard({
    userId,
    title: title === undefined ? `${source.title} 副本` : title,
    scene: source.scene_json,
  });

  const { data: sourceAssets, error: assetReadError } = await client
    .from('whiteboard_assets')
    .select('file_id,object_key,sha256,mime_type,byte_size,file_metadata')
    .eq('whiteboard_id', id);
  if (assetReadError) throw assetReadError;
  if (sourceAssets && sourceAssets.length > 0) {
    const rows = sourceAssets.map((asset) => ({
      ...asset,
      whiteboard_id: duplicate.id,
      last_referenced_at: new Date().toISOString(),
    }));
    const { error: assetInsertError } = await client.from('whiteboard_assets').insert(rows);
    if (assetInsertError) throw assetInsertError;
  }
  return { ...duplicate, assets: sourceAssets || [] };
};

const getReferences = async (id, userId) => {
  const client = assertDatabase();
  await getWhiteboardRow(id, userId);
  const { data: refs, error } = await client
    .from('whiteboard_document_refs')
    .select('sop_id,block_id,created_at')
    .eq('whiteboard_id', id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const sopIds = Array.from(new Set((refs || []).map((ref) => ref.sop_id).filter(Boolean)));
  if (sopIds.length === 0) return [];
  const { data: documents, error: documentError } = await client
    .from('sops')
    .select('id,title,domain,research_type')
    .eq('user_id', userId)
    .in('id', sopIds);
  if (documentError) throw documentError;
  const byId = new Map((documents || []).map((document) => [document.id, document]));
  return (refs || []).map((ref) => ({ ...ref, document: byId.get(ref.sop_id) || null }));
};

const scanDocumentReferences = async (id, userId) => {
  const client = assertDatabase();
  const { data: documents, error } = await client
    .from('sops')
    .select('id,title,domain,research_type,content,content_json')
    .eq('user_id', userId);
  if (error) throw error;
  const matches = [];
  for (const document of documents || []) {
    const structured = extractWhiteboardReferences(document.content_json)
      .filter((reference) => reference.whiteboardId === id);
    const markdown = String(document.content || '');
    const legacyHtmlMatch = markdown.includes('data-whiteboard-id') && markdown.includes(id);
    if (structured.length === 0 && !legacyHtmlMatch) continue;
    matches.push({
      sop_id: document.id,
      block_id: structured[0]?.blockId || 'legacy-markdown',
      created_at: null,
      document: {
        id: document.id,
        title: document.title,
        domain: document.domain,
        research_type: document.research_type,
      },
    });
  }
  return matches;
};

const deleteWhiteboard = async ({ id, userId }) => {
  const client = assertDatabase();
  await getWhiteboardRow(id, userId);
  let references = await getReferences(id, userId);
  if (references.length === 0) references = await scanDocumentReferences(id, userId);
  if (references.length > 0) {
    throw new WhiteboardError('该白板仍被文档引用，请先解除引用', {
      code: 'WHITEBOARD_STILL_REFERENCED',
      statusCode: 409,
      details: { references },
    });
  }
  const deletedAt = new Date().toISOString();
  const { data, error } = await client
    .from('whiteboards')
    .update({ deleted_at: deletedAt })
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .select('id,deleted_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new WhiteboardNotFoundError(id);
  return data;
};

const assertAssetIdentity = ({ fileId, sha256, mimeType }) => {
  const normalizedFileId = String(fileId || '').trim();
  const normalizedSha = String(sha256 || '').trim().toLowerCase();
  if (!WHITEBOARD_FILE_ID_PATTERN.test(normalizedFileId)) {
    throw new WhiteboardError('无效的白板图片 ID', {
      code: 'INVALID_WHITEBOARD_FILE_ID',
      statusCode: 400,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(normalizedSha)) {
    throw new WhiteboardError('无效的白板图片哈希', {
      code: 'INVALID_WHITEBOARD_ASSET_HASH',
      statusCode: 400,
    });
  }
  const extension = Object.entries(MIME_BY_EXTENSION)
    .find(([, candidateMime]) => candidateMime === mimeType)?.[0];
  if (!extension) {
    throw new WhiteboardError('不支持的白板图片类型', {
      code: 'UNSUPPORTED_WHITEBOARD_ASSET',
      statusCode: 415,
    });
  }
  return {
    fileId: normalizedFileId,
    sha256: normalizedSha,
    mimeType,
    extension,
    objectKey: `assets/sha256/${normalizedSha}.${extension}`,
  };
};

const putAsset = async ({ id, userId, fileId, buffer, mimeType, sha256, metadata = {} }) => {
  const client = assertDatabase();
  if (!storageReady) {
    throw new WhiteboardError('白板图片存储尚未就绪', {
      code: 'WHITEBOARD_STORAGE_UNAVAILABLE',
      statusCode: 503,
    });
  }
  await getWhiteboardRow(id, userId);
  const identity = assertAssetIdentity({ fileId, sha256, mimeType });
  const actualSha = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualSha !== identity.sha256) {
    throw new WhiteboardError('白板图片哈希校验失败', {
      code: 'WHITEBOARD_ASSET_HASH_MISMATCH',
      statusCode: 400,
    });
  }

  const { error: uploadError } = await client.storage
    .from(WHITEBOARD_ASSET_BUCKET)
    .upload(identity.objectKey, buffer, {
      contentType: mimeType,
      cacheControl: '31536000',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const row = {
    whiteboard_id: id,
    file_id: identity.fileId,
    object_key: identity.objectKey,
    sha256: identity.sha256,
    mime_type: identity.mimeType,
    byte_size: buffer.length,
    file_metadata: isRecord(metadata) ? metadata : {},
    last_referenced_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from('whiteboard_assets')
    .upsert(row, { onConflict: 'whiteboard_id,file_id' })
    .select('file_id,mime_type,byte_size,sha256,file_metadata,created_at')
    .single();
  if (error) throw error;
  return data;
};

const getAsset = async ({ id, userId, fileId }) => {
  const client = assertDatabase();
  await getWhiteboardRow(id, userId);
  const { data: asset, error } = await client
    .from('whiteboard_assets')
    .select('*')
    .eq('whiteboard_id', id)
    .eq('file_id', fileId)
    .maybeSingle();
  if (error) throw error;
  if (!asset) return null;
  const match = WHITEBOARD_ASSET_KEY_PATTERN.exec(asset.object_key);
  if (!match || match[1] !== asset.sha256 || MIME_BY_EXTENSION[match[2]] !== asset.mime_type) {
    throw new WhiteboardError('白板图片元数据校验失败', {
      code: 'WHITEBOARD_ASSET_INTEGRITY_ERROR',
      statusCode: 500,
    });
  }
  const { data, error: downloadError } = await client.storage
    .from(WHITEBOARD_ASSET_BUCKET)
    .download(asset.object_key);
  if (downloadError) throw downloadError;
  const buffer = Buffer.from(await data.arrayBuffer());
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== asset.sha256) {
    throw new WhiteboardError('白板图片内容校验失败', {
      code: 'WHITEBOARD_ASSET_INTEGRITY_ERROR',
      statusCode: 500,
    });
  }
  return { ...asset, buffer };
};

const putPreview = async ({ id, userId, revision, buffer }) => {
  const client = assertDatabase();
  if (!storageReady) {
    throw new WhiteboardError('白板缩略图存储尚未就绪', {
      code: 'WHITEBOARD_STORAGE_UNAVAILABLE',
      statusCode: 503,
    });
  }
  const expectedRevision = normalizePositiveInteger(revision, 'revision');
  const board = await getWhiteboardRow(id, userId);
  if (Number(board.content_revision) !== expectedRevision) {
    throw new WhiteboardRevisionConflictError({
      id,
      expectedRevision,
      currentRevision: board.content_revision,
    });
  }
  const objectKey = `previews/${id}/${expectedRevision}.png`;
  const { error: uploadError } = await client.storage
    .from(WHITEBOARD_ASSET_BUCKET)
    .upload(objectKey, buffer, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: true,
    });
  if (uploadError) throw uploadError;
  const { data, error } = await client
    .from('whiteboards')
    .update({ preview_object_key: objectKey, preview_revision: expectedRevision })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('content_revision', expectedRevision)
    .is('deleted_at', null)
    .select('id,preview_revision')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const latest = await getWhiteboardRow(id, userId);
    throw new WhiteboardRevisionConflictError({
      id,
      expectedRevision,
      currentRevision: latest.content_revision,
    });
  }
  return data;
};

const getPreview = async ({ id, userId }) => {
  const client = assertDatabase();
  const board = await getWhiteboardRow(id, userId);
  if (!board.preview_object_key || !board.preview_revision) return null;
  const match = WHITEBOARD_PREVIEW_KEY_PATTERN.exec(board.preview_object_key);
  if (!match || match[1] !== id || Number(match[2]) !== Number(board.preview_revision)) {
    throw new WhiteboardError('白板缩略图元数据校验失败', {
      code: 'WHITEBOARD_PREVIEW_INTEGRITY_ERROR',
      statusCode: 500,
    });
  }
  const { data, error } = await client.storage
    .from(WHITEBOARD_ASSET_BUCKET)
    .download(board.preview_object_key);
  if (error) throw error;
  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    revision: board.preview_revision,
  };
};

const extractWhiteboardReferences = (contentJson) => {
  const references = [];
  const visit = (node, path = '0') => {
    if (!isRecord(node)) return;
    if (node.type === 'whiteboardEmbed' && isRecord(node.attrs)) {
      const whiteboardId = String(node.attrs.whiteboardId || '').trim();
      if (whiteboardId) {
        references.push({
          whiteboardId,
          blockId: String(node.attrs.blockId || `path:${path}`).trim(),
        });
      }
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((child, index) => visit(child, `${path}.${index}`));
    }
  };
  visit(contentJson);
  return references;
};

const syncDocumentReferences = async ({ sopId, userId, contentJson }) => {
  const client = assertDatabase();
  const extracted = extractWhiteboardReferences(contentJson);
  const { data: existing, error: existingError } = await client
    .from('whiteboard_document_refs')
    .select('whiteboard_id,block_id')
    .eq('sop_id', sopId);
  if (existingError) throw existingError;

  const ids = Array.from(new Set(extracted.map((ref) => ref.whiteboardId)));
  let boards = [];
  if (ids.length > 0) {
    const { data, error: boardError } = await client
      .from('whiteboards')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('id', ids);
    if (boardError) throw boardError;
    boards = data || [];
  }
  const allowed = new Set((boards || []).map((board) => board.id));
  const unique = new Map(extracted
    .filter((ref) => allowed.has(ref.whiteboardId))
    .map((ref) => [`${ref.whiteboardId}\u0000${ref.blockId}`, ref]));
  const rows = Array.from(unique.values())
    .map((ref) => ({
      whiteboard_id: ref.whiteboardId,
      sop_id: sopId,
      block_id: ref.blockId,
    }));
  let saved = [];
  if (rows.length > 0) {
    const { data, error } = await client
      .from('whiteboard_document_refs')
      .upsert(rows, { onConflict: 'whiteboard_id,sop_id,block_id' })
      .select('*');
    if (error) throw error;
    saved = data || [];
  }

  // Insert/upsert first, then remove stale references. A partial failure can
  // only leave conservative extra backlinks; it can never make deletion unsafe.
  const desiredKeys = new Set(rows.map((row) => `${row.whiteboard_id}\u0000${row.block_id}`));
  for (const reference of existing || []) {
    const key = `${reference.whiteboard_id}\u0000${reference.block_id}`;
    if (desiredKeys.has(key)) continue;
    const { error } = await client
      .from('whiteboard_document_refs')
      .delete()
      .eq('whiteboard_id', reference.whiteboard_id)
      .eq('sop_id', sopId)
      .eq('block_id', reference.block_id);
    if (error) throw error;
  }
  return saved;
};

const getBackupData = async (userId) => {
  const client = assertDatabase();
  const { data: whiteboards, error } = await client
    .from('whiteboards')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  const ids = (whiteboards || []).map((board) => board.id);
  if (ids.length === 0) return { whiteboards: [], whiteboard_assets: [], whiteboard_document_refs: [] };
  const [{ data: assets, error: assetError }, { data: refs, error: refError }] = await Promise.all([
    client.from('whiteboard_assets').select('*').in('whiteboard_id', ids),
    client.from('whiteboard_document_refs').select('*').in('whiteboard_id', ids),
  ]);
  if (assetError) throw assetError;
  if (refError) throw refError;
  return {
    whiteboards: whiteboards || [],
    whiteboard_assets: assets || [],
    whiteboard_document_refs: refs || [],
  };
};

const __setSupabaseClientForTests = (client, { ready = true } = {}) => {
  supabase = client;
  storageReady = Boolean(client && ready);
};

module.exports = {
  WHITEBOARD_ASSET_BUCKET,
  WHITEBOARD_ASSET_BUCKET_OPTIONS,
  WHITEBOARD_SCENE_SCHEMA_VERSION,
  WHITEBOARD_SCENE_MAX_BYTES,
  WhiteboardError,
  WhiteboardNotFoundError,
  WhiteboardRevisionConflictError,
  initStorage,
  listWhiteboards,
  getWhiteboard,
  getWhiteboardMetadata,
  createWhiteboard,
  updateWhiteboard,
  duplicateWhiteboard,
  getReferences,
  scanDocumentReferences,
  deleteWhiteboard,
  putAsset,
  getAsset,
  putPreview,
  getPreview,
  extractWhiteboardReferences,
  syncDocumentReferences,
  getBackupData,
  normalizeScene,
  __setSupabaseClientForTests,
};
