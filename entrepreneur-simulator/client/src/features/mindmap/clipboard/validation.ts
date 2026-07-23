import type * as Domain from '../domain/types';
import type { MindMapClipboardEnvelopeV1, MindMapClipboardFragment } from './types';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function findUnsafeClipboardKeys(value: unknown): string[] {
  const issues: string[] = [];
  const pending: Array<{ path: string; value: unknown }> = [{ path: '/', value }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.value === null || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => {
        pending.push({ path: `${current.path}/${index}`, value: entry });
      });
      continue;
    }
    for (const [key, entry] of Object.entries(current.value as Record<string, unknown>)) {
      const path = `${current.path === '/' ? '' : current.path}/${key}`;
      if (DANGEROUS_KEYS.has(key)) issues.push(path);
      pending.push({ path, value: entry });
    }
  }
  return issues.sort();
}

function isAllowedUrl(raw: string, schemes: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    return schemes.includes(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

const SENSITIVE_REMOTE_ASSET_QUERY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'key-pair-id',
  'sig',
  'signature',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-credential',
  'x-goog-signature',
]);

function isSafeRemoteAssetUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username.length === 0
      && url.password.length === 0
      && ![...url.searchParams.keys()].some((key) =>
        SENSITIVE_REMOTE_ASSET_QUERY_KEYS.has(key.toLocaleLowerCase('en-US')));
  } catch {
    return false;
  }
}

function hasUnsafeAssetPath(raw: string): boolean {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A literal percent sign is harmless; raw checks still apply.
  }
  return [raw, decoded].some((candidate) =>
    /[\u0000-\u001f\u007f]/.test(candidate)
    || candidate.includes('\\')
    || candidate.startsWith('/')
    || /^[A-Za-z]:\//.test(candidate)
    || candidate.split('/').some((segment) => segment === '.' || segment === '..'),
  );
}

export function findUnsafeClipboardUrls(value: unknown): string[] {
  const issues: string[] = [];
  const pending: Array<{ path: string; value: unknown }> = [{ path: '/', value }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => {
        pending.push({ path: `${current.path}/${index}`, value: entry });
      });
      continue;
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    const object = current.value as Record<string, unknown>;
    if (object.type === 'link' && typeof object.href === 'string') {
      if (!isAllowedUrl(object.href, ['https:', 'http:', 'mailto:'])) {
        issues.push(`${current.path}/href`);
      }
    }
    if (object.kind === 'remote' && typeof object.url === 'string') {
      if (!isSafeRemoteAssetUrl(object.url)) issues.push(`${current.path}/url`);
    }
    for (const [key, entry] of Object.entries(object)) {
      pending.push({
        path: `${current.path === '/' ? '' : current.path}/${key}`,
        value: entry,
      });
    }
  }
  return issues.sort();
}

function endpointKey(endpoint: Domain.RelationshipEndpoint): string {
  const element = endpoint.element;
  switch (element.kind) {
    case 'topic':
      return `topic:${element.topicId}`;
    case 'boundary':
      return `boundary:${element.boundaryId}`;
    case 'callout':
      return `callout:${element.calloutId}`;
    case 'zone':
      return `zone:${element.zoneId}`;
  }
}

function endpointExists(
  endpoint: Domain.RelationshipEndpoint,
  fragment: MindMapClipboardFragment,
): boolean {
  const element = endpoint.element;
  switch (element.kind) {
    case 'topic':
      return fragment.topics[element.topicId] !== undefined;
    case 'boundary':
      return fragment.boundaries[element.boundaryId] !== undefined;
    case 'callout':
      return fragment.callouts[element.calloutId] !== undefined;
    case 'zone':
      return fragment.zones[element.zoneId] !== undefined;
  }
}

function fragmentIncomingEdges(
  fragment: MindMapClipboardFragment,
): Map<Domain.TopicId, Domain.TreeEdge> {
  return new Map(
    Object.values(fragment.treeEdges).map((edge) => [edge.childTopicId, edge] as const),
  );
}

function resolvedFragmentSide(
  edge: Domain.TreeEdge,
  incoming: ReadonlyMap<Domain.TopicId, Domain.TreeEdge>,
): Domain.BranchSide {
  const visited = new Set<Domain.TopicId>();
  let cursor: Domain.TreeEdge | undefined = edge;
  while (cursor) {
    if (cursor.side !== 'inherit') return cursor.side;
    if (visited.has(cursor.parentTopicId)) break;
    visited.add(cursor.parentTopicId);
    cursor = incoming.get(cursor.parentTopicId);
  }
  return 'right';
}

