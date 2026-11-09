const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { DEFAULT_USER_ID } = require("../config/currentUser");
const { verifyCredentials } = require("./authService");
const { isAuthenticated } = require("../routes/auth");
const { hash, checkResult: check } = require("./inspirationContract");
const {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} = require("@modelcontextprotocol/sdk/server/auth/errors.js");
const SCOPES = [
  "wardrobe:read",
  "wardrobe:write",
  "inspiration:read",
  "inspiration:write",
];
const SCOPE_LABELS = {
  "wardrobe:read": "读取我的衣橱和衣物照片",
  "wardrobe:write": "新增和修改我的衣物",
  "inspiration:read": "查看我的穿搭灵感和参考图",
  "inspiration:write": "上传参考图，创建和修改灵感草稿",
};
const random = () => crypto.randomBytes(32).toString("base64url");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function configuration(env = process.env) {
  if (!env.NMDD_MCP_PUBLIC_URL || !env.NMDD_SITE_URL || !env.NMDD_MCP_SECRET)
    return null;
  const publicUrl = new URL(env.NMDD_MCP_PUBLIC_URL),
    site = new URL(env.NMDD_SITE_URL);
  for (const url of [publicUrl, site]) {
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          env.NODE_ENV !== "production" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        ))
    )
      throw new Error(
        "MCP URLs must be HTTPS origins (HTTP loopback in development only)",
      );
  }
  if (env.NMDD_MCP_SECRET.length < 32)
    throw new Error("NMDD_MCP_SECRET requires at least 32 characters");
  return {
    origin: publicUrl.origin,
    issuer: publicUrl.href,
    resource: `${publicUrl.origin}/mcp`,
    site: site.origin,
    secret: env.NMDD_MCP_SECRET,
    secure: publicUrl.protocol === "https:",
  };
}
function createOAuthService(client, config, { owner = DEFAULT_USER_ID } = {}) {
  const db = () => {
    if (!client) throw new ServerError("Authorization storage unavailable");
    return client;
  };
  const key = crypto.createHash("sha256").update(config.secret).digest();
  function encrypt(value) {
    if (!value) return null;
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([
      iv,
      cipher.update(value),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url");
  }
  function decrypt(value) {
    if (!value) return undefined;
    const b = Buffer.from(value, "base64url"),
      decipher = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(-16));
    return Buffer.concat([
      decipher.update(b.subarray(12, -16)),
      decipher.final(),
    ]).toString();
  }
  const fullClient = (row) =>
    row && {
      client_id: row.client_id,
      client_name: row.client_name,
      redirect_uris: row.redirect_uris,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      client_secret: decrypt(row.client_secret_ciphertext),
      client_secret_expires_at: 0,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  const clientsStore = {
    async getClient(id) {
      return fullClient(
        check(
          await db()
            .from("nmdd_oauth_clients")
            .select("*")
            .eq("client_id", id)
            .maybeSingle(),
        ),
      );
    },
    async registerClient(input) {
      try {
        if (!input.redirect_uris?.length || input.redirect_uris.length > 5)
          throw new Error();
        for (const uri of input.redirect_uris) {
          const u = new URL(uri);
          if (
            u.username ||
            u.password ||
            u.hash ||
            (u.protocol !== "https:" &&
              !(
                config.secure === false &&
                u.protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(u.hostname)
              ))
          )
            throw new Error();
        }
        if (
          !["none", "client_secret_post"].includes(
            input.token_endpoint_auth_method || "none",
          )
        )
          throw new Error();
        if (
          input.grant_types?.some(
            (g) => !["authorization_code", "refresh_token"].includes(g),
          ) ||
          input.response_types?.some((r) => r !== "code")
        )
          throw new Error();
      } catch {
        throw new InvalidClientMetadataError(
          "Use HTTPS redirect URIs, authorization_code + PKCE, and none or client_secret_post",
        );
      }
      const row = {
        client_id: input.client_id,
        client_name: String(input.client_name || "MCP client").slice(0, 200),
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: input.token_endpoint_auth_method || "none",
        client_secret_ciphertext: encrypt(input.client_secret),
      };
      check(await db().from("nmdd_oauth_clients").insert(row));
      return fullClient(row);
    },
  };
  function target(resource) {
    if (!resource || String(resource) !== config.resource)
      throw new InvalidTargetError("resource must equal the NMDD MCP URL");
    return config.resource;
  }
  function sign(value) {
    return crypto.createHmac("sha256", key).update(value).digest("base64url");
  }
  function cookie(value, maxAge = 600) {
    return `nmdd_consent=${value}; Path=/oauth/consent; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
  }
  function readConsent(req) {
    const value =
      String(req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("nmdd_consent="))
        ?.slice(13) || "";
    const [payload, signature] = value.split("."),
      expected = payload && sign(payload);
    if (
      !expected ||
      !signature ||
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new InvalidGrantError("Consent expired; reconnect");
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (data.exp <= Date.now()) throw new Error();
      return data;
    } catch {
      throw new InvalidGrantError("Consent expired; reconnect");
    }
  }
  async function grantByCode(clientInfo, code) {
    const row = check(
      await db()
        .from("nmdd_oauth_grants")
        .select("*")
        .eq("code_hash", hash(String(code)))
        .eq("client_id", clientInfo.client_id)
        .maybeSingle(),
    );
    if (!row) throw new InvalidGrantError("Invalid authorization code");
    return row;
  }
  async function issue(kind, secret, info, resource, redirect, challenge) {
    target(resource);
    const access = random(),
      refresh = random();
    const result = check(
      await db().rpc("nmdd_oauth_exchange", {
        p_kind: kind,
        p_secret_hash: hash(secret),
        p_client_id: info.client_id,
        p_redirect_uri: redirect || "",
        p_resource: config.resource,
        p_challenge: challenge || "",
        p_access_hash: hash(access),
        p_refresh_hash: hash(refresh),
      }),
    );
    if (
      result.error ||
      result.owner_id !== owner ||
      result.issuer !== config.issuer ||
      result.resource !== config.resource
    )
      throw new InvalidGrantError("Authorization expired, consumed or revoked");
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 600,
      refresh_token: refresh,
      scope: result.scopes.join(" "),
    };
  }
  const provider = {
    clientsStore,
    async authorize(info, params, res) {
      target(params.resource);
      const scopes = params.scopes?.length
        ? params.scopes
        : ["wardrobe:read", "inspiration:read"];
      if (scopes.some((s) => !SCOPES.includes(s)))
        throw new InvalidScopeError("Unsupported scope");
      if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
        throw new InvalidGrantError("S256 PKCE challenge required");
      const data = {
        client_id: info.client_id,
        scopes,
        redirect: params.redirectUri,
        state: params.state,
        challenge: params.codeChallenge,
        nonce: random(),
        exp: Date.now() + 600000,
      };
      const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
      if (payload.length > 3500)
        throw new InvalidGrantError("Authorization request too large");
      res.setHeader("Set-Cookie", cookie(`${payload}.${sign(payload)}`));
      res.redirect("/oauth/consent");
    },
    async challengeForAuthorizationCode(info, code) {
      return (await grantByCode(info, code)).code_challenge;
    },
    async exchangeAuthorizationCode(info, code, _verifier, redirect, resource) {
      const grant = await grantByCode(info, code);
      if (!redirect || redirect !== grant.redirect_uri)
        throw new InvalidGrantError("redirect_uri mismatch");
      return issue(
        "authorization_code",
        code,
        info,
        resource,
        redirect,
        grant.code_challenge,
      );
    },
    async exchangeRefreshToken(info, token, scopes, resource) {
      if (scopes) {
        const row = check(
          await db()
            .from("nmdd_oauth_tokens")
            .select("*")
            .eq("token_hash", hash(token))
            .eq("kind", "refresh")
            .maybeSingle(),
        );
        const grant =
          row &&
          check(
            await db()
              .from("nmdd_oauth_grants")
              .select("*")
              .eq("id", row.grant_id)
              .maybeSingle(),
          );
        if (
          !grant ||
          scopes.some((s) => !grant.scopes.includes(s)) ||
          scopes.length !== grant.scopes.length
        )
          throw new InvalidScopeError("Refresh retains the original scopes");
      }
      return issue("refresh_token", token, info, resource);
    },
    async verifyAccessToken(token) {
      if (typeof token !== "string" || token.length > 200)
        throw new InvalidTokenError("Invalid access token");
      const row = check(
        await db()
          .from("nmdd_oauth_tokens")
          .select("*")
          .eq("token_hash", hash(token))
          .eq("kind", "access")
          .maybeSingle(),
      );
      const grant =
        row &&
        check(
          await db()
            .from("nmdd_oauth_grants")
            .select("*")
            .eq("id", row.grant_id)
            .maybeSingle(),
        );
      if (
        !row ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        !grant ||
        grant.revoked_at ||
        grant.owner_id !== owner ||
        grant.issuer !== config.issuer ||
        grant.resource !== config.resource
      )
        throw new InvalidTokenError("Expired or revoked access token");
      return {
        token,
        clientId: grant.client_id,
        scopes: grant.scopes,
        expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
        resource: new URL(config.resource),
        extra: { owner_id: owner, grant_id: grant.id },
      };
    },
    async revokeToken(info, request) {
      const row = check(
        await db()
          .from("nmdd_oauth_tokens")
          .select("*")
          .eq("token_hash", hash(request.token))
          .maybeSingle(),
      );
      if (row)
        check(
          await db()
            .from("nmdd_oauth_grants")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", row.grant_id)
            .eq("client_id", info.client_id),
        );
    },
  };
  function consentPolicy(redirectUri) {
    // Chromium also applies form-action to redirects. The signed authorization
    // request may return only to the callback already validated by the SDK.
    const callback = redirectUri ? ` ${new URL(redirectUri).origin}` : "";
    return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callback}; frame-ancestors 'none'; base-uri 'none'`;
  }
  function consentRoutes(router) {
    const express = require("express");
    router.use(
      "/oauth/consent",
      express.urlencoded({ extended: false, limit: "8kb" }),
    );
    router.use("/oauth/consent", (_req, res, next) => {
      res.set({
        "Cache-Control": "no-store",
        "Content-Security-Policy": consentPolicy(),
        "X-Content-Type-Options": "nosniff",
        // Native form POSTs under no-referrer send Origin: null. Keep the
        // same-origin CSRF check working without leaking referrers to callbacks.
        "Referrer-Policy": "same-origin",
      });
      next();
    });
    router.get("/oauth/consent", async (req, res) => {
      try {
        const data = readConsent(req),
          info = await clientsStore.getClient(data.client_id);
        if (!info) throw new InvalidGrantError("Client removed");
        res.setHeader("Content-Security-Policy", consentPolicy(data.redirect));
        const login = isAuthenticated(req)
          ? "<p>已登录当前 NMDD 账户。</p>"
          : '<p>使用现有 NMDD 账户登录并授权。</p><label>账号<input required name="username" autocomplete="username"></label><label>密码<input required type="password" name="password" autocomplete="current-password"></label>';
        res
          .type("html")
          .send(
            `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 NMDD</title><style>body{font:16px system-ui;max-width:580px;margin:6vh auto;padding:24px;line-height:1.7}input,button{font:inherit;padding:10px;box-sizing:border-box}label,input{display:block;width:100%;margin:10px 0}button{margin:8px}</style><h1>授权连接 NMDD</h1><p>应用：${escape(info.client_name)}</p><p>回调域名：${escape(new URL(data.redirect).origin)}</p><p>仅授权当前个人账户。写入灵感会保存草稿，正式发布由你在网站确认。</p><ul>${data.scopes.map((s) => `<li>${escape(SCOPE_LABELS[s] || s)}</li>`).join("")}</ul><form method="post"><input type="hidden" name="nonce" value="${escape(data.nonce)}">${login}<button name="decision" value="allow">同意并连接</button><button name="decision" value="deny">拒绝</button></form></html>`,
          );
      } catch {
        res.status(400).send("授权请求已过期，请从客户端重新连接。");
      }
    });
    router.post("/oauth/consent", async (req, res) => {
      try {
        const data = readConsent(req);
        if (
          req.headers.origin !== config.origin ||
          req.body.nonce !== data.nonce
        )
          return res.status(403).send("授权请求校验失败，请重新连接。");
        const redirect = new URL(data.redirect);
        res.setHeader("Content-Security-Policy", consentPolicy(data.redirect));
        if (data.state !== undefined)
          redirect.searchParams.set("state", data.state);
        if (req.body.decision === "deny") {
          redirect.searchParams.set("error", "access_denied");
        } else {
          if (
            req.body.decision !== "allow" ||
            (!isAuthenticated(req) &&
              !verifyCredentials(req.body.username, req.body.password))
          )
            return res.status(401).send("账号或密码错误，请返回授权页面重试。");
          const code = random();
          check(
            await db()
              .from("nmdd_oauth_grants")
              .insert({
                owner_id: owner,
                client_id: data.client_id,
                scopes: data.scopes,
                issuer: config.issuer,
                resource: config.resource,
                redirect_uri: data.redirect,
                code_hash: hash(code),
                consent_hash: hash(data.nonce),
                code_challenge: data.challenge,
                code_expires_at: new Date(Date.now() + 120000).toISOString(),
              }),
          );
          redirect.searchParams.set("code", code);
        }
        res.setHeader("Set-Cookie", cookie("", 0));
        res.redirect(redirect.toString());
      } catch {
        res.status(400).send("授权请求无效，请重新连接。");
      }
    });
  }
  async function connections() {
    const rows = check(
      await db()
        .from("nmdd_oauth_grants")
        .select("*")
        .eq("owner_id", owner)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
    );
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        client_name:
          (await clientsStore.getClient(row.client_id))?.client_name ||
          "MCP client",
        scopes: row.scopes,
        created_at: row.created_at,
      })),
    );
  }
  async function revoke(id) {
    check(
      await db()
        .from("nmdd_oauth_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("owner_id", owner),
    );
    check(
      await db().from("nmdd_tool_audit").insert({
        owner_id: owner,
        actor: "website",
        action: "oauth_revoke",
        outcome: "success",
        record_id: id,
      }),
    );
    return { revoked: true };
  }
  return { provider, consentRoutes, connections, revoke, config };
}
function defaultOAuth() {
  const config = configuration();
  if (!config) return null;
  const client =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
      ? createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        )
      : null;
  return createOAuthService(client, config);
}
module.exports = { createOAuthService, configuration, defaultOAuth, SCOPES };
