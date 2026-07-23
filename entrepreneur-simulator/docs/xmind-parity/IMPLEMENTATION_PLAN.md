# XMind 1:1 实施计划

## 1. 实施原则

1. **先修领域模型，再改 UI**：结构树、关系线、装饰元素和视图状态必须分离；否则继续加按钮只会放大误删和历史错乱。
2. **React Flow 仅作渲染适配器**：不能继续把 React Flow `nodes/edges` 当持久化真相。
3. **命令驱动**：创建、删除、拖拽、布局、样式、粘贴、迁移和 AI 修改统一走 command bus。
4. **渐进替换**：保留 Tiptap `mindMap` block 和旧数据读取，使用 `mindmapV2` feature flag 与双读迁移，不做一次性大爆炸替换。
5. **验收前置**：每阶段先补对应 fixture、测试和验收 ID，再实现功能。
6. **桌面核心先行**：P0 → P1 → P2；协作、Gantt、AI 不得反向污染 Core 数据模型。

## 2. 目标代码结构

```text
client/src/features/mindmap/
  domain/
    types.ts                 # 从 JSON Schema 生成/对齐的 TS 类型
    schema.ts                # Ajv 校验入口与错误归一化
    invariants.ts            # 无环、单父级、引用完整性等图不变量
    selectors.ts             # 主题树、可见树、元素和样式选择器
    orderKey.ts              # fractional order key
  commands/
    types.ts
    registry.ts
    reducer.ts
    history.ts
    topicCommands.ts
    elementCommands.ts
    styleCommands.ts
    sheetCommands.ts
  store/
    createMindMapStore.ts
    MindMapStoreProvider.tsx
    viewStateStore.ts
  migration/
    detectVersion.ts
    migrateV0ToV1.ts
    migrationReport.ts
  persistence/
    parse.ts
    serialize.ts
    tiptapBridge.ts
    clipboardCodec.ts
  layout/
    types.ts
    measure.ts
    worker.ts
    engine.ts
    structures/
      mindMap.ts
      logicChart.ts
      braceMap.ts
      treeChart.ts
      orgChart.ts
      timeline.ts
      fishbone.ts
      matrix.ts
      treeTable.ts
      grid.ts
  renderer/
    MindMapCanvas.tsx
    ReactFlowAdapter.tsx
    nodes/
    edges/
    overlays/
  interactions/
    activation.ts
    keyboard.ts
    selection.ts
    dragController.ts
    panZoom.ts
    contextMenu.ts
  editor/
    MindMapBlockView.tsx
    MindMapFullscreenEditor.tsx
    EditorShell.tsx
    toolbar/
    panels/
    sheetBar/
    statusBar/
  elements/
    relationship/
    boundary/
    summary/
    callout/
    zone/
  export/
    sceneGraph.ts
    xmind.ts
    svg.ts
    raster.ts
    pdf.ts
    markdown.ts
    opml.ts
    textBundle.ts
    office.ts
    taskCalendar.ts
  import/
    xmind.ts
    edrawMind.ts
    markdown.ts
    opml.ts
    textBundle.ts
    freemind.ts
    mindmanager.ts
    mindNode.ts
    docx.ts
  __tests__/

server/src/mindmap/
  assets/                      # 上传、哈希去重、权限、配额、清理
  drafts/                      # 崩溃草稿与恢复点
  persistence/                # revision/CAS、冲突响应和版本保护
  diagnostics/                # 脱敏诊断摘要，不记录正文
```

现有 [MindMapExtension.tsx](../../client/src/components/MindMapExtension.tsx) 在迁移期间只保留为 Tiptap NodeView 包装器，最终应缩减为解析属性、创建 store、渲染 `MindMapBlockView` 和回写事务四项职责。

## 3. 建议依赖与技术决策

| 决策 | 推荐 | 理由 | 引入阶段 |
|---|---|---|---|
| JSON Schema 校验 | `ajv` + `ajv-formats` | 机器 Schema、导入和迁移共用 | Phase 1 |
| 不可变命令补丁 | `immer` patches | 生成 forward/inverse patch，避免整图快照历史 | Phase 2 |
| 细粒度 Store | `zustand` 或自建 `useSyncExternalStore` | 选择变化不应重渲染/序列化整图 | Phase 2 |
| 稳定顺序 | `fractional-indexing` 或等价自研 | 重排与协作不需要重编号全部兄弟 | Phase 1 |
| 属性/模糊测试 | `fast-check` | 随机命令序列验证无环、撤销和迁移 | Phase 1 |
| 压缩包导入 | `fflate` | `.xmind`/压缩资源读取，体积小且可设解压限制 | Phase 9 |
| 协作 | `yjs`（P2） | 只在命令与 orderKey 稳定后接入 | Phase 12 |

布局不建议直接把 Dagre 或 ELK 结果作为产品语义。它们可辅助 Logic/Org 原型，但 Mind Map、Fishbone、Timeline、Matrix、Tree Table、Grid 和混合结构仍需专用、确定性的布局器。

## 4. 阶段总览

