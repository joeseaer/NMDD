const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const {
  mcpAuthRouter,
  createOAuthMetadata,
} = require("@modelcontextprotocol/sdk/server/auth/router.js");
const { createWardrobeMcp } = require("../services/wardrobeMcp");
const { defaultOAuth, SCOPES } = require("../services/mcpOAuth");
module.exports = async function mcpRoutes(app, options) {
  const oauth = options.oauth === undefined ? defaultOAuth() : options.oauth;
  const inspirations =
      options.inspirations || require("../services/inspirationService"),
    wardrobe = options.wardrobe || require("../services/wardrobeService");
  await app.register(require("@fastify/rate-limit"), { global: false });
  if (oauth) {
    await app.register(async function oauthEndpoints(authApp) {
      await authApp.register(require("@fastify/express"));
      const express = require("express"),
        router = express.Router();
      router.use(
        "/token",
        express.urlencoded({ extended: false, limit: "8kb" }),
        (req, res, next) => {
          if (
            req.body?.grant_type === "authorization_code" &&
            !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body.code_verifier || "")
          ) {
            res.status(400).json({
              error: "invalid_request",
              error_description:
                "PKCE verifier must contain 43–128 unreserved characters",
            });
            return;
          }
          next();
        },
      );
      const metadata = createOAuthMetadata({
        provider: oauth.provider,
        issuerUrl: new URL(oauth.config.issuer),
        scopesSupported: SCOPES,
      });
      router.get("/.well-known/oauth-authorization-server", (_req, res) => {
        res.header("Access-Control-Allow-Origin", "*").json({
          ...metadata,
          revocation_endpoint_auth_methods_supported: [
            "none",
            "client_secret_post",
          ],
        });
      });
      // The official SDK owns OAuth discovery, registration, PKCE verification and token endpoints.
      router.use(
        mcpAuthRouter({
          provider: oauth.provider,
          issuerUrl: new URL(oauth.config.issuer),
          resourceServerUrl: new URL(oauth.config.resource),
          scopesSupported: SCOPES,
          resourceName: "NMDD 个人衣橱",
        }),
      );
      const attempts = new Map();
      router.use("/oauth/consent", (req, res, next) => {
        const ip = req.socket.remoteAddress || "",
          now = Date.now(),
          old = attempts.get(ip),
          row = old && now - old.at < 60000 ? old : { at: now, n: 0 };
        row.n++;
        attempts.set(ip, row);
        if (attempts.size > 10000)
          for (const [k, v] of attempts)
            if (now - v.at >= 60000) attempts.delete(k);
        if (row.n > 20)
          return res.status(429).send("操作过于频繁，请一分钟后重试。");
        next();
      });
      oauth.consentRoutes(router);
      authApp.use(router);
      // Fastify only runs this encapsulated middleware on routes in this plugin.
      // Register the SDK-owned paths so they do not fall through the root 404 context.
      for (const path of [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/mcp",
        "/authorize",
        "/token",
        "/register",
        "/revoke",
        "/oauth/consent",
      ])
        authApp.all(path, (_req, reply) =>
          reply.code(404).send({ error: "OAuth endpoint not found" }),
        );
    });
  }
  app.all(
    "/mcp",
    {
      bodyLimit: 2 * 1024 * 1024,
      config: { rateLimit: { max: 100, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!oauth)
        return reply
          .code(503)
          .send({ error: "MCP 尚未配置，请先使用网站上传或灵感 JSON 导入" });
      const origin = request.headers.origin;
      if (
        origin &&
        ![
          oauth.config.origin,
          oauth.config.site,
          "https://chatgpt.com",
        ].includes(origin)
      )
        return reply.code(403).send({ error: "Origin not allowed" });
      let auth;
      try {
        const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
          request.headers.authorization || "",
        );
        if (!match) throw new Error();
        auth = await oauth.provider.verifyAccessToken(match[1]);
      } catch {
        return reply
          .code(401)
          .header(
            "WWW-Authenticate",
            `Bearer resource_metadata="${oauth.config.origin}/.well-known/oauth-protected-resource/mcp"`,
          )
          .send({ error: "invalid_token" });
      }
      if (request.method !== "POST")
        return reply
          .code(405)
          .header("Allow", "POST")
          .send({ error: "Stateless MCP supports POST requests" });
      const server = createWardrobeMcp({
          wardrobe,
          inspirations,
          auth,
          siteUrl: oauth.config.site,
          download: options.download,
        }),
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
      await server.connect(transport);
      reply.hijack();
      reply.raw.once("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(503, { "Content-Type": "application/json" });
          reply.raw.end(JSON.stringify({ error: "MCP unavailable" }));
        } else reply.raw.end();
      }
    },
  );
  // The API routes retain normal website session authentication.
  app.register(require("./inspirations"), {
    prefix: "/api/wardrobe/inspirations",
    service: inspirations,
    oauth,
  });
};
