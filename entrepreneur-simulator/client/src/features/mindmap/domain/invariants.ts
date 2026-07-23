import type { ValidationIssue, ValidationSeverity } from './validation';

type JsonObject = Record<string, unknown>;

interface LocatedRecord {
  readonly key: string;
  readonly path: string;
  readonly value: JsonObject;
}

interface DirectedArc {
  readonly from: string;
  readonly path: string;
  readonly to: string;
}

interface SheetGraph {
  readonly edgeEntries: readonly LocatedRecord[];
  readonly edges: JsonObject;
  readonly incoming: ReadonlyMap<string, readonly LocatedRecord[]>;
  readonly outgoing: ReadonlyMap<string, readonly LocatedRecord[]>;
  readonly sheetId: string;
  readonly sheetPath: string;
  readonly sheet: JsonObject;
  readonly topics: JsonObject;
}

interface RegisteredEntity {
  readonly kind: string;
  readonly path: string;
  readonly value: JsonObject;
}

const ROOT_ENTITY_MAPS: ReadonlyArray<readonly [string, string]> = [
  ['sheets', 'sheet'],
  ['assets', 'asset'],
  ['styles', 'style'],
  ['themes', 'theme'],
  ['markerGroups', 'marker-group'],
  ['markerDefinitions', 'marker-definition'],
  ['presentations', 'presentation'],
  ['savedViews', 'saved-view'],
  ['actors', 'actor'],
];

const SHEET_ENTITY_MAPS: ReadonlyArray<readonly [string, string]> = [
  ['topics', 'topic'],
  ['treeEdges', 'tree-edge'],
  ['relationships', 'relationship'],
  ['boundaries', 'boundary'],
  ['summaries', 'summary'],
  ['callouts', 'callout'],
  ['zones', 'zone'],
  ['markerInstances', 'marker-instance'],
  ['notes', 'note'],
  ['links', 'link'],
  ['attachments', 'attachment'],
  ['images', 'image'],
  ['equations', 'equation'],
  ['audioClips', 'audio'],
  ['todos', 'todo'],
  ['tasks', 'task'],
  ['taskDependencies', 'task-dependency'],
];

const TOPIC_OWNED_MAPS: ReadonlyArray<readonly [string, string]> = [
  ['notes', 'note'],
  ['links', 'link'],
  ['attachments', 'attachment'],
  ['images', 'image'],
  ['equations', 'equation'],
  ['audioClips', 'audio'],
  ['todos', 'todo'],
  ['tasks', 'task'],
];

/** Must stay byte-for-byte aligned with `$defs.orderKey` in mindmap.schema.json. */
const CANONICAL_ORDER_KEY = /^[0-9A-Za-z._~-]{1,256}$/;

