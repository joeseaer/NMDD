import type { LegacyMindMapGraph } from '../legacy';

/** Representative payload emitted by the current React Flow editor. */
export const LEGACY_V0_RICH_FIXTURE: LegacyMindMapGraph = {
  createdAt: '2024-05-06T07:08:09.000Z',
  workspaceTag: 'fixture-workspace',
  nodes: [
    {
      id: 'root',
      type: 'mindMap',
      position: { x: 100, y: 100 },
      data: { label: 'Central topic', bold: false },
    },
    {
      id: 'branch-a',
      type: 'mindMap',
      position: { x: 340, y: 40 },
      data: { label: 'Branch A', bold: true, customFlag: 'preserve-me' },
      customNodeField: { source: 'legacy' },
      selected: true,
      width: 172,
    },
    {
      id: 'branch-b',
      type: 'mindMap',
      position: { x: 340, y: 180 },
      data: { label: 'Branch B', bold: false },
    },
    {
      id: 'leaf-a1',
      type: 'mindMap',
      position: { x: 580, y: 40 },
      data: { label: 'Leaf A1', bold: false },
    },
    {
      id: 'boundary-a',
      type: 'boundary',
      position: { x: 316, y: 16 },
      data: {
        memberIds: ['branch-a', 'leaf-a1'],
        padding: 24,
        w: 440,
        h: 120,
        label: 'Focus',
      },
    },
    {
      id: 'summary-ab',
      type: 'summary',
      position: { x: 760, y: 78 },
      data: {
        memberIds: ['branch-a', 'branch-b'],
        padding: 16,
        h: 190,
        label: 'Summary A+B',
      },
    },
  ],
  edges: [
    {
      id: 'tree-root-a',
      source: 'root',
      target: 'branch-a',
      type: 'smoothstep',
      style: { stroke: '#2563eb', strokeWidth: 2 },
    },
    {
      id: 'tree-root-b',
      source: 'root',
      target: 'branch-b',
      type: 'smoothstep',
    },
    {
      id: 'tree-a-a1',
      source: 'branch-a',
      target: 'leaf-a1',
      type: 'straight',
    },
    {
      id: 'link-a1-b',
      source: 'leaf-a1',
      target: 'branch-b',
      type: 'smoothstep',
      data: { kind: 'link', label: 'cross reference' },
      style: {
        stroke: '#dc2626',
        strokeWidth: 3,
        strokeDasharray: '5 3',
      },
      markerEnd: 'ArrowClosed',
      customEdgeField: 'preserve-me-too',
    },
  ],
};

/** Broken but bounded data exercises repair, demotion, and quarantine paths. */
export const LEGACY_V0_DAMAGED_FIXTURE: LegacyMindMapGraph = {
  nodes: [
    {
      id: 'root',
      type: 'mindMap',
      position: { x: 0, y: 0 },
      data: { label: 'Root' },
    },
    {
      id: 'a',
      type: 'mindMap',
      position: { x: 200, y: -60 },
      data: { label: 'A' },
    },
    {
      id: 'b',
      type: 'mindMap',
      position: { x: 400, y: -60 },
      data: { label: 'B' },
    },
    {
      id: 'a',
      type: 'mindMap',
      position: { x: -200, y: 80 },
      data: { label: 'Duplicate A' },
    },
    {
      id: 'bad-boundary',
      type: 'boundary',
      position: { x: 170, y: -90 },
      data: { memberIds: ['a', 'missing-topic', 42], padding: 20 },
    },
    {
      id: 'bad-summary',
      type: 'summary',
      position: { x: 500, y: 0 },
      data: { memberIds: ['root', 'a'], label: 'Invalid summary' },
    },
    {
      id: 'unsupported',
      type: 'foreignNode',
      position: { x: 0, y: 0 },
      data: { label: 'Unknown node' },
    },
    null,
  ],
  edges: [
    {
      id: '__mindmap_preview_edge__',
      source: 'a',
      target: 'b',
    },
    { id: 'root-a', source: 'root', target: 'a' },
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-a-second-parent', source: 'b', target: 'a' },
    { id: 'b-root', source: 'b', target: 'root' },
    { id: 'dangling', source: 'a', target: 'missing-topic' },
    { id: 'self-loop', source: 'a', target: 'a' },
    {
      id: 'boundary-to-topic',
      source: 'bad-boundary',
      target: 'a',
      data: { kind: 'link' },
    },
    {
      id: 'topic-to-boundary',
      source: 'a',
      target: 'bad-boundary',
      data: { kind: 'link' },
    },
    {
      id: 'topic-to-summary',
      source: 'a',
      target: 'bad-summary',
      data: { kind: 'link' },
    },
  ],
};

export const LEGACY_V0_NO_TOPIC_FIXTURE: LegacyMindMapGraph = {
  nodes: [
    {
      id: 'boundary-only',
      type: 'boundary',
      position: { x: 0, y: 0 },
      data: { memberIds: [] },
    },
  ],
  edges: [],
};
