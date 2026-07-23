import { describe, expect, it } from 'vitest';

import { createNewMindMapDocument } from '../domain/defaults';
import type {
  DocumentId,
  MindMapDocumentV1,
  SheetId,
  StyleId,
  StyleProperties,
  ThemeId,
  ThemeRuleId,
  TopicId,
} from '../domain/types';
import {
  resolveConnectorStyle,
  resolveTopicStyle,
} from './resolver';

const IDS = {
  document: 'document-style' as DocumentId,
  sheet: 'sheet-style' as SheetId,
  theme: 'theme-style' as ThemeId,
  topic: 'topic-style' as TopicId,
  parentStyle: 'style-parent' as StyleId,
  childStyle: 'style-child' as StyleId,
  cycleA: 'style-cycle-a' as StyleId,
  cycleB: 'style-cycle-b' as StyleId,
  missingBase: 'style-missing-base' as StyleId,
  missing: 'style-does-not-exist' as StyleId,
  connectorBase: 'style-connector-base' as StyleId,
  connector: 'style-connector' as StyleId,
  ruleGeneric: 'rule-generic' as ThemeRuleId,
  ruleRole: 'rule-role' as ThemeRuleId,
  ruleLevel: 'rule-level' as ThemeRuleId,
  ruleSide: 'rule-side' as ThemeRuleId,
  ruleMiss: 'rule-miss' as ThemeRuleId,
  connectorRule: 'rule-connector' as ThemeRuleId,
};

const literal = (value: string) => ({ kind: 'literal' as const, value });
const token = (name: string) => ({ kind: 'token' as const, token: name });

const makeDocument = (): MindMapDocumentV1 => createNewMindMapDocument({
  documentId: IDS.document,
  sheetId: IDS.sheet,
  rootTopicId: IDS.topic,
  themeId: IDS.theme,
  sheetOrderKey: 'sheet-a',
});

