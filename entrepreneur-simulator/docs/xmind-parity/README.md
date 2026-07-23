# XMind 1:1 规格包

> 状态：规格基线已建立；代码实施与验收证据补齐中（尚未达到 XMind 1:1 发布标准）  
> 基线日期：2026-07-18  
> 对标版本：XMind Desktop 26.04.01341（桌面核心）；Web 协作、版本历史与新版 AI 作为扩展范围单列  
> 适用代码：`client/src/features/mindmap`、`client/src/components/MindMapExtension.tsx`、`TiptapExtensions.tsx` 中的 `mindMap` 原子块、`TiptapEditor.tsx` 持久化链路及 `EditorLab.tsx` 测试入口

## 目的

本规格包把“做得像 XMind”转换成可实现、可测试、可迁移的工程合同。这里的“1:1”指：

1. 核心建图行为、布局语义、编辑反馈和信息架构达到行为等价；
2. 相同输入和操作能产生等价的层级、结构、样式与导出结果；
3. Windows 端默认快捷键及鼠标操作尽量一致，macOS 使用平台等价修饰键；
4. 文档内嵌态允许为避免与正文滚动冲突而增加“激活”边界，但激活后的编辑器与全屏态使用同一内核；
5. 不复制 XMind 商标、品牌名称、受保护插画、贴纸素材或专有模板内容，使用自有视觉资产实现等价能力。

## 文档索引

- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)：产品范围、信息架构、功能需求、非功能需求与完成定义。
- [DATA_SCHEMA.md](./DATA_SCHEMA.md)：规范化领域模型、引用关系、不变量、命令模型和旧数据迁移方案。
- [mindmap.schema.json](./mindmap.schema.json)：JSON Schema 2020-12 机器校验文件。
- [INTERACTION_ACCEPTANCE.md](./INTERACTION_ACCEPTANCE.md)：逐项交互验收清单，包含前置条件、操作和预期结果。
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)：按依赖排序的实施阶段、代码落点、退出标准、风险和测试门禁。
- [XMIND_26_04_CATALOG_INVENTORY.md](./XMIND_26_04_CATALOG_INVENTORY.md)：XMind 26.04 Marker/Sticker/Illustration 官方行为、当前 468 项许可纵切、native/fallback 状态与目录专项任务。

## 规格追踪与自动化证据

`traceability.json` 证明的是 211 条 PRD、实施 Phase 与 300 条 ACC 之间的**规格结构映射完整**；它不证明功能已经实现，也不证明任何测试已经执行或通过。不得把 `300 ACC` 的规格统计表述为 `300 项交互已通过`。其中 `PRD-CATALOG-001~012` 与 `ACC-CAT-001~018` 专门约束 Marker/Sticker/Illustration 目录；“468 项/13 类/39 Illustration”只代表当前 Lucide ISC 许可纵切，绝不代表 XMind 商业素材逐图同款或 XMind native 已验证。

自动化源码证据分为两级：

1. **Referenced**：测试标题、断言或注释中普通出现的 `ACC-*`。它只说明测试与该合同有关，允许是子集回归，不能用于发布放行。
2. **Release-qualified**：测试源码中的独立注释行 `// @covers ACC-XXX-001`；一行可以列出多个完整 ACC ID。添加者必须确认同一测试文件中的测试组合覆盖该 ACC 的全部前置条件、操作和预期结果。测试标题、字符串中的 `@covers`、单主题/单分支子集测试都不合格。

例如：

```ts
// @covers ACC-TOP-001 ACC-KBD-001
```

未知的普通 ACC 引用、未知的 `@covers` ID，以及不含完整三位编号 ID 的 `@covers` 声明都会使校验失败。即使存在 `@covers`，它仍只是完整覆盖声明；发布时还必须实际执行并通过对应测试。

- `npm run validate:mindmap:traceability`：校验规格结构，同时分别报告 MindMap unit/E2E 测试源码中的 Referenced 与 Release-qualified 覆盖；非法引用会失败，历史缺证据仅如实报告，不阻断默认 CI。
- `npm run validate:mindmap:release-evidence`：严格发布证据门禁；任一 P0 ACC 没有 `@covers` 完整覆盖声明即失败，普通 ACC 提及不计入门禁。该命令不会代替测试执行。
- `npm run test:mindmap:traceability`：运行追踪校验器自身的回归测试。
- `npm run test:mindmap` 与 `npm run test:mindmap:e2e`：分别执行功能 unit/integration 与浏览器 E2E。只有证据标注完整且对应测试实际通过，才可用于发布结论。

