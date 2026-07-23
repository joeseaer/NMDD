import type { CSSProperties } from 'react';

import type { MarkerVisual } from './markerVisuals';

export interface MarkerIconProps {
  readonly className?: string;
  readonly label?: string;
  readonly size?: number;
  readonly style?: CSSProperties;
  readonly visual: MarkerVisual;
}

/** Font-independent marker artwork shared by the panel, topic and legend UI. */
export const MarkerIcon = ({
  className,
  label,
  size = 16,
  style,
  visual,
}: MarkerIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={visual.viewBox}
    width={size}
    height={size}
    className={className}
    style={style}
    focusable="false"
    aria-hidden={label ? undefined : 'true'}
    aria-label={label}
    role={label ? 'img' : undefined}
    data-marker-visual-key={visual.key}
  >
    {label ? <title>{label}</title> : null}
    {visual.paths.map((item, index) => (
      <path
        // Geometry plus index is stable within the immutable release definition.
        key={`${item.d}:${index}`}
        d={item.d}
        fill={item.fill}
        opacity={item.opacity}
        stroke={item.stroke}
        strokeLinecap={item.strokeLinecap}
        strokeLinejoin={item.strokeLinejoin}
        strokeWidth={item.strokeWidth}
      />
    ))}
  </svg>
);
