import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { MEMORY_CATEGORY_ORDER } from '@/data/mock-memory';
import { APIError, createMemory, deleteMemory, fetchMemory, setMemoryEnabled, updateMemory } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { clearSession, readSession, subscribeSession } from '@/lib/session';
import type { MemoryCategory, MemorySnapshot } from '@/types';

type MemoryState = MemorySnapshot & {
  status: 'loading' | 'ready' | 'unauthorized' | 'error';
  error: string | null;
  busy: boolean;
};

const empty: MemoryState = { enabled: false, revision: 0, items: [], status: 'loading', error: null, busy: false };
const MemoryContext = createContext<ReturnType<typeof useMemoryState> | null>(null);

function useMemoryState() {
  const [state, setState] = useState<MemoryState>(empty);
  const epoch = useRef(0);
  const owner = useRef<string | null>(null);
  const working = useRef(false);

  const reload = useCallback(async () => {
    const current = epoch.current;
    try {
      if (!hasBackend) throw new Error('Personal memory needs a configured backend.');
      const session = await readSession();
      if (current !== epoch.current) return;
      if (!session) {
        owner.current = null;
        setState({ ...empty, status: 'unauthorized' });
        return;
      }
      if (owner.current !== session.user.id) {
        owner.current = session.user.id;
        setState(empty);
      }
      const snapshot = await fetchMemory(session.token);
      if (current !== epoch.current || owner.current !== session.user.id) return;
      setState((previous) => snapshot.revision < previous.revision ? previous : {
        ...snapshot, status: 'ready', error: null, busy: working.current,
      });
    } catch (error) {
      if (current !== epoch.current) return;
      if (error instanceof APIError && error.status === 401) {
        await clearSession().catch(() => {});
        owner.current = null;
        setState({ ...empty, status: 'unauthorized', error: 'Sign in again to manage your memory.' });
      } else {
        setState({ ...empty, status: 'error', error: error instanceof Error ? error.message : 'Personal memory could not be loaded.' });
      }
    }
  }, []);

  useEffect(() => {
    const reset = () => {
      epoch.current++;
      owner.current = null;
      setState(empty);
      void reload();
    };
    const unsubscribe = subscribeSession(reset);
    void reload();
    return () => { epoch.current++; unsubscribe(); };
  }, [reload]);

  const mutate = useCallback(async (operation: (token: string) => Promise<MemorySnapshot>, expectedOwner: string | null): Promise<boolean> => {
    if (working.current || !expectedOwner || owner.current !== expectedOwner) return false;
    working.current = true;
    const current = epoch.current;
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const session = await readSession();
      if (!session || current !== epoch.current || owner.current !== session.user.id || session.user.id !== expectedOwner) {
        if (current === epoch.current) setState({ ...empty, status: 'unauthorized' });
        return false;
      }
      const snapshot = await operation(session.token);
      if (current !== epoch.current || owner.current !== session.user.id) return false;
      setState((previous) => snapshot.revision < previous.revision ? previous : { ...snapshot, status: 'ready', error: null, busy: true });
      return true;
    } catch (error) {
      if (current !== epoch.current) return false;
      if (error instanceof APIError && error.status === 401) {
        await clearSession().catch(() => {});
        owner.current = null;
        setState({ ...empty, status: 'unauthorized', error: 'Sign in again to manage your memory.' });
      } else {
        setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : 'The memory change could not be saved.' }));
      }
      return false;
    } finally {
      working.current = false;
      setState((previous) => ({ ...previous, busy: false }));
    }
  }, []);

  const accountID = owner.current;
  const add = useCallback((draft: { category: MemoryCategory; label: string; value: string }) => mutate((token) => createMemory(token, draft), accountID), [mutate, accountID]);
  const correct = useCallback((id: string, value: string) => mutate((token) => updateMemory(token, id, { value }), accountID), [mutate, accountID]);
  const remove = useCallback((id: string) => mutate((token) => deleteMemory(token, id), accountID), [mutate, accountID]);
  const setEnabled = useCallback((enabled: boolean) => mutate((token) => setMemoryEnabled(token, enabled), accountID), [mutate, accountID]);
  const togglePaused = useCallback((id: string) => {
    const item = state.items.find((item) => item.id === id);
    return item ? mutate((token) => updateMemory(token, id, { paused: !item.paused }), accountID) : Promise.resolve(false);
  }, [state.items, mutate, accountID]);

  const grouped = useMemo(() => MEMORY_CATEGORY_ORDER.map((category) => ({ category, items: state.items.filter((item) => item.category === category) })).filter((group) => group.items.length > 0), [state.items]);
  const counts = useMemo(() => {
    const byCategory: Record<MemoryCategory, number> = { name: 0, interests: 0, relationships: 0, preferences: 0, plans: 0 };
    state.items.forEach((item) => byCategory[item.category]++);
    return { total: state.items.length, active: state.enabled ? state.items.filter((item) => !item.paused).length : 0,
      paused: state.items.filter((item) => item.paused).length, byCategory };
  }, [state.items, state.enabled]);

  return { ...state, accountID, grouped, counts, reload, add, correct, remove, setEnabled, togglePaused };
}

export function MemoryProvider({ children }: { children: ReactNode }) {
  const state = useMemoryState();
  return <MemoryContext.Provider value={state}>{children}</MemoryContext.Provider>;
}

export function useMemory() {
  const value = useContext(MemoryContext);
  if (!value) throw new Error('useMemory must be used inside MemoryProvider');
  return value;
}
