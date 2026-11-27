import { useEffect } from 'react';
import { usePreferences, DEFAULT_PREFERENCES } from '@/hooks/use-preferences';
import { API_URL } from '@/lib/config';
import { openWebChat } from '../../../public/padi-chat/web-config';
import { entryData } from './entry-data';

export default function EntryScreen() {
  const { preferences } = usePreferences();
  useEffect(() => {
    const current = { ...DEFAULT_PREFERENCES, ...preferences };
    sessionStorage.setItem('padi.entry.view.v1', JSON.stringify(entryData(location.pathname, current)));
    sessionStorage.setItem('padi.entry.defaults.v1', JSON.stringify(DEFAULT_PREFERENCES));
    openWebChat(API_URL, '/padi-entry.html');
  }, [preferences]);
  return null;
}
