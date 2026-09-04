import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

import { allNodes, readEditorJson, type EditorJsonNode } from './editorTestUtils';

const mindMapV2 = (page: Page) => page.locator(
  '[data-mindmap-version="2"]:visible, [data-testid="mindmap-v2-fullscreen-layer"]:visible',
).last();
const canvas = (page: Page) => page.getByTestId('mindmap-v2-canvas');
const topics = (page: Page) => mindMapV2(page).locator('[data-topic-role]');
const topicButton = (page: Page, title: string) =>
  topics(page).getByRole('button', { name: title, exact: true });
const topicNode = (page: Page, title: string) =>
  mindMapV2(page).locator('.react-flow__node').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  });
const topicDragHandle = (page: Page, title: string) =>
  topicNode(page, title).locator('.mindmap-topic-drag-handle');
const topicButtonById = (page: Page, topicId: string) =>
  mindMapV2(page)
    .locator(`[data-entity-id="${topicId}"][data-topic-role]`)
    .getByRole('button')
    .first();
const topicCard = (page: Page, title: string) =>
  topicNode(page, title).locator('[data-testid^="mindmap-topic-card-"]');

const enterMindMapWorkspace = async (page: Page) => {
  if (await page.getByTestId('mindmap-v2-fullscreen-layer').count()) return;
  await page.getByTestId('mindmap-v2-enter-fullscreen').click();
  await expect(page.getByTestId('mindmap-v2-fullscreen-layer')).toBeVisible();
};

const exitMindMapWorkspace = async (page: Page) => {
  if (!await page.getByTestId('mindmap-v2-fullscreen-layer').count()) return;
  await page.getByTestId('mindmap-v2-exit-fullscreen').click();
  await expect(page.getByTestId('mindmap-v2-fullscreen-layer')).toHaveCount(0);
};

const mindMapNode = (document: EditorJsonNode): EditorJsonNode => {
  const node = allNodes(document).find(candidate => candidate.type === 'mindMap');
  if (!node) throw new Error('The editor JSON does not contain a mindMap node.');
  return node;
};

const mindMapData = async (page: Page): Promise<unknown> => {
  const document = await readEditorJson(page);
  return mindMapNode(document).attrs?.data;
};

const canonicalData = async (page: Page): Promise<Record<string, unknown> | null> => {
  const raw = await mindMapData(page);
  if (typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const topicCountInCanonicalData = (document: Record<string, unknown>): number => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return 0;

  return Object.values(sheets).reduce((total, sheet) => {
    if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return total;
    const topicMap = (sheet as Record<string, unknown>).topics;
    if (topicMap === null || typeof topicMap !== 'object' || Array.isArray(topicMap)) return total;
    return total + Object.keys(topicMap).length;
  }, 0);
};

const topicIdsInCanonicalData = (document: Record<string, unknown>): string[] => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return [];
  return Object.values(sheets).flatMap((sheet) => {
    if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return [];
    const topicMap = (sheet as Record<string, unknown>).topics;
    return topicMap !== null && typeof topicMap === 'object' && !Array.isArray(topicMap)
      ? Object.keys(topicMap)
      : [];
  });
};

const topicFillColorCount = (
  document: Record<string, unknown>,
  color: string,
): number => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return 0;
  return Object.values(sheets).reduce((total, sheet) => {
    if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return total;
    const topicMap = (sheet as Record<string, unknown>).topics;
    if (topicMap === null || typeof topicMap !== 'object' || Array.isArray(topicMap)) return total;
    return total + Object.values(topicMap as Record<string, unknown>).filter((topic) => {
      if (topic === null || typeof topic !== 'object' || Array.isArray(topic)) return false;
      const style = (topic as Record<string, unknown>).style;
      if (style === null || typeof style !== 'object' || Array.isArray(style)) return false;
      const overrides = (style as Record<string, unknown>).overrides;
      if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return false;
      const fill = (overrides as Record<string, unknown>).fill;
      if (fill === null || typeof fill !== 'object' || Array.isArray(fill)) return false;
      const value = (fill as Record<string, unknown>).color;
      return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).kind === 'literal'
        && (value as Record<string, unknown>).value === color;
    }).length;
  }, 0);
};

const canonicalFixtureBranch = (document: unknown): {
  initialTopicIds: readonly string[];
  rootTopicId: string;
  sourceTopicId: string;
  subtreeTopicCount: number;
} => {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Expected a canonical mind-map object fixture.');
  }
  const sheets = (document as Record<string, unknown>).sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) {
    throw new Error('Canonical fixture has no sheets.');
  }
  const sheet = Object.values(sheets)[0];
  if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) {
    throw new Error('Canonical fixture has no first sheet.');
  }
  const record = sheet as Record<string, unknown>;
  const rootTopicId = record.rootTopicId;
  const topicsValue = record.topics;
  const edgesValue = record.treeEdges;
  if (
    typeof rootTopicId !== 'string'
    || topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || edgesValue === null || typeof edgesValue !== 'object' || Array.isArray(edgesValue)
  ) {
    throw new Error('Canonical fixture has an invalid tree.');
  }
  const edges = Object.values(edgesValue as Record<string, unknown>)
    .filter((edge): edge is Record<string, unknown> =>
      edge !== null && typeof edge === 'object' && !Array.isArray(edge));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (typeof edge.parentTopicId !== 'string' || typeof edge.childTopicId !== 'string') continue;
    const siblings = children.get(edge.parentTopicId) ?? [];
    siblings.push(edge.childTopicId);
    children.set(edge.parentTopicId, siblings);
  }
  const sourceTopicId = (children.get(rootTopicId) ?? [])
    .find((topicId) => (children.get(topicId)?.length ?? 0) > 0);
  if (!sourceTopicId) throw new Error('Canonical fixture has no branch with descendants.');
  const subtree = new Set<string>();
  const pending = [sourceTopicId];
  while (pending.length > 0) {
    const topicId = pending.pop();
    if (!topicId || subtree.has(topicId)) continue;
    subtree.add(topicId);
    pending.push(...(children.get(topicId) ?? []));
  }
  return {
    initialTopicIds: Object.keys(topicsValue as Record<string, unknown>),
    rootTopicId,
    sourceTopicId,
    subtreeTopicCount: subtree.size,
  };
};

const sheetCountInCanonicalData = (document: Record<string, unknown>): number => {
  const sheets = document.sheets;
  return sheets !== null && typeof sheets === 'object' && !Array.isArray(sheets)
    ? Object.keys(sheets).length
    : 0;
};

const firstSheetLayoutInCanonicalData = (
  document: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return undefined;
  const sheet = Object.values(sheets)[0];
  if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return undefined;
  const layout = (sheet as Record<string, unknown>).defaultBranchLayout;
  return layout !== null && typeof layout === 'object' && !Array.isArray(layout)
    ? layout as Record<string, unknown>
    : undefined;
};

const richTextTitle = (value: unknown): string => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  const blocks = (value as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks.flatMap(block => {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) return [];
    const children = (block as Record<string, unknown>).children;
    return Array.isArray(children) ? children : [];
  }).map(child => {
    if (child === null || typeof child !== 'object' || Array.isArray(child)) return '';
    const inline = child as Record<string, unknown>;
    return inline.type === 'hardBreak' ? '\n' : String(inline.text ?? '');
  }).join('');
};

const firstCanonicalSheet = (
  document: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return undefined;
  const sheet = Object.values(sheets)[0];
  return sheet !== null && typeof sheet === 'object' && !Array.isArray(sheet)
    ? sheet as Record<string, unknown>
    : undefined;
};

const canonicalTopicByTitle = (
  document: Record<string, unknown>,
  title: string,
): readonly [string, Record<string, unknown>] | undefined => {
  const topicsValue = firstCanonicalSheet(document)?.topics;
  if (topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)) {
    return undefined;
  }
  const match = Object.entries(topicsValue as Record<string, unknown>).find(([, topic]) =>
    topic !== null && typeof topic === 'object' && !Array.isArray(topic)
    && richTextTitle((topic as Record<string, unknown>).title) === title);
  return match && match[1] !== null && typeof match[1] === 'object' && !Array.isArray(match[1])
    ? [match[0], match[1] as Record<string, unknown>]
    : undefined;
};

const canonicalTodosByTopicTitle = (
  document: Record<string, unknown>,
): Record<string, { id: string; completed: boolean; completedAt?: string }> => {
  const sheet = firstCanonicalSheet(document);
  const topicsValue = sheet?.topics;
  const todosValue = sheet?.todos;
  if (
    topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || todosValue === null || typeof todosValue !== 'object' || Array.isArray(todosValue)
  ) return {};
  const titles = new Map(Object.entries(topicsValue as Record<string, unknown>).flatMap(([id, topic]) => {
    if (topic === null || typeof topic !== 'object' || Array.isArray(topic)) return [];
    return [[id, richTextTitle((topic as Record<string, unknown>).title)] as const];
  }));
  return Object.entries(todosValue as Record<string, unknown>).reduce<
    Record<string, { id: string; completed: boolean; completedAt?: string }>
  >((result, [id, todo]) => {
    if (todo === null || typeof todo !== 'object' || Array.isArray(todo)) return result;
    const record = todo as Record<string, unknown>;
    if (typeof record.topicId !== 'string' || typeof record.completed !== 'boolean') return result;
    const title = titles.get(record.topicId);
    if (!title) return result;
    result[title] = {
      id,
      completed: record.completed,
      ...(typeof record.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
    };
    return result;
  }, {});
};

const canonicalTasksByTopicTitle = (
  document: Record<string, unknown>,
): Record<string, Record<string, unknown> & { id: string }> => {
  const sheet = firstCanonicalSheet(document);
  const topicsValue = sheet?.topics;
  const tasksValue = sheet?.tasks;
  if (
    topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || tasksValue === null || typeof tasksValue !== 'object' || Array.isArray(tasksValue)
  ) return {};
  const titles = new Map(Object.entries(topicsValue as Record<string, unknown>).flatMap(([id, topic]) => {
    if (topic === null || typeof topic !== 'object' || Array.isArray(topic)) return [];
    return [[id, richTextTitle((topic as Record<string, unknown>).title)] as const];
  }));
  return Object.entries(tasksValue as Record<string, unknown>).reduce<
    Record<string, Record<string, unknown> & { id: string }>
  >((result, [id, task]) => {
    if (task === null || typeof task !== 'object' || Array.isArray(task)) return result;
    const record = task as Record<string, unknown>;
    if (typeof record.topicId !== 'string') return result;
    const title = titles.get(record.topicId);
    if (!title) return result;
    result[title] = { id, ...record };
    return result;
  }, {});
};

const canonicalTaskDependencies = (
  document: Record<string, unknown>,
): Array<Record<string, unknown> & { id: string }> => {
  const dependenciesValue = firstCanonicalSheet(document)?.taskDependencies;
  if (
    dependenciesValue === null
    || typeof dependenciesValue !== 'object'
    || Array.isArray(dependenciesValue)
  ) return [];
  return Object.entries(dependenciesValue as Record<string, unknown>).flatMap(([id, dependency]) => (
    dependency !== null && typeof dependency === 'object' && !Array.isArray(dependency)
      ? [{ id, ...(dependency as Record<string, unknown>) }]
      : []
  ));
};

const canonicalMarkerState = (
  document: Record<string, unknown>,
  topicTitle: string,
): {
  definitions: Array<Record<string, unknown> & { id: string }>;
  groups: Array<Record<string, unknown> & { id: string }>;
  instances: Array<Record<string, unknown> & { id: string }>;
  legend?: Record<string, unknown>;
} => {
  const sheet = firstCanonicalSheet(document);
  const topicId = canonicalTopicByTitle(document, topicTitle)?.[0];
  const toEntries = (value: unknown): Array<Record<string, unknown> & { id: string }> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).flatMap(([id, entity]) => (
        entity !== null && typeof entity === 'object' && !Array.isArray(entity)
          ? [{ id, ...(entity as Record<string, unknown>) }]
          : []
      ))
      : []
  );
  const byOrderKey = (
    left: Record<string, unknown> & { id: string },
    right: Record<string, unknown> & { id: string },
  ): number => {
    const leftKey = String(left.orderKey);
    const rightKey = String(right.orderKey);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };
  const groups = toEntries(document.markerGroups).sort(byOrderKey);
  const definitions = toEntries(document.markerDefinitions).sort((left, right) =>
    String(left.groupId).localeCompare(String(right.groupId), 'en-US') || byOrderKey(left, right));
  const instances = toEntries(sheet?.markerInstances)
    .filter((instance) => instance.topicId === topicId)
    .sort(byOrderKey);
  const legendValue = sheet?.markerLegend;
  return {
    definitions,
    groups,
    instances,
    ...(legendValue !== null && typeof legendValue === 'object' && !Array.isArray(legendValue)
      ? { legend: legendValue as Record<string, unknown> }
      : {}),
  };
};

const canonicalBoundaries = (
  document: Record<string, unknown>,
): Array<Record<string, unknown> & { id: string; title: string }> => {
  const boundariesValue = firstCanonicalSheet(document)?.boundaries;
  if (
    boundariesValue === null
    || typeof boundariesValue !== 'object'
    || Array.isArray(boundariesValue)
  ) return [];
  return Object.entries(boundariesValue as Record<string, unknown>).flatMap(([id, boundary]) => (
    boundary !== null && typeof boundary === 'object' && !Array.isArray(boundary)
      ? [{
          id,
          ...(boundary as Record<string, unknown>),
          title: richTextTitle((boundary as Record<string, unknown>).title),
        }]
      : []
  )).sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
};

const canonicalSummaries = (
  document: Record<string, unknown>,
): Array<Record<string, unknown> & { id: string }> => {
  const summariesValue = firstCanonicalSheet(document)?.summaries;
  if (
    summariesValue === null
    || typeof summariesValue !== 'object'
    || Array.isArray(summariesValue)
  ) return [];
  return Object.entries(summariesValue as Record<string, unknown>).flatMap(([id, summary]) => (
    summary !== null && typeof summary === 'object' && !Array.isArray(summary)
      ? [{ id, ...(summary as Record<string, unknown>) }]
      : []
  )).sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
};

const canonicalIncomingEdgeByTitle = (
  document: Record<string, unknown>,
  title: string,
): readonly [string, Record<string, unknown>] | undefined => {
  const topicId = canonicalTopicByTitle(document, title)?.[0];
  const edgesValue = firstCanonicalSheet(document)?.treeEdges;
  if (
    !topicId
    || edgesValue === null
    || typeof edgesValue !== 'object'
    || Array.isArray(edgesValue)
  ) return undefined;
  const match = Object.entries(edgesValue as Record<string, unknown>).find(([, edge]) =>
    edge !== null && typeof edge === 'object' && !Array.isArray(edge)
    && (edge as Record<string, unknown>).childTopicId === topicId);
  return match && match[1] !== null && typeof match[1] === 'object' && !Array.isArray(match[1])
    ? [match[0], match[1] as Record<string, unknown>]
    : undefined;
};

const canonicalLinksForTopicTitle = (
  document: Record<string, unknown>,
  sheetTitle: string,
  topicTitle: string,
): Array<Record<string, unknown> & { id: string }> => {
  const sheetsValue = document.sheets;
  if (sheetsValue === null || typeof sheetsValue !== 'object' || Array.isArray(sheetsValue)) return [];
  const sheet = Object.values(sheetsValue as Record<string, unknown>).find((candidate) =>
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).title === sheetTitle);
  if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return [];
  const sheetRecord = sheet as Record<string, unknown>;
  const topicsValue = sheetRecord.topics;
  const linksValue = sheetRecord.links;
  if (
    topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || linksValue === null || typeof linksValue !== 'object' || Array.isArray(linksValue)
  ) return [];
  const topicId = Object.entries(topicsValue as Record<string, unknown>).find(([, topic]) =>
    topic !== null && typeof topic === 'object' && !Array.isArray(topic)
    && richTextTitle((topic as Record<string, unknown>).title) === topicTitle)?.[0];
  if (!topicId) return [];
  return Object.entries(linksValue as Record<string, unknown>).flatMap(([id, link]) => {
    if (
      link === null || typeof link !== 'object' || Array.isArray(link)
      || (link as Record<string, unknown>).topicId !== topicId
    ) return [];
    return [{ id, ...(link as Record<string, unknown>) }];
  });
};