function fragmentSiblingEdges(
  fragment: MindMapClipboardFragment,
  edge: Domain.TreeEdge,
  incoming: ReadonlyMap<Domain.TopicId, Domain.TreeEdge>,
): Domain.TreeEdge[] {
  const side = resolvedFragmentSide(edge, incoming);
  return Object.values(fragment.treeEdges)
    .filter((candidate) =>
      candidate.parentTopicId === edge.parentTopicId
      && candidate.slot === edge.slot
      && resolvedFragmentSide(candidate, incoming) === side)
    .sort((left, right) =>
      left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
}

function fragmentDescendants(
  fragment: MindMapClipboardFragment,
  rootTopicId: Domain.TopicId,
  maximumDepth = Number.POSITIVE_INFINITY,
): Domain.TopicId[] {
  const children = new Map<Domain.TopicId, Domain.TreeEdge[]>();
  for (const edge of Object.values(fragment.treeEdges)) {
    const group = children.get(edge.parentTopicId) ?? [];
    group.push(edge);
    children.set(edge.parentTopicId, group);
  }
  for (const group of children.values()) {
    group.sort((left, right) =>
      left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id));
  }
  const result: Domain.TopicId[] = [];
  const visited = new Set<Domain.TopicId>();
  const visit = (topicId: Domain.TopicId, depth: number): void => {
    if (!fragment.topics[topicId] || visited.has(topicId)) return;
    visited.add(topicId);
    result.push(topicId);
    if (depth >= maximumDepth) return;
    for (const edge of children.get(topicId) ?? []) visit(edge.childTopicId, depth + 1);
  };
  visit(rootTopicId, 0);
  return result;
}

function expandFragmentScope(
  scope: Domain.TopicScope,
  fragment: MindMapClipboardFragment,
): Domain.TopicId[] {
  if (scope.kind === 'explicit') {
    return [...new Set(scope.topicIds)].filter((topicId) => Boolean(fragment.topics[topicId]));
  }
  if (scope.kind === 'subtree') {
    return fragmentDescendants(
      fragment,
      scope.rootTopicId,
      scope.depth === 'all' ? Number.POSITIVE_INFINITY : Math.max(0, scope.depth),
    );
  }
  const first = fragment.treeEdges[scope.firstEdgeId];
  const last = fragment.treeEdges[scope.lastEdgeId];
  if (!first || !last) return [];
  const incoming = fragmentIncomingEdges(fragment);
  if (
    first.parentTopicId !== scope.parentTopicId
    || last.parentTopicId !== scope.parentTopicId
    || first.slot !== last.slot
    || resolvedFragmentSide(first, incoming) !== resolvedFragmentSide(last, incoming)
  ) return [];
  const siblings = fragmentSiblingEdges(fragment, first, incoming);
  const firstIndex = siblings.findIndex((edge) => edge.id === first.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === last.id);
  if (firstIndex < 0 || lastIndex < firstIndex) return [];
  return siblings.slice(firstIndex, lastIndex + 1).flatMap((edge) =>
    scope.includeDescendants
      ? fragmentDescendants(fragment, edge.childTopicId)
      : [edge.childTopicId]);
}

function scopeReferencesExist(
  scope: Domain.TopicScope,
  fragment: MindMapClipboardFragment,
): boolean {
  if (scope.kind === 'explicit') {
    return scope.topicIds.length > 0 && scope.topicIds.every((id) => fragment.topics[id]);
  }
  if (scope.kind === 'subtree') return fragment.topics[scope.rootTopicId] !== undefined;
  const first = fragment.treeEdges[scope.firstEdgeId];
  const last = fragment.treeEdges[scope.lastEdgeId];
  const incoming = fragmentIncomingEdges(fragment);
  if (
    !first
    || !last
    || first.parentTopicId !== scope.parentTopicId
    || last.parentTopicId !== scope.parentTopicId
    || first.slot !== last.slot
    || resolvedFragmentSide(first, incoming) !== resolvedFragmentSide(last, incoming)
  ) return false;
  const siblings = fragmentSiblingEdges(fragment, first, incoming);
  const firstIndex = siblings.findIndex((edge) => edge.id === first.id);
  const lastIndex = siblings.findIndex((edge) => edge.id === last.id);
  return Boolean(
    fragment.topics[scope.parentTopicId] &&
      firstIndex >= 0 &&
      lastIndex >= firstIndex,
  );
}

function addRecordIds(
  recordName: string,
  record: Record<string, { id: string }>,
  allIds: Set<string>,
  issues: string[],
): void {
  for (const [key, entity] of Object.entries(record)) {
    if (key !== entity.id) issues.push(`${recordName}.${key}: record key differs from entity.id`);
    if (allIds.has(entity.id)) issues.push(`${recordName}.${key}: duplicate global entity id`);
    allIds.add(entity.id);
  }
}

