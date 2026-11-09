# NMDD 数字衣橱 V1｜Codex 开发任务书

日期：2026-11-09  ·  适用仓库：https://github.com/joeseaer/NMDD （检查基准：`main`，Git tree `651e63b749c9b4b7ffec9fd143f719c0396107e3`）

## 0. 实现目标和边界

**最终体验**：用户将衣服照片发给 ChatGPT，由 ChatGPT 提取单品信息并生成 `nmdd-wardrobe-v1.zip`；用户登录 NMDD，在「个人中心 → 我的衣橱」点击“批量导入”，先看预览、纠错，确认后将图片及数据持久化。以后可浏览、筛选、编辑衣物，保存学术会议/商务社交/日常的穿搭组合；可以重新导出完整 ZIP（包含照片）备份或迁移。

**V1 不开发**：站内 AI 识别、自动生成穿搭建议、接入 ChatGPT 的写入 API、虚拟试衣、天气推荐、购物平台链接。以上属于未来迭代。本期的 AI 识别在本次 ChatGPT 对话中完成，不使用本网站服务器调用 LLM。

**原则**：增量开发；复用当前前后端、登录、数据存储和 UI 风格，不破坏现有功能。优先保证批量导入/图片持久化/可导出，再考虑视觉精修。

## 1. 已核对的仓库结构

- 前端：`entrepreneur-simulator/client/`，React 18 + TypeScript + Vite + Tailwind；`src/App.tsx` 包含 sidebar 和路由；`src/main.tsx` 用 `AuthGate` 包围应用。
- 现有路由/菜单：`App.tsx` 的「个人中心」包含“我的档案”“系统设置”；请增加 `Shirt` 图标的“我的衣橱”，路由 `/wardrobe`，兼容手机导航收起和激活状态。
- 后端：`entrepreneur-simulator/server/`，Fastify 5；`index.js` 注册 `/api` 下的 `routes/api.js` 以及登录会话 `routes/auth.js`，后端已通过 `onRequest` 对 `/api/` 做会话鉴权。
- 持久化：`@supabase/supabase-js`，服务端使用 `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`；仓库中已有 Supabase migrations 和私有 Storage bucket 示例（`server/services/whiteboardService.js`）。
- 部署：`client/vercel.json` 将 `/api` 重写到 Railway 服务；不要另建前端站点。
- 当前登录会话只验证是否登录，并未明确向调用端颁发多用户身份；V1 服务端应统一使用配置的 `DEFAULT_USER_ID` 作为 owner，不信任前端提供的 `user_id`。若后续扩展多用户，另行升级 session identity/授权模式。
- 仓库 `scripts/backup-nmdd-data.mjs` 已遍历 Supabase 表和 bucket 做全量备份；新模块必须能被此通用备份覆盖，同时也要提供独立的衣橱 ZIP 导出。

开发前请检查最新工作分支、变更状态和既有接口，适配新的重构；不得机械覆盖文件或假设线上部署和 GitHub `main` 完全同步。

## 2. V1 功能清单

### 2.1 衣物浏览（页面 `/wardrobe`）
- 首屏：总件数、分类数、待确认数；主区照片画册（桌面 3–5 列、手机 2 列，自适应）。
- 分类：全部 / 上衣 / 下装 / 外套 / 鞋履 / 配饰 / 其他。
- 筛选：类别、颜色族、季节、场景、状态；支持按名称模糊搜索。
- 卡片：图片、名称、类别、颜色；点击打开详情/编辑抽屉。
- 详情：品牌、尺码、材质、版型、季节、适用场景、正式程度、备注、识别待核验状态；允许编辑、归档与恢复。
- 空状态：指向「导入衣物」的引导。

### 2.2 批量导入（核心）
- 按此文档附录固定 ZIP 结构，使用已有前端依赖 `fflate` 在浏览器读取 ZIP 做**本地预览**；列出图片与名称、类别、颜色，允许修改预览记录中常用字段。
- 上传确认前，客户端重建/提交校正后的内容；**服务端必须独立重新校验**，不能信任客户端预览结果。
- 支持已有 `external_id` 的幂等导入：默认“跳过已存在”，用户可显式选择“覆盖 AI 导入字段”。不得静默覆盖用户手工编辑的内容。重复提交相同 ZIP 不得产生重复衣物。
- 结果报告：新增数、跳过数、更新数、错误数与具体项；显示失败原因并可下载错误信息。
- 允许用户手工新增衣物并上传照片（不经过 ChatGPT）。