| Phase | 目标 | 依赖 | 退出标准 |
|---|---|---|---|
| 0 | 冻结基线和验收资产 | 无 | 规格、fixtures、参考图和风险清单齐全 |
| 1 | Schema、类型、不变量和 v0 迁移 | Phase 0 | 旧数据可无损迁移并通过机器校验 |
| 2 | Command store、历史和 Tiptap 桥 | Phase 1 | 所有核心修改统一可撤销，选择不触发保存 |
| 3 | 编辑器壳、激活、选择、视口 | Phase 2 | 标准选择/右键/滚动，无焦点劫持 |
| 4 | 主题树核心编辑 | Phase 3 | 键盘建图、拖拽换父级、重排、折叠完整 |
| 5 | 核心布局与测量 | Phase 4 | 保存位置不丢，4 种 Core 结构及混合结构稳定 |
| 5A | Core 硬化与首轮替换 rollout | Phase 0–5 | 全部 P0 通过，可安全替换现有 Windows Chromium 内核 |
| 6 | 官方 9 个结构家族、Grid 样式与格式系统 | Phase 5A | Desktop 结构和样式验收通过 |
| 7 | 关系/外框/概要/标注/Zone | Phase 4–6 | 元素模型独立、可编辑、可撤销、无误删 |
| 8 | Marker/目录/Note/媒体/Task | Phase 2、6 | 主题增强内容及许可素材目录完整持久化、管理与过滤 |
| 9 | 搜索、Outliner、多 Sheet、导入导出 | Phase 1–8 | P1 信息闭环与静态导出完整 |
| 10A | ZEN、Pitch（P1） | Phase 8–9 | Desktop parity 高级浏览/演示完成 |
| 10B | Gantt（P2） | Phase 8–9，可与 11 并行 | Task/Gantt 双向同步完成，不阻断 P1 |
| 11 | Desktop parity 硬化、全量 rollout、移除旧内核 | Phase 6–10A | P0/P1 全量验收、性能、A11y、打印达标 |
| 12 | 协作、评论、版本历史 | Phase 11 | 并发收敛和权限通过 |
| 13 | AI 命令补丁 | Phase 11/12 | preview/accept/undo 全链路稳定 |

## 5. Phase 0：冻结基线与测试资产

### 5.1 步骤

1. 建立 feature flag：`mindmapV2`，默认仅 EditorLab/开发用户开启。
2. 为 EditorLab 增加 `fixture=mindmap-v0`、`mindmap-v1-small`、`mindmap-v1-large`、`mindmap-elements`、`mindmap-mixed-structures`。
3. 固化七类旧数据：普通树、自由主题、手工位置、联系线、外框标题、概要、多父级/环损坏数据。
4. 在真实 XMind Windows 端建立 12 组参考场景：新建、50 节点键盘建图、拖拽换父级、折叠、双向图、混合结构、格式面板、Relationship、Boundary/Summary、Outliner、导出、ZEN/Pitch；同时导出完整快捷键表，锁定 Ctrl+A 等存在文档口径差异的行为。
5. 记录每个场景的窗口尺寸、DPI、缩放、字体、主题和操作视频；品牌素材仅用于内部参考，不进入仓库发布资源。
6. 将当前已知缺陷转成阻断测试：重新打开覆盖布局、联系误删、循环、外框标题丢失、双轨 undo、右键双击框选、只读假编辑。
7. 在 XMind 当前桌面版逐项采集 structure capability registry：全部 direction/variant/options；特别锁定 Timeline Horizontal/Vertical/Horizontal Off-Axis，以及 Matrix 列主题、Label 行头、无/多/同名 Label、嵌套 Matrix 的编辑与 `.xmind` 往返映射。
8. 冻结 `V1_DEFAULTS` 及 deterministic migration UUID 语料；同一旧 payload 在不同时区、语言和运行时间下必须生成规范化等价 V1。
9. 生成机器可读 `traceability.json`：每个完整 PRD ID 显式列出 priority、owner Phase 与一个或多个完整 ACC ID；分组表只用于阅读，不可替代逐 ID 门禁。
10. 执行 `IMP-CATALOG-001`：在 XMind 26.04.01341 Windows 中冻结 Sticker/Illustration 的近 500/13+ 分类、搜索、Insert/Marker 双入口、拖放/四向调整，以及 custom Marker PNG/JPG/SVG/`.xrb` 导入和 Select 批量管理录屏；记录语言、DPI、授权态、分类表、golden SHA-256 与 [目录盘点](./XMIND_26_04_CATALOG_INVENTORY.md)，参考素材不得进入发行包。

### 5.2 测试落点

- `client/src/pages/EditorLab.tsx`：新增独立脑图 fixture 路由，不污染普通文档 fixture。
- `client/e2e/mindmap.*.spec.ts`：按 keyboard、drag、history、readonly、visual 拆文件。
- `client/e2e/...snapshots`：桌面/移动、浅色/深色、embedded/fullscreen 四组基线。

### 5.3 退出标准

- 所有现有缺陷至少有一个失败测试或明确的静态断言。
- 测试可在无后端模式打开脑图并执行交互。
- 参考场景与需求 ID、ACC ID 建立映射。

