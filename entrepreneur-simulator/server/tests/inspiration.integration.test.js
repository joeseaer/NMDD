const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const crypto = require("node:crypto");
process.env.AUTH_USERNAME = "inspiration-test";
process.env.AUTH_PASSWORD_HASH = `salt:${crypto.scryptSync("test-password", "salt", 64).toString("hex")}`;
const { createWardrobeDatabase } = require("./helpers/wardrobeDatabase");
const { createWardrobeService } = require("../services/wardrobeService");
const { createInspirationService } = require("../services/inspirationService");
const { createOAuthService, configuration } = require("../services/mcpOAuth");
const {
  normalizeDraft,
  editableDraft,
  requestHash,
} = require("../services/inspirationContract");
const { publicAddress, downloadImage } = require("../services/mcpFiles");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { parseBundle } = require("../services/wardrobeBundle");
const { createSessionToken } = require("../services/authService");
const fixture = fs.readFileSync(`${__dirname}/fixtures/wardrobe/mock-ten.zip`);
const cookie = `nmdd_session=${createSessionToken()}`;
const key = () => crypto.randomUUID();
const freePort = () =>
  new Promise((resolve) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
test("inspirations: production SQL + OAuth/PKCE + official MCP client + website API", async (t) => {
  const database = await createWardrobeDatabase(),
    { pg, client, state } = database;
  const wardrobe = createWardrobeService(client),
    port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  const config = configuration({
    NMDD_MCP_PUBLIC_URL: base,
    NMDD_SITE_URL: base,
    NMDD_MCP_SECRET: "isolated-test-secret-that-is-over-32-chars",
  });
  const inspirations = createInspirationService(client, {
      wardrobe,
      siteUrl: base,
    }),
    oauth = createOAuthService(client, config);
  const app = require("fastify")();
  await app.register(require("@fastify/multipart"));
  await app.register(require("../routes/auth"), { prefix: "/api/auth" });
  await app.register(require("../routes/wardrobe"), {
    prefix: "/api/wardrobe",
    service: wardrobe,
  });
  await app.register(require("../routes/mcp"), {
    oauth,
    wardrobe,
    inspirations,
    download: async () => {
      throw new Error("No remote downloads in this test");
    },
  });
  await app.listen({ port, host: "127.0.0.1" });
  t.after(async () => {
    await app.close();
    await pg.close();
  });
  await wardrobe.importBundle(fixture);
  const clothes = (await wardrobe.listItems()).items;
  const imageFile = (await parseBundle(fixture)).items[0];
  let image, draft, token, mcp, registered, code;
  const verifier = "v".repeat(64),
    challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
  async function register() {
    const response = await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Isolated MCP client",
        redirect_uris: [`${base}/callback`],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  let checkedConsentForgery = false;
  async function authorize(
    info,
    scope = "wardrobe:read wardrobe:write inspiration:read inspiration:write",
  ) {
    const url = new URL(`${base}/authorize`);
    for (const [k, v] of Object.entries({
      client_id: info.client_id,
      redirect_uri: `${base}/callback`,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope,
      resource: config.resource,
      state: "state-value",
    }))
      url.searchParams.set(k, v);
    const begin = await fetch(url, { redirect: "manual" });
    assert.equal(begin.status, 302, await begin.clone().text());
    const consentCookie = begin.headers.get("set-cookie").split(";")[0];
    const consent = await fetch(`${base}/oauth/consent`, {
      headers: { cookie: `${cookie}; ${consentCookie}` },
    });
    const html = await consent.text();
    assert.equal(consent.status, 200, html);
    assert.equal(consent.headers.get("referrer-policy"), "same-origin");
    assert.ok(
      consent.headers
        .get("content-security-policy")
        .includes(`form-action 'self' ${base};`),
    );
    assert.ok(
      consent.headers
        .get("content-security-policy")
        .includes("frame-ancestors 'none'"),
    );
    assert.match(html, /Isolated MCP client/);
    const nonce = /name="nonce" value="([^"]+)"/.exec(html)[1];
    const denied = await fetch(`${base}/oauth/consent`, {
      method: "POST",
      headers: {
        cookie: `${cookie}; ${consentCookie}`,
        Origin: "https://attacker.invalid",
      },
      body: new URLSearchParams({ nonce, decision: "allow" }),
      redirect: "manual",
    });
    assert.equal(denied.status, 403);
    if (!checkedConsentForgery) {
      for (const invalid of [
        { origin: "null", nonce },
        { origin: base, nonce: "wrong-nonce" },
        { origin: base },
      ]) {
        const rejected = await fetch(`${base}/oauth/consent`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; ${consentCookie}`,
            Origin: invalid.origin,
          },
          body: new URLSearchParams({
            decision: "allow",
            ...(invalid.nonce ? { nonce: invalid.nonce } : {}),
          }),
          redirect: "manual",
        });
        assert.equal(rejected.status, 403);
      }
      checkedConsentForgery = true;
    }
    const approved = await fetch(`${base}/oauth/consent`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${consentCookie}`, Origin: base },
      body: new URLSearchParams({ nonce, decision: "allow" }),
      redirect: "manual",
    });
    assert.equal(approved.status, 302, await approved.clone().text());
    const result = new URL(approved.headers.get("location"));
    assert.equal(result.searchParams.get("state"), "state-value");
    return result.searchParams.get("code");
  }
  async function exchange(
    authCode,
    codeVerifier = verifier,
    resource = config.resource,
    info = registered,
  ) {
    return fetch(`${base}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: info.client_id,
        code: authCode,
        code_verifier: codeVerifier,
        redirect_uri: `${base}/callback`,
        resource,
      }),
    });
  }
  const call = async (name, args = {}) => {
    const result = await mcp.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent || JSON.parse(result.content[0].text);
  };
  await t.test(
    "private tables/bucket and RPC privileges; invalid contract and unsafe images rejected",
    async () => {
      assert.equal(
        (
          await pg.query(
            "SELECT public FROM storage.buckets WHERE id='wardrobe-inspiration-images'",
          )
        ).rows[0].public,
        false,
      );
      for (const role of ["anon", "authenticated"]) {
        await pg.exec(`SET ROLE ${role}`);
        await assert.rejects(
          pg.query("SELECT * FROM nmdd_oauth_tokens"),
          /permission denied/,
        );
        await assert.rejects(
          pg.query("SELECT * FROM wardrobe_inspirations"),
          /permission denied/,
        );
        await assert.rejects(
          pg.query(
            "SELECT nmdd_inspiration_image('x','{}'::jsonb,'12345678',repeat('a',64),'x')",
          ),
          /permission denied/,
        );
        await pg.exec("RESET ROLE");
      }
      assert.throws(
        () => normalizeDraft({ title: "x", owner_id: "other" }),
        /格式错误/,
      );
      assert.throws(
        () => normalizeDraft({ title: "x", occasions: ["office"] }),
        /格式错误/,
      );
      assert.throws(
        () =>
          normalizeDraft({
            title: "x",
            reference_items: [
              {
                category: "tops",
                bounding_box: { x: 0.9, y: 0, width: 0.2, height: 1 },
              },
            ],
          }),
        /原图范围/,
      );
      for (const address of [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.169.254",
        "::1",
        "::ffff:8.8.8.8",
        "fe80::1",
        "192.168.0.3",
      ])
        assert.equal(publicAddress(address), false, address);
      assert.equal(publicAddress("8.8.8.8"), true);
      assert.equal(publicAddress("2606:4700::1111"), true);
      await assert.rejects(
        downloadImage({ download_url: "http://files.oaiusercontent.com/x" }),
        /HTTPS/,
      );
      await assert.rejects(
        downloadImage({ download_url: "https://attacker.invalid/x" }),
        /域名/,
      );
      await assert.rejects(
        downloadImage(
          { download_url: "https://files.oaiusercontent.com/x" },
          { lookup: async () => [{ address: "127.0.0.1", family: 4 }] },
        ),
        /私有网络/,
      );
      await assert.rejects(
        inspirations.uploadImage(
          {
            bytes: Buffer.from("fake"),
            filename: "x.png",
            mimetype: "image/png",
          },
          key(),
        ),
        /文件头/,
      );
    },
  );
  await t.test(
    "website writes reject anonymous access; image upload/draft are idempotent with no partial records",
    async () => {
      assert.equal(
        (await app.inject({ url: "/api/wardrobe/inspirations/" })).statusCode,
        401,
      );
      image = await inspirations.uploadImage(
        {
          bytes: imageFile.bytes,
          filename: imageFile.image_path,
          mimetype: imageFile.info.mime,
        },
        "image-upload-0001",
      );
      const again = await inspirations.uploadImage(
        {
          bytes: imageFile.bytes,
          filename: imageFile.image_path,
          mimetype: imageFile.info.mime,
        },
        "image-upload-0001",
      );
      assert.equal(image.id, again.id);
      const payload = {
        title: "测试灵感",
        source_image_id: image.id,
        analysis_status: "ready",
        occasions: ["daily"],
        reference_items: [
          {
            category: clothes[0].category,
            primary_color: clothes[0].primary_color,
            color_family: clothes[0].color_family,
            pattern: clothes[0].pattern,
            visibility: "partial",
            needs_review: true,
          },
        ],
      };
      const options = { key: "create-draft-0001" };
      draft = await inspirations.create(payload, options);
      assert.equal((await inspirations.create(payload, options)).id, draft.id);
      await assert.rejects(
        inspirations.create({ ...payload, title: "different" }, options),
        (e) => e.statusCode === 409,
      );
      assert.equal((await inspirations.list()).items.length, 1);
      assert.ok(!("owner_id" in draft) && !("source_image_key" in draft));
      const before = (
        await pg.query("SELECT count(*)::int n FROM wardrobe_inspirations")
      ).rows[0].n;
      await assert.rejects(
        inspirations.create(
          {
            ...payload,
            reference_items: [
              {
                category: "tops",
                matched_wardrobe_item_id: crypto.randomUUID(),
              },
            ],
          },
          { key: key() },
        ),
        /衣物/,
      );
      assert.equal(
        (await pg.query("SELECT count(*)::int n FROM wardrobe_inspirations"))
          .rows[0].n,
        before,
      );
      state.failRpc = true;
      const objects = state.objects.size;
      await assert.rejects(
        inspirations.uploadImage(
          {
            bytes: (await parseBundle(fixture)).items[1].bytes,
            filename: "second.png",
            mimetype: "image/png",
          },
          key(),
        ),
      );
      state.failRpc = false;
      assert.equal(state.objects.size, objects);
    },
  );
  await t.test(
    "OAuth discovery, dynamic client registration, explicit consent, PKCE and audience checks",
    async () => {
      const metadataResponse = await fetch(
        `${base}/.well-known/oauth-protected-resource/mcp`,
      );
      const metadata = await metadataResponse.json();
      assert.equal(
        metadata.resource,
        config.resource,
        JSON.stringify(metadata),
      );
      const authorizationMetadata = await (
        await fetch(`${base}/.well-known/oauth-authorization-server`)
      ).json();
      assert.equal(authorizationMetadata.issuer, config.issuer);
      assert.ok(
        authorizationMetadata.revocation_endpoint_auth_methods_supported.includes(
          "none",
        ),
      );
      const anonymous = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(anonymous.status, 401);
      assert.match(
        anonymous.headers.get("www-authenticate"),
        /resource_metadata/,
      );
      registered = await register();
      code = await authorize(registered);
      assert.equal((await exchange(code, "x".repeat(64))).status, 400);
      assert.equal(
        (await exchange(code, verifier, "https://attacker.invalid/mcp")).status,
        400,
      );
      const response = await exchange(code);
      assert.equal(response.status, 200, await response.clone().text());
      token = await response.json();
      assert.ok(token.refresh_token);
      const recreated = createOAuthService(client, config);
      assert.equal(
        (await recreated.provider.verifyAccessToken(token.access_token)).extra
          .owner_id,
        inspirations.owner,
      );
      assert.equal((await recreated.connections()).length, 1);
      const consumed = await exchange(code);
      assert.equal(consumed.status, 400);
      await assert.rejects(
        oauth.provider.verifyAccessToken(token.access_token),
      );
      code = await authorize(registered);
      token = await (await exchange(code)).json();
      const hostile = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Origin: "https://attacker.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(hostile.status, 403);
    },
  );
  await t.test(
    "official MCP client reads clothes/images and persists a draft visible through the website API",
    async () => {
      mcp = new Client({ name: "acceptance-client", version: "1.0.0" });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(config.resource), {
          requestInit: {
            headers: { Authorization: `Bearer ${token.access_token}` },
          },
        }),
      );
      t.after(() => mcp.close());
      const availableTools = (await mcp.listTools()).tools;
      assert.ok(
        availableTools.every(
          (tool) => tool._meta.securitySchemes[0].type === "oauth2",
        ),
      );
      assert.deepEqual(
        availableTools.find(
          (tool) => tool.name === "inspiration_match_wardrobe",
        )._meta.securitySchemes[0].scopes,
        ["inspiration:read", "wardrobe:read"],
      );
      const listed = await call("wardrobe_list_items", { page_size: 100 });
      assert.equal(listed.total, 10);
      const result = await mcp.callTool({
        name: "inspiration_get_image",
        arguments: { image_id: image.id },
      });
      assert.equal(result.content[0].type, "image");
      assert.equal(
        Buffer.from(result.content[0].data, "base64").compare(imageFile.bytes),
        0,
      );
      const data = {
        draft: {
          title: "ChatGPT 创建的灵感",
          source_image_id: image.id,
          analysis_status: "ready",
          reference_items: [
            {
              category: clothes[0].category,
              color_family: clothes[0].color_family,
              pattern: "unknown",
              visibility: "partial",
              needs_review: true,
            },
          ],
        },
        idempotency_key: "mcp-create-draft-001",
      };
      const created = await call("inspiration_create_draft", data),
        retry = await call("inspiration_create_draft", data);
      assert.equal(created.id, retry.id);
      assert.equal(created.source, "chatgpt");
      assert.equal(created.status, "draft");
      const visible = await app.inject({
        url: `/api/wardrobe/inspirations/${created.id}`,
        headers: { cookie },
      });
      assert.equal(visible.statusCode, 200);
      assert.equal(visible.json().title, data.draft.title);
      assert.match(created.details_url, /\/wardrobe\?inspiration=/);
      const untrusted = await mcp.callTool({
        name: "inspiration_create_draft",
        arguments: { ...data, draft: { ...data.draft, owner_id: "attacker" } },
      });
      assert.equal(untrusted.isError, true);
      assert.equal(
        (await call("inspiration_publish", { id: created.id })).status,
        "confirmation_required",
      );
      assert.equal((await inspirations.get(created.id)).status, "draft");
      const matches = await call("inspiration_match_wardrobe", {
        id: created.id,
      });
      assert.ok(matches.matches[0].candidates.length > 0);
      const current = await inspirations.get(created.id);
      const updated = await call("inspiration_update_draft", {
        id: current.id,
        draft: { ...editableDraft(current), styling_notes: "由 ChatGPT 更新" },
        expected_revision: current.revision,
        idempotency_key: key(),
      });
      assert.equal(updated.revision, current.revision + 1);
    },
  );
  await t.test(
    "MCP wardrobe writes are atomic/idempotent and preserve existing clothing; scopes cannot be escalated",
    async () => {
      const original = await wardrobe.getItemDetails(clothes[0].id);
      const args = {
        id: original.id,
        patch: { notes: "MCP 备注" },
        idempotency_key: key(),
      };
      const first = await call("wardrobe_update_item", args),
        second = await call("wardrobe_update_item", args);
      assert.equal(first.details_url, `${base}/wardrobe?item=${original.id}`);
      assert.equal(first.updated_at, second.updated_at);
      assert.equal(
        (await wardrobe.getItemDetails(original.id)).notes,
        "MCP 备注",
      );
      assert.equal((await wardrobe.listItems()).total, 10);
      assert.equal(
        (await wardrobe.getItemDetails(original.id)).external_id,
        original.external_id,
      );
      const mutation = {
        key: key(),
        hash: requestHash({ name: "new" }),
        actor: "test",
      };
      const file = {
        bytes: imageFile.bytes,
        filename: imageFile.image_path,
        mimetype: imageFile.info.mime,
      };
      const input = {
        name: "MCP 新衣物",
        primary_color: "蓝色",
        category: "tops",
      };
      const created = await wardrobe.createItem(input, file, mutation);
      assert.equal(
        (await wardrobe.createItem(input, file, mutation)).id,
        created.id,
      );
      assert.equal((await wardrobe.listItems()).total, 11);
      const narrowCode = await authorize(registered, "wardrobe:read"),
        response = await exchange(narrowCode),
        narrow = await response.json();
      const limited = new Client({ name: "read-only", version: "1" });
      await limited.connect(
        new StreamableHTTPClientTransport(new URL(config.resource), {
          requestInit: {
            headers: { Authorization: `Bearer ${narrow.access_token}` },
          },
        }),
      );
      const result = await limited.callTool({
        name: "wardrobe_update_item",
        arguments: args,
      });
      assert.equal(result.isError, true);
      assert.ok(
        (await limited.listTools()).tools.every(
          (tool) =>
            tool.name.startsWith("wardrobe_") &&
            !tool.name.includes("update") &&
            !tool.name.includes("create"),
        ),
      );
      await limited.close();
    },
  );
  await t.test(
    "website edits, optimistic conflicts, manual matching, publishing, JSON round-trip and owner boundaries",
    async () => {
      const matches = await inspirations.match(draft.id);
      const candidate = matches.matches[0].candidates[0];
      const values = editableDraft(draft);
      values.reference_items[0].matched_wardrobe_item_id = candidate.item.id;
      const update = await app.inject({
        method: "PATCH",
        url: `/api/wardrobe/inspirations/${draft.id}`,
        headers: { cookie, "Idempotency-Key": "web-edit-00001" },
        payload: { draft: values, expected_revision: draft.revision },
      });
      assert.equal(update.statusCode, 200, update.body);
      draft = update.json();
      const conflict = await app.inject({
        method: "PATCH",
        url: `/api/wardrobe/inspirations/${draft.id}`,
        headers: { cookie, "Idempotency-Key": key() },
        payload: { draft: values, expected_revision: 1 },
      });
      assert.equal(conflict.statusCode, 409);
      const published = await inspirations.publish(draft.id, {
        key: "publish-00001",
        expectedRevision: draft.revision,
      });
      assert.equal(published.status, "published");
      assert.equal(
        (
          await inspirations.publish(draft.id, {
            key: "publish-00001",
            expectedRevision: draft.revision,
          })
        ).revision,
        published.revision,
      );
      const json = await inspirations.exportJson(draft.id);
      assert.ok(!json.inspiration.reference_items[0].id);
      const imported = await inspirations.create(json.inspiration, {
        key: key(),
        source: "json-import",
      });
      assert.equal(imported.status, "draft");
      const other = createInspirationService(client, {
        wardrobe,
        owner: "other-user",
      });
      assert.equal((await other.list()).items.length, 0);
      await assert.rejects(other.get(draft.id), (e) => e.statusCode === 404);
      await assert.rejects(
        other.getImage(image.id),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        other.create(
          { title: "steal", source_image_id: image.id },
          { key: key() },
        ),
        /图片/,
      );
      const pending = await inspirations.create(
        {
          title: "未整理",
          analysis_status: "failed",
          analysis_error: "图片模糊",
        },
        { key: key() },
      );
      await assert.rejects(
        inspirations.publish(pending.id, { key: key(), expectedRevision: 1 }),
        /发布前/,
      );
      await inspirations.remove(pending.id, {
        key: key(),
        expectedRevision: 1,
      });
      await assert.rejects(
        inspirations.get(pending.id),
        (e) => e.statusCode === 404,
      );
      const reload = createInspirationService(client, { wardrobe });
      assert.equal((await reload.get(draft.id)).status, "published");
    },
  );
  await t.test(
    "refresh rotation, replay revocation, explicit website revocation and expiry/issuer enforcement",
    async () => {
      const refresh = await fetch(`${base}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: registered.client_id,
          refresh_token: token.refresh_token,
          resource: config.resource,
        }),
      });
      assert.equal(refresh.status, 200, await refresh.clone().text());
      const rotated = await refresh.json();
      await oauth.provider.verifyAccessToken(rotated.access_token);
      const replay = await fetch(`${base}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: registered.client_id,
          refresh_token: token.refresh_token,
          resource: config.resource,
        }),
      });
      assert.equal(replay.status, 400);
      await assert.rejects(
        oauth.provider.verifyAccessToken(rotated.access_token),
      );
      const next = await (await exchange(await authorize(registered))).json(),
        info = await oauth.provider.verifyAccessToken(next.access_token);
      await pg.query("UPDATE nmdd_oauth_grants SET issuer=$1 WHERE id=$2", [
        "https://wrong.invalid",
        info.extra.grant_id,
      ]);
      await assert.rejects(oauth.provider.verifyAccessToken(next.access_token));
      await pg.query("UPDATE nmdd_oauth_grants SET issuer=$1 WHERE id=$2", [
        config.issuer,
        info.extra.grant_id,
      ]);
      const revoke = await app.inject({
        method: "POST",
        url: `/api/wardrobe/inspirations/connections/${info.extra.grant_id}/revoke`,
        headers: { cookie },
      });
      assert.equal(revoke.statusCode, 200);
      await assert.rejects(oauth.provider.verifyAccessToken(next.access_token));
      const audit = await pg.query("SELECT * FROM nmdd_tool_audit");
      assert.ok(
        audit.rows.some((row) => row.action === "inspiration_create_draft"),
      );
      assert.ok(!JSON.stringify(audit.rows).includes(token.access_token));
    },
  );
  await t.test(
    "confidential clients use encrypted secrets, token expiry/revocation and external request throttling",
    async () => {
      const response = await fetch(`${base}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Isolated MCP client",
          redirect_uris: [`${base}/callback`],
          token_endpoint_auth_method: "client_secret_post",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
      assert.equal(response.status, 201);
      const info = await response.json();
      assert.ok(info.client_secret);
      const stored = (
        await pg.query(
          "SELECT client_secret_ciphertext FROM nmdd_oauth_clients WHERE client_id=$1",
          [info.client_id],
        )
      ).rows[0];
      assert.ok(
        stored.client_secret_ciphertext &&
          !stored.client_secret_ciphertext.includes(info.client_secret),
      );
      assert.equal(
        (
          await createOAuthService(
            client,
            config,
          ).provider.clientsStore.getClient(info.client_id)
        ).client_secret,
        info.client_secret,
      );
      const authCode = await authorize(info);
      const form = {
        grant_type: "authorization_code",
        client_id: info.client_id,
        code: authCode,
        code_verifier: verifier,
        redirect_uri: `${base}/callback`,
        resource: config.resource,
      };
      const missingSecret = await fetch(`${base}/token`, {
        method: "POST",
        body: new URLSearchParams(form),
      });
      assert.equal(missingSecret.status, 400);
      assert.equal((await missingSecret.json()).error, "invalid_client");
      const exchanged = await fetch(`${base}/token`, {
        method: "POST",
        body: new URLSearchParams({
          ...form,
          client_secret: info.client_secret,
        }),
      });
      assert.equal(exchanged.status, 200, await exchanged.clone().text());
      const credentials = await exchanged.json();
      const auth = await oauth.provider.verifyAccessToken(
        credentials.access_token,
      );
      await pg.query(
        "UPDATE nmdd_oauth_tokens SET expires_at=now()-interval '1 second' WHERE grant_id=$1 AND kind='access'",
        [auth.extra.grant_id],
      );
      await assert.rejects(
        oauth.provider.verifyAccessToken(credentials.access_token),
      );
      const revoked = await fetch(`${base}/revoke`, {
        method: "POST",
        body: new URLSearchParams({
          client_id: info.client_id,
          client_secret: info.client_secret,
          token: credentials.refresh_token,
        }),
      });
      assert.equal(revoked.status, 200);
      assert.ok(
        (
          await pg.query(
            "SELECT revoked_at FROM nmdd_oauth_grants WHERE id=$1",
            [auth.extra.grant_id],
          )
        ).rows[0].revoked_at,
      );
      const attempts = await Promise.all(
        Array.from({ length: 105 }, () =>
          fetch(`${base}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }),
        ),
      );
      assert.ok(attempts.some((res) => res.status === 429));
    },
  );
});
