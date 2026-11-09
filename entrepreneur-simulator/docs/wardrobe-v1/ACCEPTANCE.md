# Wardrobe V1 验收记录

日期：2026-11-09（Asia/Shanghai）。交付分支：`main`（按用户要求直接提交）。运行环境：Windows、Node 20.20.2。以下测试针对整合前已完成的同一份实现代码；本次整合仅同步了交付和部署文档。

后续数据库上线记录：同日已通过 Supabase 插件执行迁移、补齐搭配单品外键索引并验证真实 REST/RPC；详见 [DEPLOYMENT.md](DEPLOYMENT.md)。下文原始开发测试记录保留其执行时的证据范围，后续验证不等同于完成网站线上端到端验收。

## 实际运行结果

| 命令 | 结果 | 范围 |
|---|---|---|
| client `npm run typecheck` | 通过 | 所有现有前端源码及衣橱源码 |
| client `npm test` | 通过，129 文件 / 847 测试 | 原有 831 项 + 衣橱 16 项 |
| client `npm run build` | 通过 | TypeScript + Vite 生产打包，衣橱懒加载 |
| server `npm test` | 通过，133 测试 | 原有测试及新增衣橱/分包测试 |
| server `npm run test:wardrobe` | 通过，13 测试 | 真实 PostgreSQL migration/RPC + Fastify + Storage double |
| client `npm run test:wardrobe:e2e` | 通过，6 测试 | 桌面 Chromium 3 项、Pixel 7 Chromium 3 项 |

构建保留仓库既有的 chunk 体积/Browserslist 提示，不影响构建成功。浏览器早期运行遇到过一次本机 Chromium ICU 启动失败；后续完整运行通过。修复过的测试定位歧义与选择框可访问名称已纳入最终代码。

## 验收项与证据边界

| 任务书条目 | 已验证内容 |
|---|---|
| 1 入口、认证 | `/wardrobe` 路由与 Shirt 菜单接入；模块 GET/POST/导出/图片匿名均 401，退出后图片与导出 401 |
| 2 十件持久化 | HTTP 导入 10 件；页面重载、重新构造 service、全新浏览器 context 登录后内容与可解码图片仍存在 |
| 3 幂等与人工保护 | 相同包第二次 created=0/skipped=10；默认不覆盖；显式更新仍保护手工名称/备注；未编辑字段可更新 |
| 4 异常与边界 | 非 ZIP、错版本、非法路径、缺图、重复 external_id/文件名、链接、伪装 MIME/后缀、坏 CRC/hash、伪造大小、数量/图片/ZIP 超限均拒绝；DB 行与对象数量不被污染 |
| 4 路由上传限制 | 16MiB 请求通过衣橱接口；原上传仍在 15MiB 拒绝；衣橱 ZIP >60MiB 返回 413 |
| 5 CRUD 与筛选 | 手工照片创建、更换照片、编辑、归档、恢复、软删除；文字及多字段筛选；越权 ID 访问拒绝 |
| 6 搭配 | 学术会议组合，多单品、可调整顺序；重载保留；归档/删除有标识；重复或其他 owner 单品被拒绝，失败不覆盖原搭配 |
| 7 完整 ZIP | 导出后清空隔离数据库/衣橱再回导，10 件全部交换信息及照片字节一致；101 件完整备份可离线拆为 100+1 件标准包并验证原图与编号 |
| 8 回归 | 前端全量测试覆盖既有编辑器/文档/白板/日程/关系/思维导图等；服务端全量测试通过；原有路由与上传全局设置保持原值 |
| 9 增量迁移 | 在 PostgreSQL 内实际执行两次，无错误；三张表启用 RLS，anon 表和 RPC 权限被拒绝，bucket 私有 |

上表证据来自初始隔离环境，Storage 使用测试 double。后续已完成的真实 Supabase 迁移、权限及 REST/RPC 核查另见 DEPLOYMENT.md；真实照片上传下载、Railway/Vercel 反向代理、跨电脑及线上所有页面未由这些测试证明。代码推送后的自动部署结果和网站冒烟测试仍需要核查。