## 6. Phase 1：Schema、领域类型和迁移

### 6.1 步骤

1. 以 [mindmap.schema.json](./mindmap.schema.json) 为唯一机器 Schema；通过构建脚本生成或校验 `domain/types.ts`。
2. 实现 `parseMindMapDocument(raw)`：受限 JSON parse → envelope/version 探测 → legacy/V0 validator → migrate → V1 JSON Schema → 引用/图不变量；未来 reader version 只读拒绝，所有错误归一化并保留原 payload。
3. 实现结构树 API：`getParent`、`getChildrenSorted`、`getAncestors`、`getDescendants`、`wouldCreateCycle`；只能读取 `treeEdges`。
4. 实现引用选择器：Relationship、Boundary、Summary、Callout、Zone 独立查询；任何选择器不得把它们返回为 tree edge。
5. 实现 v0 迁移：过滤 preview edge；分离 `data.kind=link`；推断根和父级；修复多父/环；从坐标生成稳定顺序和 side；保留手工位置；迁移 bold、外框、概要。
6. 生成 `MigrationReport`：`info/warning/error`、原 ID、新 ID、修复动作；错误文档保留原始副本。
7. 实现 `assertMindMapInvariants` 和开发态诊断面板。
8. 增加版本注册器 `migrations['legacy-0.x->schema-1']`，禁止在 UI 中散落版本判断；规格包 SemVer `1.0.0` 与存储整数 `schemaVersion: 1` 是两套明确标识。
9. 落地 `V1_DEFAULTS` 的 new-v1/legacy-v0 两套构造器；逐项 snapshot 新建 Document/Sheet/Topic/Equation/Todo/Task/Deck，并验证不同时区、语言、运行时间输出规范化等价。

### 6.2 测试

- JSON Schema 正/反 fixtures。
- 多父、环、孤儿、重复 orderKey、坏资源引用、坏范围、跨 Sheet 错链测试。
- v0 迁移 snapshot；连续迁移幂等性：`migrate(migrate(v0)) === migrate(v0)`。
- property-based：随机迁移后每 Sheet 恰有一个 Central Topic，TreeEdge 构成允许 Floating/Summary 根存在的无环森林，每个普通主题最多一个入 tree edge。

### 6.3 退出标准

- 当前合法脑图 100% 迁移；无法确定的边降级为 Relationship 并报告，不静默删除。
- `treeEdges` 与 `relationships` 代码路径有独立类型，不能互相传参。
- 保存 v1 前必须通过 Schema 和完整不变量检查。

## 7. Phase 2：Command store、历史与 Tiptap 桥

### 7.1 步骤

1. 定义 `MindMapCommand` envelope：commandId、type、sheetId、payload、baseRevision、groupId、origin、timestamp。
2. 命令注册器集中声明 validate/apply/invert/mergePolicy；UI 只 dispatch 命令。
3. 使用 patch/inverse patch 保存历史；设置按字节的内存预算和检查点，不再保存 200 份整图。
4. 建立 canonical 外部的短期 tombstone/operation store，用于协作晚到操作去重和恢复；不得把 tombstone 集合塞进普通文档 JSON 或导出。
5. 区分 `contentStore` 与 `viewStateStore`；selection、hover、临时 viewport、工具预览不进入文档 JSON。另设显式 `view.create` 命令，把用户主动保存的 viewport/focus/fold/filter 首次写为 `SavedView`，后续修改使用 `view.update`；不得把每次平移缩放误当内容修改。
6. 文本输入按 edit session 合并；拖拽从 pointerdown 到 pointerup 合并为一个命令。
7. 实现 Tiptap bridge：每个命令组只触发一个 node attribute transaction；外层 undo 通过 bridge 调用相同 inverse，不建立第二套脑图历史。
8. 200–500 ms debounce 只序列化 content revision；选择变化不回写属性。
9. 处理外部属性变化：文档 undo、协作更新或版本恢复时，store 可重放/替换而不是只读取首次 initialData。

### 7.2 退出标准

- 创建、编辑、删除、拖拽、布局、格式和粘贴全部可逐步 undo/redo。
- embedded ↔ fullscreen 切换不丢历史。
- 连续选择/平移 100 次不产生 Tiptap 内容事务和保存请求。
- 只读 store 从类型和运行时同时拒绝内容命令。

## 8. Phase 3：编辑器壳、激活、选择和视口

### 8.1 步骤

1. 新建 `MindMapBlockView`，实现 Preview/Active/Read Only 状态机；移除挂载自动 focus 和自动选择。
2. 新建 `EditorShell`，搭建工具栏、左右面板插槽、Sheet Bar、状态栏；面板先可为空但布局稳定。
3. 实现标准左键框选、Ctrl/Shift 多选、右键选择和上下文菜单；删除旧右键两阶段框选。
4. 统一命中测试，使用真实 bounds 和元素 z-order，不使用固定 150×50。
5. 实现 pan/zoom 控制器及 embedded 滚动边界；加入 activation overlay 与 Esc 退出。
6. 实现 roving focus、方向导航和辅助技术 tree projection。
7. 添加桌面、触控和 reduced motion 适配。

