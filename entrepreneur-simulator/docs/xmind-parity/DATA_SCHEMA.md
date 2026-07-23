# XMind 1:1 数据模型与领域命令规范

状态：实施基线  
格式名称：app.nmdd.mindmap  
Schema 版本：1  
配套机器 Schema：mindmap.schema.json

本文定义脑图的 canonical document model。它是持久化、撤销、协作、导入导出和自动布局的共同事实源，不依赖 React、Tiptap、React Flow 或某一个布局引擎。

## 1. 不可妥协的设计原则

1. Topic 只表示主题。Boundary、Summary、Callout、Zone 都是独立实体，不再伪装成 React Flow Node。
2. TreeEdge 与 Relationship 使用不同的集合、类型、索引、命令和渲染适配器。
3. 父子查询、子树删除、折叠、自动布局、层级导航和分支复制只能遍历 treeEdges。
4. relationships 永远不得参与树遍历，即使关系线两端都是 Topic。
5. Topic 不重复保存 parentId 或 children。TreeEdge 是父子关系唯一事实源。
6. 父级、顺序、左右侧和结构必须显式保存，不能从画布坐标反推后再覆盖。
7. 自动布局坐标是派生结果；自由主题、固定分支和用户偏移才是持久化数据。
8. selection、hover、editing nonce、viewport、拖动预览和 presence cursor 不属于文档内容。
9. 所有顺序使用稳定的 OrderKey，禁止以数组下标、Date.now 或浮点 order 作为长期排序。
10. 核心对象拒绝未知属性；扩展数据只能进入带命名空间的 extensions。

## 2. 版本与加载管线

文档头必须包含：

    schema: "app.nmdd.mindmap"
    schemaVersion: 1
    minimumReaderVersion: 1
    contentRevision: 0

schemaVersion 表示存储格式版本；contentRevision 表示内容修订。两者不可混用。

加载顺序固定为：

    受限 JSON parse（大小/深度/键数限制）
    -> envelope/schemaVersion 探测
    -> 对应 legacy/V0 形状验证与安全归一化
    -> 按版本逐版迁移到 V1
    -> V1 JSON Schema 结构验证
    -> 引用完整性验证
    -> 领域不变量验证
    -> 构建只读索引
    -> 生成 UI/React Flow 投影

缺少 `schemaVersion` 的 `nodes + edges` 只能进入受限 legacy validator，绝不能先拿 V1 Schema 验证；未知的未来 `minimumReaderVersion` 必须只读拒绝并保留原 payload。

保存顺序固定为：

    UI intent
    -> Domain Command
    -> precondition
    -> reducer
    -> semantic validation
    -> atomic commit
    -> persistence

## 3. 实体归属

| 层级 | 实体 |
| --- | --- |
| Document | Sheet、Asset、StyleDefinition、Theme、MarkerGroup、MarkerDefinition、PresentationDeck、SavedView、ActorSnapshot、CollaborationMetadata |
| Sheet | Topic、TreeEdge、Relationship、Boundary、Summary、Callout、Zone、MarkerInstance、Note、Link、Attachment、Image、Equation、Audio、To-do、Task、TaskDependency、WorkCalendarException（嵌于 Sheet.workCalendar） |
| View sidecar | viewport、selection、focus branch、面板、搜索、过滤、播放页、用户临时折叠覆盖 |
| Ephemeral | hover、drag preview、editing nonce、框选矩形、右键菜单坐标、节点测量尺寸、实时 presence |

实体集合使用 Record<Id, Entity>。数组只用于真正的值序列；可编辑顺序由实体自身的 orderKey 决定。

## 4. ID、引用和 OrderKey

### 4.1 ID

新实体统一使用 UUIDv7：

- 客户端可离线生成；
- 全文档全局唯一，不仅是同类型唯一；
- 删除后永不复用；
- 不从标题、父节点、时间戳或数组位置推导；
- 复制粘贴先创建完整 oldId -> newId 映射，再一次性重写内部引用；
- legacy ID 可存入 extensions["app.nmdd.legacy-id"] 或迁移报告。

建议 TypeScript 使用 branded ID：

    type Id<K extends string> = string & { readonly __id: K };
    type DocumentId = Id<"Document">;
    type SheetId = Id<"Sheet">;
    type TopicId = Id<"Topic">;
    type TreeEdgeId = Id<"TreeEdge">;
    type RelationshipId = Id<"Relationship">;
    type ControlPointId = Id<"RelationshipControlPoint">;
    type BoundaryId = Id<"Boundary">;
    type SummaryId = Id<"Summary">;
    type CalloutId = Id<"Callout">;
    type ZoneId = Id<"Zone">;
    type StyleId = Id<"Style">;
    type ThemeId = Id<"Theme">;
    type ThemeRuleId = Id<"ThemeRule">;
    type MarkerGroupId = Id<"MarkerGroup">;
    type MarkerDefinitionId = Id<"MarkerDefinition">;
    type MarkerInstanceId = Id<"MarkerInstance">;
    type NoteId = Id<"Note">;
    type LinkId = Id<"Link">;
    type AssetId = Id<"Asset">;
    type AttachmentId = Id<"Attachment">;
    type ImageId = Id<"Image">;
    type EquationId = Id<"Equation">;
    type AudioId = Id<"Audio">;
    type TodoId = Id<"Todo">;
    type TaskId = Id<"Task">;
    type TaskDependencyId = Id<"TaskDependency">;
    type CalendarExceptionId = Id<"CalendarException">;
    type PresentationId = Id<"Presentation">;
    type SlideId = Id<"Slide">;
    type BuildId = Id<"PresentationBuild">;
    type SavedViewId = Id<"SavedView">;
    type CommentThreadId = Id<"CommentThread">;
    type CommentId = Id<"Comment">;
    type ActorId = Id<"Actor">;
    type CommandId = Id<"Command">;
    type OrderKey = string;

### 4.2 OrderKey

OrderKey 是不透明位置标识，推荐 fractional-indexing 加 actor suffix，或 LSEQ/Logoot 类位置 ID。

- 比较使用固定的 ASCII/二进制字典序，不受 locale 影响；
- 并发碰撞时以实体 UUID 作为最终 tie-break；
- 插入只生成前后两个 key 之间的新 key；
- key 过长时执行原子的 RebalanceOrder 命令；
- TreeEdge 的排序作用域为 parentTopicId + side + slot；
- Sheet、TreeEdge、MarkerInstance、Attachment、Image、Audio、Slide、Build 都使用同一套规则。

## 5. Canonical TypeScript 模型

以下类型是领域层建议。机器级完整约束见 mindmap.schema.json。

### 5.1 基础类型

    type ISODateTime = string;
    type ExtensionBag = Record<string, unknown>;

    interface EntityAudit {
      createdAt: ISODateTime;
      createdBy?: ActorId;
      updatedAt: ISODateTime;
      updatedBy?: ActorId;
    }

    interface EntityBase<I extends string> {
      id: I;
      audit?: EntityAudit;
      extensions?: ExtensionBag;
    }

    interface Point {
      x: number;
      y: number;
    }

    interface Size {
      width: number;
      height: number;
    }

    interface Rect {
      x: number;
      y: number;
      width: number;
      height: number;
    }

    interface CanvasSpec {
      background:
        | { kind: "solid"; color: ColorValue }
        | { kind: "gradient"; from: ColorValue; to: ColorValue; angle: number }
        | { kind: "image"; assetId: AssetId; fit: "cover" | "contain" | "tile" };
      grid?: { enabled: boolean; size: number; color: ColorValue };
    }

    type RichMark =
      | { type: "bold" | "italic" | "underline" | "strike" | "code" }
      | { type: "color"; value: string }
      | { type: "fontFamily"; value: string }
      | { type: "fontSize"; value: number }
      | {
          type: "textTransform";
          value: "none" | "uppercase" | "lowercase" | "capitalize";
        }
      | { type: "link"; href: string; title?: string };

    type RichInline =
      | { type: "text"; text: string; marks?: RichMark[] }
      | { type: "hardBreak" };

    interface Paragraph {
      type: "paragraph";
      align?: "left" | "center" | "right";
      children: RichInline[];
    }

    interface RichListItem {
      type: "listItem";
      children: Array<Paragraph | RichList>;
    }

    interface RichList {
      type: "bulletList" | "orderedList";
      start?: number;
      items: RichListItem[];
    }

    interface RichText {
      type: "doc";
      version: 1;
      blocks: Array<Paragraph | RichList>;
    }

