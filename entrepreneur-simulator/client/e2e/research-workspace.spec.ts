import { expect, test } from '@playwright/test';

const makeResearchDocument = (id: string, title: string, body: string) => ({
  id,
  title,
  category: 'note',
  domain: 'research',
  research_type: 'document',
  research_status: null,
  promoted_to_life: false,
  tags: [],
  version: 'V1.0',
  created_at: '2026/7/14',
  updated_at: '2026/7/14',
  content: body,
  content_json: {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: { blockId: `${id}-paragraph` },
      content: [{ type: 'text', text: body }],
    }],
  },
  content_schema_version: 2,
  content_revision: 1,
  related: { scenes: [], people: [], sops: [] },
  history: [],
  validation: [],
  stats: { use_count: 0, avg_score: 0, last_used: '-', related_scenes_count: 0 },
});

test('research documents switch immediately while the previous document saves in the background', async ({ page }) => {
  const documents = [
    makeResearchDocument('research-a', '文档 A', 'A 的正文'),
    makeResearchDocument('research-b', '文档 B', 'B 的正文'),
  ];
  let releaseSave = () => undefined;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === 'GET' && pathname === '/api/sop/user-1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(documents) });
      return;
    }
    if (request.method() === 'GET' && pathname === '/api/people/user-1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (request.method() === 'POST' && pathname === '/api/sop/create') {
      await saveGate;
      const body = request.postDataJSON() as { id: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: body.id, content_revision: 2, content_schema_version: 2 }),
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.setViewportSize({ width: 1478, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.setItem('nmdd.research.library-collapsed', 'false');
  });
  await page.goto('/research?type=document&doc=research-a');

  const titleInput = page.getByPlaceholder('科研记录标题');
  await expect(titleInput).toHaveValue('文档 A');

  const promoteButton = page.getByRole('button', { name: '上浮到人生主线' });
  await expect(promoteButton).toBeVisible();
  const promoteMetrics = await promoteButton.evaluate((element) => {
    const label = element.querySelector<HTMLElement>('.research-promote-button__label');
    const style = window.getComputedStyle(element);
    const labelStyle = label ? window.getComputedStyle(label) : null;
    return {
      height: element.getBoundingClientRect().height,
      whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak,
      labelDisplay: labelStyle?.display,
      labelHeight: label?.getBoundingClientRect().height || 0,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(promoteMetrics.whiteSpace).toBe('nowrap');
  expect(promoteMetrics.wordBreak).toBe('keep-all');
  expect(promoteMetrics.height).toBeLessThanOrEqual(42);
  expect(promoteMetrics.scrollWidth).toBeLessThanOrEqual(promoteMetrics.clientWidth + 1);
  if (promoteMetrics.labelDisplay !== 'none') {
    expect(promoteMetrics.labelHeight).toBeLessThanOrEqual(22);
  }

  await titleInput.fill('文档 A（等待保存）');
  await page.getByText('文档 B', { exact: true }).click();

  await expect(page).toHaveURL(/doc=research-b/, { timeout: 1_500 });
  await expect(titleInput).toHaveValue('文档 B', { timeout: 1_500 });
  await expect(
    page.getByTestId('research-document-workspace').locator('.ProseMirror').getByText('B 的正文', { exact: true }),
  ).toBeVisible();

  releaseSave();
});

test('fullscreen preserves document geometry, closes its menu, and keeps tables aligned', async ({ page }) => {
  const researchDocument: any = makeResearchDocument('research-layout', '全屏排版验收', '表格正文');
  researchDocument.content_json = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'layout-paragraph' },
        content: [{ type: 'text', text: '全屏前后不应重新乱版。' }],
      },
      {
        type: 'table',
        attrs: { blockId: 'layout-table' },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '状态' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '流程图' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已修复' }] }] },
            ],
          },
        ],
      },
    ],
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/sop/user-1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([researchDocument]) });
      return;
    }
    if (request.method() === 'GET' && pathname === '/api/people/user-1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.setViewportSize({ width: 1478, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.setItem('nmdd.research.library-collapsed', 'false');
    window.localStorage.setItem('nmdd.document-editor.width', 'full');
  });
  await page.goto('/research?type=document&doc=research-layout');

  const workspace = page.getByTestId('research-document-workspace');
  const table = workspace.locator('.tableWrapper');
  await expect(table).toBeVisible();
  await expect(table.locator('tr')).toHaveCount(2);
  const before = await workspace.evaluate((element) => {
    const pageElement = element.querySelector<HTMLElement>('.smart-document-shell__page');
    const rail = element.querySelector<HTMLElement>('.smart-document-content-rail');
    const tableElement = element.querySelector<HTMLElement>('.tableWrapper');
    return {
      pageWidth: pageElement?.getBoundingClientRect().width || 0,
      railWidth: rail?.getBoundingClientRect().width || 0,
      tableWidth: tableElement?.getBoundingClientRect().width || 0,
    };
  });

  await page.getByRole('button', { name: '页面显示设置' }).click();
  await page.getByRole('button', { name: '专注全屏' }).click();
  await expect(workspace).toHaveAttribute('data-fullscreen', 'true');
  await expect(page.getByRole('dialog', { name: '页面显示设置' })).toHaveCount(0);
  await expect(workspace).toHaveAttribute('data-fullscreen-width-locked', 'true');

  const after = await workspace.evaluate((element) => {
    const pageElement = element.querySelector<HTMLElement>('.smart-document-shell__page');
    const rail = element.querySelector<HTMLElement>('.smart-document-content-rail');
    const tableElement = element.querySelector<HTMLElement>('.tableWrapper');
    return {
      pageWidth: pageElement?.getBoundingClientRect().width || 0,
      railWidth: rail?.getBoundingClientRect().width || 0,
      tableWidth: tableElement?.getBoundingClientRect().width || 0,
      bodyOverflow: document.body.style.overflow,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(Math.abs(after.pageWidth - before.pageWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.railWidth - before.railWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.tableWidth - before.tableWidth)).toBeLessThanOrEqual(2);
  expect(after.bodyOverflow).toBe('hidden');
  expect(after.documentOverflow).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(workspace).toHaveAttribute('data-fullscreen', 'false');
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});
