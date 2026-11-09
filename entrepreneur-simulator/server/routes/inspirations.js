const { isAuthenticated } = require("./auth");
const { WardrobeError, ensure, LIMITS } = require("../services/wardrobeBundle");
const { uuid, idempotencyKey } = require("../services/inspirationContract");
module.exports = async function inspirationRoutes(app, options) {
  const service = options.service || require("../services/inspirationService"),
    oauth = options.oauth;
  app.addHook("onRequest", async (req, reply) => {
    if (!isAuthenticated(req))
      return reply.code(401).send({ error: "请先登录" });
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof WardrobeError)
      return reply
        .code(error.statusCode)
        .send({
          error: error.message,
          code: `NMDD_${error.statusCode}`,
          errors: error.details,
        });
    if (error.statusCode === 413 || error.code?.startsWith("FST_"))
      return reply
        .code(error.statusCode || 400)
        .send({ error: "文件过大或请求格式错误，图片最大 8MB" });
    req.log.error(
      { event: "inspiration_request_failed" },
      "Inspiration request failed",
    );
    return reply.code(503).send({ error: "灵感操作失败，请稍后重试" });
  });
  app.addHook("preValidation", async (req) => {
    if (req.params?.id) ensure(uuid(req.params.id), "记录编号无效");
  });
  function mutation(req) {
    const body = req.body || {};
    ensure(
      Number.isInteger(body.expected_revision) && body.expected_revision >= 1,
      "请提供当前草稿版本号",
    );
    return {
      key: idempotencyKey(req.headers["idempotency-key"]),
      expectedRevision: body.expected_revision,
    };
  }
  app.get("/schema", () => service.schema);
  app.get("/connections", async () => ({
    enabled: !!oauth,
    mcp_url: oauth?.config.resource || null,
    items: oauth ? await oauth.connections() : [],
  }));
  app.post("/connections/:id/revoke", (req) => {
    ensure(oauth, "MCP 尚未配置");
    return oauth.revoke(req.params.id);
  });
  app.get("/images", () => service.listImages());
  app.post("/images", async (req, reply) => {
    const key = idempotencyKey(req.headers["idempotency-key"]);
    let file;
    for await (const part of req.parts({
      limits: { fileSize: LIMITS.image, files: 1, fields: 0, parts: 1 },
    })) {
      ensure(
        part.type === "file" && part.fieldname === "file",
        "文件字段必须为 file",
      );
      file = {
        bytes: await part.toBuffer(),
        filename: part.filename,
        mimetype: part.mimetype,
      };
    }
    return reply.code(201).send(await service.uploadImage(file, key));
  });
  app.get("/images/:id", async (req, reply) => {
    const image = await service.getImage(req.params.id);
    return reply
      .type(image.mime)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(image.bytes);
  });
  app.get("/", (req) => service.list(req.query));
  app.post("/drafts", async (req, reply) =>
    reply
      .code(201)
      .send(
        await service.create(req.body, {
          key: idempotencyKey(req.headers["idempotency-key"]),
        }),
      ),
  );
  app.post("/import", async (req, reply) => {
    ensure(
      req.body?.format === "nmdd-inspiration" &&
        req.body.schema_version === 1 &&
        Object.keys(req.body).every((k) =>
          ["format", "schema_version", "inspiration"].includes(k),
        ),
      "需要 nmdd-inspiration schema_version:1 JSON",
    );
    return reply
      .code(201)
      .send(
        await service.create(req.body.inspiration, {
          key: idempotencyKey(req.headers["idempotency-key"]),
          source: "json-import",
        }),
      );
  });
  app.get("/:id", (req) => service.get(req.params.id));
  app.get("/:id/export", async (req, reply) =>
    reply
      .header("Cache-Control", "private, no-store")
      .header(
        "Content-Disposition",
        'attachment; filename="nmdd-inspiration-v1.json"',
      )
      .send(await service.exportJson(req.params.id)),
  );
  app.patch("/:id", (req) => {
    const { draft } = req.body || {};
    return service.update(req.params.id, draft, mutation(req));
  });
  app.post("/:id/match", (req) => service.match(req.params.id));
  app.post("/:id/publish", (req) =>
    service.publish(req.params.id, mutation(req)),
  );
  app.delete("/:id", (req) => service.remove(req.params.id, mutation(req)));
};
