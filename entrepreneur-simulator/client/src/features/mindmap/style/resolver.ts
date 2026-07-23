import type {
  BranchSide,
  ColorValue,
  MindMapDocumentV1,
  MindMapTheme,
  OrderKey,
  StructureId,
  StyleBinding,
  StyleId,
  StyleProperties,
  StyleScope,
  ThemeId,
  ThemeRule,
  ThemeRuleId,
  TopicRole,
} from '../domain/types';
import {
  cloneStyleProperties,
  deepFreezeStyleValue,
  mergeStyleProperties,
} from './merge';
import {
  getBuiltInScopeSkeleton,
  getBuiltInTopicSkeleton,
} from './skeletons';

export type StyleResolutionDiagnosticCode =
  | 'missing-theme'
  | 'missing-style'
  | 'style-inheritance-cycle'
  | 'style-scope-mismatch'
  | 'missing-color-token'
  | 'invalid-color-token';

export interface StyleResolutionDiagnostic {
  readonly code: StyleResolutionDiagnosticCode;
  readonly severity: 'warning';
  readonly message: string;
  readonly scope: StyleScope;
  readonly styleId?: StyleId;
  readonly referencedStyleId?: StyleId;
  readonly cycle?: readonly StyleId[];
  readonly token?: string;
  readonly path?: string;
}

export interface StyleRuleMatchContext {
  readonly scope: StyleScope;
  readonly topicRole?: TopicRole;
  readonly level?: number;
  readonly side?: BranchSide;
  readonly structure?: StructureId;
}

export interface ResolveCascadedStyleInput {
  readonly document: Readonly<MindMapDocumentV1>;
  readonly themeId: ThemeId;
  readonly context: Readonly<StyleRuleMatchContext>;
  readonly entityBinding?: Readonly<StyleBinding>;
  readonly skeleton?: Readonly<StyleProperties>;
}

export interface CascadedStyleResolution {
  readonly properties: Readonly<StyleProperties>;
  readonly diagnostics: readonly StyleResolutionDiagnostic[];
  readonly matchedRuleIds: readonly ThemeRuleId[];
  readonly appliedStyleIds: readonly StyleId[];
}

export interface TopicVisualStyle {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderRadius: number;
  readonly borderWidth: number;
  readonly color: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontStyle?: 'italic';
  readonly fontWeight?: number;
  readonly opacity: number;
  readonly textDecoration?: string;
}

export interface ConnectorVisualStyle {
  readonly opacity: number;
  readonly stroke: string;
  readonly strokeDasharray?: string;
  readonly strokeWidth: number;
}

export type SemanticStyleScope = 'boundary' | 'summary' | 'callout' | 'zone';

export interface SemanticVisualStyle {
  readonly opacity: number;
  readonly fill: string;
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeDasharray?: string;
  readonly borderRadius: number;
  readonly color: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontStyle?: 'italic';
  readonly fontWeight?: number;
  readonly shape?: string;
}

export interface ResolveTopicStyleInput {
  readonly document: Readonly<MindMapDocumentV1>;
  readonly themeId: ThemeId;
  readonly role: TopicRole;
  readonly binding?: Readonly<StyleBinding>;
  readonly level?: number;
  readonly side?: BranchSide;
  readonly structure?: StructureId;
  readonly skeleton?: Readonly<StyleProperties>;
}

export interface ResolveConnectorStyleInput {
  readonly document: Readonly<MindMapDocumentV1>;
  readonly themeId: ThemeId;
  readonly scope: 'tree-edge' | 'relationship';
  readonly binding?: Readonly<StyleBinding>;
  readonly level?: number;
  readonly side?: BranchSide;
  readonly structure?: StructureId;
  readonly skeleton?: Readonly<StyleProperties>;
}

