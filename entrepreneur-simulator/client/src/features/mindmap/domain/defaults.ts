import type {
  ActorId,
  AdvancedLayoutSpec,
  Asset,
  AssetId,
  Attachment,
  AttachmentId,
  AudioClip,
  AudioId,
  Boundary,
  BoundaryId,
  CalendarExceptionId,
  Callout,
  CalloutId,
  CanvasSpec,
  EntityAudit,
  Equation,
  EquationId,
  ImageId,
  LinkId,
  MarkerDefinition,
  MarkerDefinitionId,
  MarkerGroup,
  MarkerGroupId,
  MarkerInstance,
  MarkerInstanceId,
  MarkerLegendSpec,
  MindMapDocumentV1,
  MindMapSheet,
  MindMapTheme,
  Note,
  NoteId,
  OrderKey,
  PresentationDeck,
  PresentationId,
  PresentationSettings,
  PresentationSlide,
  Relationship,
  RelationshipId,
  ResolvedBranchLayoutSpec,
  RichText,
  SavedView,
  SavedViewId,
  SheetId,
  SlideId,
  StyleDefinition,
  StyleId,
  Summary,
  SummaryId,
  TaskDependency,
  TaskDependencyId,
  TaskId,
  ThemeId,
  TodoId,
  Topic,
  TopicId,
  TopicImage,
  TopicLink,
  TopicRole,
  TopicTask,
  TopicTodo,
  TreeEdge,
  TreeEdgeId,
  Weekday,
  WorkCalendar,
  Zone,
  ZoneId,
} from './types';

export const NEW_V1_DEFAULTS_VERSION = 'new-v1@2026-07-18' as const;
export const LEGACY_V0_DEFAULTS_VERSION = 'legacy-v0@2026-07-18' as const;

type Atomic = string | number | boolean | bigint | symbol | null | undefined;

export type DeepReadonly<T> = T extends Atomic | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const BASE_WORK_CALENDAR = {
  timeZone: 'Etc/UTC',
  weekStartsOn: 1,
  workingWeekdays: [1, 2, 3, 4, 5],
  workdayMinutes: 480,
  skipNonWorkingDays: false,
  exceptions: {},
} satisfies WorkCalendar;

const BASE_MARKER_LEGEND = {
  visible: false,
  position: { x: 0, y: 0 },
} satisfies MarkerLegendSpec;

const BASE_ADVANCED_LAYOUT = {
  flexibleFloatingTopics: false,
  allowTopicOverlap: false,
} satisfies AdvancedLayoutSpec;

const BASE_CANVAS = {
  background: {
    kind: 'solid',
    color: { kind: 'literal', value: '#FFFFFF' },
  },
} satisfies CanvasSpec;

const NEW_BRANCH_LAYOUT = {
  structure: 'core:mind-map',
  direction: 'both',
  mode: 'auto',
} satisfies ResolvedBranchLayoutSpec;

const LEGACY_BRANCH_LAYOUT = {
  structure: 'core:mind-map',
  direction: 'both',
  mode: 'manual',
} satisfies ResolvedBranchLayoutSpec;

const EMPTY_RICH_TEXT = {
  type: 'doc',
  version: 1,
  blocks: [{ type: 'paragraph', children: [] }],
} satisfies RichText;

const PRESENTATION_SETTINGS = {
  generationMode: 'auto',
  delivery: 'walk-through',
  layout: 'auto',
  transition: 'fade',
  animationsEnabled: true,
} satisfies PresentationSettings;

const NEW_V1_TEMPLATE = {
  version: NEW_V1_DEFAULTS_VERSION,
  document: {
    schema: 'app.nmdd.mindmap',
    schemaVersion: 1,
    minimumReaderVersion: 1,
    contentRevision: 0,
    title: '',
    collectionKeys: [
      'assets',
      'styles',
      'markerGroups',
      'markerDefinitions',
      'presentations',
      'savedViews',
      'actors',
    ],
  },
  theme: {
    name: 'Default',
    tokens: {},
    defaultStyles: {},
    rules: {},
  },
  sheet: {
    defaultBranchLayout: NEW_BRANCH_LAYOUT,
    advancedLayout: BASE_ADVANCED_LAYOUT,
    canvas: BASE_CANVAS,
    workCalendar: BASE_WORK_CALENDAR,
    markerLegend: BASE_MARKER_LEGEND,
  },
  topic: {
    title: EMPTY_RICH_TEXT,
    placement: { mode: 'auto' },
    sizing: { width: { mode: 'fit' } },
    defaultCollapsed: false,
  },
  equation: {
    syntax: 'latex',
    display: 'inline',
    scale: 1,
  },
  todo: { completed: false },
  task: { status: 'not-started', progress: 0 },
  presentation: {
    name: 'Presentation',
    aspectRatio: '16:9',
    settings: PRESENTATION_SETTINGS,
  },
} as const;