### 8.2 退出标准

- `ACC-SEL-001~008`、`ACC-MSE-001~005/009/014/016`、`ACC-NAV-001~004` 与 shell/selection 范围的 `ACC-A11Y-001~003/007/010/011` 全过；不得用尚不存在的编辑/布局入口假通过只读、live region 或 reduced-motion 用例，也不得提前拉入 Phase 7 的语义元素选择、Phase 8 的 Marker/Task 或 Phase 9 的 Outliner。
- 进入含多个脑图的长文档不会抢正文焦点。
- 任何选择手势均不改变内容 revision。

## 9. Phase 4：主题树核心编辑

### 9.1 步骤

1. 实现 Topic/Subtopic/Parent/Floating 创建命令；ID 和 orderKey 在命令层生成。
2. 实现直接输入替换、Space/双击编辑、IME、多行、Enter 提交、Shift+Enter 换行、Esc 取消。
3. 实现 Delete Branch 与 Delete Single Topic 两类命令；删除先规范化顶层选择。
4. 实现拖拽状态机：开始快照 → 计算候选 → 可视落点 → 无环校验 → 单命令提交。
5. 实现同级重排、换父级、主树/Floating 转换和左右 side。
6. 实现折叠、展开、隐藏数量、全部折叠和只显示分支。
7. 实现系统剪贴板多 MIME；跨块粘贴 ID、资源、样式和关系重映射。
8. 实现 command registry 快捷键和可搜索设置页。

### 9.2 退出标准

- Core fixture 范围的 `ACC-TOP-*`、`ACC-KBD-001~020`、`ACC-MSE-006~011/013`、`ACC-NAV-005`、`ACC-CLIP-001/002/004/005`、`ACC-SEC-001~004`、`ACC-A11Y-005/012` 全过；Relationship 快捷键 `ACC-KBD-021` 与 Link 快捷键 `ACC-KBD-022` 分别留到 Phase 7/8。
- 仅键盘可完成 50 节点建图、重排、编辑、折叠和删除。
- 随机 10,000 次主题命令后树仍无环、单父级，undo 到初始状态字节等价。
- 普通节点可以拖拽换父级；非法落点始终被拒绝且不产生历史。

## 10. Phase 5：测量、Core 布局与位置保留

### 10.1 步骤

1. 建立字体加载与真实文本测量层；缓存测量 key：文本/marks/width/font/locale。
2. 定义 layout input/output 与 Web Worker 协议；布局可取消，旧结果不得覆盖新 revision。
3. 实现经典双向 Mind Map、Logic Chart、Tree Chart、Org Chart 四种 Core 结构。
4. 实现结构递归：每个 Topic 的 outgoing branch 可选择独立结构，布局器组合局部 bounds。
5. 分离 auto position、manual offset、floating absolute position；加载时绝不无条件自动布局。
6. 实现 Compact、Justify、Auto Balance、智能参考线和手工 offset。
7. 建立 golden layout fixtures：坐标、bounds、端点、折叠和混合结构快照。

### 10.2 退出标准

- 手工拖动 → 保存 → 关闭 → 打开坐标不变。
- 相同输入跨重复运行坐标确定一致。
- 1000 主题布局 <2 s 且不阻塞输入；旧 Worker 结果正确取消。
- Core 结构视觉参考场景达到评审容差。

### 10.3 Phase 5A：Core 硬化与首轮替换 rollout

1. 冻结 Phase 0–5 的 Schema/migration/command/layout 接口，运行全部 P0 自动化、迁移语料、Windows Chromium E2E 和 1000 主题基准。
2. 用只读 fixture 验证既有 P1/P2 扩展实体经过 Core 复制、删除、保存与重载不会丢字段；不开放这些功能的专用编辑入口。
3. 按 EditorLab → 内部新建 → 内部旧文档迁移 → 1% → 10% → 50% → 100% 启用 `mindmapV2`；每级观察保存失败、迁移告警、崩溃恢复和回滚指标。
4. 保留旧 payload 与一键回退，V2 写回前做 schema/invariant 校验；任何静默丢失、关系误删、只读写入或 P0 回归立即停止放量。

退出标准：全部 P0 100% 通过，现有功能可在 Windows Chromium 安全替换；Phase 6–10A 继续在同一内核上增量交付，不重新建 store/layout。

## 11. Phase 6：完整结构与样式系统

### 11.1 步骤

1. 按独立插件实现 Brace、Timeline、Fishbone、Matrix、Tree Table、Grid。
2. 完成所有方向/变体和混合结构边界规则。
3. 实现 Style Resolver：built-in/Skeleton → Theme tokens/defaults → ThemeRule（specificity + orderKey）→ named Style inheritance → entity override。
4. 完成 Topic、Branch、Map、文字富文本格式；支持多选混合值。
5. 实现 Smart Color、全局字体、背景、彩色分支、自有 Skeleton catalog。
6. 实现 Copy/Paste/Reset/Update Style 和编号。
7. 建立 style visual matrix，覆盖官方 9 个结构家族 + Grid 内置样式 × 关键主题层级 × 浅/深色 × CJK/Latin。
8. 实现 Theme、ThemeRule、StyleDefinition CRUD；活动 Theme/被引用 Style 删除必须选择 replacement 或 materialize overrides，并覆盖全引用修复、撤销和重载。