export interface ResolveSemanticStyleInput {
  readonly document: Readonly<MindMapDocumentV1>;
  readonly themeId: ThemeId;
  readonly scope: SemanticStyleScope;
  readonly binding?: Readonly<StyleBinding>;
  readonly structure?: StructureId;
  readonly skeleton?: Readonly<StyleProperties>;
}

export interface TopicStyleResolution extends CascadedStyleResolution {
  readonly visual: Readonly<TopicVisualStyle>;
}

export interface ConnectorStyleResolution extends CascadedStyleResolution {
  readonly visual: Readonly<ConnectorVisualStyle>;
}

export interface SemanticStyleResolution extends CascadedStyleResolution {
  readonly visual: Readonly<SemanticVisualStyle>;
}

interface MutableResolutionState {
  diagnostics: StyleResolutionDiagnostic[];
  matchedRuleIds: ThemeRuleId[];
  appliedStyleIds: StyleId[];
  diagnosticKeys: Set<string>;
  appliedStyleIdSet: Set<StyleId>;
}

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const themeRuleSpecificity = (rule: Readonly<ThemeRule>): number =>
  Object.values(rule.selector).filter((value) => value !== undefined).length;

export const compareThemeRules = (
  left: Readonly<ThemeRule>,
  right: Readonly<ThemeRule>,
): number => themeRuleSpecificity(left) - themeRuleSpecificity(right)
  || compareAscii(left.orderKey as OrderKey, right.orderKey as OrderKey)
  || compareAscii(left.id, right.id);

export const themeRuleMatches = (
  rule: Readonly<ThemeRule>,
  context: Readonly<StyleRuleMatchContext>,
): boolean => {
  const selector = rule.selector;
  if (selector.scope !== context.scope) return false;
  if (selector.topicRole !== undefined && selector.topicRole !== context.topicRole) {
    return false;
  }
  if (selector.level !== undefined && selector.level !== context.level) return false;
  if (selector.side !== undefined && selector.side !== context.side) return false;
  if (selector.structure !== undefined && selector.structure !== context.structure) {
    return false;
  }
  return true;
};

const pushDiagnostic = (
  state: MutableResolutionState,
  diagnostic: StyleResolutionDiagnostic,
): void => {
  const key = JSON.stringify([
    diagnostic.code,
    diagnostic.scope,
    diagnostic.styleId,
    diagnostic.referencedStyleId,
    diagnostic.cycle,
    diagnostic.token,
    diagnostic.path,
  ]);
  if (state.diagnosticKeys.has(key)) return;
  state.diagnosticKeys.add(key);
  state.diagnostics.push(diagnostic);
};

const noteAppliedStyle = (
  state: MutableResolutionState,
  styleId: StyleId,
): void => {
  if (state.appliedStyleIdSet.has(styleId)) return;
  state.appliedStyleIdSet.add(styleId);
  state.appliedStyleIds.push(styleId);
};

const resolveStyleDefinition = (
  document: Readonly<MindMapDocumentV1>,
  styleId: StyleId,
  scope: StyleScope,
  state: MutableResolutionState,
  stack: readonly StyleId[] = [],
): StyleProperties => {
  const definition = document.styles[styleId];
  if (!definition) {
    pushDiagnostic(state, {
      code: 'missing-style',
      severity: 'warning',
      message: `Style ${styleId} does not exist; the previous cascade value is retained.`,
      scope,
      referencedStyleId: styleId,
    });
    return {};
  }

  if (definition.scope !== scope) {
    pushDiagnostic(state, {
      code: 'style-scope-mismatch',
      severity: 'warning',
      message: `Style ${styleId} has scope ${definition.scope}, expected ${scope}; it was ignored.`,
      scope,
      styleId,
    });
    return {};
  }

  const cycleStart = stack.indexOf(styleId);
  if (cycleStart >= 0) {
    const cycle = [...stack.slice(cycleStart), styleId];
    pushDiagnostic(state, {
      code: 'style-inheritance-cycle',
      severity: 'warning',
      message: `Style inheritance cycle detected: ${cycle.join(' -> ')}.`,
      scope,
      styleId,
      cycle,
    });
    return {};
  }

  let properties: StyleProperties = {};
  if (definition.basedOnStyleId) {
    const parent = document.styles[definition.basedOnStyleId];
    if (!parent) {
      pushDiagnostic(state, {
        code: 'missing-style',
        severity: 'warning',
        message: `Style ${styleId} references missing base style ${definition.basedOnStyleId}.`,
        scope,
        styleId,
        referencedStyleId: definition.basedOnStyleId,
      });
    } else {
      properties = resolveStyleDefinition(
        document,
        definition.basedOnStyleId,
        scope,
        state,
        [...stack, styleId],
      );
    }
  }

  noteAppliedStyle(state, styleId);
  return mergeStyleProperties(properties, definition.properties);
};

