import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import { whiteboardApi, whiteboardAssetUrl } from '../api/whiteboardApi';
import type { WhiteboardAsset } from '../model';

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('白板图片数据无效');
  return response.blob();
};
export const uploadMissingWhiteboardAssets = async (
  whiteboardId: string,
  files: BinaryFiles,
  knownFileIds: Set<string>,
): Promise<Set<string>> => {
  const nextKnown = new Set(knownFileIds);
  for (const file of Object.values(files || {})) {
    const fileId = String(file.id);
    if (nextKnown.has(fileId)) continue;
    const blob = await dataUrlToBlob(String(file.dataURL));
    await whiteboardApi.uploadAsset(whiteboardId, fileId, blob, file.created);
    nextKnown.add(fileId);
  }
  return nextKnown;
};

export const hydrateWhiteboardAssets = async (
  whiteboardId: string,
  assets: WhiteboardAsset[],
  signal?: AbortSignal,
): Promise<BinaryFiles> => {
  const entries = await Promise.all((assets || []).map(async (asset) => {
    const response = await fetch(whiteboardAssetUrl(whiteboardId, asset.file_id), {
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) throw new Error(`加载白板图片失败：${asset.file_id}`);
    const dataURL = await blobToDataUrl(await response.blob());
    const metadata = asset.file_metadata || {};
    const file: BinaryFileData = {
      id: asset.file_id as BinaryFileData['id'],
      dataURL: dataURL as BinaryFileData['dataURL'],
      mimeType: asset.mime_type as BinaryFileData['mimeType'],
      created: Number(metadata.created) || Date.now(),
      lastRetrieved: Date.now(),
      ...(Number.isFinite(Number(metadata.version)) ? { version: Number(metadata.version) } : {}),
    };
    return [asset.file_id, file] as const;
  }));
  return Object.fromEntries(entries) as BinaryFiles;
};
