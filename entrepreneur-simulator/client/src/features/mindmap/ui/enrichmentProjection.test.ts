import { describe, expect, it } from 'vitest';

import { createNewMindMapDocument, createTopic } from '../domain/defaults';
import type {
  ActorId,
  AssetId,
  AttachmentId,
  DocumentId,
  ImageId,
  LinkId,
  MarkerDefinitionId,
  MarkerGroupId,
  MarkerInstanceId,
  NoteId,
  SheetId,
  TaskId,
  ThemeId,
  TodoId,
  TopicId,
  TreeEdgeId,
} from '../domain/types';
import {
  buildTopicEnrichmentsProjection,
  resolveTopicImageDisplaySize,
} from './enrichmentProjection';

const IDS = {
  document: '018f0000-0000-7000-8000-000000000001' as DocumentId,
  sheet: '018f0000-0000-7000-8000-000000000002' as SheetId,
  missingSheet: '018f0000-0000-7000-8000-000000000003' as SheetId,
  theme: '018f0000-0000-7000-8000-000000000004' as ThemeId,
  root: '018f0000-0000-7000-8000-000000000010' as TopicId,
  childA: '018f0000-0000-7000-8000-000000000011' as TopicId,
  childB: '018f0000-0000-7000-8000-000000000012' as TopicId,
  grandchild: '018f0000-0000-7000-8000-000000000013' as TopicId,
  orphan: '018f0000-0000-7000-8000-000000000014' as TopicId,
  edgeA: '018f0000-0000-7000-8000-000000000020' as TreeEdgeId,
  edgeB: '018f0000-0000-7000-8000-000000000021' as TreeEdgeId,
  edgeGrandchild: '018f0000-0000-7000-8000-000000000022' as TreeEdgeId,
  noteA: '018f0000-0000-7000-8000-000000000031' as NoteId,
  noteB: '018f0000-0000-7000-8000-000000000032' as NoteId,
  orphanNote: '018f0000-0000-7000-8000-000000000033' as NoteId,
  linkA: '018f0000-0000-7000-8000-000000000041' as LinkId,
  linkB: '018f0000-0000-7000-8000-000000000042' as LinkId,
  asset: '018f0000-0000-7000-8000-000000000050' as AssetId,
  missingAsset: '018f0000-0000-7000-8000-000000000051' as AssetId,
  attachmentA: '018f0000-0000-7000-8000-000000000061' as AttachmentId,
  attachmentB: '018f0000-0000-7000-8000-000000000062' as AttachmentId,
  image: '018f0000-0000-7000-8000-000000000070' as ImageId,
  markerGroup: '018f0000-0000-7000-8000-000000000080' as MarkerGroupId,
  markerDefinition: '018f0000-0000-7000-8000-000000000081' as MarkerDefinitionId,
  missingMarkerDefinition: '018f0000-0000-7000-8000-000000000082' as MarkerDefinitionId,
  markerA: '018f0000-0000-7000-8000-000000000083' as MarkerInstanceId,
  markerB: '018f0000-0000-7000-8000-000000000084' as MarkerInstanceId,
  todoRoot: '018f0000-0000-7000-8000-000000000091' as TodoId,
  todoA: '018f0000-0000-7000-8000-000000000092' as TodoId,
  todoB: '018f0000-0000-7000-8000-000000000093' as TodoId,
  todoGrandchild: '018f0000-0000-7000-8000-000000000094' as TodoId,
  task: '018f0000-0000-7000-8000-0000000000a0' as TaskId,
  actor: '018f0000-0000-7000-8000-0000000000b0' as ActorId,
  missingActor: '018f0000-0000-7000-8000-0000000000b1' as ActorId,
} as const;

const richText = (text: string) => ({
  type: 'doc' as const,
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] }],
});

