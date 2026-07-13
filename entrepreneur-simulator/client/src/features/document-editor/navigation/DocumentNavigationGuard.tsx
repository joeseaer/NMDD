import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';

type NavigationFlushHandler = () => Promise<boolean>;

type DocumentNavigationContextValue = {
  register: (handler: NavigationFlushHandler) => () => void;
  requestNavigation: () => Promise<boolean>;
};

const DocumentNavigationContext = createContext<DocumentNavigationContextValue>({
  register: () => () => undefined,
  requestNavigation: async () => true,
});

export const DocumentNavigationGuardProvider = ({ children }: { children: ReactNode }) => {
  const handlersRef = useRef(new Map<symbol, NavigationFlushHandler>());
  const activeRequestRef = useRef<Promise<boolean> | null>(null);

  const register = useCallback((handler: NavigationFlushHandler) => {
    const id = Symbol('document-navigation-guard');
    handlersRef.current.set(id, handler);
    return () => handlersRef.current.delete(id);
  }, []);

  const requestNavigation = useCallback(async () => {
    if (activeRequestRef.current) return activeRequestRef.current;
    const request = (async () => {
      for (const handler of handlersRef.current.values()) {
        if (!await handler()) return false;
      }
      return true;
    })().finally(() => {
      activeRequestRef.current = null;
    });
    activeRequestRef.current = request;
    return request;
  }, []);

  const value = useMemo(() => ({ register, requestNavigation }), [register, requestNavigation]);
  return <DocumentNavigationContext.Provider value={value}>{children}</DocumentNavigationContext.Provider>;
};

export const useDocumentNavigationGuard = (
  handler: NavigationFlushHandler,
  enabled = true,
) => {
  const { register } = useContext(DocumentNavigationContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return register(() => handlerRef.current());
  }, [enabled, register]);
};

export const useDocumentNavigationRequest = () => (
  useContext(DocumentNavigationContext).requestNavigation
);

export const GuardedLink = ({ onClick, target, to, replace, state, ...rest }: LinkProps) => {
  const navigate = useNavigate();
  const requestNavigation = useDocumentNavigationRequest();

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || (target && target !== '_self')
    ) return;

    event.preventDefault();
    if (!await requestNavigation()) return;
    navigate(to, { replace, state });
  };

  return <Link {...rest} to={to} target={target} onClick={(event) => void handleClick(event)} />;
};
