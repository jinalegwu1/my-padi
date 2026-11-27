import { COUNTRIES } from '@/data/countries';
import { translate } from '@/lib/i18n';

const keys = ['welcome.companion','welcome.start','welcome.gist','welcome.gist.detail','welcome.checkIns',
  'welcome.checkIns.detail','welcome.history','welcome.history.detail','country.choose','country.clear',
  'country.noMatches','onboarding.country.search','onboarding.back'];

export function entryData(path, preferences) {
  return {
    screen: path === '/auth' ? 'auth' : path.endsWith('/country') ? 'country' : 'welcome',
    selected: preferences.countryCode, language: preferences.languageCode, textScale: preferences.textScale,
    countries: [...COUNTRIES].sort((a,b) => a.name.localeCompare(b.name)),
    copy: Object.fromEntries(keys.map(key => [key, translate(preferences.languageCode, key)])),
  };
}
