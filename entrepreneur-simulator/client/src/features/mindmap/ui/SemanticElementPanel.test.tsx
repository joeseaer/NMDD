import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelationshipId } from '../domain/types';
import type { SemanticOverlayListItem } from './projection';
import { SemanticElementPanel } from './SemanticElementPanel';

const relationshipId = '018f0000-0000-7000-8000-000000000020' as RelationshipId;
const overlays: readonly SemanticOverlayListItem[] = [{
  kind: 'relationship',
  entityId: relationshipId,
  label: 'A → B',
  detail: '曲线',
  visibility: 'visible',
}];

afterEach(cleanup);

describe('SemanticElementPanel', () => {
  it('exposes selection-aware create, select, and delete controls', () => {
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const { rerender } = render(
      <SemanticElementPanel
        overlays={overlays}
        currentSelection={null}
        topicSelectionCount={2}
        summaryPreview={{ eligible: false, groupCount: 0, reason: '选择不合法。' }}
        readOnly={false}
        onCreate={onCreate}
        onSelect={onSelect}
        onDelete={onDelete}
      />,
    );

    const relationshipButton = screen.getByTestId('mindmap-create-relationship');
    expect(relationshipButton).toBeEnabled();
    expect(screen.getByTestId('mindmap-create-boundary')).toBeDisabled();
    fireEvent.click(relationshipButton);
    expect(onCreate).toHaveBeenCalledWith('relationship');

    fireEvent.click(screen.getByRole('button', { name: '选择关系 A → B' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'relationship', id: relationshipId });
    fireEvent.click(screen.getByTestId(`semantic-delete-relationship-${relationshipId}`));
    expect(onDelete).toHaveBeenCalledWith({ kind: 'relationship', id: relationshipId });

    rerender(
      <SemanticElementPanel
        overlays={overlays}
        currentSelection={{ kind: 'relationship', id: relationshipId }}
        topicSelectionCount={1}
        summaryPreview={{ eligible: true, groupCount: 1 }}
        readOnly={false}
        onCreate={onCreate}
        onSelect={onSelect}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByTestId(`semantic-item-relationship-${relationshipId}`))
      .toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('mindmap-create-boundary')).toBeEnabled();
    expect(screen.getByTestId('mindmap-create-summary')).toBeEnabled();
    expect(screen.getByTestId('mindmap-create-callout')).toBeEnabled();
  });

  it('keeps selection available but disables every mutation in read-only mode', () => {
    const onSelect = vi.fn();
    render(
      <SemanticElementPanel
        overlays={overlays}
        currentSelection={null}
        topicSelectionCount={2}
        summaryPreview={{ eligible: true, groupCount: 1 }}
        readOnly
        onCreate={vi.fn()}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mindmap-create-relationship')).toBeDisabled();
    expect(screen.getByTestId(`semantic-delete-relationship-${relationshipId}`)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '选择关系 A → B' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('enables multi-topic Summary creation and explains cross-branch splitting', () => {
    const onCreate = vi.fn();
    render(
      <SemanticElementPanel
        overlays={overlays}
        currentSelection={null}
        topicSelectionCount={4}
        summaryPreview={{
          eligible: true,
          groupCount: 2,
          splitPreview: '将因跨分支拆分为 2 个概要。',
        }}
        readOnly={false}
        onCreate={onCreate}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('已选 4 个主题')).toBeInTheDocument();
    expect(screen.getByTestId('mindmap-summary-preview'))
      .toHaveTextContent('将因跨分支拆分为 2 个概要。');
    expect(screen.getByTestId('mindmap-create-summary')).toBeEnabled();
    fireEvent.click(screen.getByTestId('mindmap-create-summary'));
    expect(onCreate).toHaveBeenCalledWith('summary');
  });
});