### 2.3 搭配库（基础版）
- 页面内切换「我的衣橱 / 穿搭组合」；用户能勾选已有衣物，保存为一个 Outfit（名称、场景、备注、衣物的展示顺序）。
- 场景：`academic_conference` 学术会议、`business_social` 商务社交、`daily` 日常；可扩展其他。
- 一个衣物可参与多个搭配；删除/归档单品后，搭配页应清晰呈现已归档/失效单品。
- V1 只做人选搭配和保存，不做自动推荐。

### 2.4 导出
- 提供「导出全部衣橱 ZIP」，格式与导入格式兼容：`manifest.json` + `items.json` + `images/`；所有图片为文件字节，不能仅导出公开 URL。
- 图片私有；客户端仅在已登录且有权访问时获取。

## 3. 固定交换格式：NMDD Wardrobe Bundle v1

ZIP 根目录必须包含：

```text
nmdd-wardrobe-20261109-b01.zip
├── manifest.json
├── items.json
└── images/
    ├── w_20261109_b01_001.jpg
    └── w_20261109_b01_002.jpg
```

`manifest.json`：

```json
{
  "format": "nmdd-wardrobe",
  "schema_version": 1,
  "batch_id": "20261109-b01",
  "created_at": "2026-11-09T00:00:00Z",
  "source": "chatgpt-assisted"
}
```

`items.json`：数组，一张单品照片一条记录；示例：

```json
[
  {
    "external_id": "w_20261109_b01_001",
    "name": "深灰色直筒西裤",
    "category": "bottoms",
    "subcategory": "西裤",
    "color_family": "gray",
    "primary_color": "深灰色",
    "fit": "straight",
    "pattern": "solid",
    "seasons": ["spring", "autumn", "winter"],
    "style_tags": ["商务休闲", "商务正式"],
    "occasions": ["academic_conference", "business_social"],
    "formality": 4,
    "brand": null,
    "size": null,
    "material": null,
    "notes": null,
    "status": "active",
    "needs_review": false,
    "image_path": "images/w_20261109_b01_001.jpg",
    "image_sha256": null
  }
]
```

**字段规则**：
- 必填：`external_id`、`name`、`category`、`primary_color`、`image_path`；其余字段可缺省/null（数组字段缺省按 `[]`）。
- `external_id`：批次级唯一、后续再导入同衣物必须维持稳定；数据库约束 `(user_id, external_id)` 唯一。`image_path` 必须是 ZIP 内相对路径；不能用网络 URL、绝对路径、`..`、反斜线或链接文件。
- `category`：`tops` / `bottoms` / `outerwear` / `shoes` / `accessories` / `other`。
- `color_family`（可选）：`black` / `white` / `gray` / `blue` / `brown` / `beige` / `green` / `red` / `yellow` / `purple` / `orange` / `pink` / `multicolor` / `other`。
- `fit`（可选）：`slim` / `regular` / `straight` / `relaxed` / `oversized` / `unknown`；`pattern`（可选）：`solid` / `striped` / `checked` / `printed` / `other` / `unknown`。
- `seasons`：`spring` / `summer` / `autumn` / `winter`。`occasions`：`academic_conference` / `business_social` / `daily` / `other`。
- `formality`：可选数字 `1..5`，1 非常休闲、5 高度正式。`status`：`active` / `archived`，默认 `active`。`needs_review`：布尔，AI 判断不确定或拍照不清晰时为 `true`。
- 不要猜品牌、尺码、真实材质或采购价格；无法核实填 `null`。保留中文自由文本标签以便后期校对。
- `image_sha256` 可选；若填写，必须为对应原始图片的 64 位小写 SHA-256，服务端应验证。若未填写，服务端计算后存库。
- 后续只通过**新 schema_version** 扩展不兼容变更；V1 对多余字段可以先忽略并记录，不得执行任意代码。

此格式是 **ChatGPT 与 Codex 的协作契约**；除双方显式升级版本外不要擅自修改字段名、枚举值、ZIP 目录布局。

## 4. 持久化建议

Supabase 新 migration（放入 `supabase/migrations/`）：

