import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import { whiteboardApi } from '../api/whiteboardApi';
import { hydrateWhiteboardAssets, uploadMissingWhiteboardAssets } from './assetTransport';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('whiteboard asset transport', () => {
  it('uploads only files that are not already known by the server', async () => {
    const upload = vi.spyOn(whiteboardApi, 'uploadAsset').mockResolvedValue({
      file_id: 'new-file',
      mime_type: 'image/png',
      byte_size: 68,
      sha256: 'a'.repeat(64),
      url: '/asset',
    });
    const files = {
      known: { id: 'known', dataURL: PNG_DATA_URL, mimeType: 'image/png', created: 1 },
      'new-file': { id: 'new-file', dataURL: PNG_DATA_URL, mimeType: 'image/png', created: 2 },
    } as unknown as BinaryFiles;

    const known = await uploadMissingWhiteboardAssets('board-1', files, new Set(['known']));

    expect(upload).toHaveBeenCalledTimes(1);
    const [boardId, fileId, blob, created] = upload.mock.calls[0];
    expect([boardId, fileId, created]).toEqual(['board-1', 'new-file', 2]);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
    expect([...known].sort()).toEqual(['known', 'new-file']);
  });

  it('hydrates private server assets back into Excalidraw binary files', async () => {
    const pngBytes = Uint8Array.from(atob(PNG_DATA_URL.split(',')[1]), value => value.charCodeAt(0));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new window.Blob([pngBytes], { type: 'image/png' }),
    }));

    const files = await hydrateWhiteboardAssets('board-1', [{
      file_id: 'file-1',
      mime_type: 'image/png',
      byte_size: pngBytes.length,
      sha256: 'b'.repeat(64),
      file_metadata: { created: 42 },
    }]);

    expect(files['file-1']?.mimeType).toBe('image/png');
    expect(files['file-1']?.created).toBe(42);
    expect(String(files['file-1']?.dataURL)).toMatch(/^data:image\/png;base64,/);
  });
});