当前实现仍在补齐功能与证据，实际覆盖数量以校验命令的即时输出为准。`ACC-IO-020` 现由跨层集成测试完整覆盖：全字段 canonical fixture 经真实 Tiptap `mindMap` 节点、共享 Markdown 私有 fence、Fastify HTTP 路由、`dbService` 与内存 Supabase 存储行保存，再由 API 重载并解析回 Tiptap/canonical；测试对两次 CAS 保存做整文档 exact 比较，并显式核对 Unicode、`contentRevision`、assets、marker/task/presentation 与 P1/P2 extension bags。因此该项已有独立 `@covers` 声明。其他缺少完整证据的验收项仍不得推断为已完成；在 P0/P1 验收证据和对应测试全部通过前，不得宣称完成桌面 1:1。

## 范围分层

| 层级 | 范围 | 发布要求 |
|---|---|---|
| Core / P0 | 文档内嵌与全屏编辑、主题树、标准选择、键盘建图、拖拽重排/换父级、折叠、可靠撤销、系统剪贴板、手工布局保留、经典 Mind Map/Logic Chart/Tree Chart/Org Chart | 首个可替换现有实现的版本必须全部通过 |
| Desktop parity / P1 | 官方 9 个结构家族、Grid 内置结构样式及混合结构、完整格式面板、关系/外框/概要/标注/Zone、Marker/标签/笔记/链接/附件/图片/公式/任务、搜索过滤、Outliner、多 Sheet、导入导出/Map Shot、ZEN/Pitch | “桌面 1:1”必须全部通过 |
| Extended / P2 | Gantt、密码文件、多文件合并、实时协作、评论、权限、版本历史、AI 创建/扩展/重组/解释、Web 搜索和文件理解 | 可在桌面核心稳定后独立发布 |

P0 可以用只读 fixture 验证“未来/P1 实体不得破坏 Core 不变量”（例如已有 Relationship 不能参与树遍历），但不得要求用户在 Core 中创建或编辑尚未交付的 P1 功能。任何验收项只要主动进入 P1/P2 功能入口，其级别就必须随该功能提升。

任何阶段都不得以牺牲以下不变量换取功能进度：每个 Sheet 恰有一个 Central Topic、结构关系是允许 Floating/Summary 根存在的无环森林、一个主题至多一个结构父级、关系线不参与树遍历、旧文档无静默数据丢失、只读态不产生内容事务、所有可见修改均可撤销。

## 官方功能基线

- [XMind 更新日志](https://xmind.com/zh-hans/changelog)
- [主题编辑](https://xmind.com/user-guide/topic-editing-new)
- [结构与混合结构](https://xmind.com/user-guide/structure-new)
- [当前结构产品口径（含 Matrix 与横/纵 Timeline）](https://xmind.com/structure)
- [Timeline Horizontal / Vertical / Horizontal Off-Axis](https://xmind.com/blog/xmind-timeline)
- [Matrix 行是 Label 的文本语义](https://xmind.com/user-guide/text-new)
- [XMind 产品结构口径（9 个结构家族）](https://xmind.com/user-guide/intro-new)
- [Grid 内置结构样式](https://xmind.com/academy/xmind-grid-structure-tutorial)
- [Skeleton](https://xmind.com/user-guide/skeleton-new)
- [样式](https://xmind.com/user-guide/style-new)
- [高级布局](https://xmind.com/user-guide/advanced-layout-new)
- [关系线](https://xmind.com/user-guide/relationship-new)
- [外框](https://xmind.com/user-guide/boundary-new)
- [概要](https://xmind.com/user-guide/summary-new)
- [Zone](https://xmind.com/user-guide/zone)
- [Marker 与自定义 Marker](https://xmind.com/user-guide/marker-new)
- [本地图片](https://xmind.com/user-guide/pic-new)
- [贴纸与插画](https://xmind.com/user-guide/sticker-illustration-new)
- [附件](https://xmind.com/user-guide/attachment-new)
- [文件导入导出](https://xmind.com/user-guide/working-with-files)
- [官方导入格式清单](https://xmind.com/user-guide/import-new)
- [Task CSV / Calendar 导出映射](https://xmind.com/user-guide/export-task)
- [平台差异](https://xmind.com/help/feature-differences-across-platforms)

## 变更规则

- 需求、Schema、验收项和实施任务使用稳定 ID；删除时保留 ID 并标记 `Deprecated`，不得重新编号。
- Schema 只做向前兼容变更；破坏性变更必须提升主版本并提供迁移器。
- 产品需求变更必须同时更新至少一个验收项；Schema 变更必须同时更新 JSON Schema、迁移测试和 fixtures。
- `PRODUCT_SPEC.md` 是产品真相，`DATA_SCHEMA.md` 是数据真相，`INTERACTION_ACCEPTANCE.md` 是发布真相。