function validateTree(fragment: MindMapClipboardFragment, rootIds: Set<string>): string[] {
  const issues: string[] = [];
  const incoming = new Map<Domain.TopicId, number>();
  const children = new Map<Domain.TopicId, Domain.TopicId[]>();
  for (const edge of Object.values(fragment.treeEdges)) {
    if (!fragment.topics[edge.parentTopicId]) {
      issues.push(`treeEdges.${edge.id}: missing parent topic ${edge.parentTopicId}`);
    }
    if (!fragment.topics[edge.childTopicId]) {
      issues.push(`treeEdges.${edge.id}: missing child topic ${edge.childTopicId}`);
    }
    if (edge.parentTopicId === edge.childTopicId) {
      issues.push(`treeEdges.${edge.id}: self loop`);
    }
    incoming.set(edge.childTopicId, (incoming.get(edge.childTopicId) ?? 0) + 1);
    const list = children.get(edge.parentTopicId) ?? [];
    list.push(edge.childTopicId);
    children.set(edge.parentTopicId, list);
  }
  for (const [topicId, count] of incoming) {
    if (count > 1) issues.push(`topics.${topicId}: multiple incoming TreeEdges`);
    if (rootIds.has(topicId)) issues.push(`topics.${topicId}: clipboard root has an incoming TreeEdge`);
  }

  const state = new Map<Domain.TopicId, 0 | 1 | 2>();
  const visit = (topicId: Domain.TopicId): void => {
    const current = state.get(topicId) ?? 0;
    if (current === 1) {
      issues.push(`topics.${topicId}: TreeEdge cycle detected`);
      return;
    }
    if (current === 2) return;
    state.set(topicId, 1);
    for (const childId of children.get(topicId) ?? []) visit(childId);
    state.set(topicId, 2);
  };
  for (const topicId of Object.keys(fragment.topics) as Domain.TopicId[]) visit(topicId);
  return issues;
}

function validateLinks(
  envelope: MindMapClipboardEnvelopeV1,
): string[] {
  const issues: string[] = [];
  const fragment = envelope.fragment;
  for (const link of Object.values(fragment.links)) {
    if (!fragment.topics[link.topicId]) {
      issues.push(`links.${link.id}: missing owner topic ${link.topicId}`);
    }
    if (link.kind === 'sheet') {
      issues.push(`links.${link.id}: sheet links are not cross-document safe`);
    } else if (link.kind === 'topic') {
      if (
        link.targetSheetId !== envelope.source.sheetId ||
        !fragment.topics[link.targetTopicId]
      ) {
        issues.push(`links.${link.id}: external topic target is not allowed`);
      }
    } else if (link.kind === 'web') {
      if (!isAllowedUrl(link.href, ['https:', 'http:'])) {
        issues.push(`links.${link.id}: unsafe web URL`);
      }
    } else if (link.kind === 'email') {
      if (!isAllowedUrl(link.href, ['mailto:'])) {
        issues.push(`links.${link.id}: unsafe email URL`);
      }
    } else if (link.kind === 'file' || link.kind === 'folder') {
      if (!isAllowedUrl(link.href, ['file:'])) {
        issues.push(`links.${link.id}: unsafe file URL`);
      }
    }
  }
  return issues;
}

function validateResourceSources(fragment: MindMapClipboardFragment): string[] {
  const issues: string[] = [];
  for (const asset of Object.values(fragment.assets)) {
    if (asset.source.kind === 'remote') {
      if (!isSafeRemoteAssetUrl(asset.source.url)) {
        issues.push(`assets.${asset.id}: unsafe remote URL`);
      }
    } else if (asset.source.kind === 'embedded') {
      if (hasUnsafeAssetPath(asset.source.relativePath)) {
        issues.push(`assets.${asset.id}: unsafe embedded path`);
      }
    } else if (hasUnsafeAssetPath(asset.source.objectKey)) {
      issues.push(`assets.${asset.id}: unsafe managed object key`);
    }
  }
  return issues;
}

