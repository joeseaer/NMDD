# NMDD ChatGPT 衣橱连接与穿搭灵感 V1

本模块在原有 React / Fastify / Supabase 衣橱上增量实现，不改衣橱 ZIP v1 格式。图片由 ChatGPT 或用户整理，网站负责校验、持久化、匹配候选和最终确认；不会在后端自动调用视觉模型。

2026-11-09 已获用户授权并完成生产上线，真实云端验证通过。网站：https://nmdd-z8ry.vercel.app/wardrobe；MCP：https://nmdd.up.railway.app/mcp。复制给 ChatGPT 的说明见 [CHATGPT_GUIDE.md](CHATGPT_GUIDE.md)，上线证据见 [PRODUCTION.md](PRODUCTION.md)。

## 使用流程

1. 「我的衣橱 → 穿搭灵感 → 上传参考图」，创建等待整理的草稿。详情中可复制图片编号、灵感编号。
2. 在支持自定义 MCP 的 ChatGPT 客户端连接 NMDD，授权所需权限。让 ChatGPT 读取私有参考图、填写参考单品并匹配自己的衣物。也支持客户端提供的受控图片附件。
3. ChatGPT 创建 / 更新草稿后，网站列表会在窗口获得焦点或十秒轮询时刷新。正在编辑的表单保留本地内容；重新加载最新版本后再合并修改。
4. 网站详情提供桌面双栏、手机上下布局；匹配候选和手动衣物选择均使用图片画册。可编辑属性、换图、解除关联、删除和导出 JSON。
5. 用户核对后在网站点击「保存到灵感库」。已保存记录再次编辑会回到草稿，重新确认。

V1 的 `inspiration_publish` MCP 工具返回网站确认链接，不直接发布草稿。这是本轮采用的确认方案。工具会明确返回 `confirmation_required`；只有网站成功保存后返回 `published`。不要将这一步描述为 ChatGPT 已自动发布。

无法连接 MCP 时，使用 [example-inspiration.json](example-inspiration.json) 的格式让 ChatGPT 整理，再从「导入灵感 JSON」粘贴 / 选择文件，并可同时选择参考图。没有图片也能保存草稿，补图并整理完成后才能发布。

## 数据契约与身份边界

- 权威输入 Schema：[../../server/contracts/inspiration.schema.json](../../server/contracts/inspiration.schema.json)。网站通过登录后的 `GET /api/wardrobe/inspirations/schema` 获取同一份 Schema；MCP 工具也从这份 Schema 生成参数定义，后端仍再次验证。
- 灵感输入不接受 `owner_id`、状态 `published`、Storage 路径或服务器时间。记录 UUID、owner、图片对象路径及版本由服务端生成 / 解析。
- 场景与衣橱一致：`academic_conference / business_social / daily / other`。分类、颜色族、图案同现有衣橱枚举。无法识别时用 `null / unknown`，保留 `needs_review`。参考衣物不会自动变成已拥有衣物。
- 坐标 `bounding_box` 为原图中的归一化 `{x,y,width,height}`，必须完全处于 `[0,1]` 范围；可留空。
- 图片只保存为私有 Storage 对象。数据库不存图片 base64、下载链接或 OAuth 明文 token。MCP 读图工具返回当次受控二进制内容。
- 所有新表启用 RLS，撤销 `anon / authenticated` 表和函数权限，只有已有后端 service role 可访问。此项目仍采用原有单账户 cookie 登录，外部授权固定映射到现有 `DEFAULT_USER_ID`；这不是多租户账户系统。部署时不要改这个值，以免看不到原有衣物。
- `wardrobe_inspirations` 保存灵感；`wardrobe_inspiration_items` 保存参考单品和指向现有 `wardrobe_items` 的可空关联；`wardrobe_inspiration_images` 保存受控图片元数据。参考图独立存于 `wardrobe-inspiration-images` 私有 bucket。
- 新写入通过 `nmdd_write_requests`、事务锁和 RPC 原子保存业务记录、幂等快照、写入审计。相同 owner / operation / key 的相同请求返回原快照，内容冲突返回 409。幂等键 8–200 字符，每次新的用户意图用新键；网络结果不确定的重试复用旧键。
- 编辑、发布、删除必须提交 `expected_revision`；旧版本返回 409。发布前重新检查原图、整理状态、参考单品及关联衣物的归属和删除状态。
- JSON 导出是可编辑的灵感数据，不包含原图二进制。图片编号与衣物关联仅在原账户有效；跨项目导入需重新上传原图，并清除或重新选择衣物关联。原来的衣橱照片备份仍使用衣橱 ZIP 导出。

