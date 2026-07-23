import { describe, expect, it } from 'vitest';
import { createMindMapBlockDocument } from './createDocument';
import { validateMindMapDocument } from './validation';

const ids = [
  '018f0000-0000-7000-8000-000000000001',
  '018f0000-0000-7000-8000-000000000002',
  '018f0000-0000-7000-8000-000000000003',
  '018f0000-0000-7000-8000-000000000004',
];

describe('createMindMapBlockDocument', () => {
  it('creates a complete canonical document for a new Tiptap block', () => {
    let index = 0;
    const document = createMindMapBlockDocument({
      rootTitle: '中心主题',
      idFactory: () => ids[index++],
    });

    expect(validateMindMapDocument(document)).toMatchObject({ valid: true });
    expect(Object.values(document.sheets)[0].topics[Object.values(document.sheets)[0].rootTopicId])
      .toMatchObject({ role: 'central' });
  });
});

