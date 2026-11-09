const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { schema, requestHash } = require("./inspirationContract");
const { ENUMS, ensure, WardrobeError } = require("./wardrobeBundle");
const { fileSchema, fileHash, downloadImage } = require("./mcpFiles");
const id = { type: "string", format: "uuid" },
  key = { type: "string", minLength: 8, maxLength: 200 };
const object = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
// Local refs must be expanded because this schema is nested inside each tool schema.
function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object") {
    if (value.$ref)
      return expand(schema.definitions[value.$ref.split("/").pop()]);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["$id", "$schema", "definitions"].includes(k))
        .map(([k, v]) => [k, expand(v)]),
    );
  }
  return value;
}
const itemProperties = {};
for (const name of [
  "name",
  "subcategory",
  "primary_color",
  "brand",
  "size",
  "material",
  "notes",
])
  itemProperties[name] = {
    type: ["string", "null"],
    maxLength: name === "notes" ? 10000 : 500,
  };
for (const [name, values] of Object.entries(ENUMS))
  itemProperties[name] = ["seasons", "occasions"].includes(name)
    ? { type: "array", maxItems: 40, items: { enum: values } }
    : { enum: [...values, ...(name === "category" ? [] : [null])] };
itemProperties.style_tags = {
  type: "array",
  maxItems: 40,
  items: { type: "string", maxLength: 100 },
};
itemProperties.formality = {
  type: ["integer", "null"],
  minimum: 1,
  maximum: 5,
};
itemProperties.needs_review = { type: "boolean" };
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
function createWardrobeMcp({
  wardrobe,
  inspirations,
  auth,
  siteUrl = "",
  download = downloadImage,
}) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const tools = [];
  const add = (
    name,
    scope,
    description,
    inputSchema,
    run,
    annotations = read,
    meta,
  ) =>
    tools.push({
      name,
      scope,
      description,
      inputSchema,
      run,
      annotations,
      validate: ajv.compile(inputSchema),
      ...(meta ? { _meta: meta } : {}),
    });
  const actor = auth.clientId;
  add(
    "wardrobe_list_items",
    "wardrobe:read",
    "读取当前账户的衣物，可分页和筛选。返回网站受控图片地址；查看图像用 wardrobe_get_item_image。",
    object({
      category: { enum: ENUMS.category },
      color_family: { enum: ENUMS.color_family },
      status: { enum: ENUMS.status },
      search: { type: "string", maxLength: 500 },
      page: { type: "integer", minimum: 1, maximum: 100000 },
      page_size: { type: "integer", minimum: 1, maximum: 100 },
    }),
    (args) => wardrobe.listItems(args),
  );
  add(
    "wardrobe_get_item",
    "wardrobe:read",
    "读取一件当前账户的衣物详情。",
    object({ id }, ["id"]),
    (args) => wardrobe.getItemDetails(args.id),
  );
  add(
    "wardrobe_get_item_image",
    "wardrobe:read",
    "读取一件当前账户衣物的私有图片内容。",
    object({ id }, ["id"]),
    async (args) => ({ image: await wardrobe.getImage(args.id) }),
  );
  add(
    "wardrobe_create_item",
    "wardrobe:write",
    "经用户要求新增一件实际拥有的衣物。不可将参考图中的未知衣物登记为已拥有。必须提供附件和幂等键；先确认衣物字段。",
    object(
      {
        item: object(itemProperties, ["name", "category", "primary_color"]),
        image: fileSchema,
        idempotency_key: key,
      },
      ["item", "image", "idempotency_key"],
    ),
    async (args) => {
      const mutation = {
        key: args.idempotency_key,
        hash: requestHash({ item: args.item, image: fileHash(args.image) }),
        actor,
      };
      const prior = await wardrobe.mutationReplay("wardrobe_create", mutation);
      return (
        prior ||
        wardrobe.createItem(args.item, await download(args.image), mutation)
      );
    },
    write,
    { "openai/fileParams": ["image"] },
  );
  add(
    "wardrobe_update_item",
    "wardrobe:write",
    "经用户要求更新当前账户的一件衣物属性，不修改原图。idempotency_key 相同的重试返回原结果。",
    object({ id, patch: object(itemProperties), idempotency_key: key }, [
      "id",
      "patch",
      "idempotency_key",
    ]),
    (args) =>
      wardrobe.patchItem(args.id, args.patch, {
        key: args.idempotency_key,
        hash: requestHash({ id: args.id, patch: args.patch }),
        actor,
      }),
    { ...write, destructiveHint: true },
  );
  add(
    "inspiration_list",
    "inspiration:read",
    "列出灵感草稿和已保存灵感。网站上传的 pending 草稿等待你读取图片并整理。",
    object({
      page: { type: "integer", minimum: 1, maximum: 100000 },
      status: { enum: ["draft", "published"] },
    }),
    (args) => inspirations.list(args),
  );
  add(
    "inspiration_get",
    "inspiration:read",
    "读取灵感全文、参考单品、版本号及详情页。",
    object({ id }, ["id"]),
    (args) => inspirations.get(args.id),
  );
  add(
    "inspiration_list_images",
    "inspiration:read",
    "列出最近 30 张网站或 ChatGPT 上传的参考图，返回 image_id。",
    object({}),
    () => inspirations.listImages(),
  );
  add(
    "inspiration_get_image",
    "inspiration:read",
    "按 image_id 读取当前账户私有参考图，供你分析。看不清的属性保留 null/unknown，并标为待核验。",
    object({ image_id: id }, ["image_id"]),
    async (args) => ({ image: await inspirations.getImage(args.image_id) }),
  );
  add(
    "inspiration_upload_image",
    "inspiration:write",
    "上传 ChatGPT 附件。下载地址仅限受支持的临时文件服务；失败时请用户先在 NMDD 上传，再使用 image_id。",
    object({ image: fileSchema, idempotency_key: key }, [
      "image",
      "idempotency_key",
    ]),
    async (args) => {
      const digest = fileHash(args.image),
        prior = await inspirations.findRequest(
          "image_upload",
          args.idempotency_key,
          digest,
        );
      if (prior)
        return {
          id: prior.id,
          mime_type: prior.mime_type,
          byte_size: prior.byte_size,
        };
      return inspirations.uploadImage(
        await download(args.image),
        args.idempotency_key,
        actor,
        digest,
      );
    },
    write,
    { "openai/fileParams": ["image"] },
  );
  add(
    "inspiration_create_draft",
    "inspiration:write",
    "将你的图片分析保存为待确认草稿。只使用共享枚举，不编造品牌或材质，不自动发布、不创建衣物。返回网站详情链接。",
    object({ draft: expand(schema), idempotency_key: key }, [
      "draft",
      "idempotency_key",
    ]),
    (args) =>
      inspirations.create(args.draft, {
        key: args.idempotency_key,
        source: "chatgpt",
        actor,
      }),
    write,
  );
  add(
    "inspiration_update_draft",
    "inspiration:write",
    "更新草稿分析或衣物关联，完整替换可编辑字段。先读取最新 revision；已发布记录修改后回到待确认。",
    object(
      {
        id,
        draft: expand(schema),
        expected_revision: { type: "integer", minimum: 1 },
        idempotency_key: key,
      },
      ["id", "draft", "expected_revision", "idempotency_key"],
    ),
    (args) =>
      inspirations.update(args.id, args.draft, {
        key: args.idempotency_key,
        expectedRevision: args.expected_revision,
        source: "chatgpt",
        actor,
      }),
    { ...write, destructiveHint: true },
  );
  add(
    "inspiration_match_wardrobe",
    "inspiration:read",
    "按类别、颜色、图案、风格从已有衣物中推荐最多五个候选。需同时具备 wardrobe:read。分数为属性相似度，不是概率，不会自动关联。",
    object({ id }, ["id"]),
    (args) => {
      ensure(
        auth.scopes.includes("wardrobe:read"),
        "匹配还需要 wardrobe:read 权限",
      );
      return inspirations.match(args.id);
    },
  );
  add(
    "inspiration_publish",
    "inspiration:read",
    "V1 发布需要用户在网站确认。此工具返回确认链接与当前状态，不会自动发布草稿。请明确告知用户尚需打开链接点击「保存到灵感库」。",
    object({ id }, ["id"]),
    async (args) => {
      const row = await inspirations.get(args.id);
      return {
        id: row.id,
        status:
          row.status === "published" ? "published" : "confirmation_required",
        details_url: row.details_url,
        message:
          row.status === "published"
            ? "已在网站保存"
            : "请在网站核对原图、参考单品和衣物匹配后，点击保存到灵感库",
      };
    },
  );
  const server = new Server(
    { name: "nmdd-wardrobe", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "NMDD 个人衣橱。图片中的未知信息用 null 或 unknown，参考单品与已拥有衣物分开。网站最终确认发布。",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools
      .filter((tool) => auth.scopes.includes(tool.scope))
      .map(({ scope, run, validate, ...tool }) => tool),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    try {
      if (!tool || !auth.scopes.includes(tool.scope))
        throw new WardrobeError("工具不存在或授权权限不足", 403);
      if (!tool.validate(request.params.arguments || {}))
        throw new WardrobeError(
          "工具参数格式错误",
          400,
          tool.validate.errors.map((e) => ({
            field: e.instancePath || "/",
            message: e.message,
          })),
        );
      const result = await tool.run(request.params.arguments || {});
      if (result?.id && !result.details_url) {
        if (tool.name.startsWith("wardrobe_"))
          result.details_url = `${siteUrl}/wardrobe?item=${result.id}`;
        if (tool.name === "inspiration_upload_image")
          result.details_url = `${siteUrl}/api/wardrobe/inspirations/images/${result.id}`;
      }
      await inspirations.audit(tool.name, "success", actor);
      if (result?.image)
        return {
          content: [
            {
              type: "image",
              data: result.image.bytes.toString("base64"),
              mimeType: result.image.mime,
            },
          ],
        };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: Array.isArray(result) ? { items: result } : result,
      };
    } catch (error) {
      await inspirations
        .audit(request.params.name, "failed", actor)
        .catch(() => {});
      const known = error instanceof WardrobeError;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: known ? `NMDD_${error.statusCode}` : "NMDD_UNAVAILABLE",
              message: known ? error.message : "操作暂时不可用，请稍后重试",
              fields: known ? error.details : [],
            }),
          },
        ],
      };
    }
  });
  return server;
}
module.exports = { createWardrobeMcp };
