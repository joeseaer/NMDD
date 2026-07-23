// @ts-ignore Test-only Vitest bridge; Node typings are intentionally not exposed to the browser app.
import { createRequire } from 'node:module';
// @ts-ignore Test-only Vitest bridge; Node typings are intentionally not exposed to the browser app.
import path from 'node:path';

import { generateJSON, getSchema, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import { afterEach, describe, expect, it } from 'vitest';

import { MindMap } from '../../components/TiptapExtensions';
import type { DocumentNodeJson } from '../document-editor/schema/documentSchema';
import { installMindMapMarkdownFence } from '../document-editor/serialization/mindMapMarkdownFence';
import { serializeToMarkdown } from '../document-editor/serialization/toMarkdown';
import { createRichText, createTopic } from './domain/defaults';
import { parseMindMapDocument } from './domain/parser';
import type * as Domain from './domain/types';
import { validateMindMapDocument } from './domain/validation';
import { createMindMapElementsFixture } from './testing/fixtures';

interface StoredSopRow {
  readonly content: string;
  readonly content_json: unknown;
  readonly content_revision: number;
  readonly content_schema_version: number;
  readonly id: string;
}

interface FakeSupabaseState {
  readonly calls: Array<{
    readonly operation: string;
    readonly table: string;
  }>;
  readonly rows: Map<string, StoredSopRow>;
}

interface FakeSupabase {
  readonly client: unknown;
  readonly state: FakeSupabaseState;
}

interface DbServiceForTest {
  __setSupabaseClientForTests(client: unknown): void;
}

interface FastifyResponse {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly statusCode: number;
  json(): Record<string, unknown> | Array<Record<string, unknown>>;
}

interface FastifyApp {
  close(): Promise<void>;
  inject(input: {
    readonly method: 'GET' | 'POST';
    readonly payload?: Record<string, unknown>;
    readonly url: string;
  }): Promise<FastifyResponse>;
  ready(): Promise<void>;
  register(plugin: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

type FastifyFactory = (options: { logger: boolean }) => FastifyApp;
type CreateFakeSupabase = () => FakeSupabase;

const serverRequire = createRequire(
  path.resolve(
    (globalThis as typeof globalThis & { process: { cwd(): string } }).process.cwd(),
    '../server/package.json',
  ),
);
const Fastify = serverRequire('fastify') as FastifyFactory;
const apiRoutes = serverRequire('./routes/api.js') as unknown;
const dbService = serverRequire('./services/dbService.js') as DbServiceForTest;
const { createFakeSupabase } = serverRequire('./tests/helpers/fakeSupabase.js') as {
  createFakeSupabase: CreateFakeSupabase;
};

const asId = <Kind extends string>(value: string): Domain.Id<Kind> => (
  value as Domain.Id<Kind>
);

const clone = <Value>(value: Value): Value => (
  JSON.parse(JSON.stringify(value)) as Value
);

const firstValue = <Value>(record: Record<string, Value>): Value => {
  const value = Object.values(record)[0];
  if (!value) throw new Error('Expected the semantic fixture to contain an entity.');
  return value;
};

const createPersistenceFixture = (): Domain.MindMapDocumentV1 => {
  const document = clone(createMindMapElementsFixture());
  const sheet = firstValue(document.sheets);
  const rootTopic = sheet.topics[sheet.rootTopicId];
  const asset = firstValue(document.assets);
  const markerGroup = firstValue(document.markerGroups);
  const markerDefinition = firstValue(document.markerDefinitions);
  const markerInstance = firstValue(sheet.markerInstances);
  const task = firstValue(sheet.tasks);
  const deck = firstValue(document.presentations);
  const slide = firstValue(deck.slides);
  const image = firstValue(sheet.images);
  const summary = firstValue(sheet.summaries);

  const actorId = asId<'Actor'>('01890f1a-0000-7000-8000-0000000f0001');
  const audioAssetId = asId<'Asset'>('01890f1a-0000-7000-8000-0000000f0002');
  const audioId = asId<'Audio'>('01890f1a-0000-7000-8000-0000000f0003');
  const exceptionId = asId<'CalendarException'>('01890f1a-0000-7000-8000-0000000f0004');
  const threadId = asId<'CommentThread'>('01890f1a-0000-7000-8000-0000000f0005');
  const commentId = asId<'Comment'>('01890f1a-0000-7000-8000-0000000f0006');
  const commandId = asId<'Command'>('01890f1a-0000-7000-8000-0000000f0007');
  const summaryChildTopicId = asId<'Topic'>('01890f1a-0000-7000-8000-0000000f0008');
  const summaryChildEdgeId = asId<'TreeEdge'>('01890f1a-0000-7000-8000-0000000f0009');
  const timestamp = '2026-07-20T08:09:10.123Z';

  document.contentRevision = 73;
  document.title = '产品路线图 🧭 — 保存/重载「全字段」';
  document.locale = 'zh-CN';
  document.audit = {
    createdAt: timestamp,
    createdBy: actorId,
    updatedAt: timestamp,
    updatedBy: actorId,
  };
  document.extensions = {
    'nmdd.persistence-test': {
      nested: { emoji: '扩展字段 🧪', enabled: true },
      version: 2,
    },
  };

  document.actors[actorId] = {
    id: actorId,
    displayName: '测试用户 周小满',
    email: 'unicode@example.com',
    externalRef: { provider: 'memory-http', subject: '用户-α' },
    status: 'active',
    extensions: { 'nmdd.actor-extra': { locale: '中文' } },
  };

  sheet.extensions = { 'nmdd.sheet-extra': { mode: '完整保真' } };
  sheet.workCalendar.exceptions[exceptionId] = {
    id: exceptionId,
    orderKey: 'holiday-2026',
    title: '国庆节 🎉',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    type: 'day-off',
    repeat: 'yearly',
    extensions: { 'nmdd.calendar-extra': { source: '测试日历' } },
  };
  rootTopic.extensions = {
    'nmdd.topic-extra': { untouchedP2: ['甲', '乙', '🌏'] },
  };

  const summaryScopeEdges = Object.values(sheet.treeEdges)
    .filter((edge) => edge.parentTopicId === sheet.rootTopicId)
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  if (summaryScopeEdges.length < 2) {
    throw new Error('Persistence fixture requires two root-level Summary scope edges.');
  }
  summary.scope = {
    kind: 'sibling-range',
    parentTopicId: sheet.rootTopicId,
    firstEdgeId: summaryScopeEdges[0].id,
    lastEdgeId: summaryScopeEdges[1].id,
    includeDescendants: true,
  };
  summary.orientation = 'bottom';
  summary.style = {
    inheritance: 'break',
    overrides: {
      border: {
        color: { kind: 'literal', value: '#A855F7' },
        width: 4,
        dash: [6, 4],
      },
    },
  };
  sheet.topics[summary.resultTopicId].placement = { mode: 'offset', dx: 28, dy: 36 };
  sheet.topics[summaryChildTopicId] = createTopic({
    id: summaryChildTopicId,
    title: 'Summary persisted child',
    placement: { mode: 'offset', dx: 84, dy: 42 },
  });
  sheet.treeEdges[summaryChildEdgeId] = {
    id: summaryChildEdgeId,
    parentTopicId: summary.resultTopicId,
    childTopicId: summaryChildTopicId,
    orderKey: 'summary-child-a',
    side: 'inherit',
  };

  asset.extensions = { 'nmdd.asset-extra': { checksumSource: 'fixture' } };
  document.assets[audioAssetId] = {
    id: audioAssetId,
    fileName: '讲解-路线图-🎙️.mp3',
    mimeType: 'audio/mpeg',
    byteSize: 4_096,
    sha256: 'a'.repeat(64),
    durationMs: 91_337,
    source: {
      kind: 'remote',
      url: 'https://cdn.example.com/%E8%AE%B2%E8%A7%A3.mp3',
      etag: '音频-etag-α',
    },
    extensions: { 'nmdd.audio-asset-extra': { waveform: [0.1, 0.8, 0.3] } },
  };
  sheet.audioClips[audioId] = {
    id: audioId,
    topicId: sheet.rootTopicId,
    assetId: audioAssetId,
    orderKey: 'audio-a',
    transcript: createRichText('你好，世界。Audio transcript 🎧'),
    extensions: { 'nmdd.audio-extra': { language: 'zh-CN' } },
  };

  markerGroup.extensions = { 'nmdd.marker-group-extra': { exclusive: 'kept' } };
  markerDefinition.extensions = { 'nmdd.marker-extra': { semantic: '优先级一' } };
  markerInstance.extensions = { 'nmdd.marker-instance-extra': { pinned: true } };

  task.status = 'in-progress';
  task.progress = 0.35;
  task.priority = 2;
  task.startDate = '2026-07-21';
  task.dueDate = '2026-08-18';
  task.durationMinutes = 2_880;
  task.milestone = false;
  task.assigneeIds = [actorId];
  task.audit = {
    createdAt: timestamp,
    createdBy: actorId,
    updatedAt: timestamp,
    updatedBy: actorId,
  };
  task.displayFields = [
    'status',
    'progress',
    'priority',
    'assignees',
    'start-date',
    'due-date',
    'duration',
    'dependencies',
    'creator',
  ];
  task.extensions = { 'nmdd.task-extra': { externalTicket: '研发-42' } };

  deck.aspectRatio = 'custom';
  deck.customSize = { width: 1_600, height: 900 };
  deck.extensions = { 'nmdd.presentation-extra': { presenter: '周小满' } };
  deck.settings.includedTopicIds = [sheet.rootTopicId];
  deck.settings.excludedTopicIds = [];
  slide.title = '全字段演示 🎬';
  slide.camera = { padding: 48, zoom: 1.2 };
  slide.transition = { type: 'zoom', durationMs: 650 };
  slide.narrationAudioId = audioId;
  slide.imageOverrides = {
    [image.id]: {
      position: { xRatio: 0.2, yRatio: 0.8 },
      size: { width: 320, height: 180 },
      crop: { x: 1, y: 2, width: 300, height: 160 },
    },
  };
  slide.extensions = { 'nmdd.slide-extra': { subtitle: '不会丢失' } };

  document.collaboration = {
    mode: 'server-revision',
    remote: {
      provider: 'memory-fastify',
      remoteDocumentId: '远端文档-α',
      serverRevision: 'server-rev-9',
      baseSnapshotHash: 'b'.repeat(64),
    },
    logicalClock: { [actorId]: 12 },
    lastCommandId: commandId,
    accessPolicyRef: 'policy://测试/所有者',
    commentThreads: {
      [threadId]: {
        id: threadId,
        anchor: { kind: 'topic', id: sheet.rootTopicId },
        resolved: false,
        orphaned: false,
        comments: {
          [commentId]: {
            id: commentId,
            authorId: actorId,
            body: createRichText('评论正文：保留 Unicode ✅'),
            extensions: { 'nmdd.comment-extra': { mentions: ['@周小满'] } },
          },
        },
        extensions: { 'nmdd.thread-extra': { source: 'p2-extension' } },
      },
    },
    extensions: { 'nmdd.collaboration-extra': { transport: 'HTTP inject' } },
  };

  const validation = validateMindMapDocument(document);
  if (!validation.valid) {
    throw new Error(JSON.stringify(validation.issues, null, 2));
  }
  return document;
};

const tiptapExtensions = [StarterKit, MindMap];
const tiptapSchema = getSchema(tiptapExtensions);

const toTiptapDocument = (mindMap: Domain.MindMapDocumentV1): DocumentNodeJson => {
  const candidate: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'HTTP persistence integration' }],
      },
      { type: 'mindMap', attrs: { data: mindMap } },
    ],
  };
  return tiptapSchema.nodeFromJSON(candidate).toJSON() as DocumentNodeJson;
};

