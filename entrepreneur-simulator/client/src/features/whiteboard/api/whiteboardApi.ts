import { CURRENT_USER_ID, parseApiErrorMessage } from '../../../services/api';
import type {
  Whiteboard,
  WhiteboardAsset,
  WhiteboardReference,
  WhiteboardScene,
  WhiteboardSummary,
} from '../model';

const API_BASE = '/api/whiteboards';

export class WhiteboardRevisionConflictError extends Error {
  readonly code = 'WHITEBOARD_REVISION_CONFLICT';
  readonly status = 409;
  readonly id?: string;
  readonly expectedRevision?: number;
  readonly currentRevision?: number;

  constructor(payload: any) {
    super(payload?.error || '白板已在另一个窗口中更新');
    this.name = 'WhiteboardRevisionConflictError';
    this.id = payload?.id;
    this.expectedRevision = payload?.expected_revision;
    this.currentRevision = payload?.current_revision;
  }
}

export class WhiteboardReferencedError extends Error {
  readonly code = 'WHITEBOARD_STILL_REFERENCED';
  readonly references: WhiteboardReference[];

  constructor(payload: any) {
    super(payload?.error || '该白板仍被文档引用');
    this.name = 'WhiteboardReferencedError';
    this.references = Array.isArray(payload?.references) ? payload.references : [];
  }
}

const readResponse = async <T>(response: Response, fallback: string): Promise<T> => {
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Normalized below.
  }
  if (!response.ok) {
    if (response.status === 409 && payload?.code === 'WHITEBOARD_REVISION_CONFLICT') {
      throw new WhiteboardRevisionConflictError(payload);
    }
    if (response.status === 409 && payload?.code === 'WHITEBOARD_STILL_REFERENCED') {
      throw new WhiteboardReferencedError(payload);
    }
    throw new Error(payload?.error || parseApiErrorMessage(text, fallback));
  }
  if (!text) throw new Error(`${fallback}：服务器未返回数据`);
  return (payload ?? JSON.parse(text)) as T;
};

const userQuery = () => `userId=${encodeURIComponent(CURRENT_USER_ID)}`;

export const whiteboardPreviewUrl = (id: string, revision?: number | null) => (
  `${API_BASE}/${encodeURIComponent(id)}/preview?${userQuery()}${revision ? `&revision=${revision}` : ''}`
);

export const whiteboardAssetUrl = (id: string, fileId: string) => (
  `${API_BASE}/${encodeURIComponent(id)}/assets/${encodeURIComponent(fileId)}?${userQuery()}`
);

export const whiteboardApi = {
  list: async (): Promise<WhiteboardSummary[]> => {
    const response = await fetch(`${API_BASE}?${userQuery()}`, { credentials: 'same-origin' });
    return readResponse(response, '加载白板列表失败');
  },

  get: async (id: string): Promise<Whiteboard> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}?${userQuery()}`, {
      credentials: 'same-origin',
    });
    return readResponse(response, '加载白板失败');
  },

  getMetadata: async (id: string): Promise<WhiteboardSummary> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}/meta?${userQuery()}`, {
      credentials: 'same-origin',
    });
    return readResponse(response, '加载白板信息失败');
  },

  create: async (payload: { title?: string; scene?: WhiteboardScene }): Promise<Whiteboard> => {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ userId: CURRENT_USER_ID, ...payload }),
    });
    return readResponse(response, '创建白板失败');
  },

  update: async (
    id: string,
    payload: { title?: string; scene?: WhiteboardScene; expected_revision: number },
  ): Promise<Whiteboard> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ userId: CURRENT_USER_ID, ...payload }),
    });
    return readResponse(response, '保存白板失败');
  },

  duplicate: async (id: string, title?: string): Promise<Whiteboard> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ userId: CURRENT_USER_ID, ...(title ? { title } : {}) }),
    });
    return readResponse(response, '复制白板失败');
  },

  remove: async (id: string): Promise<{ id: string; deleted_at: string }> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}?${userQuery()}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    return readResponse(response, '删除白板失败');
  },

  references: async (id: string): Promise<WhiteboardReference[]> => {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}/references?${userQuery()}`, {
      credentials: 'same-origin',
    });
    return readResponse(response, '读取白板引用失败');
  },

  uploadAsset: async (
    id: string,
    fileId: string,
    blob: Blob,
    created?: number,
  ): Promise<WhiteboardAsset & { url: string }> => {
    const form = new FormData();
    form.append('file', blob, `whiteboard-${fileId}`);
    const params = new URLSearchParams({
      userId: CURRENT_USER_ID,
      fileId,
      ...(created ? { created: String(created) } : {}),
    });
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}/assets?${params}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    return readResponse(response, '上传白板图片失败');
  },

  uploadPreview: async (id: string, revision: number, blob: Blob): Promise<void> => {
    const form = new FormData();
    form.append('file', blob, `preview-${revision}.png`);
    const params = new URLSearchParams({ userId: CURRENT_USER_ID, revision: String(revision) });
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}/preview?${params}`, {
      method: 'PUT',
      credentials: 'same-origin',
      body: form,
    });
    await readResponse(response, '上传白板缩略图失败');
  },
};
