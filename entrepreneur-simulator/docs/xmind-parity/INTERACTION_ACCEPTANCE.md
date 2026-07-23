# XMind 1:1 交互验收矩阵

## 1. 文档用途

本文是 MindMap V2 的可执行验收合同，与 [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) 配套使用。实现方式可以变化，但相同前置状态与输入序列必须得到本文规定的结构、选择、焦点、历史、持久化和视觉结果。

优先级定义：

- **P0**：基础可用性、数据正确性或安全边界；任一失败均阻断发布。
- **P1**：XMind 桌面核心产品能力；宣称 Desktop 1:1 前必须全部通过。
- **P2**：Gantt 等项目管理、协作、版本历史或 AI 扩展能力；不得破坏 P0/P1 合同。

当前基线共 `282` 条唯一验收用例：P0 `102`、P1 `156`、P2 `24`。该统计只计算形如 `| ACC-* | P* |` 的正式用例行；CI 必须重新计算并阻止重复 ID 或文档统计漂移。

## 2. 固定基准

| 项 | 固定值 |
|---|---|
| 对标版本 | XMind Desktop `26.04.01341`；Web 协作与 AI 另列 |
| 主平台 | Windows 11、Chromium 稳定版、中文界面 |
| 主视口 | `1440 × 900`、DPR 1、浏览器缩放 100% |
| 触控视口 | 手机 `390 × 844`；平板 `768 × 1024` |
| 字体 | 与产品字体清单锁定；视觉测试环境禁止字体 fallback 漂移 |
| 测试输入 | 英文、简体中文 IME、Emoji、CJK 标点、长文本、RTL 样例 |
| 时间与 ID | 视觉/E2E 环境固定时钟、UUID、随机种子和动画 |
| 持久化链路 | Tiptap `mindMap` block → Markdown `mindmap` fence → API → 数据库 → 重新加载 |
| 文件语料 | 由上述 XMind 版本生成并记录 SHA-256 的金色 `.xmind` 文件集 |
| 性能基准机 | 4 核 CPU、8 GB RAM、DPR 1；每项预热一次、运行五次取 p95 |

XMind 基准版本、默认快捷键或视觉 token 发生变化时，必须新建兼容性评审，不能直接覆盖本文件中的基准。

## 3. 标准夹具

| 夹具 | 内容 |
|---|---|
| `MM-EMPTY` | 一个空白 Sheet，仅含中心主题 `R` |
| `MM-BASE` | `R`；主主题 `A`、`B`；`A` 下有 `A1/A2`，`B` 下有 `B1`；浮动主题 `F`；`A2 ↔ B1` 有 Relationship |
| `MM-DEEP` | 深度 8、每层至少 2 个同级主题；部分分支折叠 |
| `MM-RICH` | 富文本、Marker、标签、笔记、链接、附件、图片、贴纸、公式、录音、To-do/Task |
| `MM-SEMANTIC` | Relationship、Boundary、Summary、Callout、Zone 均至少两个，且存在交叠引用 |
| `MM-MIXED` | 中心为双向 Mind Map；分支覆盖官方 9 个结构家族，并包含 Grid 内置结构样式及混合结构 |
| `MM-MANUAL` | 自动布局后有手工偏移、自由分支、重叠主题、调整过宽度和 Relationship 控制点 |
| `MM-LARGE-500` | 确定性生成的 500 主题树 |
| `MM-LARGE-1K` | 确定性生成的 1,000 主题树 |
| `MM-LARGE-10K` | 确定性生成的 10,000 主题树 |
| `DOC-EMBEDDED` | 脑图前后各有普通 Tiptap 文本，正文中还有第二个脑图块 |
| `DOC-READONLY` | 服务端与客户端均为只读权限的 `DOC-EMBEDDED` |
| `LEGACY-CORPUS` | 当前 `nodes + edges`、缺字段、重复 ID、悬挂边、旧 Summary/Boundary/Relationship 等历史语料 |
| `XMIND-GOLDEN` | 每种结构、方向、样式和语义元素的 XMind 输入/输出金色语料 |
| `MALICIOUS-CORPUS` | 恶意 SVG/HTML、危险 URL、路径穿越、ZIP bomb、重复 ZIP entry、超大文本和损坏文件 |

## 4. 1:1 判定规则

1. **行为等价**：相同模型、选择、视口和输入序列必须产生相同主题层级、顺序、方向、焦点、选择、折叠和历史结果。
2. **语义等价**：层级关系、Relationship 和装饰/范围元素必须独立；视觉连线不得改变父子语义。
3. **视觉等价**：固定环境下关键节点和控制点位置误差不超过 `±2 px`；目标色差 `ΔE00 ≤ 2`；核心金色页面像素差不超过 `0.5%`，字体抗锯齿区使用固定遮罩。
4. **持久化等价**：规范化后的模型在保存、关闭、重新加载后语义等价；未知字段不得被静默删除。
5. **文件等价**：对已声明支持的字段，XMind → MindMap V2 → XMind 往返后结构和样式等价；不支持字段必须进入可见降级报告。
6. **允许差异**：仅限已登记的浏览器/原生系统控件差异，不得以“Web 实现不同”为由豁免数据、快捷键或核心交互差异。

---

## 5. 主题、层级与选择

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-TOP-001 | P0 | 打开 `MM-EMPTY` | 编辑中心主题并点击空白提交 | 文本提交一次；尺寸更新；刷新后内容不变 |
| ACC-TOP-002 | P0 | 选中任意主题 | 创建子主题 | 新主题成为当前主题最后一个子级并立即进入编辑 |
| ACC-TOP-003 | P0 | 选中非中心主题 | 创建后置同级和前置同级 | 新主题父级正确，位于指定顺序，其他兄弟相对顺序不变 |
| ACC-TOP-004 | P0 | 选中非中心主题 | 插入父主题 | 新父主题接替原连接；原主题成为其子级；兄弟顺序稳定 |
| ACC-TOP-005 | P0 | 选中有后代的 `A` | Delete/删除分支 | 仅 `A` 的结构子树删除；Relationship 对端 `B1` 不被级联删除 |
| ACC-TOP-006 | P0 | 选中有后代的 `A` | 仅删除当前主题 | `A` 删除；`A1/A2` 按原顺序提升到 `R` 下 |
| ACC-TOP-007 | P0 | 多选包含父主题及其后代 | 删除 | 归一化到最高层选中主题；同一后代只删除一次 |
| ACC-TOP-008 | P0 | 中心主题选中 | 尝试删除、设为其他主题子级 | 命令被拒绝；Sheet 仍恰有一个中心主题；不产生历史项 |
| ACC-TOP-009 | P0 | `MM-BASE` | 把 `A2` 拖到 `B1` 下 | 父级、顺序和布局更新；Relationship 不改变层级；可撤销且重载一致 |
| ACC-TOP-010 | P0 | `A1/A2` 同级 | 把 `A2` 移到 `A1` 前 | 只改变同级 orderKey；父级、内容和引用不变 |
| ACC-TOP-011 | P0 | `MM-BASE` | 把 `A` 拖到自身或 `A1` 下 | 显示非法落点；模型、历史和脏状态不变化 |
| ACC-TOP-012 | P0 | 一个主题处于编辑态 | 输入中文 IME、Emoji、换行和粘贴文本 | 无丢字、乱码、重复提交或快捷键误触发 |
| ACC-TOP-013 | P0 | 文本含 1、100、1,000 字符 | 编辑并提交 | Fit、换行、最大宽度和滚动策略符合规格；相邻节点不遮挡 |
| ACC-TOP-014 | P1 | 空白画布 | 创建 Floating Topic | 浮动主题位于指定画布坐标，无结构父级，不触发整图重排 |
| ACC-TOP-015 | P1 | 结构主题和 Floating Topic 各一个 | 互相拖入/拖出主树 | 类型和层级正确转换；稳定 ID、后代和附属内容保留 |
| ACC-TOP-016 | P1 | Summary Topic 存在 | 给概要主题增加子主题 | Summary Topic 可继续扩展；概要范围不被破坏 |
| ACC-SEL-001 | P0 | `MM-BASE` | 单击 `A`、再单击 `B`、再单击空白 | 选择依次为 `A`、`B`、空；无隐藏残留选择 |
| ACC-SEL-002 | P0 | `MM-BASE` | Ctrl+单击多个主题，再 Ctrl+单击其中一个 | 正确追加和移除多选；主选择清晰可见 |
| ACC-SEL-003 | P0 | 同父级至少 4 个主题 | Shift+单击首尾主题 | 按同级顺序选择连续范围；不跨入其他父级 |
| ACC-SEL-004 | P0 | 空白画布 | 从左向右左键框选 | 只选择完全包含的可见元素；不需要右键 |
| ACC-SEL-005 | P0 | 空白画布 | 从右向左左键框选 | 选择与框相交的可见元素；折叠后代不参与命中 |
| ACC-SEL-006 | P0 | 已有多选 | Ctrl+框选一组元素 | 在原选择上增量切换；一次撤销不改变内容历史 |
| ACC-SEL-007 | P0 | `DOC-EMBEDDED` | 从正文点击脑图，再点击正文 | Tiptap 与脑图焦点边界明确；快捷键只作用当前焦点域 |
| ACC-SEL-008 | P1 | 有折叠分支且未编辑文本 | 按 Ctrl+A | 一次选择当前 Sheet 全部可选主题；隐藏主题的选择规则与锁定 XMind 基准一致；文本编辑时只全选文本 |
| ACC-SEL-009 | P1 | 主题、Relationship、Boundary、Summary、Callout、Zone 均存在 | 逐类单击和多选 | 每类元素可独立选择；选范围元素不会隐式选择其内容 |