const parentTitleInCanonicalData = (
  document: Record<string, unknown>,
  childTitle: string,
): string | undefined => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return undefined;
  const sheet = Object.values(sheets)[0];
  if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return undefined;
  const record = sheet as Record<string, unknown>;
  const topicsValue = record.topics;
  const edgesValue = record.treeEdges;
  if (
    topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || edgesValue === null || typeof edgesValue !== 'object' || Array.isArray(edgesValue)
  ) return undefined;
  const topicEntries = Object.entries(topicsValue as Record<string, unknown>);
  const childId = topicEntries.find(([, topic]) =>
    topic !== null && typeof topic === 'object' && !Array.isArray(topic)
    && richTextTitle((topic as Record<string, unknown>).title) === childTitle)?.[0];
  if (!childId) return undefined;
  const edge = Object.values(edgesValue as Record<string, unknown>).find(candidate =>
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).childTopicId === childId);
  const parentId = edge !== null && typeof edge === 'object' && !Array.isArray(edge)
    ? (edge as Record<string, unknown>).parentTopicId
    : undefined;
  const parent = typeof parentId === 'string'
    ? (topicsValue as Record<string, unknown>)[parentId]
    : undefined;
  return parent !== null && typeof parent === 'object' && !Array.isArray(parent)
    ? richTextTitle((parent as Record<string, unknown>).title)
    : undefined;
};

const childTitlesInCanonicalData = (
  document: Record<string, unknown>,
  parentTitle: string,
): string[] => {
  const sheets = document.sheets;
  if (sheets === null || typeof sheets !== 'object' || Array.isArray(sheets)) return [];
  const sheet = Object.values(sheets)[0];
  if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return [];
  const topicsValue = (sheet as Record<string, unknown>).topics;
  const edgesValue = (sheet as Record<string, unknown>).treeEdges;
  if (
    topicsValue === null || typeof topicsValue !== 'object' || Array.isArray(topicsValue)
    || edgesValue === null || typeof edgesValue !== 'object' || Array.isArray(edgesValue)
  ) return [];
  const topicsRecord = topicsValue as Record<string, unknown>;
  const parentId = Object.entries(topicsRecord).find(([, topic]) =>
    topic !== null && typeof topic === 'object' && !Array.isArray(topic)
    && richTextTitle((topic as Record<string, unknown>).title) === parentTitle)?.[0];
  if (!parentId) return [];
  return Object.values(edgesValue as Record<string, unknown>)
    .filter((edge): edge is Record<string, unknown> =>
      edge !== null && typeof edge === 'object' && !Array.isArray(edge)
      && (edge as Record<string, unknown>).parentTopicId === parentId)
    .sort((left, right) => String(left.orderKey).localeCompare(String(right.orderKey))
      || String(left.id).localeCompare(String(right.id)))
    .map((edge) => topicsRecord[String(edge.childTopicId)])
    .filter((topic): topic is Record<string, unknown> =>
      topic !== null && typeof topic === 'object' && !Array.isArray(topic))
    .map((topic) => richTextTitle(topic.title));
};

const selectFirstTopic = async (page: Page) => {
  const firstTopicButton = topics(page).first().getByRole('button').first();
  await expect(firstTopicButton).toBeVisible();
  await firstTopicButton.click();
  await canvas(page).focus();
};

const addChildAndCommitTitle = async (page: Page, title: string) => {
  await selectFirstTopic(page);
  await page.keyboard.press('Tab');

  const titleEditor = page.getByLabel('编辑主题标题');
  await expect(titleEditor).toBeVisible();
  await titleEditor.fill(title);
  await titleEditor.press('Enter');
  await expect(topicButton(page, title)).toBeVisible();
};

