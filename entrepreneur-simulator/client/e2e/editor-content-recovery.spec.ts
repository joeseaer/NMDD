import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', async route => {
    await route.fulfill({
      body: JSON.stringify({ authenticated: true }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('invalid legacy JSON stays locked until a backed-up repair succeeds', async ({ page }) => {
  let repairPayload: Record<string, unknown> | null = null;
  await page.route('**/api/sop/lab-recovery-document/repair-content', async route => {
    repairPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      body: JSON.stringify({
        id: 'lab-recovery-document',
        content_schema_version: 2,
        content_revision: 5,
        revision_supported: true,
        recovery_backup: {
          version: 'recovery-backup-r4-test',
          content_revision: 4,
        },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/editor-lab?fixture=invalid-json');

  const warning = page.getByText('这份文档需要安全修复');
  const editable = page.locator('.smart-document-content');
  await expect(warning).toBeVisible();
  await expect(page.getByText('旧文档正文已从安全备份恢复。')).toBeVisible();
  await expect(editable).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: '当前块类型' })).toHaveCount(0);
  await expect(page.getByTestId('editor-change-count')).toHaveText('0');

  await page.getByRole('button', { name: '查看修复预览' }).click();
  await expect(page.getByRole('heading', { name: '原始结构化 JSON' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '待保存的 Markdown' })).toBeVisible();
  await expect(page.getByText('legacyUnknownBlock', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: '修复并保存' }).click();
  await expect(warning).toHaveCount(0);
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByRole('button', { name: '当前块类型' })).toBeVisible();
  expect(repairPayload).toMatchObject({
    content_schema_version: 2,
    expected_revision: 4,
    content_json: { type: 'doc' },
  });
  expect(String(repairPayload?.content)).toContain('Markdown 恢复副本');
});

test('recovery preview stacks safely on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/editor-lab?fixture=invalid-json');
  await page.getByRole('button', { name: '查看修复预览' }).click();

  const panels = page.locator('.smart-document-recovery-preview section');
  const first = await panels.nth(0).boundingBox();
  const second = await panels.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  expect(first!.x).toBeGreaterThanOrEqual(0);
  expect(first!.x + first!.width).toBeLessThanOrEqual(390);
});
