# 生产上线记录

上线日期：2026-11-09。用户明确要求「把这个东西上线」，在此前本地验收通过后执行。

## 线上入口

- 衣橱与灵感：https://nmdd-z8ry.vercel.app/wardrobe
- 同仓库另一前端生产域名：https://nmdd.vercel.app/wardrobe
- MCP：https://nmdd.up.railway.app/mcp
- OAuth issuer：https://nmdd.up.railway.app/
- 资源发现：https://nmdd.up.railway.app/.well-known/oauth-protected-resource/mcp
- 复制使用说明：[CHATGPT_GUIDE.md](CHATGPT_GUIDE.md)；纯提示词：[CHATGPT_PROMPT.txt](CHATGPT_PROMPT.txt)。

MCP 已启用。未带 token 的 MCP 请求返回 401 并提供资源发现地址；已授权客户端按 scopes 使用工具。

## 数据库与备份

项目仍为 `NMDD_test` / `vhbyauefgjhlfjbikdek`。

- 迁移前通过现有服务密钥备份三张衣橱表，以及 33 张原图；逐张核对 SHA-256 全部一致。备份在本机 `.local/wardrobe-backups/20261109-mcp-release/`，已通过本地 Git exclude 排除，不上传 GitHub。
- 仅应用本次增量 SQL，没有批量推送或修复既有迁移历史。
- 远端版本：`20261109093249`，名称：`wardrobe_inspirations_and_mcp`。
- 本地来源：`supabase/migrations/20261109073728_wardrobe_inspirations_and_mcp.sql`。版本由远端工具在执行时分配，与本地 CLI 生成时间不同；保留此对应关系，避免重复应用。
- 八张新表均开启 RLS，`anon / authenticated` 无 SELECT 权限，service_role 有权限。
- 四个 RPC 为 invoker，固定 `search_path=public`；`anon / authenticated` 无 EXECUTE，service_role 有权限。
- `wardrobe-inspiration-images` 为私有 bucket，8MB，仅 JPEG / PNG / WebP。

原衣橱表整个行快照的聚合 MD5 在迁移前、迁移后、线上验证清理后均为：

```text
4096e759b6acb6ecd1f53a098d9b01f6
```

三次衣物数均为 33；原有搭配数和关联数均为 0，没有改写原衣物或原搭配。

## 应用部署

源代码：`498c2fb`（32 文件功能实现）及 `fca43e9`（ChatGPT OAuth 工具元数据补充），已推送 `main`。

实际后端为 Railway 项目 `zippy-serenity` 的 `NMDD` 服务：

- project：`9fffa392-5ba3-450f-b9ae-fbbc610264bf`
- service：`303c2a7a-b1fa-45d1-b17f-e22922f6c8ee`
- production environment：`1ae253d2-75f8-4371-8b7a-68daf69b2500`
- 部署 `4283f54c-d7c6-44aa-94e2-2eb40725a3eb`，对应 `fca43e9`，状态 SUCCESS，2026-11-09 09:39:55 UTC 就绪。
- 生产域名 `nmdd.up.railway.app` 对应该服务，路由端口为 8080。

已设置 `NMDD_MCP_PUBLIC_URL`、`NMDD_SITE_URL`、独立随机 `NMDD_MCP_SECRET` 和 `NODE_ENV=production`；其他已有配置保留。密钥不写入仓库或说明文档。

Vercel 两个前端项目 `nmdd-z8ry` 和 `nmdd` 对 `fca43e9` 的自动部署状态均为 success。实际网站的惰性加载衣橱资源包含新灵感页面，网页详情路由与新 API 均已响应。

GitHub 另有 Railway 项目 `outstanding-curiosity` 的失败状态，在本轮上线前已经存在；实际生产域名由上述成功服务提供，本轮只部署和配置该生产服务。

## 真实线上验收

使用官方 MCP SDK 客户端、真实 Railway / Supabase / Vercel 服务，完成小规模临时上线验证。验证记录标为临时用途，使用非私人测试参考图，没有把测试衣物加入正式衣橱。