### 11.2 退出标准

- 官方 9 个结构家族、Grid 内置样式及同图混合通过 golden layout。
- 样式继承无循环；Reset 可恢复主题默认；批量更新可一次撤销。
- 主题内局部富文本在保存、复制、导出和重新打开后保持。
- Core/P1 样式与结构动画满足 `ACC-A11Y-006/008` 的对比度和 reduced-motion 合同。

## 12. Phase 7：语义元素

按顺序实施 Relationship → Boundary → Summary → Callout → Zone，每个元素都执行相同模板：

1. Schema 与 invariant；
2. create/update/delete command；
3. renderer 与命中测试；
4. control handles 与拖拽；
5. format panel；
6. clipboard、undo、迁移、导出；
7. A11y 名称和键盘操作；
8. 单元、E2E、visual tests。

特别门禁：

- Relationship 不能出现在任何 `getChildren/getDescendants/deleteSubtree` 调用中。
- Boundary/Summary 的 sibling range 必须可随顺序变化重算，跨分支自动拆分。
- Summary 按以下垂直切片交付：① selection preview 与 parent/resolved-side/slot 连续分组；② planner 预分配每组 Summary/result ID 并原子创建；③ bracket/connector 四向渲染、选择与宽命中层；④ start/end 拖柄按真实落点调整最近合法兄弟，一次 pointerup 一个历史项；⑤ result Topic 编辑、Tab 子主题与完整子树外向布局；⑥ orientation 与线色/粗细/虚线属性；⑦ reorder/reparent/delete-current/delete-subtree 的 0/1/N scopeChanges 与 result 子树克隆；⑧ clipboard、XMind position 导入、静态 SVG、只读、undo/redo/save/reload 回归。
- Summary 垂直切片每一层都先通过 domain/planner 单测，再通过 projection/overlay/UI 测试，最后执行真实页面 E2E；禁止只渲染括号而没有 canonical 范围命令，或只创建 result Topic 而没有结构归一化。
- Local Image 按独立垂直切片交付：① 安全上传返回 Asset manifest（原文件名、MIME、byteSize、sha256、intrinsicSize 与非持久临时状态）；② planner 预分配 Asset/Image ID 并原子创建；③ 节点按图片实测尺寸参与布局并实际渲染；④ Insert 与拖放入口；⑤ top/bottom、缩放、Reset Size、Delete/右键 Delete canonical 命令；⑥ undo/redo、只读、复制、保存/重载、静态导出和 XMind 导入导出回归。Local Image 完成后复用 Asset 管线交付 Sticker/Illustration 四向位置，再交付生成独立子 Topic 的 Attachment；三者不得共用含混的“资源 badge 即完成”验收。
- 删除锚点、范围成员、Summary/result 与 Zone 时必须逐项执行 `DATA_SCHEMA.md` 级联表；拆分 ID 由 command payload 预分配，并通过 delete → undo/redo → reload 回归。
- 外框标题必须进入 Schema、历史和序列化回归。
- Zone Remove 与 Clear Content 必须是不同命令和确认文案。

退出标准：`ACC-SEL-009`、`ACC-MSE-012/015`、`ACC-KBD-021`、`ACC-LAY-012`、`ACC-SEM-001~013/023~027/034/035/039`、`ACC-CLIP-003` 与 `ACC-PER-003` 全过；每类元素的 delete → undo/redo → save/reload 均无悬空引用或树遍历污染。

## 13. Phase 8：主题增强、Task 与资源

