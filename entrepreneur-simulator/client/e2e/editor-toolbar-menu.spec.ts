import { expect, test } from '@playwright/test';
import { clearEditor } from './editorTestUtils';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', async route => {
    await route.fulfill({
      body: JSON.stringify({ authenticated: true }),
      contentType: 'application/json',
      status: 200,
    });
  });
});

test('block type menu opens above the toolbar without covering the editor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/editor-lab');

  const trigger = page.getByRole('button', { name: '当前块类型' });
  await trigger.click();

  const menu = page.getByRole('listbox', { name: '块类型' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-side', 'top');

  const [triggerBox, menuBox, editorBox] = await Promise.all([
    trigger.boundingBox(),
    menu.boundingBox(),
    page.getByTestId('editor-surface').boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y - 7);
  expect(menuBox!.y + menuBox!.height).toBeLessThan(editorBox!.y);

  await menu.getByRole('option', { name: /二级标题/ }).click();
  await expect(trigger).toContainText('二级标题');
  await expect(page.getByTestId('editor-surface').locator('h2').first()).toContainText('Editor Lab');
});

test('empty paragraphs do not show the floating insert toolbar', async ({ page }) => {
  await page.goto('/editor-lab');
  await clearEditor(page);

  await expect(page.getByRole('toolbar', { name: '插入内容' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '当前块类型' })).toBeVisible();
});

test('mobile block type menu stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 780 });
  await page.goto('/editor-lab');
  await page.getByRole('button', { name: '当前块类型' }).click();

  const menu = page.getByRole('listbox', { name: '块类型' });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(404);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(772);
});

test('ported menu inherits the editor dark theme', async ({ page }) => {
  await page.goto('/editor-lab');
  await page.getByTestId('theme-dark').click();
  const trigger = page.getByRole('button', { name: '当前块类型' });
  await trigger.click();

  const menu = page.getByRole('listbox', { name: '块类型' });
  const [triggerSurface, menuSurface] = await Promise.all([
    trigger.evaluate(element => getComputedStyle(element).getPropertyValue('--smart-doc-surface-raised').trim()),
    menu.evaluate(element => getComputedStyle(element).getPropertyValue('--smart-doc-surface-raised').trim()),
  ]);
  expect(menuSurface).toBe(triggerSurface);
  expect(menuSurface).toBe('#262624');
});
