import { describe, expect, it } from 'vitest';
import {
  buildDocumentTree,
  getDocumentAncestors,
  getDocumentDescendantIds,
  includeMatchingPagesAndAncestors,
} from './documentTree';

const pages = [
  { id: 'root', title: 'Root', parent_id: null, sort_order: 10 },
  { id: 'second', title: 'Second', parent_id: null, sort_order: 20 },
  { id: 'child-b', title: 'Child B', parent_id: 'root', sort_order: 20 },
  { id: 'child-a', title: 'Child A', parent_id: 'root', sort_order: 10 },
  { id: 'grandchild', title: 'Grandchild', parent_id: 'child-a', sort_order: 10 },
];

describe('document page tree', () => {
  it('builds a stable sibling-ordered tree', () => {
    const tree = buildDocumentTree(pages);
    expect(tree.map((node) => node.item.id)).toEqual(['root', 'second']);
    expect(tree[0].children.map((node) => node.item.id)).toEqual(['child-a', 'child-b']);
    expect(tree[0].children[0].children[0].item.id).toBe('grandchild');
  });

  it('returns root-to-parent ancestors and all descendants', () => {
    expect(getDocumentAncestors(pages, 'grandchild').map((page) => page.id)).toEqual(['root', 'child-a']);
    expect([...getDocumentDescendantIds(pages, 'root')]).toEqual(['child-b', 'child-a', 'grandchild']);
  });

  it('keeps ancestor context around search matches', () => {
    const visible = includeMatchingPagesAndAncestors(pages, new Set(['grandchild']));
    expect(visible.map((page) => page.id)).toEqual(['root', 'child-a', 'grandchild']);
  });

  it('surfaces orphaned and cyclic legacy pages instead of hiding them', () => {
    const tree = buildDocumentTree([
      { id: 'orphan', title: 'Orphan', parent_id: 'missing' },
      { id: 'cycle-a', title: 'A', parent_id: 'cycle-b' },
      { id: 'cycle-b', title: 'B', parent_id: 'cycle-a' },
    ]);
    const ids = new Set<string>();
    const visit = (nodes: typeof tree) => nodes.forEach((node) => {
      ids.add(node.item.id);
      visit(node.children);
    });
    visit(tree);
    expect(ids).toEqual(new Set(['orphan', 'cycle-a', 'cycle-b']));
  });
});
