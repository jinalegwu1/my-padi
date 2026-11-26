import { Stack } from 'expo-router';

/** First-run flow: welcome and country selection. */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="country" />
    </Stack>
  );
}