RichText 使用中立块/行内模型，至少支持 paragraph 对齐、bullet/ordered list、嵌套 listItem、text、hardBreak 和 bold、italic、underline、strike、code、color、fontFamily、fontSize、textTransform、link marks。URL 仍受统一安全协议校验；不得把特定编辑器 JSON 直接当作长期格式。

### 5.2 Document 与 Sheet

    interface MindMapDocumentV1 extends EntityBase<DocumentId> {
      schema: "app.nmdd.mindmap";
      schemaVersion: 1;
      minimumReaderVersion: 1;
      contentRevision: number;
      title: string;
      locale?: string;

      sheets: Record<SheetId, MindMapSheet>;
      assets: Record<AssetId, Asset>;
      styles: Record<StyleId, StyleDefinition>;
      themes: Record<ThemeId, MindMapTheme>;
      markerGroups: Record<MarkerGroupId, MarkerGroup>;
      markerDefinitions: Record<MarkerDefinitionId, MarkerDefinition>;
      presentations: Record<PresentationId, PresentationDeck>;
      savedViews: Record<SavedViewId, SavedView>;
      actors: Record<ActorId, ActorSnapshot>;
      collaboration?: CollaborationMetadata;
    }

    interface MindMapSheet extends EntityBase<SheetId> {
      orderKey: OrderKey;
      title: string;
      rootTopicId: TopicId;
      themeId: ThemeId;
      defaultSavedViewId?: SavedViewId;
      defaultBranchLayout: ResolvedBranchLayoutSpec;
      advancedLayout: AdvancedLayoutSpec;
      canvas: CanvasSpec;
      workCalendar: WorkCalendar;
      markerLegend: MarkerLegendSpec;

      topics: Record<TopicId, Topic>;
      treeEdges: Record<TreeEdgeId, TreeEdge>;
      relationships: Record<RelationshipId, Relationship>;
      boundaries: Record<BoundaryId, Boundary>;
      summaries: Record<SummaryId, Summary>;
      callouts: Record<CalloutId, Callout>;
      zones: Record<ZoneId, Zone>;

      markerInstances: Record<MarkerInstanceId, MarkerInstance>;
      notes: Record<NoteId, Note>;
      links: Record<LinkId, TopicLink>;
      attachments: Record<AttachmentId, Attachment>;
      images: Record<ImageId, TopicImage>;
      equations: Record<EquationId, Equation>;
      audioClips: Record<AudioId, AudioClip>;
      todos: Record<TodoId, TopicTodo>;
      tasks: Record<TaskId, TopicTask>;
      taskDependencies: Record<TaskDependencyId, TaskDependency>;
    }

所有空集合也应写成空对象，避免 undefined、缺省值和旧版本之间出现多义状态。

### 5.3 Topic、结构、左右侧与手工位置

    type TopicRole =
      | "central"
      | "regular"
      | "floating-root"
      | "summary-result";

    type ExtensionStructureId =
      string & { readonly __extensionStructureId: true };

    type StructureId =
      | "core:mind-map"
      | "core:logic-chart"
      | "core:org-chart"
      | "core:tree-chart"
      | "core:timeline"
      | "core:fishbone"
      | "core:matrix"
      | "core:brace-map"
      | "core:tree-table"
      | "core:grid"
      | ExtensionStructureId;

    interface BranchLayoutSpec {
      structure: StructureId | "inherit";
      direction:
        | "left-to-right"
        | "right-to-left"
        | "top-to-bottom"
        | "bottom-to-top"
        | "both"
        | "radial"
        | "clockwise"
        | "counterclockwise"
        | "inherit";
      mode: "auto" | "hybrid" | "manual";
      compact?: boolean;
      balance?: "none" | "automatic" | "locked";
      freePositioning?: boolean;
      justifyTopicAlignment?: boolean;
      spacing?: { sibling: number; level: number };
      variantId?: string;
      options?: Record<string, string | number | boolean>;
    }

    type ResolvedBranchLayoutSpec = BranchLayoutSpec & {
      structure: StructureId;
      direction: Exclude<BranchLayoutSpec["direction"], "inherit">;
    };

    interface AdvancedLayoutSpec {
      flexibleFloatingTopics: boolean;
      allowTopicOverlap: boolean;
    }

    interface StructureLayoutDescriptor {
      structure: StructureId;
      allowedDirections: Array<Exclude<BranchLayoutSpec["direction"], "inherit">>;
      variantIds: string[];
      optionSchemaId: string;
      semantics?:
        | {
            kind: "timeline";
            orientationSource: "direction";
            offAxisSource: "variantId";
          }
        | {
            kind: "matrix";
            columnAxisSource: "direct-child-topic";
            rowAxisSource: "topic-label";
            unlabeledPolicy: string;
            multiLabelPolicy: string;
            duplicateLabelPolicy: string;
          };
    }

内置结构必须使用版本化、不可变的 `core-2026-07-18` capability registry；Phase 0 实机校准后冻结全部 direction、variantId、语义映射与 option JSON sub-schema，冻结前的观察值不得作为生产 validator 的拒绝依据。已由官方资料确认 Timeline 同时存在 Horizontal、Vertical 与 Horizontal Off-Axis：横向/纵向编码在 `direction`，Off-Axis 编码在 `variantId`，`options` 不得再保存第二份 orientation。Matrix 的 direct-child Topic 形成列轴，行轴来自后代 Topic 的 `labels` 投影而非 RichText；无 Label、多 Label、同名 Label、合并行及导入导出的精确策略由 descriptor 和金色语料冻结。extension 结构必须注册同构 descriptor 后才可读写。`options` 不是自由逃生口；必须通过 descriptor.optionSchemaId 对应的严格子 Schema，未知 key 进入 namespaced extension/迁移报告。

    type TopicPlacement =
      | { mode: "auto" }
      | { mode: "offset"; dx: number; dy: number }
      | { mode: "absolute"; x: number; y: number };

    type TopicWidth =
      | { mode: "fit" }
      | { mode: "fixed"; value: number };

    interface NumberingSpec {
      enabled: boolean;
      style:
        | "decimal"
        | "roman-lower"
        | "roman-upper"
        | "alpha-lower"
        | "alpha-upper"
        | "chinese";
      startAt: number;
      prefix?: string;
      suffix?: string;
      separator?: string;
    }

    interface Topic extends EntityBase<TopicId> {
      role: TopicRole;
      title: RichText;
      branchLayout?: BranchLayoutSpec;
      childNumbering?: NumberingSpec;
      placement: TopicPlacement;
      sizing: { width: TopicWidth };
      defaultCollapsed: boolean;
      style?: StyleBinding;
      labels?: string[];
    }

structure 挂在 Topic 上，含义是该 Topic 的出边分支如何排列。这使同一 Sheet 可以使用混合结构。

auto placement 不保存布局引擎输出的 x/y。offset 保存相对自动布局结果的用户偏移。absolute 用于自由主题或完全固定分支。

### 5.4 TreeEdge

    type BranchSide =
      | "left"
      | "right"
      | "top"
      | "bottom"
      | "center"
      | "inherit";

    interface TreeEdge extends EntityBase<TreeEdgeId> {
      parentTopicId: TopicId;
      childTopicId: TopicId;
      orderKey: OrderKey;
      side: BranchSide;
      slot?: string;
      style?: StyleBinding;
    }

Canonical 文档不保存 side:auto。创建命令可以请求 auto，但 reducer 必须在提交前解析成明确侧位。

双向 Mind Map 中，root 的直接子边必须是 left 或 right；后代通常为 inherit。布局引擎升级不得改变已经落盘的 side。