const LEGACY_V0_TEMPLATE = {
  version: LEGACY_V0_DEFAULTS_VERSION,
  theme: {
    name: 'Migration Default',
    tokens: {},
    defaultStyles: {},
    rules: {},
  },
  sheet: {
    defaultBranchLayout: LEGACY_BRANCH_LAYOUT,
    advancedLayout: BASE_ADVANCED_LAYOUT,
    canvas: BASE_CANVAS,
    workCalendar: BASE_WORK_CALENDAR,
    markerLegend: BASE_MARKER_LEGEND,
  },
  topic: {
    sizing: { width: { mode: 'fit' } },
    defaultCollapsed: false,
  },
} as const;

/** Immutable registry metadata. Factories below always return mutable fresh data. */
export const V1_DEFAULTS = deepFreeze({
  [NEW_V1_DEFAULTS_VERSION]: NEW_V1_TEMPLATE,
  [LEGACY_V0_DEFAULTS_VERSION]: LEGACY_V0_TEMPLATE,
});

export interface NewV1DefaultSet {
  version: typeof NEW_V1_DEFAULTS_VERSION;
  defaultThemeName: 'Default';
  defaultBranchLayout: ResolvedBranchLayoutSpec;
  advancedLayout: AdvancedLayoutSpec;
  canvas: CanvasSpec;
  workCalendar: WorkCalendar;
  markerLegend: MarkerLegendSpec;
  topic: Pick<Topic, 'title' | 'placement' | 'sizing' | 'defaultCollapsed'>;
  equation: Pick<Equation, 'syntax' | 'display' | 'scale'>;
  todo: Pick<TopicTodo, 'completed'>;
  task: Pick<TopicTask, 'status' | 'progress'>;
  presentation: Pick<PresentationDeck, 'name' | 'aspectRatio' | 'settings'>;
}

export interface LegacyV0DefaultSet {
  version: typeof LEGACY_V0_DEFAULTS_VERSION;
  defaultThemeName: 'Migration Default';
  defaultBranchLayout: ResolvedBranchLayoutSpec;
  advancedLayout: AdvancedLayoutSpec;
  canvas: CanvasSpec;
  workCalendar: WorkCalendar;
  markerLegend: MarkerLegendSpec;
  topic: Pick<Topic, 'sizing' | 'defaultCollapsed'>;
}

export function createEntityAudit(input: {
  now: string;
  actorId?: ActorId;
}): EntityAudit {
  const audit: EntityAudit = {
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.actorId !== undefined) {
    audit.createdBy = input.actorId;
    audit.updatedBy = input.actorId;
  }
  return audit;
}

export function createRichText(text = ''): RichText {
  return {
    type: 'doc',
    version: 1,
    blocks: [
      {
        type: 'paragraph',
        children: text === '' ? [] : [{ type: 'text', text }],
      },
    ],
  };
}

export function createWorkCalendar(): WorkCalendar {
  return {
    timeZone: 'Etc/UTC',
    weekStartsOn: 1,
    workingWeekdays: [1, 2, 3, 4, 5] satisfies Weekday[],
    workdayMinutes: 480,
    skipNonWorkingDays: false,
    exceptions: {} as Record<CalendarExceptionId, never>,
  };
}

export function createMarkerLegend(): MarkerLegendSpec {
  return { visible: false, position: { x: 0, y: 0 } };
}

export function createCanvasSpec(): CanvasSpec {
  return {
    background: {
      kind: 'solid',
      color: { kind: 'literal', value: '#FFFFFF' },
    },
  };
}

export function createAdvancedLayoutSpec(): AdvancedLayoutSpec {
  return { flexibleFloatingTopics: false, allowTopicOverlap: false };
}

export function createDefaultBranchLayout(
  source: 'new-v1' | 'legacy-v0' = 'new-v1',
): ResolvedBranchLayoutSpec {
  return {
    structure: 'core:mind-map',
    direction: 'both',
    mode: source === 'new-v1' ? 'auto' : 'manual',
  };
}

export function createNewV1DefaultSet(): NewV1DefaultSet {
  return {
    version: NEW_V1_DEFAULTS_VERSION,
    defaultThemeName: 'Default',
    defaultBranchLayout: createDefaultBranchLayout('new-v1'),
    advancedLayout: createAdvancedLayoutSpec(),
    canvas: createCanvasSpec(),
    workCalendar: createWorkCalendar(),
    markerLegend: createMarkerLegend(),
    topic: {
      title: createRichText(),
      placement: { mode: 'auto' },
      sizing: { width: { mode: 'fit' } },
      defaultCollapsed: false,
    },
    equation: { syntax: 'latex', display: 'inline', scale: 1 },
    todo: { completed: false },
    task: { status: 'not-started', progress: 0 },
    presentation: {
      name: 'Presentation',
      aspectRatio: '16:9',
      settings: createPresentationSettings(),
    },
  };
}