## 6. 键盘与快捷键

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-KBD-001 | P0 | 主题选中、非编辑态 | 按 `Tab` | 创建子主题并进入编辑 |
| ACC-KBD-002 | P0 | 非中心主题选中 | 按 `Enter` | 在当前主题后创建同级主题 |
| ACC-KBD-003 | P0 | 中心主题选中 | 按 `Enter` | 创建主主题；双向结构按稳定平衡规则分配 side |
| ACC-KBD-004 | P0 | 非中心主题选中 | 按 `Ctrl+Enter` | 插入父主题；层级和顺序符合 `ACC-TOP-004` |
| ACC-KBD-005 | P0 | 文本编辑态 | 按 `Shift+Enter` | 插入主题内换行，不创建主题 |
| ACC-KBD-006 | P0 | 已有主题选中、非编辑态 | 直接输入字符 | 按合同进入替换模式，提交后原文本被替换 |
| ACC-KBD-007 | P0 | 已有主题选中、非编辑态 | 按 Space 后输入 | 进入续写编辑；Space 本身不误写入文本 |
| ACC-KBD-008 | P0 | 文本编辑态 | 分别按 Enter、Esc、点击空白 | Enter/失焦提交；Esc 恢复编辑前文本；每次最多一个历史事务 |
| ACC-KBD-009 | P0 | 有后代主题选中 | 分别按 Delete 与 `Ctrl+Delete` | 前者删除分支；后者仅删当前主题并提升子级 |
| ACC-KBD-010 | P0 | 至少 3 个同级主题 | 按 `Alt+↑/↓` | 同级移动一位，不改变父级；可撤销 |
| ACC-KBD-011 | P0 | `MM-DEEP` | 连续按方向键 | 按视觉邻近和结构规则稳定导航；不进入隐藏主题 |
| ACC-KBD-012 | P0 | 有后代主题选中 | 按 `Ctrl+/` | 折叠/展开当前主题；显示正确隐藏数量 |
| ACC-KBD-013 | P0 | 画布激活 | 按 `Ctrl+Alt+/` | 折叠/展开全部；中心主题和选择保持有效 |
| ACC-KBD-014 | P0 | 视口偏离中心 | 按 `Ctrl+R` | 定位并选中中心主题；不刷新网页 |
| ACC-KBD-015 | P0 | 任意工具/编辑/多选状态 | 连续按 Esc | 按编辑→工具→多选→激活态逐层退出，不越级关闭文档 |
| ACC-KBD-016 | P0 | 中文输入法 composition 中 | 按 Space、Enter、方向键、Tab | 事件先交给 IME；compositionend 前不触发脑图命令 |
| ACC-KBD-017 | P1 | 画布激活 | 按 `Ctrl+;` 两次 | 进入/退出只显示当前分支；恢复原视口与折叠状态 |
| ACC-KBD-018 | P1 | 快捷键设置 | 重绑、制造冲突、搜索并恢复默认 | 冲突被阻止或提示；平台映射正确；重启后保留 |
| ACC-KBD-019 | P1 | `DOC-EMBEDDED` 未激活脑图 | 在正文按 Enter/Tab/Delete/Ctrl+A | 正文按 Tiptap 规则响应；脑图不拦截 |
| ACC-KBD-020 | P1 | 仅使用键盘 | 遍历工具栏、格式面板、菜单、Sheet Bar | 所有核心鼠标命令可达；焦点可退出且无陷阱 |
| ACC-KBD-021 | P1 | Topic、Boundary 分别选中 | 按 `Ctrl+Shift+R`，再选择合法终点 | 启动 Relationship 工具并创建一次合法关系；不产生 TreeEdge，Esc 可取消 |
| ACC-KBD-022 | P1 | 主题选中 | 按 `Ctrl+K`，新增并再次编辑 Web Link | 焦点进入 Link 编辑器；提交、取消、危险协议校验和撤销行为正确 |

## 7. 鼠标交互

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-MSE-001 | P0 | `MM-BASE` | 单击、双击主题 | 单击选择；双击进入续写编辑并保留原文本 |
| ACC-MSE-002 | P0 | 主题与空白分别测试 | 右键单击 | 先按合同选择主题或保持空白上下文，再打开对应自定义菜单；不开始框选 |
| ACC-MSE-003 | P0 | 空白画布 | 左键拖框后松开 | 完成框选；无需第二次点击或右键结束 |
| ACC-MSE-004 | P0 | 空白画布 | 右键拖动 | 平移画布；超过拖动阈值后松手不打开上下文菜单 |
| ACC-MSE-005 | P0 | 空白画布 | Space+左键拖动 | 平移画布；不创建框选或 Floating Topic |
| ACC-MSE-006 | P0 | `MM-BASE` | 拖主题经过前、后、子级、Floating 落点 | 显示唯一明确预览；松手前领域模型不变化 |
| ACC-MSE-007 | P0 | 有效拖放预览 | 松手后立即撤销 | 原子完成换父级/排序；一次撤销恢复全部层级、顺序和位置 |
| ACC-MSE-008 | P0 | 非法拖放目标 | 松手 | 显示禁止状态；模型、历史、保存状态均不变化 |
| ACC-MSE-009 | P0 | `DOC-EMBEDDED` | 未激活时滚轮；激活后滚轮、Shift+滚轮、Ctrl+滚轮 | 未激活滚正文；激活后分别纵向平移、横向平移、缩放；边界视觉明确且页面不误滚 |
| ACC-MSE-010 | P1 | 空白画布 | 双击 | 在精确画布坐标创建 Floating Topic 并进入编辑 |
| ACC-MSE-011 | P1 | 长文本主题 | 拖宽度控制柄、恢复 Fit | 宽度、换行和布局实时更新；进入历史并持久化 |
| ACC-MSE-012 | P1 | Relationship 选中 | 拖端点和控制点 | 可重连主题和改变曲率；端点/控制点位置保存 |
| ACC-MSE-013 | P1 | 多选主题 | 拖动主选择 | 按合同成组移动；相对位置、层级和引用不漂移 |
| ACC-MSE-014 | P1 | 菜单/弹层已打开 | 点击画布、滚动、按 Esc | 浮层按规则关闭并恢复焦点；未确认操作不提交 |
| ACC-MSE-015 | P1 | Relationship、Boundary、Summary、Callout、Zone 分别存在 | 对各元素右键单击 | 先选择唯一目标，再打开类型正确的菜单；不隐式选择其内容或开始框选 |
| ACC-MSE-016 | P0 | 已多选 3 个 Core 主题 | 分别右键已选成员与未选主题 | 右键已选成员保留完整多选并以该成员为主目标；右键未选主题才切为单选；菜单命令作用域准确 |

## 8. 触控与手写笔

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-TCH-001 | P1 | 手机/平板 `MM-BASE` | 单击、双击主题 | 单击选择；双击编辑；无延迟重复触发 |
| ACC-TCH-002 | P1 | 主题选中 | 长按 | 打开主题上下文菜单；轻微抖动不误触拖拽 |
| ACC-TCH-003 | P1 | 空白画布 | 长按或使用插入按钮 | 可创建 Floating Topic；不依赖鼠标右键 |
| ACC-TCH-004 | P1 | 主题已选中 | 长拖到另一主题 | 显示拖放落点并换父级；画布不同时平移 |
| ACC-TCH-005 | P1 | 画布 | 双指捏合 | 以手势中心缩放；不触发浏览器页面缩放 |
| ACC-TCH-006 | P1 | 画布 | 双指平移 | 平移脑图；不拖动主题、不滚动正文 |
| ACC-TCH-007 | P1 | 嵌入文档 | 单指纵向滑动、激活画布后重复 | 页面滚动与画布模式边界清晰，可显式退出画布 |
| ACC-TCH-008 | P1 | 无物理键盘 | 进入多选模式并点选/框选 | 无 Ctrl/Shift 也能完成多选，且有清晰退出入口 |
| ACC-TCH-009 | P1 | 软键盘已弹出 | 编辑多行长主题 | 当前主题保持可见，不被软键盘/工具栏遮挡 |
| ACC-TCH-010 | P2 | 支持手写笔和平掌拒绝设备 | 笔点击/拖动，同时手掌触碰 | 笔与触摸正确区分；无手掌误触和双重 pointer 事件 |

