const crypto = require("node:crypto");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const schema = require("../contracts/inspiration.schema.json");
const { WardrobeError, ensure } = require("./wardrobeBundle");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const requestHash = (value) => hash(JSON.stringify(canonical(value)));
function idempotencyKey(value) {
  ensure(
    typeof value === "string" &&
      value.length >= 8 &&
      value.length <= 200 &&
      !/[\x00-\x1f]/.test(value),
    "idempotency_key 必须为 8–200 字符",
  );
  return value;
}
function normalizeDraft(raw, source = "website") {
  if (!validate(raw))
    throw new WardrobeError(
      "穿搭灵感格式错误",
      400,
      validate.errors.map((e) => ({
        field: e.instancePath || "/",
        message: e.message,
      })),
    );
  const result = {
    title: raw.title.trim(),
    source_image_id: raw.source_image_id ?? null,
    source_url: raw.source_url || null,
    overall_style: raw.overall_style || null,
    color_palette: raw.color_palette || [],
    occasions: raw.occasions || [],
    styling_notes: raw.styling_notes || null,
    analysis_status: raw.analysis_status || "ready",
    analysis_error: raw.analysis_error || null,
    source,
    reference_items: (raw.reference_items || []).map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      category: item.category,
      subcategory: item.subcategory || null,
      primary_color: item.primary_color || null,
      color_family: item.color_family || null,
      pattern: item.pattern || "unknown",
      design_features: item.design_features || [],
      style_tags: item.style_tags || [],
      bounding_box: item.bounding_box || null,
      visibility: item.visibility || "unclear",
      matched_wardrobe_item_id: item.matched_wardrobe_item_id || null,
      match_reason: item.match_reason || null,
      match_score: item.match_score ?? null,
      needs_review:
        item.needs_review ??
        (!item.primary_color || item.visibility !== "visible"),
    })),
  };
  for (const item of result.reference_items)
    if (item.bounding_box)
      ensure(
        item.bounding_box.x + item.bounding_box.width <= 1 &&
          item.bounding_box.y + item.bounding_box.height <= 1,
        "单品位置必须位于原图范围内",
      );
  return result;
}
function editableDraft(row) {
  return Object.fromEntries(
    Object.keys(schema.properties)
      .filter((key) => row[key] !== undefined)
      .map((key) => [
        key,
        key === "reference_items"
          ? row[key].map((item) =>
              Object.fromEntries(
                Object.keys(schema.definitions.referenceItem.properties)
                  .filter((k) => item[k] !== undefined)
                  .map((k) => [k, item[k]]),
              ),
            )
          : row[key],
      ]),
  );
}
function checkResult({ data, error }) {
  if (error) {
    if (error.code === "P0002")
      throw new WardrobeError("记录不存在或无权访问", 404);
    const known = {
      IDEMPOTENCY_CONFLICT: ["相同幂等键对应的内容不同，请使用新键", 409],
      REVISION_CONFLICT: ["草稿已更新，请重新加载后确认", 409],
      INVALID_IMAGE: ["图片不存在或不属于当前账户", 400],
      INVALID_MATCH: ["匹配衣物已删除或无权访问，请重新选择", 400],
      INVALID_REFERENCE_ID: ["参考单品编号无效或重复", 400],
      INCOMPLETE_DRAFT: [
        "发布前需要原图、至少一件参考单品和已完成的整理结果",
        400,
      ],
    };
    const match = Object.keys(known).find((key) =>
      String(error.message).includes(key),
    );
    if (match) throw new WardrobeError(...known[match]);
    throw new WardrobeError("灵感存储操作失败，请检查数据库迁移后重试", 503);
  }
  return data;
}
module.exports = {
  schema,
  normalizeDraft,
  editableDraft,
  hash,
  requestHash,
  idempotencyKey,
  uuid,
  checkResult,
};
