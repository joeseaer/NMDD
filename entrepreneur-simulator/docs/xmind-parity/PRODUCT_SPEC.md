# XMind 1:1 产品规格

## 1. 文档信息

| 项 | 值 |
|---|---|
| 产品代号 | MindMap V2 |
| 规格状态 | Design baseline |
| 对标范围 | XMind Desktop 26.04.01341 核心编辑器；Web/AI 能力单列 |
| 宿主 | NMDD Smart Document / Tiptap `mindMap` 原子块 |
| 目标平台 | Windows Web 首发；macOS Web、触控设备跟进 |
| 规格包版本 / 存储 Schema | `1.0.0` / `schemaVersion: 1` |

规格包使用 SemVer；canonical JSON 使用单调递增整数 `schemaVersion`，两者不互作迁移键。本文中的“必须”是发布阻断条件，“应该”可在同一层级的后续小版本完成，“可以”属于增强项。验收以 [INTERACTION_ACCEPTANCE.md](./INTERACTION_ACCEPTANCE.md) 为准。

## 2. 产品结论与成功标准

### 2.1 产品目标

- **PRD-GOAL-001**：用户进入全屏脑图编辑器后，不阅读帮助即可用 XMind 的肌肉记忆完成创建、编辑、重排、折叠、格式化和导出。
- **PRD-GOAL-002**：脑图的层级语义、关系语义、布局语义与渲染状态彼此分离；任何视觉连线都不得被误当作父子关系。
- **PRD-GOAL-003**：旧版 `nodes + edges` 文档首次打开时自动、可审计地迁移，用户手工位置、文本、加粗、外框、概要和联系尽最大可能保留。
- **PRD-GOAL-004**：文档内嵌态与正文滚动不冲突；全屏态提供完整 XMind 式编辑体验；两种模式使用同一个命令、数据和布局内核。
- **PRD-GOAL-005**：所有可见内容修改可撤销、可重做、可持久化；只读态、预览态和导出态不得产生内容修改。

### 2.2 可量化成功标准

| ID | 指标 | 目标 |
|---|---|---|
| PRD-METRIC-001 | 新用户创建“中心主题 → 3 个主主题 → 每个 2 个子主题” | 无帮助情况下 90 秒内完成 |
| PRD-METRIC-002 | 熟练用户仅键盘创建 50 个主题 | 中位时间不高于对标 XMind 的 120% |
| PRD-METRIC-003 | 旧脑图迁移 | 合法数据 100% 保留；修复项均生成迁移报告 |
| PRD-METRIC-004 | 撤销正确率 | 验收命令序列 100% 可逐步逆转并重做 |
| PRD-METRIC-005 | 交互延迟 | 500 主题下普通命令 p95 < 50 ms；拖拽/缩放目标 60 fps |
| PRD-METRIC-006 | 数据安全 | 关系线误删、循环父级、静默覆盖、只读写入均为 0 |
| PRD-METRIC-007 | Core 验收 | P0 验收项 100% 通过，P1/P2 不得破坏 P0 |

### 2.3 非目标

- **PRD-NONGOAL-001**：不复制 XMind 商标、Logo、商业贴纸、插画和专有模板内容。
- **PRD-NONGOAL-002**：不要求 v1 首发即兼容 XMind 私有文件格式中的每个未知扩展字段；未知字段必须安全保留或明确报告。
- **PRD-NONGOAL-003**：不以 React Flow 的 `nodes/edges` 作为领域真相；React Flow 只能是可替换渲染层。
- **PRD-NONGOAL-004**：不在 Core 阶段同时建设多人协作、Gantt 和 AI；它们必须复用稳定的命令与 Schema 后再接入。

## 3. 用户与核心场景

| 角色 | 目标 | 关键路径 |
|---|---|---|
| 文档作者 | 在正文中快速补充结构化脑图 | `/swdt` 或插入菜单 → 内嵌创建 → 全屏精修 → 返回正文 |
| 键盘型知识工作者 | 不离开键盘高速建图 | Enter / Tab / Space / Ctrl+Enter / Alt+方向键 / 折叠快捷键 |
| 视觉整理者 | 切换结构、主题与分支样式 | 选择主题/分支 → 右侧格式面板 → 混合结构与样式继承 |
| 阅读者 | 浏览大图、聚焦分支、搜索和大纲阅读 | 折叠 → 只看分支 → 搜索/过滤 → Outliner |
| 项目规划者 | 在主题上记录任务并查看 Gantt | Task 字段 → 依赖 → Gantt 双向编辑 |
| 协作者 | 同步编辑、评论、跟随他人 | 分享 → presence → 评论/@ → 版本恢复 |

## 4. 产品模式与信息架构

### 4.1 编辑模式

| ID | 模式 | 行为合同 |
|---|---|---|
| PRD-MODE-001 | Embedded Preview | 默认不拦截页面滚轮；显示完整脑图静态状态和“点击编辑”；正文快捷键优先 |
| PRD-MODE-002 | Embedded Active | 单击画布或按 Enter 激活；允许选择、编辑、缩放和平移；点击块外或 Esc 退出激活 |
| PRD-MODE-003 | Fullscreen Editor | 完整工具栏、导航面板、格式面板、Sheet Bar、状态栏和所有快捷键 |
| PRD-MODE-004 | Read Only | 允许浏览、缩放、搜索、折叠临时视图；禁止任何内容事务和持久化写入 |
| PRD-MODE-005 | ZEN | 隐藏常规 UI，仅保留画布和按需浮层；编辑能力与快捷键不变 |
| PRD-MODE-006 | Pitch | 按演示顺序浏览主题；不进入内容编辑；支持窗口、全屏和演讲者视图 |

