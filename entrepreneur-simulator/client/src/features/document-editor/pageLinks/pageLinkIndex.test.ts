import { describe, expect, it } from 'vitest';
import { collectLinkedPageIds, documentLinksToPage } from './pageLinkIndex';

describe('page link index', () => {
  const content = {
    type: 'doc',
    content: [{
      type: 'columnList',
      content: [{
        type: 'column',
        content: [{ type: 'pageLinkBlock', attrs: { pageId: 'research-1' } }],
      }],
    }],
  };

  it('indexes links nested inside layout blocks', () => {
    expect([...collectLinkedPageIds(content)]).toEqual(['research-1']);
    expect(documentLinksToPage(content, 'research-1')).toBe(true);
    expect(documentLinksToPage(content, 'missing')).toBe(false);
  });
});
