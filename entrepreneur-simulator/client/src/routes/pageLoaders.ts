export const pageLoaders = {
  dashboard: () => import('../pages/Dashboard'),
  training: () => import('../pages/Training'),
  review: () => import('../pages/Review'),
  notes: () => import('../pages/NoteManager'),
  'real-review': () => import('../pages/RealReview'),
  assistant: () => import('../pages/ChatAssistant'),
  'evolution-tree': () => import('../pages/EvolutionTree'),
  settings: () => import('../pages/Settings'),
  planner: () => import('../pages/Planner'),
  research: () => import('../pages/ResearchWorkspace'),
  'editor-lab': () => import('../pages/EditorLab'),
  relationships: () => import('../features/relationships/Relationships'),
  whiteboards: () => import('../pages/Whiteboards'),
  wardrobe: () => import('../pages/Wardrobe'),
  whiteboardEditor: () => import('../pages/WhiteboardEditorPage'),
};

export function preloadPage(to: string) {
  const [section, id] = to.split(/[?#]/)[0].split('/').filter(Boolean);
  const key = section === 'whiteboards' && id ? 'whiteboardEditor'
    : section === 'personality' ? 'relationships' : section;
  const loader = pageLoaders[key as keyof typeof pageLoaders];
  return loader?.();
}
