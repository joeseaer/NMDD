const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { DEFAULT_USER_ID } = require("../config/currentUser");
const defaultWardrobe = require("./wardrobeService");
const { imageInfo, ensure, WardrobeError } = require("./wardrobeBundle");
const {
  schema,
  normalizeDraft,
  editableDraft,
  hash,
  requestHash,
  idempotencyKey,
  uuid,
  checkResult: check,
} = require("./inspirationContract");
const BUCKET = "wardrobe-inspiration-images";
function createInspirationService(
  client,
  {
    wardrobe = defaultWardrobe,
    owner = DEFAULT_USER_ID,
    siteUrl = process.env.NMDD_SITE_URL || "",
  } = {},
) {
  const db = () => {
    if (!client) throw new WardrobeError("数据库未配置", 503);
    return client;
  };
  const bucket = () => db().storage.from(BUCKET);
  const detailsUrl = (id) =>
    `${siteUrl.replace(/\/$/, "")}/wardrobe?inspiration=${id}`;
  const publicImage = (row) => ({
    id: row.id,
    sha256: row.sha256,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    created_at: row.created_at,
    image_url: `/api/wardrobe/inspirations/images/${row.id}`,
  });
  const publicDraft = (row) => {
    const { owner_id, source_image_key, ...rest } = row;
    return {
      ...rest,
      source_image_url: row.source_image_id
        ? `/api/wardrobe/inspirations/images/${row.source_image_id}`
        : null,
      details_url: detailsUrl(row.id),
      reference_items: (row.reference_items || []).map(
        ({ inspiration_id, ...item }) => item,
      ),
    };
  };
  async function getRaw(id) {
    ensure(uuid(id), "灵感编号无效");
    const row = check(
      await db()
        .from("wardrobe_inspirations")
        .select("*")
        .eq("id", id)
        .eq("owner_id", owner)
        .is("deleted_at", null)
        .maybeSingle(),
    );
    if (!row) throw new WardrobeError("灵感不存在或无权访问", 404);
    const references = check(
      await db()
        .from("wardrobe_inspiration_items")
        .select("*")
        .eq("inspiration_id", id)
        .order("position"),
    );
    return { ...row, reference_items: references };
  }
  async function get(id) {
    return publicDraft(await getRaw(id));
  }
  async function list({ page = 1, status = "" } = {}) {
    page = Number(page);
    ensure(Number.isInteger(page) && page >= 1 && page <= 100000, '页码必须为 1–100000 的整数');
    ensure(!status || ["draft", "published"].includes(status), "状态无效");
    let query = db()
      .from("wardrobe_inspirations")
      .select("*")
      .eq("owner_id", owner)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id")
      .range((page - 1) * 30, page * 30 - 1);
    if (status) query = query.eq("status", status);
    const rows = check(await query);
    return { items: rows.map(publicDraft), page, has_more: rows.length === 30 };
  }
  async function listImages() {
    return check(
      await db()
        .from("wardrobe_inspiration_images")
        .select("*")
        .eq("owner_id", owner)
        .order("created_at", { ascending: false })
        .limit(30),
    ).map(publicImage);
  }
  async function imageRow(id) {
    ensure(uuid(id), "图片编号无效");
    const row = check(
      await db()
        .from("wardrobe_inspiration_images")
        .select("*")
        .eq("id", id)
        .eq("owner_id", owner)
        .maybeSingle(),
    );
    if (!row) throw new WardrobeError("图片不存在或无权访问", 404);
    return row;
  }
  async function getImage(id) {
    const row = await imageRow(id),
      blob = check(await bucket().download(row.object_key));
    const bytes = Buffer.from(await blob.arrayBuffer()),
      info = imageInfo(bytes, row.object_key, row.mime_type);
    ensure(info.sha256 === row.sha256, "存储图片校验失败");
    return { bytes, mime: info.mime };
  }
  async function findRequest(operation, key, digest) {
    const row = check(
      await db()
        .from("nmdd_write_requests")
        .select("*")
        .eq("owner_id", owner)
        .eq("operation", operation)
        .eq("idempotency_key", key)
        .maybeSingle(),
    );
    if (row && row.request_hash !== digest)
      throw new WardrobeError("相同幂等键对应的内容不同，请使用新键", 409);
    return row?.response_json ?? null;
  }
  async function uploadImage(file, key, actor = "website", suppliedHash) {
    key = idempotencyKey(key);
    ensure(file, "请选择照片");
    const info = imageInfo(file.bytes, file.filename, file.mimetype),
      digest = suppliedHash || requestHash({ sha256: info.sha256 });
    const prior = await findRequest("image_upload", key, digest);
    if (prior) return publicImage(prior);
    const existing = check(
      await db()
        .from("wardrobe_inspiration_images")
        .select("*")
        .eq("owner_id", owner)
        .eq("sha256", info.sha256)
        .limit(1),
    )[0];
    const keyName =
      existing?.object_key ||
      `inspirations/${hash(owner).slice(0, 24)}/${info.sha256}/${crypto.randomUUID()}.${info.ext}`;
    let row;
    try {
      if (!existing)
        check(
          await bucket().upload(keyName, file.bytes, {
            contentType: info.mime,
            upsert: false,
          }),
        );
      row = check(
        await db().rpc("nmdd_inspiration_image", {
          p_owner: owner,
          p_payload: {
            object_key: keyName,
            sha256: info.sha256,
            mime_type: info.mime,
            byte_size: file.bytes.length,
          },
          p_key: key,
          p_hash: digest,
          p_actor: actor,
        }),
      );
      return publicImage(row);
    } finally {
      if (!existing) {
        // The unique object is removed only after confirming it has no committed metadata.
        const refs = await db()
          .from("wardrobe_inspiration_images")
          .select("id")
          .eq("owner_id", owner)
          .eq("object_key", keyName);
        if (!refs.error && !refs.data.length)
          await bucket()
            .remove([keyName])
            .catch(() => {});
      }
    }
  }
  async function mutate(operation, id, raw, options = {}) {
    const key = idempotencyKey(options.key),
      expected = options.expectedRevision ?? null;
    if (operation !== "inspiration_create")
      ensure(
        Number.isInteger(expected) && expected >= 1,
        "请提供当前草稿版本号",
      );
    const payload = ["inspiration_create", "inspiration_update"].includes(
      operation,
    )
      ? normalizeDraft(raw, options.source || "website")
      : {};
    const digest = requestHash({
      id: id || null,
      expected_revision: expected,
      payload,
    });
    const response = check(
      await db().rpc("nmdd_inspiration_mutate", {
        p_owner: owner,
        p_operation: operation,
        p_id: id || null,
        p_expected_revision: expected,
        p_payload: payload,
        p_key: key,
        p_hash: digest,
        p_actor: options.actor || "website",
      }),
    );
    return publicDraft(response);
  }
  async function create(raw, options) {
    return mutate("inspiration_create", null, raw, options);
  }
  async function update(id, raw, options) {
    ensure(uuid(id), "灵感编号无效");
    return mutate("inspiration_update", id, raw, options);
  }
  async function publish(id, options) {
    ensure(uuid(id), "灵感编号无效");
    return mutate("inspiration_publish", id, null, options);
  }
  async function remove(id, options) {
    ensure(uuid(id), "灵感编号无效");
    return mutate("inspiration_delete", id, null, options);
  }
  async function match(id) {
    const draft = await getRaw(id),
      items = [];
    for (let page = 1; ; page++) {
      const batch = await wardrobe.listItems({
        page,
        page_size: 100,
        status: "active",
      });
      items.push(...batch.items);
      if (items.length >= batch.total) break;
    }
    const matches = draft.reference_items.map((reference) => ({
      reference_id: reference.id,
      candidates: items
        .filter((item) => item.category === reference.category)
        .map((item) => {
          let score = 0.35;
          const reasons = ["类别一致"];
          if (
            reference.color_family &&
            item.color_family === reference.color_family
          ) {
            score += 0.3;
            reasons.push("颜色族一致");
          } else if (
            reference.primary_color &&
            item.primary_color.includes(reference.primary_color)
          ) {
            score += 0.2;
            reasons.push("颜色描述接近");
          }
          if (
            reference.pattern &&
            reference.pattern !== "unknown" &&
            item.pattern === reference.pattern
          ) {
            score += 0.15;
            reasons.push("图案一致");
          }
          const common = (reference.style_tags || []).filter((tag) =>
            (item.style_tags || []).includes(tag),
          );
          if (common.length) {
            score += Math.min(0.2, common.length * 0.1);
            reasons.push(`共同风格：${common.join("、")}`);
          }
          return {
            item,
            match_score: Math.round(Math.min(1, score) * 100) / 100,
            match_reason: reasons.join("；"),
          };
        })
        .sort(
          (a, b) =>
            b.match_score - a.match_score || a.item.id.localeCompare(b.item.id),
        )
        .slice(0, 5),
    }));
    return {
      inspiration_id: id,
      revision: draft.revision,
      method: "attribute-similarity",
      score_note: "属性相似度排序，不是识别概率；匹配候选需由你确认",
      matches,
    };
  }
  async function exportJson(id) {
    const row = await getRaw(id),
      draft = editableDraft(row);
    draft.reference_items = draft.reference_items.map(
      ({ id, ...item }) => item,
    );
    return {
      format: "nmdd-inspiration",
      schema_version: 1,
      inspiration: draft,
    };
  }
  async function audit(action, outcome, actor = "website", recordId = null) {
    check(
      await db()
        .from("nmdd_tool_audit")
        .insert({
          owner_id: owner,
          actor: String(actor).slice(0, 200),
          action: String(action).slice(0, 100),
          outcome,
          record_id: recordId,
        }),
    );
  }
  return {
    schema,
    owner,
    detailsUrl,
    list,
    get,
    listImages,
    getImage,
    imageRow,
    uploadImage,
    findRequest,
    create,
    update,
    publish,
    remove,
    match,
    exportJson,
    audit,
  };
}
const client =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
module.exports = {
  ...createInspirationService(client),
  createInspirationService,
};
