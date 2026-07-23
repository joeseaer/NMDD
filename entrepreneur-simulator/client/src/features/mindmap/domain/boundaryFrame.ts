import type { Boundary, Rect } from './types';

export const BOUNDARY_FRAME_EXTENSION_KEY = 'app.nmdd.boundary-frame-v1';

export interface BoundaryFrameOutsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface BoundaryFrameExtensionV1 {
  readonly version: 1;
  readonly outsets: BoundaryFrameOutsets;
}

export type BoundaryFrameResizeHandle =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

const MAX_OUTSET = 10_000;

const validOutset = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= MAX_OUTSET;

export const isBoundaryFrameExtensionV1 = (
  value: unknown,
): value is BoundaryFrameExtensionV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as {
    version?: unknown;
    outsets?: Partial<Record<keyof BoundaryFrameOutsets, unknown>>;
  };
  return candidate.version === 1
    && Boolean(candidate.outsets)
    && validOutset(candidate.outsets?.top)
    && validOutset(candidate.outsets?.right)
    && validOutset(candidate.outsets?.bottom)
    && validOutset(candidate.outsets?.left);
};

export const readBoundaryFrameExtension = (
  boundary: Pick<Boundary, 'extensions'>,
): BoundaryFrameExtensionV1 | undefined => {
  const value = boundary.extensions?.[BOUNDARY_FRAME_EXTENSION_KEY];
  if (!isBoundaryFrameExtensionV1(value)) return undefined;
  return {
    version: 1,
    outsets: { ...value.outsets },
  };
};

export const boundaryFrameOutsets = (
  boundary: Pick<Boundary, 'padding' | 'extensions'>,
): BoundaryFrameOutsets => readBoundaryFrameExtension(boundary)?.outsets ?? {
  top: boundary.padding,
  right: boundary.padding,
  bottom: boundary.padding,
  left: boundary.padding,
};

export const deriveBoundaryFrame = (
  memberBounds: Readonly<Rect>,
  boundary: Pick<Boundary, 'padding' | 'extensions'>,
): Rect => {
  const outsets = boundaryFrameOutsets(boundary);
  return {
    x: memberBounds.x - outsets.left,
    y: memberBounds.y - outsets.top,
    width: memberBounds.width + outsets.left + outsets.right,
    height: memberBounds.height + outsets.top + outsets.bottom,
  };
};

const clampOutset = (value: number): number =>
  Math.min(MAX_OUTSET, Math.max(0, Math.round(value * 1_000_000) / 1_000_000));

/** Store a manually resized frame relative to the current member bounds. This
 * keeps the frame attached when topics later move or reflow. */
export const withBoundaryFrame = (
  boundary: Boundary,
  memberBounds: Readonly<Rect>,
  frame: Readonly<Rect>,
): Boundary => {
  const memberRight = memberBounds.x + memberBounds.width;
  const memberBottom = memberBounds.y + memberBounds.height;
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;
  const extension: BoundaryFrameExtensionV1 = {
    version: 1,
    outsets: {
      top: clampOutset(memberBounds.y - frame.y),
      right: clampOutset(frameRight - memberRight),
      bottom: clampOutset(frameBottom - memberBottom),
      left: clampOutset(memberBounds.x - frame.x),
    },
  };
  return {
    ...structuredClone(boundary),
    extensions: {
      ...(boundary.extensions ? structuredClone(boundary.extensions) : {}),
      [BOUNDARY_FRAME_EXTENSION_KEY]: extension,
    },
  };
};

export const withUniformBoundaryFrameOutsets = (
  boundary: Boundary,
  padding: number,
): Boundary => {
  if (readBoundaryFrameExtension(boundary) === undefined) {
    return { ...structuredClone(boundary), padding };
  }
  return {
    ...structuredClone(boundary),
    padding,
    extensions: {
      ...(boundary.extensions ? structuredClone(boundary.extensions) : {}),
      [BOUNDARY_FRAME_EXTENSION_KEY]: {
        version: 1,
        outsets: { top: padding, right: padding, bottom: padding, left: padding },
      } satisfies BoundaryFrameExtensionV1,
    },
  };
};

/** Resize one side or corner while keeping every scoped topic inside the
 * boundary. The operation is renderer-neutral and expressed in diagram space. */
export const resizeBoundaryFrame = (
  frame: Readonly<Rect>,
  memberBounds: Readonly<Rect>,
  handle: BoundaryFrameResizeHandle,
  delta: Readonly<{ x: number; y: number }>,
): Rect => {
  const currentRight = frame.x + frame.width;
  const currentBottom = frame.y + frame.height;
  let left = frame.x;
  let top = frame.y;
  let right = currentRight;
  let bottom = currentBottom;

  if (handle.includes('w')) left = Math.min(frame.x + delta.x, memberBounds.x);
  if (handle.includes('e')) {
    right = Math.max(currentRight + delta.x, memberBounds.x + memberBounds.width);
  }
  if (handle.includes('n')) top = Math.min(frame.y + delta.y, memberBounds.y);
  if (handle.includes('s')) {
    bottom = Math.max(currentBottom + delta.y, memberBounds.y + memberBounds.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};