## 修改文件清单

后端与数据：

- `supabase/migrations/20261109_add_wardrobe.sql`：三表、索引、RLS/权限、私有 bucket、事务导入/编辑/搭配 RPC。
- `supabase/migrations/20261109064520_index_wardrobe_outfit_item_id.sql`：根据真实 Supabase advisor 补齐搭配单品外键索引，采用独立增量迁移。
- `entrepreneur-simulator/server/index.js`：注册 `/api/wardrobe`。
- `entrepreneur-simulator/server/routes/wardrobe.js`：认证 CRUD、导入/导出、图片、搭配及专用 multipart 限制。
- `entrepreneur-simulator/server/services/wardrobeBundle.js`：有界 ZIP 解析、交换校验、图片头、CRC、SHA、生成工具。
- `entrepreneur-simulator/server/services/wardrobeService.js`：owner、持久化、字段保护、图片暂存补偿、分页/筛选、流式导出。
- `entrepreneur-simulator/server/package.json`、`package-lock.json`：ZIP 库、PGlite 测试依赖与测试入口。
- `entrepreneur-simulator/server/scripts/split-wardrobe-export.cjs`：大备份离线分包恢复。

前端：

- `entrepreneur-simulator/client/src/App.tsx`：个人中心菜单、激活态与懒加载路由。
- `entrepreneur-simulator/client/src/pages/Wardrobe.tsx`：统计、响应式画册、搜索/筛选、入口与分页。
- `entrepreneur-simulator/client/src/features/wardrobe/types.ts`：v1 类型和中文枚举映射。
- `entrepreneur-simulator/client/src/features/wardrobe/bundle.ts`：本地有界解压/校验、SHA/CRC、校正重打包。
- `entrepreneur-simulator/client/src/features/wardrobe/api.ts`：沿用同源会话的 HTTP 与下载。
- `entrepreneur-simulator/client/src/features/wardrobe/components.tsx`：抽屉、通用字段、详情字段及焦点约束。
- `entrepreneur-simulator/client/src/features/wardrobe/ImportPanel.tsx`：图片预览、纠错、导入策略及报告下载。
- `entrepreneur-simulator/client/src/features/wardrobe/ItemEditor.tsx`：手工新增、编辑、照片替换、归档/恢复/删除。
- `entrepreneur-simulator/client/src/features/wardrobe/OutfitsPanel.tsx`：搭配库、选择顺序、归档/失效提示。
- `entrepreneur-simulator/client/package.json`、`vitest.config.ts`：衣橱测试脚本与 Node 环境纯 ZIP 测试目录。

测试和夹具：

- `entrepreneur-simulator/server/tests/helpers/wardrobeDatabase.js`：嵌入式 PostgreSQL、最小 PostgREST 适配和 Storage double。
- `entrepreneur-simulator/server/tests/wardrobe.integration.test.js`、`wardrobe.split.test.js`：事务、路由、权限、故障补偿、交换及分包测试。
- `entrepreneur-simulator/server/tests/fixtures/wardrobe/{README.md,mock-ten.zip,provided-demo.zip}`：10 件模拟夹具及原始 1 件测试包。
- `entrepreneur-simulator/server/tests/wardrobe.e2e-server.cjs`：隔离认证 API 测试服务。
- `entrepreneur-simulator/client/tests/wardrobe/bundle.test.ts`：前端 parser 与重打包测试。
- `entrepreneur-simulator/client/e2e/wardrobe.spec.ts`、`wardrobe.vite.config.ts`：真实浏览器全流程及专用 Vite API 代理。
- `entrepreneur-simulator/client/playwright.wardrobe.config.ts`：桌面/手机项目与专用测试端口。

文档：`entrepreneur-simulator/docs/wardrobe-v1/{README.md,ACCEPTANCE.md,SPEC.md,DEPLOYMENT.md}`。

用户原有未跟踪文件 `whiteboard-reload-diagnosis.png` 和 `yichu/` 保留原状；不作为代码变更提交。测试日志、生成构建和浏览器截图保留在本地忽略目录，不提交私人数据或凭据。
