import type { MarkerDefinition } from '../domain/types';

export interface MarkerVectorPath {
  readonly d: string;
  readonly fill: string;
  readonly opacity?: number;
  readonly stroke?: string;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'bevel' | 'miter' | 'round';
  readonly strokeWidth?: number;
}

export interface MarkerVisual {
  readonly key: string;
  readonly viewBox: '0 0 24 24';
  readonly paths: readonly MarkerVectorPath[];
  readonly surfaceColor: string;
  readonly borderColor: string;
  readonly toneClassName: string;
}

const path = (
  d: string,
  fill: string,
  options: Omit<MarkerVectorPath, 'd' | 'fill'> = {},
): MarkerVectorPath => Object.freeze({ d, fill, ...options });

const segmentPath = (segments: readonly string[]): string => {
  const geometry: Readonly<Record<string, string>> = {
    a: 'M9 5h6v2H9z',
    b: 'M14 6h2v5h-2z',
    c: 'M14 13h2v5h-2z',
    d: 'M9 17h6v2H9z',
    e: 'M8 13h2v5H8z',
    f: 'M8 6h2v5H8z',
    g: 'M9 11h6v2H9z',
  };
  return segments.map((segment) => geometry[segment]).join(' ');
};

const digitSegments: Readonly<Record<string, readonly string[]>> = {
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
};

const visual = (
  key: string,
  paths: readonly MarkerVectorPath[],
  colors: {
    readonly border: string;
    readonly surface: string;
    readonly toneClassName: string;
  },
): MarkerVisual => Object.freeze({
  key,
  viewBox: '0 0 24 24',
  paths: Object.freeze(paths),
  surfaceColor: colors.surface,
  borderColor: colors.border,
  toneClassName: colors.toneClassName,
});

const PRIORITY_COLORS = {
  border: '#fecaca',
  surface: '#fef2f2',
  toneClassName: 'border-red-200 bg-red-50 text-red-700',
} as const;
const PROGRESS_COLORS = {
  border: '#bfdbfe',
  surface: '#eff6ff',
  toneClassName: 'border-blue-200 bg-blue-50 text-blue-700',
} as const;
const AMBER_COLORS = {
  border: '#fde68a',
  surface: '#fffbeb',
  toneClassName: 'border-amber-200 bg-amber-50 text-amber-700',
} as const;
const CYAN_COLORS = {
  border: '#a5f3fc',
  surface: '#ecfeff',
  toneClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
} as const;
const VIOLET_COLORS = {
  border: '#ddd6fe',
  surface: '#f5f3ff',
  toneClassName: 'border-violet-200 bg-violet-50 text-violet-700',
} as const;

const priorityVisual = (key: string): MarkerVisual => {
  const digit = key.slice(-1);
  return visual(key, [
    path('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z', '#dc2626'),
    path(segmentPath(digitSegments[digit] ?? digitSegments['1']), '#ffffff'),
  ], PRIORITY_COLORS);
};

const progressVisual = (key: string): MarkerVisual => {
  const progress = Number(key.slice('progress-'.length));
  const paths: MarkerVectorPath[] = [
    path('M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z', 'none', {
      stroke: '#1d4ed8',
      strokeWidth: 2,
    }),
  ];
  if (progress >= 100) {
    paths.push(path('M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z', '#2563eb'));
  } else if (progress >= 75) {
    paths.push(path('M12 12V4a8 8 0 1 1-8 8Z', '#2563eb'));
  } else if (progress >= 50) {
    paths.push(path('M12 4a8 8 0 0 1 0 16Z', '#2563eb'));
  } else if (progress >= 25) {
    paths.push(path('M12 12V4a8 8 0 0 1 8 8Z', '#2563eb'));
  }
  return visual(key, paths, PROGRESS_COLORS);
};

const flagVisual = (key: string): MarkerVisual => {
  const color = key === 'flag-red'
    ? '#dc2626'
    : key === 'flag-yellow'
      ? '#ca8a04'
      : key === 'flag-green'
        ? '#16a34a'
        : '#2563eb';
  return visual(key, [
    path('M5 3h2v18H5z', '#475569'),
    path('M7 4h11l-2.7 4L18 12H7Z', color),
  ], {
    border: `${color}55`,
    surface: `${color}12`,
    toneClassName: key === 'flag-green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : key === 'flag-blue'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : key === 'flag-yellow'
          ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
          : 'border-red-200 bg-red-50 text-red-700',
  });
};

const starPath = 'M12 2.8l2.76 5.59 6.17.9-4.47 4.35 1.06 6.14L12 16.88l-5.52 2.9 1.06-6.14-4.47-4.35 6.17-.9Z';

const arrowVisual = (key: string): MarkerVisual => {
  const directions: Readonly<Record<string, string>> = {
    'arrow-up': 'M12 20V5m-5 5 5-5 5 5',
    'arrow-right': 'M4 12h15m-5-5 5 5-5 5',
    'arrow-down': 'M12 4v15m5-5-5 5-5-5',
    'arrow-left': 'M20 12H5m5 5-5-5 5-5',
  };
  return visual(key, [path(directions[key] ?? directions['arrow-right'], 'none', {
    stroke: '#0e7490',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2.6,
  })], CYAN_COLORS);
};

const customVisual = (key: string): MarkerVisual => {
  const shapes: Readonly<Record<string, string>> = {
    'custom-circle': 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z',
    'custom-square': 'M5 5h14v14H5Z',
    'custom-triangle': 'M12 4 21 20H3Z',
    'custom-diamond': 'M12 3 21 12 12 21 3 12Z',
  };
  return visual(key, [path(shapes[key] ?? shapes['custom-diamond'], '#7c3aed')], VIOLET_COLORS);
};

export const markerVisualForSource = (
  sourceKind: 'asset' | 'builtin' | undefined,
  sourceKey: string | undefined,
): MarkerVisual => {
  if (sourceKind === 'asset') {
    return visual('asset-marker', [
      path('M4 5h16v14H4Z', 'none', { stroke: '#7c3aed', strokeWidth: 2 }),
      path('m6.5 16 3.2-3.4 2.3 2.1 2.7-3.1 2.8 4.4Z', '#7c3aed'),
      path('M15.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z', '#7c3aed'),
    ], VIOLET_COLORS);
  }
  const key = sourceKey ?? 'custom-diamond';
  if (/^priority-[1-5]$/u.test(key)) return priorityVisual(key);
  if (/^progress-(?:0|25|50|75|100)$/u.test(key)) return progressVisual(key);
  if (/^flag-(?:red|yellow|green|blue)$/u.test(key)) return flagVisual(key);
  if (key === 'star-filled') return visual(key, [path(starPath, '#d97706')], AMBER_COLORS);
  if (key === 'star-outline') return visual(key, [path(starPath, 'none', {
    stroke: '#d97706',
    strokeLinejoin: 'round',
    strokeWidth: 2,
  })], AMBER_COLORS);
  if (/^arrow-(?:up|right|down|left)$/u.test(key)) return arrowVisual(key);
  return customVisual(key);
};

export const markerVisual = (definition: MarkerDefinition): MarkerVisual => (
  definition.source.kind === 'builtin'
    ? markerVisualForSource('builtin', definition.source.key)
    : markerVisualForSource('asset', undefined)
);
