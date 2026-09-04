import { describe, expect, it } from 'vitest';
import { sanitizeWhiteboardScene } from './model';

describe('sanitizeWhiteboardScene', () => {
  it('removes JSON-corrupted collaborator state without losing text elements', () => {
    const scene = sanitizeWhiteboardScene({
      elements: [{ id: 'text-1', type: 'text', text: '保存后仍可见', isDeleted: false }],
      appState: {
        collaborators: {},
        selectedElementIds: { 'text-1': true },
        viewBackgroundColor: '#ffffff',
      },
    });

    expect(scene.elements).toEqual([
      { id: 'text-1', type: 'text', text: '保存后仍可见', isDeleted: false },
    ]);
    expect(scene.appState).toEqual({ viewBackgroundColor: '#ffffff' });
    expect(scene.appState).not.toHaveProperty('collaborators');
  });
});