## 9. 结构、布局与视口

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-LAY-001 | P0 | 同一固定模型 | 重载并自动布局 20 次 | 坐标确定性一致，不因遍历顺序、异步时序或 UUID 漂移 |
| ACC-LAY-002 | P0 | `MM-MANUAL` 已保存 | 关闭、重开、切路由、进入全屏 | 手工位置/偏移完整保留；挂载不再无条件 Dagre 重排 |
| ACC-LAY-003 | P0 | `MM-MANUAL` | 点击显式“整理布局”后撤销 | 只有显式命令重排；一次撤销恢复所有坐标、方向和偏移 |
| ACC-LAY-004 | P0 | 中心主题有奇偶数量主分支 | 使用双向 Mind Map 连续新增主题 | 左右分配稳定且视觉平衡；旧分支不无故换边 |
| ACC-LAY-005 | P0 | 节点含不同字体、图片、长文本 | 自动布局 | 使用实测尺寸而非固定 `150×50`；节点和标签无重叠 |
| ACC-LAY-006 | P0 | 快速切结构、编辑文本、移动节点 | 等待异步布局结果 | 旧请求被取消/丢弃，不覆盖最新模型和手工操作 |
| ACC-LAY-007 | P0 | 大图超出初始视口 | Fit、100%、回中心、缩放至边界 | Fit 覆盖完整内容而非 500px 视口；比例和锚点正确 |
| ACC-LAY-008 | P1 | `MM-MIXED` 与锁定 capability registry | 参数化遍历官方 9 个结构家族、Grid 内置样式及全部合法方向/variant/options，并注入 fishbone+radial 等非法组合 | 所有合法组合符合金色几何并可往返；非法方向、未知 variant/option 被语义校验解释并拒绝，不猜测渲染 |
| ACC-LAY-009 | P1 | `MM-MIXED` | 仅切换单个分支结构 | 只影响该分支；其他分支层级、结构和手工位置不被重置 |
| ACC-LAY-010 | P1 | `MM-DEEP` | 折叠、展开深层分支 | 可见节点重新利用空间；展开后顺序和手工偏移稳定 |
| ACC-LAY-011 | P1 | `MM-MANUAL` 含 Floating Topic | 整理结构分支 | Floating Topic 不被吸入主树，除非用户显式转换 |
| ACC-LAY-012 | P1 | `MM-SEMANTIC` | 移动、重排、切换结构 | Relationship、Boundary、Summary、Callout、Zone 几何随锚点更新，无残影 |
| ACC-LAY-013 | P1 | 自由分支 | 拖近对齐位置并按 Alt 重试 | 智能参考线/吸附出现；Alt 临时禁用吸附 |
| ACC-LAY-014 | P1 | 稠密脑图 | 开关 Compact Map、Justify、统一线宽 | 间距和对齐按合同改变且无重叠；切换可撤销、可保存 |
| ACC-LAY-015 | P1 | 允许 Topic Overlap | 拖动主题发生重叠，再关闭该能力 | 开启时层级和命中正确；关闭时先预览恢复布局并确认 |
| ACC-LAY-016 | P1 | 极大/极小画布坐标 | 平移、缩放、保存、重载 | 无精度抖动、消失、坐标溢出或跳回原点 |
| ACC-LAY-017 | P1 | 画布视口已调整 | 编辑内容并撤销 | 默认视口变换不进入内容历史；显式保存视图后才持久化共享默认 |
| ACC-LAY-018 | P1 | 10 个非活动内嵌脑图 | 滚动页面并依次激活 | 非活动图休眠/虚拟化；激活时恢复各自视口和选择策略 |
| ACC-LAY-019 | P0 | Core 金色模型 | 分别切换 Mind Map、Logic Chart、Tree Chart、Org Chart 及其 Core 方向 | 四类 Core 结构几何、层级、side/order 和重载结果符合金色基线；切换可撤销 |
| ACC-LAY-020 | P1 | Timeline 金色语料与锁定 registry | 参数化切换 Horizontal、Vertical、Horizontal Off-Axis，重排后保存、重载并 `.xmind` 往返 | 横/纵只改变 direction，Off-Axis 只改变 variantId；三种几何与顺序符合金色基线，无 orientation 双写或往返漂移 |
| ACC-LAY-021 | P1 | Matrix 含无 Label、多 Label、同名 Label、混合富文本与嵌套 Matrix | 编辑列主题与行 Label，增删/重排单元主题，复制粘贴并 `.xmind` 往返 | 列头、Label 行头、合并/分组及单元归属符合锁定 descriptor；行头不被误存为 Topic RichText，结构切换和往返不丢 Label |

## 10. 样式、主题与 Skeleton

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-STY-001 | P1 | 新建空白脑图 | 遍历至少 54 个自有 Skeleton | 每个 Skeleton 的背景、间距、结构和默认样式符合金色快照 |
| ACC-STY-002 | P1 | 各层级主题 | 遍历产品清单全部主题形状 | 形状、圆角、内边距、边框和命中区域正确 |
| ACC-STY-003 | P1 | 主题选中 | 修改填充、透明度、边框、圆角、阴影 | 即时预览；撤销、复制、保存重载一致 |
| ACC-STY-004 | P1 | 选中部分主题文本 | 修改字体、大小、颜色、粗斜体、下划线、删除线、对齐 | 只影响选区；保存后不降级为 `label + bold` |
| ACC-STY-005 | P1 | 分支选中 | 修改线型、粗细、颜色、端点、渐细和彩色分支 | 目标范围按继承规则更新；方向变化后端点正确 |
| ACC-STY-006 | P1 | 父级有默认样式，子级无 override | 修改层级默认样式 | 子级继承更新；存在本地 override 的属性保持 |
| ACC-STY-007 | P1 | 单节点已定制 | 执行更新同级/更新后代样式 | 作用范围准确；整个批量修改为一个历史事务 |
| ACC-STY-008 | P1 | 源、目标主题样式不同 | 复制样式、粘贴样式 | 只复制样式，不复制文本、层级或语义内容 |
| ACC-STY-009 | P1 | 主题含局部 override | 重置单属性、重置全部样式 | 恢复相应 Theme/Skeleton 默认；未重置属性不变 |
| ACC-STY-010 | P1 | 多选含混合属性 | 打开格式面板并修改一个属性 | 混合值显示 `Mixed`；仅覆盖被修改属性 |
| ACC-STY-011 | P1 | 主题选中 | 应用重要、非常重要、删除线、默认等 Quick Style | 视觉和语义符合合同；可撤销、可重置 |
| ACC-STY-012 | P1 | 浅色、深色、打印模式 | 查看相同脑图 | 自定义颜色不被错误反转；默认色有足够对比度和打印可读性 |
| ACC-STY-013 | P0 | 所有已知样式字段及未知扩展字段均存在 | 修改一个无关样式后保存重载 | 所有未修改字段完整保留；未知字段不被静默清除 |
| ACC-STY-014 | P1 | 固定主题、字体、视口 | 与视觉金色图对比 | 关键几何误差 ≤2px、色差 ΔE00≤2、像素差满足 0.5% 门槛 |
| ACC-STY-015 | P1 | 同级主题已有编号 | 改编号样式/起始值，再插入、删除和重排主题 | 编号是结构化字段而非文本；显示连续、顺序正确、保存重载和撤销一致 |
| ACC-STY-016 | P1 | Map/Theme 格式面板打开 | 参数化切换 Smart Color、自定义六色主题、纯色/图片背景、全局字体、全局分支线宽；逐项撤销并重载 | 预览、继承作用域和色板顺序正确；每项作为内容命令可撤销；背景资源与所有设置重载/导出一致 |
| ACC-STY-017 | P1 | 两个 Sheet 共用 Theme，跨实体引用 named Style，Theme 含多条有序 Rule | 创建/编辑/重排 Rule；尝试删除活动 Theme/被引用 Style，再分别选择 replacement 与 materialize overrides；undo→redo→重载 | 无 replacement 的危险删除零事务拒绝；replacement 或 materialize 在一个事务修复全部引用，解析样式视觉等价；不相关 override 不变且无悬空 style/theme ID |