const applyBinding = (
  base: Readonly<StyleProperties>,
  skeleton: Readonly<StyleProperties>,
  binding: Readonly<StyleBinding> | undefined,
  document: Readonly<MindMapDocumentV1>,
  scope: StyleScope,
  state: MutableResolutionState,
): StyleProperties => {
  if (!binding) return cloneStyleProperties(base);
  let properties = binding.inheritance === 'break'
    ? cloneStyleProperties(skeleton)
    : cloneStyleProperties(base);
  if (binding.styleId) {
    properties = mergeStyleProperties(
      properties,
      resolveStyleDefinition(document, binding.styleId, scope, state),
    );
  }
  return mergeStyleProperties(properties, binding.overrides);
};

export const resolveCascadedStyle = (
  input: Readonly<ResolveCascadedStyleInput>,
): CascadedStyleResolution => {
  const { document, themeId, context } = input;
  const scope = context.scope;
  const skeleton = cloneStyleProperties(
    input.skeleton ?? getBuiltInScopeSkeleton(scope),
  );
  const state: MutableResolutionState = {
    diagnostics: [],
    matchedRuleIds: [],
    appliedStyleIds: [],
    diagnosticKeys: new Set<string>(),
    appliedStyleIdSet: new Set<StyleId>(),
  };
  const theme = document.themes[themeId];
  let properties = cloneStyleProperties(skeleton);

  if (!theme) {
    pushDiagnostic(state, {
      code: 'missing-theme',
      severity: 'warning',
      message: `Theme ${themeId} does not exist; built-in skeleton values are used.`,
      scope,
    });
  } else {
    properties = applyBinding(
      properties,
      skeleton,
      theme.defaultStyles[scope],
      document,
      scope,
      state,
    );
    const rules = Object.values(theme.rules)
      .filter((rule) => themeRuleMatches(rule, context))
      .sort(compareThemeRules);
    for (const rule of rules) {
      state.matchedRuleIds.push(rule.id);
      properties = applyBinding(
        properties,
        skeleton,
        rule.binding,
        document,
        scope,
        state,
      );
    }
  }

  // Entity binding is deliberately last: named StyleDefinition inheritance is
  // resolved before the entity's local overrides are merged.
  properties = applyBinding(
    properties,
    skeleton,
    input.entityBinding,
    document,
    scope,
    state,
  );

  return deepFreezeStyleValue({
    properties,
    diagnostics: [...state.diagnostics],
    matchedRuleIds: [...state.matchedRuleIds],
    appliedStyleIds: [...state.appliedStyleIds],
  }) as CascadedStyleResolution;
};

const resolveColor = (
  color: Readonly<ColorValue> | undefined,
  theme: Readonly<MindMapTheme> | undefined,
  fallback: string,
  scope: StyleScope,
  path: string,
  diagnostics: StyleResolutionDiagnostic[],
): string => {
  if (!color) return fallback;
  if (color.kind === 'literal') return color.value;
  const token = theme?.tokens[color.token];
  if (typeof token === 'string') return token;
  diagnostics.push({
    code: token === undefined ? 'missing-color-token' : 'invalid-color-token',
    severity: 'warning',
    message: token === undefined
      ? `Color token ${color.token} is missing; the built-in fallback is used.`
      : `Color token ${color.token} is numeric and cannot be used as a color; the built-in fallback is used.`,
    scope,
    token: color.token,
    path,
  });
  return fallback;
};

