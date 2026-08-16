import { deleteDB, openDB } from 'idb';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { WhiteboardScene } from '../model';

const DB_NAME = 'nmdd-whiteboard-drafts';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;

export type StoredWhiteboardDraft = {
  version: 1;
  whiteboardId: string;
  baseRevision: number;
  title: string;
  scene: WhiteboardScene;
  files: BinaryFiles;
  savedAt: string;
};

const getDatabase = () => openDB(DB_NAME, DB_VERSION, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
  },
});

export const readWhiteboardDraft = async (id: string): Promise<StoredWhiteboardDraft | null> => {
  try {
    const database = await getDatabase();
    const value = await database.get(STORE_NAME, id);
    return value && value.version === 1 && value.whiteboardId === id ? value : null;
  } catch {
    return null;
  }
};

export const writeWhiteboardDraft = async (draft: StoredWhiteboardDraft): Promise<void> => {
  try {
    const database = await getDatabase();
    await database.put(STORE_NAME, draft, draft.whiteboardId);
  } catch {
    // IndexedDB is best effort. The in-memory queue remains authoritative.
  }
};

export const clearWhiteboardDraft = async (id: string): Promise<void> => {
  try {
    const database = await getDatabase();
    await database.delete(STORE_NAME, id);
  } catch {
    // Best effort after a confirmed server save.
  }
};

export const clearAllWhiteboardDraftsForTests = () => deleteDB(DB_NAME);