1. 实现 Asset registry 与服务端资源 API；canonical 只存 `sha256`、metadata 与 `source.embedded.relativePath / source.managed.objectKey / source.remote.url` 三类来源。服务端同时实现 MIME/大小/权限/配额、哈希去重、孤儿清理和审计。
2. 按 Marker/Legend → Label → Note → Link → Image/Sticker → Attachment → Equation → Audio Note → To-do → Task 顺序实施；Link 覆盖 Windows 本地文件/文件夹平台差异，内部目标删除时进入显式 `broken` 状态；Attachment 与 Audio Note 插入均原子创建新子主题，Audio Note 主题禁用 Link。
3. 每类增强实现主题 badge、编辑器、导航过滤、复制、导出和只读预览。
4. To-do 实现多选批量应用/移除/完成、父主题汇总进度与“一次完成全部子项”；Task 增加 displayFields/creator、Unknown Actor fallback、Skip Non-Working Days、IANA 时区、工作周、Working Day/Day Off 例外与 dependency DAG，依赖循环在命令校验阶段拒绝。
5. 富文本和 URL 统一走现有/增强后的 sanitize 层；附件做 MIME、大小、权限和病毒扫描接口预留。
6. `IMP-CATALOG-002`：把 Sticker/Illustration 做成独立 versioned release manifest；稳定 category/item ID、tombstone/alias、kind、tags、精确源版本/SPDX/notice、byteSize/SHA-256/intrinsicSize 与 source/manifest 指纹全部由确定性生成器和 fail-closed validator 管理。catalog v1 的冻结门禁为 Lucide ISC 468 项/13 类/39 Illustration，不能表述为 XMind 商业素材逐图同款。
7. `IMP-CATALOG-003~005`：Insert 与 Marker 双入口复用同一目录 store；面板实现 category/kind/search/结果数/loading-empty-error、≤80 卡 DOM 的虚拟化、可见区图片解码、键盘 grid/读屏播报/焦点恢复。查询内核固定 NFKC、多 token AND 与 manifest 稳定顺序；点击和受控 MIME 拖放共用 planner，busy/read-only/非法 drop 为零事务。
8. `IMP-CATALOG-006~007`：自定义 Marker ingest 先在临时区完成 PNG/JPG/SVG magic/尺寸/配额、SVG 清洗及 `.xrb` ZIP 安全解析，显示逐项预览/诊断后再原子生成 Asset-backed Definition；禁止路径穿越、脚本、外链、加密/ZIP64、解压炸弹和静默部分成功。
9. `IMP-CATALOG-008`：实现 Marker Select 面板临时态和批量 Move/Delete；目标去重、顺序确定，Move 保持 Definition ID/Instance/Legend 引用，Delete 显示影响计数，builtin 永不可删除，两者均一个 transaction、一次 undo。
10. `IMP-CATALOG-009`：内置 Marker、custom/asset Marker 与 Sticker 分别建立 XMind 26.04 native/fallback registry；只有真实 golden 打开→编辑→保存→再导入通过才升级 `native-verified`。未经验证继续 `canonical-fallback-only` 并在导出报告逐项诊断，绝不把 Sticker 冒充普通 Local Image 或把 custom Marker 冒充 builtin。
11. `IMP-CATALOG-010`：把 `ACC-CAT-001~018`、目录 validator、离线 468 项 E2E、性能/A11y、许可证扫描和 XMind golden matrix 纳入 CI/release evidence；目录盘点随 catalog/XMind 版本更新。

退出标准：`ACC-KBD-022`、`ACC-SEM-014~019/028/033/036/037`、`ACC-CAT-001~018` 与 Marker/Task 范围的 `ACC-A11Y-009` 通过；资源引用无孤儿、删除策略可恢复、跨块复制资源正确去重，主题增强数据在所有视图一致；目录声明明确区分许可纵切、NMDD native 与 XMind native/fallback。

## 14. Phase 9：搜索、Outliner、Sheet 与 I/O

### 14.1 搜索/视图

1. 建立增量搜索索引，索引 Topic、Note、Label、Marker、To-do、Task；内容变化增量更新。
2. 实现导航面板、替换、过滤/淡化和跳转。
3. Outliner 复用 command bus；拖拽、折叠、编辑与 Mind Map 双向同步。
4. 实现 Sheet CRUD、排序、分支转 Sheet、跨 Sheet link。
5. 实现 SavedView create/update/reorder/apply/setDefault/delete；同 Sheet orderKey 稳定，删除默认视图原子清除指针。

### 14.2 导入导出

1. 导入器统一输出 `{document, report}`；先实现 Markdown/OPML/TextBundle，再实现 `.xmind`、FreeMind、MindManager、MindNode、EdrawMind，最后实现 Word DOCX；全部共享安全解析、outline projection、资源导入和降级报告，不各自直接写 UI 模型。
2. 构建独立 scene graph；SVG、PNG、PDF 不依赖当前 DOM 视口。
3. 实现 `.xmind` 写出与 XMind 26.04 往返语料；不支持字段必须进入结构化降级报告。
4. 实现当前分支/Sheet/全部 Sheet 范围、透明背景、倍率、padding、frame。
5. 实现 TextBundle、Word、PowerPoint、Excel 与 Task CSV/ICS 适配器；共享同一 normalized outline/task projection，禁止每种格式各自读取 React Flow。
6. 为 Task CSV/ICS 建 golden export：Topic ID、`/` 路径、FS/SS/FF/SF 依赖、多值分隔符与“ICS 仅含有 startDate 的 Task、排除 To-do”逐字段断言。
7. Map Shot 复用 scene graph，对选择范围生成可配置背景、边框、圆角、阴影与 padding 的高分辨率输出。
8. HTML 文档导出生成静态 SVG fallback；打印按完整 bounds 分页。
9. P2 子流实现密码 ZIP 容器与多 `.xmind` 合并；加密包裹在 canonical JSON 外层，合并先完成资源去重和全量 ID 重映射。
10. 对所有格式建立 round-trip 与降级报告测试。

退出标准：P1 搜索、Outliner、Sheet、IO 验收全部通过；导出完整图而非 500px 当前视口。

## 15. Phase 10A–10B：ZEN/Pitch 与 Gantt

### 15.1 Phase 10A：ZEN、Pitch（P1）