### 5.5 Relationship

    type RelationshipTargetRef =
      | { kind: "topic"; topicId: TopicId }
      | { kind: "boundary"; boundaryId: BoundaryId }
      | { kind: "callout"; calloutId: CalloutId }
      | { kind: "zone"; zoneId: ZoneId };

    interface RelationshipEndpoint {
      element: RelationshipTargetRef;
      anchor:
        | "auto"
        | "left"
        | "right"
        | "top"
        | "bottom"
        | { xRatio: number; yRatio: number };
    }

    interface Relationship extends EntityBase<RelationshipId> {
      source: RelationshipEndpoint;
      target: RelationshipEndpoint;
      title?: RichText;
      routing: "straight" | "curve" | "orthogonal" | "manual";
      controlPoints?: Record<ControlPointId, RelationshipControlPoint>;
      startArrow: ArrowHead;
      endArrow: ArrowHead;
      style?: StyleBinding;
    }

    interface RelationshipControlPoint {
      id: ControlPointId;
      orderKey: OrderKey;
      x: number;
      y: number;
    }

    type ArrowHead =
      | "none"
      | "triangle"
      | "open-triangle"
      | "diamond"
      | "open-diamond"
      | "circle"
      | "open-circle"
      | "square"
      | "open-square"
      | "bar"
      | "double-bar";

必须暴露彼此独立的领域查询：

    getTreeChildren(topicId)   // 只查询 treeEdges
    getTreeParent(topicId)     // 只查询 treeEdges
    getRelationships(element: RelationshipTargetRef)  // 按四类合法端点只查询 relationships

删除、复制、折叠和布局代码不得调用含糊的 getOutgoingEdges。

### 5.6 Boundary、Summary、Callout、Zone

    type TopicScope =
      | {
          kind: "subtree";
          rootTopicId: TopicId;
          depth: "all" | number;
        }
      | {
          kind: "sibling-range";
          parentTopicId: TopicId;
          firstEdgeId: TreeEdgeId;
          lastEdgeId: TreeEdgeId;
          includeDescendants: boolean;
        }
      | {
          kind: "explicit";
          topicIds: TopicId[];
        };

    interface Boundary extends EntityBase<BoundaryId> {
      scope: TopicScope;
      title?: RichText;
      padding: number;
      style?: StyleBinding;
    }

    interface Summary extends EntityBase<SummaryId> {
      scope: TopicScope;
      resultTopicId: TopicId;
      orientation: "left" | "right" | "top" | "bottom" | "auto";
      style?: StyleBinding;
    }

    interface Callout extends EntityBase<CalloutId> {
      targetTopicId: TopicId;
      content: RichText;
      placement:
        | { mode: "auto"; preferredSide?: BranchSide }
        | { mode: "offset"; dx: number; dy: number };
      tail: "line" | "triangle" | "curve";
      style?: StyleBinding;
    }

    interface Zone extends EntityBase<ZoneId> {
      rootTopicIds: TopicId[];
      title?: RichText;
      rect: Rect;
      autoResize: boolean;
      lockAspectRatio: boolean;
      collapsed: boolean;
      zOrderKey: OrderKey;
      padding: number;
      style?: StyleBinding;
    }

Boundary 的外框位置与尺寸由 scope 中的 Topic 布局和 padding 派生；Zone 的 rect 是用户可移动/缩放的 canonical 几何。Zone.rootTopicIds 只列出被容纳的 Floating Topic 根，后代由 TreeEdge 隐含；移动 Zone 必须在一个命令中平移 rect 与这些根。手动缩放会关闭 autoResize，折叠只隐藏内容而不删除，zOrderKey 决定重叠层级。Summary.resultTopicId 指向 role 为 summary-result 的 Topic；该 Topic 没有普通入树边、不得使用 absolute placement，但可以拥有以它为 parent 的普通 TreeEdge 与完整后代。Summary.style 只控制括号和连接线；结果主题的文本、形状、填充及其后代分支继续读取 Topic/TreeEdge 样式。

Summary 创建命令必须把用户选择和 planner 产物同时固化到 payload：`selectedTopicIds` 用于验证创建意图，`creations[]` 为每个合法归一化组携带一对 `{ summary, resultTopic }`。同一动作的全部 creations 在一个事务中提交；reducer 不得重新分组或现场生成 ID。`orientation="auto"` 按范围所在结构的外向方向解析，显式方向仅允许 left/right/top/bottom。

结构命令造成 Summary scope 变化时，payload 使用 `SummaryScopeChange { summaryId, replacements[] }`。每个 replacement 携带最终 Summary；拆分后的第二组起还必须携带完整 `resultSubtree` 克隆（Topic、TreeEdge、附属实体、内部引用及 planner 预分配 ID）。共享 Document Asset 继续按引用复用，所有 Sheet 内实体必须重映射；validator 必须把 supplied change 与根据 before/after 树计算出的 0/1/N 归一化计划逐项核对后才允许 apply。

### 5.7 Style 与 Theme

    type StyleScope =
      | "sheet"
      | "topic"
      | "tree-edge"
      | "relationship"
      | "boundary"
      | "summary"
      | "callout"
      | "zone"
      | "marker"
      | "presentation";

    type ColorValue =
      | { kind: "literal"; value: string }
      | { kind: "token"; token: string };

    interface StyleProperties {
      opacity?: number;
      typography?: {
        fontFamily?: string;
        fontSize?: number;
        fontWeight?: number;
        italic?: boolean;
        underline?: boolean;
        strike?: boolean;
        lineHeight?: number;
        letterSpacing?: number;
        color?: ColorValue;
        align?: "left" | "center" | "right";
      };
      fill?: { color?: ColorValue; opacity?: number };
      border?: {
        color?: ColorValue;
        width?: number;
        dash?: number[];
        radius?: number;
      };
      shape?: string;
      padding?: { top: number; right: number; bottom: number; left: number };
      minSize?: Partial<Size>;
      maxSize?: Partial<Size>;
      shadow?: {
        color: ColorValue;
        blur: number;
        x: number;
        y: number;
      };
      connector?: {
        color?: ColorValue;
        width?: number;
        dash?: number[];
        shape?: "straight" | "curve" | "elbow" | "rounded-elbow";
        startCap?: "butt" | "round" | "square" | "arrow";
        endCap?: "butt" | "round" | "square" | "arrow";
        taper?: "none" | "start" | "end" | "both";
        colorMode?: "single" | "by-main-branch" | "palette";
        palette?: ColorValue[];
      };
    }

    interface StyleBinding {
      styleId?: StyleId;
      inheritance?: "default" | "break";
      overrides?: StyleProperties;
    }

    interface StyleDefinition extends EntityBase<StyleId> {
      name: string;
      scope: StyleScope;
      basedOnStyleId?: StyleId;
      properties: StyleProperties;
    }

    interface ThemeRule extends EntityBase<ThemeRuleId> {
      orderKey: OrderKey;
      selector: {
        scope: StyleScope;
        topicRole?: TopicRole;
        level?: number;
        side?: BranchSide;
        structure?: StructureId;
      };
      binding: StyleBinding;
    }

    interface MindMapTheme extends EntityBase<ThemeId> {
      name: string;
      tokens: Record<string, string | number>;
      defaultStyles: Partial<Record<StyleScope, StyleBinding>>;
      rules: Record<ThemeRuleId, ThemeRule>;
      defaultBranchLayout?: BranchLayoutSpec;
    }

StyleProperties 使用渲染器中立字段，至少覆盖 typography、fill、border、shape、padding、size、shadow、opacity 和 connector。不得持久化 Tailwind class、React style 对象或 computed CSS。

ThemeRule specificity 固定按 selector 非空字段数比较；相同 specificity 按 orderKey，再以 rule id 作为最终 tie-break。selector.scope 必须与 binding 目标一致，规则不得依赖 DOM 顺序。

样式解析顺序固定为：

    built-in defaults
    -> theme tokens/defaults
    -> theme rules（specificity + orderKey）
    -> named style inheritance
    -> entity overrides

null 不表示重置。style.reset 命令应删除 override 属性。

