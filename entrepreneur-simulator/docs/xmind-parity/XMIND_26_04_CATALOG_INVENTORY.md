# XMind 26.04 Marker / Sticker / Illustration 目录盘点

> 盘点日期：2026-07-21  
> 对标版本：XMind Desktop 26.04.01341（Windows）  
> 当前 NMDD 清单版本：`STICKER_CATALOG_VERSION = 1`  
> 用途：为 `PRD-CATALOG-*`、`ACC-CAT-*` 和 Phase 8/9/11 实施提供可审计基线；本文件不是“功能已完成”声明。

## 1. 证据口径

本盘点把证据分为三类，禁止互相替代：

| 等级 | 含义 | 可证明什么 | 不可证明什么 |
|---|---|---|---|
| `OFFICIAL` | XMind 官方用户指南或官方 Academy | 官方公开承诺的能力和操作路径 | 26.04 安装包中的精确资源文件、私有编码或永久不变的分类数量 |
| `GOLDEN` | 在锁定的 XMind 26.04.01341 中录屏、截图并导出 `.xmind` 金色文件 | 指定版本、平台、语言和授权态下的真实 UI 与 native 文件行为 | 未来版本或其他平台必然相同 |
| `CODE` | 当前仓库源码、生成清单和校验命令 | NMDD 此刻实际具备或明确降级的能力 | 与 XMind 视觉逐图相同，或 XMind 能原生编辑 NMDD fallback |

官方参考：

