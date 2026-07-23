import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResourceStatus } from './model';

export interface RelationshipResource<T> {
  data: T | null;
  error: string | null;
  status: ResourceStatus;
  loading: boolean;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return '暂时无法读取数据，请稍后重试。';
};

export function useRelationshipResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
): RelationshipResource<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const requestSequence = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ResourceStatus>(key ? 'loading' : 'idle');

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setStatus('loading');
    setError(null);

    void loaderRef.current(controller.signal)
      .then((nextData) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        setData(nextData);
        setStatus('success');
      })
      .catch((nextError: unknown) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        setError(errorMessage(nextError));
        setStatus('error');
      });

    return () => controller.abort();
  }, [key, reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return {
    data,
    error,
    status,
    loading: status === 'loading',
    reload,
    setData,
  };
}
