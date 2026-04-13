import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SessionPanelLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface SessionPanelResourceResult<T> {
  loadState: SessionPanelLoadState;
  data: T;
  errorMessage: string | null;
}

export interface UseSessionPanelResourceOptions<T> {
  sessionId?: string | null;
  refreshSignal?: number;
  initialData: T;
  load: (sessionId: string, signal: AbortSignal) => Promise<T>;
  normalizeErrorMessage: (error: unknown) => string;
}

export function useSessionPanelResource<T>(options: UseSessionPanelResourceOptions<T>): SessionPanelResourceResult<T> {
  const {
    sessionId = null,
    refreshSignal = 0,
    initialData,
    load,
    normalizeErrorMessage
  } = options;

  const initialDataRef = useRef(initialData);
  const activeSessionRef = useRef<string | null>(sessionId);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [loadState, setLoadState] = useState<SessionPanelLoadState>(sessionId ? 'loading' : 'idle');
  const [data, setData] = useState<T>(initialDataRef.current);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRef = useRef(load);
  const normalizeErrorMessageRef = useRef(normalizeErrorMessage);
  loadRef.current = load;
  normalizeErrorMessageRef.current = normalizeErrorMessage;

  const executeLoad = useCallback(() => {
    const targetSessionId = activeSessionRef.current;
    if (!targetSessionId || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoadState((current) => (current === 'ready' ? 'ready' : 'loading'));
    setErrorMessage(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    loadRef.current(targetSessionId, controller.signal)
      .then((nextData) => {
        if (requestVersionRef.current !== requestVersion || activeSessionRef.current !== targetSessionId) {
          return;
        }
        setData(nextData);
        setLoadState('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        if (requestVersionRef.current !== requestVersion || activeSessionRef.current !== targetSessionId) {
          return;
        }
        setLoadState('error');
        setErrorMessage(normalizeErrorMessageRef.current(error));
      })
      .finally(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        inFlightRef.current = false;
        if (queuedRef.current) {
          queuedRef.current = false;
          executeLoad();
        }
      });
  }, []);

  const normalizedSessionId = useMemo(() => {
    return sessionId && sessionId.trim() ? sessionId : null;
  }, [sessionId]);

  useEffect(() => {
    const sessionChanged = activeSessionRef.current !== normalizedSessionId;
    activeSessionRef.current = normalizedSessionId;

    if (!normalizedSessionId) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      queuedRef.current = false;
      inFlightRef.current = false;
      setData(initialDataRef.current);
      setLoadState('idle');
      setErrorMessage(null);
      return undefined;
    }

    if (sessionChanged) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      queuedRef.current = false;
      inFlightRef.current = false;
      setData(initialDataRef.current);
      setLoadState('loading');
      setErrorMessage(null);
    }

    if (inFlightRef.current) {
      queuedRef.current = true;
    } else {
      executeLoad();
    }

    return undefined;
  }, [normalizedSessionId, refreshSignal, executeLoad]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  return {
    loadState,
    data,
    errorMessage
  };
}
