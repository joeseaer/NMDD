# NMDD 数字衣橱 V1

实现分支：`codex/wardrobe-v1`。起点：`main` / `651e63b749c9b4b7ffec9fd143f719c0396107e3`。

沿用 React 18 / TypeScript / Tailwind、Fastify 5、现有 cookie 会话、Supabase、Railway 与 Vercel。原始任务书在 [SPEC.md](SPEC.md)，逐项验证与文件清单在 [ACCEPTANCE.md](ACCEPTANCE.md)。没有调用站内 LLM，也没有修改 v1 交换字段名、枚举、版本或目录结构。

## 使用

1. 登录后进入「个人中心 → 我的衣橱」，或访问 `/wardrobe`。
2. 点击「批量导入」，选择 ChatGPT 整理的 v1 ZIP，在本地预览中校正名称、类别、颜色和颜色族，点击「确认导入」。图片预览尚未写入数据库，确认后浏览器重打包校正结果，再由后端重新校验与持久化。
3. 默认「跳过已存在」；同一 `external_id` 不会重复创建。显式选择「更新 AI 导入字段」也保留手工编辑过的字段。手工更换的图片同样受到保护；手工创建的衣物字段全部视为手工字段。已软删除编号保留，不会被重复导入静默复活。
4. 画册支持名称搜索、分类、颜色族、季节、场景、使用状态和待确认筛选。点击卡片编辑详情，可归档、恢复为使用中或确认软删除。也可「新增衣物」手工上传照片。
5. 「穿搭组合 → 新建搭配」选择衣物，设置名称、场景、备注，并使用 ↑ / ↓ 调整展示顺序。归档衣物显示标记；软删除或失效衣物显示失效提示，编辑搭配时可移除。
6. 「导出全部 ZIP」下载所有未删除衣物（包括归档）、全部交换字段和原始图片字节。不是图片 URL 列表。导出流按图片逐个读取，避免服务端同时缓冲全部照片。

标准导入包根目录必须为 `manifest.json`、`items.json` 和 `images/`。必填字段、可选字段及完整示例见任务书第 3 节。限制：ZIP 60MiB、单图 8MiB、每批 100 件、解压总计 150MiB；仅 JPG/JPEG、PNG、WebP。非法路径、链接、重复文件名/编号、损坏 CRC、错误 SHA-256、错误枚举/版本、缺图及超限都会在写库前拒绝。额外记录字段会忽略并在报告中提示。

**备份范围**：v1 ZIP 契约只定义衣物与图片，不增加私有的搭配交换格式。穿搭及顺序、软删除记录、手工字段保护标记由原有 `scripts/backup-nmdd-data.mjs` 全量备份覆盖；该工具按表和 bucket 枚举，无需新增硬编码。独立 ZIP 在空衣橱导入会保留全部衣物交换字段和图片；保护标记由新导入状态重新建立。

**较大衣橱恢复**：导出全部不会截断到 100 件。完整备份超过单次导入限制时，在安装服务端依赖的电脑执行下面的离线工具，再逐个导入生成的标准 v1 ZIP。工具逐图读取，按最多 100 件和 48MiB 图片字节分包，每包重新通过生产 parser 校验，原图与 `external_id` 不变，已有输出文件不覆盖。

```powershell
# 从仓库根目录执行，输出目录使用新的空目录
node entrepreneur-simulator/server/scripts/split-wardrobe-export.cjs ./nmdd-wardrobe-v1.zip ./wardrobe-restore-parts
```

## 数据与认证

- 三张新表：`wardrobe_items`、`wardrobe_outfits`、`wardrobe_outfit_items`，均启用 RLS；没有匿名/浏览器账号的宽松 policy，显式撤销 `anon` / `authenticated` 表与 RPC 权限。
- 由服务端现有 `DEFAULT_USER_ID` 统一确定 owner，默认 `user-1`；请求传入的 `user_id` / `userId` 不决定 owner。不要为本模块另改一个 owner，否则原数据会属于另一个衣橱。
- 私有 bucket `wardrobe-images` 由 migration 创建；对象键含 owner 摘要、SHA-256 和尝试 UUID。数据库有相同 owner/图片摘要时复用已有对象，同批图片也按 SHA 去重。
- `GET /api/wardrobe/items/:id/image` 同时检查会话与 owner；响应 `private, no-store` 和 `nosniff`，不返回公共 URL。模块路由自身鉴权，主应用原有 `/api/` 鉴权继续保留。
- PostgreSQL RPC 对同 owner 导入与编辑加事务级锁；导入整批提交，衣物唯一约束兜底；搭配替换及其顺序亦在一个事务内完成，并校验引用衣物 owner。
- 新图以尝试唯一键暂存，成功后只保留数据库引用的对象；上传/数据库失败执行补偿。发生网络超时且无法确认 DB 是否提交时保留不确定对象，避免误删已提交图片。补偿接口也不可用、进程中止时可能存在无引用私有对象，须在运维窗口核查后清理，不能盲删摘要目录。替换/删除前的旧图片也不会在请求中破坏性清理。