### 4.2 全屏编辑器布局

- **PRD-SHELL-001 顶部主工具栏**：撤销、重做、Topic、Subtopic、Relationship、Boundary、Summary、Callout、Marker、Note、Insert、Format、ZEN、Pitch、导出、关闭全屏。
- **PRD-SHELL-002 左侧导航面板**：搜索/替换、主题树、笔记、Marker/标签、任务筛选；面板可折叠并记住用户偏好。
- **PRD-SHELL-003 右侧格式面板**：`Map` 与 `Style` 两级；内容根据当前选中元素切换，支持多选混合值。
- **PRD-SHELL-004 底部 Sheet Bar**：新建、切换、重命名、复制、删除、排序 Sheet；提供由选中主题创建 Sheet。
- **PRD-SHELL-005 右下状态区**：Mind Map / Outliner 切换、缩放百分比、缩放滑杆、适配、实际大小、回中心。
- **PRD-SHELL-006 上下文菜单**：右键主题、关系、外框、概要、Zone、空白画布均有不同菜单；右键必须先选中目标且不得清空既有多选。
- **PRD-SHELL-007 命令可发现性**：工具提示显示名称和快捷键；禁用项说明原因；首次使用可展示一次性快捷键提示。

## 5. 画布、选择与导航

### 5.1 视口

- **PRD-CANVAS-001**：普通滚轮平移画布；`Shift + 滚轮` 横向平移；`Ctrl/Command + 滚轮` 以指针为中心缩放。
- **PRD-CANVAS-002**：右键拖拽、空格+左键拖拽均可平移；平移不得开始框选或打开菜单。
- **PRD-CANVAS-003**：缩放范围默认 10%–500%，右下角实时显示百分比；提供 Fit、100%、回中心。
- **PRD-CANVAS-004**：内嵌未激活时滚轮滚动文档；激活后遵循脑图视口操作，并显示清晰激活边框。
- **PRD-CANVAS-005**：视口变换属于用户视图状态，默认不进入内容撤销栈；“保存视图”后才写入共享默认视图。
- **PRD-CANVAS-006**：大图移动时只渲染可见节点及必要缓冲区；折叠节点的后代不得参与命中测试。

### 5.2 选择

- **PRD-SELECT-001**：单击选择一个元素；单击空白清空选择；Esc 依次退出编辑、工具模式、多选、激活态。
- **PRD-SELECT-002**：`Ctrl/Command + 单击` 切换元素是否属于多选；`Shift + 单击` 选择同一父级的连续范围。
- **PRD-SELECT-003**：空白处左键拖拽为框选；按 Ctrl/Command 为增量框选；从右向左为相交选择，从左向右为完全包含选择。
- **PRD-SELECT-004**：主题、关系、外框、概要、标注、Zone 可以被选择；选择外框或 Zone 不应隐式选择其内容。
- **PRD-SELECT-005**：多选后的格式面板显示共同值；混合值显示 `Mixed`；一次修改批量应用并形成一个撤销组。
- **PRD-SELECT-006**：键盘方向导航按视觉邻近与结构关系稳定移动；折叠后不得导航到隐藏节点。

## 6. 主题与层级编辑

### 6.1 主题类型

- **PRD-TOPIC-001**：产品界面支持 Central、Main、Subtopic、Floating、Summary 五种主题语义；持久化只保存 `central/regular/floating-root/summary-result` 特殊角色，Main 与 Subtopic 必须由 Central 根、`TreeEdge` 和深度派生，不能作为第二份可修改层级真相。
- **PRD-TOPIC-002**：每个 Sheet 恰好一个 Central Topic；Central 不可删除、不可成为其他主题的子级。
- **PRD-TOPIC-003**：Floating Topic 不属于主树，可有自己的后代；可通过拖拽转换为主树主题，主树主题也可转换为 Floating。
- **PRD-TOPIC-004**：Summary Topic 属于概要元素，但可像普通主题一样继续添加后代。

### 6.2 创建、编辑和删除

- **PRD-TOPIC-010**：未编辑时 `Enter` 创建后一个同级，`Tab` 创建子主题，`Ctrl/Command + Enter` 插入父主题。
- **PRD-TOPIC-011**：选择默认占位主题后直接输入会替换占位文本；选择已有主题后直接输入进入替换模式；Space 或双击进入续写编辑。
- **PRD-TOPIC-012**：文本编辑支持多行、输入法组合、局部富文本、Emoji 和 CJK；编辑中 `Shift + Enter` 换行，Enter 提交，Esc 取消。
- **PRD-TOPIC-013**：双击空白创建 Floating Topic；位置是精确画布坐标，不触发整图自动布局。
- **PRD-TOPIC-014**：Delete 删除主题及其结构后代；`Ctrl/Command + Delete/Backspace` 只删除当前主题并把子主题提升到原父级。
- **PRD-TOPIC-015**：删除多个主题时先归一化到最高层选中主题，禁止重复删除同一后代；关系线仅在端点被删除时按策略删除，不参与级联遍历。
- **PRD-TOPIC-016**：主题宽度可拖拽、输入数值或恢复 Fit；换行与宽度变化进入撤销栈。
- **PRD-TOPIC-017**：根主题和所有普通主题都支持富文本、样式和附属内容，不得硬编码排除根主题。