## 11. 语义元素与内容增强

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-SEM-001 | P1 | 分别选择 Topic→Topic、Boundary→Topic | 创建 Relationship | 两类合法端点均可创建非层级关系；任何 `TreeEdge/orderKey` 不变 |
| ACC-SEM-002 | P1 | 选中一个主题 | 启动 Relationship 后点击另一主题 | 创建关系并选中新关系；工具模式退出 |
| ACC-SEM-003 | P1 | Relationship 工具激活 | 点击空白画布 | 按合同创建 Floating Topic 并建立关系 |
| ACC-SEM-004 | P1 | Relationship 选中 | Space/双击编辑标签 | 标签可编辑并正确提交/取消；不改变端点 |
| ACC-SEM-005 | P0 | `A2 ↔ B1` 有 Relationship | 删除 `A` 或 `A2` | 只删除结构子树和失效关系；`B/B1` 永不沿关系被删除 |
| ACC-SEM-006 | P1 | Relationship 选中 | 参数化遍历 4 类线形、颜色、粗细、虚线、两端各 11 类端点样式和富文本 | 每个枚举按锁定映射渲染；实体 routing/arrows 与样式 color/width/dash 无冲突；保存、撤销、复制、导出一致 |
| ACC-SEM-007 | P1 | Relationship 选中 | 拖两个端点和所有控制点 | 可重新连接和改变曲线；手工端点不再被自动吸附覆盖 |
| ACC-SEM-008 | P1 | 参数化选择连续普通主题、Central、单个 Floating、两个 Floating、Summary Topic | 添加 Boundary | 普通范围、单个 Floating 与 Summary Topic 成功并包围正确结构范围；Central 和两个 Floating 的入口禁用并说明原因、零事务；节点增删、折叠、布局后合法边界更新 |
| ACC-SEM-009 | P1 | Boundary 已存在 | 改标题、范围、形状和样式 | 引用范围合法；标题和样式持久化 |
| ACC-SEM-010 | P1 | 参数化选择单个主题、连续兄弟、跨两个分支、单个 Floating | 添加 Summary；编辑每个结果主题并按 Tab 添加子主题 | 同组连续主题生成一个 canonical sibling-range；跨分支在一个事务生成一组一个 Summary/result；单 Floating 合法；每个 result 为无普通入边的 summary-result，可编辑且后代向括号外侧生长，不与范围重叠 |
| ACC-SEM-011 | P1 | 四个方向各有一个 Summary，结果主题含子树 | 选中 Summary，分别把 start/end 拖到最近和跨多个合法兄弟；切换 auto/left/right/top/bottom、线色/粗细/虚线；undo→redo→保存→重载，再切只读 | 拖柄与 bracket 方向一致并实时吸附真实兄弟中心；一次 pointerup 一个历史项；scope 精确、结果子树身份与相对布局不变；括号/connector 样式独立于结果 Topic 样式；重载稳定；只读时拖柄隐藏且控件禁用 |
| ACC-SEM-012 | P1 | 普通主题选中 | 添加 Callout | 标注锚定主题；可编辑形状、文本和颜色；随主题移动 |
| ACC-SEM-013 | P1 | 选择合法区域 | 创建 Zone 并进入聚焦 | Zone 可聚焦、复用和导出；内部主题身份与结构不变 |
| ACC-SEM-014 | P1 | 主题选中且 Marker 面板可用 | 创建/重命名/重排/删除自定义 MarkerGroup 与组内 Marker；测试互斥替换/非互斥叠加，并显示、移动、重排和编辑 Marker 图例 | Group/Definition/Instance orderKey、exclusive 规则、图标、图例、重载、导出和筛选结果正确；builtin 组不可误删 |
| ACC-SEM-015 | P1 | 主题选中 | 增删标签；在笔记中编辑嵌套列表、基础格式与安全链接 | 标签可筛选；笔记不挤占主题布局；列表层级、marks、链接和保存重载完整 |
| ACC-SEM-016 | P1 | 主题选中 | 添加网页/文档内链接、删除内部目标并尝试打开 | 编辑与打开动作不冲突；危险协议被拒绝；内部目标删除后链接变为可修复 `broken` 状态且不执行导航 |
| ACC-SEM-017 | P1 | 主题选中且存在一张本地图片、一个已授权贴纸素材、一个附件和一个公式 | 分别从 Insert 添加；把图片/贴纸拖到目标主题；把普通图片拖到主题上/下并缩放/Reset Size/Delete；把贴纸拖到上/下/左/右并缩放/Reset Size/Delete；点击、重命名并 Delete/右键 Delete 附件主题；缩放公式 | 普通图片只暴露上/下位置，贴纸暴露四向位置；offset、尺寸/scale 与 Asset 引用完整且每次内容变化可撤销；Reset 恢复 intrinsicSize；Attachment 生成独立子 Topic，点击先预览，授权后保存并由系统默认应用打开；删除、复制、重载和导出符合资源合同 |
| ACC-SEM-018 | P1 | 普通主题选中，分别测试授权/拒绝录音 | 插入 Audio Note，录制、暂停、播放、另存、删除；尝试在 Audio Note 主题插入 Link | 授权即时；成功时原子创建新子主题与 AudioClip；拒绝零内容事务；Link 入口禁用并说明原因；资源引用、另存和失败恢复正确 |
| ACC-SEM-019 | P1 | 单选、多选和父子主题混合选择 | 参数化批量应用/移除 To-do、批量完成/取消完成，并从父级一次完成/取消全部子项 | 目标先去重并形成一个可撤销事务；To-do 使用独立轻量模型，状态、筛选、保存和复制一致；父主题汇总进度实时更新，且不会凭空获得 Task 日期/依赖字段 |
| ACC-SEM-020 | P2 | 有任务依赖和日期 | 打开 Gantt、双向修改日期/依赖 | Gantt 与主题任务字段双向同步；冲突可见且可撤销 |
| ACC-SEM-021 | P1 | 设置演示顺序 | 进入 Pitch 并逐步播放 | 顺序、分支聚焦、退出恢复和只读演示行为正确 |
| ACC-SEM-022 | P0 | 含既有 P1 实体的只读 fixture | 仅执行 Core 主题复制/删除、撤销、保存、重载 | Core 命令被动保留或按合同清理既有实体；不要求打开 P1 编辑器；所有引用有效且无字段丢失 |
| ACC-SEM-023 | P1 | 未预选任何元素 | 启动 Relationship，依次点击两个合法端点 | 创建唯一 Relationship 并退出工具；未产生 TreeEdge 或多余 Floating Topic |
| ACC-SEM-024 | P1 | 分别选择跨两个普通分支、单个 Floating、两个 Floating、Summary Topic | 创建 Boundary，再拖动每个已创建 Boundary 的范围控制柄 | 普通分支按分支自动拆成多个 Boundary；单个 Floating 与 Summary Topic 各创建合法 Boundary；两个 Floating 被解释并零事务拒绝；每个可调范围随重排/折叠重新计算 |
| ACC-SEM-025 | P1 | 分别选择跨分支主题、Central、既有 Summary Topic、单个 Floating、两个 Floating | 查看创建预览并创建 Summary，随后一次 undo/redo | 预览显示准确组数和拆分提示；跨分支按 parent+resolved side+slot 生成多个 Summary；单 Floating 成功；Central、Summary Topic 与两个 Floating 禁用并说明精确原因，零事务且不产生孤儿 result；一次 undo 删除全部创建、redo 以原 ID 恢复 |
| ACC-SEM-026 | P1 | Zone 内含多个 Floating 根 | 分别执行 Remove Zone、Clear Content，保存重载并撤销 | 前者删 Zone 但保留内容；后者删内容并留下 schema-valid 空 Zone（rootTopicIds=[]、rect/title/style/relationships 保留、autoResize=false）；两条命令与确认文案独立且均可完整撤销 |
| ACC-SEM-027 | P1 | Zone、Topic、Boundary、Callout 已存在 | 建立 Zone↔各合法类型、Topic↔Topic、Boundary→Topic，并尝试 Callout↔Callout、Boundary↔Boundary 等非法组合；单独导出/打印 Zone | 合法组合引用和锚点正确；非法组合被解释并零事务拒绝；输出只覆盖 Zone 完整边界，移动后连接不丢失 |
| ACC-SEM-028 | P1 | 主题选中 | 添加 Task，设置负责人、起止日期、持续时间、优先级、0/中间/100% 进度、blocked/cancelled 和依赖 | 普通 status 随 progress 一致更新，done+0/not-started+80 等非法组合被拒绝；Task 字段、筛选、复制、保存和导出一致，且不与 To-do 混为同一模型 |
| ACC-SEM-029 | P1 | Pitch 已生成步骤 | 遍历三种播放策略并包含/排除主题 | 步骤顺序、分支可见性和跳转结果符合设置；排除项不进入播放 |
| ACC-SEM-030 | P1 | 双屏或可模拟 Presenter View | 启动 Presenter View、前进/后退、定位整图 | 观众屏与演讲者屏分离；当前页、下一步和整图定位正确，不泄露演讲者备注 |
| ACC-SEM-031 | P1 | Pitch 设置打开且页面含图片 | 修改比例、主题、布局、转场及当前页面图片位置/尺寸，撤销/重做并重载 | 设置与页面 imageOverride 即时预览、作为内容命令可撤销，重载后保持；脑图图片方位和播放位置不被写入内容 |
| ACC-SEM-032 | P1 | 完整 Pitch | 导出 PDF/PPT 并逐页对比 | 页面顺序、比例、文字、图片、背景和降级报告正确；不包含编辑控件 |
| ACC-SEM-033 | P1 | Topic 已有含作者/无作者导入 Task，Sheet 有工作日历 | 开关 details/creator 等 displayFields；切换 Skip Non-Working Days；修改工作周/IANA 时区；添加 Working Day/Day Off 的单日/范围、五种 repeat 及冲突规则并重排；覆盖 DST 后重载/撤销 | Topic 只显示勾选字段，creator 从 ActorSnapshot 解析；无作者项稳定显示 Unknown 且不冒充当前用户；Task 数据不因隐藏而丢失；按 none→短范围→orderKey 确定决议并原子预览/重算；非法时区、空工作周、倒置范围被拒绝，撤销恢复日历与全部日期 |
| ACC-SEM-034 | P1 | 一个 floating-root 已属于 Zone A | 创建与 A 几何重叠的 Zone B，再尝试把同一根加入 B | 几何重叠允许；重复 membership 被解释并零事务拒绝，移动任一 Zone 不会让同一根位移两次 |
| ACC-SEM-035 | P1 | Zone 含多个 Floating 根并有标题/样式 | 参数化测试整体移动、手柄/数值缩放、锁比例、Auto Resize、手动 resize、Resize to Fit、折叠/展开、复制、Bring Forward/To Front/Send Backward/To Back | rect 与 roots 原子移动；最小 100×100；手动 resize 关闭 Auto Resize；Fit 一次性生效；折叠只留标题；复制重映射内容/样式；z-order 稳定且全部可撤销重载 |
| ACC-SEM-036 | P1 | 主题可接收图片，编辑器处于编辑模式 | 分别通过 Insert 与直接拖放添加安全的本地图片；拖到主题上/下、缩放、Reset Size、Delete/右键 Delete；逐步 undo/redo，切只读并保存/重载 | Asset 与 TopicImage 原子创建，普通图片 placement 仅为 top/bottom，显示尺寸和资源引用准确；Reset 恢复 intrinsicSize；上传/解码/拖放失败零事务且无布局跳变或孤立 manifest；图片参与节点实测布局；只读无调整控件；重载后逐字段一致 |
| ACC-SEM-037 | P1 | Windows Desktop bridge 与普通 Web 环境各一组 | 添加/打开/重命名/重载本地 file、folder Link，并撤销权限或移动目标 | Desktop 使用受控句柄/桥接正常打开；Web 无持久权限时明确降级并在重载后请求重新授权，不伪装成功、不持久化本机绝对敏感路径 |
| ACC-SEM-038 | P1 | 两个 Sheet 分别有 auto/manual 唯一 Deck，含备注、图片 override 与手工顺序 | 新增/删除/重排 Topic，修改 include/exclude 后播放并重载，再对 manual Deck 执行显式 Regenerate；注入同 Sheet 第二 Deck | 播放/PDF/PPT 始终读取该 Sheet 唯一 canonical slides；auto 同事务确定更新且保留稳定 target 的 overrides；manual 不被树编辑暗改，只有 Regenerate 重建；重复 Deck 被语义校验拒绝，无第二套顺序 |
| ACC-SEM-039 | P1 | Boundary、Summary/result 子树、Callout、Zone 均含 Relationship 与资源 | 参数化删除锚点/范围成员/result；分别选中 Summary 按 Delete、右键 Summary → Delete；再通过 reorder/reparent/delete-current/delete-subtree 造成 Summary scope 0/1/N 组；每步 undo→redo→保存→重载 | 严格符合数据规范级联表；公开 UI 不出现 detach/二次确认；直接删除形成一个历史项并级联删除 Summary/result 完整子树；0 组删除 Summary/result 子树，1 组保留原 ID，N 组显示拆分预览、保留第一组并用 payload 预分配 ID 完整克隆其余 result 子树及内部引用；无悬空端点、孤儿 result、误删无关 Topic 或资源引用泄漏 |