const createFixture = () => {
  const document = createNewMindMapDocument({
    documentId: IDS.document,
    sheetId: IDS.sheet,
    rootTopicId: IDS.root,
    themeId: IDS.theme,
    sheetOrderKey: 'a',
    rootTitle: 'Root',
  });
  const sheet = document.sheets[IDS.sheet];
  sheet.topics[IDS.root].labels = ['beta', 'alpha'];
  sheet.topics[IDS.childA] = createTopic({ id: IDS.childA, title: 'Child A' });
  sheet.topics[IDS.childB] = createTopic({ id: IDS.childB, title: 'Child B' });
  sheet.topics[IDS.grandchild] = createTopic({ id: IDS.grandchild, title: 'Grandchild' });
  sheet.treeEdges[IDS.edgeA] = {
    id: IDS.edgeA,
    parentTopicId: IDS.root,
    childTopicId: IDS.childA,
    orderKey: 'b',
    side: 'right',
  };
  sheet.treeEdges[IDS.edgeB] = {
    id: IDS.edgeB,
    parentTopicId: IDS.root,
    childTopicId: IDS.childB,
    orderKey: 'a',
    side: 'right',
  };
  sheet.treeEdges[IDS.edgeGrandchild] = {
    id: IDS.edgeGrandchild,
    parentTopicId: IDS.childA,
    childTopicId: IDS.grandchild,
    orderKey: 'a',
    side: 'right',
  };

  // Notes do not have orderKey; ID is the deterministic fallback.
  sheet.notes[IDS.noteB] = { id: IDS.noteB, topicId: IDS.root, content: richText('Second') };
  sheet.notes[IDS.noteA] = { id: IDS.noteA, topicId: IDS.root, content: richText('First') };
  sheet.notes[IDS.orphanNote] = {
    id: IDS.orphanNote,
    topicId: IDS.orphan,
    content: richText('Orphan'),
  };

  sheet.links[IDS.linkB] = {
    id: IDS.linkB,
    topicId: IDS.root,
    orderKey: 'b',
    kind: 'web',
    href: 'https://example.com/private?token=not-shown',
    status: 'active',
  };
  sheet.links[IDS.linkA] = {
    id: IDS.linkA,
    topicId: IDS.root,
    orderKey: 'a',
    kind: 'topic',
    targetSheetId: IDS.sheet,
    targetTopicId: IDS.orphan,
    status: 'active',
  };

  document.assets[IDS.asset] = {
    id: IDS.asset,
    fileName: 'roadmap.pdf',
    mimeType: 'application/pdf',
    byteSize: 42,
    sha256: '0'.repeat(64),
    source: { kind: 'managed', objectKey: 'safe-object-key' },
  };
  sheet.attachments[IDS.attachmentB] = {
    id: IDS.attachmentB,
    topicId: IDS.root,
    assetId: IDS.missingAsset,
    orderKey: 'b',
  };
  sheet.attachments[IDS.attachmentA] = {
    id: IDS.attachmentA,
    topicId: IDS.root,
    assetId: IDS.asset,
    orderKey: 'a',
  };
  sheet.images[IDS.image] = {
    id: IDS.image,
    topicId: IDS.root,
    assetId: IDS.missingAsset,
    orderKey: 'a',
    role: 'sticker',
    placement: { side: 'right', align: 'center', offset: { x: 0, y: 0 } },
    alt: 'Warning sticker',
  };

  document.markerGroups[IDS.markerGroup] = {
    id: IDS.markerGroup,
    orderKey: 'a',
    name: 'Priority',
    kind: 'builtin',
    exclusive: true,
  };
  document.markerDefinitions[IDS.markerDefinition] = {
    id: IDS.markerDefinition,
    groupId: IDS.markerGroup,
    orderKey: 'a',
    name: 'High',
    source: { kind: 'builtin', key: 'priority-high' },
    semanticValue: 1,
  };
  sheet.markerInstances[IDS.markerB] = {
    id: IDS.markerB,
    topicId: IDS.root,
    markerDefinitionId: IDS.missingMarkerDefinition,
    orderKey: 'b',
  };
  sheet.markerInstances[IDS.markerA] = {
    id: IDS.markerA,
    topicId: IDS.root,
    markerDefinitionId: IDS.markerDefinition,
    orderKey: 'a',
  };

  sheet.todos[IDS.todoRoot] = { id: IDS.todoRoot, topicId: IDS.root, completed: false };
  sheet.todos[IDS.todoA] = {
    id: IDS.todoA,
    topicId: IDS.childA,
    completed: true,
    completedAt: '2026-07-19T00:00:00.000Z',
  };
  sheet.todos[IDS.todoB] = { id: IDS.todoB, topicId: IDS.childB, completed: false };
  sheet.todos[IDS.todoGrandchild] = {
    id: IDS.todoGrandchild,
    topicId: IDS.grandchild,
    completed: true,
  };

  document.actors[IDS.actor] = {
    id: IDS.actor,
    displayName: 'Ada',
    status: 'active',
  };
  sheet.tasks[IDS.task] = {
    id: IDS.task,
    topicId: IDS.root,
    status: 'in-progress',
    progress: 0.4,
    priority: 2,
    assigneeIds: [IDS.actor, IDS.missingActor],
    displayFields: ['status', 'progress', 'assignees'],
  };
  return document;
};

