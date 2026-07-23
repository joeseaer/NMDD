import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TopicId } from '../domain/types';
import type { TopicBadgeProjection } from './enrichmentProjection';
import { TopicBadges } from './TopicBadges';

const topicId = '018f0000-0000-7000-8000-000000000010' as TopicId;
const badges: readonly TopicBadgeProjection[] = [
  {
    kind: 'note',
    id: 'note-1',
    topicId,
    label: 'Project note',
    title: '笔记：Project note',
    tone: 'neutral',
  },
  {
    kind: 'label',
    id: `label:${topicId}:0`,
    topicId,
    label: 'urgent',
    title: '标签：urgent',
    displayText: '#urgent',
    tone: 'neutral',
  },
  {
    kind: 'attachment',
    id: 'attachment-1',
    topicId,
    label: 'missing.pdf',
    title: '附件：missing.pdf（资源缺失）',
    displayText: 'missing.pdf',
    tone: 'warning',
    missingReference: true,
  },
  {
    kind: 'task',
    id: 'task-1',
    topicId,
    label: '进行中 40%',
    title: '任务：进行中，进度 40%',
    displayText: '40%',
    tone: 'info',
    progress: 0.4,
  },
];

afterEach(cleanup);

describe('TopicBadges', () => {
  it('renders marker badges with the shared deterministic MarkerIcon artwork', () => {
    const markerBadge: TopicBadgeProjection = {
      kind: 'marker',
      id: 'marker-1',
      topicId,
      label: 'Priority 3',
      title: '标记：Priority 3（Priority），值：3',
      displayText: 'Priority 3',
      tone: 'info',
      markerSourceKind: 'builtin',
      markerSourceKey: 'priority-3',
    };
    render(<TopicBadges badges={[markerBadge]} />);

    const badge = screen.getByRole('img', { name: markerBadge.title });
    const markerIcon = badge.querySelector(
      'svg[data-marker-visual-key="priority-3"]',
    );
    expect(markerIcon).toBeInTheDocument();
    expect(markerIcon?.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(badge.querySelector('svg.lucide-flag')).not.toBeInTheDocument();
  });

  it('renders compact accessible controls and delegates activation by kind and ID', () => {
    const onActivate = vi.fn();
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    render(
      <div onClick={parentClick} onPointerDown={parentPointerDown}>
        <TopicBadges badges={badges} onActivate={onActivate} />
      </div>,
    );

    const attachment = screen.getByRole('button', {
      name: '附件：missing.pdf（资源缺失）',
    });
    expect(attachment).toHaveAttribute('title', '附件：missing.pdf（资源缺失）');
    expect(attachment).toHaveAttribute('data-topic-enrichment-kind', 'attachment');
    expect(attachment).toHaveAttribute('data-missing-reference', 'true');

    fireEvent.pointerDown(attachment);
    fireEvent.click(attachment);
    expect(onActivate).toHaveBeenCalledWith('attachment', 'attachment-1');
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(screen.getByText('#urgent')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('keeps badges non-interactive but labelled when no activation handler exists', () => {
    render(<TopicBadges badges={badges.slice(0, 2)} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '笔记：Project note' })).toHaveAttribute(
      'title',
      '笔记：Project note',
    );
    expect(screen.getByRole('img', { name: '标签：urgent' })).toBeInTheDocument();
  });

  it('only exposes buttons for enrichment kinds the host can currently edit', () => {
    render(
      <TopicBadges
        badges={badges}
        onActivate={vi.fn()}
        canActivate={(kind) => kind === 'note' || kind === 'label'}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '笔记：Project note' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '附件：missing.pdf（资源缺失）' })).toBeInTheDocument();
  });

  it('can compact overflow without changing source order', () => {
    render(<TopicBadges badges={badges} maxVisible={2} />);

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByTestId('topic-badges-overflow')).toHaveTextContent('+2');
    expect(screen.queryByLabelText('附件：missing.pdf（资源缺失）')).not.toBeInTheDocument();
    expect(badges.map((badge) => badge.kind)).toEqual([
      'note',
      'label',
      'attachment',
      'task',
    ]);
  });

  it('does not add empty badge chrome', () => {
    const { container } = render(<TopicBadges badges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
