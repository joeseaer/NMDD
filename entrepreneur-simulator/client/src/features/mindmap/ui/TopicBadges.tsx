import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CheckCircle2,
  Circle,
  Image as ImageIcon,
  Link2,
  ListTodo,
  Paperclip,
  PieChart,
  StickyNote,
  Tag,
  type LucideIcon,
} from 'lucide-react';

import type {
  TopicBadgeProjection,
  TopicBadgeTone,
  TopicEnrichmentKind,
} from './enrichmentProjection';
import { MarkerIcon } from './MarkerIcon';
import { markerVisualForSource } from './markerVisuals';

export interface TopicBadgesProps {
  readonly badges: readonly TopicBadgeProjection[];
  readonly className?: string;
  /** Optional compacting limit. Omit it to render every canonical badge. */
  readonly maxVisible?: number;
  onActivate?(kind: TopicEnrichmentKind, id: string): void;
  canActivate?(kind: TopicEnrichmentKind, id: string): boolean;
}

const toneClassName: Readonly<Record<TopicBadgeTone, string>> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
  muted: 'border-slate-200 bg-slate-100 text-slate-400',
};

const badgeIcon = (badge: TopicBadgeProjection): LucideIcon | null => {
  switch (badge.kind) {
    case 'marker':
      return null;
    case 'label':
      return Tag;
    case 'note':
      return StickyNote;
    case 'link':
      return Link2;
    case 'image':
      return ImageIcon;
    case 'attachment':
      return Paperclip;
    case 'todo':
      return badge.progress === 1 ? CheckCircle2 : Circle;
    case 'todo-progress':
      return PieChart;
    case 'task':
      return ListTodo;
  }
};

const badgeClassName = (badge: TopicBadgeProjection): string =>
  `nodrag nopan nowheel inline-flex h-5 max-w-[7rem] shrink-0 items-center gap-0.5 rounded border px-1 text-[9px] font-medium leading-none ${toneClassName[badge.tone]}`;

const stopMousePropagation = (event: ReactMouseEvent<HTMLElement>): void => {
  event.stopPropagation();
};

const stopPointerPropagation = (event: ReactPointerEvent<HTMLElement>): void => {
  event.stopPropagation();
};

const BadgeContent = ({ badge }: { readonly badge: TopicBadgeProjection }) => {
  const Icon = badgeIcon(badge);
  return (
    <>
      {badge.kind === 'marker' ? (
        <MarkerIcon
          visual={markerVisualForSource(badge.markerSourceKind, badge.markerSourceKey)}
          size={12}
          className="shrink-0"
        />
      ) : Icon ? (
        <Icon size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      ) : null}
      {badge.displayText ? (
        <span className="min-w-0 truncate">{badge.displayText}</span>
      ) : null}
      {badge.missingReference ? (
        <span className="shrink-0 font-bold" aria-hidden="true">!</span>
      ) : null}
    </>
  );
};

/** Compact, read-only indicators. Activation is delegated to the host UI. */
export const TopicBadges = ({
  badges,
  className,
  maxVisible,
  onActivate,
  canActivate,
}: TopicBadgesProps) => {
  if (badges.length === 0) return null;

  const visibleCount = maxVisible === undefined
    ? badges.length
    : Math.min(badges.length, Math.max(0, Math.floor(maxVisible)));
  const visibleBadges = badges.slice(0, visibleCount);
  const hiddenBadges = badges.slice(visibleCount);

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-0.5${className ? ` ${className}` : ''}`}
      aria-label="主题增强内容"
      data-testid="topic-badges"
      onMouseDown={stopMousePropagation}
      onPointerDown={stopPointerPropagation}
    >
      {visibleBadges.map((badge) => {
        const key = `${badge.kind}:${badge.id}`;
        const dataAttributes = {
          'data-topic-enrichment-kind': badge.kind,
          'data-entity-id': badge.id,
          'data-missing-reference': badge.missingReference ? 'true' : 'false',
        } as const;

        return onActivate && (canActivate?.(badge.kind, badge.id) ?? true) ? (
          <button
            key={key}
            type="button"
            className={`${badgeClassName(badge)} cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
            title={badge.title}
            aria-label={badge.title}
            onClick={(event) => {
              event.stopPropagation();
              onActivate(badge.kind, badge.id);
            }}
            {...dataAttributes}
          >
            <BadgeContent badge={badge} />
          </button>
        ) : (
          <span
            key={key}
            className={badgeClassName(badge)}
            title={badge.title}
            role="img"
            aria-label={badge.title}
            {...dataAttributes}
          >
            <BadgeContent badge={badge} />
          </span>
        );
      })}

      {hiddenBadges.length > 0 ? (
        <span
          className="inline-flex h-5 shrink-0 items-center rounded border border-slate-200 bg-slate-50 px-1 text-[9px] font-medium leading-none text-slate-500"
          title={hiddenBadges.map((badge) => badge.title).join('\n')}
          role="img"
          aria-label={`另有 ${hiddenBadges.length} 项主题增强内容`}
          data-testid="topic-badges-overflow"
        >
          +{hiddenBadges.length}
        </span>
      ) : null}
    </div>
  );
};
