import { expect, test } from '@playwright/test';
import { editor } from './editorTestUtils';

test.describe('Document outline overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/session', async route => {
      await route.fulfill({
        body: JSON.stringify({ authenticated: true }),
        contentType: 'application/json',
        status: 200,
      });
    });
    await page.goto('/editor-lab');
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(editor(page)).toContainText('Editor Lab');
  });

  test('opens without narrowing the document and remains available while reading', async ({ page }, testInfo) => {
    const documentContent = page.locator('.smart-document-content-rail');
    const widthBefore = await documentContent.evaluate(element => element.getBoundingClientRect().width);

    await page.getByRole('button', { name: '显示文档大纲' }).click();
    const outline = page.getByRole('complementary', { name: '文档大纲' });
    await expect(outline).toBeVisible();

    const widthAfter = await documentContent.evaluate(element => element.getBoundingClientRect().width);
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);

    await outline.getByRole('button', { name: '代码与公式' }).click();
    if (testInfo.project.name.includes('mobile')) {
      await expect(outline).toHaveCount(0);
    } else {
      await expect(outline.getByRole('button', { name: '代码与公式' })).toHaveAttribute('aria-current', 'location');
      await expect(outline).toBeInViewport();
    }

    await page.getByTestId('mode-read').click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await page.getByRole('button', { name: '显示文档大纲' }).click();
    await expect(outline).toBeVisible();
    await expect(outline.getByRole('button', { name: 'Editor Lab：结构化文档验收' })).toBeVisible();
  });

  test('keeps the floating panel visible as the document scrolls', async ({ page }) => {
    await page.getByRole('button', { name: '显示文档大纲' }).click();
    const outline = page.getByRole('complementary', { name: '文档大纲' });
    await expect(outline).toBeVisible();

    await page.mouse.wheel(0, 1200);
    await expect(outline).toBeVisible();
    await expect(outline).toBeInViewport();
  });

  test('uses a mobile drawer and closes it after navigation', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only drawer behavior');

    await page.getByRole('button', { name: '显示文档大纲' }).click();
    const outline = page.getByRole('complementary', { name: '文档大纲' });
    await expect(outline).toBeVisible();

    const bounds = await outline.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);

    await outline.getByRole('button', { name: '代码与公式' }).click();
    await expect(outline).toHaveCount(0);
  });
});
