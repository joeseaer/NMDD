import { expect, test } from '@playwright/test';

test('research creation opts in per document and website can revoke, reload and retry failed changes', async ({ page }) => {
  const records: any[] = [];
  const creations: any[] = [];
  let failAccess = false;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const send = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/session') return send(200, { authenticated: true });
    if (path === '/api/sop/user-1') return send(200, records);
    if (path === '/api/people/user-1') return send(200, []);
    if (path === '/api/sop/create') {
      const input = request.postDataJSON();
      if (!input.id) {
        creations.push(input);
        const id = `created-${creations.length}`;
        records.push({ ...input, id, content_revision: 1, content_schema_version: 2,
          created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z' });
        return send(200, { id, content_revision: 1, content_schema_version: 2 });
      }
      return send(200, { id: input.id, content_revision: 2, content_schema_version: 2 });
    }
    if (request.method() === 'PATCH' && path.endsWith('/chatgpt-access')) {
      if (failAccess) return send(503, { error: '授权保存失败，请重试' });
      const id = path.split('/').at(-2);
      const record = records.find(record => record.id === id);
      record.chatgpt_access = request.postDataJSON().enabled;
      return send(200, { id, chatgpt_access: record.chatgpt_access });
    }
    return send(404, {});
  });
  await page.setViewportSize({ width: 1478, height: 1000 });
  await page.goto('/research?type=document');
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建文档' });
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByPlaceholder('科研记录标题')).toBeVisible();
  expect(creations[0].chatgpt_access).toBe(false);
  const access = page.getByRole('switch', { name: '允许 ChatGPT 读取和修改' });
  await expect(access).not.toBeChecked();
  await access.click();
  await expect(access).toBeChecked();
  await page.reload();
  await expect(access).toBeChecked();
  failAccess = true;
  await access.click();
  await expect(page.getByRole('alert').filter({ hasText: '授权保存失败，请重试' })).toBeVisible();
  await expect(access).toBeChecked();
  failAccess = false;
  await access.click();
  await expect(access).not.toBeChecked();
  await page.reload();
  await expect(access).not.toBeChecked();

  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(access).toBeChecked();
  expect(creations[1].chatgpt_access).toBe(true);

  await page.getByRole('button', { name: '新建子页面', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(access).not.toBeChecked();
  expect(creations[2].parent_id).toBe('created-2');
  expect(creations[2].chatgpt_access).toBe(false);
});
