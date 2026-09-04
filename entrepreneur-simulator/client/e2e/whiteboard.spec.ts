import { expect, test } from '@playwright/test';

const BOARD = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user_001',
  title: '产品架构白板',
  scene_schema_version: 1,
  content_revision: 3,
  preview_revision: null,
  created_at: '2026-08-16T08:00:00.000Z',
  updated_at: '2026-08-16T08:30:00.000Z',
};

test.beforeEach(async ({ page }) => {
  let scene = { type: 'excalidraw', version: 2, source: 'nmdd', elements: [], appState: {} };
  let revision = BOARD.content_revision;

  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true }),
  }));

  await page.route('**/api/whiteboards**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === 'GET' && pathname === '/api/whiteboards') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([BOARD]) });
    }
    if (request.method() === 'GET' && pathname === `/api/whiteboards/${BOARD.id}`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...BOARD,
          content_revision: revision,
          scene_json: scene,
          preview_object_key: null,
          deleted_at: null,
          assets: [],
        }),
      });
    }
    if (request.method() === 'PATCH' && pathname === `/api/whiteboards/${BOARD.id}`) {
      const body = request.postDataJSON();
      if (body.scene) scene = body.scene;
      revision += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...BOARD, title: body.title || BOARD.title, content_revision: revision }),
      });
    }
    if (request.method() === 'PUT' && pathname === `/api/whiteboards/${BOARD.id}/preview`) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unmocked' }) });
  });
});

test('persists text and reopens a scene without serialized runtime collaborator state', async ({ page }) => {
  const saveRequest = page.waitForRequest(request => (
    request.method() === 'PATCH'
    && new URL(request.url()).pathname === `/api/whiteboards/${BOARD.id}`
  ));

  await page.goto(`/whiteboards/${BOARD.id}`);
  await expect(page.getByTestId('whiteboard-editor')).toBeVisible({ timeout: 30_000 });

  await page.getByTitle(/文字/).click();
  await page.locator('.excalidraw').click({ position: { x: 500, y: 300 } });
  await page.locator('textarea.excalidraw-wysiwyg').fill('保存后仍可见');
  await page.keyboard.press('Escape');

  const request = await saveRequest;
  const payload = request.postDataJSON();
  expect(payload.scene.elements).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', text: '保存后仍可见' }),
  ]));
  expect(payload.scene.appState).not.toHaveProperty('collaborators');

  await page.reload();
  await expect(page.getByTestId('whiteboard-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('页面加载失败')).toHaveCount(0);
});

test('lists, filters, opens and autosaves a standalone whiteboard', async ({ page }) => {
  const saveRequest = page.waitForRequest(request => (
    request.method() === 'PATCH'
    && new URL(request.url()).pathname === `/api/whiteboards/${BOARD.id}`
  ));

  await page.goto('/whiteboards');
  await expect(page.getByTestId('whiteboard-library')).toBeVisible();
  await expect(page.getByText(BOARD.title)).toBeVisible();

  await page.getByPlaceholder('搜索白板').fill('不存在');
  await expect(page.getByText(BOARD.title)).toBeHidden();
  await page.getByPlaceholder('搜索白板').fill('产品');
  await page.getByText(BOARD.title).click();

  await expect(page).toHaveURL(`/whiteboards/${BOARD.id}`);
  await expect(page.getByTestId('whiteboard-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('白板标题').fill('产品架构白板 v2');

  const request = await saveRequest;
  expect(request.postDataJSON()).toMatchObject({
    title: '产品架构白板 v2',
    expected_revision: 3,
  });
});

test('renames a board from the library with optimistic revision protection', async ({ page }) => {
  await page.goto('/whiteboards');
  await expect(page.getByText(BOARD.title)).toBeVisible();
  await page.getByLabel('白板操作').click();

  page.once('dialog', dialog => dialog.accept('新版产品架构'));
  const requestPromise = page.waitForRequest(request => (
    request.method() === 'PATCH'
    && new URL(request.url()).pathname === `/api/whiteboards/${BOARD.id}`
  ));
  await page.getByRole('button', { name: '重命名' }).click();

  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    title: '新版产品架构',
    expected_revision: 3,
  });
  await expect(page.getByText('新版产品架构')).toBeVisible();
});