**`wardrobe_items`**：
- `id uuid PK default gen_random_uuid()`
- `user_id text NOT NULL`；`external_id text NOT NULL`；`name text NOT NULL`
- `category text NOT NULL`；`subcategory text`；`color_family text`；`primary_color text NOT NULL`
- `fit text`、`pattern text`、`seasons text[] NOT NULL default '{}'`、`style_tags text[] NOT NULL default '{}'`、`occasions text[] NOT NULL default '{}'`
- `formality smallint`、`brand text`、`size text`、`material text`、`notes text`
- `status text NOT NULL default 'active'`、`needs_review boolean NOT NULL default false`
- `image_object_key text`、`image_sha256 text`；`created_at timestamptz`、`updated_at timestamptz`、`deleted_at timestamptz`
- `UNIQUE(user_id, external_id)`，必要的 CHECK 和 `(user_id, status, category)` 索引。

**`wardrobe_outfits`**：`id uuid PK`、`user_id text`、`name text`、`occasion text`、`notes text`、时间字段。

**`wardrobe_outfit_items`**：`outfit_id uuid references wardrobe_outfits`、`item_id uuid references wardrobe_items`、`position int`，带 FK 和 `(outfit_id,item_id)` 唯一约束。写操作须核实所属用户一致。

- 为三张表启用 RLS，写迁移时结合现有单账户后端 + service-role 调用方式处理，不要暴露 service key；避免新增宽松匿名读写 policy。
- 单独创建**私有** Storage bucket `wardrobe-images`（与 `whiteboard-assets` 的处理模式一致）；建议对象键 `userId/sha256/{digest}.{ext}`，只由服务端通过会话鉴权接口读取。禁止返回无需认证的公共访问 URL。
- 既有 Supabase 文件存储、用户、文档、白板等数据不迁移、不删除。

## 5. 后端建议实现

新增文件：
- `entrepreneur-simulator/server/services/wardrobeService.js`：校验、数据库操作、图片存储、导入/导出。
- `entrepreneur-simulator/server/routes/wardrobe.js`：路由、错误处理。
- 在 `server/index.js` 注册新路由 prefix `/api/wardrobe`，沿用 `onRequest` 已有登录钩子。

接口建议（均需登录）：

| 方法 | 地址 | 用途 |
|---|---|---|
| GET | `/api/wardrobe/items` | 列表，筛选/搜索/分页 |
| POST | `/api/wardrobe/items` | 手工新建 |
| PATCH | `/api/wardrobe/items/:id` | 更新字段/归档 |
| DELETE | `/api/wardrobe/items/:id` | 软删除 |
| POST | `/api/wardrobe/items/:id/image` | 更换单品图片 |
| GET | `/api/wardrobe/items/:id/image` | 认证读取图片 |
| POST | `/api/wardrobe/import` | ZIP 批量导入，幂等、返回结果报告 |
| GET | `/api/wardrobe/export` | 生成包含所有图片的 ZIP |
| GET/POST | `/api/wardrobe/outfits` | 搭配查询/新建 |
| PATCH/DELETE | `/api/wardrobe/outfits/:id` | 搭配编辑/删除 |

`POST /import` 支持 `mode=skip_existing`（默认）或 `mode=update_imported`（显式选择）；服务端独立校验已在预览页校正的 ZIP，检查 `schema_version` 并生成 `{created, skipped, updated, failed, errors[]}`。

**文件边界和安全**：
- V1 ZIP 最大 60MB；单个图片最大 8MB；最多 100 件；解压后累计最多 150MB。超过阈值明确报错，后续可依实际需求调整。每批建议 10–20 件。
- 后端现有 `@fastify/multipart` 默认单文件 15MB，必须为衣橱导入路由配置恰当的专用限制，不要全局放大所有上传接口；避免把整个大 ZIP 同时复制多份到内存。
- 用成熟 ZIP 库进行有界解析；拒绝 zip-slip（`..`、绝对路径）、软链接、重复文件名、解压炸弹、未知媒体类型；通过实际文件头检查图片，只接收 jpg/jpeg、png、webp；防止伪装后缀、SVG/HTML 脚本。
- 图片经 SHA-256 去重；保证失败时不会留下前端不可见的半导入数据。可以按批预校验→暂存图片→持久化数据，失败做补偿清理；重复上传不能创造重复记录。
- 返回客户端错误信息应简洁，不包含数据库密钥、路径等敏感数据。
- 不允许请求体的 `user_id` 或查询参数越权，所有 DB 查询均限定服务端 owner；图片读取需要 owner 校验。
- 可结合现有 `upload` 实现参考 MIME/图片校验逻辑，但**不能直接复用公共 bucket 上传 URL**。