const ORDINARY_TOPIC_IMAGE_ROLES = new Set(['inline', 'thumbnail']);
const ORDINARY_TOPIC_IMAGE_SIDES = new Set(['top', 'bottom']);
const CANONICAL_TOPIC_IMAGE_SIDES = new Set([
  'top',
  'bottom',
  'left',
  'right',
  'overlay',
]);
const STICKER_TOPIC_IMAGE_SIDES = new Set([
  'top',
  'bottom',
  'left',
  'right',
  // Canonical compatibility for legacy migration/internal composition only.
  // Product UI must not expose overlay as an XMind Sticker placement option.
  'overlay',
]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectValue(owner: JsonObject, key: string): JsonObject {
  const value = owner[key];
  return isJsonObject(value) ? value : {};
}

function stringValue(owner: JsonObject, key: string): string | undefined {
  const value = owner[key];
  return typeof value === 'string' ? value : undefined;
}

function stringArray(owner: JsonObject, key: string): string[] {
  const value = owner[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function owns(owner: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(owner, key);
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function childPath(base: string, ...segments: readonly string[]): string {
  let result = base === '/' ? '' : base;
  for (const segment of segments) {
    result += `/${escapePointerSegment(segment)}`;
  }
  return result || '/';
}

function locatedRecords(map: JsonObject, mapPath: string): LocatedRecord[] {
  return Object.keys(map)
    .sort()
    .flatMap((key) => {
      const value = map[key];
      return isJsonObject(value)
        ? [{ key, path: childPath(mapPath, key), value }]
        : [];
    });
}

function sameOptionalString(left: unknown, right: unknown): boolean {
  return (typeof left === 'string' ? left : '') === (typeof right === 'string' ? right : '');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function backEdgesInDirectedGraph(
  nodes: readonly string[],
  arcs: readonly DirectedArc[],
): DirectedArc[] {
  const adjacency = new Map<string, DirectedArc[]>();
  for (const arc of arcs) {
    const outgoing = adjacency.get(arc.from) ?? [];
    outgoing.push(arc);
    adjacency.set(arc.from, outgoing);
  }
  for (const outgoing of adjacency.values()) {
    outgoing.sort((left, right) => compareText(left.path, right.path));
  }

  const state = new Map<string, 0 | 1 | 2>();
  const backEdges: DirectedArc[] = [];
  const visit = (node: string): void => {
    state.set(node, 1);
    for (const arc of adjacency.get(node) ?? []) {
      const targetState = state.get(arc.to) ?? 0;
      if (targetState === 1) {
        backEdges.push(arc);
      } else if (targetState === 0) {
        visit(arc.to);
      }
    }
    state.set(node, 2);
  };

  for (const node of [...nodes].sort()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node);
    }
  }
  return backEdges;
}

class InvariantValidator {
  private readonly actors: JsonObject;
  private readonly assets: JsonObject;
  private readonly document: JsonObject;
  private readonly entities: RegisteredEntity[] = [];
  private readonly entityById = new Map<string, RegisteredEntity>();
  private readonly issues: ValidationIssue[] = [];
  private readonly markerDefinitions: JsonObject;
  private readonly markerGroups: JsonObject;
  private readonly presentations: JsonObject;
  private readonly savedViews: JsonObject;
  private readonly sheets: JsonObject;
  private readonly styles: JsonObject;
  private readonly themes: JsonObject;

  constructor(document: JsonObject) {
    this.document = document;
    this.actors = objectValue(document, 'actors');
    this.assets = objectValue(document, 'assets');
    this.markerDefinitions = objectValue(document, 'markerDefinitions');
    this.markerGroups = objectValue(document, 'markerGroups');
    this.presentations = objectValue(document, 'presentations');
    this.savedViews = objectValue(document, 'savedViews');
    this.sheets = objectValue(document, 'sheets');
    this.styles = objectValue(document, 'styles');
    this.themes = objectValue(document, 'themes');
  }

  run(): ValidationIssue[] {
    this.registerAllEntities();
    this.validateAuditActorReferences();
    this.validateStyleAndThemeReferences();
    this.validateMarkers();

    for (const sheetEntry of locatedRecords(this.sheets, '/sheets')) {
      this.validateSheet(sheetEntry);
    }

    this.validateSavedViews();
    this.validatePresentations();
    this.validateComments();

    return [...this.issues].sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message),
    );
  }

  private addIssue(
    code: string,
    path: string,
    message: string,
    severity: ValidationSeverity = 'error',
  ): void {
    this.issues.push({ code, message, path, severity });
  }

  private registerAllEntities(): void {
    this.registerEntity(this.document, '/', 'document');

    for (const [mapName, kind] of ROOT_ENTITY_MAPS) {
      const map = objectValue(this.document, mapName);
      this.registerMap(map, childPath('/', mapName), kind);
    }

    for (const theme of locatedRecords(this.themes, '/themes')) {
      this.registerMap(
        objectValue(theme.value, 'rules'),
        childPath(theme.path, 'rules'),
        'theme-rule',
      );
    }

    for (const sheet of locatedRecords(this.sheets, '/sheets')) {
      for (const [mapName, kind] of SHEET_ENTITY_MAPS) {
        this.registerMap(
          objectValue(sheet.value, mapName),
          childPath(sheet.path, mapName),
          kind,
        );
      }

      const workCalendar = objectValue(sheet.value, 'workCalendar');
      this.registerMap(
        objectValue(workCalendar, 'exceptions'),
        childPath(sheet.path, 'workCalendar', 'exceptions'),
        'calendar-exception',
      );

      for (const relationship of locatedRecords(
        objectValue(sheet.value, 'relationships'),
        childPath(sheet.path, 'relationships'),
      )) {
        this.registerMap(
          objectValue(relationship.value, 'controlPoints'),
          childPath(relationship.path, 'controlPoints'),
          'relationship-control-point',
        );
      }
    }

    for (const deck of locatedRecords(this.presentations, '/presentations')) {
      const slides = objectValue(deck.value, 'slides');
      this.registerMap(slides, childPath(deck.path, 'slides'), 'presentation-slide');
      for (const slide of locatedRecords(slides, childPath(deck.path, 'slides'))) {
        this.registerMap(
          objectValue(slide.value, 'builds'),
          childPath(slide.path, 'builds'),
          'presentation-build',
        );
      }
    }

    const collaboration = objectValue(this.document, 'collaboration');
    const commentThreads = objectValue(collaboration, 'commentThreads');
    this.registerMap(commentThreads, '/collaboration/commentThreads', 'comment-thread');
    for (const thread of locatedRecords(commentThreads, '/collaboration/commentThreads')) {
      this.registerMap(
        objectValue(thread.value, 'comments'),
        childPath(thread.path, 'comments'),
        'comment',
      );
    }
  }

  private registerMap(map: JsonObject, mapPath: string, kind: string): void {
    for (const entry of locatedRecords(map, mapPath)) {
      const id = stringValue(entry.value, 'id');
      if (id !== entry.key) {
        this.addIssue(
          'invariant.entity.map-key-id',
          childPath(entry.path, 'id'),
          `Record key ${entry.key} must equal entity id ${id ?? '<missing>'}`,
        );
      }
      this.registerEntity(entry.value, entry.path, kind);
    }
  }

  private registerEntity(value: JsonObject, path: string, kind: string): void {
    const entity: RegisteredEntity = { kind, path, value };
    this.entities.push(entity);
    const id = stringValue(value, 'id');
    if (id === undefined) {
      return;
    }
    const previous = this.entityById.get(id);
    if (previous !== undefined && previous.value !== value) {
      this.addIssue(
        'invariant.entity.duplicate-id',
        childPath(path, 'id'),
        `Entity id ${id} is already used by ${previous.kind} at ${previous.path}`,
      );
      return;
    }
    this.entityById.set(id, entity);
  }

  private validateAuditActorReferences(): void {
    for (const entity of this.entities) {
      const audit = entity.value.audit;
      if (!isJsonObject(audit)) {
        continue;
      }
      for (const field of ['createdBy', 'updatedBy']) {
        const actorId = stringValue(audit, field);
        if (actorId !== undefined && !owns(this.actors, actorId)) {
          this.addIssue(
            'invariant.reference.actor',
            childPath(entity.path, 'audit', field),
            `Actor ${actorId} does not exist`,
          );
        }
      }
    }
  }

  private validateStyleAndThemeReferences(): void {
    for (const sheet of locatedRecords(this.sheets, '/sheets')) {
      const themeId = stringValue(sheet.value, 'themeId');
      if (themeId !== undefined && !owns(this.themes, themeId)) {
        this.addIssue(
          'invariant.reference.theme',
          childPath(sheet.path, 'themeId'),
          `Theme ${themeId} does not exist`,
        );
      }
    }

    const styleArcs: DirectedArc[] = [];
    for (const style of locatedRecords(this.styles, '/styles')) {
      const basedOnStyleId = stringValue(style.value, 'basedOnStyleId');
      if (basedOnStyleId === undefined) {
        continue;
      }
      if (!owns(this.styles, basedOnStyleId)) {
        this.addIssue(
          'invariant.reference.style',
          childPath(style.path, 'basedOnStyleId'),
          `Base style ${basedOnStyleId} does not exist`,
        );
      } else {
        styleArcs.push({
          from: style.key,
          path: childPath(style.path, 'basedOnStyleId'),
          to: basedOnStyleId,
        });
      }
    }
    for (const arc of backEdgesInDirectedGraph(Object.keys(this.styles), styleArcs)) {
      this.addIssue(
        'invariant.style.cycle',
        arc.path,
        `Style inheritance introduces a cycle through ${arc.to}`,
      );
    }

    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, childPath(path, String(index))));
        return;
      }
      if (!isJsonObject(value)) {
        return;
      }
      for (const key of Object.keys(value).sort()) {
        const child = value[key];
        const nextPath = childPath(path, key);
        if (key === 'styleId' && typeof child === 'string' && !owns(this.styles, child)) {
          this.addIssue(
            'invariant.reference.style',
            nextPath,
            `Style ${child} does not exist`,
          );
        }
        visit(child, nextPath);
      }
    };
    visit(this.document, '/');
  }

  private validateMarkers(): void {
    const groupOrderKeys = new Map<string, string>();
    for (const group of locatedRecords(this.markerGroups, '/markerGroups')) {
      const orderKey = stringValue(group.value, 'orderKey');
      if (orderKey !== undefined) {
        this.checkUniqueOrderKey(
          groupOrderKeys,
          orderKey,
          childPath(group.path, 'orderKey'),
          'invariant.marker.group-order-key',
          'Marker group',
        );
      }
    }

    const definitionOrderKeys = new Map<string, string>();
    for (const definition of locatedRecords(this.markerDefinitions, '/markerDefinitions')) {
      const groupId = stringValue(definition.value, 'groupId');
      if (groupId !== undefined && !owns(this.markerGroups, groupId)) {
        this.addIssue(
          'invariant.reference.marker-group',
          childPath(definition.path, 'groupId'),
          `Marker group ${groupId} does not exist`,
        );
      }
      const source = objectValue(definition.value, 'source');
      if (source.kind === 'asset') {
        const assetId = stringValue(source, 'assetId');
        if (assetId !== undefined && !owns(this.assets, assetId)) {
          this.addIssue(
            'invariant.reference.asset',
            childPath(definition.path, 'source', 'assetId'),
            `Asset ${assetId} does not exist`,
          );
        }
      }
      const orderKey = stringValue(definition.value, 'orderKey');
      if (groupId !== undefined && orderKey !== undefined) {
        this.checkUniqueOrderKey(
          definitionOrderKeys,
          `${groupId}\u0000${orderKey}`,
          childPath(definition.path, 'orderKey'),
          'invariant.marker.definition-order-key',
          'Marker definition within a group',
        );
      }
    }
  }

  private validateSheet(sheetEntry: LocatedRecord): void {
    const graph = this.validateTree(sheetEntry);
    this.validateRelationships(sheetEntry, graph);
    this.validateSemanticElements(sheetEntry, graph);
    this.validateSheetContent(sheetEntry, graph);
    this.validateTaskDependencies(sheetEntry, graph);
  }

  private validateTree(sheetEntry: LocatedRecord): SheetGraph {
    const sheet = sheetEntry.value;
    const topics = objectValue(sheet, 'topics');
    const edges = objectValue(sheet, 'treeEdges');
    const edgeEntries = locatedRecords(edges, childPath(sheetEntry.path, 'treeEdges'));
    const incoming = new Map<string, LocatedRecord[]>();
    const outgoing = new Map<string, LocatedRecord[]>();
    const arcs: DirectedArc[] = [];
    const parentChildPairs = new Map<string, string>();
    const scopedOrderKeys = new Map<string, string>();
    const rootTopicId = stringValue(sheet, 'rootTopicId');

    for (const edge of edgeEntries) {
      const parentTopicId = stringValue(edge.value, 'parentTopicId');
      const childTopicId = stringValue(edge.value, 'childTopicId');
      if (parentTopicId === undefined || childTopicId === undefined) {
        continue;
      }
      if (!owns(topics, parentTopicId)) {
        this.addIssue(
          'invariant.tree.parent-missing',
          childPath(edge.path, 'parentTopicId'),
          `Parent topic ${parentTopicId} does not exist in sheet ${sheetEntry.key}`,
        );
      }
      if (!owns(topics, childTopicId)) {
        this.addIssue(
          'invariant.tree.child-missing',
          childPath(edge.path, 'childTopicId'),
          `Child topic ${childTopicId} does not exist in sheet ${sheetEntry.key}`,
        );
      }
      if (parentTopicId === childTopicId) {
        this.addIssue(
          'invariant.tree.self-loop',
          childPath(edge.path, 'childTopicId'),
          `Tree edge ${edge.key} cannot connect a topic to itself`,
        );
      }

      const pair = `${parentTopicId}\u0000${childTopicId}`;
      const previousPair = parentChildPairs.get(pair);
      if (previousPair !== undefined) {
        this.addIssue(
          'invariant.tree.duplicate-edge',
          edge.path,
          `Tree edge duplicates parent/child pair already used at ${previousPair}`,
        );
      } else {
        parentChildPairs.set(pair, edge.path);
      }

      const incomingEdges = incoming.get(childTopicId) ?? [];
      incomingEdges.push(edge);
      incoming.set(childTopicId, incomingEdges);
      const outgoingEdges = outgoing.get(parentTopicId) ?? [];
      outgoingEdges.push(edge);
      outgoing.set(parentTopicId, outgoingEdges);

      if (incomingEdges.length > 1) {
        this.addIssue(
          'invariant.tree.multiple-parents',
          childPath(edge.path, 'childTopicId'),
          `Topic ${childTopicId} has more than one structural parent`,
        );
      }
      if (rootTopicId === childTopicId) {
        this.addIssue(
          'invariant.tree.root-has-parent',
          childPath(edge.path, 'childTopicId'),
          `Root topic ${childTopicId} cannot have an incoming tree edge`,
        );
      }

      const orderKey = stringValue(edge.value, 'orderKey');
      const side = stringValue(edge.value, 'side') ?? '';
      const slot = stringValue(edge.value, 'slot') ?? '';
      if (orderKey !== undefined) {
        this.checkUniqueOrderKey(
          scopedOrderKeys,
          `${parentTopicId}\u0000${side}\u0000${slot}\u0000${orderKey}`,
          childPath(edge.path, 'orderKey'),
          'invariant.tree.order-key',
          'Sibling edge within parent/side/slot',
        );
      }

      if (owns(topics, parentTopicId) && owns(topics, childTopicId)) {
        arcs.push({
          from: parentTopicId,
          path: childPath(edge.path, 'childTopicId'),
          to: childTopicId,
        });
      }
    }

    for (const arc of backEdgesInDirectedGraph(Object.keys(topics), arcs)) {
      this.addIssue(
        'invariant.tree.cycle',
        arc.path,
        `Tree edge introduces a directed cycle through topic ${arc.to}`,
      );
    }

    const centralTopics = locatedRecords(topics, childPath(sheetEntry.path, 'topics')).filter(
      (topic) => topic.value.role === 'central',
    );
    if (centralTopics.length !== 1) {
      this.addIssue(
        'invariant.tree.central-count',
        childPath(sheetEntry.path, 'topics'),
        `Sheet must contain exactly one central topic; found ${centralTopics.length}`,
      );
    }
    const root = rootTopicId === undefined ? undefined : topics[rootTopicId];
    if (!isJsonObject(root)) {
      this.addIssue(
        'invariant.tree.root-missing',
        childPath(sheetEntry.path, 'rootTopicId'),
        `Root topic ${rootTopicId ?? '<missing>'} does not exist in this sheet`,
      );
    } else if (root.role !== 'central') {
      this.addIssue(
        'invariant.tree.root-role',
        childPath(sheetEntry.path, 'rootTopicId'),
        `Root topic ${rootTopicId} must have role central`,
      );
    }

    for (const topic of locatedRecords(topics, childPath(sheetEntry.path, 'topics'))) {
      const incomingCount = incoming.get(topic.key)?.length ?? 0;
      const role = stringValue(topic.value, 'role');
      if (role === 'regular' && incomingCount !== 1) {
        this.addIssue(
          'invariant.tree.regular-parent-count',
          topic.path,
          `Regular topic ${topic.key} must have exactly one structural parent`,
        );
      }
      if ((role === 'floating-root' || role === 'summary-result') && incomingCount !== 0) {
        this.addIssue(
          'invariant.tree.root-role-has-parent',
          topic.path,
          `${role} topic ${topic.key} cannot have an incoming tree edge`,
        );
      }
      this.validateTopicPlacement(topic, sheet, incoming);
    }

    const layout = objectValue(sheet, 'defaultBranchLayout');
    if (layout.structure === 'inherit' || layout.direction === 'inherit') {
      this.addIssue(
        'invariant.layout.unresolved-default',
        childPath(sheetEntry.path, 'defaultBranchLayout'),
        'Sheet default layout cannot contain inherit',
      );
    }
    if (
      layout.structure === 'core:mind-map' &&
      layout.direction === 'both' &&
      rootTopicId !== undefined
    ) {
      for (const edge of outgoing.get(rootTopicId) ?? []) {
        if (edge.value.side !== 'left' && edge.value.side !== 'right') {
          this.addIssue(
            'invariant.tree.root-side',
            childPath(edge.path, 'side'),
            'Direct children of a bidirectional mind-map root require left or right side',
          );
        }
      }
    }

    return {
      edgeEntries,
      edges,
      incoming,
      outgoing,
      sheetId: sheetEntry.key,
      sheetPath: sheetEntry.path,
      sheet,
      topics,
    };
  }

  private validateTopicPlacement(
    topic: LocatedRecord,
    sheet: JsonObject,
    incoming: ReadonlyMap<string, readonly LocatedRecord[]>,
  ): void {
    const placement = objectValue(topic.value, 'placement');
    const mode = stringValue(placement, 'mode');
    const role = stringValue(topic.value, 'role');
    if (role === 'floating-root' && mode !== 'absolute') {
      this.addIssue(
        'invariant.topic.placement',
        childPath(topic.path, 'placement', 'mode'),
        'Floating root topics require absolute placement',
      );
      return;
    }
    if (role === 'summary-result' && mode === 'absolute') {
      this.addIssue(
        'invariant.topic.placement',
        childPath(topic.path, 'placement', 'mode'),
        'Summary result topics cannot use absolute placement',
      );
      return;
    }
    if (role !== 'regular' || mode !== 'absolute') {
      return;
    }

    const parentEdge = incoming.get(topic.key)?.[0];
    const parentTopicId = parentEdge && stringValue(parentEdge.value, 'parentTopicId');
    const topics = objectValue(sheet, 'topics');
    const parentTopic = parentTopicId === undefined ? undefined : topics[parentTopicId];
    const parentLayout = isJsonObject(parentTopic)
      ? objectValue(parentTopic, 'branchLayout')
      : {};
    const defaultLayout = objectValue(sheet, 'defaultBranchLayout');
    const modeAllowsAbsolute =
      parentLayout.mode === 'manual' ||
      (parentLayout.mode === undefined && defaultLayout.mode === 'manual');
    const freePositioning =
      parentLayout.freePositioning === true ||
      (parentLayout.freePositioning === undefined && defaultLayout.freePositioning === true);
    if (!modeAllowsAbsolute && !freePositioning) {
      this.addIssue(
        'invariant.topic.placement',
        childPath(topic.path, 'placement', 'mode'),
        'Regular absolute placement requires a manual or free-positioning parent branch',
      );
    }
  }

  private validateRelationships(sheetEntry: LocatedRecord, graph: SheetGraph): void {
    const relationships = objectValue(sheetEntry.value, 'relationships');
    const boundaries = objectValue(sheetEntry.value, 'boundaries');
    const callouts = objectValue(sheetEntry.value, 'callouts');
    const zones = objectValue(sheetEntry.value, 'zones');

    for (const relationship of locatedRecords(
      relationships,
      childPath(sheetEntry.path, 'relationships'),
    )) {
      const source = this.validateRelationshipEndpoint(
        objectValue(relationship.value, 'source'),
        childPath(relationship.path, 'source'),
        graph.topics,
        boundaries,
        callouts,
        zones,
      );
      const target = this.validateRelationshipEndpoint(
        objectValue(relationship.value, 'target'),
        childPath(relationship.path, 'target'),
        graph.topics,
        boundaries,
        callouts,
        zones,
      );
      if (source === undefined || target === undefined) {
        continue;
      }
      if (source.kind === target.kind && source.id === target.id) {
        this.addIssue(
          'invariant.relationship.self-loop',
          childPath(relationship.path, 'target', 'element'),
          'Relationship endpoints cannot reference the same entity',
        );
      }
      const legalPair =
        (source.kind === 'topic' && target.kind === 'topic') ||
        (source.kind === 'boundary' && target.kind === 'topic') ||
        (source.kind === 'zone' && target.kind !== 'summary') ||
        (target.kind === 'zone' && source.kind !== 'summary');
      if (!legalPair) {
        this.addIssue(
          'invariant.relationship.endpoint-pair',
          relationship.path,
          `Relationship pair ${source.kind} -> ${target.kind} is not allowed`,
        );
      }
    }
  }

  private validateRelationshipEndpoint(
    endpoint: JsonObject,
    endpointPath: string,
    topics: JsonObject,
    boundaries: JsonObject,
    callouts: JsonObject,
    zones: JsonObject,
  ): { readonly id: string; readonly kind: string } | undefined {
    const element = objectValue(endpoint, 'element');
    const kind = stringValue(element, 'kind');
    const definitions: Record<string, readonly [string, JsonObject]> = {
      boundary: ['boundaryId', boundaries],
      callout: ['calloutId', callouts],
      topic: ['topicId', topics],
      zone: ['zoneId', zones],
    };
    if (kind === undefined || definitions[kind] === undefined) {
      return undefined;
    }
    const [field, map] = definitions[kind];
    const id = stringValue(element, field);
    if (id === undefined) {
      return undefined;
    }
    if (!owns(map, id)) {
      this.addIssue(
        'invariant.relationship.endpoint-missing',
        childPath(endpointPath, 'element', field),
        `Relationship ${kind} endpoint ${id} does not exist in this sheet`,
      );
    }
    return { id, kind };
  }

  private validateSemanticElements(sheetEntry: LocatedRecord, graph: SheetGraph): void {
    const boundaries = objectValue(sheetEntry.value, 'boundaries');
    const summaries = objectValue(sheetEntry.value, 'summaries');
    const callouts = objectValue(sheetEntry.value, 'callouts');
    const zones = objectValue(sheetEntry.value, 'zones');
    const summaryOwners = new Map<string, string>();

    for (const boundary of locatedRecords(boundaries, childPath(sheetEntry.path, 'boundaries'))) {
      const members = this.resolveTopicScope(
        objectValue(boundary.value, 'scope'),
        childPath(boundary.path, 'scope'),
        graph,
      );
      let floatingCount = 0;
      for (const topicId of members) {
        const topic = graph.topics[topicId];
        if (!isJsonObject(topic)) continue;
        if (topic.role === 'central') {
          this.addIssue(
            'invariant.boundary.central-member',
            childPath(boundary.path, 'scope'),
            `Boundary cannot contain central topic ${topicId}`,
          );
        }
        if (topic.role === 'floating-root') floatingCount += 1;
      }
      if (floatingCount > 1) {
        this.addIssue(
          'invariant.boundary.multiple-floating-roots',
          childPath(boundary.path, 'scope'),
          'Boundary cannot contain multiple floating-root topics',
        );
      }
    }

    for (const summary of locatedRecords(summaries, childPath(sheetEntry.path, 'summaries'))) {
      const members = this.resolveTopicScope(
        objectValue(summary.value, 'scope'),
        childPath(summary.path, 'scope'),
        graph,
      );
      const resultTopicId = stringValue(summary.value, 'resultTopicId');
      if (resultTopicId === undefined) {
        continue;
      }
      const result = graph.topics[resultTopicId];
      if (!isJsonObject(result)) {
        this.addIssue(
          'invariant.summary.result-missing',
          childPath(summary.path, 'resultTopicId'),
          `Summary result topic ${resultTopicId} does not exist`,
        );
      } else if (result.role !== 'summary-result') {
        this.addIssue(
          'invariant.summary.result-role',
          childPath(summary.path, 'resultTopicId'),
          `Summary result ${resultTopicId} must have role summary-result`,
        );
      }
      if (members.has(resultTopicId)) {
        this.addIssue(
          'invariant.summary.result-in-scope',
          childPath(summary.path, 'scope'),
          `Summary result ${resultTopicId} cannot be inside its own scope`,
        );
      }
      for (const memberId of members) {
        const member = graph.topics[memberId];
        if (isJsonObject(member) && (member.role === 'central' || member.role === 'summary-result')) {
          this.addIssue(
            'invariant.summary.invalid-member-role',
            childPath(summary.path, 'scope'),
            `Summary scope cannot contain ${String(member.role)} topic ${memberId}`,
          );
        }
      }
      const previous = summaryOwners.get(resultTopicId);
      if (previous !== undefined) {
        this.addIssue(
          'invariant.summary.shared-result',
          childPath(summary.path, 'resultTopicId'),
          `Summary result ${resultTopicId} is already owned by ${previous}`,
        );
      } else {
        summaryOwners.set(resultTopicId, summary.key);
      }
    }

    for (const topic of locatedRecords(graph.topics, childPath(sheetEntry.path, 'topics'))) {
      if (topic.value.role === 'summary-result' && !summaryOwners.has(topic.key)) {
        this.addIssue(
          'invariant.summary.unowned-result',
          topic.path,
          `Summary-result topic ${topic.key} must be owned by exactly one Summary`,
        );
      }
    }

    for (const callout of locatedRecords(callouts, childPath(sheetEntry.path, 'callouts'))) {
      const targetTopicId = stringValue(callout.value, 'targetTopicId');
      if (targetTopicId !== undefined && !owns(graph.topics, targetTopicId)) {
        this.addIssue(
          'invariant.callout.target-missing',
          childPath(callout.path, 'targetTopicId'),
          `Callout target topic ${targetTopicId} does not exist`,
        );
      }
    }

    const zoneMembership = new Map<string, string>();
    const zoneOrderKeys = new Map<string, string>();
    for (const zone of locatedRecords(zones, childPath(sheetEntry.path, 'zones'))) {
      const zOrderKey = stringValue(zone.value, 'zOrderKey');
      if (zOrderKey !== undefined) {
        this.checkUniqueOrderKey(
          zoneOrderKeys,
          zOrderKey,
          childPath(zone.path, 'zOrderKey'),
          'invariant.zone.order-key',
          'Zone',
        );
      }
      for (const [index, topicId] of stringArray(zone.value, 'rootTopicIds').entries()) {
        const topic = graph.topics[topicId];
        const path = childPath(zone.path, 'rootTopicIds', String(index));
        if (!isJsonObject(topic)) {
          this.addIssue(
            'invariant.zone.root-missing',
            path,
            `Zone root topic ${topicId} does not exist`,
          );
          continue;
        }
        if (topic.role !== 'floating-root' || (graph.incoming.get(topicId)?.length ?? 0) !== 0) {
          this.addIssue(
            'invariant.zone.invalid-root',
            path,
            `Zone member ${topicId} must be a parentless floating-root topic`,
          );
        }
        const previous = zoneMembership.get(topicId);
        if (previous !== undefined) {
          this.addIssue(
            'invariant.zone.duplicate-membership',
            path,
            `Floating root ${topicId} already belongs to zone ${previous}`,
          );
        } else {
          zoneMembership.set(topicId, zone.key);
        }
      }
      const rect = objectValue(zone.value, 'rect');
      for (const dimension of ['width', 'height']) {
        const value = rect[dimension];
        if (typeof value === 'number' && value < 100) {
          this.addIssue(
            'invariant.zone.minimum-size',
            childPath(zone.path, 'rect', dimension),
            `Zone ${dimension} must be at least 100`,
          );
        }
      }
    }
  }

  private resolveTopicScope(
    scope: JsonObject,
    scopePath: string,
    graph: SheetGraph,
  ): Set<string> {
    const members = new Set<string>();
    const kind = stringValue(scope, 'kind');
    if (kind === 'explicit') {
      stringArray(scope, 'topicIds').forEach((topicId, index) => {
        if (!owns(graph.topics, topicId)) {
          this.addIssue(
            'invariant.scope.topic-missing',
            childPath(scopePath, 'topicIds', String(index)),
            `Scope topic ${topicId} does not exist`,
          );
        } else {
          members.add(topicId);
        }
      });
      return members;
    }
    if (kind === 'subtree') {
      const rootTopicId = stringValue(scope, 'rootTopicId');
      if (rootTopicId === undefined || !owns(graph.topics, rootTopicId)) {
        this.addIssue(
          'invariant.scope.topic-missing',
          childPath(scopePath, 'rootTopicId'),
          `Scope root topic ${rootTopicId ?? '<missing>'} does not exist`,
        );
        return members;
      }
      const rawDepth = scope.depth;
      const maximumDepth = typeof rawDepth === 'number' ? rawDepth : Number.POSITIVE_INFINITY;
      const queue: Array<readonly [string, number]> = [[rootTopicId, 0]];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) {
          break;
        }
        const [topicId, depth] = current;
        if (members.has(topicId)) {
          continue;
        }
        members.add(topicId);
        if (depth >= maximumDepth) {
          continue;
        }
        for (const edge of graph.outgoing.get(topicId) ?? []) {
          const childTopicId = stringValue(edge.value, 'childTopicId');
          if (childTopicId !== undefined && owns(graph.topics, childTopicId)) {
            queue.push([childTopicId, depth + 1]);
          }
        }
      }
      return members;
    }
    if (kind !== 'sibling-range') {
      return members;
    }

    const parentTopicId = stringValue(scope, 'parentTopicId');
    const firstEdgeId = stringValue(scope, 'firstEdgeId');
    const lastEdgeId = stringValue(scope, 'lastEdgeId');
    if (parentTopicId !== undefined && !owns(graph.topics, parentTopicId)) {
      this.addIssue(
        'invariant.scope.topic-missing',
        childPath(scopePath, 'parentTopicId'),
        `Scope parent topic ${parentTopicId} does not exist`,
      );
    }
    const first = firstEdgeId === undefined ? undefined : graph.edges[firstEdgeId];
    const last = lastEdgeId === undefined ? undefined : graph.edges[lastEdgeId];
    if (!isJsonObject(first)) {
      this.addIssue(
        'invariant.scope.edge-missing',
        childPath(scopePath, 'firstEdgeId'),
        `First scope edge ${firstEdgeId ?? '<missing>'} does not exist`,
      );
    }
    if (!isJsonObject(last)) {
      this.addIssue(
        'invariant.scope.edge-missing',
        childPath(scopePath, 'lastEdgeId'),
        `Last scope edge ${lastEdgeId ?? '<missing>'} does not exist`,
      );
    }
    if (!isJsonObject(first) || !isJsonObject(last) || parentTopicId === undefined) {
      return members;
    }

    const resolvedSide = (edge: JsonObject): string => {
      const visited = new Set<string>();
      let cursor: JsonObject | undefined = edge;
      while (cursor) {
        const side = stringValue(cursor, 'side');
        if (side !== undefined && side !== 'inherit') return side;
        const parentTopicId = stringValue(cursor, 'parentTopicId');
        if (parentTopicId === undefined || visited.has(parentTopicId)) break;
        visited.add(parentTopicId);
        cursor = graph.incoming.get(parentTopicId)?.[0]?.value;
      }
      const layout = objectValue(graph.sheet, 'defaultBranchLayout');
      const direction = stringValue(layout, 'direction');
      if (direction === 'right-to-left') return 'left';
      if (direction === 'top-to-bottom') return 'bottom';
      if (direction === 'bottom-to-top') return 'top';
      return 'right';
    };
    const firstResolvedSide = resolvedSide(first);
    const compatible =
      first.parentTopicId === parentTopicId &&
      last.parentTopicId === parentTopicId &&
      firstResolvedSide === resolvedSide(last) &&
      sameOptionalString(first.slot, last.slot);
    if (!compatible) {
      this.addIssue(
        'invariant.scope.sibling-range',
        scopePath,
        'Sibling range edges must share parent, side, and slot',
      );
      return members;
    }
    const candidates = (graph.outgoing.get(parentTopicId) ?? [])
      .filter(
        (edge) =>
          resolvedSide(edge.value) === firstResolvedSide
          && sameOptionalString(edge.value.slot, first.slot),
      )
      .sort(
        (left, right) =>
          compareText(String(left.value.orderKey), String(right.value.orderKey)) ||
          compareText(left.key, right.key),
      );
    const firstIndex = candidates.findIndex((edge) => edge.key === firstEdgeId);
    const lastIndex = candidates.findIndex((edge) => edge.key === lastEdgeId);
    if (firstIndex < 0 || lastIndex < firstIndex) {
      this.addIssue(
        'invariant.scope.sibling-range-order',
        scopePath,
        'Sibling range first/last edges are not in canonical order',
      );
      return members;
    }
    for (const edge of candidates.slice(firstIndex, lastIndex + 1)) {
      const childTopicId = stringValue(edge.value, 'childTopicId');
      if (childTopicId !== undefined) {
        members.add(childTopicId);
        if (scope.includeDescendants === true) {
          const pending = [childTopicId];
          while (pending.length > 0) {
            const parentId = pending.shift();
            if (parentId === undefined) break;
            for (const childEdge of graph.outgoing.get(parentId) ?? []) {
              const descendantId = stringValue(childEdge.value, 'childTopicId');
              if (
                descendantId !== undefined
                && owns(graph.topics, descendantId)
                && !members.has(descendantId)
              ) {
                members.add(descendantId);
                pending.push(descendantId);
              }
            }
          }
        }
      }
    }
    return members;
  }

  private validateSheetContent(sheetEntry: LocatedRecord, graph: SheetGraph): void {
    const sheet = sheetEntry.value;
    for (const [mapName, label] of TOPIC_OWNED_MAPS) {
      for (const entity of locatedRecords(
        objectValue(sheet, mapName),
        childPath(sheetEntry.path, mapName),
      )) {
        const topicId = stringValue(entity.value, 'topicId');
        if (topicId !== undefined && !owns(graph.topics, topicId)) {
          this.addIssue(
            'invariant.reference.topic',
            childPath(entity.path, 'topicId'),
            `${label} references missing topic ${topicId} in sheet ${graph.sheetId}`,
          );
        }
      }
    }

    this.validateSingleTopicEntity(sheetEntry, 'notes', 'invariant.note.duplicate-topic');
    this.validateSingleTopicEntity(sheetEntry, 'todos', 'invariant.todo.duplicate-topic');
    this.validateSingleTopicEntity(sheetEntry, 'tasks', 'invariant.task.duplicate-topic');
    this.validateSingleTopicEntity(sheetEntry, 'audioClips', 'invariant.audio.duplicate-topic');

    for (const attachment of locatedRecords(
      objectValue(sheet, 'attachments'),
      childPath(sheetEntry.path, 'attachments'),
    )) {
      this.validateAssetReference(attachment, 'assetId');
    }
    const imageOrderKeys = new Map<string, string>();
    for (const image of locatedRecords(
      objectValue(sheet, 'images'),
      childPath(sheetEntry.path, 'images'),
    )) {
      const asset = this.validateAssetReference(image, 'assetId');
      if (asset !== undefined && !String(asset.mimeType).startsWith('image/')) {
        this.addIssue(
          'invariant.image.asset-mime',
          childPath(image.path, 'assetId'),
          'Topic image must reference an image/* asset',
        );
      }

      const topicId = stringValue(image.value, 'topicId');
      const orderKey = stringValue(image.value, 'orderKey');
      if (orderKey !== undefined) {
        const orderKeyPath = childPath(image.path, 'orderKey');
        if (!CANONICAL_ORDER_KEY.test(orderKey)) {
          this.addIssue(
            'invariant.image.order-key-format',
            orderKeyPath,
            'Topic image orderKey must contain 1-256 persistent ASCII order characters',
          );
        }
        if (topicId !== undefined) {
          this.checkUniqueOrderKey(
            imageOrderKeys,
            `${topicId}\u0000${orderKey}`,
            orderKeyPath,
            'invariant.image.order-key',
            'Topic image within a topic',
          );
        }
      }

      const role = stringValue(image.value, 'role');
      const placement = objectValue(image.value, 'placement');
      const side = stringValue(placement, 'side');
      const validPlacement = role !== undefined && side !== undefined && (
        (ORDINARY_TOPIC_IMAGE_ROLES.has(role) && ORDINARY_TOPIC_IMAGE_SIDES.has(side))
        || (role === 'sticker' && STICKER_TOPIC_IMAGE_SIDES.has(side))
        // Background direction is intentionally compatibility-only. The V1
        // specification says it is ignored, but does not define a canonical
        // default value that this invariant could safely infer.
        || (role === 'background' && CANONICAL_TOPIC_IMAGE_SIDES.has(side))
      );
      if (role !== undefined && side !== undefined && !validPlacement) {
        this.addIssue(
          'invariant.image.placement',
          childPath(image.path, 'placement', 'side'),
          role === 'inline' || role === 'thumbnail'
            ? `Topic image role ${role} only supports top or bottom placement`
            : `Topic image role ${role} does not support ${side} placement`,
        );
      }
    }
    const audioTopicIds = new Set<string>();
    for (const audio of locatedRecords(
      objectValue(sheet, 'audioClips'),
      childPath(sheetEntry.path, 'audioClips'),
    )) {
      const asset = this.validateAssetReference(audio, 'assetId');
      if (asset !== undefined && !String(asset.mimeType).startsWith('audio/')) {
        this.addIssue(
          'invariant.audio.asset-mime',
          childPath(audio.path, 'assetId'),
          'Audio clip must reference an audio/* asset',
        );
      }
      const topicId = stringValue(audio.value, 'topicId');
      if (topicId !== undefined) {
        audioTopicIds.add(topicId);
      }
    }

    for (const link of locatedRecords(
      objectValue(sheet, 'links'),
      childPath(sheetEntry.path, 'links'),
    )) {
      const topicId = stringValue(link.value, 'topicId');
      if (topicId !== undefined && audioTopicIds.has(topicId)) {
        this.addIssue(
          'invariant.audio.link-conflict',
          childPath(link.path, 'topicId'),
          `Audio-note topic ${topicId} cannot also own a link`,
        );
      }
      this.validateTopicLink(link);
    }

    const markerOrderKeys = new Map<string, string>();
    const markerDefinitionsByTopic = new Map<string, string>();
    const exclusiveGroupsByTopic = new Map<string, string>();
    for (const marker of locatedRecords(
      objectValue(sheet, 'markerInstances'),
      childPath(sheetEntry.path, 'markerInstances'),
    )) {
      const topicId = stringValue(marker.value, 'topicId');
      const markerDefinitionId = stringValue(marker.value, 'markerDefinitionId');
      if (topicId !== undefined && !owns(graph.topics, topicId)) {
        this.addIssue(
          'invariant.reference.topic',
          childPath(marker.path, 'topicId'),
          `Marker references missing topic ${topicId}`,
        );
      }
      if (markerDefinitionId !== undefined && !owns(this.markerDefinitions, markerDefinitionId)) {
        this.addIssue(
          'invariant.reference.marker-definition',
          childPath(marker.path, 'markerDefinitionId'),
          `Marker definition ${markerDefinitionId} does not exist`,
        );
      }

      const orderKey = stringValue(marker.value, 'orderKey');
      if (topicId !== undefined && orderKey !== undefined) {
        this.checkUniqueOrderKey(
          markerOrderKeys,
          `${topicId}\u0000${orderKey}`,
          childPath(marker.path, 'orderKey'),
          'invariant.marker.instance-order-key',
          'Marker instance within a topic',
        );
      }

      if (topicId === undefined || markerDefinitionId === undefined) continue;
      const definition = this.markerDefinitions[markerDefinitionId];
      if (!isJsonObject(definition)) continue;

      const topicDefinitionIdentity = `${topicId}\u0000${markerDefinitionId}`;
      const previousDefinitionPath = markerDefinitionsByTopic.get(topicDefinitionIdentity);
      if (previousDefinitionPath !== undefined) {
        this.addIssue(
          'invariant.marker.duplicate-definition',
          childPath(marker.path, 'markerDefinitionId'),
          `Topic ${topicId} already has marker definition ${markerDefinitionId} at ${previousDefinitionPath}`,
        );
      } else {
        markerDefinitionsByTopic.set(topicDefinitionIdentity, marker.path);
      }

      const groupId = stringValue(definition, 'groupId');
      const group = groupId === undefined ? undefined : this.markerGroups[groupId];
      if (!isJsonObject(group) || group.exclusive !== true || groupId === undefined) continue;
      const exclusiveIdentity = `${topicId}\u0000${groupId}`;
      const previousGroupPath = exclusiveGroupsByTopic.get(exclusiveIdentity);
      if (previousGroupPath !== undefined) {
        this.addIssue(
          'invariant.marker.exclusive-group',
          childPath(marker.path, 'markerDefinitionId'),
          `Exclusive marker group ${groupId} already has a marker on topic ${topicId} at ${previousGroupPath}`,
        );
      } else {
        exclusiveGroupsByTopic.set(exclusiveIdentity, marker.path);
      }
    }

    const legend = objectValue(sheet, 'markerLegend');
    const legendDefinitions = new Set<string>();
    stringArray(legend, 'itemOrder').forEach((definitionId, index) => {
      if (!owns(this.markerDefinitions, definitionId)) {
        this.addIssue(
          'invariant.reference.marker-definition',
          childPath(sheetEntry.path, 'markerLegend', 'itemOrder', String(index)),
          `Marker definition ${definitionId} does not exist`,
        );
      }
      if (legendDefinitions.has(definitionId)) {
        this.addIssue(
          'invariant.marker.legend-duplicate',
          childPath(sheetEntry.path, 'markerLegend', 'itemOrder', String(index)),
          `Marker legend repeats definition ${definitionId}`,
        );
      }
      legendDefinitions.add(definitionId);
    });

    for (const todo of locatedRecords(
      objectValue(sheet, 'todos'),
      childPath(sheetEntry.path, 'todos'),
    )) {
      const hasCompletedAt = owns(todo.value, 'completedAt');
      if (todo.value.completed !== true && hasCompletedAt) {
        this.addIssue(
          'invariant.todo.completed-at',
          childPath(todo.path, 'completedAt'),
          'completedAt may only exist when the to-do is completed',
        );
      }
    }

    for (const task of locatedRecords(
      objectValue(sheet, 'tasks'),
      childPath(sheetEntry.path, 'tasks'),
    )) {
      stringArray(task.value, 'assigneeIds').forEach((actorId, index) => {
        if (!owns(this.actors, actorId)) {
          this.addIssue(
            'invariant.reference.actor',
            childPath(task.path, 'assigneeIds', String(index)),
            `Task assignee ${actorId} does not exist`,
          );
        }
      });
      if (stringArray(task.value, 'displayFields').includes('creator')) {
        const audit = objectValue(task.value, 'audit');
        const createdBy = stringValue(audit, 'createdBy');
        if (createdBy === undefined || !owns(this.actors, createdBy)) {
          this.addIssue(
            'invariant.task.creator',
            childPath(task.path, 'audit', 'createdBy'),
            'Task displaying creator requires a resolvable audit.createdBy actor',
          );
        }
      }
    }
  }

  private validateSingleTopicEntity(
    sheetEntry: LocatedRecord,
    mapName: string,
    code: string,
  ): void {
    const seen = new Map<string, string>();
    for (const entity of locatedRecords(
      objectValue(sheetEntry.value, mapName),
      childPath(sheetEntry.path, mapName),
    )) {
      const topicId = stringValue(entity.value, 'topicId');
      if (topicId === undefined) {
        continue;
      }
      const previous = seen.get(topicId);
      if (previous !== undefined) {
        this.addIssue(
          code,
          childPath(entity.path, 'topicId'),
          `Topic ${topicId} already has an entity of this kind at ${previous}`,
        );
      } else {
        seen.set(topicId, entity.path);
      }
    }
  }

  private validateAssetReference(
    entity: LocatedRecord,
    field: string,
  ): JsonObject | undefined {
    const assetId = stringValue(entity.value, field);
    if (assetId === undefined) {
      return undefined;
    }
    const asset = this.assets[assetId];
    if (!isJsonObject(asset)) {
      this.addIssue(
        'invariant.reference.asset',
        childPath(entity.path, field),
        `Asset ${assetId} does not exist`,
      );
      return undefined;
    }
    return asset;
  }

  private validateTopicLink(link: LocatedRecord): void {
    if (link.value.status !== 'active') {
      return;
    }
    const kind = stringValue(link.value, 'kind');
    const targetSheetId = stringValue(link.value, 'targetSheetId');
    if (kind === 'sheet') {
      if (targetSheetId !== undefined && !owns(this.sheets, targetSheetId)) {
        this.addIssue(
          'invariant.link.sheet-missing',
          childPath(link.path, 'targetSheetId'),
          `Target sheet ${targetSheetId} does not exist`,
        );
      }
      return;
    }
    if (kind !== 'topic') {
      return;
    }
    const targetTopicId = stringValue(link.value, 'targetTopicId');
    const targetSheet = targetSheetId === undefined ? undefined : this.sheets[targetSheetId];
    if (!isJsonObject(targetSheet)) {
      this.addIssue(
        'invariant.link.sheet-missing',
        childPath(link.path, 'targetSheetId'),
        `Target sheet ${targetSheetId ?? '<missing>'} does not exist`,
      );
      return;
    }
    const targetTopics = objectValue(targetSheet, 'topics');
    if (targetTopicId !== undefined && !owns(targetTopics, targetTopicId)) {
      this.addIssue(
        'invariant.link.topic-missing',
        childPath(link.path, 'targetTopicId'),
        `Target topic ${targetTopicId} does not exist in sheet ${targetSheetId}`,
      );
    }
  }

  private validateTaskDependencies(sheetEntry: LocatedRecord, graph: SheetGraph): void {
    const tasks = objectValue(sheetEntry.value, 'tasks');
    const dependencies = objectValue(sheetEntry.value, 'taskDependencies');
    const arcs: DirectedArc[] = [];
    for (const dependency of locatedRecords(
      dependencies,
      childPath(sheetEntry.path, 'taskDependencies'),
    )) {
      const predecessorTaskId = stringValue(dependency.value, 'predecessorTaskId');
      const successorTaskId = stringValue(dependency.value, 'successorTaskId');
      if (predecessorTaskId !== undefined && !owns(tasks, predecessorTaskId)) {
        this.addIssue(
          'invariant.task.predecessor-missing',
          childPath(dependency.path, 'predecessorTaskId'),
          `Predecessor task ${predecessorTaskId} does not exist in sheet ${graph.sheetId}`,
        );
      }
      if (successorTaskId !== undefined && !owns(tasks, successorTaskId)) {
        this.addIssue(
          'invariant.task.successor-missing',
          childPath(dependency.path, 'successorTaskId'),
          `Successor task ${successorTaskId} does not exist in sheet ${graph.sheetId}`,
        );
      }
      if (predecessorTaskId === undefined || successorTaskId === undefined) {
        continue;
      }
      if (predecessorTaskId === successorTaskId) {
        this.addIssue(
          'invariant.task.self-dependency',
          childPath(dependency.path, 'successorTaskId'),
          `Task ${successorTaskId} cannot depend on itself`,
        );
      }
      if (owns(tasks, predecessorTaskId) && owns(tasks, successorTaskId)) {
        arcs.push({
          from: predecessorTaskId,
          path: childPath(dependency.path, 'successorTaskId'),
          to: successorTaskId,
        });
      }
    }
    for (const arc of backEdgesInDirectedGraph(Object.keys(tasks), arcs)) {
      this.addIssue(
        'invariant.task.dependency-cycle',
        arc.path,
        `Task dependency introduces a cycle through ${arc.to}`,
      );
    }
  }

  private validateSavedViews(): void {
    const orderKeys = new Map<string, string>();
    for (const view of locatedRecords(this.savedViews, '/savedViews')) {
      const sheetId = stringValue(view.value, 'sheetId');
      const sheet = sheetId === undefined ? undefined : this.sheets[sheetId];
      if (!isJsonObject(sheet)) {
        this.addIssue(
          'invariant.saved-view.sheet-missing',
          childPath(view.path, 'sheetId'),
          `Saved view sheet ${sheetId ?? '<missing>'} does not exist`,
        );
        continue;
      }
      const orderKey = stringValue(view.value, 'orderKey');
      if (orderKey !== undefined) {
        this.checkUniqueOrderKey(
          orderKeys,
          `${sheetId}\u0000${orderKey}`,
          childPath(view.path, 'orderKey'),
          'invariant.saved-view.order-key',
          'Saved view within a sheet',
        );
      }
      const focusedBranchRootId = stringValue(view.value, 'focusedBranchRootId');
      const topics = objectValue(sheet, 'topics');
      if (focusedBranchRootId !== undefined && !owns(topics, focusedBranchRootId)) {
        this.addIssue(
          'invariant.saved-view.topic-missing',
          childPath(view.path, 'focusedBranchRootId'),
          `Focused topic ${focusedBranchRootId} does not exist in sheet ${sheetId}`,
        );
      }
      for (const topicId of Object.keys(objectValue(view.value, 'foldOverrides')).sort()) {
        if (!owns(topics, topicId)) {
          this.addIssue(
            'invariant.saved-view.topic-missing',
            childPath(view.path, 'foldOverrides', topicId),
            `Fold override topic ${topicId} does not exist in sheet ${sheetId}`,
          );
        }
      }
      const selection = view.value.selection;
      if (Array.isArray(selection)) {
        selection.forEach((reference, index) => {
          if (isJsonObject(reference)) {
            this.validateElementReference(
              reference,
              childPath(view.path, 'selection', String(index)),
              sheet,
            );
          }
        });
      }
    }

    for (const sheet of locatedRecords(this.sheets, '/sheets')) {
      const defaultSavedViewId = stringValue(sheet.value, 'defaultSavedViewId');
      if (defaultSavedViewId === undefined) {
        continue;
      }
      const view = this.savedViews[defaultSavedViewId];
      if (!isJsonObject(view) || view.sheetId !== sheet.key) {
        this.addIssue(
          'invariant.saved-view.default-missing',
          childPath(sheet.path, 'defaultSavedViewId'),
          `Default saved view ${defaultSavedViewId} must exist and belong to this sheet`,
        );
      }
    }
  }

  private validatePresentations(): void {
    const deckBySheet = new Map<string, string>();
    for (const deck of locatedRecords(this.presentations, '/presentations')) {
      const sheetId = stringValue(deck.value, 'sheetId');
      const sheet = sheetId === undefined ? undefined : this.sheets[sheetId];
      if (sheetId === undefined || !isJsonObject(sheet)) {
        this.addIssue(
          'invariant.presentation.sheet-missing',
          childPath(deck.path, 'sheetId'),
          `Presentation sheet ${sheetId ?? '<missing>'} does not exist`,
        );
        continue;
      }
      const previousDeck = deckBySheet.get(sheetId);
      if (previousDeck !== undefined) {
        this.addIssue(
          'invariant.presentation.duplicate-sheet-deck',
          childPath(deck.path, 'sheetId'),
          `Sheet ${sheetId} already has presentation deck ${previousDeck}`,
        );
      } else {
        deckBySheet.set(sheetId, deck.key);
      }
      const themeId = stringValue(deck.value, 'themeId');
      if (themeId !== undefined && !owns(this.themes, themeId)) {
        this.addIssue(
          'invariant.reference.theme',
          childPath(deck.path, 'themeId'),
          `Presentation theme ${themeId} does not exist`,
        );
      }
      const topics = objectValue(sheet, 'topics');
      const settings = objectValue(deck.value, 'settings');
      const included = stringArray(settings, 'includedTopicIds');
      const excluded = stringArray(settings, 'excludedTopicIds');
      const excludedSet = new Set(excluded);
      for (const [field, values] of [
        ['includedTopicIds', included],
        ['excludedTopicIds', excluded],
      ] as const) {
        values.forEach((topicId, index) => {
          if (!owns(topics, topicId)) {
            this.addIssue(
              'invariant.presentation.topic-missing',
              childPath(deck.path, 'settings', field, String(index)),
              `Presentation topic ${topicId} does not exist in sheet ${sheetId}`,
            );
          }
        });
      }
      included.forEach((topicId, index) => {
        if (excludedSet.has(topicId)) {
          this.addIssue(
            'invariant.presentation.include-exclude-overlap',
            childPath(deck.path, 'settings', 'includedTopicIds', String(index)),
            `Topic ${topicId} cannot be both included and excluded`,
          );
        }
      });
      this.validateSlides(deck, sheet, sheetId);
    }
  }

  private validateSlides(deck: LocatedRecord, sheet: JsonObject, sheetId: string): void {
    const slides = objectValue(deck.value, 'slides');
    const slideOrderKeys = new Map<string, string>();
    for (const slide of locatedRecords(slides, childPath(deck.path, 'slides'))) {
      const orderKey = stringValue(slide.value, 'orderKey');
      if (orderKey !== undefined) {
        this.checkUniqueOrderKey(
          slideOrderKeys,
          orderKey,
          childPath(slide.path, 'orderKey'),
          'invariant.presentation.slide-order-key',
          'Slide within a deck',
        );
      }
      const target = objectValue(slide.value, 'target');
      const targetSheetId = stringValue(target, 'sheetId');
      if (targetSheetId !== sheetId) {
        this.addIssue(
          'invariant.presentation.target-sheet',
          childPath(slide.path, 'target', 'sheetId'),
          `Slide target must belong to deck sheet ${sheetId}`,
        );
      }
      const targetKind = stringValue(target, 'kind');
      const targetMaps: Record<string, readonly [string, string]> = {
        boundary: ['boundaryId', 'boundaries'],
        topic: ['topicId', 'topics'],
        zone: ['zoneId', 'zones'],
      };
      if (targetKind !== undefined && targetMaps[targetKind] !== undefined) {
        const [field, mapName] = targetMaps[targetKind];
        const id = stringValue(target, field);
        if (id !== undefined && !owns(objectValue(sheet, mapName), id)) {
          this.addIssue(
            'invariant.presentation.target-missing',
            childPath(slide.path, 'target', field),
            `Slide target ${targetKind} ${id} does not exist in deck sheet`,
          );
        }
      }

      const narrationAudioId = stringValue(slide.value, 'narrationAudioId');
      if (narrationAudioId !== undefined && !owns(objectValue(sheet, 'audioClips'), narrationAudioId)) {
        this.addIssue(
          'invariant.presentation.audio-missing',
          childPath(slide.path, 'narrationAudioId'),
          `Narration audio ${narrationAudioId} does not exist in deck sheet`,
        );
      }
      for (const imageId of Object.keys(objectValue(slide.value, 'imageOverrides')).sort()) {
        if (!owns(objectValue(sheet, 'images'), imageId)) {
          this.addIssue(
            'invariant.presentation.image-missing',
            childPath(slide.path, 'imageOverrides', imageId),
            `Presentation image override ${imageId} does not exist in deck sheet`,
          );
        }
      }
      for (const build of locatedRecords(
        objectValue(slide.value, 'builds'),
        childPath(slide.path, 'builds'),
      )) {
        const buildTarget = objectValue(build.value, 'target');
        if (buildTarget.kind === 'topic') {
          const topicId = stringValue(buildTarget, 'topicId');
          if (topicId !== undefined && !owns(objectValue(sheet, 'topics'), topicId)) {
            this.addIssue(
              'invariant.presentation.build-target-missing',
              childPath(build.path, 'target', 'topicId'),
              `Build topic ${topicId} does not exist in deck sheet`,
            );
          }
        } else if (buildTarget.kind === 'relationship') {
          const relationshipId = stringValue(buildTarget, 'relationshipId');
          if (
            relationshipId !== undefined &&
            !owns(objectValue(sheet, 'relationships'), relationshipId)
          ) {
            this.addIssue(
              'invariant.presentation.build-target-missing',
              childPath(build.path, 'target', 'relationshipId'),
              `Build relationship ${relationshipId} does not exist in deck sheet`,
            );
          }
        }
      }
    }
  }

  private validateComments(): void {
    const collaboration = objectValue(this.document, 'collaboration');
    const threads = objectValue(collaboration, 'commentThreads');
    for (const thread of locatedRecords(threads, '/collaboration/commentThreads')) {
      const anchor = objectValue(thread.value, 'anchor');
      if (anchor.kind === 'canvas') {
        const sheetId = stringValue(anchor, 'sheetId');
        if (sheetId !== undefined && !owns(this.sheets, sheetId)) {
          this.addIssue(
            'invariant.comment.sheet-missing',
            childPath(thread.path, 'anchor', 'sheetId'),
            `Comment canvas sheet ${sheetId} does not exist`,
          );
        }
      } else if (thread.value.orphaned !== true) {
        const id = stringValue(anchor, 'id');
        const entity = id === undefined ? undefined : this.entityById.get(id);
        if (entity === undefined || entity.kind !== anchor.kind) {
          this.addIssue(
            'invariant.comment.anchor-missing',
            childPath(thread.path, 'anchor'),
            `Active comment anchor ${String(anchor.kind)} ${id ?? '<missing>'} does not exist`,
          );
        }
      }
      const comments = objectValue(thread.value, 'comments');
      for (const comment of locatedRecords(comments, childPath(thread.path, 'comments'))) {
        const authorId = stringValue(comment.value, 'authorId');
        if (authorId !== undefined && !owns(this.actors, authorId)) {
          this.addIssue(
            'invariant.reference.actor',
            childPath(comment.path, 'authorId'),
            `Comment author ${authorId} does not exist`,
          );
        }
        const replyToId = stringValue(comment.value, 'replyToId');
        if (replyToId !== undefined && !owns(comments, replyToId)) {
          this.addIssue(
            'invariant.comment.reply-missing',
            childPath(comment.path, 'replyToId'),
            `Reply target ${replyToId} does not exist in this comment thread`,
          );
        }
      }
    }
  }

  private validateElementReference(reference: JsonObject, path: string, sheet: JsonObject): void {
    const kind = stringValue(reference, 'kind');
    const id = stringValue(reference, 'id');
    const mapNames: Record<string, string> = {
      boundary: 'boundaries',
      callout: 'callouts',
      relationship: 'relationships',
      summary: 'summaries',
      topic: 'topics',
      zone: 'zones',
    };
    if (kind === undefined || id === undefined || mapNames[kind] === undefined) {
      return;
    }
    if (!owns(objectValue(sheet, mapNames[kind]), id)) {
      this.addIssue(
        'invariant.saved-view.selection-missing',
        path,
        `Selected ${kind} ${id} does not exist in the saved view sheet`,
      );
    }
  }

  private checkUniqueOrderKey(
    seen: Map<string, string>,
    scopedKey: string,
    path: string,
    code: string,
    label: string,
  ): void {
    const previous = seen.get(scopedKey);
    if (previous !== undefined) {
      this.addIssue(code, path, `${label} orderKey duplicates ${previous}`);
    } else {
      seen.set(scopedKey, path);
    }
  }
}

/**
 * Validates cross-record references and graph/domain semantics. The function is
 * defensive, but callers should normally run it only after Schema validation.
 */
export function validateMindMapInvariants(value: unknown): ValidationIssue[] {
  if (!isJsonObject(value)) {
    return [
      {
        code: 'invariant.document.object',
        message: 'Mind-map document must be an object before invariants can run',
        path: '/',
        severity: 'error',
      },
    ];
  }
  return new InvariantValidator(value).run();
}
