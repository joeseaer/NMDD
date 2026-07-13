type Segment = { segment: string };
type SegmenterInstance = { segment: (value: string) => Iterable<Segment> };
type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => SegmenterInstance;

const getGraphemes = (value: string): string[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }

  // Array.from keeps surrogate pairs intact on older engines. It cannot fully
  // group ZWJ sequences, but is still safer than String#slice.
  return Array.from(value);
};

export const takeGraphemes = (value: string, count: number): string => (
  getGraphemes(String(value || '')).slice(0, Math.max(0, count)).join('')
);

export const truncateGraphemes = (value: string, count: number, suffix = '…'): string => {
  const graphemes = getGraphemes(String(value || ''));
  if (graphemes.length <= count) return graphemes.join('');
  return `${graphemes.slice(0, Math.max(0, count)).join('')}${suffix}`;
};