const literalFallback = (
  properties: Readonly<StyleProperties>,
  path: 'fill' | 'border' | 'typography' | 'connector',
  fallback: string,
): string => {
  const color = path === 'connector'
    ? properties.connector?.color
    : path === 'typography'
      ? properties.typography?.color
      : path === 'border'
        ? properties.border?.color
        : properties.fill?.color;
  return color?.kind === 'literal' ? color.value : fallback;
};

export const resolveTopicStyle = (
  input: Readonly<ResolveTopicStyleInput>,
): TopicStyleResolution => {
  const skeleton = cloneStyleProperties(
    input.skeleton ?? getBuiltInTopicSkeleton(input.role),
  );
  const cascade = resolveCascadedStyle({
    document: input.document,
    themeId: input.themeId,
    context: {
      scope: 'topic',
      topicRole: input.role,
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.side !== undefined ? { side: input.side } : {}),
      ...(input.structure !== undefined ? { structure: input.structure } : {}),
    },
    entityBinding: input.binding,
    skeleton,
  });
  const diagnostics = [...cascade.diagnostics];
  const theme = input.document.themes[input.themeId];
  const properties = cascade.properties;
  const fallbackBackground = literalFallback(skeleton, 'fill', '#FFFFFF');
  const fallbackBorder = literalFallback(skeleton, 'border', '#CBD5E1');
  const fallbackText = literalFallback(skeleton, 'typography', '#0F172A');
  const borderRadius = properties.border?.radius
    ?? (properties.shape === 'pill' ? 999 : skeleton.border?.radius ?? 12);
  const visual: TopicVisualStyle = {
    backgroundColor: resolveColor(
      properties.fill?.color,
      theme,
      fallbackBackground,
      'topic',
      'fill.color',
      diagnostics,
    ),
    borderColor: resolveColor(
      properties.border?.color,
      theme,
      fallbackBorder,
      'topic',
      'border.color',
      diagnostics,
    ),
    borderRadius,
    borderWidth: properties.border?.width ?? skeleton.border?.width ?? 1,
    color: resolveColor(
      properties.typography?.color,
      theme,
      fallbackText,
      'topic',
      'typography.color',
      diagnostics,
    ),
    ...(properties.typography?.fontFamily !== undefined
      ? { fontFamily: properties.typography.fontFamily }
      : {}),
    ...(properties.typography?.fontSize !== undefined
      ? { fontSize: properties.typography.fontSize }
      : {}),
    ...(properties.typography?.italic === true ? { fontStyle: 'italic' as const } : {}),
    ...(properties.typography?.fontWeight !== undefined
      ? { fontWeight: properties.typography.fontWeight }
      : skeleton.typography?.fontWeight !== undefined
        ? { fontWeight: skeleton.typography.fontWeight }
        : {}),
    opacity: properties.opacity ?? skeleton.opacity ?? 1,
    ...(properties.typography?.underline || properties.typography?.strike
      ? {
          textDecoration: [
            properties.typography.underline ? 'underline' : '',
            properties.typography.strike ? 'line-through' : '',
          ].filter(Boolean).join(' '),
        }
      : {}),
  };
  return deepFreezeStyleValue({
    ...cascade,
    diagnostics,
    visual,
  }) as TopicStyleResolution;
};

