import { useEffect, useRef } from 'react';

// Wait for deliberate hover/focus instead of downloading every feature on boot.
export function useIntentPreload(preload: () => Promise<unknown> | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => cancel, []);
  const load = () => {
    cancel();
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
    // Failed speculation must not interrupt navigation; a click can retry.
    void preload()?.catch(() => undefined);
  };
  return {
    onMouseEnter: () => { cancel(); timerRef.current = setTimeout(load, 150); },
    onMouseLeave: cancel,
    onFocus: load,
    onTouchStart: load,
  };
}
