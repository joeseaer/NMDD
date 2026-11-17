# 科研文档的 ChatGPT 授权

科研记录（文档、想法、会议）逐篇选择「允许 ChatGPT 读取和修改」。新建时默认关闭，旧文档迁移后全部关闭；子页面不继承授权。文档属性里的「ChatGPT 访问」可随时切换，只有后端保存成功后才显示新状态。普通正文自动保存及本地草稿恢复不能修改授权。

## 部署与连接

1. 数据库先执行 `supabase/migrations/20261117052522_research_document_chatgpt_access.sql`。旧数据库需先依次补齐 `20260628_add_sop_content_json.sql`、`20260701_add_research_workspace_fields.sql`、`20260712_add_document_editor_reliability.sql`，再执行 `20260809_add_document_page_hierarchy.sql` 更新层级触发器。旧格式内嵌 JSON 在读取时解包，迁移不重写原始正文。
2. 部署后端与前端。沿用数字衣橱的 MCP 地址 `/mcp` 和 OAuth 配置，无需新增密钥。接口未迁移时拒绝文档访问，不降级为无权限检查。
3. 旧 ChatGPT 连接需重新授权 `research:read`、`research:write` 并刷新工具列表；只有衣橱权限的旧 token 无法访问科研文档。
4. 在网站为需要共享的记录打开开关。关闭后，同一连接的后续读取和修改立即被拒绝；已进入聊天的内容无法收回。

## MCP 工具

| 工具 | Scope | 参数与结果 |
| --- | --- | --- |
| `research_document_list` | `research:read` | 可选 page / page_size，默认 30，最大 100；只返回当前账户已授权的科研记录摘要 |
| `research_document_get` | `research:read` | id；返回标题、Markdown content、结构化 content_json、content_revision 和网站链接 |
| `research_document_update` | `research:write` | id / expected_revision / patch；patch 仅允许 title、content、content_json |

修改正文须同时提供 Markdown 和完整的结构化 JSON，保留未修改的节点与属性，避免丢失图表、公式、白板引用等结构。修改前先读取最新版本；冲突返回 `NMDD_409`，重新读取后再修改。网络结果不确定时先读取最新文档核实，重复提交旧版本不会重复写入。

后端从已校验 OAuth token 的 owner 获取账户；工具参数不能指定其他账户。列表、全文和写入均在数据库查询中检查 owner、research domain、chatgpt_access。读写不展开上级、子页面、人物关系或其他文档的正文；共享文档本身包含的链接文字仍属于其正文。

迁移同时为 sops / sop_versions 启用 RLS 并撤销 anon / authenticated 的直接表权限，防止通过 Supabase Data API 绕过网站授权开关。网站仍沿用后端 service_role 和现有 cookie 登录。

写入 RPC 仅允许 service_role 调用，使用 SECURITY INVOKER，在同一事务里锁定当前记录、检查权限和版本、备份旧 Markdown / JSON，再保存新内容。备份失败则回滚。授权关闭与写入争用同一行锁，关闭成功后启动的写入无法提交。正文版本不受授权开关影响，可在正文未保存或冲突时关闭访问。

ChatGPT 没有创建、删除文档或开启授权的工具。网站授权接口为 `PATCH /api/research/documents/:id/chatgpt-access`，请求 `{ "enabled": true | false }`；仅接受网站会话，拒绝仅有 MCP Bearer 的请求。沿用项目的单账户登录模型，不接受客户端指定 owner。

## 验证

- `node --test tests/researchDocuments.integration.test.js`：隔离 PostgreSQL 执行真实迁移、RPC 与备份；官方 MCP HTTP 客户端验证权限筛选、撤销、跨账户访问、版本冲突、备份回滚及旧页面自动保存。
- `npx playwright test e2e/research-chatgpt-access.spec.ts --project=chromium`：创建授权默认值、打开/关闭、失败保留状态、刷新持久化和子页面独立授权。浏览器测试模拟 API；生产数据库与真实 ChatGPT 账户连接需在部署后验证。