const parsePersistedMarkdown = (markdown: string): {
  readonly canonical: Domain.MindMapDocumentV1;
  readonly tiptap: DocumentNodeJson;
} => {
  const parser = new MarkdownIt({ html: true });
  installMindMapMarkdownFence(parser);
  const tiptap = generateJSON(parser.render(markdown), tiptapExtensions) as DocumentNodeJson;
  const node = tiptap.content?.find((entry) => entry.type === 'mindMap');
  if (!node) throw new Error('Reloaded Markdown did not produce a Tiptap mindMap node.');
  const parsed = parseMindMapDocument(node.attrs?.data);
  if (!parsed.ok) {
    throw new Error(`Reloaded mind map is invalid: ${JSON.stringify(parsed.issues)}`);
  }
  return { canonical: parsed.document, tiptap };
};

const preservedP1P2Fields = (document: Domain.MindMapDocumentV1): unknown => {
  const sheet = firstValue(document.sheets);
  return {
    extensions: document.extensions,
    collaboration: document.collaboration,
    assets: document.assets,
    markerGroups: document.markerGroups,
    markerDefinitions: document.markerDefinitions,
    presentations: document.presentations,
    savedViews: document.savedViews,
    sheet: {
      extensions: sheet.extensions,
      workCalendar: sheet.workCalendar,
      markerLegend: sheet.markerLegend,
      markerInstances: sheet.markerInstances,
      notes: sheet.notes,
      links: sheet.links,
      attachments: sheet.attachments,
      images: sheet.images,
      equations: sheet.equations,
      audioClips: sheet.audioClips,
      todos: sheet.todos,
      tasks: sheet.tasks,
      taskDependencies: sheet.taskDependencies,
    },
  };
};