### 5.8 Marker 与内容资源

    interface MarkerGroup extends EntityBase<MarkerGroupId> {
      orderKey: OrderKey;
      name: string;
      kind: "builtin" | "custom";
      exclusive: boolean;
    }

    interface MarkerDefinition extends EntityBase<MarkerDefinitionId> {
      groupId: MarkerGroupId;
      orderKey: OrderKey;
      name: string;
      source:
        | { kind: "builtin"; key: string }
        | { kind: "asset"; assetId: AssetId };
      semanticValue?: string | number | boolean;
    }

    interface MarkerInstance extends EntityBase<MarkerInstanceId> {
      topicId: TopicId;
      markerDefinitionId: MarkerDefinitionId;
      orderKey: OrderKey;
      value?: string | number | boolean;
    }

    interface MarkerLegendSpec {
      visible: boolean;
      position: Point;
      title?: string;
      itemOrder?: MarkerDefinitionId[];
      style?: StyleBinding;
    }

    interface Note extends EntityBase<NoteId> {
      topicId: TopicId;
      content: RichText;
    }

    interface TopicLinkBase extends EntityBase<LinkId> {
      topicId: TopicId;
      orderKey: OrderKey;
      title?: string;
      status: "active" | "broken";
    }

    type TopicLink =
      | (TopicLinkBase & {
          kind: "web" | "email" | "file" | "folder";
          href: string;
        })
      | (TopicLinkBase & { kind: "sheet"; targetSheetId: SheetId })
      | (TopicLinkBase & {
          kind: "topic";
          targetSheetId: SheetId;
          targetTopicId: TopicId;
        })
      | (TopicLinkBase & {
          kind: "document-page";
          targetDocumentPage: { documentId: string; pageId: string };
        });

    interface Asset extends EntityBase<AssetId> {
      fileName: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      source:
        | { kind: "embedded"; relativePath: string }
        | { kind: "managed"; objectKey: string }
        | { kind: "remote"; url: string; etag?: string };
      intrinsicSize?: Size;
      durationMs?: number;
    }

    interface Attachment extends EntityBase<AttachmentId> {
      topicId: TopicId;
      assetId: AssetId;
      orderKey: OrderKey;
    }

    interface TopicImage extends EntityBase<ImageId> {
      topicId: TopicId;
      assetId: AssetId;
      orderKey: OrderKey;
      role: "inline" | "thumbnail" | "background" | "sticker";
      placement: {
        side: "top" | "bottom" | "left" | "right" | "overlay";
        align: "start" | "center" | "end";
        offset: Point;
      };
      size?: Size;
      crop?: Rect;
      alt?: string;
    }

    interface Equation extends EntityBase<EquationId> {
      topicId: TopicId;
      orderKey: OrderKey;
      syntax: "latex" | "mathml";
      source: string;
      display: "inline" | "block";
      scale: number;
      alt?: string;
    }

    interface AudioClip extends EntityBase<AudioId> {
      topicId: TopicId;
      assetId: AssetId;
      orderKey: OrderKey;
      transcript?: RichText;
    }

Sticker 复用 Asset + TopicImage，并以 `role="sticker"` 区分；素材必须来自自有或已授权资源库。大型二进制资源不得 Base64 塞入文档 JSON。JSON 只保存 Asset manifest，blob 放对象存储或导出 ZIP 包中的安全相对路径。

密码保护属于文件容器层：先把 canonical JSON 与资源 manifest 打包，再对容器做版本化认证加密。密码、派生密钥、salt 以外的敏感中间值不得进入 `MindMapDocumentV1`；解密成功后仍必须执行本规范的 Schema 与语义验证。

### 5.9 To-do 与 Task

    interface TopicTodo extends EntityBase<TodoId> {
      topicId: TopicId;
      completed: boolean;
      completedAt?: ISODateTime;
    }

To-do 是轻量复选状态；父主题的圆形进度由结构子级 To-do 计算，不持久化重复百分比。TopicTodo 与 TopicTask 是两个独立实体，同一 Topic 可以按产品规则同时拥有二者，但 To-do 永远不获得日期、依赖或 Gantt 语义。

    interface TopicTask extends EntityBase<TaskId> {
      topicId: TopicId;
      status:
        | "not-started"
        | "in-progress"
        | "blocked"
        | "done"
        | "cancelled";
      progress: number;
      priority?: 1 | 2 | 3 | 4 | 5;
      startDate?: string;
      dueDate?: string;
      durationMinutes?: number;
      milestone?: boolean;
      assigneeIds?: ActorId[];
      displayFields?: Array<
        | "status"
        | "progress"
        | "priority"
        | "assignees"
        | "start-date"
        | "due-date"
        | "duration"
        | "dependencies"
        | "creator"
      >;
    }

    interface TaskDependency extends EntityBase<TaskDependencyId> {
      predecessorTaskId: TaskId;
      successorTaskId: TaskId;
      type:
        | "finish-start"
        | "start-start"
        | "finish-finish"
        | "start-finish";
      lagMinutes?: number;
    }

    interface WorkCalendar {
      timeZone: string;
      weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      workingWeekdays: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
      workdayMinutes: number;
      skipNonWorkingDays: boolean;
      exceptions: Record<CalendarExceptionId, WorkCalendarException>;
    }

    interface WorkCalendarException extends EntityBase<CalendarExceptionId> {
      orderKey: OrderKey;
      title?: string;
      startDate: string;
      endDate?: string;
      type: "working-day" | "day-off";
      repeat: "none" | "daily" | "weekly" | "monthly" | "yearly";
    }

工作日历属于 Sheet，所有 Task 与 Gantt 共用同一套 IANA 时区、工作日和例外规则；`skipNonWorkingDays=false` 时仍保留日历设置但排期不跳过非工作日。day-off 表示假日/休息日，working-day 可表示补班；日期范围与重复规则按该 Sheet 时区展开。`displayFields` 只控制 Topic 上的呈现，不改变 Task 计算语义。

Task 导出必须使用稳定的外部映射而不是泄露内部 `TaskId`：CSV 的 Task ID = `Topic.topicId`，层级路径以 `/` 连接转义后的 Topic title，依赖写作“前置 Topic ID + FS/SS/FF/SF”，多人或多依赖以逗号加空格分隔。ICS 只包含具有 startDate 的 TopicTask，轻量 TopicTodo 永不进入 Task CSV/ICS。导入无作者的 legacy/第三方 Task 时创建一个确定 ID、`displayName="Unknown"`、`status="deactivated"` 的 ActorSnapshot，并将 Task.audit.createdBy 指向它；不得因显示 creator 而产生悬空引用。

### 5.10 Presentation 与 SavedView

    interface PresentationDeck extends EntityBase<PresentationId> {
      sheetId: SheetId;
      name: string;
      aspectRatio: "16:9" | "4:3" | "custom";
      customSize?: Size;
      themeId?: ThemeId;
      settings: {
        generationMode: "auto" | "manual";
        delivery: "walk-through" | "drill-down" | "slide-show";
        layout: "auto" | "map-focus" | "content-card";
        transition: "none" | "fade" | "pan" | "zoom";
        animationsEnabled: boolean;
        includedTopicIds?: TopicId[];
        excludedTopicIds?: TopicId[];
      };
      slides: Record<SlideId, PresentationSlide>;
    }

    interface PresentationSlide extends EntityBase<SlideId> {
      orderKey: OrderKey;
      title?: string;
      target:
        | { kind: "sheet"; sheetId: SheetId }
        | {
            kind: "topic";
            sheetId: SheetId;
            topicId: TopicId;
            includeDescendants: boolean;
          }
        | { kind: "boundary"; sheetId: SheetId; boundaryId: BoundaryId }
        | { kind: "zone"; sheetId: SheetId; zoneId: ZoneId }
        | { kind: "frame"; sheetId: SheetId; rect: Rect };
      camera?: { padding: number; zoom?: number };
      transition?: {
        type: "none" | "fade" | "pan" | "zoom";
        durationMs: number;
      };
      speakerNotes?: RichText;
      narrationAudioId?: AudioId;
      imageOverrides?: Record<
        ImageId,
        {
          position: { xRatio: number; yRatio: number };
          size?: Size;
          crop?: Rect;
        }
      >;
      builds: Record<BuildId, PresentationBuild>;
    }

    interface PresentationBuild extends EntityBase<BuildId> {
      orderKey: OrderKey;
      target:
        | { kind: "topic"; topicId: TopicId }
        | { kind: "relationship"; relationshipId: RelationshipId };
      animation: "appear" | "fade" | "draw" | "emphasize";
    }

    interface SavedView extends EntityBase<SavedViewId> {
      orderKey: OrderKey;
      name: string;
      sheetId: SheetId;
      viewport: { x: number; y: number; zoom: number };
      focusedBranchRootId?: TopicId;
      foldOverrides?: Record<TopicId, boolean>;
      selection?: ElementRef[];
      filters?: FilterExpression;
    }