1. ZEN 只切换 shell 和主题，不复制 editor/store。
2. Pitch 从该 Sheet 唯一的 canonical `PresentationDeck.settings/slides` 与 Topic 层级编译只读 playback steps，独立 presenter route；重复 Deck 在语义校验阶段拒绝；三种 delivery、include/exclude、layout、转场及 Slide.imageOverrides 均走内容命令且可撤销。
3. PPT/PDF 导出复用 Pitch scene model。

退出标准：`ACC-NAV-014/015` 与 `ACC-SEM-021/029~032/038` 全过；播放、PDF、PPT 使用同一 canonical slides 顺序，退出不改变编辑器内容或 ViewState。

### 15.2 Phase 10B：Gantt（P2，可与 Phase 11 并行）

1. Gantt 复用 Task/Dependency；时间轴视图 dispatch 相同 Task 命令。
2. 工作日历、时区和依赖调度使用纯函数并做 DST/跨时区测试。
3. Phase 10B 不得成为 Desktop P1 发布依赖；但其 Schema 必须继续通过 P0/P1 不变量。

## 16. Phase 11：硬化与渐进发布

### 16.1 质量门禁

- 实现服务端 revision/CAS 与过期响应拒绝、本地崩溃草稿恢复、Schema 版本写保护和可回滚迁移备份。
- 完成脱敏遥测与可导出的诊断摘要；不得记录 Topic/Note/附件正文、密钥或签名 URL。
- `typecheck`、build、unit、E2E、visual、axe、schema、migration、performance 全部纳入 CI。
- Domain/commands/layout/migration 行覆盖率 ≥95%，分支覆盖率 ≥90%。
- P0/P1 checklist 100% 通过；零未处置高风险数据缺陷。
- 500/1000/5000 主题基准纳入回归阈值。
- Chromium Windows 首发；Firefox/WebKit 完成兼容烟测；移动视口完成触控和视觉验收。

### 16.2 Rollout

1. EditorLab only；
2. 内部新建脑图默认 v2，旧脑图只读迁移预览；
3. 小比例用户自动迁移，保留 v0 原始副本与一键回退；
4. 全量新建 v2，旧脑图按打开迁移；
5. 观察期后停止写 v0，但永久保留 v0 reader；
6. 删除旧 `MindMapInner` 核心逻辑，只保留兼容 adapter。

### 16.3 回退条件

- 任何静默数据丢失、误删、无法打开、只读写入、迁移不可逆；
- 保存失败率或崩溃率显著上升；
- 1000 主题关键交互超过性能预算两倍。

## 17. Phase 12–13：协作和 AI

### 17.1 协作

1. 把 command 转换为可合并 operation；orderKey 使用 LSEQ/fractional 语义。
2. 引入 Yjs 文档适配器，先做 topics/treeEdges，再做元素、样式、资源和 Sheet。
3. 实现 presence、selection、viewport 和 follow；它们进入 awareness，不进入内容历史。
4. 服务端强制 Viewer/Editor/Owner；客户端禁用只作体验，不是安全边界。
5. 建立两端、三端乱序/离线/重连收敛测试和版本恢复。

### 17.2 AI

1. AI 只输出 schema-validated command patch；禁止直接改 React 状态或 JSON。
2. 执行 dry-run invariant、权限和影响范围分析。
3. 展示 diff/预览；用户 Accept 后按一个 groupId 提交；Reject 零事务。
4. Accept 后可以一次 undo；协作环境中 AI patch 标记作者和来源。
5. Discussion Mode 使用只读快照；Web/文件来源带引用和上传授权。

## 18. PRD → Phase → ACC 追踪矩阵

下表是最低覆盖关系。具体测试名称必须使用完整 `ACC-*` ID；每个 Pull Request 还必须填写它实际影响的完整 `PRD-*` ID，不能只写前缀。

