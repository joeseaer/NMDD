# 部署与回滚

本轮只准备代码、迁移和验证，不执行生产变更。《NMDD：ChatGPT 双向读写接口与 AI 穿搭灵感系统》第 12 节要求「不要未经确认直接修改生产数据库或部署」。推送 main 若会自动触发 Railway / Vercel 部署，也应在最终审阅确认后执行。

## 上线前

1. 核对当前 main 和环境。保留现有 React / Fastify / Supabase 及 AUTH 配置、`DEFAULT_USER_ID` 和私有 `wardrobe-images`。本模块不迁移或重写现有衣物，不将测试衣物写入生产。
2. 备份数据库及 Storage，记录当前部署 SHA、衣物总数、外部 ID / 图片摘要、搭配总数。不要把 service key 或私人图片提交到 Git。
3. 在独立 Supabase 测试项目验证迁移及 [README](README.md) 的真实 Supabase 浏览器测试模式。确认 OAuth→MCP→Storage / RPC→网页的真实服务闭环。
4. 执行本地测试与前端构建，并审阅 [VALIDATION.md](VALIDATION.md) 中的边界和待验收项。

## 数据库迁移

新文件：`supabase/migrations/20261109073728_wardrobe_inspirations_and_mcp.sql`。由 Supabase CLI `migration new` 生成文件名后编写，整体事务提交。

本仓库历史迁移文件名与远端版本存在差异，先前衣橱迁移远端版本为 `20261109064031`，本地来源为 `20261109_add_wardrobe.sql`；参见 [既有记录](../wardrobe-v1/DEPLOYMENT.md)。**不要直接对当前生产项目批量 db push，也不要为了上线新模块随意 repair 旧历史。**

确认后，通过 Supabase 迁移工具 / 已连接插件，以新名称 `wardrobe_inspirations_and_mcp` 仅应用这一份已经测试的增量 SQL。没有原衣橱表的空测试项目，先单独应用原衣橱迁移和衣物关联外键索引迁移。

新迁移创建八张表、四个 RPC 和一个私有 bucket：

- `nmdd_oauth_clients / nmdd_oauth_grants / nmdd_oauth_tokens`
- `nmdd_write_requests / nmdd_tool_audit`
- `wardrobe_inspiration_images / wardrobe_inspirations / wardrobe_inspiration_items`
- `nmdd_oauth_exchange / nmdd_inspiration_mutate / nmdd_wardrobe_mutate / nmdd_inspiration_image`
- `wardrobe-inspiration-images`：private，8MB，仅 JPEG / PNG / WebP。

检查所有新表 RLS、`anon/authenticated` 无表 / RPC 权限、service_role 有权限；RPC 为 invoker 且固定 search_path。无开放的 Storage policy，不要给浏览器添加 service role。确认旧衣物数量及摘要与迁移前一致。

## 后端与前端

1. Railway 使用仓库的 `server/package-lock.json` 执行 `npm ci`，启动方式仍为 `node index.js`。
2. 设置 `NMDD_MCP_PUBLIC_URL=https://nmdd.up.railway.app`、真实前端 origin 的 `NMDD_SITE_URL`，以及独立随机 `NMDD_MCP_SECRET`。后端既有 `SUPABASE_URL/SUPABASE_SERVICE_KEY/AUTH_*` 继续使用原值。`NODE_ENV=production`。保持密钥在各实例一致。
3. 暂不需要额外 OpenAI API Key，也不需要新增服务或更换登录系统。
4. Vercel 执行原有前端构建。现有 `/api` rewrite 覆盖新灵感 API，无需将整个 OAuth 服务代理到 Vercel。MCP 和 OAuth 使用 Railway 的 HTTPS 域名。
5. 先部署数据库和后端，再发布包含新页面的前端，避免新页面先访问尚不存在的接口。

## 上线冒烟

1. 无认证访问 `/mcp` 返回 401，并带 `WWW-Authenticate` 的资源发现地址；未配置三项 MCP 环境变量时预期 503。
2. 检查 `/.well-known/oauth-protected-resource/mcp` 的 resource 为 `https://nmdd.up.railway.app/mcp`；authorization server issuer 为后端 origin 加 `/`；授权、token、注册与撤销地址都在同一个后端域名。
3. 用实际 ChatGPT 账户创建连接、完成 PKCE / consent。先只读取衣橱，确认原有衣物和照片正常，不新增模拟衣物。
4. 经用户允许上传一张参考图，读取图片、创建草稿，重复同一幂等键应得到相同 UUID。网站查看原图 / 拆解 / 匹配，编辑后明确点击发布。
5. 测试撤销连接后 MCP 请求被拒绝。检查审计只包含动作元数据，不能出现 token / 密码 / 下载 URL。
6. 测试原有衣橱 ZIP 预览导入、筛选、编辑、穿搭组合及图片导出。生产冒烟不自动导入测试包，不自动删除个人记录。

## 回滚

优先回滚应用，不删除新业务数据：

1. 暂停新连接，撤销当前新 OAuth 授权，移除 / 清空三个 MCP 环境变量，使 `/mcp` 停用。
2. 将 Railway / Vercel 恢复至上线前记录的 SHA，核对原有衣橱页面和 API。
3. 保留八张新增表及私有 bucket，避免丢失已保存灵感。旧应用不会读取它们，旧衣物表和 ZIP 格式不受影响。
4. 更换 `NMDD_MCP_SECRET` 会导致已注册机密客户端的 secret 无法解密；轮换时须撤销旧授权、清理 / 重新注册客户端，再重新连接，不能直接将轮换视为无影响配置变更。
5. 如将来确需删除新表 / 图片，先导出数据并取得明确确认；不要执行 `DROP ... CASCADE` 波及原衣橱表，也不要删除 `wardrobe-images`。

建议提交消息：`feat(wardrobe): add OAuth MCP access and reviewed outfit inspirations`。