describe('canonical mind-map style resolver', () => {
  it('cascades skeleton, theme default/rules, inherited named style, then entity overrides', () => {
    const document = makeDocument();
    document.themes[IDS.theme].tokens = { themeFill: '#DBEAFE' };
    document.themes[IDS.theme].defaultStyles.topic = {
      overrides: {
        fill: { color: token('themeFill') },
        border: { radius: 20 },
        typography: { fontFamily: 'Theme Sans', fontSize: 12 },
      },
    };
    document.themes[IDS.theme].rules[IDS.ruleRole] = {
      id: IDS.ruleRole,
      orderKey: 'a',
      selector: { scope: 'topic', topicRole: 'regular' },
      binding: {
        overrides: {
          typography: { italic: true, fontSize: 13 },
          border: { color: literal('#22C55E') },
        },
      },
    };
    document.styles[IDS.parentStyle] = {
      id: IDS.parentStyle,
      name: 'Parent',
      scope: 'topic',
      properties: {
        border: { width: 3 },
        typography: { fontWeight: 600 },
      },
    };
    document.styles[IDS.childStyle] = {
      id: IDS.childStyle,
      name: 'Child',
      scope: 'topic',
      basedOnStyleId: IDS.parentStyle,
      properties: {
        shape: 'pill',
        typography: { fontSize: 15 },
      },
    };

    const resolution = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      level: 2,
      side: 'right',
      structure: 'core:mind-map',
      binding: {
        styleId: IDS.childStyle,
        overrides: {
          opacity: 0,
          fill: { color: literal('#FEF3C7'), opacity: 0.4 },
          typography: { italic: false, underline: true },
        },
      },
    });

    expect(resolution.matchedRuleIds).toEqual([IDS.ruleRole]);
    expect(resolution.appliedStyleIds).toEqual([IDS.parentStyle, IDS.childStyle]);
    expect(resolution.properties).toMatchObject({
      opacity: 0,
      fill: { color: literal('#FEF3C7'), opacity: 0.4 },
      border: { color: literal('#22C55E'), radius: 20, width: 3 },
      shape: 'pill',
      typography: {
        fontFamily: 'Theme Sans',
        fontSize: 15,
        fontWeight: 600,
        italic: false,
        underline: true,
      },
    });
    expect(resolution.visual).toMatchObject({
      backgroundColor: '#FEF3C7',
      borderColor: '#22C55E',
      borderRadius: 20,
      borderWidth: 3,
      fontSize: 15,
      fontWeight: 600,
      opacity: 0,
      textDecoration: 'underline',
    });
    expect(resolution.visual).not.toHaveProperty('fontStyle');
    expect(resolution.diagnostics).toEqual([]);
  });

  it('orders matching rules by specificity, orderKey, and id deterministically', () => {
    const document = makeDocument();
    const theme = document.themes[IDS.theme];
    theme.rules[IDS.ruleGeneric] = {
      id: IDS.ruleGeneric,
      orderKey: 'z',
      selector: { scope: 'topic' },
      binding: { overrides: { fill: { color: literal('#EF4444') } } },
    };
    theme.rules[IDS.ruleRole] = {
      id: IDS.ruleRole,
      orderKey: 'a',
      selector: { scope: 'topic', topicRole: 'regular' },
      binding: { overrides: { fill: { color: literal('#22C55E') } } },
    };
    theme.rules[IDS.ruleLevel] = {
      id: IDS.ruleLevel,
      orderKey: 'b',
      selector: { scope: 'topic', level: 1 },
      binding: { overrides: { fill: { color: literal('#3B82F6') } } },
    };
    theme.rules[IDS.ruleSide] = {
      id: IDS.ruleSide,
      orderKey: 'b',
      selector: { scope: 'topic', side: 'right' },
      binding: { overrides: { fill: { color: literal('#A855F7') } } },
    };
    theme.rules[IDS.ruleMiss] = {
      id: IDS.ruleMiss,
      orderKey: 'zz',
      selector: { scope: 'topic', structure: 'core:org-chart' },
      binding: { overrides: { fill: { color: literal('#000000') } } },
    };

    const input = {
      document,
      themeId: IDS.theme,
      role: 'regular' as const,
      level: 1,
      side: 'right' as const,
      structure: 'core:mind-map' as const,
    };
    const first = resolveTopicStyle(input);
    const second = resolveTopicStyle(input);

    expect(first.matchedRuleIds).toEqual([
      IDS.ruleGeneric,
      IDS.ruleRole,
      IDS.ruleLevel,
      IDS.ruleSide,
    ]);
    expect(first.visual.backgroundColor).toBe('#A855F7');
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.properties.fill)).toBe(true);
  });

  it('breaks inheritance cycles and reports missing named styles without throwing', () => {
    const document = makeDocument();
    document.styles[IDS.cycleA] = {
      id: IDS.cycleA,
      name: 'Cycle A',
      scope: 'topic',
      basedOnStyleId: IDS.cycleB,
      properties: { border: { width: 4 } },
    };
    document.styles[IDS.cycleB] = {
      id: IDS.cycleB,
      name: 'Cycle B',
      scope: 'topic',
      basedOnStyleId: IDS.cycleA,
      properties: { typography: { fontSize: 18 } },
    };
    document.styles[IDS.missingBase] = {
      id: IDS.missingBase,
      name: 'Missing base',
      scope: 'topic',
      basedOnStyleId: IDS.missing,
      properties: { typography: { fontWeight: 800 } },
    };

    const cycle = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      binding: { styleId: IDS.cycleA },
    });
    expect(cycle.properties).toMatchObject({
      border: { width: 4 },
      typography: { fontSize: 18 },
    });
    expect(cycle.diagnostics).toEqual([
      expect.objectContaining({
        code: 'style-inheritance-cycle',
        cycle: [IDS.cycleA, IDS.cycleB, IDS.cycleA],
      }),
    ]);

    const missingBase = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      binding: { styleId: IDS.missingBase },
    });
    expect(missingBase.properties.typography?.fontWeight).toBe(800);
    expect(missingBase.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing-style',
        styleId: IDS.missingBase,
        referencedStyleId: IDS.missing,
      }),
    ]);

    const missingDirect = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      binding: { styleId: IDS.missing },
    });
    expect(missingDirect.visual.backgroundColor).toBe('#FFFFFF');
    expect(missingDirect.diagnostics[0]).toMatchObject({
      code: 'missing-style',
      referencedStyleId: IDS.missing,
    });
  });

  it('falls back safely for missing or non-color tokens and keeps diagnostics precise', () => {
    const document = makeDocument();
    document.themes[IDS.theme].tokens = { numericColor: 42 };
    document.themes[IDS.theme].defaultStyles.topic = {
      overrides: {
        fill: { color: token('missingFill') },
        typography: { color: token('numericColor') },
      },
    };

    const resolution = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
    });

    expect(resolution.visual.backgroundColor).toBe('#FFFFFF');
    expect(resolution.visual.color).toBe('#0F172A');
    expect(resolution.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing-color-token',
        token: 'missingFill',
        path: 'fill.color',
      }),
      expect.objectContaining({
        code: 'invalid-color-token',
        token: 'numericColor',
        path: 'typography.color',
      }),
    ]);
  });

  it('resolves connector rules and named styles independently from topic styling', () => {
    const document = makeDocument();
    document.themes[IDS.theme].tokens = { branch: '#0EA5E9' };
    document.themes[IDS.theme].defaultStyles['tree-edge'] = {
      overrides: { connector: { color: token('branch'), width: 3 } },
    };
    document.themes[IDS.theme].rules[IDS.connectorRule] = {
      id: IDS.connectorRule,
      orderKey: 'a',
      selector: { scope: 'tree-edge', side: 'right' },
      binding: { overrides: { connector: { dash: [8, 2], width: 4 } } },
    };
    document.styles[IDS.connectorBase] = {
      id: IDS.connectorBase,
      name: 'Connector base',
      scope: 'tree-edge',
      properties: { opacity: 0.75, connector: { shape: 'curve' } },
    };
    document.styles[IDS.connector] = {
      id: IDS.connector,
      name: 'Connector',
      scope: 'tree-edge',
      basedOnStyleId: IDS.connectorBase,
      properties: { connector: { endCap: 'arrow' } },
    };

    const resolution = resolveConnectorStyle({
      document,
      themeId: IDS.theme,
      scope: 'tree-edge',
      side: 'right',
      binding: {
        styleId: IDS.connector,
        overrides: { connector: { width: 5 } },
      },
    });

    expect(resolution.properties.connector).toEqual({
      color: token('branch'),
      width: 5,
      dash: [8, 2],
      shape: 'curve',
      endCap: 'arrow',
    });
    expect(resolution.visual).toEqual({
      stroke: '#0EA5E9',
      strokeWidth: 5,
      strokeDasharray: '8 2',
      opacity: 0.75,
    });
    expect(resolution.matchedRuleIds).toEqual([IDS.connectorRule]);
  });

  it('preserves light/dark extension fields plus false, zero, and empty arrays', () => {
    const document = makeDocument();
    const extensionDefaults = {
      opacity: 1,
      typography: { italic: true },
      connector: { dash: [1, 2] },
      appearance: {
        light: { surface: '#FFFFFF', contrast: 1 },
        dark: { surface: '#020617', contrast: 2 },
      },
    } as unknown as StyleProperties;
    const extensionOverrides = {
      opacity: 0,
      typography: { italic: false },
      connector: { dash: [] },
      appearance: { dark: { contrast: 3 } },
    } as unknown as StyleProperties;
    document.themes[IDS.theme].defaultStyles.topic = {
      overrides: extensionDefaults,
    };
    const before = JSON.stringify(document);

    const resolution = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      binding: { overrides: extensionOverrides },
    });
    const properties = resolution.properties as StyleProperties & {
      appearance: {
        light: { surface: string; contrast: number };
        dark: { surface: string; contrast: number };
      };
    };

    expect(properties.appearance).toEqual({
      light: { surface: '#FFFFFF', contrast: 1 },
      dark: { surface: '#020617', contrast: 3 },
    });
    expect(properties.opacity).toBe(0);
    expect(properties.typography?.italic).toBe(false);
    expect(properties.connector?.dash).toEqual([]);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('resets prior theme layers to the built-in skeleton for inheritance break', () => {
    const document = makeDocument();
    document.themes[IDS.theme].defaultStyles.topic = {
      overrides: {
        fill: { color: literal('#111827') },
        typography: { fontSize: 22 },
      },
    };

    const resolution = resolveTopicStyle({
      document,
      themeId: IDS.theme,
      role: 'regular',
      binding: {
        inheritance: 'break',
        overrides: { border: { width: 7 } },
      },
    });

    expect(resolution.visual.backgroundColor).toBe('#FFFFFF');
    expect(resolution.visual.borderWidth).toBe(7);
    expect(resolution.properties.typography?.fontSize).toBeUndefined();
  });
});
