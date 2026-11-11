import { Stack } from 'expo-router';

/** Onboarding is a plain stack: country → language → welcome → name. */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="country" />
      <Stack.Screen name="language" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="name" />
    </Stack>
  );
}
