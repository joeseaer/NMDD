import { expect, test } from '@playwright/test';
import { editor } from './editorTestUtils';

const skipUnsupportedProject = (projectName: string) => {
  test.skip(
    !['chromium', 'mobile-chromium'].includes(projectName),
    'Visual baselines are intentionally maintained for desktop and mobile Chromium.',
  );
};

const settleVisualState = async (page: Parameters<typeof editor>[0]) => {
  await expect(editor(page)).toContainText('Editor Lab');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
};

test('Editor Lab light read mode visual baseline', async ({ page }, testInfo) => {
  skipUnsupportedProject(testInfo.project.name);

  await page.goto('/editor-lab');
  await settleVisualState(page);
  await page.getByTestId('mode-read').click();
  await page.getByTestId('theme-light').click();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');

  await expect(page.getByTestId('editor-lab')).toHaveScreenshot('editor-lab-read.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  });
});

test('Editor Lab light edit mode visual baseline', async ({ page }, testInfo) => {
  skipUnsupportedProject(testInfo.project.name);

  await page.goto('/editor-lab');
  await settleVisualState(page);
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('theme-light').click();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');

  await expect(page.getByTestId('editor-lab')).toHaveScreenshot('editor-lab-edit-light.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  });
});

test('Editor Lab dark read mode visual baseline', async ({ page }, testInfo) => {
  skipUnsupportedProject(testInfo.project.name);

  await page.goto('/editor-lab');
  await settleVisualState(page);
  await page.getByTestId('mode-read').click();
  await page.getByTestId('theme-dark').click();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');

  await expect(page.getByTestId('editor-lab')).toHaveScreenshot('editor-lab-read-dark.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  });
});
