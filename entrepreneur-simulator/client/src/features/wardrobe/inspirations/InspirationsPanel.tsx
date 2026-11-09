import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, Upload } from "lucide-react";
import { buttonClass, inputClass, Modal, primaryClass } from "../components";
import { inspirationApi, type Inspiration } from "./api";
import InspirationEditor from "./InspirationEditor";
const sample = {
  format: "nmdd-inspiration",
  schema_version: 1,
  inspiration: {
    title: "日常简约穿搭",
    source_image_id: null,
    overall_style: "简约",
    color_palette: ["白色", "蓝色"],
    occasions: ["daily"],
    styling_notes: "用简洁配色与宽松轮廓组合。",
    analysis_status: "ready",
    reference_items: [
      {
        category: "tops",
        subcategory: null,
        primary_color: "白色",
        color_family: "white",
        pattern: "unknown",
        visibility: "partial",
        design_features: [],
        style_tags: ["简约"],
        matched_wardrobe_item_id: null,
        needs_review: true,
      },
    ],
  },
};
const permissionLabels: Record<string, string> = {
  "wardrobe:read": "读取衣橱和照片",
  "wardrobe:write": "新增和修改衣物",
  "inspiration:read": "查看灵感和参考图",
  "inspiration:write": "上传图片、创建和修改草稿",
};
const statusText = (row: Inspiration) =>
  row.status === "published"
    ? "已保存"
    : {
        pending: "等待整理",
        analyzing: "整理中",
        ready: "待确认",
        failed: "整理失败",
      }[row.analysis_status || "ready"];