### 11.1 Marker / Sticker / Illustration 目录专项

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-CAT-001 | P1 | XMind Desktop 26.04.01341 Windows、官方 Marker/Sticker 指南、同日目录盘点和干净 NMDD release 清单 | 逐项核对官方近 500、锁定 UI 中 13+ 分类、搜索/双入口/拖放/四向调整，以及自定义 Marker 导入/Select 批量管理；记录版本、语言、DPI、授权态和证据 SHA-256 | 官方公开事实、26.04 观察和 NMDD `CODE` 状态分栏记录；不得把动态分类当永久官方合同、把 468 当官方精确数量，或把“行为等价”写成商业素材逐图复制 |
| ACC-CAT-002 | P1 | release manifest、实际素材目录、依赖锁、licenses、notices 与来源账本齐备 | 校验每项 ID/kind/category/tags/source package+exact version/SPDX/attribution/notice/byteSize/SHA-256/intrinsicSize/public path；扫描仓库与发行包的来源异常 | 元数据与实际字节逐项一致且路径仅指向受控离线资源；许可证文本匹配上游；不存在 XMind 安装包/网页/截图/`.xmind` 提取素材、商标资源、来源不明二进制或逐图仿冒命名 |
| ACC-CAT-003 | P1 | catalog v1 生成输入和上一版发布清单已锁定 | 在两个干净环境各生成两次；参数化测试本地化改名、排序、增加、删除、alias、重复 ID 与 alias 环 | 相同输入得到 byte-identical manifest/PNG/指纹；改名排序不改 ID；删除生成 tombstone；ID 不复用，alias 仅指向等价现存项且无环；重复/漂移/孤儿文件使 CI 失败 |
| ACC-CAT-004 | P1 | 选中可编辑 Topic，目录状态为空 | 分别从 `Insert > Sticker/Illustration` 与 Marker 侧栏入口打开；遍历 13 个 NMDD 分类、Sticker/Illustration/全部 kind，关闭后重开 | 两入口复用同一面板和筛选状态；分类顺序、每类/每 kind/总结果数与 manifest 一致；切换只改临时视图、不写 contentRevision；关闭后焦点返回触发控件 |
| ACC-CAT-005 | P1 | 目录完整加载，含中文名、英文 tag、稳定 ID 和近似名称 | 参数化输入 NFKC 全/半角、大小写、中文、英文、完整/部分 ID、多个 token、前后/连续空格；在 IME composition 中输入并清空 | 搜索覆盖 label/ID/category/tags；token 为 AND、结果保持 manifest 稳定顺序且无重复；composition 未提交时不抖动或误插入；清空恢复当前分类/kind 全量且零内容事务 |
| ACC-CAT-006 | P1 | 目录面板打开 | 组合切 category/kind/query 得到 0、1、多项；模拟 manifest 延迟、单图解码失败与目录级失败后重试 | 结果数和条件摘要准确；0 结果给出可清空的空状态；单图失败隔离且保留可读名称，目录失败可重试、不显示过期结果、不产生内容事务或泄露内部路径 |
| ACC-CAT-007 | P1 | 选中 Topic；各选一个 Sticker 与 Illustration；Asset registry 初始无对应资源 | 点击卡片插入，再对相同条目重复插入；逐步 undo/redo、保存/重载 | 每次点击只提交一个原子命令；Asset 按内容哈希安全去重，TopicImage/顺序 ID 由 planner 预分配；默认尺寸、role、alt、目标 Topic 正确；undo 无孤儿，redo/reload 保持 ID 与像素 |
| ACC-CAT-008 | P1 | 两个可编辑 Topic、一个非法语义元素、空白画布和只读副本可见 | 从目录卡片开始拖动，依次悬停/放到两个 Topic、非法元素、空白与窗外；再在 busy/read-only 状态尝试点击和拖动，并注入未知 MIME/catalog ID | 只接受受控内部 MIME 与 manifest 中 ID；合法目标即时高亮且 drop 目标由当前位置决定；非法/取消/未知/busy/read-only 均零事务、无 Asset fetch/孤儿；成功 drop 一个事务且 `effectAllowed/dropEffect=copy` |
| ACC-CAT-009 | P1 | Topic 上已有一项 Sticker 和一项 Illustration | 分别拖到上/下/左/右，手柄缩放，右键 Reset Size，Delete/右键 Delete；每步 undo/redo 并重载 | 只暴露四向 placement；布局避让与命中框随尺寸更新；Reset 精确恢复 manifest intrinsicSize；删除只移除目标 TopicImage 并按引用计数处理 Asset，不删除 Topic；历史与重载逐字段一致 |
| ACC-CAT-010 | P1 | production build、离线缓存、468 项清单；性能基准机与 4× CPU throttle | 冷开面板、连续滚动首尾、跨 13 类切换、快速输入 20 次查询并反向滚动；记录 DOM、解码、长任务、帧时与网络 | 首次目录 chunk 就绪后 200 ms 内可交互；任一时刻素材卡 DOM ≤80；仅请求可见区+一屏 overscan；搜索/筛选 p95 <50 ms；无 >100 ms 主线程长任务，滚动 p95 帧时 <16.7 ms；离线仍可发现和插入全部已缓存条目 |
| ACC-CAT-011 | P1 | 仅键盘和屏幕阅读器，分别测 loading/有结果/无结果/busy/read-only | 从入口进入，使用 Tab/Shift+Tab、方向键、Home/End、PageUp/PageDown、Enter/Space、Esc 浏览筛选和卡片；插入后撤销 | 面板使用命名 dialog/region 与 grid/list 语义、roving tabindex 和可见焦点；播报名称/kind/分类/位置/结果数/禁用原因；虚拟化后焦点不丢，Esc 关闭并返回入口；无仅靠颜色的信息 |
| ACC-CAT-012 | P1 | 已有可写 custom MarkerGroup；准备多张合法 PNG/JPG/SVG、重复内容、混淆扩展名、超限图和含 script/foreignObject/外链的 SVG | 一次多选导入，查看逐项预览/错误后确认；undo/redo、应用到 Topic、保存/重载与导出 | magic/MIME/尺寸/字节/数量/SVG 清洗先完成；合法项按哈希去重并生成 Asset-backed Definition，文件顺序确定；危险/超限项不可激活且原因精确；确认项一个事务、取消或全失败零事务，无脚本/外链执行或孤儿 Asset |
| ACC-CAT-013 | P1 | 准备 26.04 可读历史 `.xrb` 金色包，以及路径穿越、绝对路径、重复项、加密、ZIP64、超条目/总量/压缩比、嵌套包和畸形图片语料 | 导入各包，比较预览/诊断/提交；在不支持该来源的平台重试 | 合法包按组/项目稳定映射并保留名称与资源；危险包在解压/解码前按限制拒绝，绝不写路径、执行内容或联网；部分可恢复项必须显式列出，只有用户确认的集合原子提交；平台不支持时显示真实降级而非假成功 |
| ACC-CAT-014 | P1 | 两个可写 custom group，各含若干 Definition，其中部分已应用并进入 Legend；builtin 组也可见 | 进入 Select，参数化单选、Shift 连续选择、全选/清空；批量 Move 到另一 custom group，尝试移动到 builtin；undo/redo、重载 | Select 只属于面板临时态且有选中数播报；目标去重并按原稳定顺序移动，Definition ID、Instance 与 Legend 引用不变；一次 Move 一个历史项；builtin 目标禁用并解释、零事务 |
| ACC-CAT-015 | P1 | custom 与 builtin Definition 混合，多 Topic Instance 和 Legend 引用已知 | Select 多个 custom Marker，查看影响预览后 Delete；取消一次、确认一次；尝试包含 builtin；一次 undo/redo 并重载 | 预览精确显示 Definition/Instance/Legend 数量；取消零事务；确认原子清理全部合法引用且一次 undo 完整恢复原 ID/顺序/引用；builtin 不可选择或使提交明确拒绝，绝不被误删 |
| ACC-CAT-016 | P1 | XMind 26.04 生成的 builtin/custom Marker 与 Sticker 金色文件、NMDD 同类 canonical fixture、资源 bytes 和固定 codec 版本 | 双向执行 import→export→XMind 打开编辑保存→NMDD 再导入；覆盖缺 bytes、未知 native ID 和完整 fallback | 仅真实原生往返通过的子集标 `native-verified` 并绑定版本/平台/golden SHA-256；其余为 `native-partial` 或 `canonical-fallback-only`，canonical/资源无损且导出报告逐项诊断；不得把 Sticker 写成普通 Local Image、custom/asset Marker 写成 builtin 或静默丢失 |
| ACC-CAT-017 | P1 | Topic 已有某互斥组 Marker，另有不同组和非互斥组；Legend 已显示 | 从 Marker 工具栏/Insert 应用同组新 Marker、跨组 Marker和两个非互斥 Marker；用右键/弹层删单个 Instance；Show/Hide、改图例文本/位置/顺序并重载/导出 | 同组原子替换、跨组新增、非互斥叠加；单项删除不删 Definition/Group；两入口语义一致；Legend 只列合同项且所有修改可逐步 undo/redo、筛选、重载和导出 |
| ACC-CAT-018 | P1 | catalog v1 release 候选与 `lucide-react@0.358.0` lock 完整 | 执行目录 release validator，并篡改单文件、hash、尺寸、分类数、kind 数、license、notice、源/manifest 指纹、依赖版本/integrity 和 orphan 文件逐项复跑 | 未篡改清单精确报告 468 项、13 类、39 Illustration、13,821,512 B；每类 36 项且恰有 3 Illustration；任一篡改均 fail closed；报告明确其为 Lucide ISC 许可纵切和 `canonical-fallback-only`，不出现“XMind 逐图同款/已 native”声明 |

## 12. 撤销、重做与事务

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-HIS-001 | P0 | `MM-EMPTY` | 逐项新增、编辑、删除、仅删主题并撤销/重做 | 每个用户动作一个历史项；状态完全可逆 |
| ACC-HIS-002 | P0 | `MM-BASE` | 拖主题两秒后松手，再撤销 | 整段 pointermove 合并为一个历史项；恢复原父级、顺序和位置 |
| ACC-HIS-003 | P0 | 文本编辑态 | 连续输入中文并提交，再撤销 | 恢复编辑前完整文本，不逐字符破坏 composition |
| ACC-HIS-004 | P0 | Core 文本、基础样式、结构、折叠各有一个操作 | 逐项撤销/重做 | 所有已交付 Core 内容字段进入统一历史，不只增删节点可撤销 |
| ACC-HIS-005 | P0 | `MM-MANUAL` | 自动整理后撤销 | 所有受影响坐标、方向和手工偏移作为一个事务恢复 |
| ACC-HIS-006 | P0 | `DOC-EMBEDDED` | 编辑前文→新增脑图节点→编辑后文→连续撤销 | 按真实时间顺序撤销；Tiptap 与脑图历史不分叉 |
| ACC-HIS-007 | P0 | 已撤销两步 | 执行新动作后尝试重做 | 重做栈按标准规则清空 |
| ACC-HIS-008 | P0 | 非法拖放、Esc 取消编辑 | 检查历史与脏状态 | 不产生空历史项、不触发保存 |
| ACC-HIS-009 | P0 | 批量折叠、批量删除 Core 主题 | 操作后撤销一次 | 整个批量意图原子恢复，不留下半完成状态 |
| ACC-HIS-010 | P0 | 异步 Core 布局正在运行 | 取消、成功、失败分别测试 | 只有成功提交进入历史；迟到结果不能追加历史 |
| ACC-HIS-011 | P0 | 两个脑图块 | 分别编辑并交错撤销 | 撤销按文档时间线作用正确块；状态不串图 |
| ACC-HIS-012 | P1 | 保存并重载 | 检查撤销边界 | 重载边界策略明确；不得从旧内存缓存恢复并覆盖服务器状态 |
| ACC-HIS-013 | P1 | Relationship、范围元素、资源、To-do/Task 各有一个编辑操作 | 逐项撤销/重做 | 每类 Desktop parity 内容均进入统一命令历史，引用与资源计数完整恢复 |
| ACC-HIS-014 | P1 | 上传、批量替换、导入分别可取消/失败 | 逐项取消、失败和成功 | 取消/失败零内容事务；只有成功结果形成一个可撤销历史组；迟到异步结果被丢弃 |