### 6.3 重排、换父级和折叠

- **PRD-HIER-001**：主题层级只以独立 `TreeEdge(parentTopicId, childTopicId, side, orderKey)` 集合为唯一事实源；Topic 不重复保存 `parentId/children[]`，画布连线只是该集合的派生视图。
- **PRD-HIER-002**：拖动主题显示插入前、插入后、成为子级、成为 Floating 四类明确落点；松开后一次提交。
- **PRD-HIER-003**：拖动一个主题移动其完整结构子树；关系线、外框、概要按引用自动更新但不改变层级。
- **PRD-HIER-004**：`Alt/Option + ↑/↓` 调整同级顺序；顺序在重新打开、切布局、协作合并后保持稳定。
- **PRD-HIER-005**：禁止把主题拖到自身或后代下；任何入口都必须经过同一无环校验。
- **PRD-HIER-006**：有后代的主题悬停显示折叠控件；折叠后显示隐藏主题数量；支持当前、当前层级、全部折叠/展开。
- **PRD-HIER-007**：只显示当前分支时保留面包屑和退出入口；退出后恢复之前的视口与折叠状态。
- **PRD-HIER-008**：左右 Mind Map 中主主题拥有稳定 `side`；自动平衡只改变 `side`，不得改变父级或同级相对顺序。

## 7. 默认快捷键合同（Windows）

| ID | 上下文 | 快捷键 | 行为 |
|---|---|---|---|
| PRD-KEY-001 | 主题选中 | Enter | 后一个同级主题 |
| PRD-KEY-002 | 主题选中 | Tab | 子主题 |
| PRD-KEY-003 | 主题选中 | Ctrl+Enter | 插入父主题 |
| PRD-KEY-004 | 文本编辑 | Shift+Enter | 主题内换行 |
| PRD-KEY-005 | 主题选中 | Space | 编辑现有文本 |
| PRD-KEY-006 | 主题选中 | Alt+↑/↓ | 同级重排 |
| PRD-KEY-007 | 主题选中 | Delete | 删除主题与分支 |
| PRD-KEY-008 | 主题选中 | Ctrl+Delete | 删除单主题并提升子级 |
| PRD-KEY-009 | 主题选中 | Ctrl+/ | 折叠/展开当前主题 |
| PRD-KEY-010 | 画布激活 | Ctrl+Alt+/ | 折叠/展开全部 |
| PRD-KEY-011 | 主题选中 | Ctrl+; | 进入/退出只显示分支 |
| PRD-KEY-012 | 画布激活 | Ctrl+R | 回到中心主题 |
| PRD-KEY-013 | 画布激活 | Ctrl+F | 搜索/导航面板 |
| PRD-KEY-014 | 内容可编辑 | Ctrl+Z / Ctrl+Shift+Z | 统一撤销/重做 |
| PRD-KEY-015 | 元素选中 | Ctrl+C/X/V | 系统剪贴板复制/剪切/粘贴 |
| PRD-KEY-016 | 画布激活且非文本编辑 | Ctrl+A | 选择当前 Sheet 全部可选主题；文本编辑时仍只全选文本 |
| PRD-KEY-017 | 画布激活 | 方向键 | 视觉/结构导航 |
| PRD-KEY-018 | 任意工具模式 | Esc | 按层级退出当前状态 |
| PRD-KEY-019 | 主题或 Boundary 选中 | Ctrl+Shift+R | 启动 Relationship 创建 |
| PRD-KEY-020 | 主题选中 | Ctrl+K | 添加/编辑 Web Link |

快捷键必须通过统一 command registry 注册，支持平台映射、搜索、重绑定、冲突提示和恢复默认。内嵌未激活状态不得劫持正文快捷键。Phase 0 必须用锁定版 XMind 实机导出的完整快捷键表校准本节；每个快捷键随其所属功能优先级交付（例如 Relationship、Search、Link 为 P1），本表不代表 XMind 全部快捷键。

## 8. 结构与布局

### 8.1 结构

- **PRD-STRUCT-001**：支持官方 9 个结构家族：Mind Map、Logic Chart、Brace Map、Tree Chart、Org Chart、Timeline、Fishbone、Matrix、Tree Table；同时实现 XMind 可选择的 Grid 内置结构样式。工程上可作为第 10 个 layout plugin，但不得把它误称为第 10 个官方结构家族。
- **PRD-STRUCT-002**：结构可以应用于 Central、任一分支主题或 Floating Topic；同一 Sheet 可混合多种结构。
- **PRD-STRUCT-003**：每种结构提供官方等价方向/变体；切换结构只改变布局语义，不重写主题层级和内容。
- **PRD-STRUCT-004**：布局引擎先测量真实节点尺寸，再计算位置；禁止以固定 150×50 代替真实尺寸。
- **PRD-STRUCT-005**：布局结果确定性：相同数据、主题、字体和画布参数必须产生相同坐标。
- **PRD-STRUCT-006**：结构布局使用插件接口；新增结构不得修改主题领域模型或其他结构算法。
- **PRD-STRUCT-007 Timeline**：至少覆盖 Horizontal、Vertical、Horizontal Off-Axis；横/纵方向只由 `direction` 表达，Off-Axis 等形态只由 `variantId` 表达，禁止在 `options` 中重复保存 orientation。
- **PRD-STRUCT-008 Matrix**：列头来自结构主题，行头按 XMind 语义来自 Label 而非普通 Topic Text；无 Label、多 Label、同名 Label、重排、编辑、剪贴板及 `.xmind` 往返的映射必须由 Phase 0 实机金色语料冻结，不能把视觉行标题反写成重复主题文本。

