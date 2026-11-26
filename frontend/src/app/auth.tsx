import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { APIError, getAuthConfiguration, requestLogin, requestRegistration, verifyCode } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { saveSession } from '@/lib/session';
import { unlockVoicePlayback } from '@/lib/voice-playback';

type AuthMode = 'login' | 'register';

export default function AuthScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const [mode, setMode] = useState<AuthMode>('login');
  const [stage, setStage] = useState<'details' | 'code'>('details');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [challengeID, setChallengeID] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpRequired, setOTPRequired] = useState<boolean | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);

  useEffect(() => {
    if (!hasBackend) return;
    let active = true;
    setConfigError(null);
    getAuthConfiguration().then(
      (config) => {
        if (active) setOTPRequired(config.otp_required);
      },
      () => {
        if (active) {
          setConfigError('Could not load sign-in settings. Check your connection and try again.');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [configAttempt]);

  const requestCode = async () => {
    void unlockVoicePlayback().catch(() => undefined);
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      const challenge =
        mode === 'register'
          ? await requestRegistration({
              full_name: fullName.trim(),
              date_of_birth: dateOfBirth.trim(),
              phone_number: phoneNumber.trim(),
            })
          : await requestLogin(phoneNumber.trim());
      if (challenge.session) {
        await saveSession(challenge.session);
        router.replace('/(tabs)/chat');
        return;
      }
      setChallengeID(challenge.challenge_id);
      setNotice(challenge.message);
      setStage('code');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'We could not request a verification code. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    void unlockVoicePlayback().catch(() => undefined);
    setError(null);
    setBusy(true);
    try {
      const session = await verifyCode(challengeID, code.trim());
      await saveSession(session);
      router.replace('/(tabs)/chat');
    } catch (verificationError) {
      const message =
        verificationError instanceof APIError && verificationError.status === 401
          ? 'That code is incorrect or expired. Request a new code and try again.'
          : verificationError instanceof Error
            ? verificationError.message
            : 'We could not verify that code. Please try again.';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode((current) => (current === 'login' ? 'register' : 'login'));
    setError(null);
    setNotice('');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>
            {stage === 'code' ? 'Verify your phone' : mode === 'login' ? 'Welcome back' : 'Create your PADI account'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.bodySmall }]}>
            {stage === 'code'
              ? 'Enter the six-digit code sent by SMS. It expires after five minutes.'
              : otpRequired === false
                ? 'OTP verification is temporarily disabled for development. No SMS will be sent.'
                : 'Use your phone number to securely sign in and chat with PADI.'}
          </Text>

          {!hasBackend ? (
            <Text style={[styles.error, { color: colors.danger }]}>
              This app build has no backend address. Set EXPO_PUBLIC_API_URL and rebuild the app.
            </Text>
          ) : null}

          {stage === 'details' ? (
            <View style={styles.fields}>
              {mode === 'register' ? (
                <>
                  <TextField
                    label="Full name"
                    hint="PADI uses your name to recognise your signed-in account."
                    placeholder="Your name"
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={120}
                  />
                  <TextField
                    label="Date of birth"
                    placeholder="YYYY-MM-DD"
                    value={dateOfBirth}
                    onChangeText={setDateOfBirth}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                    hint="Used for your account profile. Example: 1995-08-21."
                  />
                </>
              ) : null}
              <TextField
                label="Phone number"
                placeholder="+2348012345678"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={16}
                hint="Include the country code, in international E.164 format."
              />
            </View>
          ) : (
            <View style={styles.fields}>
              {notice ? (
                <Text style={[styles.notice, { color: colors.textSecondary, fontSize: type.bodySmall }]}>
                  {notice}
                </Text>
              ) : null}
              <TextField
                label="Six-digit code"
                placeholder="000000"
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            </View>
          )}

          {error || configError ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error ?? configError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              title={
                stage === 'code'
                  ? 'Verify and continue'
                  : otpRequired === null
                    ? 'Loading sign-in…'
                    : otpRequired
                      ? 'Send verification code'
                      : mode === 'register'
                        ? 'Create account and continue'
                        : 'Sign in and continue'
              }
              onPress={stage === 'code' ? verify : requestCode}
              loading={busy}
              disabled={!hasBackend || busy || otpRequired === null}
            />
            {configError ? (
              <Button
                title="Retry connection"
                variant="secondary"
                onPress={() => setConfigAttempt((attempt) => attempt + 1)}
              />
            ) : null}
            {stage === 'code' ? (
              <Button
                title="Use a different phone number"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setStage('details');
                  setCode('');
                  setError(null);
                }}
              />
            ) : (
              <Button
                title={mode === 'login' ? 'New to PADI? Create an account' : 'Already have an account? Sign in'}
                variant="ghost"
                onPress={switchMode}
                disabled={busy}
              />
            )}
            <Button title="Back to chat" variant="secondary" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/chat'); }} />
          </View>

          <Text style={[styles.privacy, { color: colors.muted, fontSize: type.micro }]}>
            {otpRequired === false
              ? 'Your account profile is stored by PADI. Phone ownership is not verified while OTP is disabled. Use test accounts only.'
              : 'Your account profile is stored by PADI. Verification codes are sent through Termii and may incur SMS charges based on the configured account and destination.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { fontFamily: fonts.bold, textAlign: 'center' },
  subtitle: { fontFamily: fonts.regular, lineHeight: 22, textAlign: 'center', marginBottom: spacing.sm },
  fields: { gap: spacing.md },
  notice: { fontFamily: fonts.regular, lineHeight: 21, textAlign: 'center' },
  actions: { gap: spacing.xs, marginTop: spacing.sm },
  error: { fontFamily: fonts.medium, textAlign: 'center', lineHeight: 21 },
  privacy: { fontFamily: fonts.regular, lineHeight: 18, textAlign: 'center', marginTop: spacing.sm },
});
