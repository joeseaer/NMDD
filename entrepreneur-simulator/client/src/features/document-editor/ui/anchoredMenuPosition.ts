export type AnchoredMenuSide = 'top' | 'bottom';

export type AnchoredMenuPosition = {
  left: number;
  top: number;
  side: AnchoredMenuSide;
};

type RectLike = Pick<DOMRect, 'bottom' | 'left' | 'top'>;

export const calculateAnchoredMenuPosition = ({
  anchor,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  gap = 8,
  margin = 8,
}: {
  anchor: RectLike;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  margin?: number;
}): AnchoredMenuPosition => {
  const spaceAbove = anchor.top - gap - margin;
  const spaceBelow = viewportHeight - anchor.bottom - gap - margin;
  const side: AnchoredMenuSide = spaceAbove >= menuHeight || spaceAbove >= spaceBelow
    ? 'top'
    : 'bottom';
  const preferredTop = side === 'top'
    ? anchor.top - gap - menuHeight
    : anchor.bottom + gap;
  const maximumLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  const maximumTop = Math.max(margin, viewportHeight - menuHeight - margin);

  return {
    side,
    left: Math.min(Math.max(anchor.left, margin), maximumLeft),
    top: Math.min(Math.max(preferredTop, margin), maximumTop),
  };
};