### 8.2 全局与高级布局

- **PRD-LAYOUT-001**：支持 Auto Balance、Compact Map、Justify Topic Alignment、统一分支线宽。
- **PRD-LAYOUT-002**：Mind Map 支持 Branch Free-Positioning；手工偏移独立保存，重新打开不得丢失。
- **PRD-LAYOUT-003**：支持 Flexible Floating Topics 和 Topic Overlap；关闭后给出恢复自动布局的预览与确认。
- **PRD-LAYOUT-004**：拖拽时显示智能参考线、同级间距和吸附反馈；按 Alt 临时关闭吸附。
- **PRD-LAYOUT-005**：布局命令形成一个原子撤销组；切布局后撤销必须恢复所有节点原位置、方向和手工偏移。
- **PRD-LAYOUT-006**：外框、概要、关系和 Zone 使用布局后锚点重算，不得作为普通主题参与结构布局。

## 9. 样式系统

- **PRD-STYLE-001**：样式分为 Theme/Skeleton、层级默认样式、元素样式引用、局部 override 四层；渲染按确定优先级合并。
- **PRD-STYLE-002**：主题支持形状、填充、透明度、边框、圆角、内边距、最小/最大宽度；文本支持字体、字号、颜色、粗斜体、下划线、删除线、对齐和局部富文本。
- **PRD-STYLE-003**：分支支持线型、颜色、粗细、端点、渐细、彩色分支；方向改变时端点自动重算。
- **PRD-STYLE-004**：提供至少 10 类结构模板与不少于 54 个自有 Skeleton 组合位；内容不得依赖 XMind 专有素材。
- **PRD-STYLE-005**：支持 Smart Color Theme、自定义六色主题、背景色/图片、全局字体和全局分支线宽。
- **PRD-STYLE-006**：Copy Style、Paste Style、Reset Style 与普通复制粘贴完全独立。
- **PRD-STYLE-007**：支持更新同层主题、更新所有子主题；批量更新形成一个撤销组并保留显式 override 规则。
- **PRD-STYLE-008**：Quick Style 支持 Important、Very Important、Cross Out、Default，并可由主题扩展。
- **PRD-STYLE-009**：编号是结构化字段，不写入主题文本；重排、插入和删除后自动更新。
- **PRD-STYLE-010**：深色、浅色、系统模式下均满足 WCAG AA；导出使用文档主题而不是编辑器 UI 主题。

## 10. 语义元素

### 10.1 Relationship

- **PRD-REL-001**：Relationship 存在独立集合，绝不进入 `TreeEdge`、子树遍历、结构布局或分支删除级联；端点支持 Topic、Boundary、Callout 与 Zone。
- **PRD-REL-002**：支持先选起点再点终点、依次点击两端、同时选择两端三种创建方式；空白终点可创建 Floating Topic。
- **PRD-REL-003**：端点可重新连接；控制点可调整曲线；未固定端点自动选择较佳吸附位置。
- **PRD-REL-004**：关系线可编辑富文本说明，支持四类线形、颜色、粗细、虚线和两端各 11 类端点样式；Phase 0 用锁定版 XMind 实机与 `.xmind` 语料冻结名称映射。
- **PRD-REL-005**：选择和删除关系只影响关系本身；删除端点时，活动 Relationship 必须在同一事务中删除。若需恢复，最小恢复信息移入 canonical 文档外的 operation-store tombstone/迁移报告，禁止在有效 `relationships` 集合中保留悬空引用。

### 10.2 Boundary、Summary、Callout、Zone

- **PRD-BOUND-001**：Boundary 支持同分支连续主题范围；跨分支选择自动拆成多个 Boundary；范围可拖动调整。对齐 XMind 当前行为：Central 不可创建 Boundary；单个 Floating Topic 可创建 Boundary，但一次选择包含两个或以上 Floating Topic 时必须禁用并说明原因；Summary Topic 不因角色本身被排除。
- **PRD-BOUND-002**：Boundary 标题、形状、填充、边框、文字均可独立格式化并完整持久化。
- **PRD-SUM-001 创建与分组**：选择一个或多个主题创建 Summary；同一 `parent + resolved side + slot` 下的连续主题归入同一范围，跨分支选择在一次原子命令中生成多个 Summary，每组各有独立、可编辑的 Summary Topic。
- **PRD-SUM-002 合法性**：Central 与既有 Summary Topic 不可加入概要范围；单个 Floating Topic 可创建 Summary，两个及以上 Floating Topic 的组合禁用并说明原因；非法选择必须零事务返回，不得留下半成品 Summary 或孤儿 result Topic。
- **PRD-SUM-003 范围交互**：选中 Summary 后显示与方向一致的起止范围拖柄；拖柄吸附到最近合法同组兄弟并实时预览，pointerup 只提交一个历史项。Summary Topic 可像普通主题一样编辑并继续添加子主题。
- **PRD-SUM-004 布局与样式**：概要括号/连接线支持 left/right/top/bottom/auto 方向、颜色、粗细与虚线；Summary Topic 的文本、形状、填充和分支样式仍由 Topic 样式独立控制。自动布局把完整 result 子树放在概要外侧，子主题继续向外生长且不得与范围重叠。
- **PRD-SUM-005 结构归一化与删除**：成员删除、换父级、换 side/slot 或重排后按变更前精确成员意图归一化为 0/1/N 组；0 组删除 Summary/result 子树，1 组保留原 ID，N 组保留第一组并使用 planner 预分配 ID 克隆其余 result 子树；整次变化可一次撤销、重做和重载。公开交互严格采用 XMind 的“选中 Summary 后按 Delete”或“右键 Summary → Delete”，直接删除 Summary 与 result 完整子树；不提供 `detachResult` 作为公开分支。
- **PRD-CALLOUT-001**：Callout 锚定一个主题，支持气泡方向、形状、文本和样式；移动主题时保持相对锚点。
- **PRD-ZONE-001**：Zone 是独立容器，包含 Floating Topic 根及其后代；支持整体移动、缩放、锁比例、Auto Resize、折叠、复制和 z-order。
- **PRD-ZONE-002**：Remove Zone 保留内容；Clear Content 保留 Zone；两者必须是不同命令并分别确认。
- **PRD-ZONE-003**：Zone 可连接主题、Boundary、Callout 和其他 Zone，可单独导出和打印。

