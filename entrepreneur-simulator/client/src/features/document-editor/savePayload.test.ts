import { describe, expect, it } from 'vitest';

import { withoutRelationsForDocumentAutosave } from './savePayload';

describe('withoutRelationsForDocumentAutosave', () => {
  it('removes relationship collections without mutating the editor document', () => {
    const document = {
      id: 'document-1',
      title: 'Draft',
      content: 'Updated body',
      related: {
        scenes: [{ id: 'scene-1' }],
        people: [{ id: 'person-1' }],
      },
    };

    const payload = withoutRelationsForDocumentAutosave(document);

    expect(payload).toEqual({
      id: 'document-1',
      title: 'Draft',
      content: 'Updated body',
    });
    expect(payload).not.toHaveProperty('related');
    expect(document.related.people).toEqual([{ id: 'person-1' }]);
  });
});
