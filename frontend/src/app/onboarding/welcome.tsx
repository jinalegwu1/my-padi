import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { identity, PadiWordmark } from '@/components/onboarding/padi-wordmark';
import { fonts, useType } from '@/constants/theme';
import { useTranslation } from '@/hooks/use-translation';

const features = [
  ['welcome.gist', 'welcome.gist.detail'],
  ['welcome.checkIns', 'welcome.checkIns.detail'],
  ['welcome.history', 'welcome.history.detail'],
] as const;

export default function WelcomeStep() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const wide = width >= 820;
  const type = useType();
  const { t } = useTranslation();

  return <SafeAreaView style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroller}>
      <View style={[styles.layout, wide && styles.spread]}>
        <View style={[styles.hero, wide ? styles.heroWide : { paddingVertical: height < 720 ? 26 : 52 }]}>
          <PadiWordmark large={wide} />
          <Text style={[styles.subtitle, { fontSize: type.body }]}>{t('welcome.companion')}</Text>
        </View>
        <View style={[styles.features, wide && styles.featuresWide]}>
          {features.map(([title, description]) => <View key={title} style={styles.row}>
            <Text style={[styles.title, { fontSize: type.subheading * 1.42 }]}>{t(title)}</Text>
            <Text style={[styles.detail, { fontSize: type.bodySmall, lineHeight: type.lineHeight(type.bodySmall) }]}>{t(description)}</Text>
          </View>)}
          <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.start')}
            onPress={() => router.push('/onboarding/country')}
            style={({ pressed }) => [styles.button, { backgroundColor: pressed ? '#CFA560' : identity.gold }]}>
            <Text style={[styles.buttonText, { fontSize: type.body }]}>{t('welcome.start')}</Text>
            <Ionicons name="arrow-forward" size={22} color={identity.forest} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: identity.forest },
  scroller: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 22 },
  layout: { width: '100%', maxWidth: 490, alignSelf: 'center' },
  spread: { flexDirection: 'row', alignItems: 'center', maxWidth: 1080, columnGap: 70, paddingHorizontal: 18 },
  hero: { alignItems: 'center', justifyContent: 'center' },
  heroWide: { flex: 1, paddingVertical: 50 },
  subtitle: { color: identity.ivory, fontFamily: fonts.regular, marginTop: 2 },
  features: { width: '100%' },
  featuresWide: { width: '43%', borderLeftWidth: StyleSheet.hairlineWidth, borderColor: identity.rule, paddingLeft: 46 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: identity.rule, paddingVertical: 18, gap: 6 },
  title: { fontFamily: identity.serif, color: identity.ivory },
  detail: { color: identity.mist, fontFamily: fonts.regular },
  button: { minHeight: 54, borderRadius: 12, marginTop: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 14 },
  buttonText: { color: identity.forest, fontFamily: fonts.bold },
});