## 11. 主题增强内容

- **PRD-ENRICH-001 Marker**：支持优先级、进度、旗帜、星标、箭头和自定义组；同组替换、跨组叠加；可显示/编辑图例。
- **PRD-ENRICH-002 Label**：一个主题可有多个标签；支持逗号输入、排序、过滤和高亮同标签主题。
- **PRD-ENRICH-003 Note**：富文本长笔记支持列表、链接和基础格式；主题显示笔记标识；导航面板可查看全部笔记并跳转。
- **PRD-ENRICH-004 Link**：支持 Web URL、同 Sheet 主题、跨 Sheet 主题、文档页面，以及 Windows 桌面等价的本地文件/文件夹链接；浏览器无法取得持久文件权限时必须显示平台降级，不得伪装为完整桌面能力。外部 URL 必须安全校验。
- **PRD-ENRICH-005 Attachment**：附件引用资源表，不把大文件 Base64 写入文档 JSON；按 XMind 交互，插入后创建一个可选择和删除的附件主题，其文件内容由 Attachment/Asset 实体承载；点击附件主题先预览，取得用户许可后保存到本地并交给系统默认应用打开；附件主题可像 Topic 一样重命名，Delete 或右键 Delete 删除。
- **PRD-ENRICH-006 Local Image**：支持从工具栏/菜单插入本地图片，以及把本地图片直接拖放到目标主题；普通图片可拖到主题上方或下方、手动缩放、右键 Reset Size 恢复原始尺寸，并可通过 Delete 或右键 Delete 删除。不得把贴纸的左/右/overlay 位置或未验证的裁剪能力冒充成本地图片公开功能。
- **PRD-ENRICH-007 Sticker / Illustration**：仅使用自有或已授权素材库；支持从 Insert 或 Marker 侧栏插入，也支持从素材面板拖到目标主题；可放在主题上/下/左/右、手动缩放、右键 Reset Size，并可通过 Delete 或右键 Delete 删除。
- **PRD-ENRICH-008 Equation**：LaTeX 数学/化学公式可编辑、缩放和无障碍朗读文本。
- **PRD-ENRICH-009 Audio**：录音权限必须即时确认；按 XMind 行为，Audio Note 以新建子主题呈现，音频存资源表，支持播放、另存和删除；Audio Note 主题不得再插入 Link。
- **PRD-ENRICH-010 To-do**：轻量完成状态，与 Task 模型分离；支持对单个主题或当前多选一次性应用、移除、完成/取消完成，支持完成/未完成过滤；父主题显示子 To-do 汇总进度，并可一次完成/取消完成全部子项。
- **PRD-ENRICH-011 Task**：进度、优先级、负责人、起止日期、持续时间、依赖和工作日历；可配置在主题上显示哪些字段。

### 11.1 Marker、Sticker 与 Illustration 目录合同

