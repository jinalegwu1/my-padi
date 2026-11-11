import { useRouter } from 'expo-router';
import { useState } from 'react';

import { LanguagePicker } from '@/components/onboarding/language-picker';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import type { LanguageOption } from '@/types';

/**
 * Step 2 — preferred language.
 * One choice only; Nigerian Pidgin, Nigerian English and standard English are
 * three separate options.
 */
export default function LanguageStep() {
  const router = useRouter();
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const [selected, setSelected] = useState<LanguageOption | null>(null);

  const currentCode = selected?.code ?? preferences.languageCode;

  const confirm = () => {
    update({ languageCode: currentCode });
    router.push('/onboarding/welcome');
  };

  return (
    <OnboardingShell
      step={2}
      totalSteps={4}
      stepLabel={t('onboarding.step', { current: 2, total: 4 })}
      title={t('onboarding.language.title')}
      subtitle={t('onboarding.language.subtitle')}
      onBack={() => router.back()}
      backLabel={t('onboarding.back')}
      footer={<Button title={t('onboarding.continue')} onPress={confirm} icon="arrow-forward" iconPosition="end" />}>
      <LanguagePicker
        selectedCode={currentCode}
        onSelect={setSelected}
        featuredLabel={t('onboarding.language.featured')}
        othersLabel={t('onboarding.language.others')}
      />
    </OnboardingShell>
  );
}
