import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { fonts, spacing, useColors, useType } from '@/constants/theme';

export default function NotFoundScreen() {
  const colors = useColors();
  const type = useType();
  return (
    <Screen>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: colors.text, fontSize: type.heading }]}>
          This screen does not exist.
        </Text>
        <Link href="/" style={[styles.link, { color: colors.primary, fontSize: type.body }]}>
          Go back to PADI
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semibold, textAlign: 'center' },
  link: { fontFamily: fonts.semibold },
});
