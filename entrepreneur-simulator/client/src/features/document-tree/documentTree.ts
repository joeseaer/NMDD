export type DocumentTreeItem = {
  id: string;
  title: string;
  parent_id?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DocumentTreeNode<T extends DocumentTreeItem> = {
  item: T;
  children: DocumentTreeNode<T>[];
};

const normalizedOrder = (item: DocumentTreeItem) => {
  const value = Number(item.sort_order);
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
};

const normalizedTimestamp = (value: string | null | undefined) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const documentActivityTimestamp = (item: DocumentTreeItem) => Math.max(
  normalizedTimestamp(item.updated_at),
  normalizedTimestamp(item.created_at),
);

export const compareDocumentTreeItems = <T extends DocumentTreeItem>(left: T, right: T) => {
  const activityDifference = documentActivityTimestamp(right) - documentActivityTimestamp(left);
  if (activityDifference) return activityDifference;

  // sort_order is a millisecond timestamp for current and migrated pages. It
  // also gives legacy pages a deterministic newest-first order when their old
  // API timestamps only had day-level precision.
  const orderDifference = normalizedOrder(right) - normalizedOrder(left);
  if (orderDifference) return orderDifference;
  return (left.title || '').localeCompare(right.title || '', 'zh-CN') || left.id.localeCompare(right.id);
};

export const formatDocumentDate = (value: string | null | undefined) => {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN') : value;
};

export const buildDocumentTree = <T extends DocumentTreeItem>(items: T[]): DocumentTreeNode<T>[] => {
  const sorted = [...items].sort(compareDocumentTreeItems);
  const itemsById = new Map(sorted.map((item) => [item.id, item]));
  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];

  sorted.forEach((item) => {
    const parentId = item.parent_id || null;
    if (!parentId || parentId === item.id || !itemsById.has(parentId)) {
      roots.push(item);
      return;
    }
    const children = childrenByParent.get(parentId) || [];
    children.push(item);
    childrenByParent.set(parentId, children);
  });
  childrenByParent.forEach((children) => children.sort(compareDocumentTreeItems));

  const visited = new Set<string>();
  const materialize = (item: T, lineage: Set<string>): DocumentTreeNode<T> => {
    visited.add(item.id);
    const nextLineage = new Set(lineage);
    nextLineage.add(item.id);
    const children = (childrenByParent.get(item.id) || [])
      .filter((child) => !nextLineage.has(child.id))
      .map((child) => materialize(child, nextLineage));
    return { item, children };
  };

  const tree = roots.map((item) => materialize(item, new Set()));
  // Corrupt legacy data can contain a closed cycle with no root. Surface every
  // page once at the root instead of making it disappear from navigation.
  sorted.forEach((item) => {
    if (!visited.has(item.id)) tree.push(materialize(item, new Set()));
  });
  return tree;
};

export const getDocumentAncestors = <T extends DocumentTreeItem>(items: T[], pageId: string): T[] => {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const ancestors: T[] = [];
  const visited = new Set([pageId]);
  let cursor = itemsById.get(pageId);

  while (cursor?.parent_id) {
    if (visited.has(cursor.parent_id)) break;
    const parent = itemsById.get(cursor.parent_id);
    if (!parent) break;
    ancestors.unshift(parent);
    visited.add(parent.id);
    cursor = parent;
  }
  return ancestors;
};

export const getDocumentChildren = <T extends DocumentTreeItem>(items: T[], pageId: string): T[] => (
  items.filter((item) => item.parent_id === pageId).sort(compareDocumentTreeItems)
);

export const getDocumentDescendantIds = <T extends DocumentTreeItem>(items: T[], pageId: string): Set<string> => {
  const childrenByParent = new Map<string, string[]>();
  items.forEach((item) => {
    if (!item.parent_id) return;
    const children = childrenByParent.get(item.parent_id) || [];
    children.push(item.id);
    childrenByParent.set(item.parent_id, children);
  });

  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(pageId) || [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === pageId || descendants.has(id)) continue;
    descendants.add(id);
    queue.push(...(childrenByParent.get(id) || []));
  }
  return descendants;
};

export const includeMatchingPagesAndAncestors = <T extends DocumentTreeItem>(
  items: T[],
  matchingIds: ReadonlySet<string>,
): T[] => {
  const included = new Set<string>();
  matchingIds.forEach((id) => {
    included.add(id);
    getDocumentAncestors(items, id).forEach((ancestor) => included.add(ancestor.id));
  });
  return items.filter((item) => included.has(item.id));
};

export const formatDocumentPath = <T extends DocumentTreeItem>(items: T[], page: T) => (
  [...getDocumentAncestors(items, page.id), page]
    .map((item) => item.title || '未命名文档')
    .join(' / ')
);