SavedView 是明确由用户保存、可共享的视图快照。当前临时 viewport 仍属于 View sidecar。SavedView 可以保存 sheet、viewport、focused branch、fold overrides、selection 和 filter，但不得保存 hover/editing/presence。

## 6. ViewState sidecar

ViewState 不放入 canonical document，不进入内容 revision，不参与导出，也不应触发协作广播。

    interface MindMapViewStateV1 {
      schema: "app.nmdd.mindmap-view-state";
      schemaVersion: 1;
      documentId: DocumentId;
      userId?: ActorId;
      activeSheetId: SheetId;
      sheets: Partial<Record<SheetId, SheetViewState>>;
      activePresentationId?: PresentationId;
      activeSlideId?: SlideId;
    }

    interface SheetViewState {
      viewport: { x: number; y: number; zoom: number };
      selection: ElementRef[];
      focusedBranchRootId?: TopicId;
      foldOverrides?: Record<TopicId, boolean>;
      panel?:
        | "none"
        | "format"
        | "marker"
        | "task"
        | "outline"
        | "search";
      searchQuery?: string;
      filters?: FilterExpression;
    }

    type FilterExpression =
      | { op: "predicate"; kind: string; value: string }
      | { op: "all" | "any"; clauses: FilterExpression[] }
      | { op: "not"; clause: FilterExpression };

    type ElementRef =
      | { kind: "topic"; id: TopicId }
      | { kind: "relationship"; id: RelationshipId }
      | { kind: "boundary"; id: BoundaryId }
      | { kind: "summary"; id: SummaryId }
      | { kind: "callout"; id: CalloutId }
      | { kind: "zone"; id: ZoneId };

过期 selection 或 focus 引用应在读取 ViewState 时丢弃，不能让文档加载失败。

必须排除出 canonical document 的当前 UI 字段：

- React Flow selected；
- editing 和 editNonce；
- preview edge；
- selection box；
- hover；
- context menu 坐标；
- measured width/height；
- fullscreen；
- viewport transform；
- presence cursor。

## 7. Collaboration Metadata

协作元数据可保存 provider、remoteDocumentId、serverRevision、snapshot hash、logical clock、最后命令 ID、访问策略引用和评论线程。

    interface CollaborationMetadata {
      mode: "single-user" | "server-revision" | "crdt";
      remote?: {
        provider: string;
        remoteDocumentId: string;
        serverRevision?: string;
        baseSnapshotHash?: string;
      };
      logicalClock?: Record<ActorId, number>;
      lastCommandId?: CommandId;
      accessPolicyRef?: string;
      commentThreads?: Record<CommentThreadId, CommentThread>;
      extensions?: ExtensionBag;
    }

    interface ActorSnapshot extends EntityBase<ActorId> {
      displayName: string;
      email?: string;
      avatarAssetId?: AssetId;
      externalRef?: { provider: string; subject: string };
      status: "active" | "deactivated";
    }

    type CommentAnchor =
      | ElementRef
      | { kind: "canvas"; sheetId: SheetId; point: Point };

    interface CommentThread extends EntityBase<CommentThreadId> {
      anchor: CommentAnchor;
      resolved: boolean;
      orphaned: boolean;
      comments: Record<CommentId, Comment>;
    }

    interface Comment extends EntityBase<CommentId> {
      authorId: ActorId;
      body: RichText;
      replyToId?: CommentId;
    }

不得写入 canonical JSON：

- access token、cookie、密钥；
- WebSocket 会话信息；
- 实时 presence 与鼠标位置；
- 完整 CRDT 二进制状态；
- 仅本机有效的绝对文件路径。

协作 undo 必须使用 selective/operation-aware undo，不能恢复整张旧快照并覆盖其他用户的新修改。删除实体的短期 tombstone 属于 canonical 文档外部的 operation store/同步 sidecar，只保存恢复与并发去重所需的最小字段；它不进入 `MindMapDocumentV1`、普通导出或本文 JSON Schema。需要长期审计时由版本服务独立保存。

## 8. 领域不变量

JSON Schema 只验证形状。以下约束必须由第二阶段 semantic validator 保证。

### 8.1 Document 与引用

- 至少一个 Sheet 和一个 Theme；
- Record key 必须等于实体 id；
- 全文档所有实体 ID 全局唯一；
- 所有活动实体引用必须存在并属于正确 Sheet；仅 `TopicLink.status="broken"`、`CommentThread.orphaned=true` 与独立 tombstone/迁移报告可以保留已删除目标的历史 ID；
- TreeEdge、Relationship 不得跨 Sheet；
- extensions key 必须是产品命名空间；
- 时间、坐标、尺寸必须有限且处于实现上限内。

### 8.2 Tree

- 每个 Sheet 恰好一个 rootTopicId；
- root 存在、role 为 central、没有入 TreeEdge；它也是该 Sheet 唯一允许 `role="central"` 的 Topic，其他 Topic 不得伪装为第二个中心主题；
- TreeEdge 整体构成无环森林，而不是强制所有 Topic 都连到 Central；Central、floating-root 和 summary-result 可以分别成为结构分量根；
- TreeEdge 两端只能是 Topic；
- 不允许自环、重复 parent/child 或有向环；
- regular Topic 恰好一个入 TreeEdge；
- floating-root Topic 没有入 TreeEdge；
- summary-result Topic 没有普通入 TreeEdge，并被一个且仅一个 Summary 拥有；
- placement 与 role 必须匹配：floating-root 只能 absolute；central 可 auto/offset/absolute（absolute 用于完整地图平移/迁移）；regular 通常 auto/offset，只有控制分支 mode=manual 或 freePositioning=true 时可 absolute；summary-result 只能 auto/offset，其基准是 Summary 锚点；offset 的基准必须可解析；
- 同一 Topic 最多一个普通父级；
- 同一 parent + side + slot 内 orderKey 唯一；
- 双向 Mind Map 的根直接子边必须显式为 left/right；
- 自动布局只能读取 TreeEdge；
- side、orderKey、structure 不得由坐标反向覆盖。
- `Sheet.defaultBranchLayout.structure/direction` 必须是完全解析值，禁止 `inherit`；只有 Topic/Theme 的局部布局覆盖可以使用 inherit。
- freePositioning 只允许在解析后的 `core:mind-map` 分支启用；justifyTopicAlignment、flexibleFloatingTopics 与 allowTopicOverlap 都是可撤销的 canonical 设置，关闭后恢复自动布局必须先预览确认再原子提交；Topic.placement 保存结果但不替代这些能力开关。
- 每个 structure/direction/variantId/options 组合必须通过当前文档 reader 所锁定的 capability registry；内置结构不接受未注册 variant/options，extension 缺 descriptor 时文档进入只读降级而不是猜测布局。

### 8.3 Relationship

- source/target 引用的 Topic、Boundary、Callout 或 Zone 必须存在，两个端点不得引用同一实体；
- 合法组合只有 Topic↔Topic、Boundary→Topic，以及任一端为 Zone 且另一端为 Topic/Boundary/Callout/Zone；Callout↔Callout、Boundary↔Boundary、Callout↔Topic 等组合必须在命令层拒绝；
- 同一对合法端点可有多条不同 Relationship；
- 端点实体删除事务必须同时删除活动 Relationship；需要恢复的信息只能进入 tombstone/迁移报告，不能在有效 `relationships` 集合中留下悬空引用；
- Relationship 不参与子树、折叠、层级导航、Tree delete 或自动布局。

### 8.4 Boundary、Summary、Callout、Zone

