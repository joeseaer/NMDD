import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { editor, markTypes, readEditorJson } from './editorTestUtils';

test.describe('Editor Lab interaction and layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor-lab');
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(editor(page)).toContainText('Editor Lab');
  });

  test('mode, theme and keyboard formatting controls expose deterministic state', async ({ page }) => {
    await page.getByTestId('mode-read').click();
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-mode', 'read');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('.smart-document-toolbar')).toHaveCount(0);

    await page.getByTestId('theme-dark').click();
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.smart-document')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('mode-edit').click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
    await editor(page).locator('p').last().click();
    await page.keyboard.press('Control+B');
    await page.keyboard.type('KeyboardBold');
    await expect(editor(page)).toContainText('KeyboardBold');
    await expect.poll(async () => markTypes(await readEditorJson(page))).toContain('bold');

    await page.getByTestId('theme-system').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-lab')).toHaveAttribute('data-theme', 'system');
    await expect(page.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true');
  });

  test('mobile viewport keeps the document and controls inside the canvas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(page.getByTestId('mode-edit')).toBeVisible();
    await expect(editor(page)).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    const editorBox = await page.getByTestId('editor-surface').boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.x).toBeGreaterThanOrEqual(0);
    expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(391);
  });

  test('edit and read surfaces have no WCAG A/AA violations', async ({ page }) => {
    const editResults = await new AxeBuilder({ page })
      .include('[data-testid="editor-lab"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(editResults.violations).toEqual([]);

    await page.getByTestId('mode-read').click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    const readResults = await new AxeBuilder({ page })
      .include('[data-testid="editor-lab"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(readResults.violations).toEqual([]);
  });

  test('invalid legacy JSON falls back to the Markdown recovery copy instead of an empty document', async ({ page }) => {
    await page.goto('/editor-lab?fixture=invalid-json');
    await expect(page.locator('.smart-document-recovery-warning')).toContainText('Markdown 备份');
    await expect(editor(page)).toContainText('Markdown 恢复副本');
    await expect(editor(page)).toContainText('旧文档正文已从安全备份恢复');
    await expect(editor(page)).not.toContainText('Editor Lab：结构化文档验收');
  });

  test('opening legacy content does not autosave solely to hydrate missing block IDs', async ({ page }) => {
    await expect(page.getByTestId('editor-change-count')).toHaveText('0');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('editor-change-count')).toHaveText('0');
  });
});
