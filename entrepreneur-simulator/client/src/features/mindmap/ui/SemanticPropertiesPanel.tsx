import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Pencil, RotateCcw, X } from 'lucide-react';

import type {
  ArrowHead,
  ElementRef,
  MindMapDocumentV1,
  RichText,
  SheetId,
} from '../domain/types';
import { TopicRichText } from './TopicRichText';
import {
  RELATIONSHIP_ARROW_HEAD_VALUES,
  BOUNDARY_SHAPE_VALUES,
  RELATIONSHIP_LINE_STYLE_VALUES,
  RELATIONSHIP_ROUTING_VALUES,
  SUMMARY_ORIENTATION_VALUES,
  buildSemanticPropertiesModel,
  planUpdateRelationshipArrowCommand,
  planUpdateRelationshipLineColorCommand,
  planUpdateRelationshipLineStyleCommand,
  planUpdateRelationshipLineWidthCommand,
  planUpdateRelationshipRoutingCommand,
  planAdjustBoundaryRange,
  planUpdateBoundaryPadding,
  planUpdateBoundaryStyleCommand,
  planUpdateSummaryLineStyleCommand,
  planUpdateSummaryOrientationCommand,
  planUpdateSummaryStyleCommand,
  planUpdateSemanticContentCommand,
  type EditableRelationshipLineStyle,
  type BoundaryShape,
  type RelationshipRouting,
  type SummaryOrientation,
  type SemanticPropertiesCommand,
} from './semanticPropertiesPlanning';

const kindLabels = {
  relationship: '关系',
  boundary: '边界',
  summary: '概要',
  callout: '标注',
  zone: '区域',
} as const;

const routingLabels: Record<RelationshipRouting, string> = {
  straight: '直线',
  curve: '曲线',
  orthogonal: '折线',
  manual: '手动路径',
};

const arrowLabels: Record<ArrowHead, string> = {
  none: '无',
  triangle: '实心三角',
  'open-triangle': '空心三角',
  diamond: '实心菱形',
  'open-diamond': '空心菱形',
  circle: '实心圆',
  'open-circle': '空心圆',
  square: '实心方形',
  'open-square': '空心方形',
  bar: '单横线',
  'double-bar': '双横线',
};

const lineStyleLabels: Record<EditableRelationshipLineStyle, string> = {
  default: '跟随样式',
  solid: '实线',
  dashed: '虚线',
  dotted: '点线',
};

const boundaryShapeLabels: Record<BoundaryShape, string> = {
  rectangle: '矩形',
  'rounded-rectangle': '圆角矩形',
  capsule: '胶囊',
  ellipse: '椭圆',
  scallop: '扇贝边',
  wave: '波浪边',
  tension: '张力框',
  bracket: '括号框',
  none: '无边框',
};

const summaryOrientationLabels: Record<SummaryOrientation, string> = {
  auto: '自动',
  left: '左侧',
  right: '右侧',
  top: '上方',
  bottom: '下方',
};

const selectClassName = 'h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

interface RelationshipWidthControlProps {
  readonly value: number | undefined;
  readonly disabled: boolean;
  onCommit(value: number | null): void;
}

const RelationshipWidthControl = ({
  value,
  disabled,
  onCommit,
}: RelationshipWidthControlProps) => {
  const canonical = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(canonical);
  useEffect(() => setDraft(canonical), [canonical]);

  const commit = (): void => {
    const normalized = draft.trim();
    if (normalized === '') {
      setDraft('');
      if (value !== undefined) onCommit(null);
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
      setDraft(canonical);
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <label className="block text-xs text-slate-600">
      <span className="mb-1 block">粗细</span>
      <input
        type="number"
        className={selectClassName}
        value={draft}
        min={0}
        max={1000}
        step={0.5}
        placeholder="跟随样式"
        disabled={disabled}
        aria-label="关系线粗细"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
};

interface BoundaryNumberControlProps {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly max: number;
  readonly disabled: boolean;
  onCommit(value: number): void;
}

const BoundaryNumberControl = ({
  ariaLabel,
  disabled,
  label,
  max,
  onCommit,
  value,
}: BoundaryNumberControlProps) => {
  const canonical = String(value);
  const [draft, setDraft] = useState(canonical);
  useEffect(() => setDraft(canonical), [canonical]);
  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
      setDraft(canonical);
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <label className="block text-xs text-slate-600">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        className={selectClassName}
        value={draft}
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
    </label>
  );
};

const literalColor = (value: { kind: string; value?: string } | undefined, fallback: string) =>
  value?.kind === 'literal' && value.value && /^#[0-9a-f]{6}$/i.test(value.value)
    ? value.value
    : fallback;

export interface SemanticPropertiesPanelProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly selection: ElementRef | null;
  readonly readOnly: boolean;
  onCommand(command: SemanticPropertiesCommand): void;
  onClose?(): void;
}