- Boundary/Summary 的 scope 非空且引用有效 Topic；
- sibling-range 的 first/last TreeEdge 必须拥有同一 parent、解析后 side 与 slot；范围是该排序作用域中按 orderKey 的连续闭区间；跨 parent/side/slot 选择必须先拆成多个 Boundary/Summary；
- Boundary 创建选择不得包含 central；单个 floating-root 可归一化为 subtree，但同一创建事务选择两个或以上 floating-root 时必须零事务拒绝；summary-result 可作为合法 Boundary scope 成员。该限制只约束用户创建选择，结构变更后的既有 Boundary 仍按变更前成员意图执行收缩、拆分或删除；
- Summary result 不在自身 scope 内；
- 一个 summary-result 不得被多个 Summary 共享；
- Summary scope 不得包含 central 或 summary-result；主树选择必须按同一 parent + resolved side + slot 的连续 sibling-range 分组，跨分支生成多个独立组；单个 floating-root 可单独创建 Summary，两个及以上 floating-root 的选择必须零事务拒绝，且不得与 Central 主树混成一个范围；
- 新建 Boundary/Summary 优先使用 subtree 或 sibling-range；
- explicit 主要用于旧数据兼容；
- Zone.rootTopicIds 唯一且可为空；非空项只能引用没有入边、role 为 floating-root 的 Topic，Central、regular、summary-result 都不能成为 Zone 根；空 Zone 是 Clear Content 或用户新建空区域后的合法状态，继续保留 rect/title/style/relationships；
- 同一个 floating-root 最多属于一个 Zone；Zone 允许几何重叠，但不得形成重复 membership 或嵌套所有权；
- Zone.rect 的 width/height 均不得小于 100；手动 resize 后 autoResize=false，Resize to Fit 是一次性命令而非第二个持久布尔值；
- 移动 Zone 必须原子移动 rect 与所有 rootTopicIds；collapsed 只影响可见性，Remove Zone 保留内容，Clear Content 删除内容、清空 rootTopicIds、关闭 autoResize 并保留 Zone 的 rect/title/style/relationships；
- Zone.zOrderKey 在 Sheet 内唯一且稳定；Boundary/Summary 的 overlay x/y/w/h 仅是派生缓存，Zone.rect 除外。

范围与锚点对象使用下表作为唯一级联合同。所有“拆分”所需新 ID 必须由 command planner 预先放入 payload；reducer 不得临时随机生成 ID。

| 触发动作 | 同事务级联结果 |
|---|---|
| 删除 Boundary | 删除 Boundary 及以它为端点的 Relationship；范围内 Topic、资源和 TreeEdge 保留 |
| Boundary 范围内 Topic 被删除/换父级/换 side/slot | 以变更前展开的成员集为意图，删除失效成员并按合法连续范围重新分组；0 组删除 Boundary，1 组原 ID 收缩，N 组由原 ID 保留第一组并创建 N-1 个同标题/样式 Boundary |
| 删除 Callout 锚点 Topic | 删除 Callout 及以它为端点的 Relationship；其他 Topic 不受影响 |
| `summary.delete`（选中 Summary 后按 Delete，或右键 Summary → Delete）；canonical 层直接删除 result Topic | 删除 Summary、result Topic 的完整结构子树、附属内容及失效 Relationship；公开编辑器不弹出确认或 detach 分支，整个动作形成一个历史项 |
| 修复/导入遇到孤立 `summary-result` | repair/migration 可把该 Topic 原子转为 `floating-root` 并以当前派生坐标写入 absolute placement，保留其子树、内容和合法 Relationship；这不是公开编辑命令，不得出现在工具栏、右键菜单或快捷键中 |
| Summary scope 成员被删除/移动 | 以变更前展开的成员集重新归一化；0 组执行 `summary.delete`，1 组原 ID 收缩；出现多组时命令提交前显示“拆分概要”预览，原 Summary/result 保留第一组，其余组各创建新 Summary 与复制后的 result 子树，并完整重映射内部 ID/引用 |
| 删除 Zone | 仅允许显式选择 `removeKeepContent` 或 `clearKeepZone`，行为见上方 Zone 不变量；通用 delete 不得猜测 |

Theme、StyleDefinition 与 ThemeRule 同样禁止悬空引用：当前 Sheet 使用的 Theme 只能在同一事务提供 replacement Theme 后删除；删除 StyleDefinition 必须选择 replacement Style，或把解析后的属性 materialize 到每个引用实体的 override 后再删；删除 ThemeRule 只移除该规则并触发确定性重解析。以上操作都必须可撤销且不得改变不相关 override。

### 8.5 Style、内容和资源