test.describe('Mind map V2 compatibility and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/session', async route => {
      await route.fulfill({
        body: JSON.stringify({ authenticated: true }),
        contentType: 'application/json',
        status: 200,
      });
    });
  });

  test('embedded preview expands into a true viewport fullscreen layer and restores its place', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/editor-lab?fixture=mindmap-v1-small');

    const preview = page.getByTestId('mindmap-v2-embedded-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-mindmap-presentation', 'embedded');
    await expect(topicButton(page, '创业模拟器')).toBeVisible();

    await expect.poll(async () => {
      const [previewBounds, readingTrackBounds] = await Promise.all([
        preview.boundingBox(),
        page.locator('.smart-document-content-rail').boundingBox(),
      ]);
      if (!previewBounds || !readingTrackBounds) return false;

      return Math.abs(previewBounds.width - readingTrackBounds.width) <= 2
        && Math.abs(previewBounds.x - readingTrackBounds.x) <= 2
        && previewBounds.height >= 439
        && previewBounds.height <= 561
        && previewBounds.height / 800 <= 0.6
        && previewBounds.width / previewBounds.height >= 1.25;
    }).toBe(true);

    await expect(page.getByTestId('mindmap-format-panel')).toHaveCount(0);
    await expect(page.getByTestId('mindmap-semantic-panel')).toHaveCount(0);
    await expect(page.getByTestId('mindmap-semantic-properties')).toHaveCount(0);
    await expect(page.getByTestId('mindmap-search-outliner-panel')).toHaveCount(0);
    await expect(page.getByTestId('mindmap-canvas-navigation')).toHaveCount(0);

    for (const viewport of [
      { width: 1024, height: 625 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const [topicBounds, flowBounds, addChildBounds, enterBounds, topbarBounds] = await Promise.all([
          topicButton(page, '创业模拟器').boundingBox(),
          page.getByTestId('mindmap-v2-flow-viewport').boundingBox(),
          page.getByTitle('新增子主题 (Tab)').boundingBox(),
          page.getByTestId('mindmap-v2-enter-fullscreen').boundingBox(),
          page.getByTestId('mindmap-v2-embedded-topbar').boundingBox(),
        ]);
        if (!topicBounds || !flowBounds || !addChildBounds || !enterBounds || !topbarBounds) {
          return false;
        }
        const inside = (
          inner: typeof topicBounds,
          outer: typeof flowBounds,
        ) => inner.x >= outer.x
          && inner.y >= outer.y
          && inner.x + inner.width <= outer.x + outer.width
          && inner.y + inner.height <= outer.y + outer.height;
        return inside(topicBounds, flowBounds)
          && inside(addChildBounds, topbarBounds)
          && inside(enterBounds, topbarBounds);
      }).toBe(true);
    }

    await page.getByTestId('mindmap-v2-enter-fullscreen').click();
    const fullscreen = page.getByTestId('mindmap-v2-fullscreen-layer');
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen).toHaveAttribute('role', 'dialog');
    await expect(page.getByTestId('mindmap-v2-fullscreen-placeholder')).toBeVisible();
    await expect.poll(() => fullscreen.evaluate((element) => ({
      directBodyChild: element.parentElement === document.body,
      rect: (() => {
        const bounds = element.getBoundingClientRect();
        return {
          left: Math.round(bounds.left),
          top: Math.round(bounds.top),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      })(),
    }))).toEqual({
      directBodyChild: true,
      rect: { left: 0, top: 0, width: 1280, height: 800 },
    });
    await expect(page.locator('body')).toHaveAttribute('data-mindmap-fullscreen-open', 'true');
    await expect(fullscreen.getByRole('button', { name: '创业模拟器', exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(fullscreen).toHaveCount(0);
    await expect(page.getByTestId('mindmap-v2-fullscreen-placeholder')).toHaveCount(0);
    await expect(preview).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-mindmap-fullscreen-open');
    await expect(page.getByTestId('mindmap-v2-enter-fullscreen')).toBeFocused();
  });

  test('canonical fixture supports keyboard editing, history, deletion, and V1 persistence', async ({ page }) => {
    const title = 'E2E canonical child';

    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await expect(mindMapV2(page)).toBeVisible();
    await expect(canvas(page)).toBeVisible();
    await expect(topics(page)).toHaveCount(10);

    await addChildAndCommitTitle(page, title);
    await expect(topics(page)).toHaveCount(11);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, title)).toHaveCount(0);
    await expect(topics(page)).toHaveCount(11);

    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(10);

    await page.keyboard.press('Control+y');
    await expect(topics(page)).toHaveCount(11);
    await page.keyboard.press('Control+y');
    const restoredTopic = topicButton(page, title);
    await expect(restoredTopic).toBeVisible();

    await restoredTopic.click();
    await canvas(page).focus();
    await page.keyboard.press('Delete');
    await expect(topics(page)).toHaveCount(10);
    await expect(restoredTopic).toHaveCount(0);
    await expect.poll(async () => {
      const data = await canonicalData(page);
      return data ? topicCountInCanonicalData(data) : null;
    }).toBe(10);

    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(11);
    await expect(topicButton(page, title)).toBeVisible();

    await expect.poll(async () => canonicalData(page)).toMatchObject({
      schema: 'app.nmdd.mindmap',
      schemaVersion: 1,
    });
    await expect.poll(async () => {
      const data = await canonicalData(page);
      return data ? topicCountInCanonicalData(data) : null;
    }).toBe(11);
    const persisted = await canonicalData(page);
    expect(persisted).not.toBeNull();
    expect(topicCountInCanonicalData(persisted!)).toBe(11);
  });

  test('legacy object remains untouched on open and migrates to a canonical string on first edit', async ({ page }) => {
    const title = 'E2E migrated child';

    await page.goto('/editor-lab?fixture=mindmap-v0');
    await expect(mindMapV2(page)).toBeVisible();
    const initialTopicCount = await topics(page).count();
    expect(initialTopicCount).toBeGreaterThan(0);

    const initialData = await mindMapData(page);
    expect(initialData).not.toBeNull();
    expect(typeof initialData).toBe('object');
    expect(initialData).toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
    });

    await addChildAndCommitTitle(page, title);
    await expect(topics(page)).toHaveCount(initialTopicCount + 1);

    await expect.poll(async () => canonicalData(page)).toMatchObject({
      schema: 'app.nmdd.mindmap',
      schemaVersion: 1,
    });
    const persisted = await canonicalData(page);
    expect(persisted).not.toBeNull();
    expect(persisted).not.toHaveProperty('nodes');
    expect(persisted).not.toHaveProperty('edges');
    expect(topicCountInCanonicalData(persisted!)).toBe(initialTopicCount + 1);
  });

  test('topic title editing supports CJK, emoji, and Shift+Enter line breaks', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').dblclick();
    const titleEditor = page.getByLabel('编辑主题标题');
    await expect(titleEditor).toBeVisible();
    await titleEditor.fill('中文输入 😀');
    await titleEditor.press('Shift+Enter');
    await expect(titleEditor).toBeVisible();
    await titleEditor.pressSequentially('第二行');
    await expect(titleEditor).toHaveText('中文输入 😀第二行');
    await expect(titleEditor.locator('br')).toHaveCount(1);
    await titleEditor.press('Enter');
    await expect(titleEditor).toHaveCount(0);
    await expect(topicButton(page, '中文输入 😀 第二行')).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return '';
      const sheets = persisted.sheets as Record<string, Record<string, unknown>>;
      const sheet = Object.values(sheets)[0];
      const topicMap = sheet.topics as Record<string, Record<string, unknown>>;
      return Object.values(topicMap)
        .map((topic) => richTextTitle(topic.title))
        .find((title) => title.startsWith('中文输入')) ?? '';
    }).toBe('中文输入 😀\n第二行');
  });

  test('root title editor keeps the original node visible and opens outside the card', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    const rootButton = topicButton(page, '创业模拟器');
    const rootNode = topicNode(page, '创业模拟器');
    await rootButton.dblclick();

    const editor = page.getByLabel('编辑主题标题');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('创业模拟器');
    await expect(rootButton).toBeVisible();
    const [editorBounds, nodeBounds, color] = await Promise.all([
      editor.boundingBox(),
      rootNode.boundingBox(),
      editor.evaluate((element) => getComputedStyle(element).color),
    ]);
    expect(editorBounds).not.toBeNull();
    expect(nodeBounds).not.toBeNull();
    expect(
      editorBounds!.y + editorBounds!.height <= nodeBounds!.y
      || editorBounds!.y >= nodeBounds!.y + nodeBounds!.height,
    ).toBe(true);
    expect(color).not.toBe('rgb(255, 255, 255)');
  });

  test('persists local rich-text marks and restores them through undo and redo', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 2').dblclick();
    const titleEditor = page.getByLabel('编辑主题标题');
    await titleEditor.fill('富文本标题');
    await titleEditor.press('Control+a');
    const topicTextToolbar = page.getByRole('toolbar', { name: '主题文本格式' });
    await topicTextToolbar.getByRole('button', { name: '粗体', exact: true }).click();
    await topicTextToolbar
      .getByRole('button', { name: '文字颜色 #DC2626', exact: true })
      .click();
    await titleEditor.press('Enter');

    const richTopic = topicButton(page, '富文本标题');
    await expect(richTopic).toBeVisible();
    await expect(richTopic.locator('strong')).toHaveText('富文本标题');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return [];
      const sheets = persisted.sheets as Record<string, Record<string, unknown>>;
      const sheet = Object.values(sheets)[0];
      const topicMap = sheet.topics as Record<string, Record<string, unknown>>;
      const topic = Object.values(topicMap).find((candidate) =>
        richTextTitle(candidate.title) === '富文本标题');
      const title = topic?.title as Record<string, unknown> | undefined;
      const blocks = title?.blocks as Array<Record<string, unknown>> | undefined;
      const children = blocks?.[0]?.children as Array<Record<string, unknown>> | undefined;
      const marks = children?.[0]?.marks as Array<Record<string, unknown>> | undefined;
      return marks?.map((mark) => mark.type === 'color'
        ? `${String(mark.type)}:${String(mark.value)}`
        : String(mark.type)) ?? [];
    }).toEqual(['bold', 'color:#DC2626']);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, '主主题 2')).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(topicButton(page, '富文本标题').locator('strong')).toHaveText('富文本标题');
  });

  test('topic context menu preserves selection and inserts exact previous siblings', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await topicButton(page, '主主题 2').click({ modifiers: ['Control'] });
    await topicButton(page, '主主题 1').click({ button: 'right' });
    const menu = page.getByTestId('mindmap-context-menu');
    await expect(menu).toBeVisible();
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: '复制 2 个元素' })).toBeEnabled();
    await page.keyboard.press('Escape');

    await topicButton(page, '主主题 2').click({ button: 'right' });
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(2);
    // It was already part of the multi-selection, so right click keeps both.
    await page.getByRole('menuitem', { name: '前置同级主题' }).click({ force: true });
    // Single-target-only commands are disabled for a preserved multi-selection.
    await expect(page.getByLabel('编辑主题标题')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await topicButton(page, '主主题 3').click({ button: 'right' });
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(1);
    await page.getByRole('menuitem', { name: '前置同级主题' }).click();
    const titleEditor = page.getByLabel('编辑主题标题');
    await titleEditor.fill('精确前置主题');
    await titleEditor.press('Enter');
    await expect(topicButton(page, '精确前置主题')).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? childTitlesInCanonicalData(persisted, '创业模拟器') : [];
    }).toEqual(['主主题 1', '主主题 2', '精确前置主题', '主主题 3']);
  });

  test('inserts a parent and deletes only the current topic as atomic structural edits', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');

    await topicButton(page, '分支 1.1').click({ button: 'right' });
    await page.getByTestId('mindmap-context-menu')
      .locator('[data-action="insert-parent-topic"]')
      .click();
    const titleEditor = page.getByLabel('编辑主题标题');
    await expect(titleEditor).toBeVisible();
    await titleEditor.press('Escape');
    await expect(topicButton(page, '新主题')).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.1') : undefined;
    }).toBe('新主题');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, '新主题')).toHaveCount(0);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.1') : undefined;
    }).toBe('主主题 1');

    await topicButton(page, '主主题 1').click({ button: 'right' });
    await page.getByTestId('mindmap-context-menu')
      .locator('[data-action="delete-current-topic"]')
      .click();
    await expect(topicButton(page, '主主题 1')).toHaveCount(0);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? [
        parentTitleInCanonicalData(persisted, '分支 1.1'),
        parentTitleInCanonicalData(persisted, '分支 1.2'),
      ] : [];
    }).toEqual(['创业模拟器', '创业模拟器']);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, '主主题 1')).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.1') : undefined;
    }).toBe('主主题 1');
  });

  test('edits relationship content, routing, line style, and arrows through undoable properties', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await topicButton(page, '主主题 2').click({ modifiers: ['Control'] });
    await topicButton(page, '主主题 1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '创建关系线' }).click();
    await enterMindMapWorkspace(page);

    const properties = page.getByTestId('mindmap-semantic-properties');
    await expect(properties).toBeVisible();
    await properties.getByRole('button', { name: '编辑关系标题' }).click();
    const relationshipTitle = properties.getByLabel('编辑关系标题');
    await relationshipTitle.fill('协作关系');
    await relationshipTitle.press('Enter');
    await properties.getByLabel('关系路径').selectOption('orthogonal');
    await properties.getByLabel('关系线型').selectOption('dashed');
    await properties.getByLabel('关系终点箭头').selectOption('open-diamond');

    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return null;
      const sheets = persisted.sheets as Record<string, Record<string, unknown>>;
      const sheet = Object.values(sheets)[0];
      const relationships = sheet.relationships as Record<string, Record<string, unknown>>;
      const relationship = Object.values(relationships)[0];
      const style = relationship?.style as Record<string, unknown> | undefined;
      const overrides = style?.overrides as Record<string, unknown> | undefined;
      const connector = overrides?.connector as Record<string, unknown> | undefined;
      return relationship ? {
        title: richTextTitle(relationship.title),
        routing: relationship.routing,
        endArrow: relationship.endArrow,
        dash: connector?.dash,
      } : null;
    }).toEqual({
      title: '协作关系',
      routing: 'orthogonal',
      endArrow: 'open-diamond',
      dash: [6, 4],
    });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const sheets = persisted.sheets as Record<string, Record<string, unknown>>;
      const relationships = Object.values(sheets)[0]
        .relationships as Record<string, Record<string, unknown>>;
      return Object.values(relationships)[0]?.endArrow;
    }).toBe('triangle');
    await page.keyboard.press('Control+y');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const sheets = persisted.sheets as Record<string, Record<string, unknown>>;
      const relationships = Object.values(sheets)[0]
        .relationships as Record<string, Record<string, unknown>>;
      return Object.values(relationships)[0]?.endArrow;
    }).toBe('open-diamond');
  });

  test('Boundary keeps XMind range semantics, styling, split history, drag handles, and read-only state', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    const createBoundary = page.getByTestId('mindmap-create-boundary');

    await topicButton(page, '创业模拟器').click();
    await expect(createBoundary).toBeDisabled();
    await expect(page.getByTestId('mindmap-boundary-preview'))
      .toHaveText('中心主题不能加入边界范围。');

    await topicButton(page, '分支 1.1').click();
    await expect(createBoundary).toBeEnabled();
    await createBoundary.click();

    let boundaryId: string | undefined;
    let branch11EdgeId: string | undefined;
    let branch12EdgeId: string | undefined;
    let main1TopicId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const boundaries = canonicalBoundaries(persisted);
      boundaryId = boundaries[0]?.id;
      branch11EdgeId = canonicalIncomingEdgeByTitle(persisted, '分支 1.1')?.[0];
      branch12EdgeId = canonicalIncomingEdgeByTitle(persisted, '分支 1.2')?.[0];
      main1TopicId = canonicalTopicByTitle(persisted, '主主题 1')?.[0];
      return boundaries[0]?.scope;
    }).toEqual({
      kind: 'sibling-range',
      parentTopicId: expect.any(String),
      firstEdgeId: expect.any(String),
      lastEdgeId: expect.any(String),
      includeDescendants: true,
    });
    expect(boundaryId).toBeTruthy();
    expect(branch11EdgeId).toBeTruthy();
    expect(branch12EdgeId).toBeTruthy();
    expect(main1TopicId).toBeTruthy();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const scope = persisted ? canonicalBoundaries(persisted)[0]?.scope : undefined;
      return scope;
    }).toEqual({
      kind: 'sibling-range',
      parentTopicId: main1TopicId,
      firstEdgeId: branch11EdgeId,
      lastEdgeId: branch11EdgeId,
      includeDescendants: true,
    });

    const properties = page.getByTestId('mindmap-semantic-properties');
    await expect(properties).toBeVisible();
    await properties.getByRole('button', { name: '编辑边界标题' }).click();
    const boundaryTitle = properties.getByLabel('编辑边界标题');
    await boundaryTitle.fill('发布范围');
    await boundaryTitle.press('Enter');
    const padding = properties.getByLabel('边界外扩距离');
    await padding.fill('28');
    await padding.press('Enter');
    await properties.getByLabel('边界形状').selectOption('wave');
    await properties.getByLabel('边界填充色').fill('#DDEEFF');
    await properties.getByLabel('边界边框色').fill('#334455');
    await properties.getByLabel('边界文字色').fill('#112233');
    const borderWidth = properties.getByLabel('边界边框宽度');
    await borderWidth.fill('4');
    await borderWidth.press('Enter');

    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      const style = boundary?.style as Record<string, unknown> | undefined;
      return boundary ? {
        title: boundary.title,
        padding: boundary.padding,
        overrides: style?.overrides,
      } : undefined;
    }).toEqual({
      title: '发布范围',
      padding: 28,
      overrides: {
        shape: 'wave',
        fill: { color: { kind: 'literal', value: '#DDEEFF' } },
        border: {
          color: { kind: 'literal', value: '#334455' },
          width: 4,
        },
        typography: { color: { kind: 'literal', value: '#112233' } },
      },
    });

    const overlay = page.getByTestId('mindmap-semantic-overlay');
    const boundaryOverlay = overlay.locator(
      `[data-semantic-kind="boundary"][data-entity-id="${boundaryId}"]`,
    );
    await expect(boundaryOverlay).toHaveAttribute('data-selected', 'true');
    await expect(boundaryOverlay).toHaveAttribute('data-boundary-shape', 'wave');
    await expect(boundaryOverlay.locator(':scope > path')).toHaveAttribute('fill', '#DDEEFF');
    await expect(boundaryOverlay.locator(':scope > path')).toHaveAttribute('stroke', '#334455');
    await expect(boundaryOverlay.getByText('发布范围')).toHaveAttribute('fill', '#112233');

    const frameHandles = boundaryOverlay.locator('[data-boundary-frame-handle]');
    await expect(frameHandles).toHaveCount(8);
    const eastFrameHandle = page.getByTestId(
      `mindmap-boundary-frame-handle-e-${boundaryId}`,
    );
    const eastFrameHandleBox = await eastFrameHandle.boundingBox();
    expect(eastFrameHandleBox).not.toBeNull();
    await page.mouse.move(
      eastFrameHandleBox!.x + eastFrameHandleBox!.width / 2,
      eastFrameHandleBox!.y + eastFrameHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      eastFrameHandleBox!.x + eastFrameHandleBox!.width / 2 + 60,
      eastFrameHandleBox!.y + eastFrameHandleBox!.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();
    let resizedRightOutset = 0;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      const extensions = boundary?.extensions as Record<string, unknown> | undefined;
      const frameExtension = extensions?.['app.nmdd.boundary-frame-v1'] as {
        outsets?: { right?: number };
      } | undefined;
      resizedRightOutset = frameExtension?.outsets?.right ?? 0;
      return resizedRightOutset;
    }).toBeGreaterThan(28);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      const extensions = boundary?.extensions as Record<string, unknown> | undefined;
      const frameExtension = extensions?.['app.nmdd.boundary-frame-v1'] as {
        outsets?: { right?: number };
      } | undefined;
      return frameExtension?.outsets?.right ?? boundary?.padding;
    }).toBe(28);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      const extensions = boundary?.extensions as Record<string, unknown> | undefined;
      const frameExtension = extensions?.['app.nmdd.boundary-frame-v1'] as {
        outsets?: { right?: number };
      } | undefined;
      return frameExtension?.outsets?.right;
    }).toBeCloseTo(resizedRightOutset, 3);

    const endHandle = page.getByTestId(`mindmap-boundary-range-handle-end-${boundaryId}`);
    await expect(endHandle).toBeVisible();
    const rangeAxis = await endHandle.getAttribute('data-boundary-range-axis');
    await endHandle.focus();
    await page.keyboard.press(rangeAxis === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      return (boundary?.scope as Record<string, unknown> | undefined)?.lastEdgeId;
    }).toBe(branch12EdgeId);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      return (boundary?.scope as Record<string, unknown> | undefined)?.lastEdgeId;
    }).toBe(branch11EdgeId);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const boundary = persisted
        ? canonicalBoundaries(persisted).find((candidate) => candidate.id === boundaryId)
        : undefined;
      return (boundary?.scope as Record<string, unknown> | undefined)?.lastEdgeId;
    }).toBe(branch12EdgeId);

    await topicButton(page, '分支 1.1').click();
    await topicButton(page, '分支 2.1').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('mindmap-boundary-preview'))
      .toHaveText('将因跨分支拆分为 2 个边界。');
    await createBoundary.click();
    let splitBoundaryIds: string[] = [];
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return [];
      const boundaries = canonicalBoundaries(persisted);
      splitBoundaryIds = boundaries
        .filter((candidate) => candidate.id !== boundaryId)
        .map((candidate) => candidate.id);
      return boundaries.length;
    }).toBe(3);
    expect(splitBoundaryIds).toHaveLength(2);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return [];
      return canonicalBoundaries(persisted)
        .filter((candidate) => splitBoundaryIds.includes(candidate.id))
        .map((candidate) => candidate.scope)
        .map((scope) => scope as Record<string, unknown>)
        .map((scope) => ({
          kind: scope.kind,
          singleton: scope.firstEdgeId === scope.lastEdgeId,
          includeDescendants: scope.includeDescendants,
        }));
    }).toEqual([
      { kind: 'sibling-range', singleton: true, includeDescendants: true },
      { kind: 'sibling-range', singleton: true, includeDescendants: true },
    ]);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalBoundaries(persisted).map((boundary) => boundary.id) : [];
    }).toEqual([boundaryId]);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted
        ? canonicalBoundaries(persisted).filter((boundary) => splitBoundaryIds.includes(boundary.id)).length
        : 0;
    }).toBe(2);

    await topicButton(page, '主主题 3').click();
    await page.getByTestId(`semantic-item-boundary-${boundaryId}`).click();
    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await expect(page.getByTestId(`mindmap-boundary-range-handle-start-${boundaryId}`)).toHaveCount(0);
    await expect(page.getByTestId(`mindmap-boundary-range-handle-end-${boundaryId}`)).toHaveCount(0);
    await expect(page.locator('[data-boundary-frame-handle]')).toHaveCount(0);
    await expect(properties.getByRole('button', { name: '编辑边界标题' })).toBeDisabled();
    await expect(properties.getByLabel('边界外扩距离')).toBeDisabled();
    await expect(properties.getByLabel('边界形状')).toBeDisabled();
    await expect(properties.getByLabel('边界填充色')).toBeDisabled();
    await expect(properties.getByLabel('边界边框色')).toBeDisabled();
    await expect(properties.getByLabel('边界文字色')).toBeDisabled();
    await expect(properties.getByLabel('边界边框宽度')).toBeDisabled();
    await topicButton(page, '主主题 3').click();
    await expect(createBoundary).toBeDisabled();
  });

  test('selection stays view-only, arrow navigation works, and drag reparent is undoable', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await expect(mindMapV2(page)).toBeVisible();

    await topicButton(page, '主主题 1').click();
    await topicButton(page, '主主题 2').click({ modifiers: ['Control'] });
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(2);
    await canvas(page).focus();
    await page.keyboard.press('Control+a');
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(10);
    await page.keyboard.press('Escape');
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(1);

    await topicButton(page, '创业模拟器').click();
    const selectedEntity = mindMapV2(page).locator('.react-flow__node.selected [data-entity-id]');
    const beforeArrow = await selectedEntity.getAttribute('data-entity-id');
    await canvas(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => selectedEntity.getAttribute('data-entity-id')).not.toBe(beforeArrow);
    const viewOnlyData = await mindMapData(page);
    expect(typeof viewOnlyData).toBe('object');
    expect(viewOnlyData).toMatchObject({ contentRevision: 0 });

    await topicDragHandle(page, '分支 1.1').dragTo(topicNode(page, '主主题 2'));
    await expect.poll(async () => canonicalData(page)).not.toBeNull();
    const moved = await canonicalData(page);
    expect(moved).not.toBeNull();
    expect(parentTitleInCanonicalData(moved!, '分支 1.1')).toBe('主主题 2');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const restored = await canonicalData(page);
      return restored ? parentTitleInCanonicalData(restored, '分支 1.1') : undefined;
    }).toBe('主主题 1');
  });

  test('Ctrl+F opens view-only search and navigates through the outliner', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    const beforeSearch = await mindMapData(page);
    await canvas(page).focus();
    await page.keyboard.press('Control+f');

    const panel = page.getByTestId('mindmap-search-outliner-panel');
    await expect(panel).toHaveAttribute('data-collapsed', 'false');
    const search = page.getByLabel('搜索主题和内容');
    await expect(search).toBeFocused();
    await search.fill('分支 2.1');
    await expect(page.getByTestId('mindmap-search-results').getByRole('listitem')).toHaveCount(1);
    await search.press('Enter');
    await expect(topicNode(page, '分支 2.1')).toHaveClass(/selected/);

    await page.getByRole('button', { name: '选择主题 主主题 3（主画布）' }).click();
    await expect(topicNode(page, '主主题 3')).toHaveClass(/selected/);
    expect(await mindMapData(page)).toEqual(beforeSearch);
  });

  test('Outliner edits titles, reorders, reparents by keyboard or drag, and shares canvas history', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await canvas(page).focus();
    await page.keyboard.press('Control+f');
    await page.getByLabel('搜索主题和内容').fill('');

    const mainTopic = page.getByRole('button', { name: '选择主题 主主题 2（主画布）' });
    await mainTopic.dblclick();
    const outlinerTitle = page.getByLabel('编辑主题标题 主主题 2');
    await outlinerTitle.fill('大纲编辑主题');
    await outlinerTitle.press('Enter');
    await expect(topicButton(page, '大纲编辑主题')).toBeVisible();

    const renamedRow = page.getByRole('button', { name: '选择主题 大纲编辑主题（主画布）' });
    await renamedRow.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? childTitlesInCanonicalData(persisted, '创业模拟器') : [];
    }).toEqual(['大纲编辑主题', '主主题 1', '主主题 3']);

    const branchRow = page.getByRole('button', { name: '选择主题 分支 1.2（主画布）' });
    await branchRow.click();
    await branchRow.focus();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.2') : undefined;
    }).toBe('创业模拟器');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.2') : undefined;
    }).toBe('主主题 1');
    await expect(topicButton(page, '大纲编辑主题')).toBeVisible();

    const branchTreeItem = page.getByRole('treeitem').filter({
      has: page.getByRole('button', { name: '选择主题 分支 1.2（主画布）', exact: true }),
    });
    const destinationTreeItem = page.getByRole('treeitem').filter({
      has: page.getByRole('button', { name: '选择主题 主主题 3（主画布）', exact: true }),
    });
    await branchTreeItem.dragTo(destinationTreeItem);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.2') : undefined;
    }).toBe('主主题 3');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.2') : undefined;
    }).toBe('主主题 1');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? parentTitleInCanonicalData(persisted, '分支 1.2') : undefined;
    }).toBe('主主题 3');
  });

  test('ACC-SEM-015/016 and ACC-KBD-022 edit labels, Notes, and safe Links with shared history', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await enterMindMapWorkspace(page);

    await page.getByRole('button', { name: '打开主题标签' }).click();
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');
    await panel.getByLabel('新标签').fill('  产品  ');
    await panel.getByRole('button', { name: '添加标签' }).click();
    await expect(panel.getByText('产品', { exact: true })).toBeVisible();
    await expect(topicNode(page, '主主题 1').getByRole('button', { name: '标签：产品' })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTopicByTitle(persisted, '主主题 1')?.[1].labels : undefined;
    }).toEqual(['产品']);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTopicByTitle(persisted, '主主题 1')?.[1].labels ?? [] : undefined;
    }).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTopicByTitle(persisted, '主主题 1')?.[1].labels : undefined;
    }).toEqual(['产品']);

    await canvas(page).focus();
    await page.keyboard.press('Control+f');
    await page.getByRole('combobox', { name: '搜索内容类型' }).selectOption('label');
    const semanticSearch = page.getByRole('searchbox', { name: '搜索主题和内容' });
    await semanticSearch.fill('产品');
    await expect(page.getByLabel('搜索结果 0 / 1')).toBeVisible();
    await expect(topicNode(page, '主主题 1').locator('[data-search-state="match"]')).toBeVisible();
    await expect(topicCard(page, '主主题 2')).toHaveCSS('opacity', '0.25');
    await semanticSearch.fill('');
    await expect(topicCard(page, '主主题 2')).toHaveCSS('opacity', '1');

    await panel.getByRole('tab', { name: '笔记' }).click();
    await panel.getByRole('button', { name: '添加笔记' }).click();
    const noteEditor = panel.getByRole('textbox', { name: '编辑主题笔记' });
    await noteEditor.fill('第一段');
    await noteEditor.press('Enter');
    await noteEditor.type('第二段');
    await noteEditor.press('Control+Enter');
    await expect(panel.getByLabel('主题笔记内容')).toContainText('第一段');
    await expect(panel.getByLabel('主题笔记内容')).toContainText('第二段');
    await expect(topicNode(page, '主主题 1').getByRole('button', { name: '笔记：第一段 第二段' })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const sheet = persisted ? firstCanonicalSheet(persisted) : undefined;
      const topicId = persisted ? canonicalTopicByTitle(persisted, '主主题 1')?.[0] : undefined;
      const notesValue = sheet?.notes;
      if (!topicId || notesValue === null || typeof notesValue !== 'object' || Array.isArray(notesValue)) return undefined;
      const note = Object.values(notesValue as Record<string, unknown>).find((candidate) =>
        candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).topicId === topicId);
      return note !== null && typeof note === 'object' && !Array.isArray(note)
        ? richTextTitle((note as Record<string, unknown>).content)
        : undefined;
    }).toBe('第一段第二段');

    await canvas(page).focus();
    await page.keyboard.press('Control+k');
    await expect(panel.getByRole('tab', { name: '链接' })).toHaveAttribute('aria-selected', 'true');
    const linkAddress = panel.getByLabel('链接地址');
    await expect(linkAddress).toBeFocused();
    await linkAddress.fill('javascript:alert(1)');
    await panel.getByRole('button', { name: '添加链接' }).click();
    await expect(panel.getByRole('alert')).toContainText('仅支持 http、https 和 mailto');

    await linkAddress.fill('example.com/docs');
    await panel.getByLabel('链接标题').fill('产品文档');
    await panel.getByRole('button', { name: '添加链接' }).click();
    await expect(panel.getByText('产品文档', { exact: true })).toBeVisible();
    await expect(topicNode(page, '主主题 1').getByRole('button', { name: '链接：产品文档' })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const sheet = persisted ? firstCanonicalSheet(persisted) : undefined;
      const topicId = persisted ? canonicalTopicByTitle(persisted, '主主题 1')?.[0] : undefined;
      const linksValue = sheet?.links;
      if (!topicId || linksValue === null || typeof linksValue !== 'object' || Array.isArray(linksValue)) return [];
      return Object.values(linksValue as Record<string, unknown>)
        .filter((candidate): candidate is Record<string, unknown> =>
          candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
          && candidate.topicId === topicId)
        .map((link) => ({ kind: link.kind, href: link.href, title: link.title }));
    }).toEqual([{ kind: 'web', href: 'https://example.com/docs', title: '产品文档' }]);
  });

  test('ACC-SEM-019 creates and toggles one canonical To-do with derived parent progress and undo', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 2').click();
    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开主题待办' }).click();
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');
    await panel.getByRole('button', { name: '添加待办' }).click();
    await expect(panel.getByTestId('mindmap-topic-todo')).toContainText('未完成');
    await expect(topicNode(page, '主主题 2').getByRole('button', { name: '待办：未完成' })).toBeVisible();

    let todoId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const sheet = persisted ? firstCanonicalSheet(persisted) : undefined;
      const topicId = persisted ? canonicalTopicByTitle(persisted, '主主题 2')?.[0] : undefined;
      const todosValue = sheet?.todos;
      if (!topicId || todosValue === null || typeof todosValue !== 'object' || Array.isArray(todosValue)) return undefined;
      const entry = Object.entries(todosValue as Record<string, unknown>).find(([, candidate]) =>
        candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).topicId === topicId);
      todoId = entry?.[0];
      return entry?.[1];
    }).toMatchObject({ completed: false });

    await panel.getByRole('button', { name: '标记待办为已完成' }).click();
    await expect(panel.getByTestId('mindmap-topic-todo')).toContainText('已完成');
    await expect(topicNode(page, '主主题 2').getByRole('button', { name: '待办：已完成' })).toBeVisible();
    await expect(topicNode(page, '创业模拟器').getByRole('button', {
      name: '子级待办进度：1/1（100%）',
    })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const todosValue = persisted ? firstCanonicalSheet(persisted)?.todos : undefined;
      if (!todoId || todosValue === null || typeof todosValue !== 'object' || Array.isArray(todosValue)) return undefined;
      const todo = (todosValue as Record<string, unknown>)[todoId];
      return todo !== null && typeof todo === 'object' && !Array.isArray(todo)
        ? { id: todoId, ...(todo as Record<string, unknown>) }
        : undefined;
    }).toMatchObject({ id: todoId, completed: true, completedAt: expect.any(String) });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicNode(page, '主主题 2').getByRole('button', { name: '待办：未完成' })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(topicNode(page, '主主题 2').getByRole('button', { name: '待办：未完成' })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(topicNode(page, '主主题 2').getByRole('button', { name: '待办：已完成' })).toBeVisible();
  });

  test('ACC-SEM-019 batches a deduplicated multi-selection and lets the parent complete children atomically', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await topicButton(page, '主主题 2').click({ modifiers: ['Control'] });
    await expect(mindMapV2(page).locator('.react-flow__node.selected')).toHaveCount(2);
    await enterMindMapWorkspace(page);

    await page.getByRole('button', { name: '打开主题待办' }).click();
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');
    const bulk = panel.getByTestId('mindmap-bulk-todo-controls');
    await expect(bulk).toContainText('已选择 2 个主题');
    await bulk.getByRole('button', { name: '批量应用待办 (2)' }).click();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTodosByTopicTitle(persisted) : {};
    }).toMatchObject({
      '主主题 1': { completed: false },
      '主主题 2': { completed: false },
    });

    await bulk.getByRole('button', { name: '批量标记已完成 (2)' }).click();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTodosByTopicTitle(persisted) : {};
    }).toMatchObject({
      '主主题 1': { completed: true, completedAt: expect.any(String) },
      '主主题 2': { completed: true, completedAt: expect.any(String) },
    });
    await expect(topicNode(page, '创业模拟器').getByRole('button', {
      name: '子级待办进度：2/2（100%）',
    })).toBeVisible();

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const todos = persisted ? canonicalTodosByTopicTitle(persisted) : {};
      return Object.fromEntries(Object.entries(todos).map(([title, todo]) => [title, todo.completed]));
    }).toEqual({ '主主题 1': false, '主主题 2': false });
    await page.keyboard.press('Control+Shift+z');

    await topicButton(page, '创业模拟器').click();
    await topicNode(page, '创业模拟器').getByRole('button', {
      name: '子级待办进度：2/2（100%）',
    }).click();
    await expect(panel.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '100%');
    await panel.getByRole('button', { name: '取消全部直属子项完成' }).click();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const todos = persisted ? canonicalTodosByTopicTitle(persisted) : {};
      return Object.fromEntries(Object.entries(todos).map(([title, todo]) => [title, todo.completed]));
    }).toEqual({ '主主题 1': false, '主主题 2': false });
    await expect(panel.getByRole('progressbar', { name: '直属子主题待办进度' }))
      .toHaveAttribute('aria-valuetext', '0%');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const todos = persisted ? canonicalTodosByTopicTitle(persisted) : {};
      return Object.values(todos).filter((todo) => todo.completed).length;
    }).toBe(2);
  });

  test('Task keeps a stable canonical identity across rich edits and shared undo/redo history', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 3').click();
    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开主题任务' }).click();
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');
    await expect(panel.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: '添加任务' }).click();

    await panel.getByLabel('任务状态').selectOption('in-progress');
    await panel.getByLabel('任务进度百分比').fill('35');
    await panel.getByLabel('任务优先级').selectOption('2');
    await panel.getByLabel('任务开始日期').fill('2026-07-21');
    await panel.getByLabel('任务截止日期').fill('2026-07-25');
    await panel.getByLabel('任务工期分钟').fill('1440');
    await panel.getByLabel('标记为里程碑').check();
    await panel.getByLabel('显示任务字段 优先级').check();
    await panel.getByLabel('显示任务字段 开始日期').check();
    await panel.getByLabel('显示任务字段 截止日期').check();
    await panel.getByRole('button', { name: '保存任务' }).click();

    await expect(panel.getByTestId('mindmap-topic-task')).toContainText('进行中');
    await expect(panel.getByTestId('mindmap-topic-task')).toContainText('35%');
    await expect(topicNode(page, '主主题 3').getByRole('button', {
      name: '任务：进行中，进度 35%，优先级 2',
    })).toBeVisible();
    let taskId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const task = persisted ? canonicalTasksByTopicTitle(persisted)['主主题 3'] : undefined;
      taskId = task?.id;
      return task;
    }).toMatchObject({
      status: 'in-progress',
      progress: 0.35,
      priority: 2,
      startDate: '2026-07-21',
      dueDate: '2026-07-25',
      durationMinutes: 1440,
      milestone: true,
      displayFields: ['status', 'progress', 'priority', 'start-date', 'due-date'],
    });

    await panel.getByRole('button', { name: '编辑任务' }).click();
    await panel.getByLabel('任务状态').selectOption('done');
    await expect(panel.getByLabel('任务进度百分比')).toHaveValue('100');
    await panel.getByRole('button', { name: '保存任务' }).click();
    await expect(topicNode(page, '主主题 3').getByRole('button', {
      name: '任务：已完成，进度 100%，优先级 2',
    })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const task = persisted ? canonicalTasksByTopicTitle(persisted)['主主题 3'] : undefined;
      return task ? { id: task.id, status: task.status, progress: task.progress } : undefined;
    }).toEqual({ id: taskId, status: 'done', progress: 1 });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicNode(page, '主主题 3').getByRole('button', {
      name: '任务：进行中，进度 35%，优先级 2',
    })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(topicNode(page, '主主题 3').getByRole('button', { name: /^任务：/ })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(topicNode(page, '主主题 3').getByRole('button', {
      name: '任务：已完成，进度 100%，优先级 2',
    })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? Object.keys(firstCanonicalSheet(persisted)?.todos ?? {}).length : -1;
    }).toBe(0);
  });

  test('Task dependencies persist stable endpoints, type, lag, undo/redo, and read-only state', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');

    for (const title of ['主主题 1', '主主题 2']) {
      await topicButton(page, title).click();
      await page.getByRole('button', { name: '打开主题任务' }).click();
      await panel.getByRole('button', { name: '添加任务' }).click();
      await panel.getByRole('button', { name: '保存任务' }).click();
    }

    let predecessorTaskId: string | undefined;
    let successorTaskId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const tasks = persisted ? canonicalTasksByTopicTitle(persisted) : {};
      predecessorTaskId = tasks['主主题 1']?.id;
      successorTaskId = tasks['主主题 2']?.id;
      return [predecessorTaskId, successorTaskId];
    }).toEqual([expect.any(String), expect.any(String)]);

    const dependencies = panel.getByRole('region', { name: 'Task 依赖关系' });
    await dependencies.getByRole('button', { name: '添加前置任务' }).click();
    await dependencies.getByLabel('Task 依赖目标').selectOption(predecessorTaskId!);
    await dependencies.getByLabel('Task 依赖类型').selectOption('finish-finish');
    await dependencies.getByLabel('Task 依赖延迟分钟').fill('60');
    await dependencies.getByRole('button', { name: '保存依赖' }).click();

    let dependencyId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const dependency = persisted ? canonicalTaskDependencies(persisted)[0] : undefined;
      dependencyId = dependency?.id;
      return dependency;
    }).toMatchObject({
      id: expect.any(String),
      predecessorTaskId,
      successorTaskId,
      type: 'finish-finish',
      lagMinutes: 60,
    });
    await expect(dependencies).toContainText('FF · 同步完成');
    await expect(dependencies).toContainText('延迟 60 分钟');

    await dependencies.getByRole('button', { name: '编辑依赖 主主题 1' }).click();
    await dependencies.getByLabel('Task 依赖类型').selectOption('start-start');
    await dependencies.getByLabel('Task 依赖延迟分钟').fill('-30');
    await dependencies.getByRole('button', { name: '保存依赖' }).click();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const dependency = persisted ? canonicalTaskDependencies(persisted)[0] : undefined;
      return dependency ? {
        id: dependency.id,
        predecessorTaskId: dependency.predecessorTaskId,
        successorTaskId: dependency.successorTaskId,
        type: dependency.type,
        lagMinutes: dependency.lagMinutes,
      } : undefined;
    }).toEqual({
      id: dependencyId,
      predecessorTaskId,
      successorTaskId,
      type: 'start-start',
      lagMinutes: -30,
    });
    await expect(dependencies).toContainText('SS · 同步开始');
    await expect(dependencies).toContainText('提前 30 分钟');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const dependency = persisted ? canonicalTaskDependencies(persisted)[0] : undefined;
      return dependency ? {
        id: dependency.id,
        type: dependency.type,
        lagMinutes: dependency.lagMinutes,
      } : undefined;
    }).toEqual({ id: dependencyId, type: 'finish-finish', lagMinutes: 60 });
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTaskDependencies(persisted) : [];
    }).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const dependency = persisted ? canonicalTaskDependencies(persisted)[0] : undefined;
      return dependency ? { id: dependency.id, type: dependency.type, lagMinutes: dependency.lagMinutes } : undefined;
    }).toEqual({ id: dependencyId, type: 'start-start', lagMinutes: -30 });

    await topicButton(page, '主主题 1').click();
    const reverseDependencies = panel.getByRole('region', { name: 'Task 依赖关系' });
    await reverseDependencies.getByRole('button', { name: '添加前置任务' }).click();
    await reverseDependencies.getByLabel('Task 依赖目标').selectOption(successorTaskId!);
    await reverseDependencies.getByRole('button', { name: '保存依赖' }).click();
    await expect(reverseDependencies.getByRole('alert')).toContainText('directed cycle');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalTaskDependencies(persisted).map((dependency) => dependency.id) : [];
    }).toEqual([dependencyId]);
    await reverseDependencies.getByRole('button', { name: '取消' }).click();

    await topicButton(page, '主主题 2').click();

    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(dependencies.getByRole('button', { name: '添加前置任务' })).toHaveCount(0);
    await expect(dependencies.getByRole('button', { name: '编辑依赖 主主题 1' })).toHaveCount(0);
    await expect(dependencies.getByRole('button', { name: '删除依赖 主主题 1' })).toHaveCount(0);
  });

  test('Marker library, exclusive replacement, custom markers, and draggable legend stay canonical', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开标记与图例' }).click();
    const panel = page.getByTestId('mindmap-marker-legend-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '安装缺少的标准标记组' }).click();

    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const state = persisted ? canonicalMarkerState(persisted, '主主题 1') : undefined;
      return state ? {
        definitions: state.definitions.length,
        groups: state.groups.map((group) => group.name),
      } : undefined;
    }).toEqual({
      definitions: 20,
      groups: ['优先级', '进度', '旗帜', '星标', '箭头'],
    });

    await panel.getByRole('button', {
      name: '应用或替换为标记：优先级 1（优先级）',
    }).click();
    let priorityInstanceId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const state = canonicalMarkerState(persisted, '主主题 1');
      const definitionById = new Map(state.definitions.map((definition) => [definition.id, definition]));
      priorityInstanceId = state.instances[0]?.id;
      return state.instances.map((instance) => ({
        id: instance.id,
        label: definitionById.get(String(instance.markerDefinitionId))?.name,
      }));
    }).toEqual([{ id: expect.any(String), label: '优先级 1' }]);

    await panel.getByRole('button', {
      name: '应用或替换为标记：优先级 2（优先级）',
    }).click();
    await panel.getByRole('button', {
      name: '应用或替换为标记：实心星标（星标）',
    }).click();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const state = canonicalMarkerState(persisted, '主主题 1');
      const definitionById = new Map(state.definitions.map((definition) => [definition.id, definition]));
      return state.instances.map((instance) => ({
        id: instance.id,
        label: definitionById.get(String(instance.markerDefinitionId))?.name,
      }));
    }).toEqual([
      { id: priorityInstanceId, label: '优先级 2' },
      { id: expect.any(String), label: '实心星标' },
    ]);
    await expect(topicNode(page, '主主题 1').getByRole('button', {
      name: '标记：优先级 2（优先级），值：2',
    })).toBeVisible();

    const createGroup = panel.getByRole('form', { name: '新建自定义标记组' });
    await createGroup.getByLabel('新自定义标记组名称').fill('决策状态');
    await createGroup.getByLabel('自定义标记组同组互斥').uncheck();
    await createGroup.getByRole('button', { name: '新建自定义组' }).click();
    const customGroup = panel.getByRole('article', { name: '标记组 决策状态' });
    await customGroup.getByRole('button', { name: '添加自定义标记' }).click();
    const createDefinition = customGroup.getByRole('form', { name: '向 决策状态 添加标记' });
    await createDefinition.getByLabel('新标记名称').fill('待验证');
    await createDefinition.getByLabel('新标记图形').selectOption('custom-diamond');
    await createDefinition.getByRole('button', { name: '保存标记' }).click();
    await panel.getByRole('button', { name: '应用标记：待验证（决策状态）' }).click();

    let priorityDefinitionId: string | undefined;
    let customDefinitionId: string | undefined;
    let starDefinitionId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      if (!persisted) return undefined;
      const state = canonicalMarkerState(persisted, '主主题 1');
      priorityDefinitionId = state.definitions.find((definition) => definition.name === '优先级 2')?.id;
      customDefinitionId = state.definitions.find((definition) => definition.name === '待验证')?.id;
      starDefinitionId = state.definitions.find((definition) => definition.name === '实心星标')?.id;
      return {
        customGroup: state.groups.find((group) => group.name === '决策状态'),
        definitions: [priorityDefinitionId, starDefinitionId, customDefinitionId],
        instanceCount: state.instances.length,
      };
    }).toMatchObject({
      customGroup: { exclusive: false, kind: 'custom' },
      definitions: [expect.any(String), expect.any(String), expect.any(String)],
      instanceCount: 3,
    });

    await panel.getByLabel('显示标记图例').check();
    await panel.getByRole('textbox', { name: '标记图例标题', exact: true }).fill('项目标记');
    await panel.getByRole('button', { name: '保存标记图例标题' }).click();
    await panel.getByLabel('图例包含 优先级 2').check();
    await panel.getByLabel('图例包含 实心星标').check();
    await panel.getByLabel('图例包含 待验证').check();
    await panel.getByRole('button', { name: '在图例中上移 待验证' }).click();
    await panel.getByRole('button', { name: '在图例中上移 待验证' }).click();
    await panel.getByRole('spinbutton', { name: '标记图例 X 坐标' }).fill('180');
    await panel.getByRole('spinbutton', { name: '标记图例 Y 坐标' }).fill('96');
    await panel.getByRole('button', { name: '移动', exact: true }).click();

    const legendCanvas = page.getByTestId('mindmap-marker-legend-canvas');
    await expect(legendCanvas).toHaveAccessibleName('项目标记');
    await expect(legendCanvas.getByRole('list', { name: '标记图例项目' })).toContainText('待验证');
    await expect(legendCanvas).toHaveAttribute('data-content-x', '180');
    await expect(legendCanvas).toHaveAttribute('data-content-y', '96');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const legend = persisted ? canonicalMarkerState(persisted, '主主题 1').legend : undefined;
      return legend ? {
        itemOrder: legend.itemOrder,
        position: legend.position,
        title: legend.title,
        visible: legend.visible,
      } : undefined;
    }).toEqual({
      itemOrder: [customDefinitionId, priorityDefinitionId, starDefinitionId],
      position: { x: 180, y: 96 },
      title: '项目标记',
      visible: true,
    });

    const dragHandle = legendCanvas.getByLabel('拖动标记图例');
    const dragBox = await dragHandle.boundingBox();
    expect(dragBox).not.toBeNull();
    await page.mouse.move(dragBox!.x + 24, dragBox!.y + dragBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + 84, dragBox!.y + dragBox!.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    let draggedPosition: unknown;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      draggedPosition = persisted ? canonicalMarkerState(persisted, '主主题 1').legend?.position : undefined;
      return draggedPosition;
    }).not.toEqual({ x: 180, y: 96 });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalMarkerState(persisted, '主主题 1').legend?.position : undefined;
    }).toEqual({ x: 180, y: 96 });
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalMarkerState(persisted, '主主题 1').legend?.position : undefined;
    }).toEqual(draggedPosition);

    await canvas(page).focus();
    await page.keyboard.press('Control+f');
    await page.getByRole('combobox', { name: '搜索内容类型' }).selectOption('marker');
    const markerSearch = page.getByRole('searchbox', { name: '搜索主题和内容' });
    await markerSearch.fill('待验证');
    await expect(page.getByLabel('搜索结果 0 / 1')).toBeVisible();
    await expect(topicNode(page, '主主题 1').locator('[data-search-state="match"]')).toBeVisible();
    await expect(topicCard(page, '主主题 2'))
      .toHaveCSS('opacity', '0.25');
    await markerSearch.fill('');

    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(panel.getByLabel('显示标记图例')).toHaveCount(0);
    await expect(panel.getByText('已显示', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('优先级 2，已应用')).toBeVisible();
    await expect(legendCanvas.getByLabel('标记图例标题')).toBeVisible();
    await expect(legendCanvas.getByLabel('拖动标记图例')).toHaveCount(0);
  });

  test('creates a cross-Sheet internal Link, navigates it, and shares undo/redo history', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await page.getByRole('button', { name: '新增画布', exact: true }).click();
    await page.getByRole('button', { name: '新画布', exact: true }).dblclick();
    const sheetTitle = page.getByLabel('编辑画布标题');
    await sheetTitle.fill('目标画布');
    await sheetTitle.press('Enter');
    await page.getByRole('button', { name: '主画布', exact: true }).click();

    await topicButton(page, '主主题 1').click();
    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开主题链接' }).click();
    const panel = page.getByTestId('mindmap-topic-enrichment-panel');
    await panel.getByRole('button', { name: '添加内部链接' }).click();
    await panel.getByRole('textbox', { name: '搜索 Sheet 或主题' }).fill('目标画布');
    await panel.getByRole('option', { name: /目标画布.*整个 Sheet/ }).click();
    await panel.getByRole('textbox', { name: '内部链接显示标题' }).fill('目标画布入口');
    await panel.getByRole('button', { name: '保存内部链接' }).click();

    await expect(topicNode(page, '主主题 1').getByRole('button', {
      name: '链接：目标画布入口',
    })).toBeVisible();
    let linkId: string | undefined;
    let targetSheetId: string | undefined;
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const links = persisted ? canonicalLinksForTopicTitle(persisted, '主画布', '主主题 1') : [];
      const link = links[0];
      linkId = link?.id;
      targetSheetId = typeof link?.targetSheetId === 'string' ? link.targetSheetId : undefined;
      return link;
    }).toMatchObject({
      kind: 'sheet',
      title: '目标画布入口',
      status: 'active',
      targetSheetId: expect.any(String),
    });

    await panel.getByRole('button', { name: '打开链接 目标画布入口' }).click();
    await expect(canvas(page)).toHaveAccessibleName(/当前画布 目标画布/);
    await page.getByRole('button', { name: '主画布', exact: true }).click();
    await expect(canvas(page)).toHaveAccessibleName(/当前画布 主画布/);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicNode(page, '主主题 1').getByRole('button', {
      name: '链接：目标画布入口',
    })).toHaveCount(0);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? canonicalLinksForTopicTitle(persisted, '主画布', '主主题 1').length : -1;
    }).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const link = persisted ? canonicalLinksForTopicTitle(persisted, '主画布', '主主题 1')[0] : undefined;
      return link ? { id: link.id, targetSheetId: link.targetSheetId } : undefined;
    }).toEqual({ id: linkId, targetSheetId });
  });

  test('canvas navigation clamps 10%–500% and branch focus restores the exact view', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    await expect(topics(page)).toHaveCount(10);
    const beforeViewOnlyActions = await mindMapData(page);
    const navigation = page.getByTestId('mindmap-canvas-navigation');
    const zoomInput = navigation.getByLabel('缩放百分比');

    await zoomInput.fill('900%');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('500%');
    await expect(navigation.getByRole('button', { name: '放大' })).toBeDisabled();

    await zoomInput.fill('1');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('10%');
    await expect(navigation.getByRole('button', { name: '缩小' })).toBeDisabled();

    await navigation.getByRole('button', { name: '重置为 100%' }).click();
    await expect(zoomInput).toHaveValue('100%');
    await navigation.getByRole('button', { name: '适应安全画布' }).click();
    await page.waitForTimeout(240);
    const flowBounds = await mindMapV2(page).locator('.react-flow').boundingBox();
    expect(flowBounds).not.toBeNull();
    await page.mouse.move(
      flowBounds!.x + flowBounds!.width / 2,
      flowBounds!.y + flowBounds!.height / 2,
    );
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect.poll(async () => zoomInput.inputValue()).not.toBe('100%');
    await navigation.getByRole('button', { name: '重置为 100%' }).click();
    await navigation.getByRole('button', { name: '适应安全画布' }).click();
    await page.waitForTimeout(240);
    await topicButton(page, '主主题 1').click();
    await canvas(page).focus();
    await page.waitForTimeout(220);
    const flowViewport = mindMapV2(page).locator('.react-flow__viewport');
    const transformBeforeFocus = await flowViewport.getAttribute('style');
    expect(transformBeforeFocus).toBeTruthy();

    await page.keyboard.press('Control+;');
    await expect(page.getByTestId('mindmap-branch-breadcrumb')).toBeVisible();
    await expect(navigation).toHaveAttribute('data-focused', 'true');
    await expect(topics(page)).toHaveCount(4);
    await expect(topicNode(page, '主主题 2')).toHaveCount(0);
    await expect(topicNode(page, '主主题 1')).toHaveClass(/selected/);
    expect(await mindMapData(page)).toEqual(beforeViewOnlyActions);

    await canvas(page).focus();
    await page.keyboard.press('Control+;');
    await expect(page.getByTestId('mindmap-branch-breadcrumb')).toHaveCount(0);
    await expect(navigation).toHaveAttribute('data-focused', 'false');
    await expect(topics(page)).toHaveCount(10);
    await expect.poll(async () => flowViewport.getAttribute('style'))
      .toBe(transformBeforeFocus);
    await expect(topicNode(page, '主主题 1')).toHaveClass(/selected/);
    expect(await mindMapData(page)).toEqual(beforeViewOnlyActions);

    await canvas(page).focus();
    await page.keyboard.press('Control+;');
    await expect(navigation).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Control+f');
    await page.getByLabel('搜索主题和内容').fill('');
    await page.getByRole('button', { name: '选择主题 主主题 2（主画布）' }).click();
    await expect(navigation).toHaveAttribute('data-focused', 'false');
    await expect(topicNode(page, '主主题 2')).toHaveClass(/selected/);
    expect(await mindMapData(page)).toEqual(beforeViewOnlyActions);

    await page.getByRole('button', { name: '选择主题 主主题 1（主画布）' }).click();
    await canvas(page).focus();
    await page.keyboard.press('Control+;');
    await expect(navigation).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Delete');
    await expect(navigation).toHaveAttribute('data-focused', 'false');
    await expect(topicButton(page, '主主题 1')).toHaveCount(0);
    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, '主主题 1')).toBeVisible();
  });

  test('exports outlines and applies Markdown import as one undoable transaction', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开导入与导出' }).click();
    const panel = page.getByTestId('mindmap-import-export-panel');
    await expect(panel).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出 Markdown' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Small canonical mind map.md');

    const xmindDownloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出 XMind' }).click();
    const xmindDownload = await xmindDownloadPromise;
    expect(xmindDownload.suggestedFilename()).toBe('Small canonical mind map.xmind');
    const xmindPath = await xmindDownload.path();
    expect(xmindPath).toBeTruthy();
    if (!xmindPath) throw new Error('XMind download has no local path.');
    await panel.getByLabel('选择 XMind 文件').setInputFiles({
      name: 'Small canonical mind map.xmind',
      mimeType: 'application/x-xmind',
      buffer: await readFile(xmindPath),
    });
    const xmindConfirm = page.getByRole('dialog', { name: '应用导入结果？' });
    await expect(xmindConfirm).toBeVisible();
    await expect(xmindConfirm).toContainText('Small canonical mind map.xmind');
    await xmindConfirm.getByRole('button', { name: '取消' }).click();

    await panel.getByLabel('选择 Markdown 文件').setInputFiles({
      name: 'imported-roadmap.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from([
        '# Imported roadmap',
        '',
        '## Launch plan',
        '',
        '- Imported root',
        '  - Imported child',
        '',
      ].join('\n')),
    });
    const confirm = page.getByRole('dialog', { name: '应用导入结果？' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('1');
    await expect(confirm).toContainText('2');
    await confirm.getByRole('button', { name: '应用导入' }).click();
    await expect(topicButton(page, 'Imported root')).toBeVisible();
    await expect(topicButton(page, 'Imported child')).toBeVisible();
    await expect(topics(page)).toHaveCount(2);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicCountInCanonicalData(persisted) : 0;
    }).toBe(2);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topicButton(page, '创业模拟器')).toBeVisible();
    await expect(topics(page)).toHaveCount(10);
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.press('Control+y');
    await expect(topicButton(page, 'Imported root')).toBeVisible();
    await expect(topics(page)).toHaveCount(2);
  });

  test('materializes XMind package images once and preserves render, undo/redo, and re-export', async ({ page }) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(12_000);
    await page.goto('/editor-lab?fixture=mindmap-v1-small');

    const pngBase64 = await page.evaluate(() => {
      const element = document.createElement('canvas');
      element.width = 3;
      element.height = 2;
      const context = element.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable.');
      context.fillStyle = '#2563eb';
      context.fillRect(0, 0, 3, 2);
      return element.toDataURL('image/png').split(',')[1];
    });
    const png = Buffer.from(pngBase64, 'base64');
    const sha256 = createHash('sha256').update(png).digest('hex');
    const objectKey = `mindmap-images/sha256/${sha256}.png`;

    let uploadCount = 0;
    let uploadBlock: Promise<void> | undefined;
    let releaseUpload: (() => void) | undefined;
    await page.route('**/api/upload?kind=image', async (route) => {
      uploadCount += 1;
      expect(route.request().method()).toBe('POST');
      if (uploadBlock) await uploadBlock;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `https://assets.example.test/${objectKey}`,
          objectKey,
          fileName: 'pixel.png',
          mimeType: 'image/png',
          byteSize: png.byteLength,
          sha256,
        }),
      });
    });
    await page.route(`**/api/mindmap/image-assets/${sha256}.png`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'content-length': String(png.byteLength) },
        body: png,
      });
    });

    await topicButton(page, '主主题 1').click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('mindmap-insert-local-image').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'durable.png', mimeType: 'image/png', buffer: png });
    await expect(mindMapV2(page).locator('[data-topic-image-source="ready"]')).toHaveCount(1);

    await enterMindMapWorkspace(page);
    await page.getByRole('button', { name: '打开导入与导出' }).click();
    const panel = page.getByTestId('mindmap-import-export-panel');
    const firstDownloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出 XMind' }).click();
    const firstDownload = await firstDownloadPromise;
    const firstDownloadPath = await firstDownload.path();
    expect(firstDownloadPath).toBeTruthy();
    if (!firstDownloadPath) throw new Error('Initial image XMind has no local path.');

    const currentImage = mindMapV2(page).locator('[data-topic-image-id]').first();
    await currentImage.click({ force: true });
    await currentImage.press('Delete');
    await expect(mindMapV2(page).locator('[data-topic-image-id]')).toHaveCount(0);

    uploadCount = 0;
    uploadBlock = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const importPanel = page.getByTestId('mindmap-import-export-panel');
    await importPanel.getByLabel('选择 XMind 文件').setInputFiles({
      name: 'durable-image.xmind',
      mimeType: 'application/x-xmind',
      buffer: await readFile(firstDownloadPath),
    });
    const confirm = page.getByRole('dialog', { name: '应用导入结果？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '应用导入' }).click();
    await expect(confirm.getByRole('status')).toContainText('完成前不会修改当前脑图');
    await expect(mindMapV2(page).locator('[data-topic-image-id]')).toHaveCount(0);
    releaseUpload?.();
    uploadBlock = undefined;
    await expect(mindMapV2(page).locator('[data-topic-image-source="ready"]')).toHaveCount(1);
    await expect(mindMapV2(page).locator('[data-testid^="topic-image-content-"]')).toBeVisible();
    expect(uploadCount).toBe(1);

    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      const assets = persisted?.assets as Record<string, Record<string, unknown>> | undefined;
      const source = assets ? Object.values(assets)[0]?.source : undefined;
      return source;
    }).toEqual({ kind: 'managed', objectKey });
    const serialized = JSON.stringify(await canonicalData(page));
    expect(serialized).not.toContain('resourceBytes');
    expect(serialized).not.toContain('blob:');

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(mindMapV2(page).locator('[data-topic-image-id]')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(mindMapV2(page).locator('[data-topic-image-source="ready"]')).toHaveCount(1);
    expect(uploadCount).toBe(1);

    await page.getByRole('button', { name: '打开导入与导出' }).click();
    const reexportPanel = page.getByTestId('mindmap-import-export-panel');
    const downloadPromise = page.waitForEvent('download');
    await reexportPanel.getByRole('button', { name: '导出 XMind' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    if (!downloadPath) throw new Error('Re-exported XMind has no local path.');
    const extracted = unzipSync(new Uint8Array(await readFile(downloadPath)));
    expect(Buffer.from(extracted[`resources/${sha256}.png`] ?? []).equals(png)).toBe(true);
    expect(uploadCount).toBe(1);
  });

  test('multi-delete is one undo unit and read-only mode rejects content gestures', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await expect(topics(page)).toHaveCount(10);

    await topicButton(page, '分支 1.1').click();
    await topicButton(page, '分支 2.1').click({ modifiers: ['Control'] });
    await canvas(page).focus();
    await page.keyboard.press('Delete');
    await expect(topics(page)).toHaveCount(8);
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(10);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicCountInCanonicalData(persisted) : null;
    }).toBe(10);

    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await expect(mindMapV2(page).locator('.mindmap-topic-drag-handle')).toHaveCount(0);
    const beforeReadOnly = await mindMapData(page);
    await topicButton(page, '主主题 1').click();
    await canvas(page).focus();
    await page.keyboard.press('Tab');
    await expect(topics(page)).toHaveCount(10);
    expect(await mindMapData(page)).toEqual(beforeReadOnly);
  });

  test('sheet bar creates, renames, deletes, and restores a canonical sheet', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await page.getByRole('button', { name: '新增画布', exact: true }).click();
    await page.getByRole('button', { name: '新画布', exact: true }).dblclick();
    const sheetTitle = page.getByLabel('编辑画布标题');
    await expect(sheetTitle).toBeVisible();
    await sheetTitle.fill('第二画布');
    await sheetTitle.press('Enter');
    await expect(page.getByRole('button', { name: '第二画布', exact: true })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? sheetCountInCanonicalData(persisted) : 0;
    }).toBe(2);

    await page.getByRole('button', { name: '删除当前画布', exact: true }).click();
    await expect(page.getByRole('button', { name: '第二画布', exact: true })).toHaveCount(0);
    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: '第二画布', exact: true })).toBeVisible();
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? sheetCountInCanonicalData(persisted) : 0;
    }).toBe(2);
  });

  test('switches advanced structures with persisted, undoable layout variants', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    const structure = page.getByLabel('导图结构');
    const direction = page.getByLabel('布局方向');
    await expect(structure).toBeVisible();
    await structure.selectOption('core:timeline');
    await expect(structure).toHaveValue('core:timeline');
    await expect(direction).toHaveValue('left-to-right');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? firstSheetLayoutInCanonicalData(persisted) : undefined;
    }).toMatchObject({
      direction: 'left-to-right',
      structure: 'core:timeline',
      variantId: 'horizontal',
    });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(structure).toHaveValue('core:mind-map');
    await page.keyboard.press('Control+y');
    await expect(structure).toHaveValue('core:timeline');

    const variant = page.getByLabel('结构变体');
    await variant.selectOption('horizontal-off-axis');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? firstSheetLayoutInCanonicalData(persisted)?.variantId : undefined;
    }).toBe('horizontal-off-axis');
    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(variant).toHaveValue('horizontal');
    await page.keyboard.press('Control+y');
    await expect(variant).toHaveValue('horizontal-off-axis');
  });

  test('renders and selects semantic elements directly on the canvas', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-elements');
    const productBadges = topicNode(page, '产品设计').getByTestId('topic-badges');
    await expect(productBadges).toBeVisible();
    await expect(productBadges.locator('[data-topic-enrichment-kind="marker"]')).toHaveCount(1);
    await expect(productBadges.locator('[data-topic-enrichment-kind="note"]')).toHaveCount(1);
    await expect(topicNode(page, '产品设计').locator('[data-topic-image-id]')).toHaveCount(1);
    await expect(topicNode(page, '市场发布').locator(
      '[data-topic-enrichment-kind="todo"]',
    )).toHaveCount(1);
    const overlay = page.getByTestId('mindmap-semantic-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-semantic-kind="zone"]')).toHaveCount(1);
    await expect(overlay.locator('[data-semantic-kind="boundary"]')).toHaveCount(1);
    await expect(overlay.locator('[data-semantic-kind="summary"]')).toHaveCount(1);
    await expect(overlay.locator('[data-semantic-kind="callout"]')).toHaveCount(1);
    const relationships = overlay.locator('[data-semantic-kind="relationship"]');
    expect(await relationships.count()).toBeGreaterThan(0);
    await expect(relationships.first().locator(':scope > path')).toHaveAttribute(
      'marker-end',
      /url\(#mindmap-relationship-.+-end\)/,
    );
    await expect(overlay.getByText('必须通过键盘和读屏验收')).toBeVisible();
    await expect(overlay.getByText('依赖')).toBeVisible();
    await expect(overlay.getByText('待讨论')).toBeVisible();

    const callout = overlay.locator('[data-semantic-kind="callout"] rect');
    await expect(callout).toHaveAttribute('fill', '#FFFBEB');
    await callout.click();
    await expect(overlay.locator('[data-semantic-kind="callout"]')).toHaveAttribute(
      'data-selected',
      'true',
    );
    await callout.click({ button: 'right' });
    const semanticMenu = page.getByTestId('mindmap-context-menu');
    await expect(semanticMenu).toBeVisible();
    await expect(semanticMenu).toHaveAttribute('data-target-kind', 'callout');
    await expect(semanticMenu.locator('[data-action="open-format"]')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    await page.keyboard.press('Escape');
  });

  // @covers ACC-SEM-025
  test('creates cross-branch Summaries atomically and rejects illegal Summary scopes', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '分支 1.1').click();
    await topicButton(page, '分支 2.1').click({ modifiers: ['Control'] });
    await enterMindMapWorkspace(page);

    const summaryPreview = page.getByTestId('mindmap-summary-preview');
    await expect(summaryPreview).toHaveText('将因跨分支拆分为 2 个概要。');
    const createSummary = page.getByTestId('mindmap-create-summary');
    await expect(createSummary).toBeEnabled();
    await createSummary.click();

    const summaryOverlays = page.getByTestId('mindmap-semantic-overlay')
      .locator('[data-semantic-kind="summary"]');
    await expect(summaryOverlays).toHaveCount(2);
    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document).map((summary) => summary.id) : [];
    }).toHaveLength(2);
    const afterCreate = await canonicalData(page);
    expect(afterCreate).not.toBeNull();
    const createdIds = canonicalSummaries(afterCreate!).map((summary) => summary.id);
    const sheet = firstCanonicalSheet(afterCreate!);
    const topicMap = sheet?.topics as Record<string, Record<string, unknown>>;
    const treeEdges = Object.values(
      (sheet?.treeEdges ?? {}) as Record<string, Record<string, unknown>>,
    );
    for (const summary of canonicalSummaries(afterCreate!)) {
      expect(summary.scope).toMatchObject({ kind: 'sibling-range' });
      expect(typeof summary.resultTopicId).toBe('string');
      expect(topicMap[String(summary.resultTopicId)]?.role).toBe('summary-result');
      expect(treeEdges.some((edge) => edge.childTopicId === summary.resultTopicId)).toBe(false);
    }

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(summaryOverlays).toHaveCount(0);
    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document) : [];
    }).toHaveLength(0);

    await page.keyboard.press('Control+y');
    await expect(summaryOverlays).toHaveCount(2);
    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document).map((summary) => summary.id) : [];
    }).toEqual(createdIds);

    await topicButton(page, '创业模拟器').click();
    await expect(summaryPreview).toHaveText('中心主题和概要结果主题不能加入概要范围。');
    await expect(createSummary).toBeDisabled();
    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document).map((summary) => summary.id) : [];
    }).toEqual(createdIds);
  });

  // Evidence for ACC-SEM-010: continuous sibling range and editable result subtree.
  // Evidence for ACC-SEM-011: range handles, style, history, read-only, and view reload.
  test('edits a ranged Summary through bracket handles, result content, style, and read-only reload', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await expect(topicButton(page, '分支 1.1')).toBeVisible();
    const initialRaw = await mindMapData(page);
    expect(initialRaw).not.toBeNull();
    expect(typeof initialRaw).toBe('object');
    const initial = initialRaw as Record<string, unknown>;
    const incoming11 = canonicalIncomingEdgeByTitle(initial, '分支 1.1');
    const incoming12 = canonicalIncomingEdgeByTitle(initial, '分支 1.2');
    expect(incoming11).toBeDefined();
    expect(incoming12).toBeDefined();

    await topicButton(page, '分支 1.1').click();
    await topicButton(page, '分支 1.2').click({ modifiers: ['Control'] });
    await enterMindMapWorkspace(page);
    await page.getByTestId('mindmap-create-summary').click();

    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document).length : 0;
    }).toBe(1);
    const created = await canonicalData(page);
    expect(created).not.toBeNull();
    const summary = canonicalSummaries(created!)[0];
    const summaryId = summary.id;
    const resultTopicId = String(summary.resultTopicId);
    const parentTopicId = String(incoming11![1].parentTopicId);
    expect(summary.scope).toEqual({
      kind: 'sibling-range',
      parentTopicId,
      firstEdgeId: incoming11![0],
      lastEdgeId: incoming12![0],
      includeDescendants: true,
    });

    const summaryOverlay = page.getByTestId('mindmap-semantic-overlay').locator(
      `[data-semantic-kind="summary"][data-entity-id="${summaryId}"]`,
    );
    const bracket = summaryOverlay.locator('[data-summary-part="bracket"]');
    await bracket.focus();
    await bracket.press('Enter');
    await expect(summaryOverlay).toHaveAttribute('data-selected', 'true');

    const dragHandleToTopicCenter = async (
      endpoint: 'start' | 'end',
      topicTitle: string,
    ): Promise<void> => {
      const handle = page.getByTestId(`mindmap-summary-range-handle-${endpoint}-${summaryId}`);
      const handleBox = await handle.boundingBox();
      const targetBox = await topicNode(page, topicTitle).boundingBox();
      expect(handleBox).not.toBeNull();
      expect(targetBox).not.toBeNull();
      await page.mouse.move(
        handleBox!.x + handleBox!.width / 2,
        handleBox!.y + handleBox!.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
    };
    const summaryScope = async () => {
      const document = await canonicalData(page);
      return document
        ? canonicalSummaries(document).find((candidate) => candidate.id === summaryId)?.scope
        : undefined;
    };

    await dragHandleToTopicCenter('start', '分支 1.2');
    await expect.poll(summaryScope).toEqual({
      kind: 'sibling-range',
      parentTopicId,
      firstEdgeId: incoming12![0],
      lastEdgeId: incoming12![0],
      includeDescendants: true,
    });
    await dragHandleToTopicCenter('start', '分支 1.1');
    await expect.poll(summaryScope).toMatchObject({
      firstEdgeId: incoming11![0],
      lastEdgeId: incoming12![0],
    });
    await dragHandleToTopicCenter('end', '分支 1.1');
    await expect.poll(summaryScope).toMatchObject({
      firstEdgeId: incoming11![0],
      lastEdgeId: incoming11![0],
    });
    await dragHandleToTopicCenter('end', '分支 1.2');
    await expect.poll(summaryScope).toMatchObject({
      firstEdgeId: incoming11![0],
      lastEdgeId: incoming12![0],
    });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(summaryScope).toMatchObject({ lastEdgeId: incoming11![0] });
    await page.keyboard.press('Control+y');
    await expect.poll(summaryScope).toMatchObject({ lastEdgeId: incoming12![0] });

    const properties = page.getByTestId('mindmap-semantic-properties');
    await properties.getByRole('button', { name: '编辑概要内容' }).click();
    const resultContent = properties.getByLabel('编辑概要内容');
    await resultContent.fill('发布决策');
    await resultContent.press('Enter');
    await properties.getByLabel('概要方向', { exact: true }).selectOption('left');
    await properties.getByLabel('概要线颜色', { exact: true }).fill('#7C3AED');
    await properties.getByLabel('概要线粗细', { exact: true }).fill('5');
    await properties.getByLabel('概要线粗细', { exact: true }).press('Enter');
    await properties.getByLabel('概要线型', { exact: true }).selectOption('dashed');

    await expect.poll(async () => {
      const document = await canonicalData(page);
      if (!document) return null;
      const currentSummary = canonicalSummaries(document)
        .find((candidate) => candidate.id === summaryId);
      const resultTopic = (firstCanonicalSheet(document)?.topics as
        Record<string, Record<string, unknown>> | undefined)?.[resultTopicId];
      return currentSummary && resultTopic ? {
        orientation: currentSummary.orientation,
        resultTitle: richTextTitle(resultTopic.title),
        style: currentSummary.style,
      } : null;
    }).toEqual({
      orientation: 'left',
      resultTitle: '发布决策',
      style: {
        overrides: {
          border: {
            color: { kind: 'literal', value: '#7C3AED' },
            width: 5,
            dash: [6, 4],
          },
        },
      },
    });
    await expect(summaryOverlay).toHaveAttribute('data-summary-orientation', 'left');
    await expect(bracket).toHaveAttribute('stroke', '#7C3AED');
    await expect(bracket).toHaveAttribute('stroke-dasharray', '6 4');

    await topicButtonById(page, resultTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Tab');
    const childTitle = page.getByLabel('编辑主题标题');
    await expect(childTitle).toBeVisible();
    await childTitle.fill('概要后续行动');
    await childTitle.press('Enter');
    await expect(topicButton(page, '概要后续行动')).toBeVisible();
    await expect.poll(async () => {
      const document = await canonicalData(page);
      const child = document ? canonicalTopicByTitle(document, '概要后续行动') : undefined;
      const incoming = child && document
        ? canonicalIncomingEdgeByTitle(document, '概要后续行动')
        : undefined;
      return child && incoming ? {
        childRole: child[1].role,
        parentTopicId: incoming[1].parentTopicId,
      } : null;
    }).toEqual({ childRole: 'regular', parentTopicId: resultTopicId });

    await bracket.focus();
    await bracket.press('Enter');
    await expect(page.getByTestId(`mindmap-summary-range-handle-start-${summaryId}`))
      .toBeVisible();
    await page.getByTestId('editor-flush').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId('editor-flush-state')).toHaveText('done');
    const flushed = await canonicalData(page);
    expect(flushed).not.toBeNull();

    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await expect(page.getByTestId(`mindmap-summary-range-handle-start-${summaryId}`))
      .toHaveCount(0);
    await expect(page.getByTestId(`mindmap-summary-range-handle-end-${summaryId}`))
      .toHaveCount(0);
    await expect(properties.getByRole('button', { name: '编辑概要内容' })).toBeDisabled();
    await expect(properties.getByLabel('概要方向', { exact: true })).toBeDisabled();
    await expect(properties.getByLabel('概要线颜色', { exact: true })).toBeDisabled();
    await expect(properties.getByLabel('概要线粗细', { exact: true })).toBeDisabled();
    await expect(properties.getByLabel('概要线型', { exact: true })).toBeDisabled();
    expect(await canonicalData(page)).toEqual(flushed);

    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'false');
    await expect.poll(async () => canonicalData(page)).toEqual(flushed);
    await expect(topicButton(page, '发布决策')).toBeVisible();
    await expect(topicButton(page, '概要后续行动')).toBeVisible();
  });

  // Evidence for ACC-SEM-039: public Summary delete routes and result-subtree cascade.
  test('deletes a Summary result subtree through context-menu and keyboard cascades', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '分支 1.1').click();
    await topicButton(page, '分支 1.2').click({ modifiers: ['Control'] });
    await enterMindMapWorkspace(page);
    await page.getByTestId('mindmap-create-summary').click();

    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalSummaries(document).length : 0;
    }).toBe(1);
    const created = await canonicalData(page);
    expect(created).not.toBeNull();
    const summaryId = canonicalSummaries(created!)[0].id;
    const resultTopicId = String(canonicalSummaries(created!)[0].resultTopicId);
    const properties = page.getByTestId('mindmap-semantic-properties');
    await properties.getByRole('button', { name: '编辑概要内容' }).click();
    const resultContent = properties.getByLabel('编辑概要内容');
    await resultContent.fill('待删除概要结果');
    await resultContent.press('Enter');

    await topicButtonById(page, resultTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Tab');
    const childEditor = page.getByLabel('编辑主题标题');
    await expect(childEditor).toBeVisible();
    await childEditor.fill('待删除结果子主题');
    await childEditor.press('Enter');
    await expect(topicButton(page, '待删除结果子主题')).toBeVisible();

    await expect.poll(async () => {
      const document = await canonicalData(page);
      return document ? canonicalTopicByTitle(document, '待删除结果子主题')?.[0] : undefined;
    }).toEqual(expect.any(String));

    const beforeDelete = await canonicalData(page);
    expect(beforeDelete).not.toBeNull();
    const sheetBefore = firstCanonicalSheet(beforeDelete!);
    const summariesBefore = sheetBefore?.summaries as Record<string, Record<string, unknown>>;
    const topicsBefore = sheetBefore?.topics as Record<string, Record<string, unknown>>;
    const edgesBefore = sheetBefore?.treeEdges as Record<string, Record<string, unknown>>;
    const childEntry = canonicalTopicByTitle(beforeDelete!, '待删除结果子主题');
    const childIncoming = canonicalIncomingEdgeByTitle(beforeDelete!, '待删除结果子主题');
    expect(childEntry).toBeDefined();
    expect(childIncoming).toBeDefined();
    const childTopicId = childEntry![0];
    const childEdgeId = childIncoming![0];
    const restoredCascade = {
      summary: structuredClone(summariesBefore[summaryId]),
      resultTopic: structuredClone(topicsBefore[resultTopicId]),
      childTopic: structuredClone(topicsBefore[childTopicId]),
      childEdge: structuredClone(edgesBefore[childEdgeId]),
    };
    const cascadeState = async () => {
      const document = await canonicalData(page);
      const sheet = document ? firstCanonicalSheet(document) : undefined;
      const summaries = sheet?.summaries as Record<string, Record<string, unknown>> | undefined;
      const topicsValue = sheet?.topics as Record<string, Record<string, unknown>> | undefined;
      const edges = sheet?.treeEdges as Record<string, Record<string, unknown>> | undefined;
      return {
        summary: summaries?.[summaryId] ?? null,
        resultTopic: topicsValue?.[resultTopicId] ?? null,
        childTopic: topicsValue?.[childTopicId] ?? null,
        childEdge: edges?.[childEdgeId] ?? null,
      };
    };
    const deletedCascade = {
      summary: null,
      resultTopic: null,
      childTopic: null,
      childEdge: null,
    };

    const summaryOverlay = page.getByTestId('mindmap-semantic-overlay').locator(
      `[data-semantic-kind="summary"][data-entity-id="${summaryId}"]`,
    );
    const bracket = summaryOverlay.locator('[data-summary-part="bracket"]');
    const connector = summaryOverlay.locator('[data-summary-part="connector"]');
    const rightClickPath = async (path: typeof bracket): Promise<void> => {
      const point = await path.evaluate((element: SVGGeometryElement) => {
        const local = element.getPointAtLength(element.getTotalLength() / 2);
        const matrix = element.getScreenCTM();
        if (!matrix) throw new Error('Summary path has no screen transform.');
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.click(point.x, point.y, { button: 'right' });
    };

    await rightClickPath(bracket);
    const menu = page.getByTestId('mindmap-context-menu');
    await expect(menu).toHaveAttribute('data-target-kind', 'summary');
    const deleteAction = menu.locator('[data-action="delete-element"]');
    await expect(deleteAction).toHaveAttribute('aria-disabled', 'false');
    await expect(deleteAction).toHaveText(/删除/);
    await page.mouse.click(1, 1);
    await expect(menu).toHaveCount(0);
    await expect(summaryOverlay).toHaveAttribute('data-selected', 'true');
    const directDelete = page.getByTestId(`mindmap-summary-delete-${summaryId}`);
    await expect(directDelete).toBeVisible();
    await directDelete.click();
    await expect.poll(cascadeState).toEqual(deletedCascade);
    await expect(summaryOverlay).toHaveCount(0);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(cascadeState).toEqual(restoredCascade);
    await expect(summaryOverlay).toHaveCount(1);
    await page.keyboard.press('Control+y');
    await expect.poll(cascadeState).toEqual(deletedCascade);

    await page.keyboard.press('Control+z');
    await expect.poll(cascadeState).toEqual(restoredCascade);
    await bracket.focus();
    await bracket.press('Enter');
    await expect(summaryOverlay).toHaveAttribute('data-selected', 'true');
    await canvas(page).focus();
    await page.keyboard.press('Delete');
    await expect.poll(cascadeState).toEqual(deletedCascade);

    await page.keyboard.press('Control+z');
    await expect.poll(cascadeState).toEqual(restoredCascade);
    await bracket.focus();
    await bracket.press('Enter');
    await exitMindMapWorkspace(page);
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await rightClickPath(connector);
    await expect(menu).toHaveAttribute('data-target-kind', 'summary');
    await expect(deleteAction).toBeVisible();
    await expect(deleteAction).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(cascadeState).toEqual(restoredCascade);
  });

  test('formats a mixed topic selection as one persisted undo unit', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await enterMindMapWorkspace(page);
    await topicButton(page, '主主题 1').click();
    await topicButton(page, '主主题 2').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('mindmap-format-panel')).toHaveAttribute(
      'data-selection-kind',
      'node',
    );
    await page.getByRole('button', { name: /格式 已选 2 项/ }).click();

    const fillColor = page.getByLabel('填充色', { exact: true });
    await fillColor.fill('#22C55E');
    const firstStyledTopic = topicCard(page, '主主题 1');
    const secondStyledTopic = topicCard(page, '主主题 2');
    await expect(firstStyledTopic).toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect(secondStyledTopic).toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicFillColorCount(persisted, '#22C55E') : 0;
    }).toBe(2);

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(firstStyledTopic).not.toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect(secondStyledTopic).not.toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicFillColorCount(persisted, '#22C55E') : -1;
    }).toBe(0);
    await page.keyboard.press('Control+y');
    await expect(firstStyledTopic).toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect(secondStyledTopic).toHaveCSS('background-color', 'rgb(34, 197, 94)');
  });

  test('system clipboard preserves a subtree across remount, cut, paste, and one-step undo', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:5173',
    });
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    const fixture = canonicalFixtureBranch(await mindMapData(page));
    const initialCount = fixture.initialTopicIds.length;
    expect(fixture.subtreeTopicCount).toBeGreaterThan(1);

    await topicButtonById(page, fixture.sourceTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Control+c');

    await page.reload();
    await expect(topics(page)).toHaveCount(initialCount);
    await topicButtonById(page, fixture.rootTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Control+v');
    await expect(topics(page)).toHaveCount(initialCount + fixture.subtreeTopicCount);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicCountInCanonicalData(persisted) : null;
    }).toBe(initialCount + fixture.subtreeTopicCount);
    const pasted = await canonicalData(page);
    expect(pasted).not.toBeNull();
    const pastedIds = topicIdsInCanonicalData(pasted!);
    expect(new Set(pastedIds).size).toBe(pastedIds.length);
    expect(pastedIds.filter((id) => !fixture.initialTopicIds.includes(id))).toHaveLength(
      fixture.subtreeTopicCount,
    );

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(initialCount);

    await topicButtonById(page, fixture.sourceTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Control+x');
    await expect(topics(page)).toHaveCount(initialCount - fixture.subtreeTopicCount);
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(initialCount);
    await page.keyboard.press('Control+v');
    await expect(topics(page)).toHaveCount(initialCount + fixture.subtreeTopicCount);
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(initialCount);
  });

  test('plain-text clipboard falls back to one topic and read-only paste does not write', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:5173',
    });
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    const fixture = canonicalFixtureBranch(await mindMapData(page));
    await page.evaluate(() => navigator.clipboard.writeText('- External clipboard topic'));
    await topicButtonById(page, fixture.rootTopicId).click();
    await canvas(page).focus();
    await page.keyboard.press('Control+v');
    await expect(topics(page)).toHaveCount(fixture.initialTopicIds.length + 1);
    await expect(topicButton(page, 'External clipboard topic')).toBeVisible();

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(fixture.initialTopicIds.length);
    await expect.poll(async () => {
      const persisted = await canonicalData(page);
      return persisted ? topicCountInCanonicalData(persisted) : null;
    }).toBe(fixture.initialTopicIds.length);

    await page.evaluate(() => navigator.clipboard.writeText('Context menu clipboard topic'));
    await topicButtonById(page, fixture.rootTopicId).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '粘贴' }).click();
    await expect(topicButton(page, 'Context menu clipboard topic')).toBeVisible();
    await expect(topics(page)).toHaveCount(fixture.initialTopicIds.length + 1);
    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(topics(page)).toHaveCount(fixture.initialTopicIds.length);

    await page.getByTestId('mode-read').click();
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    const beforeReadOnlyPaste = await mindMapData(page);
    await page.evaluate(() => navigator.clipboard.writeText('Must not be pasted'));
    await canvas(page).focus();
    await page.keyboard.press('Control+v');
    await expect(topics(page)).toHaveCount(fixture.initialTopicIds.length);
    expect(await mindMapData(page)).toEqual(beforeReadOnlyPaste);
  });

  // Evidence: Local Image toolbar/drop ingest, canonical controls, history, and mode stability.
  test('inserts and edits a canonical Local Image through real image controls', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    const targetTitle = '主主题 1';
    const target = topicNode(page, targetTitle);
    const targetButton = topicButton(page, targetTitle);
    const initialBounds = await target.evaluate((element: HTMLElement) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    }));

    const pngBase64 = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 200;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable.');
      context.fillStyle = '#2563eb';
      context.fillRect(0, 0, 300, 200);
      context.fillStyle = '#ffffff';
      context.font = 'bold 32px sans-serif';
      context.fillText('Local Image', 48, 112);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('PNG encode failed.')),
        'image/png',
      ));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    const png = Buffer.from(pngBase64, 'base64');
    const assetUrl = 'https://assets.example.test/mindmap-local-image.png';
    await page.route('**/api/upload?kind=image', async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: assetUrl,
          fileName: 'road map.png',
          mimeType: 'image/png',
          byteSize: png.byteLength,
          sha256: 'b'.repeat(64),
        }),
      });
    });
    await page.route(assetUrl, route => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: png,
    }));

    const localImageState = async () => {
      const document = await canonicalData(page);
      const sheet = document ? firstCanonicalSheet(document) : undefined;
      const images = sheet?.images;
      const assets = document?.assets;
      return {
        images: images && typeof images === 'object' && !Array.isArray(images)
          ? images as Record<string, Record<string, unknown>>
          : {},
        assets: assets && typeof assets === 'object' && !Array.isArray(assets)
          ? assets as Record<string, Record<string, unknown>>
          : {},
      };
    };

    await targetButton.click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('mindmap-insert-local-image').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'road map.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('mindmap-status')).toHaveText('已添加本地图片。');

    const created = await expect.poll(async () => {
      const state = await localImageState();
      const entry = Object.entries(state.images).find(([, image]) =>
        image.alt === 'road map.png');
      if (!entry) return null;
      const [imageId, image] = entry;
      const assetId = String(image.assetId);
      const asset = state.assets[assetId];
      return asset ? { imageId, assetId, image, asset } : null;
    }).not.toBeNull();
    void created;
    const stateAfterCreate = await localImageState();
    const [imageId, image] = Object.entries(stateAfterCreate.images).find(([, candidate]) =>
      candidate.alt === 'road map.png')!;
    const assetId = String(image.assetId);
    expect(image).toMatchObject({
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 300, height: 200 },
      alt: 'road map.png',
    });
    expect(stateAfterCreate.assets[assetId]).toMatchObject({
      fileName: 'road map.png',
      mimeType: 'image/png',
      source: { kind: 'remote', url: assetUrl },
      intrinsicSize: { width: 300, height: 200 },
    });

    const imageButton = page.getByTestId(`topic-image-${imageId}`);
    const imageFrame = page.getByTestId(`topic-image-frame-${imageId}`);
    await expect(imageButton).toBeVisible();
    await expect(imageFrame).toHaveAttribute('data-topic-image-preview-width', '300');
    await expect(target.locator('[data-topic-enrichment-kind="image"]')).toHaveCount(0);
    const enlargedBounds = await target.evaluate((element: HTMLElement) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    }));
    expect(enlargedBounds.width).toBeGreaterThan(initialBounds.width + 100);
    expect(enlargedBounds.height).toBeGreaterThan(initialBounds.height + 150);

    const dropTarget = target.locator('[data-entity-id]').first();
    const dropTargetSize = await dropTarget.boundingBox();
    expect(dropTargetSize).not.toBeNull();
    await imageButton.dragTo(dropTarget, {
      targetPosition: {
        x: dropTargetSize!.width / 2,
        y: Math.floor(dropTargetSize!.height * 0.65),
      },
    });
    await expect.poll(async () => (await localImageState()).images[imageId]?.placement)
      .toMatchObject({ side: 'bottom' });
    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await localImageState()).images[imageId]?.placement)
      .toMatchObject({ side: 'top' });

    // The button remains the keyboard-accessible alternative after drag undo.
    await page.getByRole('button', { name: '将图片移到主题下方' }).click();
    await expect(page.getByTestId(`topic-image-${imageId}`)).toHaveAttribute(
      'data-topic-image-side',
      'bottom',
    );
    await expect.poll(async () => (await localImageState()).images[imageId]?.placement)
      .toMatchObject({ side: 'bottom' });
    const beforeSameSideDrop = await canonicalData(page);
    await page.getByTestId(`topic-image-${imageId}`).dragTo(dropTarget, {
      targetPosition: {
        x: dropTargetSize!.width / 2,
        y: Math.floor(dropTargetSize!.height * 0.65),
      },
    });
    await page.waitForTimeout(250);
    expect(await canonicalData(page)).toEqual(beforeSameSideDrop);

    const resizeHandle = page.getByTestId(`topic-image-resize-handle-${imageId}`);
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 70, handleBox!.y + 50, { steps: 4 });
    await page.mouse.up();
    const resizedSize = await expect.poll(async () =>
      (await localImageState()).images[imageId]?.size).not.toEqual({ width: 300, height: 200 });
    void resizedSize;
    const canonicalResizedSize = (await localImageState()).images[imageId].size;
    expect(canonicalResizedSize).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await localImageState()).images[imageId]?.size)
      .toEqual({ width: 300, height: 200 });
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await localImageState()).images[imageId]?.size)
      .toEqual(canonicalResizedSize);

    await page.getByTestId(`topic-image-${imageId}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重置图片尺寸' }).click();
    await expect.poll(async () => (await localImageState()).images[imageId]?.size)
      .toEqual({ width: 300, height: 200 });

    await page.getByTestId(`topic-image-${imageId}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除图片' }).click();
    await expect.poll(async () => {
      const current = await localImageState();
      return { image: current.images[imageId] ?? null, asset: current.assets[assetId] ?? null };
    }).toEqual({ image: null, asset: null });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Boolean((await localImageState()).images[imageId])).toBe(true);
    await page.getByTestId(`topic-image-${imageId}`).click();
    await canvas(page).focus();
    await page.keyboard.press('Delete');
    await expect.poll(async () => Boolean((await localImageState()).images[imageId])).toBe(false);

    await dropTarget.evaluate((element, base64) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-road-map.png', { type: 'image/png' }));
      element.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
      element.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, pngBase64);
    await expect(page.getByTestId('mindmap-status')).toHaveText('已添加本地图片。');
    const droppedImageId = await expect.poll(async () => {
      const images = (await localImageState()).images;
      return Object.entries(images).find(([, candidate]) =>
        candidate.alt === 'dropped-road-map.png')?.[0] ?? null;
    }).not.toBeNull();
    void droppedImageId;
    const droppedEntry = Object.entries((await localImageState()).images).find(([, candidate]) =>
      candidate.alt === 'dropped-road-map.png');
    expect(droppedEntry).toBeDefined();
    const finalImageId = droppedEntry![0];
    await page.getByTestId(`topic-image-${finalImageId}`).click();
    await page.getByTestId('editor-flush').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId('editor-flush-state')).toHaveText('done');
    const flushed = await canonicalData(page);
    expect(flushed).not.toBeNull();

    await page.getByTestId('mode-read').click();
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await expect(page.getByTestId(`topic-image-${finalImageId}`)).toBeVisible();
    await expect(page.getByTestId(`topic-image-${finalImageId}`)).toHaveAttribute(
      'draggable',
      'false',
    );
    await expect(page.getByTestId(`topic-image-controls-${finalImageId}`)).toHaveCount(0);
    await expect(page.getByTestId(`topic-image-resize-handle-${finalImageId}`)).toHaveCount(0);
    await expect(page.getByTestId('mindmap-insert-local-image')).toBeDisabled();
    await page.getByTestId(`topic-image-${finalImageId}`).click({ button: 'right' });
    await expect(page.getByTestId('topic-image-context-menu')).toHaveCount(0);

    await dropTarget.evaluate((element, payload) => {
      const transfer = new DataTransfer();
      transfer.setData(payload.mime, payload.imageId);
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientY: bounds.bottom - 1,
        dataTransfer: transfer,
      }));
      element.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientY: bounds.bottom - 1,
        dataTransfer: transfer,
      }));
    }, {
      mime: 'application/x-nmdd-mindmap-topic-image',
      imageId: finalImageId,
    });
    await page.waitForTimeout(250);
    expect(await canonicalData(page)).toEqual(flushed);

    await dropTarget.evaluate((element, base64) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'blocked.png', { type: 'image/png' }));
      element.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }, pngBase64);
    await expect(page.getByTestId('mindmap-status')).toHaveText('只读模式不能添加图片。');
    expect(await canonicalData(page)).toEqual(flushed);

    await page.getByTestId('mode-edit').click();
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'false');
    await expect.poll(async () => canonicalData(page)).toEqual(flushed);
    await expect(page.getByTestId(`topic-image-${finalImageId}`)).toBeVisible();
  });

  // Evidence: first-party Sticker catalog, managed Asset, four-way placement, history, and read-only.
  test('inserts and edits an original managed Sticker through the catalog', async ({ page }) => {
    test.setTimeout(90_000);
    const stickerBytes = await readFile(new URL('../public/mindmap/stickers/lightbulb-84.png', import.meta.url));
    const sha256 = createHash('sha256').update(stickerBytes).digest('hex');
    const objectKey = `mindmap-images/sha256/${sha256}.png`;
    let uploadCount = 0;

    await page.route('**/api/upload?kind=image', async (route) => {
      uploadCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `/api/mindmap/image-assets/${sha256}.png`,
          objectKey,
          fileName: 'nmdd-idea-lightbulb.png',
          mimeType: 'image/png',
          byteSize: stickerBytes.byteLength,
          sha256,
        }),
      });
    });
    await page.route(`**/api/mindmap/image-assets/${sha256}.png`, route => route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'content-length': String(stickerBytes.byteLength) },
      body: stickerBytes,
    }));

    await page.goto('/editor-lab?fixture=mindmap-v1-small');
    await topicButton(page, '主主题 1').click();
    await enterMindMapWorkspace(page);
    await page.getByTestId('mindmap-open-sticker-catalog').click();
    const catalog = page.getByTestId('mindmap-sticker-catalog');
    await expect(catalog).toContainText('468 项许可素材 · 13 类 · 同源安全导出');
    await expect(catalog).toHaveAttribute('data-catalog-result-count', '468');
    await catalog.getByRole('searchbox', { name: '搜索贴纸与插画' }).fill('火箭');
    await expect(catalog).toHaveAttribute('data-catalog-result-count', '1');
    await expect(catalog.getByRole('button', { name: '插入插画：火箭' })).toBeVisible();
    await catalog.getByRole('button', { name: '清除贴纸搜索' }).click();
    await catalog.getByRole('combobox', { name: '筛选素材分类' }).selectOption('ideas');
    await expect(catalog).toHaveAttribute('data-catalog-result-count', '36');
    await catalog.getByRole('combobox', { name: '筛选素材分类' }).selectOption('all');
    await catalog.getByRole('button', { name: '插入贴纸：灵感灯泡' }).click();
    await expect(page.getByTestId('mindmap-status')).toHaveText('已添加贴纸。');
    expect(uploadCount).toBe(1);
    await catalog.getByRole('button', { name: '最近 1' }).click();
    await expect(catalog).toHaveAttribute('data-catalog-result-count', '1');

    const stickerState = async () => {
      const document = await canonicalData(page);
      const sheet = document ? firstCanonicalSheet(document) : undefined;
      const images = sheet?.images && typeof sheet.images === 'object' && !Array.isArray(sheet.images)
        ? sheet.images as Record<string, Record<string, unknown>>
        : {};
      const assets = document?.assets && typeof document.assets === 'object' && !Array.isArray(document.assets)
        ? document.assets as Record<string, Record<string, unknown>>
        : {};
      const entry = Object.entries(images).find(([, image]) => image.role === 'sticker');
      return entry
        ? { imageId: entry[0], image: entry[1], asset: assets[String(entry[1].assetId)] }
        : null;
    };
    const created = await expect.poll(stickerState).not.toBeNull();
    void created;
    const initial = await stickerState();
    expect(initial).not.toBeNull();
    const stickerId = initial!.imageId;
    expect(initial!.image).toMatchObject({
      role: 'sticker',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
      size: { width: 84, height: 84 },
      alt: '灵感灯泡',
    });
    expect(initial!.asset).toMatchObject({
      source: { kind: 'managed', objectKey },
      intrinsicSize: { width: 84, height: 84 },
      sha256,
    });
    await expect(page.getByTestId(`topic-image-${stickerId}`)).toHaveAttribute(
      'data-topic-image-role',
      'sticker',
    );

    await catalog.getByRole('button', { name: '关闭贴纸与插画' }).click();
    await page.getByTestId(`topic-image-${stickerId}`).click();
    await page.getByRole('button', { name: '将贴纸移到主题右侧' }).click();
    await expect(page.getByTestId(`topic-image-${stickerId}`)).toHaveAttribute(
      'data-topic-image-side',
      'right',
    );
    await expect.poll(async () => (await stickerState())?.image.placement)
      .toMatchObject({ side: 'right' });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await stickerState())?.image.placement)
      .toMatchObject({ side: 'top' });
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await stickerState())?.image.placement)
      .toMatchObject({ side: 'right' });
    expect(uploadCount).toBe(1);

    await page.getByTestId(`topic-image-${stickerId}`).click();
    await page.getByTestId(`topic-image-${stickerId}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重置贴纸尺寸' }).click();
    await expect.poll(async () => (await stickerState())?.image.size)
      .toEqual({ width: 84, height: 84 });

    await topicButton(page, '主主题 1').dblclick();
    const exportFontEditor = page.getByLabel('编辑主题标题');
    await exportFontEditor.fill('A中');
    await exportFontEditor.press('Control+a');
    const exportFontToolbar = page.getByRole('toolbar', { name: '主题文本格式' });
    await exportFontToolbar.getByRole('button', { name: '斜体', exact: true }).click();
    await exportFontEditor.press('Enter');
    await expect(topicButton(page, 'A中')).toBeVisible();

    await topicButton(page, '主主题 2').dblclick();
    const exportCodeEditor = page.getByLabel('编辑主题标题');
    await exportCodeEditor.fill('Code');
    await exportCodeEditor.press('Control+a');
    await page.getByRole('toolbar', { name: '主题文本格式' })
      .getByRole('button', { name: '行内代码', exact: true })
      .click();
    await exportCodeEditor.press('Enter');
    await expect(topicButton(page, 'Code')).toBeVisible();

    await exitMindMapWorkspace(page);
    await page.getByTestId('mode-read').click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'true');
    await expect(page.getByTestId(`topic-image-${stickerId}`)).toBeVisible();
    await expect(page.getByTestId(`topic-image-${stickerId}`)).toHaveAttribute('draggable', 'false');
    await expect(page.getByTestId(`topic-image-controls-${stickerId}`)).toHaveCount(0);
    await expect(page.getByTestId('mindmap-open-sticker-catalog')).toBeDisabled();
    expect(uploadCount).toBe(1);

    await page.getByRole('button', { name: '打开导入与导出' }).click();
    const exportPanel = page.getByTestId('mindmap-import-export-panel');
    await expect(exportPanel.getByRole('button', { name: '导出 SVG' })).toBeEnabled();
    await expect(exportPanel.getByRole('button', { name: '导出 PNG' })).toBeEnabled();
    await expect(exportPanel.getByRole('button', { name: '导出 JPEG' })).toBeEnabled();
    const doubleScaleRadio = exportPanel.getByRole('radio', { name: '2×' });
    await doubleScaleRadio.check();
    await expect(doubleScaleRadio).toBeChecked();

    const svgDownloadPromise = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: '导出 SVG' }).click();
    const svgDownload = await svgDownloadPromise;
    expect(svgDownload.suggestedFilename()).toBe('Small canonical mind map.svg');
    const svgPath = await svgDownload.path();
    expect(svgPath).toBeTruthy();
    if (!svgPath) throw new Error('SVG download has no local path.');
    const svg = Buffer.from(await readFile(svgPath)).toString('utf8');
    expect(svg).toContain('data-mindmap-static-export="ready"');
    expect(svg).toContain('data-font-policy="pinned-fontsource-noto-common-v2"');
    expect(svg).toContain('data-font-style-policy="explicit-skew-minus-12-v1"');
    expect(svg).toMatch(/data-font-face-count="[1-9][0-9]*"/u);
    expect(svg).toMatch(/data-embedded-font-bytes="[1-9][0-9]*"/u);
    expect(svg).toContain('data:font/woff2;base64,');
    expect(svg).toContain('NMDD Noto Sans Mono Export');
    expect(svg).toContain('font-stretch="extra-condensed"');
    expect(svg).toContain('data-static-italic="skew-minus-12-v1"');
    expect(svg).toContain('skewX(-12)');
    expect(svg).not.toContain('font-style="italic"');
    expect(svg).not.toMatch(/system-ui|ui-monospace|font\/[^"')]*\.woff2|https?:\/\/[^"')]*\.woff2/iu);
    expect(svg).toContain('data-image-role="sticker"');
    expect(svg).toContain('href="data:image/png;base64,');
    const inlinedSticker = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/u);
    expect(inlinedSticker).not.toBeNull();
    expect(Buffer.from(inlinedSticker![1], 'base64').equals(stickerBytes)).toBe(true);
    expect(svg).not.toContain('/api/mindmap');
    expect(svg).not.toContain(objectKey);
    expect(svg).not.toMatch(/<script|javascript:/iu);
    const svgWidth = Number(svg.match(/<svg[^>]*\swidth="([0-9.]+)"/u)?.[1]);
    const svgHeight = Number(svg.match(/<svg[^>]*\sheight="([0-9.]+)"/u)?.[1]);
    const svgViewBox = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/u);
    expect(svgWidth).toBe(Number(svgViewBox?.[1]) * 2);
    expect(svgHeight).toBe(Number(svgViewBox?.[2]) * 2);

    const pngDownloadPromise = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: '导出 PNG' }).click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toBe('Small canonical mind map.png');
    const pngPath = await pngDownload.path();
    expect(pngPath).toBeTruthy();
    if (!pngPath) throw new Error('PNG download has no local path.');
    const png = await readFile(pngPath);
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.readUInt32BE(16)).toBe(svgWidth);
    expect(png.readUInt32BE(20)).toBe(svgHeight);
    expect(uploadCount).toBe(1);

    const jpegDownloadPromise = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: '导出 JPEG' }).click();
    const jpegDownload = await jpegDownloadPromise;
    expect(jpegDownload.suggestedFilename()).toBe('Small canonical mind map.jpg');
    const jpegPath = await jpegDownload.path();
    expect(jpegPath).toBeTruthy();
    if (!jpegPath) throw new Error('JPEG download has no local path.');
    const jpeg = await readFile(jpegPath);
    expect(Array.from(jpeg.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    await expect(exportPanel).toContainText(
      'JPEG 导出完成；透明/画布背景已改为白色不透明背景。',
    );
    expect(uploadCount).toBe(1);

    const xmindDownloadPromise = page.waitForEvent('download');
    await exportPanel.getByRole('button', { name: '导出 XMind' }).click();
    const xmindDownload = await xmindDownloadPromise;
    expect(xmindDownload.suggestedFilename()).toBe('Small canonical mind map.xmind');
    const xmindPath = await xmindDownload.path();
    expect(xmindPath).toBeTruthy();
    if (!xmindPath) throw new Error('Sticker XMind download has no local path.');
    const xmindBytes = await readFile(xmindPath);
    const xmindFiles = unzipSync(new Uint8Array(xmindBytes));
    expect(Buffer.from(xmindFiles[`resources/${sha256}.png`] ?? []).equals(stickerBytes)).toBe(true);
    const metadataText = new TextDecoder().decode(xmindFiles['metadata.json']);
    expect(metadataText).not.toContain(objectKey);
    const metadata = JSON.parse(metadataText) as {
      nmdd: {
        canonicalFallbackRestorable: boolean;
        packagedImageAssets: Record<string, string>;
      };
    };
    expect(metadata.nmdd.canonicalFallbackRestorable).toBe(true);
    expect(Object.values(metadata.nmdd.packagedImageAssets)).toContain(
      `resources/${sha256}.png`,
    );

    await exitMindMapWorkspace(page);
    await page.getByTestId('mode-edit').click();
    await enterMindMapWorkspace(page);
    await expect(canvas(page)).toHaveAttribute('data-read-only', 'false');
    await page.getByRole('button', { name: '打开导入与导出' }).click();
    await expect(exportPanel).toHaveCount(0);
    const editableSticker = page.getByTestId(`topic-image-${stickerId}`);
    await editableSticker.click();
    await editableSticker.press('Delete');
    await expect(page.locator('[data-topic-image-role="sticker"]')).toHaveCount(0);

    uploadCount = 0;
    await page.getByRole('button', { name: '打开导入与导出' }).click();
    const importPanel = page.getByTestId('mindmap-import-export-panel');
    await importPanel.getByLabel('选择 XMind 文件').setInputFiles({
      name: 'managed-sticker.xmind',
      mimeType: 'application/x-xmind',
      buffer: xmindBytes,
    });
    const confirm = page.getByRole('dialog', { name: '应用导入结果？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '应用导入' }).click();
    await expect(page.locator('[data-topic-image-role="sticker"][data-topic-image-source="ready"]'))
      .toHaveCount(1);
    expect(uploadCount).toBe(1);
    await expect.poll(stickerState).toMatchObject({
      imageId: stickerId,
      image: {
        role: 'sticker',
        placement: { side: 'right', align: 'center', offset: { x: 0, y: 0 } },
        size: { width: 84, height: 84 },
        alt: '灵感灯泡',
      },
      asset: { source: { kind: 'managed', objectKey } },
    });

    await canvas(page).focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-topic-image-role="sticker"]')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.locator('[data-topic-image-role="sticker"][data-topic-image-source="ready"]'))
      .toHaveCount(1);
    expect(uploadCount).toBe(1);

    if (await page.getByTestId('mindmap-import-export-panel').count() === 0) {
      await page.getByRole('button', { name: '打开导入与导出' }).click();
    }
    const reexportPanel = page.getByTestId('mindmap-import-export-panel');
    const reexportPromise = page.waitForEvent('download');
    await reexportPanel.getByRole('button', { name: '导出 XMind' }).click();
    const reexport = await reexportPromise;
    const reexportPath = await reexport.path();
    expect(reexportPath).toBeTruthy();
    if (!reexportPath) throw new Error('Re-exported Sticker XMind has no local path.');
    const reexportedFiles = unzipSync(new Uint8Array(await readFile(reexportPath)));
    expect(Buffer.from(reexportedFiles[`resources/${sha256}.png`] ?? []).equals(stickerBytes))
      .toBe(true);
    expect(uploadCount).toBe(1);
  });

  test('mindmapV2=0 routes the node view back to the legacy component', async ({ page }) => {
    await page.goto('/editor-lab?fixture=mindmap-v1-small&mindmapV2=0');
    await expect(page.getByTestId('editor-lab')).toBeVisible();
    await expect(mindMapV2(page)).toHaveCount(0);
    await expect(page.locator('.mind-map-wrapper')).toBeVisible();
    await expect(page.getByTestId('mindmap-v2-canvas')).toHaveCount(0);
  });
});