export function createLegacyV0DefaultSet(): LegacyV0DefaultSet {
  return {
    version: LEGACY_V0_DEFAULTS_VERSION,
    defaultThemeName: 'Migration Default',
    defaultBranchLayout: createDefaultBranchLayout('legacy-v0'),
    advancedLayout: createAdvancedLayoutSpec(),
    canvas: createCanvasSpec(),
    workCalendar: createWorkCalendar(),
    markerLegend: createMarkerLegend(),
    topic: {
      sizing: { width: { mode: 'fit' } },
      defaultCollapsed: false,
    },
  };
}

export interface CreateThemeInput {
  id: ThemeId;
  name?: string;
  audit?: EntityAudit;
}

export function createTheme(input: CreateThemeInput): MindMapTheme {
  const theme: MindMapTheme = {
    id: input.id,
    name: input.name ?? 'Default',
    tokens: {},
    defaultStyles: {},
    rules: {},
  };
  if (input.audit !== undefined) theme.audit = { ...input.audit };
  return theme;
}

export interface CreateTopicInput {
  id: TopicId;
  role?: TopicRole;
  title?: string;
  placement?: Topic['placement'];
  audit?: EntityAudit;
}

export function createTopic(input: CreateTopicInput): Topic {
  const topic: Topic = {
    id: input.id,
    role: input.role ?? 'regular',
    title: createRichText(input.title),
    placement: input.placement === undefined ? { mode: 'auto' } : { ...input.placement },
    sizing: { width: { mode: 'fit' } },
    defaultCollapsed: false,
  };
  if (input.audit !== undefined) topic.audit = { ...input.audit };
  return topic;
}

export interface CreateEquationInput {
  id: EquationId;
  topicId: TopicId;
  orderKey: OrderKey;
  source: string;
  audit?: EntityAudit;
}

export function createEquation(input: CreateEquationInput): Equation {
  const equation: Equation = {
    id: input.id,
    topicId: input.topicId,
    orderKey: input.orderKey,
    syntax: 'latex',
    source: input.source,
    display: 'inline',
    scale: 1,
  };
  if (input.audit !== undefined) equation.audit = { ...input.audit };
  return equation;
}

export interface CreateTopicTodoInput {
  id: TodoId;
  topicId: TopicId;
  audit?: EntityAudit;
}

export function createTopicTodo(input: CreateTopicTodoInput): TopicTodo {
  const todo: TopicTodo = {
    id: input.id,
    topicId: input.topicId,
    completed: false,
  };
  if (input.audit !== undefined) todo.audit = { ...input.audit };
  return todo;
}

export interface CreateTopicTaskInput {
  id: TaskId;
  topicId: TopicId;
  audit?: EntityAudit;
}

export function createTopicTask(input: CreateTopicTaskInput): TopicTask {
  const task: TopicTask = {
    id: input.id,
    topicId: input.topicId,
    status: 'not-started',
    progress: 0,
  };
  if (input.audit !== undefined) task.audit = { ...input.audit };
  return task;
}

export function createPresentationSettings(): PresentationSettings {
  return {
    generationMode: 'auto',
    delivery: 'walk-through',
    layout: 'auto',
    transition: 'fade',
    animationsEnabled: true,
  };
}

export interface CreatePresentationDeckInput {
  id: PresentationId;
  sheetId: SheetId;
  slides: Record<SlideId, PresentationSlide>;
  audit?: EntityAudit;
}

export function createPresentationDeck(
  input: CreatePresentationDeckInput,
): PresentationDeck {
  const deck: PresentationDeck = {
    id: input.id,
    sheetId: input.sheetId,
    name: 'Presentation',
    aspectRatio: '16:9',
    settings: createPresentationSettings(),
    slides: { ...input.slides },
  };
  if (input.audit !== undefined) deck.audit = { ...input.audit };
  return deck;
}

type SheetCollections = Pick<
  MindMapSheet,
  | 'treeEdges'
  | 'relationships'
  | 'boundaries'
  | 'summaries'
  | 'callouts'
  | 'zones'
  | 'markerInstances'
  | 'notes'
  | 'links'
  | 'attachments'
  | 'images'
  | 'equations'
  | 'audioClips'
  | 'todos'
  | 'tasks'
  | 'taskDependencies'
>;

