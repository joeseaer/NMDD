import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FileText, Plus } from 'lucide-react';
import {
  buildDocumentTree,
  getDocumentAncestors,
  includeMatchingPagesAndAncestors,
  type DocumentTreeItem,
  type DocumentTreeNode,
} from './documentTree';

type DocumentPageTreeProps<T extends DocumentTreeItem> = {
  items: T[];
  selectedId?: string | null;
  matchingIds?: ReadonlySet<string>;
  storageKey: string;
  emptyMessage?: string;
  onSelect: (item: T) => void;
  onCreateChild?: (item: T) => void;
  renderIcon?: (item: T, active: boolean) => React.ReactNode;
  renderTrailing?: (item: T, active: boolean) => React.ReactNode;
};

const readExpandedIds = (storageKey: string) => {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
};

export function DocumentPageTree<T extends DocumentTreeItem>({
  items,
  selectedId,
  matchingIds,
  storageKey,
  emptyMessage = '暂无页面',
  onSelect,
  onCreateChild,
  renderIcon,
  renderTrailing,
}: DocumentPageTreeProps<T>) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpandedIds(storageKey));
  const visibleItems = useMemo(
    () => matchingIds ? includeMatchingPagesAndAncestors(items, matchingIds) : items,
    [items, matchingIds],
  );
  const tree = useMemo(() => buildDocumentTree(visibleItems), [visibleItems]);
  const searchActive = matchingIds !== undefined;

  useEffect(() => {
    if (!selectedId) return;
    const ancestorIds = getDocumentAncestors(items, selectedId).map((item) => item.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      ancestorIds.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [items, selectedId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify([...expandedIds]));
  }, [expandedIds, storageKey]);

  const toggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: DocumentTreeNode<T>, depth: number): React.ReactNode => {
    const { item, children } = node;
    const active = selectedId === item.id;
    const expanded = searchActive || expandedIds.has(item.id);
    return (
      <React.Fragment key={item.id}>
        <div
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={children.length ? expanded : undefined}
          aria-selected={active}
          className={`group flex min-h-9 items-center rounded-md pr-1 transition-colors ${
            active ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${Math.min(depth, 8) * 14 + 4}px` }}
        >
          {children.length ? (
            <button
              type="button"
              onClick={() => toggle(item.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label={expanded ? `收起 ${item.title}` : `展开 ${item.title}`}
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
          ) : <span className="h-7 w-7 shrink-0" />}

          <button
            type="button"
            onClick={() => onSelect(item)}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            title={item.title || '未命名文档'}
          >
            <span className={`shrink-0 ${active ? 'text-primary' : 'text-gray-400'}`}>
              {renderIcon ? renderIcon(item, active) : <FileText className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || '未命名文档'}</span>
            {renderTrailing?.(item, active)}
          </button>

          {onCreateChild ? (
            <button
              type="button"
              onClick={() => onCreateChild(item)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100"
              title={`在“${item.title || '未命名文档'}”下新建子页面`}
              aria-label={`在“${item.title || '未命名文档'}”下新建子页面`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {children.length && expanded ? children.map((child) => renderNode(child, depth + 1)) : null}
      </React.Fragment>
    );
  };

  if (!tree.length) return <div className="py-10 text-center text-sm text-gray-400">{emptyMessage}</div>;
  return <div role="tree" aria-label="页面树" className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</div>;
}
