import { zipSync } from 'fflate';

/** Hand-authored current-format XMind content.json used by codec tests. */
export const XMIND_CONTENT_JSON_FIXTURE = [
  {
    class: 'sheet',
    id: 'sheet-product',
    relationships: [
      {
        class: 'relationship',
        controlPoints: {
          0: { x: 12, y: 24 },
          1: { x: 48, y: 36 },
        },
        end1Id: 'topic-research',
        end2Id: 'topic-launch',
        id: 'relationship-roadmap',
        title: 'enables',
      },
    ],
    rootTopic: {
      boundaries: [
        {
          class: 'boundary',
          id: 'boundary-plan',
          range: '(0,1)',
          title: 'Plan',
        },
      ],
      children: {
        attached: [
          {
            children: {
              attached: [
                { id: 'topic-interviews', title: '访谈 10 位用户' },
              ],
            },
            href: 'https://example.com/research',
            id: 'topic-research',
            labels: ['discovery', 'Q1'],
            markers: [{ groupId: 'priority', markerId: 'priority-1' }],
            notes: { plain: { content: 'Evidence first.' } },
            title: 'Research 🔎',
          },
          {
            id: 'topic-launch',
            markers: [{ groupId: 'task', markerId: 'task-done' }],
            title: 'Launch',
          },
        ],
        detached: [
          {
            id: 'topic-floating',
            position: { x: -240, y: 80 },
            title: 'Parking lot',
          },
        ],
        summary: [
          { id: 'topic-summary-result', title: 'Ready to ship' },
        ],
      },
      extensions: [
        {
          content: { 'right-number': 1 },
          provider: 'org.xmind.ui.map.unbalanced',
        },
      ],
      id: 'topic-product-root',
      structureClass: 'org.xmind.ui.map.clockwise',
      summaries: [
        {
          class: 'summary',
          id: 'summary-plan',
          range: '(0,1)',
          topicId: 'topic-summary-result',
        },
      ],
      title: '产品路线图 🚀',
    },
    title: 'Product 产品',
    topicPositioning: 'loose',
    vendorSheetFlag: { retained: true },
  },
  {
    class: 'sheet',
    id: 'sheet-finance',
    relationships: [],
    rootTopic: {
      children: {
        attached: [
          {
            href: 'xmind:#sheet-product/topic-research',
            id: 'topic-revenue',
            title: 'Revenue',
          },
          { id: 'topic-cost', title: 'Cost' },
        ],
      },
      id: 'topic-finance-root',
      structureClass: 'org.xmind.ui.logic.left',
      title: 'Finance',
    },
    title: 'Finance',
    topicPositioning: 'fixed',
  },
] as const;

export function createHandcraftedXMindFixtureZip(options: {
  readonly includeResource?: boolean;
} = {}): Uint8Array {
  const encoder = new TextEncoder();
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  const files: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {
    'content.json': [Uint8Array.from(encoder.encode(JSON.stringify(XMIND_CONTENT_JSON_FIXTURE))), { level: 6, mtime }],
    'manifest.json': [Uint8Array.from(encoder.encode(JSON.stringify({
      'file-entries': {
        'content.json': {},
        'metadata.json': {},
        ...(options.includeResource ? { 'Resources/pixel.png': {} } : {}),
      },
    }))), { level: 6, mtime }],
    'metadata.json': [Uint8Array.from(encoder.encode(JSON.stringify({
      creator: { name: 'Handcrafted fixture' },
      nmdd: { documentTitle: '2026 Product Workbook' },
    }))), { level: 6, mtime }],
  };
  if (options.includeResource) {
    files['Resources/pixel.png'] = [new Uint8Array([137, 80, 78, 71]), { level: 0, mtime }];
  }
  return zipSync(files, { level: 6, mtime });
}