export const resolveConnectorStyle = (
  input: Readonly<ResolveConnectorStyleInput>,
): ConnectorStyleResolution => {
  const skeleton = cloneStyleProperties(
    input.skeleton ?? getBuiltInScopeSkeleton(input.scope),
  );
  const cascade = resolveCascadedStyle({
    document: input.document,
    themeId: input.themeId,
    context: {
      scope: input.scope,
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.side !== undefined ? { side: input.side } : {}),
      ...(input.structure !== undefined ? { structure: input.structure } : {}),
    },
    entityBinding: input.binding,
    skeleton,
  });
  const diagnostics = [...cascade.diagnostics];
  const properties = cascade.properties;
  const fallbackStroke = literalFallback(
    skeleton,
    'connector',
    input.scope === 'relationship' ? '#8B5CF6' : '#64748B',
  );
  const theme = input.document.themes[input.themeId];
  const dash = properties.connector?.dash;
  const visual: ConnectorVisualStyle = {
    stroke: resolveColor(
      properties.connector?.color,
      theme,
      fallbackStroke,
      input.scope,
      'connector.color',
      diagnostics,
    ),
    strokeWidth: properties.connector?.width ?? skeleton.connector?.width ?? 2,
    ...(dash !== undefined ? { strokeDasharray: dash.join(' ') } : {}),
    opacity: properties.opacity ?? skeleton.opacity ?? 1,
  };
  return deepFreezeStyleValue({
    ...cascade,
    diagnostics,
    visual,
  }) as ConnectorStyleResolution;
};

/** Resolves non-topic semantic element paint without leaking ColorValue tokens into SVG. */
export const resolveSemanticStyle = (
  input: Readonly<ResolveSemanticStyleInput>,
): SemanticStyleResolution => {
  const skeleton = cloneStyleProperties(
    input.skeleton ?? getBuiltInScopeSkeleton(input.scope),
  );
  const cascade = resolveCascadedStyle({
    document: input.document,
    themeId: input.themeId,
    context: {
      scope: input.scope,
      ...(input.structure !== undefined ? { structure: input.structure } : {}),
    },
    entityBinding: input.binding,
    skeleton,
  });
  const diagnostics = [...cascade.diagnostics];
  const properties = cascade.properties;
  const theme = input.document.themes[input.themeId];
  const dash = properties.border?.dash;
  const visual: SemanticVisualStyle = {
    opacity: properties.opacity ?? skeleton.opacity ?? 1,
    fill: resolveColor(
      properties.fill?.color,
      theme,
      literalFallback(skeleton, 'fill', '#FFFFFF'),
      input.scope,
      'fill.color',
      diagnostics,
    ),
    fillOpacity: properties.fill?.opacity ?? skeleton.fill?.opacity ?? 1,
    stroke: resolveColor(
      properties.border?.color,
      theme,
      literalFallback(skeleton, 'border', '#64748B'),
      input.scope,
      'border.color',
      diagnostics,
    ),
    strokeWidth: properties.border?.width ?? skeleton.border?.width ?? 1,
    ...(dash !== undefined ? { strokeDasharray: dash.join(' ') } : {}),
    borderRadius: properties.border?.radius ?? skeleton.border?.radius ?? 0,
    color: resolveColor(
      properties.typography?.color,
      theme,
      literalFallback(skeleton, 'typography', '#0F172A'),
      input.scope,
      'typography.color',
      diagnostics,
    ),
    ...(properties.typography?.fontFamily !== undefined
      ? { fontFamily: properties.typography.fontFamily }
      : {}),
    ...(properties.typography?.fontSize !== undefined
      ? { fontSize: properties.typography.fontSize }
      : {}),
    ...(properties.typography?.italic === true ? { fontStyle: 'italic' as const } : {}),
    ...(properties.typography?.fontWeight !== undefined
      ? { fontWeight: properties.typography.fontWeight }
      : skeleton.typography?.fontWeight !== undefined
        ? { fontWeight: skeleton.typography.fontWeight }
        : {}),
    ...(properties.shape !== undefined ? { shape: properties.shape } : {}),
  };
  return deepFreezeStyleValue({
    ...cascade,
    diagnostics,
    visual,
  }) as SemanticStyleResolution;
};
