import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { WardrobeItem, BundleItem } from "../types";
export type Reference = {
  id?: string;
  category: BundleItem["category"];
  subcategory?: string | null;
  primary_color?: string | null;
  color_family?: BundleItem["color_family"];
  pattern?: BundleItem["pattern"];
  design_features?: string[];
  style_tags?: string[];
  bounding_box?: { x: number; y: number; width: number; height: number } | null;
  visibility?: "visible" | "partial" | "unclear";
  matched_wardrobe_item_id?: string | null;
  match_reason?: string | null;
  match_score?: number | null;
  needs_review?: boolean;
};
export type Draft = {
  title: string;
  source_image_id?: string | null;
  source_url?: string | null;
  overall_style?: string | null;
  color_palette?: string[];
  occasions?: NonNullable<BundleItem["occasions"]>;
  styling_notes?: string | null;
  analysis_status?: "pending" | "analyzing" | "ready" | "failed";
  analysis_error?: string | null;
  reference_items?: Reference[];
};
export type Inspiration = Draft & {
  id: string;
  revision: number;
  source: "website" | "chatgpt" | "json-import";
  status: "draft" | "published";
  source_image_url: string | null;
  details_url: string;
  updated_at: string;
  reference_items: Reference[];
};
export type Candidate = {
  item: WardrobeItem;
  match_score: number;
  match_reason: string;
};
export type Match = {
  revision: number;
  score_note: string;
  matches: { reference_id: string; candidates: Candidate[] }[];
};
const base = "/api/wardrobe/inspirations";
// Keep the same key when retrying an uncertain network failure, including file uploads.
const pending = new Map<string, string>();
const fileKeys = new WeakMap<File, string>();
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(base + path, {
    ...init,
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      body.error || (response.status === 401 ? "请先登录" : "请求失败，请重试"),
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}
async function write<T>(
  path: string,
  method: string,
  body: unknown,
): Promise<T> {
  const signature = method + path + JSON.stringify(body),
    key = pending.get(signature) || crypto.randomUUID();
  pending.set(signature, key);
  try {
    const result = await request<T>(path, {
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    pending.delete(signature);
    return result;
  } catch (error) {
    if (
      (error as { status?: number }).status &&
      (error as { status: number }).status < 500
    )
      pending.delete(signature);
    throw error;
  }
}
let validator: Promise<ValidateFunction> | undefined;
export async function validateDraft(value: unknown) {
  validator ||= request<object>("/schema")
    .then((schema) => {
      const ajv = new Ajv({ strict: false, allErrors: true });
      addFormats(ajv);
      return ajv.compile(schema);
    })
    .catch((error) => {
      validator = undefined;
      throw error;
    });
  const validate = await validator;
  if (!validate(value))
    throw new Error(
      `灵感格式错误：${validate.errors
        ?.slice(0, 3)
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("；")}`,
    );
}
export function editable(row: Inspiration): Draft {
  const {
    title,
    source_image_id,
    source_url,
    overall_style,
    color_palette,
    occasions,
    styling_notes,
    analysis_status,
    analysis_error,
  } = row;
  const reference_items = row.reference_items.map(
    ({
      id,
      category,
      subcategory,
      primary_color,
      color_family,
      pattern,
      design_features,
      style_tags,
      bounding_box,
      visibility,
      matched_wardrobe_item_id,
      match_reason,
      match_score,
      needs_review,
    }) => ({
      id,
      category,
      subcategory,
      primary_color,
      color_family,
      pattern,
      design_features,
      style_tags,
      bounding_box,
      visibility,
      matched_wardrobe_item_id,
      match_reason,
      match_score,
      needs_review,
    }),
  );
  return {
    title,
    source_image_id,
    source_url,
    overall_style,
    color_palette,
    occasions,
    styling_notes,
    analysis_status,
    analysis_error,
    reference_items,
  };
}
export const inspirationApi = {
  list: (page = 1, status = "") =>
    request<{ items: Inspiration[]; has_more: boolean }>(
      `/?page=${page}&status=${status}`,
    ),
  get: (id: string) => request<Inspiration>(`/${id}`),
  async create(draft: Draft) {
    await validateDraft(draft);
    return write<Inspiration>("/drafts", "POST", draft);
  },
  async update(row: Inspiration, draft: Draft) {
    await validateDraft(draft);
    return write<Inspiration>(`/${row.id}`, "PATCH", {
      expected_revision: row.revision,
      draft,
    });
  },
  publish: (row: Inspiration) =>
    write<Inspiration>(`/${row.id}/publish`, "POST", {
      expected_revision: row.revision,
    }),
  remove: (row: Inspiration) =>
    write<Inspiration>(`/${row.id}`, "DELETE", {
      expected_revision: row.revision,
    }),
  match: (id: string) => request<Match>(`/${id}/match`, { method: "POST" }),
  async upload(file: File) {
    if (file.size > 8 * 1024 * 1024) throw new Error("图片最大 8MB");
    const form = new FormData();
    form.set("file", file);
    const key = fileKeys.get(file) || crypto.randomUUID();
    fileKeys.set(file, key);
    return request<{ id: string; image_url: string }>("/images", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: form,
    });
  },
  export: (id: string) => request<object>(`/${id}/export`),
  async import(value: unknown) {
    const envelope = value as {
      format?: string;
      schema_version?: number;
      inspiration?: unknown;
    };
    if (
      envelope?.format !== "nmdd-inspiration" ||
      envelope.schema_version !== 1
    )
      throw new Error("需要 nmdd-inspiration / schema_version: 1 格式");
    await validateDraft(envelope.inspiration);
    return write<Inspiration>("/import", "POST", value);
  },
  connections: () =>
    request<{
      enabled: boolean;
      mcp_url: string | null;
      items: {
        id: string;
        client_name: string;
        scopes: string[];
        created_at: string;
      }[];
    }>("/connections"),
  revoke: (id: string) =>
    request(`/connections/${id}/revoke`, { method: "POST" }),
};
