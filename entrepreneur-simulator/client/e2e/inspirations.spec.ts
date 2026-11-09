import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const requireServer = createRequire(resolve("../server/package.json"));
const { Client } = requireServer("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = requireServer(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);
const api = "http://127.0.0.1:3101";
async function authorize(request: APIRequestContext) {
  const registered = await request.post(`${api}/register`, {
    data: {
      client_name: "Browser acceptance",
      redirect_uris: [`${api}/callback`],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(registered.status()).toBe(201);
  const client = await registered.json();
  const verifier = "s".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${api}/authorize`);
  for (const [k, v] of Object.entries({
    client_id: client.client_id,
    redirect_uri: `${api}/callback`,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    resource: `${api}/mcp`,
    scope: "wardrobe:read inspiration:read inspiration:write",
  }))
    url.searchParams.set(k, v as string);
  expect(
    (await request.get(url.toString(), { maxRedirects: 0 })).status(),
  ).toBe(302);
  const html = await (await request.get(`${api}/oauth/consent`)).text(),
    nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];
  const consent = await request.post(`${api}/oauth/consent`, {
    headers: { Origin: api },
    form: { nonce, decision: "allow" },
    maxRedirects: 0,
  });
  expect(consent.status()).toBe(302);
  const code = new URL(consent.headers().location).searchParams.get("code")!;
  const response = await request.post(`${api}/token`, {
    form: {
      client_id: client.client_id,
      grant_type: "authorization_code",
      code_verifier: verifier,
      redirect_uri: `${api}/callback`,
      code,
      resource: `${api}/mcp`,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).access_token as string;
}
test("OAuth consent submits through a real browser form and completes PKCE without injected Origin headers", async ({
  page,
}) => {
  const redirectUri = "http://localhost:3101/callback";
  const registered = await page.request.post(`${api}/register`, {
    data: {
      client_name: "Native browser OAuth test",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(registered.status()).toBe(201);
  const client = await registered.json(),
    verifier = "b".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(`${api}/authorize`);
  for (const [name, value] of Object.entries({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    resource: `${api}/mcp`,
    scope: "wardrobe:read inspiration:read inspiration:write",
    state: "native-browser-state",
  }))
    authorization.searchParams.set(name, value as string);
  await page.context().clearCookies();
  await page.goto(authorization.toString());
  await expect(
    page.getByRole("heading", { name: "授权连接 NMDD" }),
  ).toBeVisible();
  await page.getByLabel("账号", { exact: true }).fill("wardrobe-e2e");
  await page.getByLabel("密码", { exact: true }).fill("wardrobe-e2e-password");
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url() === `${api}/oauth/consent`,
  );
  await page.getByRole("button", { name: "同意并连接", exact: true }).click();
  const result = await submitted;
  expect(await result.request().headerValue("origin")).toBe(api);
  expect(result.status()).toBe(302);
  await expect(
    page.getByRole("heading", { name: "OAuth callback reached" }),
  ).toBeVisible();
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("native-browser-state");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();
  const token = await page.request.post(`${api}/token`, {
    form: {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: code!,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: `${api}/mcp`,
    },
  });
  expect(token.status()).toBe(200);
  expect((await token.json()).access_token).toBeTruthy();
});

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", {
    data: { username: "wardrobe-e2e", password: "wardrobe-e2e-password" },
  });
  await page.request.post(`${api}/__test/reset`);
});
test("MCP draft persists to PostgreSQL, appears on website, matches clothes and is edited/published on desktop and phone", async ({
  page,
}, testInfo) => {
  const imported = await page.request.post("/api/wardrobe/import", {
    multipart: {
      file: {
        name: "clothes.zip",
        mimeType: "application/zip",
        buffer: readFileSync(
          resolve("../server/tests/fixtures/wardrobe/mock-ten.zip"),
        ),
      },
    },
  });
  expect((await imported.json()).created).toBe(10);
  const clothes = (await (await page.request.get("/api/wardrobe/items")).json())
    .items;
  const image = await page.request.get(clothes[0].image_url);
  await page.goto("/wardrobe");
  await page.getByRole("button", { name: "穿搭灵感", exact: true }).click();
  await page.getByLabel("上传灵感参考图").setInputFiles({
    name: "参考穿搭.png",
    mimeType: "image/png",
    buffer: await image.body(),
  });
  const editor = page.getByRole("dialog", { name: "穿搭灵感详情" });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByText("将图片编号交给已连接的 ChatGPT", { exact: false }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  const pending = (
    await (await page.request.get("/api/wardrobe/inspirations/")).json()
  ).items[0];
  const token = await authorize(page.request),
    client = new Client({ name: "browser-test", version: "1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${api}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const read = await client.callTool({
    name: "inspiration_get_image",
    arguments: { image_id: pending.source_image_id },
  });
  expect(read.content[0].type).toBe("image");
  const input = {
    draft: {
      title: "ChatGPT 灵感测试",
      source_image_id: pending.source_image_id,
      overall_style: "简约通勤",
      occasions: ["daily"],
      analysis_status: "ready",
      reference_items: [
        {
          category: clothes[0].category,
          primary_color: clothes[0].primary_color,
          color_family: clothes[0].color_family,
          pattern: "unknown",
          visibility: "partial",
          needs_review: true,
        },
      ],
    },
    idempotency_key: randomUUID(),
  };
  const result = await client.callTool({
    name: "inspiration_create_draft",
    arguments: input,
  });
  expect(result.isError).toBeFalsy();
  const created = result.structuredContent;
  const retry = await client.callTool({
    name: "inspiration_create_draft",
    arguments: input,
  });
  expect(retry.structuredContent.id).toBe(created.id);
  await page.getByRole("button", { name: "刷新灵感", exact: true }).click();
  await page.route("**/api/wardrobe/inspirations/images/*", (route) =>
    route.fulfill({ status: 503, body: "image temporarily unavailable" }),
  );
  await page
    .getByRole("heading", { name: "ChatGPT 灵感测试", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(
    editor.getByText(
      "原图加载失败，请重新加载最新版本或替换图片，确认原图后再发布。",
    ),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "保存到灵感库", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/wardrobe/inspirations/images/*");
  await editor
    .getByRole("button", { name: "重新加载最新版本", exact: true })
    .click();
  const bounds = await editor.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds!.width).toBeGreaterThan(viewport.width * 0.9);
  await expect(
    editor.getByRole("img", { name: "穿搭原始参考图" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      editor
        .getByRole("img", { name: "穿搭原始参考图" })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath("inspiration-editor.png"),
    fullPage: true,
  });
  await editor.getByLabel("穿搭名称", { exact: true }).fill("我确认的灵感");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("草稿已保存，等待确认");
  await editor
    .getByRole("button", { name: "匹配我的衣橱", exact: true })
    .click();
  await expect(
    editor.getByText("属性相似度排序，不是识别概率；匹配候选需由你确认"),
  ).toBeVisible();
  const candidate = editor
    .getByRole("button")
    .filter({
      has: page.getByRole("img", { name: clothes[0].name, exact: true }),
    })
    .first();
  await candidate.scrollIntoViewIfNeeded();
  await candidate.click();
  await expect(editor.getByText("解除关联", { exact: true })).toBeVisible();
  await editor
    .getByRole("button", { name: "从衣橱选择 / 替换", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "选择我的衣物",
    exact: true,
  });
  const largeImage = picker.getByRole("img", {
    name: clothes[0].name,
    exact: true,
  });
  await expect(largeImage).toBeVisible();
  expect((await largeImage.boundingBox())!.width).toBeGreaterThan(120);
  await largeImage.click();
  await expect(picker).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("inspiration-review.png"),
    fullPage: true,
  });
  await editor
    .getByRole("button", { name: "保存到灵感库", exact: true })
    .click();
  await expect(editor.getByRole("status")).toHaveText("已保存到灵感库");
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "穿搭灵感详情" }),
  ).toBeVisible();
  await expect(page.getByLabel("穿搭名称", { exact: true })).toHaveValue(
    "我确认的灵感",
  );
  await expect(page.getByText("已保存到灵感库", { exact: true })).toBeVisible();
  const persisted = await (
    await page.request.get(`/api/wardrobe/inspirations/${created.id}`)
  ).json();
  expect(persisted.status).toBe("published");
  expect(persisted.reference_items[0].matched_wardrobe_item_id).toBe(
    clothes[0].id,
  );
  expect(
    (await (await page.request.get("/api/wardrobe/items")).json()).total,
  ).toBe(10);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  expect((await exported).suggestedFilename()).toBe("nmdd-inspiration-v1.json");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const itemDetails = await client.callTool({
    name: "wardrobe_get_item",
    arguments: { id: clothes[0].id },
  });
  await page.goto(itemDetails.structuredContent.details_url);
  await expect(
    page.getByRole("dialog", { name: "衣物详情与编辑" }),
  ).toBeVisible();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    clothes[0].name,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "穿搭灵感", exact: true }).click();
  await page.getByRole("button", { name: "连接 ChatGPT", exact: true }).click();
  await expect(page.getByLabel("MCP 地址")).toHaveValue(`${api}/mcp`);
  await page.getByRole("button", { name: "撤销授权", exact: true }).click();
  await expect(page.getByText("暂无连接", { exact: true })).toBeVisible();
  const revoked = await page.request.post(`${api}/mcp`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(revoked.status()).toBe(401);
  await client.close();
});
test("JSON fallback validates enums, imports with photo, handles failed analysis and deletes draft", async ({
  page,
}) => {
  await page.goto("/wardrobe");
  await page.getByRole("button", { name: "穿搭灵感", exact: true }).click();
  await page
    .getByRole("button", { name: "导入灵感 JSON", exact: true })
    .click();
  const json = {
    format: "nmdd-inspiration",
    schema_version: 1,
    inspiration: {
      title: "失败分析可编辑",
      analysis_status: "failed",
      analysis_error: "原图被遮挡",
      occasions: ["invalid"],
      reference_items: [],
    },
  };
  await page
    .getByLabel("灵感 JSON", { exact: true })
    .fill(JSON.stringify(json));
  await page.getByRole("button", { name: "导入为草稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("格式错误");
  json.inspiration.occasions = ["daily"];
  await page
    .getByLabel("灵感 JSON", { exact: true })
    .fill(JSON.stringify(json));
  await page
    .getByLabel("参考原图（可选，将替换 JSON 中的图片编号）", { exact: true })
    .setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGa8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByRole("button", { name: "导入为草稿", exact: true }).click();
  await expect(page.getByLabel("失败原因", { exact: true })).toHaveValue(
    "原图被遮挡",
  );
  await page.getByRole("button", { name: "保存到灵感库", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("发布前");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "收藏你的第一份穿搭灵感" }),
  ).toBeVisible();
});
