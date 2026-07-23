import { describe, expect, it } from 'vitest';
import type {
  MindMapSheet,
  Relationship,
  RelationshipId,
  Topic,
  TopicId,
  TreeEdge,
  TreeEdgeId,
} from './types';
import {
  getAncestors,
  getChildrenSorted,
  getDescendants,
  getParent,
  getTreeRoots,
  wouldCreateCycle,
} from './tree';
import { getRelationshipsForElement } from './selectors';

const topicId = (value: string) => value as TopicId;
const edgeId = (value: string) => value as TreeEdgeId;
const relationshipId = (value: string) => value as RelationshipId;

const makeTopic = (id: string, role: Topic['role'] = 'regular'): Topic => ({
  id: topicId(id),
  role,
  title: {
    type: 'doc',
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text: id }] }],
  },
  placement: { mode: 'auto' },
  sizing: { width: { mode: 'fit' } },
  defaultCollapsed: false,
});

const makeEdge = (
  id: string,
  parent: string,
  child: string,
  orderKey: string,
): TreeEdge => ({
  id: edgeId(id),
  parentTopicId: topicId(parent),
  childTopicId: topicId(child),
  orderKey,
  side: 'right',
});

const makeSheet = (): MindMapSheet => {
  const topics = {
    root: makeTopic('root', 'central'),
    alpha: makeTopic('alpha'),
    beta: makeTopic('beta'),
    leaf: makeTopic('leaf'),
    floating: makeTopic('floating', 'floating-root'),
  };
  const treeEdges = {
    edgeBeta: makeEdge('edgeBeta', 'root', 'beta', 'b'),
    edgeAlpha: makeEdge('edgeAlpha', 'root', 'alpha', 'a'),
    edgeLeaf: makeEdge('edgeLeaf', 'alpha', 'leaf', 'a'),
  };
  const relationship: Relationship = {
    id: relationshipId('relationship'),
    source: { element: { kind: 'topic', topicId: topicId('leaf') }, anchor: 'auto' },
    target: { element: { kind: 'topic', topicId: topicId('beta') }, anchor: 'auto' },
    routing: 'curve',
    startArrow: 'none',
    endArrow: 'triangle',
  };

  return {
    id: 'sheet' as MindMapSheet['id'],
    orderKey: 'a',
    title: 'Sheet',
    rootTopicId: topicId('root'),
    themeId: 'theme' as MindMapSheet['themeId'],
    defaultBranchLayout: {
      structure: 'core:mind-map',
      direction: 'both',
      mode: 'auto',
      compact: false,
      balance: 'automatic',
      freePositioning: false,
      justifyTopicAlignment: false,
      spacing: { sibling: 16, level: 64 },
    },
    advancedLayout: { flexibleFloatingTopics: false, allowTopicOverlap: false },
    canvas: {
      background: { kind: 'solid', color: { kind: 'literal', value: '#ffffff' } },
    },
    workCalendar: {
      timeZone: 'UTC',
      weekStartsOn: 1,
      workingWeekdays: [1, 2, 3, 4, 5],
      workdayMinutes: 480,
      skipNonWorkingDays: false,
      exceptions: {},
    },
    markerLegend: { visible: false, position: { x: 0, y: 0 } },
    topics,
    treeEdges,
    relationships: { [relationship.id]: relationship },
    boundaries: {},
    summaries: {},
    callouts: {},
    zones: {},
    markerInstances: {},
    notes: {},
    links: {},
    attachments: {},
    images: {},
    equations: {},
    audioClips: {},
    todos: {},
    tasks: {},
    taskDependencies: {},
  };
};

describe('mind map tree selectors', () => {
  it('uses stable edge order and traverses only structural edges', () => {
    const sheet = makeSheet();

    expect(getChildrenSorted(sheet, topicId('root')).map((topic) => topic.id))
      .toEqual(['alpha', 'beta']);
    expect(getParent(sheet, topicId('leaf'))?.id).toBe('alpha');
    expect(getAncestors(sheet, topicId('leaf')).map((topic) => topic.id))
      .toEqual(['alpha', 'root']);
    expect(getDescendants(sheet, topicId('root')).map((topic) => topic.id))
      .toEqual(['alpha', 'leaf', 'beta']);
  });

  it('keeps relationships out of parent and descendant traversal', () => {
    const sheet = makeSheet();

    expect(getParent(sheet, topicId('beta'))?.id).toBe('root');
    expect(getDescendants(sheet, topicId('leaf'))).toEqual([]);
    expect(getRelationshipsForElement(sheet, { kind: 'topic', topicId: topicId('leaf') }))
      .toHaveLength(1);
  });

  it('detects illegal reparenting and terminates on already-corrupt cycles', () => {
    const sheet = makeSheet();
    expect(wouldCreateCycle(sheet, topicId('leaf'), topicId('root'))).toBe(true);
    expect(wouldCreateCycle(sheet, topicId('root'), topicId('leaf'))).toBe(false);
    expect(wouldCreateCycle(sheet, topicId('leaf'), topicId('leaf'))).toBe(true);

    sheet.treeEdges[edgeId('cycle')] = makeEdge('cycle', 'leaf', 'root', 'z');
    expect(getDescendants(sheet, topicId('root')).map((topic) => topic.id))
      .toEqual(['alpha', 'leaf', 'beta']);
  });

  it('returns the central root first and preserves forest roots', () => {
    expect(getTreeRoots(makeSheet()).map((topic) => topic.id))
      .toEqual(['root', 'floating']);
  });
});
