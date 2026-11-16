import { Stack } from 'expo-router';

/** First-run flow: PADI introduction → language → required foreground location. */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="language" />
      <Stack.Screen name="location" />
    </Stack>
  );
}
