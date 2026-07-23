import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRelationshipResource } from './useRelationshipResource';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
};

function Probe({ resourceKey, load }: { resourceKey: string; load: (key: string, signal: AbortSignal) => Promise<string> }) {
  const resource = useRelationshipResource(resourceKey, (signal) => load(resourceKey, signal));
  return <div data-testid="value">{resource.data || resource.status}</div>;
}

describe('useRelationshipResource', () => {
  it('ignores a stale response after the resource key changes', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = (key: string) => key === 'person-a' ? first.promise : second.promise;
    const view = render(<Probe resourceKey="person-a" load={load} />);

    view.rerender(<Probe resourceKey="person-b" load={load} />);
    await act(async () => { first.resolve('A 的旧数据'); await first.promise; });
    expect(screen.getByTestId('value')).not.toHaveTextContent('A 的旧数据');

    await act(async () => { second.resolve('B 的当前数据'); await second.promise; });
    expect(screen.getByTestId('value')).toHaveTextContent('B 的当前数据');
  });
});