export function validateMindMapClipboardReferences(
  envelope: MindMapClipboardEnvelopeV1,
): readonly string[] {
  const fragment = envelope.fragment;
  const issues: string[] = [];
  const allIds = new Set<string>();
  const records: Array<[string, Record<string, { id: string }>]> = [
    ['topics', fragment.topics],
    ['treeEdges', fragment.treeEdges],
    ['relationships', fragment.relationships],
    ['boundaries', fragment.boundaries],
    ['summaries', fragment.summaries],
    ['callouts', fragment.callouts],
    ['zones', fragment.zones],
    ['styles', fragment.styles],
    ['markerGroups', fragment.markerGroups],
    ['markerDefinitions', fragment.markerDefinitions],
    ['markerInstances', fragment.markerInstances],
    ['notes', fragment.notes],
    ['links', fragment.links],
    ['assets', fragment.assets],
    ['attachments', fragment.attachments],
    ['images', fragment.images],
    ['equations', fragment.equations],
    ['audioClips', fragment.audioClips],
    ['todos', fragment.todos],
    ['tasks', fragment.tasks],
    ['taskDependencies', fragment.taskDependencies],
  ];
  for (const [name, record] of records) addRecordIds(name, record, allIds, issues);
  for (const relationship of Object.values(fragment.relationships)) {
    for (const [key, point] of Object.entries(relationship.controlPoints ?? {})) {
      if (key !== point.id) {
        issues.push(`relationships.${relationship.id}.controlPoints.${key}: key differs from id`);
      }
      if (allIds.has(point.id)) {
        issues.push(`relationships.${relationship.id}.controlPoints.${key}: duplicate global id`);
      }
      allIds.add(point.id);
    }
  }

  const rootIds = new Set(envelope.rootTopicIds);
  for (const rootId of rootIds) {
    if (!fragment.topics[rootId]) issues.push(`rootTopicIds: missing topic ${rootId}`);
  }
  if (
    envelope.rootHints.length !== envelope.rootTopicIds.length ||
    envelope.rootHints.some((hint, index) => hint.topicId !== envelope.rootTopicIds[index])
  ) {
    issues.push('rootHints must have exactly one ordered entry per rootTopicId');
  }
  issues.push(...validateTree(fragment, rootIds));

  const styledEntities: Array<{ id: string; style?: Domain.StyleBinding }> = [
    ...Object.values(fragment.topics),
    ...Object.values(fragment.treeEdges),
    ...Object.values(fragment.relationships),
    ...Object.values(fragment.boundaries),
    ...Object.values(fragment.summaries),
    ...Object.values(fragment.callouts),
    ...Object.values(fragment.zones),
  ];
  for (const entity of styledEntities) {
    const styleId = entity.style?.styleId;
    if (styleId && !fragment.styles[styleId]) {
      issues.push(`entity.${entity.id}: missing style ${styleId}`);
    }
  }
  for (const style of Object.values(fragment.styles)) {
    if (style.basedOnStyleId && !fragment.styles[style.basedOnStyleId]) {
      issues.push(`styles.${style.id}: missing base style ${style.basedOnStyleId}`);
    }
  }

  for (const relationship of Object.values(fragment.relationships)) {
    if (!endpointExists(relationship.source, fragment)) {
      issues.push(`relationships.${relationship.id}: missing source endpoint`);
    }
    if (!endpointExists(relationship.target, fragment)) {
      issues.push(`relationships.${relationship.id}: missing target endpoint`);
    }
    if (endpointKey(relationship.source) === endpointKey(relationship.target)) {
      issues.push(`relationships.${relationship.id}: self relationship`);
    }
  }
  for (const boundary of Object.values(fragment.boundaries)) {
    if (!scopeReferencesExist(boundary.scope, fragment)) {
      issues.push(`boundaries.${boundary.id}: dangling scope`);
    }
  }
  const summaryOwnerCounts = new Map<Domain.TopicId, number>();
  const incomingTopicIds = new Set(
    Object.values(fragment.treeEdges).map((edge) => edge.childTopicId),
  );
  for (const summary of Object.values(fragment.summaries)) {
    if (!scopeReferencesExist(summary.scope, fragment)) {
      issues.push(`summaries.${summary.id}: dangling scope`);
    }
    const resultTopic = fragment.topics[summary.resultTopicId];
    summaryOwnerCounts.set(
      summary.resultTopicId,
      (summaryOwnerCounts.get(summary.resultTopicId) ?? 0) + 1,
    );
    if (!resultTopic) {
      issues.push(`summaries.${summary.id}: missing result topic ${summary.resultTopicId}`);
      continue;
    }
    if (resultTopic.role !== 'summary-result') {
      issues.push(`summaries.${summary.id}: result topic must use role summary-result`);
    }
    if (resultTopic.placement.mode === 'absolute') {
      issues.push(`summaries.${summary.id}: result topic cannot use absolute placement`);
    }
    if (incomingTopicIds.has(summary.resultTopicId)) {
      issues.push(`summaries.${summary.id}: result topic must not have an incoming TreeEdge`);
    }
    const members = expandFragmentScope(summary.scope, fragment);
    if (members.includes(summary.resultTopicId)) {
      issues.push(`summaries.${summary.id}: result topic cannot be inside its own scope`);
    }
    const illegalMember = members.find((topicId) => {
      const role = fragment.topics[topicId]?.role;
      return role === 'central' || role === 'summary-result';
    });
    if (illegalMember) {
      issues.push(`summaries.${summary.id}: scope contains illegal topic ${illegalMember}`);
    }
    const floatingRoots = members.filter(
      (topicId) => fragment.topics[topicId]?.role === 'floating-root',
    );
    if (floatingRoots.length > 1) {
      issues.push(`summaries.${summary.id}: scope contains multiple floating roots`);
    }
  }
  for (const [resultTopicId, ownerCount] of summaryOwnerCounts) {
    if (ownerCount > 1) {
      issues.push(`topics.${resultTopicId}: Summary result has multiple owners`);
    }
  }
  for (const topic of Object.values(fragment.topics)) {
    if (topic.role !== 'summary-result') continue;
    const ownerCount = summaryOwnerCounts.get(topic.id) ?? 0;
    // A result-only clipboard root is intentionally converted to a regular
    // branch root by the paste planner. Any other orphan is malformed.
    if (ownerCount === 0 && !rootIds.has(topic.id)) {
      issues.push(`topics.${topic.id}: unowned Summary result topic`);
    }
  }
  for (const callout of Object.values(fragment.callouts)) {
    if (!fragment.topics[callout.targetTopicId]) {
      issues.push(`callouts.${callout.id}: missing target topic ${callout.targetTopicId}`);
    }
  }
  for (const zone of Object.values(fragment.zones)) {
    for (const topicId of zone.rootTopicIds) {
      if (!fragment.topics[topicId]) issues.push(`zones.${zone.id}: missing root topic ${topicId}`);
    }
  }

  for (const instance of Object.values(fragment.markerInstances)) {
    if (!fragment.topics[instance.topicId]) {
      issues.push(`markerInstances.${instance.id}: missing topic ${instance.topicId}`);
    }
    if (!fragment.markerDefinitions[instance.markerDefinitionId]) {
      issues.push(
        `markerInstances.${instance.id}: missing definition ${instance.markerDefinitionId}`,
      );
    }
  }
  for (const definition of Object.values(fragment.markerDefinitions)) {
    if (!fragment.markerGroups[definition.groupId]) {
      issues.push(`markerDefinitions.${definition.id}: missing group ${definition.groupId}`);
    }
    if (definition.source.kind === 'asset' && !fragment.assets[definition.source.assetId]) {
      issues.push(`markerDefinitions.${definition.id}: missing asset ${definition.source.assetId}`);
    }
  }

  const topicContentRecords: Array<
    [string, Record<string, { id: string; topicId: Domain.TopicId }>]
  > = [
    ['notes', fragment.notes],
    ['attachments', fragment.attachments],
    ['images', fragment.images],
    ['equations', fragment.equations],
    ['audioClips', fragment.audioClips],
    ['todos', fragment.todos],
    ['tasks', fragment.tasks],
  ];
  for (const [name, record] of topicContentRecords) {
    for (const entity of Object.values(record)) {
      if (!fragment.topics[entity.topicId]) {
        issues.push(`${name}.${entity.id}: missing topic ${entity.topicId}`);
      }
    }
  }
  issues.push(...validateLinks(envelope));

  for (const attachment of Object.values(fragment.attachments)) {
    if (!fragment.assets[attachment.assetId]) {
      issues.push(`attachments.${attachment.id}: missing asset ${attachment.assetId}`);
    }
  }
  for (const image of Object.values(fragment.images)) {
    if (!fragment.assets[image.assetId]) {
      issues.push(`images.${image.id}: missing asset ${image.assetId}`);
    }
  }
  for (const clip of Object.values(fragment.audioClips)) {
    if (!fragment.assets[clip.assetId]) {
      issues.push(`audioClips.${clip.id}: missing asset ${clip.assetId}`);
    }
  }
  for (const dependency of Object.values(fragment.taskDependencies)) {
    if (!fragment.tasks[dependency.predecessorTaskId]) {
      issues.push(
        `taskDependencies.${dependency.id}: missing predecessor ${dependency.predecessorTaskId}`,
      );
    }
    if (!fragment.tasks[dependency.successorTaskId]) {
      issues.push(
        `taskDependencies.${dependency.id}: missing successor ${dependency.successorTaskId}`,
      );
    }
  }

  issues.push(...validateResourceSources(fragment));
  return [...new Set(issues)].sort();
}