最终运行：2026-11-09 09:48:39 UTC 开始，结果 success。

| 检查 | 结果 |
| --- | --- |
| OAuth discovery、正确 issuer / audience、匿名 MCP 拒绝 | 通过 |
| 动态注册、PKCE、现有账户 consent、token 兑换 | 通过 |
| 最小测试授权范围 | wardrobe:read、inspiration:read、inspiration:write |
| MCP 工具发现 | 此范围显示 12 个工具；增加 wardrobe:write 后完整工具集为 14 个 |
| MCP 读取原衣橱 | 33 件 |
| 网页上传 → Supabase 私有 Storage → MCP 读取相同二进制图片 | 通过 |
| 未登录访问私有图片 | 401 |
| MCP 创建草稿 → 重复同一请求返回相同 UUID → 网页 API 读回 | 通过 |
| 衣橱匹配、更新草稿及真实衣物关联 | 通过；返回五个候选 |
| MCP 发布工具保留网站确认步骤 | 返回 confirmation_required |
| 网站发布 API、JSON 导出 | 通过 |
| 前端详情 HTML 与已发布的灵感页面代码 | 通过 |
| 网站撤销连接 → 原 token 再访问 | 401 |
| 原衣物数量与内容快照 | 33 件，摘要完全不变 |

临时草稿、参考图、OAuth client / grant / token 和幂等记录均已清理。清理后这些新业务表记录数为 0；保留一条撤销授权操作的元数据审计。

本轮前端页面行为此前由桌面 / 手机 10 个浏览器场景覆盖；线上验证额外核查真实服务数据及已发布页面资源。本次没有操作真实 ChatGPT 账户来完成自定义连接，首次连接仍需用户在自己的 ChatGPT 页面授权；说明文档已列出步骤。

验证脚本最初一次未跟随 App 惰性加载资源、一次为空 POST 设置 JSON Content-Type，导致脚本检查失败；修正检查脚本后最终全流程通过，临时记录每次均完成清理。这些失败未修改应用代码或原有衣物。

## 扫描与回滚

### 授权表单修复（2026-11-09）

用户实际连接时遇到「授权请求校验失败」。线上 POST `/oauth/consent` 返回 403；补充原生浏览器测试后复现：原 `Referrer-Policy: no-referrer` 使表单提交携带 `Origin: null`，与后端严格来源检查冲突。此前 API 验证手工设置了 Origin，未覆盖该行为。

授权页改用 `same-origin`，保留来源和一次性 nonce 校验，继续拒绝 null / 外站来源以及缺失或错误的 nonce。另按注册并经 SDK 验证的回调域名限定 `form-action`，允许浏览器完成跨站 OAuth 回调；其余 CSP 限制保留。

回归用真实浏览器填写测试账户、点击同意、跳转至不同来源的回调站点并兑换 PKCE token，测试不注入 Origin 请求头，覆盖桌面与手机。原 10 个衣橱 / 灵感场景加上这两个授权场景共 12 个；后端 149 项回归通过。用户应关闭修复前已打开的授权页，从 ChatGPT 重新发起连接，取得新授权页面。

参考：[Referrer-Policy 对 Origin 的影响](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header)、[form-action 对重定向的限制](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action)。

新模块没有缺失外键索引提示。RLS 开启而没有浏览器 policy 的 INFO 符合后端专用访问模式，表和函数权限均已核对。全库既有 RLS / 白板函数 search_path / 白板策略性能提示与本轮无关，未自动改变其访问模型。

有关 advisor 提示的官方说明：[RLS 无 policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[外键索引](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)。

回滚时按 [DEPLOYMENT.md](DEPLOYMENT.md) 停用 MCP 配置、撤销连接，并将应用恢复到 `0d8f630` 对应部署；保留新增灵感数据和私有 bucket。不要删除原有衣物、原图或修改旧迁移历史。