## 13. 系统剪贴板

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-CLIP-001 | P0 | 选中含后代主题 | Ctrl+C、Ctrl+V | 复制完整结构子树；样式/内容完整；新 ID 唯一 |
| ACC-CLIP-002 | P0 | 同上 | Ctrl+X、Ctrl+V | 剪切删除可撤销；粘贴位置正确；剪贴板写入系统 |
| ACC-CLIP-003 | P1 | 子树内部有 Relationship | 复制粘贴 | 内部关系重映射到新 ID；指向选区外的关系被丢弃或写入粘贴报告，活动集合中不得保留悬空引用 |
| ACC-CLIP-004 | P0 | 复制后关闭脑图块、切回正文块或打开另一文档 | 粘贴 | 仍可从系统剪贴板粘贴，不依赖旧 React 组件内存；不要求 Core 提前交付多 Sheet 管理入口 |
| ACC-CLIP-005 | P0 | 系统剪贴板权限被拒绝 | 复制/粘贴 | 给出可操作提示或 fallback；绝不误用陈旧内存数据 |
| ACC-CLIP-006 | P1 | 多选不连续主题 | 复制粘贴 | 相对顺序、层级、side 和浮动位置正确 |
| ACC-CLIP-007 | P1 | 复制主题后切到纯文本编辑器 | 粘贴 | 输出可读纯文本/Markdown fallback，不泄漏内部 JSON |
| ACC-CLIP-008 | P1 | 剪贴板为缩进文本/Markdown 列表 | 粘贴到主题 | 转换为对应层级；空行、中文和混合缩进有确定规则 |
| ACC-CLIP-009 | P1 | 源/目标样式不同 | 复制样式、粘贴样式 | 只传递样式 MIME；文本、层级和语义内容不变 |
| ACC-CLIP-010 | P1 | 子树含图片/附件/公式 | 跨文档粘贴 | 资源复制或引用符合权限策略；无失效临时 URL |
| ACC-CLIP-011 | P1 | 剪贴板含不可信 HTML/SVG | 粘贴 | 内容被清洗；脚本、事件属性和危险 URL 不进入模型 |

## 14. 导航、Outliner 与 Sheet

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-NAV-001 | P0 | 大图 | 使用按钮、滚轮、快捷键、百分比输入缩放 | 比例一致；范围 10%–500%；以规定锚点缩放 |
| ACC-NAV-002 | P0 | 大图 | Fit | 全部可见结构和语义元素进入视口并保留安全边距 |
| ACC-NAV-003 | P0 | 内嵌 Preview | 滚正文、点击激活、Esc 退出 | Preview 不拦滚轮；Active 边框明确；退出后正文恢复 |
| ACC-NAV-004 | P0 | 内嵌 Active | 进入/退出全屏 | 选择、编辑文本、视口和未保存事务不丢失 |
| ACC-NAV-005 | P1 | `MM-DEEP` | 聚焦单分支，再退出 | 只显示目标上下文和面包屑；退出恢复视口/折叠状态 |
| ACC-NAV-006 | P1 | `MM-RICH` | 搜索文本、标签、Marker、笔记 | 结果数、顺序、高亮和折叠内定位正确 |
| ACC-NAV-007 | P1 | 多个匹配项 | 逐个替换和全部替换后撤销 | 范围正确；全部替换作为一个事务撤销 |
| ACC-NAV-008 | P1 | 有 To-do 完成/未完成、不同 Task 状态、Note、Marker、标签 | 建立嵌套 AND/OR/NOT 组合过滤，保存视图后重载 | 布尔逻辑和各语义谓词符合合同；过滤默认只改个人视图，显式 SavedView 可恢复且不改内容 |
| ACC-NAV-009 | P1 | Outliner 打开 | 在大纲选择、编辑、拖动、折叠 | 与画布的选择、文本、层级、顺序和折叠双向同步 |
| ACC-NAV-010 | P1 | 多 Sheet 文件 | 新建、重命名、复制、排序、删除 Sheet | 操作可撤销、可保存；最后一个 Sheet 和未保存删除有保护 |
| ACC-NAV-011 | P1 | 多 Sheet | 跨 Sheet 复制/移动主题 | 内容和资源完整；源/目标历史和引用按合同处理 |
| ACC-NAV-012 | P1 | 选中分支 | “由分支创建 Sheet” | 新 Sheet 层级与内容正确；原分支按选择策略保留或替换为链接 |
| ACC-NAV-013 | P1 | 全屏编辑器 | 切换 Mind Map/Outliner、收起面板、重开 | UI 偏好按用户保存，不污染共享内容历史 |
| ACC-NAV-014 | P1 | ZEN/Pitch 模式 | 进入、操作、Esc 逐层退出 | ZEN 保留编辑能力；Pitch 不产生内容事务；退出恢复原壳层 |
| ACC-NAV-015 | P1 | ZEN 模式 | 切换四种外观、打开快捷键列表和搜索，再继续编辑 | Light/Dark/Ultra Light/Ultra Dark、快捷键和搜索均可用；退出恢复原主题与视口，不丢编辑 |
| ACC-NAV-016 | P1 | 两个 Sheet、多个 SavedView | 创建、应用、重命名、排序、设默认、重载；尝试跨 Sheet 设默认并删除当前默认 | 应用恢复 viewport/focus/fold/filter；默认指针仅指向同 Sheet；跨 Sheet 零事务拒绝；删除默认视图同事务清除 defaultSavedViewId，全部可撤销 |

## 15. 导入、导出与打印

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-IO-001 | P0 | 旧版项目私有 JSON fence | 打开并保存 | 所有已定义旧字段 100% 保留并确定性迁移；损坏/不可判定项进入可见报告且原 payload 不被覆盖 |
| ACC-IO-002 | P1 | `XMIND-GOLDEN` | 导入 `.xmind` | Sheet、层级、结构、side/order、样式、语义元素和资源按映射表保留 |
| ACC-IO-003 | P1 | MindMap V2 全功能文件 | 导出 `.xmind` 并由基准 XMind 打开 | 正常打开且无修复提示；已支持字段行为和视觉等价 |
| ACC-IO-004 | P1 | `.xmind` 往返语料 | XMind→V2→XMind | 规范化模型语义等价；不支持字段进入可见降级报告 |
| ACC-IO-005 | P1 | EdrawMind、MindManager、FreeMind、MindNode、Word DOCX、Markdown、OPML、TextBundle 语料 | 分别导入 | 每种格式均经统一规范化管线；层级、顺序、文本、链接、笔记和可支持资源按映射合同转换，降级项进入结构化报告 |
| ACC-IO-006 | P1 | `MM-MIXED` | 以 1×/2×/3×、透明/指定背景、不同 padding/frame 导出 PNG/JPEG/SVG | 全部参数组合生效；导出完整画布而非当前视口；尺寸、字体和几何正确 |
| ACC-IO-007 | P1 | `MM-MIXED` | 导出 PDF/打印 | 分页、缩放、边距、背景、页眉页脚符合设置；无分支裁切 |
| ACC-IO-008 | P1 | `MM-RICH` 含多负责人、四类依赖、有/无 startDate Task 与 To-do | 导出 Word、PowerPoint、Excel、OPML、Markdown、TextBundle、Task CSV/ICS | 通用文本层级、字段、资源与降级报告正确；Task CSV 断言 Task ID=Topic ID、路径 `/`、依赖=TopicID+FS/SS/FF/SF、多人/多依赖以 `, ` 分隔；ICS 仅含有 startDate 的 Task，To-do 不进入两种任务导出 |
| ACC-IO-009 | P1 | 多 Sheet 文件 | 导出当前/选定/全部 Sheet | 范围、名称和顺序正确；各 Sheet 视口不影响内容边界 |
| ACC-IO-010 | P1 | 中文、Emoji、公式、链接、图片齐全 | 导出全部格式 | 无乱码、缺字、失图；SVG/PDF 字体策略可复现 |
| ACC-IO-011 | P1 | 10K 文件 | 导入/导出并中途取消 | 有进度且可取消；UI 可响应；取消后无半成品模型或文件 |
| ACC-IO-012 | P1 | 损坏文件 | 导入 | 错误可理解；当前文档不变化；可下载/保留原文件用于恢复 |
| ACC-IO-013 | P1 | `MALICIOUS-CORPUS` | 导入 | 安全拒绝；不执行脚本、不路径穿越、不污染当前文档 |
| ACC-IO-014 | P1 | 多次导出同一固定模型 | 比较规范化输出 | 内容确定性一致；无随机顺序、时间戳或 ID 漂移影响快照 |
| ACC-IO-015 | P1 | 导出包含外链和附件 | 在隔离环境打开输出 | 链接安全属性和资源路径有效；不存在本机绝对路径泄漏 |
| ACC-IO-016 | P2 | 密码保护文件 | 设置、打开、修改密码、输错密码 | 加密和错误处理符合合同；密钥/明文不进入日志 |
| ACC-IO-017 | P2 | 多个 `.xmind` 文件 | 合并到同 Sheet/不同 Sheet | 层级、Sheet 顺序、资源去重、ID 重映射和撤销行为正确 |
| ACC-IO-018 | P1 | 选择主题范围/分支 | 创建 Map Shot 并修改背景、边框、圆角、阴影、padding | 输出只含目标范围且几何完整；高分辨率结果不受当前视口、缩放和编辑控件影响 |
| ACC-IO-019 | P1 | 含脑图的 Tiptap 文档 | 导出静态 HTML 并在无脚本环境打开 | 每个脑图块包含可见 SVG/图片 fallback；无空白 `data-mindmap` 占位，正文顺序不变 |
| ACC-IO-020 | P0 | 当前 V2 全字段脑图 | 经 Tiptap → Markdown fence → API → 数据库 → 重载 | 私有 fence 往返语义等价；未修改的 P1/P2 扩展字段也按保留合同不丢失 |
| ACC-IO-021 | P1 | 文档包含目标格式不支持的字段 | 导出并分别选择继续、取消、降级 | 报告列出具体实体/字段；继续与降级结果可预测；取消不产生文件或脏状态 |
| ACC-IO-022 | P1 | 当前 V2 含层级、链接与笔记 | 导出可读 Markdown 大纲 | 输出保留层级、可支持链接/笔记，不暴露私有 fence 或内部 JSON |