/**
 * Self-contained properties UI for canonical semantic elements. It plans but
 * never mutates: the embedding editor owns dispatch, history, and persistence.
 */
export const SemanticPropertiesPanel = ({
  document,
  sheetId,
  selection,
  readOnly,
  onCommand,
  onClose,
}: SemanticPropertiesPanelProps) => {
  const model = useMemo(
    () => buildSemanticPropertiesModel(document, sheetId, selection),
    [document, selection, sheetId],
  );
  const identity = model ? `${model.kind}:${model.id}` : 'none';
  const [editingContent, setEditingContent] = useState(false);

  useEffect(() => setEditingContent(false), [identity, readOnly]);

  const stopKeyboardPropagation = (event: ReactKeyboardEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  const planBase = model && selection ? {
    document,
    sheetId,
    element: selection as Extract<ElementRef, {
      kind: 'relationship' | 'boundary' | 'summary' | 'callout' | 'zone';
    }>,
  } : null;

  const dispatchBoundaryPlan = (
    planner: () => SemanticPropertiesCommand,
  ): void => {
    if (readOnly) return;
    try {
      onCommand(planner());
    } catch (error) {
      // Native color inputs may emit the committed value more than once. A
      // style no-op is not an editor fault and must never escape an event
      // handler into the host ErrorBoundary.
      if (error instanceof Error && /does not change any target/i.test(error.message)) return;
      throw error;
    }
  };

  const commitContent = (content: RichText): void => {
    if (readOnly || !model || !planBase) return;
    if (sameJson(content, model.content)) {
      setEditingContent(false);
      return;
    }
    onCommand(planUpdateSemanticContentCommand({ ...planBase, content }));
    setEditingContent(false);
  };

  return (
    <aside
      className="nowheel nodrag flex w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur"
      data-testid="mindmap-semantic-properties"
      aria-label="语义属性"
      onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
      onKeyDown={stopKeyboardPropagation}
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            语义属性
          </div>
          <div className="text-xs font-medium text-slate-800">
            {model ? kindLabels[model.kind] : '未选择语义元素'}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="关闭语义属性"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </header>

      {!model || !planBase ? (
        <div className="px-3 py-5 text-center text-xs text-slate-400">
          选择关系、边界、概要、标注或区域以编辑属性
        </div>
      ) : (
        <div className="space-y-4 overflow-y-auto p-3">
          <section aria-label={model.contentLabel}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">{model.contentLabel}</span>
              {!editingContent && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  disabled={readOnly}
                  onClick={() => setEditingContent(true)}
                  aria-label={`编辑${model.contentLabel}`}
                >
                  <Pencil size={11} aria-hidden="true" />
                  编辑
                </button>
              )}
            </div>
            <div className="min-h-10 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              <TopicRichText
                key={`${identity}:${editingContent ? 'edit' : 'display'}`}
                value={model.content}
                editing={editingContent && !readOnly}
                autoFocus
                ariaLabel={editingContent ? `编辑${model.contentLabel}` : model.contentLabel}
                className="text-xs"
                onCommit={commitContent}
                onCancel={() => setEditingContent(false)}
              />
            </div>
            {model.kind === 'summary' && (
              <p
                className="mt-1 text-[10px] text-slate-400"
                data-testid="mindmap-summary-result-content-note"
              >
                此处编辑的是概要结果主题内容；结果主题可继续添加子主题，选中结果主题后可用通用格式设置形状和填充。
              </p>
            )}
          </section>

          {model.kind === 'relationship' && (
            <section className="space-y-3 border-t border-slate-100 pt-3" aria-label="关系线属性">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-xs text-slate-600">
                  <span className="mb-1 block">颜色</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-slate-200 bg-white p-1 disabled:cursor-not-allowed disabled:bg-slate-100"
                      value={
                        model.lineColor?.kind === 'literal'
                        && /^#[0-9a-f]{6}$/i.test(model.lineColor.value)
                          ? model.lineColor.value
                          : '#64748b'
                      }
                      disabled={readOnly}
                      aria-label="关系线颜色"
                      onChange={(event) => {
                        if (readOnly) return;
                        onCommand(planUpdateRelationshipLineColorCommand({
                          ...planBase,
                          color: { kind: 'literal', value: event.currentTarget.value.toUpperCase() },
                        }));
                      }}
                    />
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                      disabled={readOnly || model.lineColor === undefined}
                      aria-label="重置关系线颜色"
                      onClick={() => {
                        if (readOnly || model.lineColor === undefined) return;
                        onCommand(planUpdateRelationshipLineColorCommand({
                          ...planBase,
                          color: null,
                        }));
                      }}
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                    </button>
                  </div>
                  <span className="mt-0.5 block truncate text-[9px] text-slate-400">
                    {model.lineColor?.kind === 'literal'
                      ? model.lineColor.value
                      : model.lineColor?.kind === 'token'
                        ? `主题色 · ${model.lineColor.token}`
                        : '跟随样式'}
                  </span>
                </div>
                <RelationshipWidthControl
                  value={model.lineWidth}
                  disabled={readOnly}
                  onCommit={(width) => {
                    if (readOnly) return;
                    onCommand(planUpdateRelationshipLineWidthCommand({
                      ...planBase,
                      width,
                    }));
                  }}
                />
              </div>

              <label className="block text-xs text-slate-600">
                <span className="mb-1 block">路径</span>
                <select
                  className={selectClassName}
                  value={model.routing}
                  disabled={readOnly}
                  aria-label="关系路径"
                  onChange={(event) => {
                    if (readOnly) return;
                    onCommand(planUpdateRelationshipRoutingCommand({
                      ...planBase,
                      routing: event.currentTarget.value as RelationshipRouting,
                    }));
                  }}
                >
                  {RELATIONSHIP_ROUTING_VALUES.map((value) => (
                    <option key={value} value={value}>{routingLabels[value]}</option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                <span className="mb-1 block">线型</span>
                <select
                  className={selectClassName}
                  value={model.lineStyle}
                  disabled={readOnly}
                  aria-label="关系线型"
                  onChange={(event) => {
                    if (readOnly) return;
                    onCommand(planUpdateRelationshipLineStyleCommand({
                      ...planBase,
                      lineStyle: event.currentTarget.value as EditableRelationshipLineStyle,
                    }));
                  }}
                >
                  {model.lineStyle === 'custom' && <option value="custom" disabled>自定义虚线</option>}
                  {RELATIONSHIP_LINE_STYLE_VALUES.map((value) => (
                    <option key={value} value={value}>{lineStyleLabels[value]}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                {(['start', 'end'] as const).map((endpoint) => (
                  <label key={endpoint} className="block text-xs text-slate-600">
                    <span className="mb-1 block">{endpoint === 'start' ? '起点箭头' : '终点箭头'}</span>
                    <select
                      className={selectClassName}
                      value={endpoint === 'start' ? model.startArrow : model.endArrow}
                      disabled={readOnly}
                      aria-label={endpoint === 'start' ? '关系起点箭头' : '关系终点箭头'}
                      onChange={(event) => {
                        if (readOnly) return;
                        onCommand(planUpdateRelationshipArrowCommand({
                          ...planBase,
                          endpoint,
                          arrow: event.currentTarget.value as ArrowHead,
                        }));
                      }}
                    >
                      {RELATIONSHIP_ARROW_HEAD_VALUES.map((value) => (
                        <option key={value} value={value}>{arrowLabels[value]}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          {model.kind === 'boundary' && (
            <section className="space-y-3 border-t border-slate-100 pt-3" aria-label="边界范围与样式">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">范围起止</div>
                {model.rangeAdjustable ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      ['start', 'outward', '起点向外扩展', model.canExpandStart],
                      ['start', 'inward', '起点向内收缩', model.canShrinkStart],
                      ['end', 'inward', '终点向内收缩', model.canShrinkEnd],
                      ['end', 'outward', '终点向外扩展', model.canExpandEnd],
                    ] as const).map(([endpoint, direction, label, enabled]) => (
                      <button
                        key={`${endpoint}:${direction}`}
                        type="button"
                        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={readOnly || !enabled}
                        aria-label={label}
                        onClick={() => dispatchBoundaryPlan(() => planAdjustBoundaryRange({
                          ...planBase,
                          endpoint,
                          direction,
                        }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
                    独立浮动/概要结果子树使用整体范围，不能按兄弟起止点调整。
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <BoundaryNumberControl
                  label="外扩距离"
                  ariaLabel="边界外扩距离"
                  value={model.padding}
                  max={10_000}
                  disabled={readOnly}
                  onCommit={(padding) => dispatchBoundaryPlan(() => planUpdateBoundaryPadding({
                    ...planBase,
                    padding,
                  }))}
                />
                <label className="block text-xs text-slate-600">
                  <span className="mb-1 block">形状</span>
                  <select
                    className={selectClassName}
                    value={model.shape}
                    disabled={readOnly}
                    aria-label="边界形状"
                    onChange={(event) => dispatchBoundaryPlan(() => planUpdateBoundaryStyleCommand({
                      ...planBase,
                      overrides: { shape: event.currentTarget.value as BoundaryShape },
                    }))}
                  >
                    {BOUNDARY_SHAPE_VALUES.map((shape) => (
                      <option key={shape} value={shape}>{boundaryShapeLabels[shape]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ['填充', '边界填充色', model.fillColor, '#EFF6FF', 'fill'],
                  ['边框', '边界边框色', model.borderColor, '#60A5FA', 'border'],
                  ['文字', '边界文字色', model.textColor, '#1D4ED8', 'text'],
                ] as const).map(([label, ariaLabel, color, fallback, kind]) => (
                  <label key={kind} className="block text-[10px] text-slate-600">
                    <span className="mb-1 block">{label}</span>
                    <input
                      type="color"
                      className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-1 disabled:cursor-not-allowed disabled:bg-slate-100"
                      value={literalColor(color, fallback)}
                      disabled={readOnly}
                      aria-label={ariaLabel}
                      onChange={(event) => {
                        const value = { kind: 'literal' as const, value: event.currentTarget.value.toUpperCase() };
                        dispatchBoundaryPlan(() => planUpdateBoundaryStyleCommand({
                          ...planBase,
                          overrides: kind === 'fill'
                            ? { fill: { color: value } }
                            : kind === 'border'
                              ? { border: { color: value } }
                              : { typography: { color: value } },
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>

              <BoundaryNumberControl
                label="边框宽度"
                ariaLabel="边界边框宽度"
                value={model.borderWidth ?? 2}
                max={1_000}
                disabled={readOnly}
                onCommit={(width) => dispatchBoundaryPlan(() => planUpdateBoundaryStyleCommand({
                  ...planBase,
                  overrides: { border: { width } },
                }))}
              />
            </section>
          )}

          {model.kind === 'summary' && (
            <section className="space-y-3 border-t border-slate-100 pt-3" aria-label="概要方向与线条">
              <label className="block text-xs text-slate-600">
                <span className="mb-1 block">方向</span>
                <select
                  className={selectClassName}
                  value={model.orientation}
                  disabled={readOnly}
                  aria-label="概要方向"
                  onChange={(event) => dispatchBoundaryPlan(() => planUpdateSummaryOrientationCommand({
                    ...planBase,
                    orientation: event.currentTarget.value as SummaryOrientation,
                  }))}
                >
                  {SUMMARY_ORIENTATION_VALUES.map((orientation) => (
                    <option key={orientation} value={orientation}>
                      {summaryOrientationLabels[orientation]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-slate-600">
                  <span className="mb-1 block">线条颜色</span>
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded-md border border-slate-200 bg-white p-1 disabled:cursor-not-allowed disabled:bg-slate-100"
                    value={literalColor(model.lineColor, '#8B5CF6')}
                    disabled={readOnly}
                    aria-label="概要线颜色"
                    onChange={(event) => dispatchBoundaryPlan(() => planUpdateSummaryStyleCommand({
                      ...planBase,
                      border: {
                        color: {
                          kind: 'literal',
                          value: event.currentTarget.value.toUpperCase(),
                        },
                      },
                    }))}
                  />
                </label>
                <BoundaryNumberControl
                  label="线条粗细"
                  ariaLabel="概要线粗细"
                  value={model.lineWidth ?? 2}
                  max={1_000}
                  disabled={readOnly}
                  onCommit={(width) => dispatchBoundaryPlan(() => planUpdateSummaryStyleCommand({
                    ...planBase,
                    border: { width },
                  }))}
                />
              </div>

              <label className="block text-xs text-slate-600">
                <span className="mb-1 block">线型</span>
                <select
                  className={selectClassName}
                  value={model.lineStyle}
                  disabled={readOnly}
                  aria-label="概要线型"
                  onChange={(event) => dispatchBoundaryPlan(() => planUpdateSummaryLineStyleCommand({
                    ...planBase,
                    lineStyle: event.currentTarget.value as EditableRelationshipLineStyle,
                  }))}
                >
                  {model.lineStyle === 'custom' && <option value="custom" disabled>自定义虚线</option>}
                  {RELATIONSHIP_LINE_STYLE_VALUES.map((value) => (
                    <option key={value} value={value}>{lineStyleLabels[value]}</option>
                  ))}
                </select>
              </label>
            </section>
          )}

          {readOnly && (
            <p className="rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-400" role="status">
              只读模式下不能修改语义属性
            </p>
          )}
        </div>
      )}
    </aside>
  );
};