afterEach(() => {
  dbService.__setSupabaseClientForTests(null);
});

describe('mind map document HTTP persistence', () => {
  // @covers ACC-IO-020
  // @covers ACC-SEM-011
  it('round-trips a full canonical map through Tiptap, Markdown, Fastify, dbService and reload', async () => {
    const source = createPersistenceFixture();
    const beforeP1P2 = preservedP1P2Fields(source);
    const tiptapBeforeSave = toTiptapDocument(source);
    const markdown = serializeToMarkdown(tiptapBeforeSave);
    expect(markdown.match(/```mindmap/g)).toHaveLength(1);
    expect(markdown).toContain('产品路线图 🧭');

    const fake = createFakeSupabase();
    dbService.__setSupabaseClientForTests(fake.client);
    const app = Fastify({ logger: false });

    try {
      await app.register(apiRoutes, { prefix: '/api' });
      await app.ready();

      const saveResponse = await app.inject({
        method: 'POST',
        url: '/api/sop/create',
        payload: {
          user_id: 'mindmap-http-user',
          title: source.title,
          category: 'document',
          tags: ['mindmap', '持久化'],
          version: 'V2.0',
          content: markdown,
          content_schema_version: 2,
        },
      });
      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.headers.etag).toBe('"1"');
      const saveResult = saveResponse.json() as Record<string, unknown>;
      const documentId = String(saveResult.id);
      expect(saveResult).toMatchObject({
        content_revision: 1,
        content_schema_version: 2,
        revision_supported: true,
      });

      const stored = fake.state.rows.get(documentId);
      expect(stored).toBeDefined();
      expect(stored?.content).toBe(markdown);
      expect(stored?.content_json).toBeNull();
      expect(stored?.content_revision).toBe(1);
      expect(fake.state.calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'insert', table: 'sops' }),
        expect.objectContaining({ operation: 'select', table: 'sops' }),
      ]));

      const reloadResponse = await app.inject({
        method: 'GET',
        url: '/api/sop/mindmap-http-user',
      });
      expect(reloadResponse.statusCode).toBe(200);
      const documents = reloadResponse.json() as Array<Record<string, unknown>>;
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({
        id: documentId,
        content: markdown,
        content_json: null,
        content_revision: 1,
        content_schema_version: 2,
        revision_supported: true,
      });

      const reloaded = parsePersistedMarkdown(String(documents[0].content));
      expect(reloaded.tiptap.content?.some((node) => node.type === 'mindMap')).toBe(true);
      expect(reloaded.canonical.contentRevision).toBe(73);
      expect(reloaded.canonical.title).toBe('产品路线图 🧭 — 保存/重载「全字段」');
      expect(reloaded.canonical).toEqual(source);
      const sourceSheet = firstValue(source.sheets);
      const sourceSummary = firstValue(sourceSheet.summaries);
      const summaryChildEdge = Object.values(sourceSheet.treeEdges)
        .find((edge) => edge.orderKey === 'summary-child-a');
      if (!summaryChildEdge) throw new Error('Expected persisted Summary result child edge.');
      const reloadedSheet = firstValue(reloaded.canonical.sheets);
      expect(reloadedSheet.summaries[sourceSummary.id]).toEqual(sourceSummary);
      expect(reloadedSheet.topics[summaryChildEdge.childTopicId]).toEqual(
        sourceSheet.topics[summaryChildEdge.childTopicId],
      );
      expect(reloadedSheet.treeEdges[summaryChildEdge.id]).toEqual(
        summaryChildEdge,
      );
      expect(preservedP1P2Fields(reloaded.canonical)).toEqual(beforeP1P2);

      const edited = clone(reloaded.canonical);
      edited.title = '产品路线图 🧭 — 第二次 CAS 保存';
      edited.contentRevision = 74;
      const editedMarkdown = serializeToMarkdown(toTiptapDocument(edited));
      const updateResponse = await app.inject({
        method: 'POST',
        url: '/api/sop/create',
        payload: {
          id: documentId,
          user_id: 'mindmap-http-user',
          title: edited.title,
          category: 'document',
          tags: ['mindmap', '持久化'],
          version: 'V2.1',
          content: editedMarkdown,
          content_schema_version: 2,
          expected_revision: 1,
        },
      });
      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.headers.etag).toBe('"2"');
      expect(updateResponse.json()).toMatchObject({ content_revision: 2 });

      const secondReloadResponse = await app.inject({
        method: 'GET',
        url: '/api/sop/mindmap-http-user',
      });
      const secondDocuments = secondReloadResponse.json() as Array<Record<string, unknown>>;
      const secondReload = parsePersistedMarkdown(String(secondDocuments[0].content));
      expect(secondDocuments[0]).toMatchObject({ content_revision: 2 });
      expect(secondReload.canonical).toEqual(edited);
      expect(secondReload.canonical.contentRevision).toBe(74);
      expect(preservedP1P2Fields(secondReload.canonical)).toEqual(beforeP1P2);
    } finally {
      await app.close();
    }
  });
});