## 16. 持久化、迁移与数据正确性

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-PER-001 | P0 | `MM-RICH/SEMANTIC/MIXED` | 保存→关闭→重开→再保存 | 规范化 JSON 语义等价；全部已知字段完整 |
| ACC-PER-002 | P0 | `MM-MANUAL` 已保存 | 重载、切路由、切全屏 | 坐标、宽度、side、手工偏移和控制点不被挂载逻辑覆盖 |
| ACC-PER-003 | P0 | TreeEdge 与 Relationship 并存 | 删除、复制、找父级、折叠 | 树算法只读取 `treeEdges`；Relationship 从不参与遍历 |
| ACC-PER-004 | P0 | 节点含全字段和未知扩展字段 | 编辑一个无关字段后保存 | 不相关及未知字段保留，解决当前只剩 `label/bold` 的损失 |
| ACC-PER-005 | P0 | `LEGACY-CORPUS` | 逐版本迁移到当前 Schema | 迁移幂等；修复有报告；无法修复的数据被隔离而非静默删除 |
| ACC-PER-006 | P0 | 100 次快速操作 | 等待保存队列并重载 | 最终服务端状态等于最新前端状态；无乱序响应覆盖 |
| ACC-PER-007 | P0 | 两个标签页基于同一 revision | 先后保存冲突修改 | 检测冲突并合并/提示；不静默 last-write 丢数据 |
| ACC-PER-008 | P0 | 保存时断网、500、刷新 | 恢复网络并重开 | 本地恢复队列可重试；用户能区分已保存/未保存状态 |
| ACC-PER-009 | P0 | 一个文档含多个脑图 | 分别编辑、保存、重载 | blockId 稳定；数据、历史和保存状态不串图 |
| ACC-PER-010 | P0 | 重复 ID、TreeEdge/TaskDependency/Style dependency 环、Relationship 自环/悬挂引用、非法 role×placement、重复/冲突 RichMark、缺字段 | 打开 | 校验器按确定规则归一化可修项；不可修时隔离并保留原始 payload；普通 Relationship 图环保持合法，不白屏 |
| ACC-PER-011 | P0 | 服务端返回旧 revision | 本地已有更新时应用响应 | 旧响应被拒绝，不能覆盖新状态 |
| ACC-PER-012 | P0 | 浏览器崩溃/强制结束 | 重启应用 | 恢复最近一致草稿；不会把半个事务当成完整版本 |
| ACC-PER-013 | P1 | 新版本文档被旧客户端打开 | 尝试保存后回到新客户端 | 兼容包装或版本保护阻止旧客户端清除新字段 |
| ACC-PER-014 | P0 | 同一模型不同对象插入顺序 | 规范化序列化 | 输出字段和实体顺序确定，利于 diff、缓存和签名 |

## 17. 性能与稳定性

性能项在固定基准机上预热一次、执行五次取 p95；CI 基线变化必须附性能报告。

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-PERF-001 | P0 | `MM-LARGE-500` | 进行新增、编辑、删除、折叠 | 普通命令输入到绘制 p95 < 50ms |
| ACC-PERF-002 | P0 | `MM-LARGE-1K` | 打开至可交互 | p95 ≤ 2s，无白屏或长时间不可取消任务 |
| ACC-PERF-003 | P1 | `MM-LARGE-10K` | 打开至可导航 | p95 ≤ 6s；采用渐进渲染/虚拟化 |
| ACC-PERF-004 | P0 | 500 主题、固定基准机与 60Hz 刷新率 | 分别连续平移、缩放和拖拽 10s | 每条路径 frame-time p95 ≤16.7ms；同时报告 dropped-frame ratio 与 >50ms long task，输入不丢失；不得用方向含混的 FPS p95 替代帧时门槛 |
| ACC-PERF-005 | P1 | 10K 主题 | 连续平移缩放 10s | p95 ≥ 30fps；不可见节点不参与完整 DOM 渲染 |
| ACC-PERF-006 | P1 | 1K/10K 主题 | 显式自动布局 | 1K ≤1s、10K ≤5s；Worker 执行且 UI 可取消 |
| ACC-PERF-007 | P1 | 10K 主题 | 搜索、过滤、跳转 | 查询 p95 ≤150ms；结果计数准确 |
| ACC-PERF-008 | P1 | 10K 主题、100 次编辑 | 自动保存 | 序列化/保存不产生 >100ms 主线程长任务 |
| ACC-PERF-009 | P1 | 10K 主题、100 步历史 | 往返操作并监测内存 30min | 无单调泄漏；峰值目标 ≤400MB |
| ACC-PERF-010 | P0 | 快速操作、布局、保存、切路由并发 | 压力运行 30min | 无未捕获异常、数据竞争、悬挂任务或旧结果覆盖 |

## 18. 安全、权限与只读

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-SEC-001 | P0 | `DOC-READONLY` | 尝试全部键盘修改命令 | 模型、历史、脏状态和保存请求均不变化 |
| ACC-SEC-002 | P0 | `DOC-READONLY` | 尝试拖动、删除、右键修改、触控修改 | 修改入口隐藏/禁用；不能绕过 UI 直接改变 store |
| ACC-SEC-003 | P0 | `DOC-READONLY` | 平移、缩放、折叠、聚焦、复制 Core 主题 | 被授权的 Core 读取/个人视图行为可用；不持久化内容修改 |
| ACC-SEC-004 | P0 | 编辑过程中服务端撤销权限 | 再编辑并保存 | 命令立即阻止；服务端拒绝写入；允许下载/复制原始 canonical backup 并提示，不要求提前交付 P1 格式导出器 |
| ACC-SEC-005 | P1 | 主题含 `javascript:`、`data:`、恶意重定向 URL | 点击/导出/复制链接 | 危险协议拒绝；外链使用安全属性和显式确认策略 |
| ACC-SEC-006 | P0 | 恶意 HTML/SVG/富文本 | 通过 Core 粘贴入口写入 | 脚本、事件处理器、外部加载和 CSS 注入被清洗 |
| ACC-SEC-007 | P1 | ZIP bomb、路径穿越、重复 entry | 导入 `.xmind`/资源包 | 在解压前限额；拒绝越界路径与异常压缩比；无文件覆盖 |
| ACC-SEC-008 | P0 | 超大文本、深度和节点数 | 通过 Core 粘贴/编辑入口写入 | 在明确限额前提示或安全拒绝；应用不崩溃、不耗尽内存 |
| ACC-SEC-009 | P1 | 附件/图片资源权限不同 | 复制、导出、分享 | 资源授权逐项检查；私有签名 URL 不被持久化或泄漏 |
| ACC-SEC-010 | P0 | 并发伪造旧 revision/他人 blockId | 调用保存接口 | 服务端校验用户、文档、revision 和 block 权限；请求被拒绝 |
| ACC-SEC-011 | P1 | 错误、迁移、AI、导入失败 | 检查日志与遥测 | 不包含全文、附件内容、密钥、密码或签名 URL |
| ACC-SEC-012 | P1 | Office/CSV/Excel 导出含 `= + - @` 开头文本 | 打开导出文件 | 公式注入被转义或显式按用户选择保留 |
| ACC-SEC-013 | P1 | `DOC-READONLY` 且已交付搜索/导出 | 搜索全部 P1 内容并导出被授权格式 | 搜索和导出可用且遵守资源权限；不创建内容事务、不绕过只读与脱敏策略 |

## 19. 无障碍与响应式

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-A11Y-001 | P1 | 内嵌、全屏、格式面板、菜单分别打开 | axe 扫描 | 0 个 critical/serious 问题 |
| ACC-A11Y-002 | P1 | 仅键盘 | 遍历画布、工具栏、菜单、面板、Sheet Bar | 焦点顺序可预测；焦点环可见；无键盘陷阱 |
| ACC-A11Y-003 | P1 | 层级主题 | 使用 NVDA 浏览 | 暴露 tree/treeitem、层级、选中、展开、posinset/setsize |
| ACC-A11Y-004 | P1 | 混合结构 | 打开无障碍 Outliner | 所有内容和核心编辑命令可由同步大纲访问 |
| ACC-A11Y-005 | P1 | 新增、删除、移动、折叠 | 使用 NVDA 监听 | live region 简洁播报动作、目标和新位置，不重复朗读整图 |
| ACC-A11Y-006 | P1 | 全部文字、边线、选中态 | 自动对比度检查 | 普通文字 ≥4.5:1；大字和非文本控件 ≥3:1 |
| ACC-A11Y-007 | P1 | 页面缩放 200%/400% | 操作工具栏和格式面板 | 功能不丢失、不裁切；必要时重排为抽屉/底部 Sheet |
| ACC-A11Y-008 | P1 | reduced-motion 开启 | 折叠、布局、全屏、定位 | 非必要动画关闭；无眩晕式平移缩放 |
| ACC-A11Y-009 | P1 | 灰度和高对比模式 | 查看 Marker、任务、错误、选择 | 信息不只依赖颜色；具有文字、形状或 ARIA 名称 |
| ACC-A11Y-010 | P1 | 手机和平板 | 测量主要触控目标 | 目标至少 44×44 CSS px；间距避免误触 |
| ACC-A11Y-011 | P1 | 390×844 与 768×1024 | 打开内嵌、全屏、菜单、格式面板 | 无页面横向溢出；safe-area 正确；核心控件可达 |
| ACC-A11Y-012 | P1 | 横竖屏切换和软键盘 | 编辑后旋转设备 | 选择、编辑内容、视口中心和未保存状态保留 |

