# Supabase 衣橱 V1 迁移记录

执行日期：2026-11-09（Asia/Shanghai）。用户授权后通过已连接的 Supabase 插件执行。

目标项目：`NMDD_test`，project ref `vhbyauefgjhlfjbikdek`，执行前状态 `ACTIVE_HEALTHY`，PostgreSQL `17.11.0.003`。

## 已执行迁移

| 远端版本 | 迁移名称 | 仓库来源 |
|---|---|---|
| `20261109064031` | `add_wardrobe_v1` | `supabase/migrations/20261109_add_wardrobe.sql`，来自 `main` 初始提交 `37fbdfe` |
| `20261109064520` | `index_wardrobe_outfit_item_id` | `supabase/migrations/20261109064520_index_wardrobe_outfit_item_id.sql` |

第一条迁移按已审阅、已测试的 SQL 原样执行。第二条为独立增量迁移，补齐 `wardrobe_outfit_items(item_id)` 外键索引；初始文件由 `supabase migration new` 生成，并将文件版本与远端记录对齐。迁移历史查询已确认两项成功。

本项目此前已存在描述性文件名及不同格式的迁移版本，初始衣橱迁移的本地文件名与远端自动分配版本也不同；不要未经核对直接批量 `db push` 或 repair 历史。

## 验证结果

- 三张衣橱表均已创建，RLS 为 `true`。
- `anon` / `authenticated` 对三张表没有 SELECT / INSERT 权限；`service_role` 有所需权限。
- 三个 RPC 均已创建，均为 invoker 模式；`anon` / `authenticated` 无 EXECUTE 权限，`service_role` 有 EXECUTE 权限。
- `wardrobe-images` bucket 存在且 `public=false`，单图上限 `8388608` 字节，媒体类型仅 JPEG / PNG / WebP。
- 使用现有服务配置对三张表做真实 REST GET（`limit=0`）均返回 HTTP 200。
- 使用现有服务密钥调用空数组导入 RPC，返回 HTTP 200，created/skipped/updated/failed 均为 0。
- 不存在 ID 的编辑 RPC 返回 `P0002`；空单品搭配 RPC 返回 `22023`，证明异常分支按预期执行。原始 PostgREST 将 `P0002` 映射为 HTTP 500；应用已有 service 会将该错误映射为 HTTP 404。
- 三张表记录数始终为 0，没有写入模拟衣物、搭配或照片。
- 原有 16 张 public 业务表的名称与 RLS 状态，与迁移前快照逐项一致。本次 SQL 没有对这些表执行 DDL/DML。
- 索引补充后，衣橱不再出现缺少外键索引的 advisor 提示。
- 包含两条迁移的隔离 PostgreSQL 衣橱测试 13 项通过；服务端全量 133 项通过。测试夹具已更新以持续执行全部衣橱迁移。

## 扫描提示的解释

衣橱表的「RLS Enabled No Policy」为 INFO：本模块沿用后端 cookie 会话和 service role，刻意不给浏览器 Supabase 角色访问，已验证表和函数均撤销了这些角色的权限。不要为消除提示增加宽松 policy。

新建索引尚未使用的 INFO 在空衣橱中符合预期，不应删除刚创建的必要索引。

扫描同时确认：已有 13 张非衣橱表未启用 RLS，且 `anon` 具有 SELECT 权限；另有一项既有函数 search_path 提示。它们在迁移前已存在，未在本次改动中自动修改。需要结合旧模块访问模式另行修复，避免直接开 RLS 导致已有功能失效。

参考：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[外键索引 advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)。

## 尚未由本次操作验证

本次完成 Supabase 数据库和配置部署；未通过真实网站写入私人衣物，也没有实际上传/删除云端测试照片。图片二进制全流程此前使用隔离 Storage double 验证。

Railway / Vercel 是否已部署对应 `main` 提交、真实网站登录及反向代理、大 ZIP 上传和完整照片导出，仍需按 README 的部署域名冒烟流程核查。
