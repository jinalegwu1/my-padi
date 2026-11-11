import { useCallback, useMemo } from 'react';

import { usePreferences } from '@/hooks/use-preferences';
import { translate, type Translate, type TranslationKey } from '@/lib/i18n';

/** Translation bound to the user's preferred language. */
export function useTranslation(): { t: Translate; languageCode: string } {
  const { preferences } = usePreferences();
  const languageCode = preferences.languageCode;

  const t = useCallback<Translate>(
    (key: TranslationKey, vars) => translate(languageCode, key, vars),
    [languageCode],
  );

  return useMemo(() => ({ t, languageCode }), [t, languageCode]);
}