## 20. 协作与评论扩展

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-COL-001 | P2 | A/B 客户端编辑不同主题 | 同时提交 | 两项修改均保留；所有客户端最终一致 |
| ACC-COL-002 | P2 | A/B 同时编辑同一主题文本 | 交错输入 | 按 CRDT/OT 合并；不静默整段覆盖 |
| ACC-COL-003 | P2 | A 移动主题，B 删除其父级 | 同时提交 | 按明确冲突规则得到合法、单父级、无环树 |
| ACC-COL-004 | P2 | A 创建 Relationship，B 删除端点 | 同时提交 | 活动关系安全删除；最小恢复信息可进入 canonical 外部的 tombstone/待修复报告，但有效集合无悬挂引用 |
| ACC-COL-005 | P2 | 多人在线 | 移动光标和选择 | Presence 不进入内容历史、不触发保存、不遮挡文本 |
| ACC-COL-006 | P2 | A/B 各有本地操作 | A 撤销 | 只撤销 A 的最后本地意图，不倒退 B 的修改 |
| ACC-COL-007 | P2 | A 离线编辑，B 在线编辑 | A 重连 | 离线队列重放并解决冲突；用户可查看合并结果 |
| ACC-COL-008 | P2 | 查看者、评论者、编辑者 | 尝试各类命令 | UI、命令层和服务端执行一致权限 |
| ACC-COL-009 | P2 | 评论锚定主题 | 移动、重命名、删除主题 | 评论跟随稳定 ID；删除后进入可恢复孤立状态 |
| ACC-COL-010 | P2 | 不同 Schema 版本客户端 | 同时协作 | 协商兼容能力；旧客户端不能清除未知操作/字段 |

## 21. AI 扩展

| ID | 级别 | 前置条件 | 操作 | 预期 |
|---|---|---|---|---|
| ACC-AI-001 | P2 | 主题选中 | 请求扩展、总结或重组 | 先展示结构化预览/diff；未确认前模型零修改 |
| ACC-AI-002 | P2 | AI 返回重复 ID、循环父级、危险 URL、超限内容 | 尝试应用 | Schema、无环和安全校验拒绝非法结果 |
| ACC-AI-003 | P2 | 合法 AI diff | 接受后撤销/重做 | 整次接受为一个原子事务；可完整撤销和重做 |
| ACC-AI-004 | P2 | AI 流式生成中 | 取消、切文档、删除目标主题 | 请求取消；迟到结果不能写入错误文档或孤立目标 |
| ACC-AI-005 | P2 | 指定“仅当前分支” | 发起生成 | 不读取或修改范围外内容；发送范围在确认界面可见 |
| ACC-AI-006 | P2 | 超时、限流、流式中断 | 等待并重试 | 当前模型不变；重试不会重复插入已接受内容 |
| ACC-AI-007 | P2 | AI 内容已接受 | 查看元数据与导出 | 可记录来源、时间、模型和操作；按隐私设置决定是否导出 |
| ACC-AI-008 | P2 | 协作中两人接受 AI 修改 | 同时提交 | AI diff 转为标准领域命令，参与正常冲突合并 |
| ACC-AI-009 | P2 | 分支含私密笔记/附件 | 发起 AI 操作 | 默认不上传未授权字段；日志/遥测不含敏感原文 |
| ACC-AI-010 | P2 | AI 建议布局/样式 | 预览、接受、拒绝 | 预览不改共享模型；接受可撤销；拒绝不留历史或脏状态 |

---

## 22. 当前缺陷的强制阻断映射

| 当前缺陷 | 强制回归用例 |
|---|---|
| 右键菜单被完全禁用 | `ACC-MSE-002`、`ACC-MSE-014` |
| 右键承担框选、全屏需要第二次右键结束 | `ACC-SEL-004~006`、`ACC-MSE-003~005` |
| 组件挂载无条件 LR 重排 | `ACC-LAY-002/003`、`ACC-PER-002` |
| 已有父级主题无法换父级 | `ACC-TOP-009~011`、`ACC-MSE-006~008` |
| Relationship 被树遍历导致误删风险 | `ACC-SEM-005`、`ACC-PER-003` |
| 脑图与 Tiptap 双历史不同步 | `ACC-HIS-001~012`，尤其 `ACC-HIS-006/011` |
| 剪贴板只存在组件内存 | `ACC-CLIP-004/005/007` |
| 保存同步只保留 `label/bold` | `ACC-STY-004/013`、`ACC-PER-004` |
| 当前测试只验证 JSON fence 往返 | 全部 P0 浏览器交互、真实 API 重载和迁移语料 |

## 23. 自动化分层

| 层级 | 工具/运行位置 | 负责范围 | 代表用例 |
|---|---|---|---|
| L0 Schema/Invariant | Vitest；纯函数 | Schema、迁移、无环、单父级、引用完整、规范化序列化 | `ACC-PER-003~005/010/014`、`ACC-AI-002` |
| L1 Command/Reducer | Vitest；纯函数 | 所有命令、逆操作、批量事务、只读守卫、ID 重映射 | `ACC-TOP-*`、`ACC-HIS-*`、`ACC-CLIP-001~003` |
| L2 Component | Vitest + Testing Library | 焦点、IME、格式面板、菜单、ARIA、pointer 状态机 | `ACC-KBD-*`、`ACC-MSE-*`、`ACC-A11Y-002~005` |
| L3 Browser E2E | Playwright Chromium | 真正键鼠/触控、Tiptap 边界、系统剪贴板、全屏、保存重载 | 全部 P0 交互；`ACC-NAV-*`、`ACC-SEC-001~004` |
| L4 Cross-browser/device | Playwright Chromium/Firefox/WebKit + 真机 | 平台快捷键、触控、软键盘、响应式 | `ACC-TCH-*`、`ACC-A11Y-010~012` |
| L5 Visual | Playwright screenshot | Skeleton、结构、样式、导出预览、暗色/打印 | `ACC-LAY-008`、`ACC-STY-001~003/014` |
| L6 Contract/File | Node/Vitest + 基准 XMind 人工抽检 | Markdown fence、API、`.xmind`、OPML、Markdown、Office/PDF | `ACC-IO-*`、`ACC-PER-001/005~009` |
| L7 Performance/Soak | Playwright + Performance API | 500/1K/10K 延迟、FPS、内存、Worker、长稳 | `ACC-PERF-*` |
| L8 Security | 隔离导入器 + API 集成测试 | XSS、危险 URL、ZIP、权限、限额、资源泄漏 | `ACC-SEC-*`、`ACC-IO-012/013` |
| L9 Multi-client | 两个以上浏览器上下文 + 故障注入 | CRDT/OT、离线、Presence、权限、AI 并发 | `ACC-COL-*`、`ACC-AI-004/008` |

自动化要求：

- 每条 P0 必须至少有一个自动化用例；人工验收不能替代 P0 自动化。
- 每条 P1 至少有自动化或可重复金色语料；暂时人工的项目必须登记负责人和自动化截止版本。
- 测试名称必须包含完整 `ACC-*` ID；一个参数化测试可以覆盖同一 ID 的结构/方向矩阵。
- Playwright retry 只用于诊断，不得把依赖 retry 才能通过的场景计为发布通过。
- 失败产物必须包含模型快照、命令日志、revision、截图/视频和浏览器 console；敏感正文按安全规范脱敏。

## 24. 发布门禁

### 每个 Pull Request

- TypeScript typecheck、构建和全部受影响单测通过。
- Domain、command、migration 代码行覆盖率至少 95%，分支覆盖率至少 90%。
- 修改产品行为时必须新增或更新对应 `ACC-*`，禁止无验收 ID 的行为变更。
- 当前缺陷映射表中的相关测试不得 skip、fixme 或仅靠 retry 通过。
- 新增 Schema 字段必须有旧版本读取、未知字段保留和保存往返测试。

### 每夜

- 全量 Chromium、Firefox、WebKit；中文 IME；手机和平板模拟测试。
- 全 Skeleton、结构和关键样式视觉快照。
- `LEGACY-CORPUS` 与 `XMIND-GOLDEN` 往返。
- 500/1K/10K 性能基线、内存泄漏和至少 30 分钟压力测试。
- axe、恶意导入语料、API 权限和 revision 冲突测试。

### Core 发布候选

- P0：100% 通过，0 豁免、0 skip、0 已知数据损坏。
- Core 范围内 P1：100% 通过；P2 未实现不得破坏 P0/P1。
- axe critical/serious：0。
- 数据迁移、只读写入、关系误删、静默覆盖、悬挂引用：0。
- 关键视觉快照达到第 4 节阈值。
- 关键性能相对已发布基线不得回退超过 10%。
- 全部阻断套件连续运行 30 次，flaky rate `<0.5%`。
- 真实历史文档迁移保留原始 payload，并已验证可回滚。

### 协作/AI 发布候选

- Core 门禁仍全部满足。
- `ACC-COL-*`/`ACC-AI-*` 目标范围 100% 通过。
- 至少 1,000 组随机并发操作后所有客户端最终一致，且模型无环、单父级、引用完整。
- AI 未确认时模型修改数为 0；接受后能够一次撤销；敏感字段默认不上传。
