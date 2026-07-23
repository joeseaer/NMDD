import type { MouseEvent as ReactMouseEvent } from 'react';
import { BoxSelect, Link2, MessageSquareText, Sigma, Trash2 } from 'lucide-react';

import type { ElementRef } from '../domain/types';
import type {
  SemanticOverlayKind,
  SemanticOverlayListItem,
} from './projection';
import {
  isDeletableSemanticElementRef,
  type BoundaryCreationPreview,
  type DeletableSemanticElementRef,
  type SemanticCreateKind,
  type SummaryCreationPreview,
} from './semanticPlanning';

const overlayKindLabel: Record<SemanticOverlayKind, string> = {
  boundary: '边界',
  summary: '概要',
  callout: '标注',
  zone: '区域',
  relationship: '关系',
};

export const elementRefForSemanticOverlay = (
  kind: SemanticOverlayKind,
  entityId: string,
): ElementRef => ({ kind, id: entityId } as ElementRef);

const sameElementRef = (
  left: ElementRef | null,
  right: ElementRef | null,
): boolean => left?.kind === right?.kind && left?.id === right?.id;

export interface SemanticElementPanelProps {
  readonly overlays: readonly SemanticOverlayListItem[];
  readonly currentSelection: ElementRef | null;
  readonly topicSelectionCount: number;
  readonly boundaryPreview?: BoundaryCreationPreview;
  readonly summaryPreview?: SummaryCreationPreview;
  readonly readOnly: boolean;
  onCreate(kind: SemanticCreateKind): void;
  onSelect(reference: ElementRef): void;
  onDelete(reference: DeletableSemanticElementRef): void;
}

interface CreateAction {
  readonly kind: SemanticCreateKind;
  readonly label: string;
  readonly icon: typeof Link2;
  readonly enabled: boolean;
}

export const SemanticElementPanel = ({
  overlays,
  currentSelection,
  topicSelectionCount,
  boundaryPreview,
  summaryPreview,
  readOnly,
  onCreate,
  onSelect,
  onDelete,
}: SemanticElementPanelProps) => {
  const effectiveBoundaryPreview = boundaryPreview ?? {
    eligible: topicSelectionCount === 1,
    groupCount: topicSelectionCount === 1 ? 1 : 0,
    reason: '选择一个主题后新增边界',
  };
  const effectiveSummaryPreview = summaryPreview ?? {
    eligible: topicSelectionCount === 1,
    groupCount: topicSelectionCount === 1 ? 1 : 0,
    reason: '选择一个或多个主题后新增概要',
  };
  const actions: readonly CreateAction[] = [
    {
      kind: 'relationship',
      label: '关系',
      icon: Link2,
      enabled: topicSelectionCount === 2,
    },
    {
      kind: 'boundary',
      label: '边界',
      icon: BoxSelect,
      enabled: effectiveBoundaryPreview.eligible,
    },
    {
      kind: 'summary',
      label: '概要',
      icon: Sigma,
      enabled: effectiveSummaryPreview.eligible,
    },
    {
      kind: 'callout',
      label: '标注',
      icon: MessageSquareText,
      enabled: topicSelectionCount === 1,
    },
  ];

  return (
    <aside
      className="nowheel nodrag absolute bottom-3 right-3 z-20 flex max-h-64 w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur"
      data-testid="mindmap-semantic-panel"
      aria-label="语义元素"
      onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          语义元素
        </div>
        <div className="text-[10px] text-slate-400">
          {topicSelectionCount > 0 ? `已选 ${topicSelectionCount} 个主题` : '先选择主题'}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-1" aria-label="新增语义元素">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.kind}
              type="button"
              className="flex min-w-0 flex-col items-center gap-0.5 rounded border border-slate-200 bg-white px-1 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => onCreate(action.kind)}
              disabled={readOnly || !action.enabled}
              data-testid={`mindmap-create-${action.kind}`}
              aria-label={`新增${action.label}`}
              title={action.kind === 'relationship'
                ? '选择恰好两个主题后新增关系'
                : action.kind === 'boundary'
                  ? effectiveBoundaryPreview.splitPreview ?? effectiveBoundaryPreview.reason ?? '为所选连续范围新增边界'
                  : action.kind === 'summary'
                    ? effectiveSummaryPreview.splitPreview ?? effectiveSummaryPreview.reason ?? '为所选连续范围新增概要'
                    : `选择一个主题后新增${action.label}`}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      {(effectiveBoundaryPreview.splitPreview || (!effectiveBoundaryPreview.eligible && topicSelectionCount > 0)) && (
        <p
          className={`mb-2 rounded px-2 py-1 text-[10px] ${effectiveBoundaryPreview.eligible ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
          data-testid="mindmap-boundary-preview"
          role="status"
        >
          {effectiveBoundaryPreview.splitPreview ?? effectiveBoundaryPreview.reason}
        </p>
      )}

      {(effectiveSummaryPreview.splitPreview || (!effectiveSummaryPreview.eligible && topicSelectionCount > 0)) && (
        <p
          className={`mb-2 rounded px-2 py-1 text-[10px] ${effectiveSummaryPreview.eligible ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'}`}
          data-testid="mindmap-summary-preview"
          role="status"
        >
          {effectiveSummaryPreview.splitPreview ?? effectiveSummaryPreview.reason}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-auto" data-testid="mindmap-semantic-list">
        {overlays.length === 0 && (
          <div className="rounded bg-slate-50 px-2 py-2 text-center text-[10px] text-slate-400">
            暂无语义元素
          </div>
        )}
        {overlays.map((item) => {
          const reference = elementRefForSemanticOverlay(item.kind, item.entityId);
          const selected = sameElementRef(currentSelection, reference);
          const deletable = isDeletableSemanticElementRef(reference);
          return (
            <div
              key={`${item.kind}:${item.entityId}`}
              className={`flex items-center gap-1 rounded ${selected ? 'bg-blue-100' : 'hover:bg-slate-100'}`}
              data-testid={`semantic-item-${item.kind}-${item.entityId}`}
              data-selected={selected ? 'true' : 'false'}
            >
              <button
                type="button"
                className={`min-w-0 flex-1 px-2 py-1 text-left text-[11px] ${selected ? 'text-blue-800' : 'text-slate-700'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(reference);
                }}
                aria-label={`选择${overlayKindLabel[item.kind]} ${item.label}`}
                aria-pressed={selected}
              >
                <span className="font-semibold">{overlayKindLabel[item.kind]}</span>
                <span className="ml-1">{item.label}</span>
                <span className="ml-1 text-slate-400">· {item.detail}</span>
                {item.visibility !== 'visible' && (
                  <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] text-slate-500">
                    {item.visibility}
                  </span>
                )}
              </button>
              {deletable && (
                <button
                  type="button"
                  className="mr-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(reference);
                  }}
                  disabled={readOnly}
                  data-testid={`semantic-delete-${item.kind}-${item.entityId}`}
                  aria-label={`删除${overlayKindLabel[item.kind]} ${item.label}`}
                  title={`删除${overlayKindLabel[item.kind]}`}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
