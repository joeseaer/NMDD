export type WhiteboardScene = {
  type: 'excalidraw';
  version: 2;
  source: 'nmdd';
  elements: readonly any[];
  appState: Record<string, any>;
};

const NON_PERSISTED_APP_STATE_KEYS = [
  // Excalidraw keeps active collaborators in a Map. JSON turns that Map into
  // `{}`, which then crashes Excalidraw on the next load because it calls
  // `collaborators.forEach(...)`.
  'collaborators',
  // These are editor-session state, not whiteboard content.
  'selectedElementIds',
  'selectedGroupIds',
  'editingElement',
  'editingGroupId',
  'editingTextElement',
  'editingLinearElement',
  'selectedLinearElement',
  'newElement',
  'selectionElement',
  'resizingElement',
  'draggingElement',
] as const;

const isRecord = (value: unknown): value is Record<string, any> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Removes editor-only values before a scene is persisted or passed back into
 * Excalidraw. It also makes whiteboards written by older clients recoverable.
 */
export const sanitizeWhiteboardScene = (value: unknown): WhiteboardScene => {
  const scene = isRecord(value) ? value : {};
  const appState = isRecord(scene.appState) ? { ...scene.appState } : {};
  for (const key of NON_PERSISTED_APP_STATE_KEYS) delete appState[key];

  return {
    type: 'excalidraw',
    version: 2,
    source: 'nmdd',
    elements: Array.isArray(scene.elements)
      ? scene.elements.filter(isRecord)
      : [],
    appState,
  };
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