- **PRD-CATALOG-001 对标口径**：XMind 26.04 的行为基线为官方所述“近 500”个 Sticker/Illustration、锁定桌面环境中至少 13 个分类，以及 Marker/Sticker/Illustration 的完整发现与管理工作流；精确数量、分类、证据等级和 NMDD 当前差距以 [XMIND_26_04_CATALOG_INVENTORY.md](./XMIND_26_04_CATALOG_INVENTORY.md) 为准。数量接近不等于逐图相同，也不得作为 1:1 完成证据。
- **PRD-CATALOG-002 素材权利与来源**：发行目录只允许自有或明确授权素材；每项必须记录稳定 ID、kind、分类、标签、源包与精确版本、SPDX/attribution/notice、byteSize、SHA-256、intrinsicSize 和离线路径。严禁提取、描摹、裁切或重打包 XMind 商业 Sticker、Illustration、Marker、商标或截图资源。
- **PRD-CATALOG-003 目录信息架构**：`Insert > Sticker/Illustration` 与 Marker 侧栏入口打开同一目录状态；面板提供 Sticker/Illustration kind、分类、结果数、搜索、加载/空/错误状态。接近 500 项时必须使用增量或虚拟化渲染，不得一次解码和挂载全部原图。
- **PRD-CATALOG-004 搜索合同**：搜索覆盖本地化名称、稳定 ID、分类名称和 tags；采用 Unicode NFKC、大小写归一和空白 token 化，多 token 为 AND，结果始终保持 versioned manifest 的稳定顺序。清空、切分类、切 kind、无结果和输入法组合态均不得产生内容事务。
- **PRD-CATALOG-005 插入与拖放**：选中 Topic 后点击素材，或从目录把素材拖到任一合法 Topic，均通过同一个 planner 原子创建/复用 Asset 与 TopicImage；内部拖放只接受受控 MIME 和已知 catalog ID。合法目标有明确预览，非法目标、取消、资源校验失败、只读或无权限均为零内容事务。
- **PRD-CATALOG-006 图像交互与可访问性**：Sticker/Illustration 公开上/下/左/右方位、手动缩放、Reset Size、Delete/右键 Delete；目录采用可键盘操作的 grid/list 语义、可见焦点、可读名称、结果数播报和焦点恢复，并尊重 reduced-motion。删除图像不得删除 Topic，Reset 必须恢复 manifest 的 intrinsicSize。
- **PRD-CATALOG-007 稳定 ID 与版本**：分类 ID 和条目 ID 独立于显示名、语言和排序；已发布 ID 永不复用于不同素材。删除条目保留 tombstone，只有视觉与语义等价时才允许无环 alias；manifest 结构或 ID 解释改变时提升 catalog version。文档必须持久化 Asset/TopicImage 实体和内容哈希，catalog ID 不得成为重开文档所需的唯一指针。
- **PRD-CATALOG-008 Native/Fallback 诚实性**：每个 Marker/Sticker/Illustration I/O 路径必须声明 `native-verified`、`native-partial`、`canonical-fallback-only` 或 `not-implemented`。只有绑定 XMind 26.04 版本、平台与金色文件 SHA-256 的真实打开→编辑→保存→再导入证据，才可标为 native；fallback 必须无损保留 canonical 内容并在导出报告中逐项说明，不得把 Sticker 冒充普通 Local Image 或把自定义 Marker 冒充 builtin。
- **PRD-CATALOG-009 自定义 Marker 导入**：向可写自定义组支持一次选择多个 PNG、JPG、SVG，以及导入历史 `.xrb` Marker 包；每个输入经过 MIME/magic、尺寸、字节/数量/解压比、SVG 清洗、外链/脚本、路径和哈希校验后生成 Asset-backed MarkerDefinition。批次要么按确认的逐项结果原子提交，要么零提交，不得静默丢项或执行包内内容。
- **PRD-CATALOG-010 自定义 Marker 多选管理**：Marker 面板提供显式 Select 临时态；支持单选、全选/清空，并把去重后的多个自定义 Marker 在一个事务中 Move 到另一可写自定义组或 Delete。Move 保持 Definition ID、顺序和 Instance 引用；Delete 先显示受影响的 Definition/Instance/Legend 数量，并可一次 undo/redo；builtin 组和定义永远不可被该流程删除。
- **PRD-CATALOG-011 Marker 应用与图例**：通过 Marker 工具栏或 `Insert > Marker` 应用；同一互斥组内选择新 Marker 原子替换，跨组选择新增，非互斥组可叠加；单个 Instance 可右键或弹层删除。Show/Hide Legend、标题、位置、项目顺序和图例文本编辑均为 canonical command，可撤销、重载、筛选和导出。
- **PRD-CATALOG-012 当前许可纵切声明**：catalog v1 固定为 `lucide-react@0.358.0` / ISC 派生的 468 项、13 类、39 个 Illustration，并通过许可证、lock integrity、生成源/manifest 指纹、逐文件 SHA-256/尺寸及 20 MiB 总预算门禁。它只证明当前许可目录纵切完整，不声明分类、画风或任一条目与 XMind 商业目录逐图同款；后续版本必须更新盘点、追踪和变更报告。

## 12. 搜索、过滤、Outliner 与 Sheet

- **PRD-VIEW-001**：搜索支持大小写、全词、当前分支/当前 Sheet/全部 Sheet 范围、下一个/上一个和替换。
- **PRD-VIEW-002**：导航面板可按主题、Note、Marker、Label、To-do、Task 搜索/过滤；过滤时非匹配内容可隐藏或淡化。
- **PRD-VIEW-003**：Outliner 与 Mind Map 共用同一数据和命令；支持键盘编辑、拖拽重排、折叠和只显示分支。
- **PRD-VIEW-004**：Mind Map 与 Outliner 切换保持选择、折叠、活动 Sheet 和撤销栈。
- **PRD-SHEET-001**：一个脑图文档支持多个 Sheet；每个 Sheet 有独立根主题、元素、主题和演示设置；用户显式保存的默认视口以关联 `SavedView` 表示，临时视口仍属于个人 ViewState。
- **PRD-SHEET-002**：支持新建、复制、重命名、删除、排序、由分支生成 Sheet；最后一个 Sheet 不可删除。
- **PRD-SHEET-003**：跨 Sheet Topic Link 在重命名和排序后保持有效；删除目标时原子转换为显式 `broken` 状态并提供修复/删除，不能伪装成有效引用或导致文档校验失败。

## 13. 历史、剪贴板与持久化

