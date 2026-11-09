import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
const fixture = resolve('../server/tests/fixtures/wardrobe/mock-ten.zip');
test.beforeEach(async ({page})=>{
  await page.request.post('/api/auth/login',{data:{username:'wardrobe-e2e',password:'wardrobe-e2e-password'}});
  await page.request.post('http://127.0.0.1:3101/__test/reset');
});
async function importFixture(page: import('@playwright/test').Page) {
  await page.goto('/wardrobe');
  await page.getByLabel('选择衣橱 ZIP').setInputFiles(fixture);
  await expect(page.getByRole('dialog',{name:'批量导入预览'})).toBeVisible();
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'批量导入预览'}).getByRole('status')).toContainText('新增 10');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
}
test('imports corrected ZIP, persists photos across fresh login, skips duplicates and exports',async({page,browser},testInfo)=>{
  await page.goto('/wardrobe');
  await page.getByLabel('选择衣橱 ZIP').setInputFiles(fixture);
  await page.getByLabel('1. 名称',{exact:true}).fill('会议蓝色衬衫');
  await page.getByRole('button',{name:'确认导入',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'批量导入预览'}).getByRole('status')).toContainText('新增 10');
  await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'会议蓝色衬衫'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'会议蓝色衬衫'})).toBeVisible();
  await expect.poll(()=>page.locator('img[alt="会议蓝色衬衫"]').evaluate((image:HTMLImageElement)=>image.complete && image.naturalWidth>0)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('wardrobe-gallery.png'),fullPage:true});
  const context=await browser.newContext();
  const other=await context.newPage();await other.goto('http://127.0.0.1:5178/wardrobe');
  await expect(other.getByRole('button',{name:'登录',exact:true})).toBeVisible();
  await other.getByLabel('账号').fill('wardrobe-e2e');await other.getByLabel('密码').fill('wardrobe-e2e-password');await other.getByRole('button',{name:'登录',exact:true}).click();
  await expect(other.getByRole('heading',{name:'会议蓝色衬衫'})).toBeVisible();await context.close();
  await page.getByLabel('选择衣橱 ZIP').setInputFiles(fixture);await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByRole('dialog',{name:'批量导入预览'}).getByRole('status')).toContainText('新增 0 · 跳过 10');await page.getByRole('button',{name:'关闭',exact:true}).last().click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出全部 ZIP'}).click();const archive=await downloaded;expect(archive.suggestedFilename()).toBe('nmdd-wardrobe-v1.zip');
  const archivePath=await archive.path();expect(archivePath).toBeTruthy();
  await page.request.post('http://127.0.0.1:3101/__test/reset');await page.reload();await page.getByLabel('选择衣橱 ZIP').setInputFiles(archivePath!);await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.getByRole('dialog',{name:'批量导入预览'}).getByRole('status')).toContainText('新增 10');
});
test('edits, filters, archives/restores and saves an ordered conference outfit',async({page})=>{
  await importFixture(page);
  await page.getByRole('heading',{name:'模拟衣物 01',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('我的手工衬衫');await page.getByRole('button',{name:'保存衣物'}).click();await expect(page.getByRole('heading',{name:'我的手工衬衫'})).toBeVisible();
  await page.getByRole('heading',{name:'我的手工衬衫'}).click();await page.getByLabel('状态',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'保存衣物'}).click();
  await page.getByLabel('全部状态').selectOption('archived');await expect(page.getByRole('heading',{name:'我的手工衬衫'})).toBeVisible();await expect(page.getByRole('heading',{name:/模拟衣物/})).toHaveCount(0);
  await page.getByRole('heading',{name:'我的手工衬衫'}).click();await page.getByLabel('状态',{exact:true}).selectOption('active');await page.getByRole('button',{name:'保存衣物'}).click();await page.getByRole('button',{name:'清除筛选'}).click();
  await page.getByRole('button',{name:'穿搭组合',exact:true}).click();await page.getByRole('button',{name:'新建搭配'}).click();await page.getByLabel('搭配名称').fill('学术会议组合');await page.getByLabel('我的手工衬衫',{exact:true}).check();await page.getByLabel('模拟衣物 02',{exact:true}).check();await page.getByRole('button',{name:'上移第 2 件'}).click();await page.getByRole('button',{name:'保存搭配'}).click();
  await expect(page.getByRole('heading',{name:'学术会议组合'})).toBeVisible();await page.reload();await page.getByRole('button',{name:'穿搭组合',exact:true}).click();await expect(page.getByRole('heading',{name:'学术会议组合'})).toBeVisible();
  const outfits=await (await page.request.get('/api/wardrobe/outfits')).json();expect(outfits[0].items[0].item.name).toBe('模拟衣物 02');
});
test('creates manual item, soft-deletes it and protects anonymous access',async({page})=>{
  await page.goto('/wardrobe');await page.getByRole('button',{name:'新增衣物'}).click();
  await page.getByLabel('名称',{exact:true}).fill('手工上衣');await page.getByLabel('颜色',{exact:true}).fill('蓝色');
  // Extract a synthetic PNG through the bundle used in the API tests.
  const {unzipSync}=await import('fflate');const {readFileSync}=await import('node:fs');const files=unzipSync(readFileSync(fixture));
  await page.getByLabel('衣物照片（必选）').setInputFiles({name:'manual.png',mimeType:'image/png',buffer:Buffer.from(files['images/mock_001.png'])});await page.getByRole('button',{name:'保存衣物'}).click();await expect(page.getByRole('heading',{name:'手工上衣'})).toBeVisible();
  const items=await (await page.request.get('/api/wardrobe/items')).json();const imageUrl=items.items[0].image_url;
  await page.getByRole('heading',{name:'手工上衣'}).click();await page.getByRole('button',{name:'删除衣物',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByText('衣橱正在等待第一件衣物')).toBeVisible();
  await page.request.post('/api/auth/logout');expect((await page.request.get(imageUrl)).status()).toBe(401);expect((await page.request.get('/api/wardrobe/export')).status()).toBe(401);
});