## MCP 工具

所有 ID 均为 UUID。只展示当前授权 scopes 允许的工具；直接调用没有权限的工具同样拒绝。

衣物创建 / 更新 / 详情返回 `/wardrobe?item=<id>` 的详情链接，沿用原有衣物编辑页面；灵感返回 `/wardrobe?inspiration=<id>`。上传参考图返回受网站登录保护的原图查看链接。

| 工具 | 参数 | 权限与结果 |
| --- | --- | --- |
| `wardrobe_list_items` | 可选 `category,color_family,status,search,page,page_size`，每页 1–100 | `wardrobe:read`；当前账户衣物分页 |
| `wardrobe_get_item` | `id` | `wardrobe:read`；单件衣物详情 |
| `wardrobe_get_item_image` | `id` | `wardrobe:read`；私有衣物图像 |
| `wardrobe_create_item` | `item,image,idempotency_key`；item 最少 name/category/primary_color | `wardrobe:write`；复用原衣物校验和持久化 |
| `wardrobe_update_item` | `id,patch,idempotency_key` | `wardrobe:write`；复用原编辑逻辑，记录手动修改字段 |
| `inspiration_list` | 可选 `page,status`，每页 30 | `inspiration:read`；草稿 / 已保存列表 |
| `inspiration_get` | `id` | `inspiration:read`；含参考单品和 revision 的全文 |
| `inspiration_list_images` | 无 | `inspiration:read`；最近 30 张参考图的 image_id |
| `inspiration_get_image` | `image_id` | `inspiration:read`；私有参考图像 |
| `inspiration_upload_image` | `image,idempotency_key` | `inspiration:write`；返回 image_id |
| `inspiration_create_draft` | `draft,idempotency_key`；draft 符合共享 Schema | `inspiration:write`；返回草稿 UUID 和 details_url |
| `inspiration_update_draft` | `id,draft,expected_revision,idempotency_key`；完整替换可编辑内容 | `inspiration:write`；更新后仍需网站确认 |
| `inspiration_match_wardrobe` | `id` | 同时需要 `inspiration:read` 和 `wardrobe:read`；每个参考单品最多五个候选，不自动关联 |
| `inspiration_publish` | `id` | `inspiration:read`；返回当前状态和网站确认链接，V1 不执行发布 |

匹配分数是类别、颜色、图案、风格标签的属性相似度，不是视觉识别概率。归档和已删除衣物不参与推荐。

附件对象：`{file_id,download_url,mime_type?,file_name?}`。SDK 工具描述提供 `_meta["openai/fileParams"]`，实际附件传输取决于客户端能力。默认仅下载 `*.oaiusercontent.com` 的 HTTPS 图片；可用 `NMDD_MCP_FILE_HOSTS` 额外指定精确的可信域名。校验所有 DNS 结果并锁定连接地址、拒绝私网 / 重定向，15 秒总期限，最大 8MB，检查 MIME、扩展名和实际文件头。临时下载 URL 不持久化，也不计入重试哈希；附件过期前已提交的请求仍可安全重试。

建议给 ChatGPT 的首轮指令：

> 读取我的 NMDD 衣橱。读取图片编号 `<image_id>` 对应的参考图，更新灵感 `<inspiration_id>`。使用 Schema 中的枚举；看不清的信息留空或 unknown；只从我已有的衣物中推荐候选。先保存草稿并给我网站确认链接。