export default function InspirationsPanel() {
  const [items, setItems] = useState<Inspiration[]>([]),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [more, setMore] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [editor, setEditor] = useState<Inspiration | null>(null);
  const [importing, setImporting] = useState(false),
    [connections, setConnections] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await inspirationApi.list(page, status);
      setItems(result.items);
      setMore(result.has_more);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, status]);
  useEffect(() => {
    setLoading(true);
    void refresh();
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(reload, 10000);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [refresh]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("inspiration");
    if (id)
      inspirationApi
        .get(id)
        .then(setEditor)
        .catch((cause) => setError(cause.message));
  }, []);
  function open(row: Inspiration) {
    setEditor(row);
    const url = new URL(window.location.href);
    url.searchParams.set("inspiration", row.id);
    window.history.replaceState(null, "", url);
  }
  function close() {
    setEditor(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("inspiration");
    window.history.replaceState(null, "", url);
  }
  async function create(file: File) {
    setBusy(true);
    setError("");
    try {
      const image = await inspirationApi.upload(file);
      const row = await inspirationApi.create({
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "新穿搭灵感",
        source_image_id: image.id,
        analysis_status: "pending",
        reference_items: [],
      });
      open(row);
      void refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">穿搭灵感</h2>
          <p className="mt-1 text-sm text-gray-500">
            保存参考图，让 ChatGPT 整理，再用自己的衣物完成搭配。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setConnections(true)}>
            <Link2 size={15} />
            连接 ChatGPT
          </button>
          <button className={buttonClass} onClick={() => setImporting(true)}>
            导入灵感 JSON
          </button>
          <button
            disabled={busy}
            className={primaryClass}
            onClick={() => upload.current?.click()}
          >
            <Upload size={15} />
            {busy ? "上传中…" : "上传参考图"}
          </button>
          <input
            ref={upload}
            type="file"
            className="sr-only"
            aria-label="上传灵感参考图"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void create(file);
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[
            ["", "全部"],
            ["draft", "草稿"],
            ["published", "已保存"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={value === status ? primaryClass : buttonClass}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button className={buttonClass} onClick={() => void refresh()}>
          <RefreshCw size={14} />
          刷新灵感
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-12 text-center text-gray-500">
          正在加载灵感…
        </p>
      ) : !items.length ? (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h3 className="font-medium">收藏你的第一份穿搭灵感</h3>
          <p className="mt-3 text-sm text-gray-500">
            上传 JPG、PNG 或 WebP，或导入 ChatGPT 整理好的 JSON。每张图片最大
            8MB。
          </p>
          <button
            className={`${primaryClass} mt-5`}
            onClick={() => upload.current?.click()}
          >
            上传参考图
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((row) => (
            <button
              key={row.id}
              className="overflow-hidden rounded-2xl border bg-white text-left hover:border-blue-300 hover:shadow-md"
              onClick={() =>
                void inspirationApi
                  .get(row.id)
                  .then(open)
                  .catch((cause) => setError(cause.message))
              }
            >
              <div className="relative aspect-[3/4] bg-slate-50 p-2">
                {row.source_image_url ? (
                  <img
                    className="h-full w-full object-contain"
                    src={row.source_image_url}
                    alt={row.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    待补充原图
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs shadow-sm">
                  {statusText(row)}
                </span>
              </div>
              <div className="p-4">
                <h3 className="truncate font-medium">{row.title}</h3>
                <p className="mt-2 text-xs text-gray-500">
                  {row.source === "chatgpt"
                    ? "在 ChatGPT 中创建"
                    : row.source === "json-import"
                      ? "JSON 导入"
                      : "网站上传"}
                </p>
                <p className="mt-2 truncate text-sm text-gray-500">
                  {row.overall_style || "等待补充风格与单品"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {(page > 1 || more) && (
        <div className="flex items-center justify-center gap-4">
          <button
            className={buttonClass}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span className="text-sm">第 {page} 页</span>
          <button
            className={buttonClass}
            disabled={!more}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {editor && (
        <InspirationEditor
          key={editor.id}
          initial={editor}
          close={close}
          saved={() => void refresh()}
        />
      )}
      {importing && (
        <JsonImport
          close={() => setImporting(false)}
          imported={(row) => {
            setImporting(false);
            open(row);
            void refresh();
          }}
        />
      )}
      {connections && <Connections close={() => setConnections(false)} />}
    </div>
  );
}
function JsonImport({
  close,
  imported,
}: {
  close: () => void;
  imported: (row: Inspiration) => void;
}) {
  const [text, setText] = useState(JSON.stringify(sample, null, 2)),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (text.length > 1024 * 1024) throw new Error("JSON 最大 1MB");
      const value = JSON.parse(text);
      if (file) {
        const image = await inspirationApi.upload(file);
        if (!value?.inspiration) throw new Error("缺少 inspiration 字段");
        value.inspiration.source_image_id = image.id;
      }
      imported(await inspirationApi.import(value));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="导入灵感 JSON" wide close={close} busy={busy}>
      <p className="mb-4 text-sm text-gray-500">
        使用与 MCP 相同的 V1
        数据格式。跨账户导入时请重新选择原图；没有原图也能保存草稿，发布前需补充。
      </p>
      <label className="block text-sm">
        选择 JSON 文件
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          className={inputClass}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) {
              if (selected.size > 1024 * 1024) setError("JSON 最大 1MB");
              else void selected.text().then(setText);
            }
          }}
        />
      </label>
      <label className="mt-4 block text-sm">
        灵感 JSON
        <textarea
          aria-label="灵感 JSON"
          className={`${inputClass} font-mono text-xs`}
          rows={20}
          disabled={busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="mt-4 block text-sm">
        参考原图（可选，将替换 JSON 中的图片编号）
        <input
          type="file"
          disabled={busy}
          accept="image/jpeg,image/png,image/webp"
          className={inputClass}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        className={`${primaryClass} mt-5`}
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "导入中…" : "导入为草稿"}
      </button>
    </Modal>
  );
}
function Connections({ close }: { close: () => void }) {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof inspirationApi.connections>
    > | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(
    () =>
      inspirationApi
        .connections()
        .then(setData)
        .catch((cause) => setError(cause.message)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Modal title="连接 ChatGPT" wide busy={busy} close={close}>
      <div className="space-y-5 text-sm">
        <p>
          在支持自定义 MCP 应用的 ChatGPT 账户中，新增连接并填写下方地址，选择
          OAuth 授权。账户与客户端需支持相关功能。
        </p>
        {data?.enabled ? (
          <label className="block">
            MCP 地址
            <input
              readOnly
              className={`${inputClass} font-mono`}
              value={data.mcp_url || ""}
              onFocus={(e) => e.target.select()}
            />
          </label>
        ) : (
          <p className="rounded-xl bg-amber-50 p-4 text-amber-800">
            MCP 尚未启用。管理员完成 HTTPS 地址和 OAuth
            环境配置后，这里会显示连接地址。现在可上传原图并导入灵感 JSON。
          </p>
        )}
        <ol className="list-decimal space-y-2 pl-5">
          <li>在 ChatGPT 连接 NMDD，只同意所需的衣橱和灵感权限。</li>
          <li>
            在网站上传参考图后，将图片编号和灵感编号发给
            ChatGPT；支持附件传输的客户端也可直接发送照片。
          </li>
          <li>让 ChatGPT 读取原图、整理参考单品、匹配已有衣物，再保存草稿。</li>
          <li>回到灵感详情核对，点击「保存到灵感库」。</li>
        </ol>
        <p className="text-gray-500">
          网站不自动调用图片识别模型。无法连接时，让 ChatGPT 按灵感 V1 JSON
          格式整理，再从网页导入。
        </p>
        <h3 className="border-t pt-4 font-semibold">已授予的连接</h3>
        {!data?.items.length && <p className="text-gray-500">暂无连接</p>}
        {data?.items.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap justify-between gap-3 rounded-xl border p-4"
          >
            <div>
              <p className="font-medium">{item.client_name}</p>
              <p className="mt-2 break-all text-xs text-gray-500">
                {item.scopes
                  .map((scope) => permissionLabels[scope] || scope)
                  .join(" · ")}
              </p>
            </div>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void inspirationApi
                  .revoke(item.id)
                  .then(refresh)
                  .catch((cause) => setError(cause.message))
                  .finally(() => setBusy(false));
              }}
            >
              撤销授权
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