- **PRD-HISTORY-001**：所有内容修改只能通过 command bus；每个命令必须可序列化、可验证、可逆或提供确定性快照逆操作。
- **PRD-HISTORY-002**：文本输入按连续编辑会话合并；拖拽、布局、批量格式、粘贴分别形成一个撤销组。
- **PRD-HISTORY-003**：撤销和重做跨内嵌/全屏模式保持同一栈；退出全屏不得重置历史。
- **PRD-HISTORY-004**：视口平移缩放、临时选择、hover、工具预览不进入内容历史。
- **PRD-HISTORY-005**：文档级 Tiptap 撤销与脑图命令通过单一桥接事务协调，禁止双轨互相覆盖。
- **PRD-CLIP-001**：复制写入自定义 MIME、HTML、Markdown 大纲和纯文本多种格式；优先读取自定义 MIME。
- **PRD-CLIP-002**：支持跨脑图块、跨文档、跨标签页复制；ID、资源引用、关系和样式按粘贴策略重映射。
- **PRD-CLIP-003**：复制分支默认包含后代及内部关系；只复制主题、复制样式、复制为图片是独立命令。
- **PRD-PERSIST-001**：内容变更 debounce 写回 Tiptap；选择和视口变化不得触发内容序列化。
- **PRD-PERSIST-002**：保存前执行 Schema 与图不变量校验；失败时保留内存草稿并显示可恢复错误，不得写入损坏数据。
- **PRD-PERSIST-003**：加载旧数据只迁移一次；迁移报告包含修复、降级和无法解析项；原始 JSON 在确认保存前保留恢复副本。
- **PRD-PERSIST-004**：临时预览边、selection、editNonce、React Flow 内部字段不得进入持久化数据。

## 14. 导入、导出、打印与兼容

- **PRD-IO-001**：按当前官方桌面导入口径导入 `.xmind`、EdrawMind、MindManager、FreeMind、MindNode、Word DOCX、Markdown、OPML、TextBundle；每种格式均为 P1 适配器并使用同一规范化导入管线。
- **PRD-IO-002**：导入器输出统一 `MindMapDocument` 和结构化报告；未知样式或扩展字段放入 namespaced `extensions`，不得静默丢弃。
- **PRD-IO-003**：保存/导出 `.xmind`，并导出 PNG/JPEG、SVG、PDF、Markdown、OPML、TextBundle、Word、PowerPoint、Excel；Task 另支持 CSV/ICS；支持当前分支、当前 Sheet、全部 Sheet。
- **PRD-IO-004**：图片导出支持 1×/2×/3×、透明背景、背景色、padding、frame；不得只截取当前视口。
- **PRD-IO-005**：PDF/打印先计算完整内容 bounds，再分页或缩放；隐藏编辑器控件；颜色和字体与预览一致。
- **PRD-IO-006**：文档 HTML 导出必须包含静态 SVG/图片 fallback，不能只输出空 `data-mindmap` div。
- **PRD-IO-007**：项目私有 Markdown fence 继续可往返；同时提供可读 Markdown 大纲导出。
- **PRD-IO-008**：导出前报告不支持项；用户可选择继续、取消或降级。
- **PRD-IO-009**：Map Shot 可对选择范围/分支生成独立高分辨率图像，支持背景、边框、圆角、阴影和 padding；输出范围必须来自 scene graph，不依赖当前视口截图。
- **PRD-IO-010**：P2 支持密码保护 `.xmind` 容器；加解密在 canonical JSON 外层完成，密钥、明文密码和派生中间值不得进入文档、日志或遥测。
- **PRD-IO-011**：P2 支持多个 `.xmind` 合并到同 Sheet 或不同 Sheet，执行资源去重、全局 ID 重映射和结构化降级报告。
- **PRD-IO-012**：Task CSV 使用 Topic ID 作为 Task ID、`/` 作为层级路径分隔符，并以 Topic ID + FS/SS/FF/SF 表示依赖；多人/多依赖使用 `, ` 分隔。ICS 只导出有开始日期的 Task，To-do 不进入 Task CSV/ICS。

## 15. ZEN、Pitch 与 Gantt

- **PRD-ZEN-001**：ZEN 隐藏常规 UI，支持 Light/Dark/Ultra Light/Ultra Dark，仍可通过快捷键编辑和按需打开格式面板。
- **PRD-PITCH-001**：Pitch 从主题层级生成演示步骤；主题可包含/排除；支持三类播放策略、比例、主题和布局；每张页面可独立调整图片位置/尺寸且不反写脑图排版。
- **PRD-PITCH-002**：支持窗口、全屏、Presenter View；Presenter View 同时显示当前页面、下一步和整图定位。
- **PRD-PITCH-003**：演示设置属于 Sheet 内容，可撤销并导出到 PDF/PPT。
- **PRD-GANTT-001**：Gantt 与 Task 使用同一数据；在任一视图修改日期、进度和依赖应实时反映另一视图。
- **PRD-GANTT-002**：依赖计算检测循环；工作日历、非工作日和时区处理确定一致。

## 16. 协作、评论与 AI 扩展

