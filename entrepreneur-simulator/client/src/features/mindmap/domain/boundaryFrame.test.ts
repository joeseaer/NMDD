import { describe, expect, it } from 'vitest';

import type { Boundary, BoundaryId, Rect } from './types';
import {
  BOUNDARY_FRAME_EXTENSION_KEY,
  deriveBoundaryFrame,
  readBoundaryFrameExtension,
  resizeBoundaryFrame,
  withBoundaryFrame,
} from './boundaryFrame';

const boundary = (): Boundary => ({
  id: 'boundary-frame-test' as BoundaryId,
  scope: { kind: 'explicit', topicIds: [] },
  padding: 16,
});

const members: Rect = { x: 100, y: 80, width: 240, height: 120 };

describe('Boundary manual frame extension', () => {
  it('keeps legacy uniform padding when no extension exists', () => {
    expect(deriveBoundaryFrame(members, boundary())).toEqual({
      x: 84,
      y: 64,
      width: 272,
      height: 152,
    });
  });

  it('persists asymmetric outsets and follows member relayout', () => {
    const resized = withBoundaryFrame(boundary(), members, {
      x: 70,
      y: 60,
      width: 320,
      height: 180,
    });
    expect(readBoundaryFrameExtension(resized)).toEqual({
      version: 1,
      outsets: { top: 20, right: 50, bottom: 40, left: 30 },
    });
    expect(deriveBoundaryFrame({ x: 300, y: 200, width: 260, height: 140 }, resized))
      .toEqual({ x: 270, y: 180, width: 340, height: 200 });
  });

  it('resizes all sides and corners without crossing scoped members', () => {
    const frame = { x: 80, y: 60, width: 280, height: 160 };
    expect(resizeBoundaryFrame(frame, members, 'e', { x: 40, y: 500 }))
      .toEqual({ x: 80, y: 60, width: 320, height: 160 });
    expect(resizeBoundaryFrame(frame, members, 'nw', { x: -20, y: -30 }))
      .toEqual({ x: 60, y: 30, width: 300, height: 190 });
    expect(resizeBoundaryFrame(frame, members, 'se', { x: -100, y: -100 }))
      .toEqual({ x: 80, y: 60, width: 260, height: 140 });
  });

  it('fails closed for malformed namespaced extension data', () => {
    const malformed = boundary();
    malformed.extensions = {
      [BOUNDARY_FRAME_EXTENSION_KEY]: {
        version: 1,
        outsets: { top: Number.NaN, right: 1, bottom: 1, left: 1 },
      },
    };
    expect(readBoundaryFrameExtension(malformed)).toBeUndefined();
    expect(deriveBoundaryFrame(members, malformed)).toEqual({
      x: 84,
      y: 64,
      width: 272,
      height: 152,
    });
  });
});
