import { describe, expect, it } from 'vitest';

import type { StyleBindingTarget } from '../commands/types';
import type { StyleBinding } from '../domain/types';
import {
  buildFormatSelectionModel,
  constrainFormatOverrides,
  getFormatSelectionKind,
  type FormatSelectionEntry,
} from './formatSelection';

const target = (
  scope: StyleBindingTarget['scope'],
  id: string,
): StyleBindingTarget => ({ scope, id } as StyleBindingTarget);

const entry = (
  scope: StyleBindingTarget['scope'],
  id: string,
  binding?: StyleBinding,
): FormatSelectionEntry => ({
  target: target(scope, id),
  ...(binding ? { binding } : {}),
});

describe('format selection model', () => {
  it('distinguishes common, mixed, and inherited local override values', () => {
    const selection = [
      entry('topic', 'topic-a', {
        overrides: {
          fill: { color: { kind: 'literal', value: '#FF0000' } },
          typography: { fontSize: 14, fontWeight: 700, italic: true },
          border: { width: 1 },
          opacity: 0.5,
        },
      }),
      entry('topic', 'topic-b', {
        overrides: {
          fill: { color: { kind: 'literal', value: '#FF0000' } },
          typography: { fontSize: 18, fontWeight: 600 },
          border: { width: 1 },
          opacity: 0.5,
        },
      }),
    ] as const;

    const model = buildFormatSelectionModel(selection);
    expect(model).toMatchObject({ kind: 'node', count: 2, hasRelationship: false });
    expect(model.fields.fillColor).toEqual({
      kind: 'value',
      value: { kind: 'literal', value: '#FF0000' },
    });
    expect(model.fields.fontSize).toEqual({ kind: 'mixed' });
    expect(model.fields.bold).toEqual({ kind: 'value', value: true });
    expect(model.fields.italic).toEqual({ kind: 'mixed' });
    expect(model.fields.borderWidth).toEqual({ kind: 'value', value: 1 });
    expect(model.fields.borderColor).toEqual({ kind: 'default' });
    expect(model.fields.opacity).toEqual({ kind: 'value', value: 0.5 });
  });

  it('classifies connector and incompatible selections deterministically', () => {
    expect(getFormatSelectionKind([])).toBe('empty');
    expect(getFormatSelectionKind([
      entry('tree-edge', 'edge-a'),
      entry('relationship', 'relationship-a'),
    ])).toBe('connector');
    expect(getFormatSelectionKind([
      entry('topic', 'topic-a'),
      entry('boundary', 'boundary-a'),
    ])).toBe('node');
    expect(getFormatSelectionKind([
      entry('topic', 'topic-a'),
      entry('relationship', 'relationship-a'),
    ])).toBe('incompatible');
  });

  it('preserves connector arrays in the model without mutating bindings', () => {
    const binding: StyleBinding = {
      overrides: { connector: { width: 3, dash: [6, 4] } },
    };
    const model = buildFormatSelectionModel([
      entry('relationship', 'relationship-a', binding),
      entry('tree-edge', 'edge-a', {
        overrides: { connector: { width: 3, dash: [6, 4] } },
      }),
    ]);

    expect(model.fields.connectorWidth).toEqual({ kind: 'value', value: 3 });
    expect(model.fields.connectorDash).toEqual({ kind: 'value', value: [6, 4] });
    expect(binding.overrides?.connector?.dash).toEqual([6, 4]);
  });

  it('constrains connector and Relationship output to legal editable fields', () => {
    const dash = [5, 2];
    const constrained = constrainFormatOverrides(
      [entry('relationship', 'relationship-a')],
      {
        opacity: 0.25,
        fill: { color: { kind: 'literal', value: '#FFFFFF' } },
        connector: {
          color: { kind: 'literal', value: '#123456' },
          width: 4,
          dash,
          shape: 'curve',
          endCap: 'arrow',
        },
      },
    );

    expect(constrained).toEqual({
      connector: {
        color: { kind: 'literal', value: '#123456' },
        width: 4,
        dash: [5, 2],
      },
    });
    expect(constrained.connector?.dash).not.toBe(dash);
  });
});

