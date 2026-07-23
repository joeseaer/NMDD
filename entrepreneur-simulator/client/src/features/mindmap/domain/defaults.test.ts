import { describe, expect, it } from 'vitest';

import {
  LEGACY_V0_DEFAULTS_VERSION,
  NEW_V1_DEFAULTS_VERSION,
  V1_DEFAULTS,
  createEntityAudit,
  createEquation,
  createLegacyV0DefaultSet,
  createNewMindMapDocument,
  createNewV1DefaultSet,
  createPresentationDeck,
  createTopicTask,
  createTopicTodo,
} from './defaults';
import type {
  Id,
  PresentationSlide,
  SlideId,
} from './types';

const asId = <K extends string>(value: string): Id<K> => value as Id<K>;

const IDS = {
  document: asId<'Document'>('018f0000-0000-7000-8000-000000000001'),
  sheet: asId<'Sheet'>('018f0000-0000-7000-8000-000000000002'),
  topic: asId<'Topic'>('018f0000-0000-7000-8000-000000000003'),
  theme: asId<'Theme'>('018f0000-0000-7000-8000-000000000004'),
  actor: asId<'Actor'>('018f0000-0000-7000-8000-000000000005'),
  equation: asId<'Equation'>('018f0000-0000-7000-8000-000000000006'),
  todo: asId<'Todo'>('018f0000-0000-7000-8000-000000000007'),
  task: asId<'Task'>('018f0000-0000-7000-8000-000000000008'),
  presentation: asId<'Presentation'>('018f0000-0000-7000-8000-000000000009'),
};

describe('V1 defaults registry', () => {
  it('freezes registry constants recursively', () => {
    expect(Object.isFrozen(V1_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(V1_DEFAULTS[NEW_V1_DEFAULTS_VERSION])).toBe(true);
    expect(
      Object.isFrozen(
        V1_DEFAULTS[NEW_V1_DEFAULTS_VERSION].sheet.workCalendar.workingWeekdays,
      ),
    ).toBe(true);
  });

  it('separates new-v1 auto layout from legacy-v0 manual layout', () => {
    expect(
      V1_DEFAULTS[NEW_V1_DEFAULTS_VERSION].sheet.defaultBranchLayout.mode,
    ).toBe('auto');
    expect(
      V1_DEFAULTS[LEGACY_V0_DEFAULTS_VERSION].sheet.defaultBranchLayout.mode,
    ).toBe('manual');
  });

  it('returns fresh mutable default graphs on every call', () => {
    const first = createNewV1DefaultSet();
    const second = createNewV1DefaultSet();

    expect(first).not.toBe(second);
    expect(first.workCalendar).not.toBe(second.workCalendar);
    expect(first.workCalendar.workingWeekdays).not.toBe(
      second.workCalendar.workingWeekdays,
    );
    expect(first.topic.title.blocks).not.toBe(second.topic.title.blocks);

    first.workCalendar.workingWeekdays.push(0);
    expect(second.workCalendar.workingWeekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns fresh legacy migration defaults', () => {
    const first = createLegacyV0DefaultSet();
    const second = createLegacyV0DefaultSet();

    expect(first.version).toBe(LEGACY_V0_DEFAULTS_VERSION);
    expect(first.defaultThemeName).toBe('Migration Default');
    expect(first.defaultBranchLayout.mode).toBe('manual');
    expect(first.canvas).not.toBe(second.canvas);
    expect(first.markerLegend.position).not.toBe(second.markerLegend.position);
  });
});

describe('canonical default factories', () => {
  it('creates deterministic audits only from injected values', () => {
    const now = '2026-07-18T12:00:00.000Z';
    expect(createEntityAudit({ now, actorId: IDS.actor })).toEqual({
      createdAt: now,
      createdBy: IDS.actor,
      updatedAt: now,
      updatedBy: IDS.actor,
    });
  });

  it('creates a complete new V1 document with fresh maps', () => {
    const input = {
      documentId: IDS.document,
      sheetId: IDS.sheet,
      rootTopicId: IDS.topic,
      themeId: IDS.theme,
      sheetOrderKey: 'a0',
      title: 'Product map',
      rootTitle: 'Central topic',
    } as const;
    const first = createNewMindMapDocument(input);
    const second = createNewMindMapDocument(input);

    expect(first).toMatchObject({
      schema: 'app.nmdd.mindmap',
      schemaVersion: 1,
      minimumReaderVersion: 1,
      contentRevision: 0,
      id: IDS.document,
      title: 'Product map',
    });
    expect(first.sheets[IDS.sheet].topics[IDS.topic]).toMatchObject({
      id: IDS.topic,
      role: 'central',
      placement: { mode: 'auto' },
      sizing: { width: { mode: 'fit' } },
      defaultCollapsed: false,
    });
    expect(first.themes[IDS.theme].name).toBe('Default');
    expect(first.sheets).not.toBe(second.sheets);
    expect(first.sheets[IDS.sheet].workCalendar).not.toBe(
      second.sheets[IDS.sheet].workCalendar,
    );

    first.sheets[IDS.sheet].workCalendar.workingWeekdays.push(0);
    expect(second.sheets[IDS.sheet].workCalendar.workingWeekdays).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('applies canonical Equation, To-do, and Task defaults', () => {
    expect(
      createEquation({
        id: IDS.equation,
        topicId: IDS.topic,
        orderKey: 'a0',
        source: 'x^2',
      }),
    ).toMatchObject({ syntax: 'latex', display: 'inline', scale: 1 });
    expect(createTopicTodo({ id: IDS.todo, topicId: IDS.topic })).toMatchObject({
      completed: false,
    });
    expect(createTopicTask({ id: IDS.task, topicId: IDS.topic })).toMatchObject({
      status: 'not-started',
      progress: 0,
    });
  });

  it('requires compiler-produced slides and clones the slide map', () => {
    const slides = {} as Record<SlideId, PresentationSlide>;
    const deck = createPresentationDeck({
      id: IDS.presentation,
      sheetId: IDS.sheet,
      slides,
    });

    expect(deck).toMatchObject({
      name: 'Presentation',
      aspectRatio: '16:9',
      settings: {
        generationMode: 'auto',
        delivery: 'walk-through',
        layout: 'auto',
        transition: 'fade',
        animationsEnabled: true,
      },
    });
    expect(deck.slides).not.toBe(slides);
  });
});