## 网站 API

沿用登录 cookie，MCP Bearer token 不用于这些网页接口。

| 方法 / 路径 | 请求 |
| --- | --- |
| `GET /api/wardrobe/items/:id` | 补充原衣物详情接口 |
| `GET /api/wardrobe/inspirations/` | 可选 page/status |
| `GET /api/wardrobe/inspirations/:id` | 全文 |
| `POST /api/wardrobe/inspirations/images` | multipart `file`，`Idempotency-Key` 请求头 |
| `GET /api/wardrobe/inspirations/images` | 当前账户参考图元数据 |
| `GET /api/wardrobe/inspirations/images/:id` | 登录后读取图片，private/no-store/nosniff |
| `POST /api/wardrobe/inspirations/drafts` | Schema 对象，`Idempotency-Key` |
| `PATCH /api/wardrobe/inspirations/:id` | `{draft,expected_revision}`，`Idempotency-Key` |
| `POST /api/wardrobe/inspirations/:id/match` | 只计算候选，不写入 |
| `POST /api/wardrobe/inspirations/:id/publish` | `{expected_revision}`，`Idempotency-Key` |
| `DELETE /api/wardrobe/inspirations/:id` | `{expected_revision}`，`Idempotency-Key`；软删除 |
| `GET /api/wardrobe/inspirations/:id/export` | JSON v1，可重新导入 |
| `POST /api/wardrobe/inspirations/import` | `{format:"nmdd-inspiration",schema_version:1,inspiration:{…}}`，`Idempotency-Key` |
| `GET /api/wardrobe/inspirations/schema` | 共享 JSON Schema |
| `GET /api/wardrobe/inspirations/connections` | 启用状态、MCP 地址、已授权连接 |
| `POST /api/wardrobe/inspirations/connections/:id/revoke` | 撤销当前账户的连接；只接受网站会话 |

新 API 错误包含 `error/code/errors`，字段格式错误定位于 JSON pointer。常见状态：400 格式 / 图片 / 引用错误，401 未登录，404 不存在或无权访问，409 幂等 / 版本冲突，413 上传超限，503 存储尚未配置或不可用。MCP 工具错误通过 `isError:true` 与同样可读的信息返回。

## OAuth 与连接配置

在 Railway 后端设置以下三项（示例中前端域名必须替换为实际 Vercel / 自定义域名）：

```dotenv
NMDD_MCP_PUBLIC_URL=https://nmdd.up.railway.app
NMDD_SITE_URL=https://YOUR-FRONTEND-DOMAIN
NMDD_MCP_SECRET=<至少32字符的独立随机密钥>
```

两项 URL 都必须是 origin，不带路径、query 或 fragment。密钥不入库、不提交 Git，所有实例使用相同值，重启时保持稳定。缺少任何一项时 `/mcp` 返回 503，网页和 JSON 入口仍可独立使用。开发环境只允许 localhost / 127.0.0.1 使用 HTTP；生产必须 HTTPS。

已启用 MCP 地址：**`https://nmdd.up.railway.app/mcp`**。直接使用 Railway 后端域名，Vercel 网站继续代理 `/api`。当前 `NMDD_SITE_URL` 为 `https://nmdd-z8ry.vercel.app`。

OAuth 使用官方 MCP SDK 标准路由：`/.well-known/oauth-authorization-server`、`/.well-known/oauth-protected-resource/mcp`、`/register`、`/authorize`、`/token`、`/revoke`。授权页面为 `/oauth/consent`。

