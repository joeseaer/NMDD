import { describe, expect, it } from 'vitest';
import { resolveMindMapV2Flag } from './featureFlags';

describe('resolveMindMapV2Flag', () => {
  it('enables V2 by default for every editor surface', () => {
    expect(resolveMindMapV2Flag({ pathname: '/editor-lab' })).toBe(true);
    expect(resolveMindMapV2Flag({ pathname: '/planner', isDevelopment: true })).toBe(true);
    expect(resolveMindMapV2Flag({ pathname: '/planner', isDevelopment: false })).toBe(true);
  });

  it('lets an explicit query override every other source', () => {
    expect(resolveMindMapV2Flag({
      pathname: '/planner',
      search: '?mindmapV2=1',
      isDevelopment: false,
      environmentValue: 'false',
    })).toBe(true);
    expect(resolveMindMapV2Flag({
      pathname: '/editor-lab',
      search: '?mindmapV2=off',
      isDevelopment: true,
      environmentValue: 'true',
    })).toBe(false);
  });

  it('supports an environment override without accepting ambiguous values', () => {
    expect(resolveMindMapV2Flag({ pathname: '/planner', environmentValue: 'enabled' })).toBe(true);
    expect(resolveMindMapV2Flag({ pathname: '/editor-lab', environmentValue: '0' })).toBe(false);
    expect(resolveMindMapV2Flag({ pathname: '/planner', environmentValue: 'sometimes' })).toBe(true);
  });
});