- **PRD-COLLAB-001**：协作同步 command/operation，而不是 React Flow 节点快照；同级顺序使用可合并的稳定 `orderKey`。
- **PRD-COLLAB-002**：显示协作者 presence、选区和视口；Follow Collaborator 只同步本地视图，不写内容。
- **PRD-COLLAB-003**：角色至少包含 Viewer、Editor、Owner；服务端和客户端都必须强制权限。
- **PRD-COMMENT-001**：评论可锚定画布坐标或元素；支持回复、@、解决/恢复、置顶、未读和排序。
- **PRD-VERSION-001**：版本历史保存内容版本与作者摘要；恢复创建新版本，不覆盖历史。
- **PRD-AI-001**：AI 对当前 Sheet/选中分支进行创建、扩展、改写、重组、合并重复、翻译和样式建议。
- **PRD-AI-002**：AI 先产生可预览 command patch；用户接受后作为一个撤销组提交，拒绝时零内容修改。
- **PRD-AI-003**：Discussion Mode 只读；AI 会话默认私有；只有 Editor 及以上可应用修改。
- **PRD-AI-004**：Web、链接和文件来源必须展示引用；敏感文件上传前取得明确授权。

## 17. 视觉、响应式与无障碍

- **PRD-VISUAL-001**：实施前在 Windows 100% DPI、1440×900 下建立至少 12 个 XMind 行为参考场景；视觉回归允许非品牌区域位置误差 ≤2 px、颜色差异按设计 token 审核。
- **PRD-VISUAL-002**：主题选择、编辑、拖拽、合法落点、非法落点、关系控制点、折叠和多选必须有互不混淆的视觉状态。
- **PRD-VISUAL-003**：动画 120–220 ms，并尊重 `prefers-reduced-motion`；布局切换不得造成不可追踪的瞬移。
- **PRD-RESP-001**：≥1024px 显示完整左右面板；768–1023px 面板抽屉化；<768px 使用触控工具栏和全屏编辑优先。
- **PRD-TOUCH-001**：单指选择/拖动主题，双指平移缩放，长按上下文菜单；不得依赖右键才能完成任何内容操作。
- **PRD-A11Y-001**：画布对辅助技术暴露 `tree/treeitem` 等价语义；播报层级、折叠、选中、Marker、任务状态。
- **PRD-A11Y-002**：所有命令可键盘触达；工具栏 roving tabindex；面板焦点顺序稳定；焦点不得在挂载时自动抢占正文。
- **PRD-A11Y-003**：文本/控件满足 WCAG 2.2 AA；非文本关系不能只靠颜色表达。
- **PRD-I18N-001**：中文、英文文本不写死在组件；CJK 字体回退、换行和标点禁则纳入布局测量。

## 18. 性能、可靠性与安全

| ID | 要求 |
|---|---|
| PRD-PERF-001 | 500 主题首次可交互 <1 s，1000 主题 <2 s（基准开发机、缓存字体）；5000 主题可浏览且无主线程长任务 >200 ms |
| PRD-PERF-002 | 拖拽、平移、缩放 p95 帧时 <16.7 ms；布局在 Worker 中执行并可取消 |
| PRD-PERF-003 | Store 使用细粒度 selector；选择一个主题不得重新序列化或重渲染整张图 |
| PRD-PERF-004 | 历史按命令/补丁保存并设内存上限，不保存 200 份完整大图快照 |
| PRD-RELIA-001 | 每次提交后运行增量不变量检查；开发/测试环境运行完整检查 |
| PRD-RELIA-002 | 自动保存有 revision/CAS；冲突进入可比较合并流程，不仅提示刷新 |
| PRD-RELIA-003 | 页面崩溃、Schema 校验失败或网络失败后可从本地草稿恢复 |
| PRD-SEC-001 | URL 使用 allowlist scheme；HTML/富文本严格清洗；附件按 MIME、大小和权限校验 |
| PRD-SEC-002 | 导入器不得执行宏、脚本、外链资源或任意路径；压缩包防 Zip Slip 和解压炸弹 |

## 19. 埋点与诊断

- **PRD-OBS-001**：记录命令类型、耗时、节点数量、布局耗时、迁移结果和错误码；不记录主题正文、Note、附件内容或 URL 参数。
- **PRD-OBS-002**：提供开发诊断面板：Schema 版本、revision、活动命令、选中 ID、布局状态、未解析引用、迁移警告。
- **PRD-OBS-003**：高风险操作（迁移、导入、批量删除、AI patch）生成本地可导出的诊断摘要，默认不上传内容。

## 20. 发布完成定义

### Core 完成

1. `DATA_SCHEMA.md` 中所有 Core 不变量均有单元测试；旧格式 fixtures 迁移通过。
2. `INTERACTION_ACCEPTANCE.md` 中所有 P0 项通过 Windows Chromium 自动化和人工体验验收。
3. 打开、拖动、关闭、重新打开不改变用户手工布局。
4. Relationship 不参与任何层级遍历；循环、多父级和孤立引用均有自动化阻断测试。
5. 撤销、剪贴板、只读和输入法没有阻断缺陷；Core 仅发布 Windows Chromium 桌面编辑路径。

### Desktop parity 完成

1. 官方 9 个结构家族、Grid 内置结构样式及混合结构、完整样式、全部语义元素通过 golden layout 与视觉回归。
2. Outliner、搜索过滤、多 Sheet、导入导出、ZEN/Pitch 通过 P1 验收。
3. 1000 主题性能基准达标；迁移、导入和导出经过模糊测试。
4. 暗色、打印、响应式与移动端触控 smoke 无阻断缺陷。

### Extended 完成

1. 协作收敛测试、权限测试、评论和版本恢复通过。
2. AI 修改全部通过 preview → accept → undo 流程；Discussion Mode 零内容事务。
3. Gantt 与 Task 双向一致且依赖无环。