describe('buildTopicEnrichmentsProjection', () => {
  it('projects every supported enrichment in stable canonical order without mutation', () => {
    const document = createFixture();
    const before = JSON.stringify(document);
    const projection = buildTopicEnrichmentsProjection({ document, sheetId: IDS.sheet });
    const root = projection.byTopicId[IDS.root];

    expect(projection.topicIds).toEqual([
      IDS.root,
      IDS.childA,
      IDS.childB,
      IDS.grandchild,
    ]);
    expect(root.markers.map((item) => item.id)).toEqual([IDS.markerA, IDS.markerB]);
    expect(root.labels.map((item) => item.value)).toEqual(['beta', 'alpha']);
    expect(root.notes.map((item) => item.id)).toEqual([IDS.noteA, IDS.noteB]);
    expect(root.links.map((item) => item.id)).toEqual([IDS.linkA, IDS.linkB]);
    expect(root.attachments.map((item) => item.id)).toEqual([
      IDS.attachmentA,
      IDS.attachmentB,
    ]);
    expect(root.badges.map((item) => item.kind)).toEqual([
      'marker',
      'marker',
      'label',
      'label',
      'note',
      'note',
      'link',
      'link',
      'image',
      'attachment',
      'attachment',
      'todo',
      'todo-progress',
      'task',
    ]);
    expect(root.tasks[0]).toMatchObject({
      status: 'in-progress',
      progress: 0.4,
      invalidProgress: false,
      assignees: [
        { displayName: 'Ada', missingActor: false },
        { displayName: 'Unknown', missingActor: true },
      ],
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('derives parent To-do progress from direct structural children only', () => {
    const projection = buildTopicEnrichmentsProjection({
      document: createFixture(),
      sheetId: IDS.sheet,
    });

    expect(projection.byTopicId[IDS.root].childTodoProgress).toEqual({
      id: `todo-progress:${IDS.root}`,
      completedCount: 1,
      totalCount: 2,
      progress: 0.5,
    });
    expect(projection.byTopicId[IDS.childA].childTodoProgress).toEqual({
      id: `todo-progress:${IDS.childA}`,
      completedCount: 1,
      totalCount: 1,
      progress: 1,
    });
    expect(projection.byTopicId[IDS.root].badges.find((badge) => badge.kind === 'todo-progress'))
      .toMatchObject({ displayText: '50%', progress: 0.5 });
  });

  it('degrades dangling resources and associations into diagnostics instead of throwing', () => {
    const document = createFixture();
    document.sheets[IDS.sheet].tasks[IDS.task].progress = Number.POSITIVE_INFINITY;
    const projection = buildTopicEnrichmentsProjection({ document, sheetId: IDS.sheet });
    const root = projection.byTopicId[IDS.root];

    expect(root.links[0]).toMatchObject({ label: '缺失主题', unresolvedTarget: true });
    expect(root.attachments[1]).toMatchObject({
      fileName: '缺失附件资源',
      missingAsset: true,
    });
    expect(root.images[0]).toMatchObject({ missingAsset: true, alt: 'Warning sticker' });
    expect(root.markers[1]).toMatchObject({
      label: '缺失标记',
      missingDefinition: true,
    });
    expect(root.tasks[0]).toMatchObject({ progress: 0, invalidProgress: true });
    expect(projection.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'orphan-entity',
      'missing-link-target',
      'missing-asset',
      'missing-marker-definition',
      'missing-actor',
    ]));
  });

  it('projects safe remote image geometry and never exposes managed or unsafe asset locators', () => {
    const document = createFixture();
    const sheet = document.sheets[IDS.sheet];
    const remoteAsset = '018f0000-0000-7000-8000-0000000000c0' as AssetId;
    const managedAsset = '018f0000-0000-7000-8000-0000000000c1' as AssetId;
    const unsafeAsset = '018f0000-0000-7000-8000-0000000000c2' as AssetId;
    const signedAsset = '018f0000-0000-7000-8000-0000000000c3' as AssetId;
    const validManagedAsset = '018f0000-0000-7000-8000-0000000000c4' as AssetId;
    const remoteImage = '018f0000-0000-7000-8000-0000000000d0' as ImageId;
    const managedImage = '018f0000-0000-7000-8000-0000000000d1' as ImageId;
    const unsafeImage = '018f0000-0000-7000-8000-0000000000d2' as ImageId;
    const signedImage = '018f0000-0000-7000-8000-0000000000d3' as ImageId;
    const validManagedImage = '018f0000-0000-7000-8000-0000000000d4' as ImageId;
    document.assets[remoteAsset] = {
      id: remoteAsset,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '1'.repeat(64),
      source: { kind: 'remote', url: 'https://cdn.example.test/diagram.png' },
      intrinsicSize: { width: 800, height: 600 },
    };
    document.assets[managedAsset] = {
      id: managedAsset,
      fileName: 'managed.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '2'.repeat(64),
      source: { kind: 'managed', objectKey: 'PRIVATE_BUCKET_OBJECT_KEY' },
      intrinsicSize: { width: 120, height: 80 },
    };
    document.assets[unsafeAsset] = {
      id: unsafeAsset,
      fileName: 'unsafe.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '3'.repeat(64),
      source: { kind: 'remote', url: 'javascript:alert(1)' },
    };
    document.assets[signedAsset] = {
      id: signedAsset,
      fileName: 'signed.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '4'.repeat(64),
      source: {
        kind: 'remote',
        url: 'https://private.example.test/signed.png?token=do-not-render',
      },
    };
    document.assets[validManagedAsset] = {
      id: validManagedAsset,
      fileName: 'durable.png',
      mimeType: 'image/png',
      byteSize: 100,
      sha256: '5'.repeat(64),
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${'5'.repeat(64)}.png`,
      },
      intrinsicSize: { width: 40, height: 30 },
    };
    sheet.images[remoteImage] = {
      id: remoteImage,
      topicId: IDS.root,
      assetId: remoteAsset,
      orderKey: 'c',
      role: 'inline',
      placement: { side: 'top', align: 'end', offset: { x: 12, y: -4 } },
      size: { width: 999, height: 12 },
      crop: { x: 1, y: 2, width: 30, height: 20 },
      alt: 'Architecture diagram',
    };
    sheet.images[managedImage] = {
      id: managedImage,
      topicId: IDS.root,
      assetId: managedAsset,
      orderKey: 'd',
      role: 'thumbnail',
      placement: { side: 'bottom', align: 'center', offset: { x: 0, y: 0 } },
    };
    sheet.images[unsafeImage] = {
      id: unsafeImage,
      topicId: IDS.root,
      assetId: unsafeAsset,
      orderKey: 'e',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    sheet.images[signedImage] = {
      id: signedImage,
      topicId: IDS.root,
      assetId: signedAsset,
      orderKey: 'f',
      role: 'inline',
      placement: { side: 'bottom', align: 'center', offset: { x: 0, y: 0 } },
    };
    sheet.images[validManagedImage] = {
      id: validManagedImage,
      topicId: IDS.root,
      assetId: validManagedAsset,
      orderKey: 'g',
      role: 'inline',
      placement: { side: 'bottom', align: 'center', offset: { x: 0, y: 0 } },
    };

    const projection = buildTopicEnrichmentsProjection({ document, sheetId: IDS.sheet });
    const images = projection.byTopicId[IDS.root].images;

    expect(images.find((image) => image.id === remoteImage)).toMatchObject({
      placement: { side: 'top', align: 'end', offset: { x: 12, y: -4 } },
      size: { width: 999, height: 12 },
      intrinsicSize: { width: 800, height: 600 },
      displaySize: { width: 1_998, height: 24 },
      displaySizeSource: 'explicit',
      crop: { x: 1, y: 2, width: 30, height: 20 },
      alt: 'Architecture diagram',
      rendererSource: {
        status: 'ready',
        url: 'https://cdn.example.test/diagram.png',
      },
    });
    expect(images.find((image) => image.id === managedImage)).toMatchObject({
      displaySize: { width: 120, height: 80 },
      displaySizeSource: 'intrinsic',
      rendererSource: { status: 'unavailable', reason: 'managed-source' },
    });
    expect(images.find((image) => image.id === unsafeImage)).toMatchObject({
      displaySize: { width: 160, height: 90 },
      displaySizeSource: 'fallback',
      rendererSource: { status: 'unavailable', reason: 'unsafe-remote-url' },
    });
    expect(images.find((image) => image.id === signedImage)).toMatchObject({
      rendererSource: { status: 'unavailable', reason: 'unsafe-remote-url' },
    });
    expect(images.find((image) => image.id === validManagedImage)).toMatchObject({
      rendererSource: {
        status: 'ready',
        url: `/api/mindmap/image-assets/${'5'.repeat(64)}.png`,
      },
    });
    expect(JSON.stringify(images)).not.toContain('PRIVATE_BUCKET_OBJECT_KEY');
    expect(JSON.stringify(images)).not.toContain('do-not-render');
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unsafe-image-source',
      entityId: unsafeImage,
    }));
  });

  it('preserves representable aspect ratios and safely caps extreme images', () => {
    expect(resolveTopicImageDisplaySize(
      { width: 4_000, height: 2_000 },
      undefined,
    )).toEqual({
      source: 'explicit',
      size: { width: 2_048, height: 1_024 },
    });
    expect(resolveTopicImageDisplaySize(
      { width: 1_000_000, height: 1 },
      undefined,
    )).toEqual({
      source: 'explicit',
      size: { width: 2_048, height: 1 },
    });
    expect(resolveTopicImageDisplaySize(undefined, undefined)).toEqual({
      source: 'fallback',
      size: { width: 160, height: 90 },
    });
  });

  it('returns an empty safe projection when the requested sheet is absent', () => {
    const projection = buildTopicEnrichmentsProjection({
      document: createFixture(),
      sheetId: IDS.missingSheet,
    });

    expect(projection.topicIds).toEqual([]);
    expect(projection.byTopicId).toEqual({});
    expect(projection.diagnostics).toEqual([{
      code: 'missing-sheet',
      entityKind: 'sheet',
      entityId: IDS.missingSheet,
    }]);
  });
});