| 产品需求 | 主实施阶段 | 强制验收组 |
|---|---|---|
| `PRD-GOAL-*`、`PRD-METRIC-*`、`PRD-NONGOAL-*` | 0、11 | 全部 P0/P1 与发布门禁 |
| `PRD-MODE-*`、`PRD-SHELL-*`、`PRD-CANVAS-*`、`PRD-SELECT-*` | 3–4、7、11 | `ACC-SEL-001~008`、`ACC-MSE-001~005/009/014/016`、`ACC-NAV-001~004`；触控在 3–4/11，语义元素选择 `ACC-SEL-009/ACC-MSE-015` 在 7 |
| `PRD-TOPIC-*`、`PRD-HIER-*`、`PRD-KEY-001~012/014/015` | 2–4 | `ACC-TOP-*`、`ACC-KBD-001~018`、`ACC-MSE-006~011/013/014/016` |
| `PRD-KEY-013` | 9 | `ACC-NAV-006/007` |
| `PRD-KEY-016~018` | 3–4 | `ACC-SEL-008`、`ACC-KBD-011/015/019/020` |
| `PRD-KEY-019` | 7 | `ACC-KBD-021`、`ACC-SEM-001~007/023` |
| `PRD-KEY-020` | 8 | `ACC-KBD-022`、`ACC-SEM-016/037` |
| `PRD-STRUCT-*`、`PRD-LAYOUT-*` | 5–6 | `ACC-LAY-*`、相关 `ACC-PERF-*` |
| `PRD-STYLE-*`、`PRD-VISUAL-*` | 6、11 | `ACC-STY-*`、视觉快照门禁 |
| `PRD-REL-*`、`PRD-BOUND-*`、`PRD-SUM-*`、`PRD-CALLOUT-*`、`PRD-ZONE-*` | 7 | `ACC-SEM-001~013/022~027/034/035/039`、`ACC-PER-003` |
| `PRD-ENRICH-*` | 8 | `ACC-SEM-014~019/022/028/033/036/037`、`ACC-NAV-006/008` |
| `PRD-CATALOG-001` | 0、11 | `ACC-CAT-001/016` |
| `PRD-CATALOG-002` | 8、11 | `ACC-CAT-002/018` |
| `PRD-CATALOG-003` | 8、11 | `ACC-CAT-004/006/010/011` |
| `PRD-CATALOG-004` | 8、11 | `ACC-CAT-005/006` |
| `PRD-CATALOG-005` | 8、11 | `ACC-CAT-007/008` |
| `PRD-CATALOG-006` | 8、11 | `ACC-CAT-009/011` |
| `PRD-CATALOG-007` | 8、11 | `ACC-CAT-003/018` |
| `PRD-CATALOG-008` | 9、11 | `ACC-CAT-016` |
| `PRD-CATALOG-009` | 8、9、11 | `ACC-CAT-012/013/016` |
| `PRD-CATALOG-010` | 8、11 | `ACC-CAT-014/015` |
| `PRD-CATALOG-011` | 8、9、11 | `ACC-CAT-017` |
| `PRD-CATALOG-012` | 8、11 | `ACC-CAT-001/002/003/018` |
| `PRD-VIEW-*`、`PRD-SHEET-*` | 9 | `ACC-NAV-*`、`ACC-PER-009/013` |
| `PRD-HISTORY-*`、`PRD-CLIP-*`、`PRD-PERSIST-*` | 1–4、11 | `ACC-HIS-*`、`ACC-CLIP-*`、`ACC-PER-*` |
| `PRD-IO-*` | 9、11 | `ACC-IO-*`、`ACC-SEC-005~012` |
| `PRD-ZEN-*`、`PRD-PITCH-*` | 10A | `ACC-NAV-014/015`、`ACC-SEM-021/029~032/038` |
| `PRD-GANTT-*` | 10B | `ACC-SEM-020` 及 Task round-trip |
| `PRD-RESP-*`、`PRD-TOUCH-*`、`PRD-A11Y-*`、`PRD-I18N-*` | 3–11 | `ACC-TCH-*`、`ACC-A11Y-*`、CJK/RTL 视觉与输入用例 |
| `PRD-PERF-*`、`PRD-RELIA-*`、`PRD-SEC-*`、`PRD-OBS-*` | 1–11 | `ACC-PERF-*`、`ACC-PER-*`、`ACC-SEC-*` |
| `PRD-COLLAB-*`、`PRD-COMMENT-*`、`PRD-VERSION-*` | 12 | `ACC-COL-*` |
| `PRD-AI-*` | 13 | `ACC-AI-*` |

追踪门禁：CI 解析所有文档中的稳定 ID，并校验 `traceability.json` 的每个完整 PRD ID；重复/孤立 PRD、未知 ACC、priority 与 ACC 冲突、owner Phase 越界，或 P0 没有自动化测试时直接失败。PRD priority 取其映射验收中的最高级（P0 > P1 > P2）；若产品明确标为更高等级则取更高者。

## 19. 每个 Pull Request 的完成模板

- [ ] 关联 PRD ID、ACC ID 和 Phase 任务。
- [ ] Schema/命令/不变量是否受影响；若是，已更新 Schema 与迁移。
- [ ] 新行为有 unit + E2E；视觉变化有 snapshot。
- [ ] undo/redo、clipboard、read-only、重新打开均已覆盖。
- [ ] 选择/视口变化不产生内容 transaction。
- [ ] 关系线未进入树算法。
- [ ] light/dark、desktop/mobile、IME、keyboard、axe 已检查。
- [ ] 性能预算未回退；大图操作没有整图不必要重渲染。
- [ ] 未修改或删除用户旧数据；迁移有报告和回退路径。

## 20. 推荐的首批实现切片

第一批不要做“右侧格式面板”或“更多图标”，而应按以下顺序交付：

1. Schema v1 + v0 migrator + invariants；
2. command/history/store + Tiptap 单事务桥；
3. standard selection/context menu + 不抢焦点；
4. Enter/Tab/Ctrl+Enter/多行文本；
5. drag reorder/reparent + cycle guard；
6. fold + branch focus；
7. position preservation + classic two-sided Mind Map；
8. Relationship 独立化与误删回归；
9. system clipboard；
10. EditorLab 脑图全套测试。

完成这十项后，当前体验才从“React Flow 树图原型”升级为可持续扩展的脑图内核；此后再实施样式、官方 9 个结构家族、Grid 内置样式和高级元素。
