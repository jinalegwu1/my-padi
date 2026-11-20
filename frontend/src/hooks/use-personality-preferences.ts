import { useCallback, useEffect, useState } from 'react';

import { fetchPersonalityPreferences, updatePersonalityPreferences } from '@/lib/api';
import { readSession, subscribeSession } from '@/lib/session';
import type { PersonalityPreferencePatch, PersonalityPreferences } from '@/types';

type Status = 'loading' | 'ready' | 'signed_out' | 'error';

/** Loads and updates personality preferences owned by the active signed-in account. */
export function usePersonalityPreferences() {
  const [preferences, setPreferences] = useState<PersonalityPreferences | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (active: () => boolean) => {
    setStatus('loading');
    setError(null);
    try {
      const session = await readSession();
      if (!active()) return;
      if (!session) {
        setPreferences(null);
        setStatus('signed_out');
        return;
      }
      const result = await fetchPersonalityPreferences(session.token);
      const current = await readSession();
      if (!active() || current?.token !== session.token) return;
      setPreferences(result);
      setStatus('ready');
    } catch (reason) {
      if (!active()) return;
      setPreferences(null);
      setError(reason instanceof Error ? reason.message : 'Conversation preferences could not load.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => { void load(() => active); };
    refresh();
    const unsubscribe = subscribeSession(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const update = useCallback(async (patch: PersonalityPreferencePatch): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const session = await readSession();
      if (!session || status !== 'ready') throw new Error('Sign in to save conversation preferences.');
      const result = await updatePersonalityPreferences(session.token, patch);
      const current = await readSession();
      if (current?.token !== session.token) return false;
      setPreferences(result);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Conversation preferences could not be saved.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [status]);

  return { preferences, status, saving, error, update };
}
