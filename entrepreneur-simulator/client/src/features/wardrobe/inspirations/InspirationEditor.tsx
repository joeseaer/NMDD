import { useEffect, useState } from "react";
import { Download, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { wardrobeApi, download } from "../api";
import {
  buttonClass,
  inputClass,
  Modal,
  primaryClass,
  Select,
} from "../components";
import {
  categories,
  colors,
  occasions,
  patterns,
  type WardrobeItem,
} from "../types";
import {
  editable,
  inspirationApi,
  type Draft,
  type Inspiration,
  type Match,
  type Reference,
} from "./api";
const tags = (text: string) =>
  text ? text.split(/[,，]/).map((x) => x.trim()) : [];
export default function InspirationEditor({
  initial,
  close,
  saved,
}: {
  initial: Inspiration;
  close: () => void;
  saved: () => void;
}) {
  const [row, setRow] = useState(initial),
    [draft, setDraft] = useState<Draft>(() => editable(initial)),
    [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [owned, setOwned] = useState<WardrobeItem[]>([]),
    [match, setMatch] = useState<Match | null>(null),
    [picker, setPicker] = useState<number | null>(null),
    [search, setSearch] = useState("");
  const [imageState, setImageState] = useState<"loading" | "ready" | "failed">(
      "loading",
    ),
    [imageRevision, setImageRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const items: WardrobeItem[] = [];
      for (let page = 1; ; page++) {
        const data = await wardrobeApi.list({
          page: String(page),
          page_size: "100",
        });
        items.push(...data.items);
        if (items.length >= data.total) break;
      }
      if (alive) setOwned(items);
    })().catch((cause) => {
      if (alive) setError(cause.message);
    });
    return () => {
      alive = false;
    };
  }, []);
  function change(patch: Partial<Draft>) {
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(draft[key as keyof Draft]) === JSON.stringify(value),
      )
    )
      return;
    setDraft((old) => ({ ...old, ...patch }));
    setDirty(true);
    setMessage("");
    setMatch(null);
  }
  function reference(index: number, patch: Partial<Reference>) {
    change({
      reference_items: (draft.reference_items || []).map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  }
  function accept(result: Inspiration) {
    setRow(result);
    setDraft(editable(result));
    setDirty(false);
    saved();
  }
  function dismiss() {
    if (!dirty || window.confirm("有尚未保存的修改，确定关闭？")) close();
  }
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const result = await inspirationApi.update(row, draft);
    accept(result);
    setMessage("草稿已保存，等待确认");
    return result;
  }
  async function reload() {
    if (dirty && !window.confirm("重新加载会放弃未保存的修改，继续？")) return;
    accept(await inspirationApi.get(row.id));
    setImageState("loading");
    setImageRevision((value) => value + 1);
    setMatch(null);
    setMessage("已加载最新版本");
  }
  const references = draft.reference_items || [];
  const selectedReference = picker === null ? null : references[picker];
  const candidates = owned.filter(
    (item) =>
      item.status !== "archived" &&
      (!selectedReference || item.category === selectedReference.category) &&
      (!search || item.name.includes(search)),
  );
  return (
    <>
      <Modal
        title="穿搭灵感详情"
        layout="workspace"
        busy={busy}
        close={dismiss}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
            <section className="min-w-0 border-b bg-slate-50 p-4 sm:p-6 lg:border-b-0 lg:border-r">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>原始参考图</span>
                <span className="rounded-full border bg-white px-3 py-1 text-xs">
                  {row.source === "chatgpt"
                    ? "在 ChatGPT 中创建"
                    : row.source === "json-import"
                      ? "JSON 导入"
                      : "网站上传"}
                </span>
              </div>
              <div className="flex min-h-64 items-center justify-center rounded-xl bg-white p-2 lg:sticky lg:top-4">
                {row.source_image_url ? (
                  <img
                    key={`${row.source_image_url}:${imageRevision}`}
                    src={row.source_image_url}
                    alt="穿搭原始参考图"
                    onLoad={() => setImageState("ready")}
                    onError={() => setImageState("failed")}
                    className="max-h-[66dvh] w-full object-contain"
                  />
                ) : (
                  <p className="p-10 text-sm text-gray-500">
                    尚未上传原图，发布前需要补充
                  </p>
                )}
              </div>
              {imageState === "failed" && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  原图加载失败，请重新加载最新版本或替换图片，确认原图后再发布。
                </p>
              )}
              <label className="mt-4 block text-sm text-gray-600">
                替换 / 补充原图
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  className={inputClass}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void action(async () => {
                        const image = await inspirationApi.upload(file);
                        setImageState("loading");
                        change({ source_image_id: image.id });
                        setRow((old) => ({
                          ...old,
                          source_image_url: image.image_url,
                        }));
                      });
                  }}
                />
              </label>
              <p className="mt-3 break-all text-xs text-gray-500">
                图片编号：{draft.source_image_id || "未上传"}
                <br />
                灵感编号：{row.id}
              </p>
            </section>
            <fieldset disabled={busy} className="min-w-0 space-y-5 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-sm ${row.status === "published" && !dirty ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}
                >
                  {row.status === "published" && !dirty
                    ? "已保存到灵感库"
                    : dirty
                      ? "有未保存修改"
                      : "待确认草稿"}
                </span>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void action(reload)}
                >
                  <RefreshCw size={14} />
                  重新加载最新版本
                </button>
              </div>
              <label className="block text-sm">
                穿搭名称
                <input
                  maxLength={200}
                  className={inputClass}
                  value={draft.title}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  整体风格
                  <input
                    maxLength={1000}
                    className={inputClass}
                    value={draft.overall_style || ""}
                    onChange={(e) =>
                      change({ overall_style: e.target.value || null })
                    }
                  />
                </label>
                <label className="text-sm">
                  主要配色（逗号分隔）
                  <input
                    className={inputClass}
                    value={(draft.color_palette || []).join(",")}
                    onBlur={(e) =>
                      change({
                        color_palette: tags(e.target.value).filter(Boolean),
                      })
                    }
                    onChange={(e) =>
                      change({ color_palette: tags(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label className="block text-sm">
                来源链接
                <input
                  type="url"
                  maxLength={2000}
                  className={inputClass}
                  value={draft.source_url || ""}
                  placeholder="https://…"
                  onChange={(e) =>
                    change({ source_url: e.target.value || null })
                  }
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-sm">适用场景</legend>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(occasions).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={
                          draft.occasions?.includes(
                            value as keyof typeof occasions,
                          ) || false
                        }
                        onChange={(e) =>
                          change({
                            occasions: e.target.checked
                              ? [
                                  ...(draft.occasions || []),
                                  value as keyof typeof occasions,
                                ]
                              : draft.occasions?.filter((v) => v !== value),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm">
                搭配逻辑
                <textarea
                  aria-label="搭配逻辑"
                  maxLength={10000}
                  rows={3}
                  className={inputClass}
                  value={draft.styling_notes || ""}
                  onChange={(e) =>
                    change({ styling_notes: e.target.value || null })
                  }
                />
              </label>
              <Select
                label="整理状态"
                value={draft.analysis_status || "ready"}
                values={{
                  pending: "等待 ChatGPT 或手动整理",
                  analyzing: "整理中",
                  ready: "整理完成，待确认",
                  failed: "整理失败，可重新编辑",
                }}
                onChange={(value) =>
                  change({ analysis_status: value as Draft["analysis_status"] })
                }
              />
              {draft.analysis_status === "pending" && (
                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                  将图片编号交给已连接的
                  ChatGPT，让它读取原图并更新这份草稿。也可以在此手动填写，或导入整理好的
                  JSON。
                </p>
              )}
              {draft.analysis_status === "failed" && (
                <label className="block text-sm text-red-700">
                  失败原因
                  <textarea
                    aria-label="失败原因"
                    maxLength={1000}
                    className={inputClass}
                    value={draft.analysis_error || ""}
                    onChange={(e) =>
                      change({ analysis_error: e.target.value || null })
                    }
                  />
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <h3 className="font-semibold">
                  参考单品 · {references.length}
                </h3>
                <div className="flex gap-2">
                  <button
                    className={buttonClass}
                    disabled={busy || !references.length}
                    onClick={() =>
                      void action(async () => {
                        const current = dirty ? await save() : row;
                        setMatch(await inspirationApi.match(current.id));
                        setMessage("已生成候选，请逐件确认选择");
                      })
                    }
                  >
                    匹配我的衣橱
                  </button>
                  <button
                    className={buttonClass}
                    disabled={busy || references.length >= 30}
                    onClick={() =>
                      change({
                        reference_items: [
                          ...references,
                          {
                            category: "tops",
                            pattern: "unknown",
                            visibility: "unclear",
                            needs_review: true,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    添加单品
                  </button>
                </div>
              </div>
              {match && (
                <p className="text-xs text-gray-500">{match.score_note}</p>
              )}
              {references.map((item, index) => {
                const linked = owned.find(
                    (i) => i.id === item.matched_wardrobe_item_id,
                  ),
                  suggestions =
                    match?.matches.find((m) => m.reference_id === item.id)
                      ?.candidates || [];
                return (
                  <article
                    key={item.id || `new-${index}`}
                    className="space-y-3 rounded-xl border p-4"
                    aria-label={`参考单品 ${index + 1}`}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">单品 {index + 1}</h4>
                      <button
                        className={buttonClass}
                        disabled={busy}
                        onClick={() =>
                          change({
                            reference_items: references.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                        aria-label={`删除单品 ${index + 1}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select
                        label="类别"
                        value={item.category}
                        values={categories}
                        onChange={(value) =>
                          reference(index, {
                            category: value as Reference["category"],
                            matched_wardrobe_item_id: null,
                            match_reason: null,
                            match_score: null,
                          })
                        }
                      />
                      <label className="text-sm">
                        子类别
                        <input
                          className={inputClass}
                          maxLength={200}
                          value={item.subcategory || ""}
                          onChange={(e) =>
                            reference(index, {
                              subcategory: e.target.value || null,
                            })
                          }
                        />
                      </label>
                      <label className="text-sm">
                        颜色描述
                        <input
                          className={inputClass}
                          maxLength={200}
                          value={item.primary_color || ""}
                          placeholder="看不清可留空"
                          onChange={(e) =>
                            reference(index, {
                              primary_color: e.target.value || null,
                            })
                          }
                        />
                      </label>
                      <Select
                        label="颜色族"
                        optional
                        value={item.color_family || ""}
                        values={colors}
                        onChange={(value) =>
                          reference(index, {
                            color_family:
                              (value as Reference["color_family"]) || null,
                          })
                        }
                      />
                      <Select
                        label="图案"
                        value={item.pattern || "unknown"}
                        values={patterns}
                        onChange={(value) =>
                          reference(index, {
                            pattern: value as Reference["pattern"],
                          })
                        }
                      />
                      <Select
                        label="可见程度"
                        value={item.visibility || "unclear"}
                        values={{
                          visible: "清晰可见",
                          partial: "部分可见",
                          unclear: "无法确定",
                        }}
                        onChange={(value) =>
                          reference(index, {
                            visibility: value as Reference["visibility"],
                          })
                        }
                      />
                    </div>
                    <label className="block text-sm">
                      设计特点（逗号分隔）
                      <input
                        className={inputClass}
                        value={(item.design_features || []).join(",")}
                        onBlur={(e) =>
                          reference(index, {
                            design_features: tags(e.target.value).filter(
                              Boolean,
                            ),
                          })
                        }
                        onChange={(e) =>
                          reference(index, {
                            design_features: tags(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      风格标签（逗号分隔）
                      <input
                        className={inputClass}
                        value={(item.style_tags || []).join(",")}
                        onBlur={(e) =>
                          reference(index, {
                            style_tags: tags(e.target.value).filter(Boolean),
                          })
                        }
                        onChange={(e) =>
                          reference(index, { style_tags: tags(e.target.value) })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.needs_review ?? true}
                        onChange={(e) =>
                          reference(index, { needs_review: e.target.checked })
                        }
                      />
                      信息待核验
                    </label>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="mb-2 text-xs text-gray-500">
                        关联到我的衣橱
                      </p>
                      {linked ? (
                        <div className="flex items-center gap-3">
                          <img
                            src={linked.image_url}
                            alt={linked.name}
                            className="h-28 w-28 rounded-lg bg-white object-contain"
                          />
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium">
                              {linked.name}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {item.match_reason || "手动选择"}
                            </p>
                            <button
                              className="mt-2 text-sm text-red-600"
                              onClick={() =>
                                reference(index, {
                                  matched_wardrobe_item_id: null,
                                  match_reason: null,
                                  match_score: null,
                                })
                              }
                            >
                              解除关联
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          尚未关联，可保留空白
                        </p>
                      )}
                      <button
                        disabled={busy}
                        className={`${buttonClass} mt-3`}
                        onClick={() => {
                          setPicker(index);
                          setSearch("");
                        }}
                      >
                        从衣橱选择 / 替换
                      </button>
                    </div>
                    {!!suggestions.length && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {suggestions.map((candidate) => (
                          <button
                            key={candidate.item.id}
                            disabled={busy}
                            className="rounded-lg border bg-white p-2 text-left hover:border-blue-400"
                            onClick={() =>
                              reference(index, {
                                matched_wardrobe_item_id: candidate.item.id,
                                match_reason: candidate.match_reason,
                                match_score: candidate.match_score,
                              })
                            }
                          >
                            <img
                              className="aspect-square w-full object-contain"
                              src={candidate.item.image_url}
                              alt={candidate.item.name}
                            />
                            <p className="mt-2 text-sm">
                              {candidate.item.name}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              属性相似度{" "}
                              {Math.round(candidate.match_score * 100)}% ·{" "}
                              {candidate.match_reason}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {!references.length && (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-500">
                  添加参考单品，或让 ChatGPT 整理后保存草稿。
                </p>
              )}
            </fieldset>
          </div>
        </div>
        <footer className="shrink-0 border-t bg-white p-3 sm:px-6">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="mb-2 text-sm text-green-700">
              {message}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                disabled={busy}
                className={buttonClass}
                onClick={() =>
                  void action(async () =>
                    download(
                      new Blob(
                        [
                          JSON.stringify(
                            await inspirationApi.export(row.id),
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                      "nmdd-inspiration-v1.json",
                    ),
                  )
                }
              >
                <Download size={15} />
                导出 JSON
              </button>
              <button
                disabled={busy}
                className={`${buttonClass} text-red-600`}
                onClick={() => {
                  if (window.confirm("确定删除这份穿搭灵感？"))
                    void action(async () => {
                      await inspirationApi.remove(row);
                      saved();
                      close();
                    });
                }}
              >
                <Trash2 size={15} />
                删除
              </button>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy || !dirty}
                className={buttonClass}
                onClick={() =>
                  void action(async () => {
                    await save();
                  })
                }
              >
                <Save size={15} />
                保存草稿
              </button>
              <button
                disabled={
                  busy ||
                  (!!row.source_image_url && imageState !== "ready") ||
                  (row.status === "published" && !dirty)
                }
                className={primaryClass}
                onClick={() =>
                  void action(async () => {
                    const current = dirty ? await save() : row;
                    accept(await inspirationApi.publish(current));
                    setMessage("已保存到灵感库");
                  })
                }
              >
                {busy ? "处理中…" : "保存到灵感库"}
              </button>
            </div>
          </div>
        </footer>
      </Modal>
      {picker !== null && (
        <Modal
          title="选择我的衣物"
          layout="workspace"
          close={() => setPicker(null)}
        >
          <div className="shrink-0 border-b p-4">
            <input
              aria-label="搜索关联衣物"
              className={inputClass}
              placeholder="按衣物名称搜索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="mt-2 text-sm text-gray-500">
              {categories[selectedReference?.category || "other"]} ·{" "}
              {candidates.length} 件
            </p>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-5">
            {candidates.map((item) => (
              <button
                key={item.id}
                className="rounded-xl border p-3 text-left hover:border-blue-400"
                onClick={() => {
                  reference(picker, {
                    matched_wardrobe_item_id: item.id,
                    match_reason: "手动选择",
                    match_score: null,
                  });
                  setPicker(null);
                }}
              >
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="aspect-square w-full object-contain"
                />
                <p className="mt-3 text-sm">{item.name}</p>
              </button>
            ))}
            {!candidates.length && (
              <p className="col-span-full p-8 text-center text-gray-500">
                没有可关联的衣物
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