- [Sticker and Illustration](https://xmind.com/user-guide/sticker-illustration-new)：近 500 项；Insert/Marker 双入口；点击插入或从面板拖放；上/下/左/右放置；缩放、Reset Size、Delete。
- [Marker](https://xmind.com/user-guide/marker-new)：内置 Marker、同组切换、跨组叠加、图例、自定义组、PNG/JPG/SVG 与 `.xrb` 导入、多文件导入，以及 Select 后批量移动/删除。
- [官方 Sticker/Illustration 教程](https://xmind.com/academy/add-stickers-illustrations-in-xmind)：分类或快速搜索后插入、移动和缩放。

“至少 13 个分类”来自 26.04 Windows 面板盘点观察；官方指南只公开“近 500 项”并举出商务、教育、旅行等场景，没有承诺永久固定的精确分类表。因此：

1. `近 500` 和 `13+ 分类` 是 XMind 26.04 行为容量基线，不是允许复制其素材的清单；
2. 分类名称、顺序、数量可能随版本、语言、地区或授权态变化，金色证据必须记录这些环境；
3. NMDD 的 468 项不能因为数量接近就被描述为 XMind 的逐图复刻。

## 2. 官方 XMind 26.04 行为清单

### 2.1 Sticker / Illustration

| 能力 | 26.04 基线 | 证据 | 对 NMDD 的合同 |
|---|---|---|---|
| 容量 | 官方称“近 500”个 Sticker 与 Illustration | `OFFICIAL` | 发布目录应达到可用的同量级纵深；不得把接近的数字当成逐图同款证据 |
| 分类 | 锁定桌面面板可见至少 13 个分类入口 | `GOLDEN` 待逐类截图/录屏归档 | 分类可搜索、可键盘到达，并保持稳定 ID；不要求复制 XMind 分类名称或顺序 |
| 搜索 | 可按分类或快速搜索发现素材 | `OFFICIAL` | 搜索覆盖名称、分类、标签和稳定 ID；结果顺序确定且可清空 |
| 打开入口 | `Insert > Sticker/Illustration`，或 Marker 面板右侧 Sticker/Illustration 入口 | `OFFICIAL` | 两个入口打开同一个目录状态和同一插入命令 |
| 点击插入 | 先选 Topic，再点击素材 | `OFFICIAL` | 创建 Asset/TopicImage 的单一原子事务；选区和目标明确 |
| 面板拖放 | 从素材选择面板直接拖到目标 Topic | `OFFICIAL` | 拖动携带受控内部 MIME；合法目标高亮，非法/画布空白/只读零事务 |
| 方位 | 插入后可移到 Topic 上、下、左、右 | `OFFICIAL` | Sticker/Illustration 只公开四向；不把 overlay 冒充官方公开方位 |
| 调整 | 手动缩放，右键 Reset Size 恢复原始尺寸 | `OFFICIAL` | 使用 intrinsicSize，缩放/重置均可撤销和重载 |
| 删除 | 选中后 Delete 或右键 Delete | `OFFICIAL` | 删除图像实例并按引用计数回收资源；不误删 Topic |

### 2.2 Marker 与自定义 Marker

| 能力 | 26.04 基线 | 证据 | 对 NMDD 的合同 |
|---|---|---|---|
| 内置组 | Priority、Progress、Flag、Star、Arrow、Symbols 等 | `OFFICIAL` | 内置组不可误删；同组互斥/非互斥属性来自显式 registry，不靠名称猜测 |
| 应用与切换 | 工具栏 Marker 或 `Insert > Marker`；同组选择替换，跨组选择新增 | `OFFICIAL` | attach/update/detach 为 canonical command；一次操作一个历史项 |
| 删除 | Marker 右键 Delete，或打开 Marker 弹层点击删除 | `OFFICIAL` | 只删除目标 Instance；Definition/Group 不被连带删除 |
| 图例 | Show/Hide Legend；双击图例文本重命名当前图中的解释 | `OFFICIAL` | 图例位置、顺序、标题与显示状态可撤销、重载和导出 |
| 自定义组 | Desktop 本地文件中 New Group，支持 Rename/Delete | `OFFICIAL` | 自定义组 CRUD/reorder；删除前显示 Definition/Instance/Legend 影响，整体可撤销 |
| 自定义导入 | 向目标组导入 PNG、JPG、SVG 或历史 `.xrb`；可一次选多个文件 | `OFFICIAL` | 安全解析后生成 Asset-backed MarkerDefinition；单批次原子提交，部分失败不得静默吞项 |
| 单项管理 | 自定义 Marker 可 Move to 其他组或 Delete | `OFFICIAL` | 目标必须是可写自定义组；移动保持 Definition ID 与 Instance 引用 |
| 多选管理 | 点击 Select，多选后批量 Move 或 Delete | `OFFICIAL` | Select 是面板临时态；批量命令目标去重、顺序确定、一次 undo |
| 可用性 | XMind 中创建/管理限 Desktop 本地文件与 Premium；上传/分享后仍可显示 | `OFFICIAL` | NMDD 必须如实显示自身平台/权限状态，不伪造 Desktop bridge 或 XMind 订阅状态 |

## 3. NMDD 当前许可目录纵切

当前生成清单由 `lucide-react@0.358.0` 的 ISC 许可图标派生，发布资源是 NMDD 自己生成的 PNG 构图。它是“许可安全的目录纵切”，不是 XMind 商业插画的替代拷贝，也不声明任何条目与 XMind 一一对应。

### 3.1 精确清单

| 指标 | 当前值 | `CODE` 证据 |
|---|---:|---|
| 总条目 | 468 | 13 类 × 36 项；`npm run validate:mindmap:stickers` |
| Sticker | 429 | 每类 33 项 |
| Illustration | 39 | 每类 3 项 |
| 分类 | 13 | 生成清单 `STICKER_CATEGORIES` |
| 总字节 | 13,821,512 B | 校验器对实际 PNG 求和 |
| 单资源上限 | 64 KiB | 发布校验门禁 |
| 整库上限 | 20 MiB | 发布校验门禁 |
| 源依赖 | `lucide-react@0.358.0` | 精确版本与 lock integrity 门禁 |
| 许可证 | ISC | `public/licenses/lucide-ISC.txt` 与 `THIRD_PARTY_NOTICES.txt` |
| 源指纹 | `d6b8706275730f6499999aa9bfd4df7de3d7da6187dfe9a9cc702699d531e422` | 生成源指纹 |
| manifest 指纹 | `e3f30b89cc41db8b3e9997f42dcf6b0b1a45e10849d5ba798aa95f0b4cea83b4` | release manifest 指纹 |

| 稳定分类 ID | 显示名 | Sticker | Illustration | 合计 |
|---|---|---:|---:|---:|
| `business` | 商务 | 33 | 3 | 36 |
| `planning` | 计划 | 33 | 3 | 36 |
| `education` | 教育 | 33 | 3 | 36 |
| `ideas` | 灵感 | 33 | 3 | 36 |
| `communication` | 沟通 | 33 | 3 | 36 |
| `people` | 人物 | 33 | 3 | 36 |
| `technology` | 科技 | 33 | 3 | 36 |
| `finance` | 财务 | 33 | 3 | 36 |
| `travel` | 旅行 | 33 | 3 | 36 |
| `nature` | 自然 | 33 | 3 | 36 |
| `food` | 餐饮 | 33 | 3 | 36 |
| `home` | 生活 | 33 | 3 | 36 |
| `celebration` | 庆祝 | 33 | 3 | 36 |
| **总计** |  | **429** | **39** | **468** |

### 3.2 许可与非仿冒边界

- 允许：使用 Lucide ISC 源图形，以 NMDD 自有色板、构图、命名和分类生成资源；随包保留许可证、attribution、源版本与哈希。
- 禁止：从 XMind 安装包、网页、截图、缓存或 `.xmind` 文件提取商业 Sticker/Illustration/Marker；描摹、像素复刻或以相同命名/顺序制造混淆。
- 禁止：把 `468/13/39` 写成“XMind 素材已 1:1”；这里的 1:1 仅指目录发现、插入、拖放、管理、布局和 I/O 降级合同。
- 任何新素材进入 release manifest 前必须有明确 SPDX/授权证明、source version、attribution、byteSize、SHA-256、intrinsicSize 和离线可用路径。

## 4. 当前实现状态与差距

状态定义：

| 状态 | 定义 |
|---|---|
| `native-verified` | 已映射为 XMind 26.04 原生字段/资源，真实 26.04 打开、编辑、保存、再导入的金色往返无降级 |
| `native-partial` | 只有明确子集具备原生映射；其他子集必须逐项标记 fallback |
| `canonical-fallback-only` | NMDD canonical 与资源包可无损保留，但没有证据证明 XMind 26.04 能以对应原生控件编辑 |
| `not-implemented` | 当前代码或 UI 尚无该行为；不得用文档目标冒充实现 |

| 子系统 | 当前 `CODE` 状态 | 兼容状态 | 剩余差距 |
|---|---|---|---|
| 许可资源生成与校验 | 468 项、13 类、39 Illustration；固定版本、指纹、哈希、尺寸、许可证和字节预算 | NMDD native；与 XMind I/O 无关 | 需要在每次目录变更时生成变更报告和 tombstone/alias 清单 |
| 目录查询内核 | 可按 category/kind/query 过滤；NFKC、大小写归一、多 token AND、稳定 manifest 顺序 | NMDD native | 需要和面板、键盘导航、空状态、性能门禁完整闭环 |
| 目录面板 | 468 项已接入；具备 category/kind/query、结果数、最近/收藏、空状态、lazy image、roving grid、点击插入与内部 MIME 拖放 | NMDD partial | 当前 filter 后仍会为全部结果创建卡片，尚未满足 ≤80 DOM 的虚拟化门禁；Insert/Marker 双入口状态复用、焦点恢复、IME、错误态和完整读屏行为仍须以 `ACC-CAT-*` 放行。最近/收藏是 NMDD 扩展，不冒充 XMind 26.04 对标要求 |
| Sticker canonical | 使用 Asset + TopicImage(`role="sticker"`)；四向位置、缩放、Reset/Delete 复用资源合同 | `canonical-fallback-only` | XMind exporter 当前不会把 Sticker 冒充普通 Local Image；需 26.04 金色确定真正 native 编码后才可升级 |
| 内置 Marker | 5 个产品自有组：priority/progress/flag/star/arrow；应用、替换、重排、图例与 CRUD 命令已存在 | `native-partial` | 只有完整 XMind builtin source reference 可原生导出；Symbols 等目录覆盖与逐项 golden 尚未完成 |
| 自定义 Marker 组 | 支持组 CRUD/reorder，当前自定义 Definition 是内置几何键 | `canonical-fallback-only` | PNG/JPG/SVG、`.xrb`、多文件导入、Asset-backed 图标尚未完成 |
| 自定义 Marker 多选管理 | 无 Select 批量选择工作流 | `not-implemented` | 批量 Move/Delete、选择态可访问性、单事务 undo/redo 待实现 |
| XMind custom/asset Marker | exporter 明确报告 `xmind.custom-marker-preserved-only` / `xmind.asset-marker-preserved-only` | `canonical-fallback-only` | 未经 26.04 金色验证不得改成 builtin marker 或宣称 native |

## 5. 稳定 ID 与版本规则

1. 目录条目 ID 使用小写 kebab-case，当前生成项采用 `<category-id>-<semantic-name>`；已发布 ID 永不复用给不同视觉语义。
2. 分类 ID 与条目 ID 独立于本地化显示名和面板顺序；改名、翻译、排序不改变 ID。
3. 删除已发布条目时保留 tombstone；仅在资源视觉与语义确实相同的迁移中设置 alias，alias 不得形成环。
4. `STICKER_CATALOG_VERSION` 在 manifest 结构或 ID 解释发生变化时递增；仅增加兼容条目时仍必须刷新源/manifest 指纹。
5. 文档 canonical 保存 Asset 与 TopicImage 的稳定实体 ID、内容哈希和资源来源；catalog ID 只是 provenance/重建提示，不能是打开文档所需的唯一指针。
6. `native-verified` 状态必须绑定 `xmindVersion + platform + goldenSha256`；升级 XMind 版本后自动回到“待复验”，不得沿用口头结论。

## 6. 放行清单

目录能力只有在以下证据同时存在时才能从“纵切”升级为“Desktop parity”：

- [ ] `ACC-CAT-001~018` 全部通过，测试名和 `@covers` 使用完整稳定 ID；
- [ ] 468 项/13 类/39 Illustration 的 manifest、实际文件、许可证、指纹和预算校验通过；
- [ ] 目录面板具备 category/kind/search、虚拟化、键盘/读屏、空状态和 read-only 行为；
- [ ] 点击插入和跨 Topic 拖放均只产生一个 canonical transaction，可一次 undo/redo；
- [ ] PNG/JPG/SVG 与 `.xrb` 自定义 Marker 导入通过安全、配额和原子性用例；
- [ ] Select 多选后的批量 Move/Delete、影响预览、undo/redo/reload 通过；
- [ ] XMind 26.04 native/fallback 每一类都有金色文件和明确诊断，不存在“静默看似成功”；
- [ ] 仓库和发行包中不存在 XMind 商业素材、商标资源、截图裁切或来源不明二进制。

## 7. 实施任务索引

| 任务 ID | 任务 | 主要验收 |
|---|---|---|
| `IMP-CATALOG-001` | 冻结 XMind 26.04 面板录屏、分类/搜索/拖放与 Marker 管理金色证据 | `ACC-CAT-001` |
| `IMP-CATALOG-002` | 维护 versioned manifest、稳定 ID/tombstone/alias、许可证、哈希与确定性生成器 | `ACC-CAT-002/003/018` |
| `IMP-CATALOG-003` | 完成分类、Sticker/Illustration kind、搜索、计数、空状态和虚拟化面板 | `ACC-CAT-004~006/010` |
| `IMP-CATALOG-004` | 统一 Insert/Marker 双入口、点击插入、受控拖放、四向布局与只读门禁 | `ACC-CAT-007~009` |
| `IMP-CATALOG-005` | 完成键盘 grid、焦点恢复、读屏结果播报和 reduced-motion | `ACC-CAT-011` |
| `IMP-CATALOG-006` | 实现 PNG/JPG/SVG 多文件 Marker ingest、解码/清洗/配额/去重和原子 planner | `ACC-CAT-012` |
| `IMP-CATALOG-007` | 安全解析 `.xrb`，输出逐项报告并防 Zip Slip/解压炸弹/脚本与外链 | `ACC-CAT-013` |
| `IMP-CATALOG-008` | 实现 Marker Select 临时态、批量 Move/Delete、影响预览与单事务历史 | `ACC-CAT-014/015` |
| `IMP-CATALOG-009` | 建立 XMind 26.04 built-in/custom/sticker native 金色矩阵和 fallback 诊断 | `ACC-CAT-016/017` |
| `IMP-CATALOG-010` | 将全部门禁接入 CI、release evidence、离线 E2E 与发布说明 | `ACC-CAT-001~018` |