## 部署顺序

本次开发未连接生产数据执行迁移，未更改 Railway 或 Vercel 线上部署。

1. **先在测试 Supabase 项目演练**，备份现有项目，确认已有版本正常。
2. **正式迁移目标**：现有 Railway `nmdd` API 服务环境变量 `SUPABASE_URL` 对应的同一 Supabase 项目，使用其 SQL Editor 执行 `supabase/migrations/20261109_add_wardrobe.sql`。本机配置的项目 ref 为 `vhbyauefgjhlfjbikdek`；这仅是本机证据，执行前必须与 Railway 当前 `SUPABASE_URL` 核对，不推断二者已同步。`supabase/config.toml` 的 `project_id="NMDD"` 是本地项目名。
3. migration 是事务化、增量、可重跑的；只增加本模块对象，并确保新 bucket 为私有。下面 SQL 可检查状态。若通过 Supabase CLI 管理迁移，先核对历史；仓库部分旧迁移使用描述性文件名，不能未经检查对现有生产项目直接全量 `db push`。
4. **Railway 必须重新部署**包含本分支服务端提交的版本，目录仍为 `entrepreneur-simulator/server`，安装 `npm ci --omit=dev`，启动 `npm start`。新增运行依赖 `yauzl` / `yazl`；PGlite 只是开发测试依赖。继续使用已有 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`DEFAULT_USER_ID` 和 `AUTH_*` 配置，不在前端或仓库写入密钥。不需要新环境变量。
5. **Vercel 必须部署对应前端提交**，目录仍为 `entrepreneur-simulator/client`，构建 `npm ci`、`npm run build`，输出 `dist`。现有 `/api` rewrite 仍指向 `https://nmdd.up.railway.app/api/:path*`，无需新建站点。生产分支若仍是 `main`，本分支只会得到 Preview；在审核合并后部署生产前端。Preview 也会代理现有 Railway，因此不能把真实生产写入当作测试；隔离验收时，Preview 的 API 目标必须指向隔离的 Railway 测试服务/测试 Supabase，避免误写现有数据。
6. 后端和迁移先就绪，再部署前端。通过真实部署域名测试 10 件模拟导入、刷新/重新登录、私有图片 401、重复跳过、编辑保护、搭配和导出恢复；再验证大于 15MiB 的模拟 ZIP 确实通过实际反向代理到达后端。平台或代理请求体/超时设置不是本地测试能证明的。
7. 复查训练、文档、日程、关系、白板页面，并保留现有全量备份。

```sql
SELECT to_regclass('public.wardrobe_items'),
       to_regclass('public.wardrobe_outfits'),
       to_regclass('public.wardrobe_outfit_items');
SELECT relname, relrowsecurity FROM pg_class
 WHERE relnamespace='public'::regnamespace
   AND relname IN ('wardrobe_items','wardrobe_outfits','wardrobe_outfit_items');
SELECT to_regprocedure('public.wardrobe_import(text,jsonb,text)'),
       to_regprocedure('public.wardrobe_patch_item(text,uuid,jsonb)'),
       to_regprocedure('public.wardrobe_save_outfit(text,uuid,text,text,text,uuid[])');
SELECT id, public, file_size_limit, allowed_mime_types
 FROM storage.buckets WHERE id='wardrobe-images';
-- 预期 public=false、file_size_limit=8388608；图片类型仅 jpeg/png/webp。
```

## 回滚

先将前端回滚至上线前 Vercel 版本，再将 Railway 回滚至上线前服务端版本。保留新增表、函数和私有 bucket；旧代码不引用它们，不影响现有模块，也不会丢失上线后衣橱数据。重新部署此分支即可恢复访问。不要把 DROP TABLE / 删除 bucket 当作应用回滚，清除数据需另行确认并保留备份。

## 本地测试

```powershell
cd entrepreneur-simulator/server
npm ci
npm test
npm run test:wardrobe

cd ../client
npm ci
npm run typecheck
npm test
npm run build
npm run test:wardrobe
npx playwright install chromium  # 首次缺少浏览器时
npm run test:wardrobe:e2e
```

浏览器测试使用专属 `127.0.0.1:5178` 前端和 `127.0.0.1:3101` 后端，执行真实认证、HTTP、生产 service/RPC 和嵌入式 PostgreSQL；Storage 由隔离内存模拟。测试服务器不加载 `.env`、不连接远程 Supabase。端口被占用会失败，不会复用未知服务。一般开发仍沿用现有 Vite 5173 / API 3000。
