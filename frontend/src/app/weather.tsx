import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import {
  fetchWeatherForCoordinates,
  geocodeCity,
  roundCoordinate,
  weatherDescription,
  weatherSuggestion,
  type WeatherReport,
} from '@/lib/weather';

export default function WeatherScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const [city, setCity] = useState('');
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const useMyLocation = async () => {
    setError('');
    setLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location permission was not granted. You can still search for a city below.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });
      setReport(
        await fetchWeatherForCoordinates(
          {
            latitude: roundCoordinate(position.coords.latitude),
            longitude: roundCoordinate(position.coords.longitude),
          },
          'Near your location',
        ),
      );
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const useCity = async () => {
    setError('');
    setLoading(true);
    try {
      const place = await geocodeCity(city);
      const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
      setReport(
        await fetchWeatherForCoordinates(
          { latitude: place.latitude, longitude: place.longitude },
          label,
        ),
      );
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const condition = report ? weatherDescription(report.weatherCode) : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: colors.cardMuted },
              pressed && { opacity: 0.7 },
            ]}>
            <Ionicons name="arrow-back" size={19} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>Weather</Text>
            <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
              A quick local weather check, only when you ask.
            </Text>
          </View>
        </View>

        <Card>
          <View style={styles.privacyHeading}>
            <Ionicons name="location-outline" size={19} color={colors.primary} />
            <Text style={[styles.cardHeading, { color: colors.text, fontSize: type.body }]}>
              Your location stays in your control
            </Text>
          </View>
          <Text style={[styles.privacyText, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
            Weather is looked up only after you choose an option below. Device location is used
            once, rounded to about 11 km before it is sent to Open-Meteo, and is not saved or
            tracked in the background. If you enter a city, that name is sent to Open-Meteo to
            find its forecast.
          </Text>
          <Button
            title="Use approximate location"
            icon="navigate-outline"
            onPress={useMyLocation}
            loading={loading}
            accessibilityHint="Ask for foreground location permission and show nearby weather once."
          />
        </Card>

        <View style={styles.manual}>
          <Text style={[styles.or, { color: colors.muted, fontSize: type.caption }]}>
            OR LOOK UP A PLACE
          </Text>
          <TextField
            label="City or town"
            placeholder="e.g. Lagos"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={useCity}
            editable={!loading}
          />
          <Button
            title="Get weather for this city"
            variant="secondary"
            icon="search-outline"
            onPress={useCity}
            disabled={!city.trim()}
            loading={loading}
          />
        </View>

        {error ? (
          <View
            accessibilityRole="alert"
            style={[styles.error, { backgroundColor: colors.dangerSoft, borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger, fontSize: type.bodySmall }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted, fontSize: type.caption }]}>
              Getting the latest conditions…
            </Text>
          </View>
        ) : null}

        {report && condition ? (
          <Card>
            <View style={styles.reportTop}>
              <View style={styles.reportLocation}>
                <Text style={[styles.location, { color: colors.text, fontSize: type.subheading }]}>
                  {report.location}
                </Text>
                <Text style={[styles.localTime, { color: colors.muted, fontSize: type.caption }]}>
                  Local time {report.localTime}
                </Text>
              </View>
              <Ionicons
                name={condition.icon}
                size={32}
                color={colors.primary}
              />
            </View>
            <Text style={[styles.condition, { color: colors.textSecondary, fontSize: type.body }]}>
              {condition.label}
            </Text>
            <Text style={[styles.temperature, { color: colors.text, fontSize: type.display }]}>
              {Math.round(report.temperature)}°
            </Text>
            <Text style={[styles.feelsLike, { color: colors.muted, fontSize: type.caption }]}>
              Feels like {Math.round(report.feelsLike)}° · Celsius
            </Text>
            <Text style={[styles.suggestion, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
              {weatherSuggestion(report)}
            </Text>
            <View style={[styles.details, { borderTopColor: colors.border }]}>
              <WeatherDetail label="Humidity" value={`${Math.round(report.humidity)}%`} />
              <WeatherDetail label="Wind" value={`${Math.round(report.windSpeed)} km/h`} />
              <WeatherDetail label="Rain" value={`${report.precipitation.toFixed(1)} mm`} />
            </View>
          </Card>
        ) : null}

        <Text style={[styles.attribution, { color: colors.muted, fontSize: type.micro }]}>
          Weather data by Open-Meteo · Current conditions, not an emergency weather alert.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function WeatherDetail({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const type = useType();
  return (
    <View style={styles.detail}>
      <Text style={[styles.detailLabel, { color: colors.muted, fontSize: type.micro }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text, fontSize: type.bodySmall }]}>{value}</Text>
    </View>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Weather could not be loaded. Please try again.';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.base, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  privacyHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardHeading: { fontFamily: fonts.semibold, flex: 1 },
  privacyText: { fontFamily: fonts.regular, lineHeight: 21 },
  manual: { gap: spacing.sm },
  or: { fontFamily: fonts.semibold, letterSpacing: 0.7 },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  errorText: { flex: 1, fontFamily: fonts.medium, lineHeight: 21 },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.base },
  loadingText: { fontFamily: fonts.regular },
  reportTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportLocation: { flex: 1, gap: 2 },
  location: { fontFamily: fonts.bold },
  localTime: { fontFamily: fonts.regular },
  condition: { fontFamily: fonts.medium },
  temperature: { fontFamily: fonts.extrabold, letterSpacing: -2 },
  feelsLike: { fontFamily: fonts.regular },
  suggestion: { fontFamily: fonts.medium, lineHeight: 21, marginTop: spacing.xs },
  details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  detail: { gap: spacing.xxs },
  detailLabel: { fontFamily: fonts.regular },
  detailValue: { fontFamily: fonts.semibold },
  attribution: { textAlign: 'center', fontFamily: fonts.regular },
});
