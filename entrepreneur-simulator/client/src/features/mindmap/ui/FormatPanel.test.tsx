import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StyleBindingTarget } from '../commands/types';
import type { StyleBinding } from '../domain/types';
import { FormatPanel } from './FormatPanel';
import type { FormatSelectionEntry } from './formatSelection';

afterEach(cleanup);

const selectionEntry = (
  scope: StyleBindingTarget['scope'],
  id: string,
  binding?: StyleBinding,
): FormatSelectionEntry => ({
  target: { scope, id } as StyleBindingTarget,
  ...(binding ? { binding } : {}),
});

const topicSelection: readonly FormatSelectionEntry[] = [
  selectionEntry('topic', 'topic-a', {
    overrides: {
      fill: { color: { kind: 'literal', value: '#FF0000' } },
      typography: { fontSize: 14, fontWeight: 400, italic: false },
      border: { color: { kind: 'literal', value: '#111111' }, width: 1, radius: 8 },
      opacity: 0.8,
    },
  }),
  selectionEntry('topic', 'topic-b', {
    overrides: {
      fill: { color: { kind: 'literal', value: '#FF0000' } },
      typography: { fontSize: 18, fontWeight: 700, italic: false },
      border: { color: { kind: 'literal', value: '#111111' }, width: 1, radius: 8 },
      opacity: 0.8,
    },
  }),
];

describe('FormatPanel', () => {
  it('renders node controls with mixed values and emits minimal overrides and resets', () => {
    const onApply = vi.fn();
    const onReset = vi.fn();
    render(
      <FormatPanel
        selection={topicSelection}
        readOnly={false}
        onApply={onApply}
        onReset={onReset}
      />,
    );

    expect(screen.getByTestId('mindmap-format-panel')).toHaveAttribute('data-selection-kind', 'node');
    expect(screen.getByLabelText('填充色')).toBeEnabled();
    expect(screen.getByLabelText('字号')).toHaveAttribute('placeholder', '混合');
    expect(screen.getByRole('button', { name: '粗体' })).toHaveAttribute('aria-pressed', 'mixed');

    fireEvent.change(screen.getByLabelText('填充色'), { target: { value: '#00ff00' } });
    expect(onApply).toHaveBeenLastCalledWith({
      fill: { color: { kind: 'literal', value: '#00FF00' } },
    });

    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '24' } });
    fireEvent.blur(screen.getByLabelText('字号'));
    expect(onApply).toHaveBeenLastCalledWith({ typography: { fontSize: 24 } });

    fireEvent.click(screen.getByRole('button', { name: '粗体' }));
    expect(onApply).toHaveBeenLastCalledWith({ typography: { fontWeight: 700 } });
    fireEvent.click(screen.getByRole('button', { name: '斜体' }));
    expect(onApply).toHaveBeenLastCalledWith({ typography: { italic: true } });

    fireEvent.change(screen.getByLabelText('透明度'), { target: { value: '35' } });
    fireEvent.keyDown(screen.getByLabelText('透明度'), { key: 'Enter' });
    expect(onApply).toHaveBeenLastCalledWith({ opacity: 0.35 });

    fireEvent.click(screen.getByRole('button', { name: '重置边框格式' }));
    expect(onReset).toHaveBeenLastCalledWith([
      'border.color',
      'border.width',
      'border.radius',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '恢复全部默认' }));
    expect(onReset).toHaveBeenLastCalledWith();
  });

  it('uses a native keyboard-operable disclosure control', async () => {
    const user = userEvent.setup();
    render(
      <FormatPanel
        selection={topicSelection}
        readOnly={false}
        onApply={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const disclosure = screen.getByRole('button', { name: /格式.*已选 2 项/ });
    disclosure.focus();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('mindmap-format-panel-content')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('mindmap-format-panel-content')).toBeInTheDocument();
  });

  it('shows only legal connector controls for Relationship selections', () => {
    const onApply = vi.fn();
    const onReset = vi.fn();
    render(
      <FormatPanel
        selection={[
          selectionEntry('relationship', 'relationship-a', {
            overrides: {
              connector: {
                color: { kind: 'literal', value: '#334155' },
                width: 2,
                dash: [],
              },
            },
          }),
        ]}
        readOnly={false}
        onApply={onApply}
        onReset={onReset}
      />,
    );

    expect(screen.getByTestId('mindmap-format-panel')).toHaveAttribute('data-selection-kind', 'connector');
    expect(screen.queryByLabelText('填充色')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('文字色')).not.toBeInTheDocument();
    expect(screen.getByLabelText('线条颜色')).toBeEnabled();
    expect(screen.getByLabelText('线条粗细')).toBeEnabled();
    expect(screen.getByLabelText('虚线')).toBeEnabled();

    fireEvent.change(screen.getByLabelText('线条颜色'), { target: { value: '#abcdef' } });
    fireEvent.change(screen.getByLabelText('线条粗细'), { target: { value: '3.5' } });
    fireEvent.blur(screen.getByLabelText('线条粗细'));
    fireEvent.change(screen.getByLabelText('虚线'), { target: { value: 'dashed' } });

    expect(onApply.mock.calls).toEqual([
      [{ connector: { color: { kind: 'literal', value: '#ABCDEF' } } }],
      [{ connector: { width: 3.5 } }],
      [{ connector: { dash: [6, 4] } }],
    ]);
    for (const [overrides] of onApply.mock.calls) {
      expect(Object.keys(overrides)).toEqual(['connector']);
      expect(Object.keys(overrides.connector).every((key) => ['color', 'width', 'dash'].includes(key)))
        .toBe(true);
    }

    fireEvent.click(screen.getByRole('button', { name: '重置连接线格式' }));
    expect(onReset).toHaveBeenCalledWith([
      'connector.color',
      'connector.width',
      'connector.dash',
    ]);
  });

  it('disables every mutation while keeping disclosure available in read-only mode', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onReset = vi.fn();
    render(
      <FormatPanel
        selection={topicSelection}
        readOnly
        onApply={onApply}
        onReset={onReset}
      />,
    );

    expect(screen.getByLabelText('填充色')).toBeDisabled();
    expect(screen.getByLabelText('字号')).toBeDisabled();
    expect(screen.getByRole('button', { name: '粗体' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重置文字格式' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复全部默认' })).toBeDisabled();

    const disclosure = screen.getByRole('button', { name: /格式.*已选 2 项/ });
    expect(disclosure).toBeEnabled();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(onApply).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });
});