- basedOnStyleId 图无环，style scope 与目标实体匹配；
- Relationship.routing/startArrow/endArrow 是关系线形状与端点的唯一 canonical 真相；relationship scope 的 StyleBinding 只可覆盖 connector color/width/dash，不得携带 shape/startCap/endCap/taper/colorMode/palette；这些 connector 字段只服务 TreeEdge/分支样式；
- Theme token/style 引用存在且无循环；
- MarkerInstance 引用有效 Topic/Definition；
- MarkerDefinition 必须引用有效 MarkerGroup；Group/Definition 的 orderKey 在各自作用域唯一；builtin group 不可被删除，custom group 支持 CRUD/reorder；
- 同一 Topic 在 `MarkerGroup.exclusive=true` 的组内最多一个 Marker，新标记原子替换旧标记；非互斥组可叠加；
- MarkerLegend.itemOrder 只能引用当前文档 MarkerDefinition 且不可重复；其 position 是可导出内容坐标，visible=false 时仍保留用户布局；
- Note、Link、Attachment、Image、Equation、Audio、To-do、Task 的 Topic 存在；
- Image Asset MIME 为 image/*，Audio Asset MIME 为 audio/*；
- 每个 RichInline.text 的 marks 按 `bold,italic,underline,strike,code,color,fontFamily,fontSize,textTransform,link` 规范顺序保存；每种 type 至多一个，布尔 mark 不重复，link 至多一条；冲突输入在命令边界显式归一化或拒绝，禁止用数组先后实现隐式 last-wins；
- Image/Sticker placement 必须有限；公开的普通 Local Image 只允许 top/bottom，Sticker/Illustration 允许 top/bottom/left/right；overlay 仅用于历史迁移或内部合成，不得作为 XMind Local Image/Sticker 的公开位置选项；background 忽略主题方位但不得丢失其规范默认值；
- Asset sha256 与 blob 一致；
- embedded relativePath 不得为绝对路径或包含 ..；
- URL 通过 scheme allowlist，拒绝 javascript 等危险 scheme；
- `TopicLink.status="active"` 的内部目标必须存在；目标删除时原子转换为可见的 `broken` 状态，broken link 不得执行导航且必须提供修复/删除入口；
- Link 是严格判别联合：web/email/file/folder 只使用 href；sheet/topic/document-page 只使用结构化 target，禁止同时保存派生 href；`document-page` 必须含非空 documentId/pageId；broken 内部 Link 可保留原 target ID 供修复但不得导航；
- 插入 Attachment 或 Audio Note 必须原子创建一个可选中的子 Topic，再让资源实体指向该新 Topic；Audio Note Topic 最多一个 AudioClip 且不得同时拥有 TopicLink；导入冲突时把 Audio 移到新建子 Topic、保留原 Topic 的 Link 并写迁移报告；
- Attachment/Audio Note 的用户可见名称唯一取关联 Topic.title；Asset.fileName 保存原始资源文件名，资源实体不再重复 displayName/title。重命名只发 topic.rename，导出器从 Topic.title 取展示名；
- childNumbering 只为直接结构子级生成展示编号，编号不得写回 RichText；插入、删除、重排后按 TreeEdge.orderKey 即时重算；
- 每个 Topic 最多一个主 Note、一个 To-do 和一个 Task；
- To-do 父级进度只由可计入的结构子级计算；批量完成子项必须是一个原子命令，不能写入 Task 日期/依赖字段；
- `completedAt` 仅在 To-do 已完成时存在；取消完成必须清除该时间；
- Task progress 为 0..1，不能依赖自己，依赖图无环；
- status/progress 必须一致：done=1、not-started=0、in-progress 严格处于 0..1 之间；blocked/cancelled 可保留未完成进度。直接设置 progress 时 reducer 自动同步普通 status，只有显式命令可设 blocked/cancelled；
- start/due/duration 互相一致；displayFields 唯一且只影响显示；
- WorkCalendar.timeZone 必须是 IANA 标识，workingWeekdays 唯一且非空，workdayMinutes 为正；exception key=id、范围合法且 orderKey 唯一；日期推导统一使用该 Sheet 的开关、工作日与 working-day/day-off 例外。多个例外命中同一日期时，`repeat=none` 优先于重复规则、较短日期范围优先于较长范围、仍相同则较大 orderKey 胜出；重排会改变最终日历，必须预览受影响 Task。

### 8.6 Presentation、SavedView 与协作

- Slide/SavedView target 全部存在；
- Sheet.defaultSavedViewId 若存在，必须指向同 Sheet 的 SavedView；一个 Sheet 只有这一条默认指针，保存另一个默认视图必须原子替换；
- Deck 内 Slide orderKey 唯一；
- SavedView.orderKey 在同一 Sheet 内唯一；并发碰撞按 SavedView ID 作最终 tie-break，显式 reorder 使用一个原子命令生成新 key；
- PresentationDeck.sheetId 必须存在；其 Slide target、includedTopicIds、excludedTopicIds 全部属于该 Sheet，include/exclude 不可重叠；显式 slides 与自动生成策略的优先级必须确定；
- 每个 Sheet 最多一个 PresentationDeck；进入 Pitch 时按 sheetId 唯一查找，0 个则从当前 Sheet 显式创建，重复 Deck 是语义校验错误，禁止按 Record 遍历顺序猜测；
- playback/PDF/PPT 永远只读取按 orderKey 排序的 canonical slides。generationMode=auto 时，任何影响层级/过滤/settings 的成功命令必须在同一事务中用确定性编译器更新 slides，并按稳定 target key 保留 speakerNotes/imageOverrides/builds；manual 时树编辑不重排 slides，只有显式 deck.regenerate 才使用 delivery/include/exclude 重建。两种模式都不得在播放时另算第二套顺序；
- Slide.imageOverrides 只可引用该 Slide 目标范围内的 TopicImage；比例坐标在 0..1，override 只改变 Pitch 页面，不反写脑图 TopicImage.placement；
- narrationAudioId 指向有效 Audio；
- ActorSnapshot 作为离线显示快照保留；Task assignee、Comment author 与 audit ActorId 必须可解析，离职用户使用 deactivated 而不删除；
- TopicTask.displayFields 含 creator 时，Task.audit.createdBy 必须存在并解析到 ActorSnapshot；legacy/导入缺失作者使用固定 Unknown ActorSnapshot，而不是空白、当前登录用户或加载时间；
- FilterExpression 的 all/any clauses 非空、递归深度受限；predicate kind 必须在 registry 注册，未知扩展按可见降级处理而不是静默变成真/假；
- 元素评论 anchor 删除后显式标记 orphaned；画布评论的 sheetId 必须存在且坐标有限；
- presence 不进入文档历史；
- ViewState 的过期引用只能影响该用户视图。

## 9. 命令模型

UI 不得直接 setNodes/setEdges 覆盖 canonical model。所有变更通过领域命令：

    interface CommandEnvelope<TType extends string, TPayload> {
      commandId: CommandId;
      documentId: DocumentId;
      actorId: ActorId;
      issuedAt: ISODateTime;
      type: TType;
      payload: TPayload;
      baseRevision?: number;
      transactionId?: string;
      undoOf?: CommandId;
      preconditions?: CommandPrecondition[];
    }

    type CommandPrecondition =
      | { kind: "entity-exists"; id: string }
      | {
          kind: "entity-revision";
          id: string;
          revision: number;
        }
      | {
          kind: "tree-parent-is";
          topicId: TopicId;
          parentTopicId?: TopicId;
        };

必须实现的命令族：

- document.migrate；
- sheet.create、rename、move、delete、duplicate；
- topic.createChild、createSibling、createFloating、insertParent；
- topic.rename、setRichText、move、reorder、changeSide；
- topic.setBranchLayout、setPlacement、setSizing、setChildNumbering、setLabels、fold；setLabels 在命令边界完成 trim、空值拒绝、去重与稳定顺序；
- topic.deleteNodeOnly、deleteSubtree、promoteChildren；
- relationship.create、update、delete；
- boundary/summary/callout/zone 的 create、update、delete；Zone 另有 move、resize、resizeToFit、setCollapsed、bringForward、sendBackward、removeKeepContent、clearKeepZone；
- canvas.patch、layout.patchAdvanced；
- theme.create、update、delete、sheet.setTheme；themeRule.create、update、reorder、delete；styleDefinition.create、update、delete；style.apply、patch、reset、copy；Theme/Style 删除必须携带 replacement 或 materialize 策略并在同一事务修复全部引用；
- markerGroup.create、rename、reorder、delete；markerDefinition.create、update、reorder、delete；marker.attach、update、detach；markerLegend.patch、move、reorderItems；builtin group 禁止删除，删除 custom group/definition 时必须确认并在一个事务中删除其 definitions/instances，资源按引用计数进入可撤销垃圾回收；MarkerLegend 拖动仅在 pointerup 提交一个 move 命令；
- note/link/attachment/image/equation/audio/todo/task 的 CRUD；To-do 另有 bulkApply、bulkRemove、bulkSetCompleted、bulkSetDescendants，所有目标先归一化去重并以一个事务提交；
- taskDependency.create、delete；
- calendar.patch、calendarException.create/update/delete/reorder；日历变化与所有受影响 Task 日期重算属于一个原子、可撤销命令组，提交前显示 diff；
- presentation/slide/build 的 CRUD 与 reorder；
- view.create、view.update、view.reorder、view.apply、view.setDefault、view.delete；update 显式承担 rename/filters/viewport/focus/fold patch，reorder 只改同 Sheet orderKey；删除默认 SavedView 必须同一事务清除 Sheet.defaultSavedViewId；
- batch；
- rebalanceOrder。

命令执行必须遵循：

1. 检查权限与 precondition；
2. 读取当前索引；
3. reducer 生成 next state；
4. 执行引用和语义验证；
5. 生成 inverse command 或协作 operation；
6. 原子提交；
7. 增加 contentRevision；
8. 持久化并通知投影层。

topic.move 必须在一个事务内更新父 TreeEdge、side、slot、orderKey 和受影响的 Boundary/Summary scope。拖动过程中只更新 ephemeral preview，pointer up 才提交一个命令。

Delete Topic 和 Delete Branch 必须是不同命令。复制分支必须先生成完整 ID map，再写入任何实体。

单机撤销保存 inverse command，不保存完整 nodes/edges 快照。协作撤销只撤销本 actor 的目标 operation。

## 10. Legacy nodes + edges 迁移

当前持久化结构为：

    {
      nodes: [
        {
          id,
          type: "mindMap" | "boundary" | "summary",
          position,
          data
        }
      ],
      edges: [
        {
          id,
          source,
          target,
          type,
          style,
          data
        }
      ]
    }

已知字段：

- mindMap.data 只有 label、bold；
- boundary.data 有 memberIds、padding、w、h；
- summary.data 有 memberIds、padding、h、label；
- Relationship 依赖 edge.data.kind === "link"；
- TreeEdge 与 Relationship 当前混在 edges；
- 数据可能是 object、JSON string、URI 编码或 HTML entity 编码 string。

### 10.1 迁移步骤

所有原生创建与迁移构造器必须读取版本化、不可变的 defaults registry；JSON Schema 的 `default` 只会是 annotation，禁止把它当作补字段执行器。`V1_DEFAULTS["new-v1@2026-07-18"]` 至少冻结：

| 构造器 | 固定 canonical 默认值（ID/引用由 command payload 显式提供） |
|---|---|
| Document | 空 `assets/styles/markerGroups/markerDefinitions/presentations/savedViews/actors`；一个 Default Theme |
| Default Theme | `{name:"Default", tokens:{}, defaultStyles:{}, rules:{}}` |
| Sheet | `defaultBranchLayout={structure:"core:mind-map",direction:"both",mode:"auto"}`；`advancedLayout={flexibleFloatingTopics:false,allowTopicOverlap:false}`；`canvas={background:{kind:"solid",color:{kind:"literal",value:"#FFFFFF"}}}`；下述固定 WorkCalendar 与 MarkerLegend |
| WorkCalendar | `{timeZone:"Etc/UTC",weekStartsOn:1,workingWeekdays:[1,2,3,4,5],workdayMinutes:480,skipNonWorkingDays:false,exceptions:{}}` |
| MarkerLegend | `{visible:false,position:{x:0,y:0}}` |
| Topic | `title={type:"doc",version:1,blocks:[{type:"paragraph",children:[]}]}`；`placement={mode:"auto"}`；`sizing.width={mode:"fit"}`；`defaultCollapsed=false` |
| Equation | `syntax="latex"`、`display="inline"`、`scale=1` |
| TopicTodo / TopicTask | Todo=`completed:false`；Task=`status:"not-started",progress:0` |
| PresentationDeck | `name="Presentation"`、`aspectRatio="16:9"`、settings=`{generationMode:"auto",delivery:"walk-through",layout:"auto",transition:"fade",animationsEnabled:true}`；同一创建事务运行确定性 slide compiler，提交时写出完整 `slides` |

调用方可以在 command payload 显式覆盖合法默认值；构造器提交前必须写出完整 required 字段。相同 payload + defaultsVersion 必须生成规范化等价 JSON，测试覆盖新建 Document/Sheet/Topic/Equation/Todo/Task/Deck，不能读取宿主当前语言、时区或随机 Theme。

迁移实现另导出不可变的 `V1_DEFAULTS["legacy-v0@2026-07-18"]`，不得读取浏览器语言、操作系统时区或当前 Theme 作为隐式默认值：

| 新增必填字段 | v0 → v1 固定值 |
|---|---|
| Document maps | `assets/styles/markerGroups/markerDefinitions/presentations/savedViews/actors={}`；创建 `{name:"Migration Default",tokens:{},defaultStyles:{},rules:{}}` 并写入 `themes` |
| Sheet.defaultBranchLayout | `{structure:"core:mind-map", direction:"both", mode:"manual"}`，使旧 regular Topic 的 absolute placement 合法并保留手工坐标 |
| Sheet.advancedLayout | `{flexibleFloatingTopics:false, allowTopicOverlap:false}` |
| Sheet.canvas | 白色 literal solid background，无 grid |
| Sheet.workCalendar | `Etc/UTC`、周一为周首、周一至周五、480 分钟、`skipNonWorkingDays=false`、`exceptions={}` |
| Sheet.markerLegend | `{visible:false, position:{x:0,y:0}}` |
| Topic 新字段 | `placement` 按下述坐标迁移；`sizing.width={mode:"fit"}`；`defaultCollapsed=false` |

同一 v0 payload 必须生成字节级规范化等价的 V1。迁移 UUIDv7 的时间位取 legacy createdAt（不存在则取该 defaults 版本固定 epoch），其余位由 `sha256(sourcePayloadHash + entityPath + defaultsVersion)` 派生；禁止调用当前时间或无种子随机数。defaults 版本、输入 hash 和 migration report 一并保存，以支持幂等重跑与问题复现。

1. 限制 payload 大小、nodes 数、edges 数，安全解析并保存原始 hash/不可变备份。
2. 创建 V1 Document/Sheet 和全部 UUIDv7，建立 legacyId -> newId 映射。
3. root ID 优先认定为中心主题；否则选无入结构边主题；仍不确定时按原数组首项并记录警告。
4. mindMap Node 转 Topic：label 转 RichText，bold 转 fontWeight:700，过滤 selected/editNonce/measured size。
5. 首次迁移按 role 与控制分支转换旧 position：floating/root 可用 absolute；regular 在迁移 Sheet 固定的 resolved manual layout 下使用 absolute，或在可重建基准时换算为 offset；若某局部分支改写为 hybrid/auto，则同一事务必须先把该分支所有 regular absolute placement 换算为 offset。summary-result 换算为相对 Summary 锚点的 offset。保证无损打开，自动布局必须由后续显式命令启用。
6. 严格分类边：
   - __mindmap_preview_edge__ 丢弃并记录；
   - data.kind === "link" 转 Relationship；
   - 其余先作为 TreeEdge candidate；
   - 非 Topic 端点、自环、指向 root、第二父级、成环边不得进入 treeEdges。
7. 非法 TreeEdge candidate 只有在两端都能映射到 RelationshipTargetRef、非自环且满足 8.3 合法 pair matrix 时，才降级为 Relationship 并输出 warning；其余进入隔离迁移报告并保留原始 edge payload/hash，不得生成随后会被 validator 拒绝的实体，也不得静默删除。
8. 每个 child 只接受一个合法父边。候选优先级按原 edges 顺序、目标视觉位置、legacy ID 固定。
9. 只在迁移时从坐标推导一次根子边 side：左侧为 left、右侧为 right，无法判断时使用确定性 tie-break 并记录警告。非根子边为 inherit。
10. 每个 parent + side + slot 分组按视觉轴、原数组顺序和 UUID 生成初始 OrderKey。
11. Boundary Node 转 Boundary：
    - 完整分支转 subtree；
    - 同父连续主题转 sibling-range；
    - 其他转 explicit；
    - padding 保留，position/w/h 丢弃或进入 legacy-geometry extension。
12. Summary Node 转 Summary，并创建 role 为 summary-result 的 Topic；旧 label 进入 Topic.title，旧几何相对迁移后 Summary 锚点换算为 `placement={mode:"offset", dx, dy}`，无法可靠换算时使用 auto 并写 `summary-geometry-fallback` 警告；禁止生成 summary-result absolute placement。
13. Relationship 的 stroke、strokeWidth、strokeDasharray、type、markerEnd 映射到中立 connector/routing/arrow 属性；无法映射字段进入 namespaced extension。
14. 运行 JSON Schema、引用完整性和全部领域不变量。
15. 生成迁移报告：ID map、preview edge、dangling ref、demoted relationship、multiple parent、cycle repair、scope fallback、unknown field。
16. 只有关键验证全部成功才原子写入 V1。运行期采用 dual-read、single-write：读取 legacy/V1，保存只写 V1。
17. 保留旧 payload 至少一个发布周期，用于诊断和回滚。

### 10.2 迁移后底线

无论一个 Topic 与多少其他主题存在 Relationship，删除、复制、折叠和布局一个分支时，只能影响 TreeEdge 定义的真实后代。

## 11. Schema 层实施顺序

1. 新建无 UI 依赖的 mindmap-domain 模块。
2. 落地 branded IDs、V1 TypeScript 类型和 RichText 模型。
3. 接入 mindmap.schema.json，并在 CI 校验所有 fixture。
4. 实现结构 validator 与 semantic validator，错误包含 code、entityId、JSON path、severity。
5. 建立 parentByTopic、childrenByParentSide、relationshipsByElement、contentByTopic、summaryByResultTopic 只读索引；relationshipsByElement 必须分别覆盖 Topic/Boundary/Callout/Zone。
6. 优先实现 Topic、TreeEdge、Relationship 命令 reducer。
7. 为每条命令定义 precondition、postcondition、inverse、cascade 和协作冲突策略。
8. 实现纯函数、幂等、可报告的 legacy migrator。
9. 实现 canonical -> React Flow 的单向 adapter；React Flow 拖动只产生 command，不得整体反写 nodes/edges。
10. 实现持久化 adapter、事务备份、dual-read/single-write。
11. 用现有真实 payload 建立迁移 fixture。
12. 添加 property-based tests：
    - 随机创建/移动/删除后树始终无环；
    - regular Topic 始终一个父级；
    - Relationship 永不改变 tree index；
    - 复制后无旧 ID 残留；
    - undo/redo 保持引用完整；
    - 并发插入保持稳定顺序。
13. 添加损坏数据测试：dangling edge、Relationship 自环/悬空端点、multiple parent、TreeEdge/TaskDependency/Style dependency cycle、edge 指向 overlay、summary member 丢失、重复 orderKey；普通 Relationship 图环必须保持合法。
14. Schema、迁移和命令层稳定后，再替换现有 MindMap UI。

## 12. JSON Schema 的边界

mindmap.schema.json 使用 Draft 2020-12。所有核心实体 additionalProperties:false，extensions 明确开放。

JSON Schema 能验证：

- 必填字段、枚举、长度、数值范围；
- discriminated union；
- UUIDv7、sha256、OrderKey 格式；
- Map value 结构；
- 核心对象未知字段。

JSON Schema 不能完整验证：

- Record key 等于 entity.id；
- 跨集合引用存在；
- 引用属于同 Sheet；
- parentTopicId 不等于 childTopicId；
- 树无环和单父级；
- 分组 orderKey 唯一；
- sibling-range 同父；
- Style/Task 依赖无环；
- MIME 与实际 blob 一致。

这些约束不得因为 JSON Schema 无法表达而省略，必须由 semantic validator 承担。
