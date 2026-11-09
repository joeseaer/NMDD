import { expect, test } from '@playwright/test';

test('research documents open before optional people finish and survive a people lookup failure', async ({ page }) => {
  const document = {
    id: 'performance-document', title: '性能验收文档', category: 'note',
    domain: 'research', research_type: 'document', tags: [], version: 'V1.0',
    created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z',
    content: '这段正文无需等待人物列表。',
    content_json: {
      type: 'doc', content: [{
        type: 'paragraph', attrs: { blockId: 'performance-paragraph' },
        content: [{ type: 'text', text: '这段正文无需等待人物列表。' }],
      }],
    },
    content_schema_version: 2, content_revision: 1,
    related: { scenes: [], people: [], sops: [] }, history: [], validation: [],
  };
  let releasePeople!: () => void;
  let peopleFinished = false;
  const peopleGate = new Promise<void>(resolve => { releasePeople = resolve; });
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { authenticated: true } });
    if (path.startsWith('/api/sop/')) return route.fulfill({ json: [document] });
    if (path.startsWith('/api/people/')) {
      await peopleGate;
      await route.fulfill({ status: 503, json: { error: '人物查询暂时不可用' } });
      peopleFinished = true;
      return;
    }
    return route.fulfill({ status: 404, json: { error: 'unmocked' } });
  });
  try {
    await page.goto('/research?type=document&doc=performance-document');
    await expect(page.getByPlaceholder('科研记录标题')).toHaveValue('性能验收文档', { timeout: 30000 });
    await expect(page.locator('.ProseMirror')).toContainText('这段正文无需等待人物列表。');
    expect(peopleFinished).toBe(false);
    releasePeople();
    await expect.poll(() => peopleFinished).toBe(true);
    await expect(page.getByPlaceholder('科研记录标题')).toHaveValue('性能验收文档');
    await expect(page.getByText('无法载入科研记录')).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  } finally {
    releasePeople();
  }
});
