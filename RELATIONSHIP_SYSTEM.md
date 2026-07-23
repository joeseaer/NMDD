# 关系与机会：本地使用说明

## 它解决什么问题

这个模块不是性格标签库，而是一套长期训练判断力的工作台：

1. 互动前，恢复这个人最近发生了什么、关系处于什么状态。
2. 做决定时，写清目标、互惠价值、动作、预期信号、边界和停止条件。
3. 互动后，区分事实、自己的行为、对方反应与解释，并由本人确认后保存。
4. 长期复盘一段关系是否值得投入，同时识别自己反复出现的处世和商业模式。

## 页面结构

- **今日**：重点关系、近期承诺、关系动量、当前机会和周复盘提醒。
- **人物 / 关系地图**：所有长期人物的轻档案；重要人物进入工作台深度经营。
- **人物工作台**：关系简报、证据化判断、决定卡、结果复盘和互动时间线。
- **机会**：问题、客户、付款者、证据阶梯、下一项实验及真实现金流。
- **周复盘**：AI/规则只生成草稿；本人确认一条原则、一个盲点、最多三个关系行动和一个商业实验。
- **处世成长**：累计判断闭环、候选原则、自我模式与承诺完成情况。
- **旧档案**：旧 MBTI、DISC、私人资料和历史分析只读保留，不自动转成新结论。

## 数据安全与存储

- 服务默认只监听 `127.0.0.1`，CORS 仅允许本机来源。
- 新接口不接受客户端传入的用户身份，统一使用服务端 `DEFAULT_USER_ID`。
- 默认 `RELATIONSHIP_STORAGE_MODE=auto`：若 Supabase 已有新表则使用 Supabase；若缺迁移，则在进程第一次探测后固定使用本地 JSON，不会在写入失败时临时切换造成数据分叉。
- 本地文件：`entrepreneur-simulator/server/data/relationship-system.local.json`。
- 每次本地写入使用临时文件和替换，并保留最近一份 `.bak`。
- 旧人物与旧互动可只读合并；`private_info`、`contact_info`、旧 AI 推断等不会进入新页面的数据接口。
- 互动提取与周复盘必须经过“草稿 → 本人确认”；AI 不能静默覆盖正式记录。

本地模式适合当前个人预览，不等于可公开部署。公开部署前仍需完成真实登录、JWT 校验和端到端权限审计。

## 启动

在两个 PowerShell 窗口分别运行：

```powershell
cd E:\Life\NMDD\entrepreneur-simulator\server
npm start
```

```powershell
cd E:\Life\NMDD\entrepreneur-simulator\client
npm run dev -- --host 127.0.0.1
```

然后打开终端输出的本地地址，进入左侧“关系与机会”。

## 备份与恢复

本次开发前的完整备份位于：

`E:\Life\NMDD_LOCAL_BACKUPS\20260715_230220_before_relationships_opportunities`

以后创建新备份：

```powershell
node scripts\backup-nmdd-data.mjs
```

验证备份：

```powershell
node scripts\verify-nmdd-backup.mjs <备份目录>
```

恢复工具默认只做演练，不写入：

```powershell
node scripts\restore-nmdd-data.mjs <备份目录>
```

确认目标项目和行数无误后，才显式添加 `--execute`。目标非空时默认拒绝覆盖；`--allow-nonempty` 只应在理解重复数据和冲突风险后使用。

## 以后切换到 Supabase

新表迁移文件为：

`supabase/migrations/20260715_add_relationship_system.sql`

迁移是加法式的，不删除或覆盖旧人物、旧互动和私人资料。迁移执行并通过健康检查后，重启服务；`auto` 模式会选择 Supabase。不要在同一运行周期内手工来回切换存储。
