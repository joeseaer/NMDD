export type WhiteboardScene = {
  type: 'excalidraw';
  version: 2;
  source: 'nmdd';
  elements: readonly any[];
  appState: Record<string, any>;
};
export type WhiteboardAsset = {
  file_id: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  file_metadata?: Record<string, any> | null;
  created_at?: string;
};

export type WhiteboardSummary = {
  id: string;
  user_id: string;
  title: string;
  scene_schema_version: number;
  content_revision: number;
  preview_revision?: number | null;
  created_at: string;
  updated_at: string;
};

export type Whiteboard = WhiteboardSummary & {
  scene_json: WhiteboardScene;
  preview_object_key?: string | null;
  deleted_at?: string | null;
  assets: WhiteboardAsset[];
};

export type WhiteboardReference = {
  sop_id: string;
  block_id: string;
  created_at: string;
  document: {
    id: string;
    title: string;
    domain?: string | null;
    research_type?: string | null;
  } | null;
};

export type WhiteboardSavePhase = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export type WhiteboardSaveStatus = {
  phase: WhiteboardSavePhase;
  message?: string;
};

export const EMPTY_WHITEBOARD_SCENE: WhiteboardScene = {
  type: 'excalidraw',
  version: 2,
  source: 'nmdd',
  elements: [],
  appState: {},
};