- Authorization Code + PKCE S256，严格 verifier 长度、redirect_uri、resource；公开客户端 `none` 或机密客户端 `client_secret_post`。
- 用户在后端域名明确同意权限。若 Railway 域名没有网站会话，授权页会要求使用现有 NMDD 账户登录；账号密码只用于这次登录校验，不是 MCP 访问凭据。
- 同意页面使用签名 HttpOnly / SameSite cookie、一次性 nonce、Origin 校验、禁止嵌入页面和 no-store 响应。一次批准不能重复生成连接。
- 授权码两分钟、access token 十分钟、refresh token 三十天。数据库只存随机 token 的 SHA-256。机密客户端 secret 使用独立密钥派生 AES-256-GCM 加密保存。
- 授权码一次兑换；refresh token 轮换。重用旧 refresh token / 已兑换授权码会撤销该次授权。重启后授权仍由数据库恢复。
- 每次 MCP 请求验证授权记录中的 owner、issuer、resource、到期时间、撤销状态；不将 cookie 当作 MCP token，不信任客户端传来的 owner。
- `/mcp` 每 IP 每分钟 100 次；SDK 限制注册、授权与 token 请求；同意页每连接 IP 每分钟最多 20 次。当前单后端部署生效；增加多实例时应同时配置网关统一限流。
- 审计记录 actor / 工具 / 结果 / 记录 ID，不记录 token、密码、图片内容或附件下载 URL。网站可查看连接权限并立即撤销。

ChatGPT 是否向当前账户开放自定义 MCP、写入工具与附件传输，需要在实际客户端连接后确认。本次通过官方 SDK 客户端验证协议，尚未替用户在真实 ChatGPT 账户完成连接。官方参考：[自定义 MCP 服务](https://developers.openai.com/api/docs/guides/custom-mcp-server)、[授权](https://developers.openai.com/plugins/build/auth)、[文件参数](https://developers.openai.com/plugins/reference#implement-file-handling)。

## 测试与实际云端验收

本地命令：

```powershell
cd E:\Life\NMDD\entrepreneur-simulator\server
npm ci
npm test
cd ..\client
npm ci
npm test -- --maxWorkers=2
npm run build
npm run test:wardrobe:e2e
```

默认浏览器测试使用隔离的 PGlite PostgreSQL 执行生产迁移 / RPC，模拟 PostgREST 传输和二进制 Storage，真实启动 Fastify、Vite、浏览器和官方 MCP 客户端。覆盖 OAuth→MCP→事务持久化→网页匹配 / 编辑 / 发布 / 重新加载，并回归 ZIP 和搭配画册。它没有调用生产 Supabase，不能冒称已完成真实云端存储验收。

也已提供真实 Supabase 验收模式。需先准备**独立、可丢弃的项目**并对该项目应用已有衣橱迁移和本次迁移，再在运行测试的临时终端设置：

```powershell
$env:NMDD_E2E_SUPABASE_URL='https://YOUR-DISPOSABLE-PROJECT-REF.supabase.co'
$env:NMDD_E2E_PROJECT_REF='YOUR-DISPOSABLE-PROJECT-REF'
$env:NMDD_E2E_SERVICE_ROLE_KEY='<仅测试项目的服务密钥>'
$env:NMDD_E2E_CONFIRM_DISPOSABLE_PROJECT='yes'
npm run test:wardrobe:e2e
```

此模式使用真实 Supabase REST / Storage / RPC，仍通过 OAuth、MCP 和网页执行相同流程。测试服务不读应用 `.env`，强制独立 owner `nmdd-mcp-acceptance`，只清理该 owner 的记录及对象；项目 ref 必须与 URL 精确一致，且硬性禁止当前生产项目 `vhbyauefgjhlfjbikdek`。不要将测试服务部署到公网。测试开始时按 owner 清理，正常退出时也清理；若进程被强制杀死，可在同一测试项目重新跑测试清理遗留 fixture。

独立云端测试模式继续用于未来开发。此次用户授权生产上线后，已通过真实生产服务执行并清理临时上线验证，原有 33 件衣物内容不变；详见 [PRODUCTION.md](PRODUCTION.md)。真实 ChatGPT 账户首次连接需用户本人完成授权。部署与回滚见 [DEPLOYMENT.md](DEPLOYMENT.md)，本地验证及文件清单见 [VALIDATION.md](VALIDATION.md)。