export function createEmptySheetCollections(): SheetCollections {
  return {
    treeEdges: {} as Record<TreeEdgeId, TreeEdge>,
    relationships: {} as Record<RelationshipId, Relationship>,
    boundaries: {} as Record<BoundaryId, Boundary>,
    summaries: {} as Record<SummaryId, Summary>,
    callouts: {} as Record<CalloutId, Callout>,
    zones: {} as Record<ZoneId, Zone>,
    markerInstances: {} as Record<MarkerInstanceId, MarkerInstance>,
    notes: {} as Record<NoteId, Note>,
    links: {} as Record<LinkId, TopicLink>,
    attachments: {} as Record<AttachmentId, Attachment>,
    images: {} as Record<ImageId, TopicImage>,
    equations: {} as Record<EquationId, Equation>,
    audioClips: {} as Record<AudioId, AudioClip>,
    todos: {} as Record<TodoId, TopicTodo>,
    tasks: {} as Record<TaskId, TopicTask>,
    taskDependencies: {} as Record<TaskDependencyId, TaskDependency>,
  };
}

export interface CreateMindMapSheetInput {
  id: SheetId;
  orderKey: OrderKey;
  rootTopicId: TopicId;
  themeId: ThemeId;
  title?: string;
  rootTitle?: string;
  source?: 'new-v1' | 'legacy-v0';
  rootPlacement?: Topic['placement'];
  audit?: EntityAudit;
}

export function createMindMapSheet(input: CreateMindMapSheetInput): MindMapSheet {
  const source = input.source ?? 'new-v1';
  const rootTopic = createTopic({
    id: input.rootTopicId,
    role: 'central',
    title: input.rootTitle,
    placement: input.rootPlacement,
    audit: input.audit,
  });
  const sheet: MindMapSheet = {
    id: input.id,
    orderKey: input.orderKey,
    title: input.title ?? '',
    rootTopicId: input.rootTopicId,
    themeId: input.themeId,
    defaultBranchLayout: createDefaultBranchLayout(source),
    advancedLayout: createAdvancedLayoutSpec(),
    canvas: createCanvasSpec(),
    workCalendar: createWorkCalendar(),
    markerLegend: createMarkerLegend(),
    topics: { [input.rootTopicId]: rootTopic } as Record<TopicId, Topic>,
    ...createEmptySheetCollections(),
  };
  if (input.audit !== undefined) sheet.audit = { ...input.audit };
  return sheet;
}

type DocumentCollections = Pick<
  MindMapDocumentV1,
  | 'assets'
  | 'styles'
  | 'markerGroups'
  | 'markerDefinitions'
  | 'presentations'
  | 'savedViews'
  | 'actors'
>;

export function createEmptyDocumentCollections(): DocumentCollections {
  return {
    assets: {} as Record<AssetId, Asset>,
    styles: {} as Record<StyleId, StyleDefinition>,
    markerGroups: {} as Record<MarkerGroupId, MarkerGroup>,
    markerDefinitions: {} as Record<MarkerDefinitionId, MarkerDefinition>,
    presentations: {} as Record<PresentationId, PresentationDeck>,
    savedViews: {} as Record<SavedViewId, SavedView>,
    actors: {} as Record<ActorId, never>,
  };
}

export interface CreateNewMindMapDocumentInput {
  documentId: MindMapDocumentV1['id'];
  sheetId: SheetId;
  rootTopicId: TopicId;
  themeId: ThemeId;
  sheetOrderKey: OrderKey;
  title?: string;
  sheetTitle?: string;
  rootTitle?: string;
  locale?: string;
  contentRevision?: number;
  audit?: EntityAudit;
}

export function createNewMindMapDocument(
  input: CreateNewMindMapDocumentInput,
): MindMapDocumentV1 {
  const theme = createTheme({ id: input.themeId, audit: input.audit });
  const sheet = createMindMapSheet({
    id: input.sheetId,
    orderKey: input.sheetOrderKey,
    rootTopicId: input.rootTopicId,
    themeId: input.themeId,
    title: input.sheetTitle,
    rootTitle: input.rootTitle,
    source: 'new-v1',
    audit: input.audit,
  });
  const document: MindMapDocumentV1 = {
    schema: 'app.nmdd.mindmap',
    schemaVersion: 1,
    minimumReaderVersion: 1,
    id: input.documentId,
    contentRevision: input.contentRevision ?? 0,
    title: input.title ?? '',
    sheets: { [input.sheetId]: sheet } as Record<SheetId, MindMapSheet>,
    themes: { [input.themeId]: theme } as Record<ThemeId, MindMapTheme>,
    ...createEmptyDocumentCollections(),
  };
  if (input.locale !== undefined) document.locale = input.locale;
  if (input.audit !== undefined) document.audit = { ...input.audit };
  return document;
}