## 6. 前端建议实现

新增：
- `client/src/pages/Wardrobe.tsx`（或懒加载 `features/wardrobe/WardrobePage.tsx`）
- `client/src/features/wardrobe/`：types、validators、api、ZIP 解析/重打包、衣物画册、详情编辑、导入预览、搭配管理。
- `App.tsx` 增加 `/wardrobe` 路由、菜单项和 activeTab 判定。

使用现有 Tailwind / lucide-react 视觉规范；不要引入第二套 UI 框架。卡片图片使用等比缩放、浅色中性底，避免被裁去衣物。手机上也能完成 ZIP 选择、预览、确认与新增/编辑。

流程：点击“导入” → 选择 ZIP → `fflate` 在浏览器解析并检查格式/预览 → 对名称、类别、颜色进行人工校正（修改本地结构并重打包） → 点击“确认导入”调用后端 → 展示成功/失败结果 → 自动刷新画册。注意本地预览也需要文件大小限制，不可无限制解压。

## 7. 验收标准（必须真实运行）

1. 登录后菜单出现「我的衣橱」，访问 `/wardrobe`；退出登录/未登录访问 `/api/wardrobe/*` 返回 401。
2. 用测试包导入 10 件数据后，刷新浏览器、重新登录、切换电脑仍显示同样记录和图片（证明不是仅保存在 localStorage）。
3. 重复导入同一 ZIP，`created=0`、不会重复；手工编辑信息后重传默认不覆盖。
4. 无效 ZIP、错路径、无图、重复 external_id、图片 MIME 不匹配、超限、错误 schema_version 时给出明确错误，不能污染数据。
5. 手工新增、编辑、归档、恢复、删除可用；筛选、搜索正常。
6. 可保存「学术会议」搭配并引用多件现有衣物；页面重载后仍存在。
7. 从网站导出完整 ZIP，在测试数据库/空衣橱导入后，衣物信息和照片一致。
8. 现有训练、文档、日程、关系、白板页面无回归；`client` 通过 `npm run typecheck`、`npm test`、`npm run build`，服务端补充 `node --test` 测试，建议再跑 Playwright E2E。
9. 新的 Supabase migration 可重复检测部署状态；不得无提示地修改现有表结构或丢失已有数据。

## 8. 提交与交付

请在独立分支（如 `feat/wardrobe-v1`）实现，并按阶段 commit：
1. schema + service/routes + 测试；
2. 衣橱画册/编辑/搭配页；
3. ZIP 导入预览/导出 + 集成测试；
4. 部署说明及可回滚方案。

提交内容至少包括：迁移 SQL、页面组件、API 服务、ZIP parser、单测、最小 10 件照片的**模拟测试夹具**（不要提交真实私人衣物照片）、README 使用步骤和验收结果。

上线前明确说明：需要在哪个 Supabase 项目执行 migration、Railway 是否必须重部署、Vercel 是否使用对应分支；绝不在代码仓库写入账号密码、Supabase service key 或其他私密凭证。

## 9. 与 ChatGPT 并行协作方式

在 Codex 开发过程中，用户将衣服分批拍照上传到 ChatGPT。ChatGPT 按此 v1 schema 提取衣服名称、类别、颜色、版型、季节、场景；不能确定的字段置 null、`needs_review=true`。完成后产出包含每张真实衣物图片的 ZIP，不放 mock 照片、不捏造品牌、尺码、材料，保持 `external_id` 唯一且可重复导入。

开发完成后，用户直接把聊天中拿到的 ZIP 上传 NMDD 的「我的衣橱 → 批量导入」，先预览确认再提交。

---

## 10. 给 Codex 的执行指令

请先阅读本任务书和仓库代码，确认项目当前架构。按以上 v1 的固定 ZIP schema 完成数字衣橱模块，严格复用现有 React/Fastify/Supabase/Vercel/Railway 结构；不要自行增设站内 AI 或改变导入规范。优先实现真实持久化、认证图片访问、幂等批量导入及可恢复的 ZIP 导出，再实现画册与搭配管理。不要直接修改生产数据；在独立分支提交可测试的实现，附测试报告与部署步骤。对本方案与代码现实冲突之处优先适配代码，唯有改变 ZIP v1 交换格式时需要事先说明差异。
