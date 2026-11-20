import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '@/components/chat/chat-header';
import { Composer } from '@/components/chat/composer';
import { MessageBubble } from '@/components/chat/message-bubble';
import { SuggestionChips } from '@/components/chat/suggestion-chips';
import { EmptyState } from '@/components/ui/empty-state';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { SUGGESTIONS } from '@/data/mock-conversations';
import { useChat } from '@/hooks/use-chat';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { revokeSession } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { visibleChatMessages } from '@/lib/chat-context';
import { unregisterCurrentPushDevice } from '@/lib/push-notifications';
import { clearSession, readSession, type AppSession } from '@/lib/session';
import { unlockVoicePlayback } from '@/lib/voice-playback';
import type { Message, ResponseRating } from '@/types';

/**
 * The main conversation screen — the centre of the application.
 *
 * PADI's animated Orb is deliberately NOT here: it belongs to the voice screen
 * and only appears once the user activates voice. Chat replies come from the
 * authenticated Go API; the dedicated voice screen shares this conversation.
 */
export default function ConversationScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const { messages, status, isThinking, sendError, send, rateResponse, reset } = useChat();
  const listRef = useRef<FlatList<Message>>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSavingID, setFeedbackSavingID] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
    let active = true;
    setSessionLoading(true);
    readSession()
      .then((current) => {
        if (active) {
          setSession(current);
          setSessionError(null);
        }
      })
      .catch(() => {
        if (active) {
          setSession(null);
          setSessionError('Session storage could not be read. Please reopen the app or sign in again.');
        }
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });
    return () => {
      active = false;
    };
    }, []),
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const result = await send(text, session?.user.id);
      if (result === 'unauthorized') {
        setSession(null);
        router.push('/auth');
      }
      if (result === 'sent') scrollToEnd();
      return result === 'sent';
    },
    [router, scrollToEnd, send, session?.user.id],
  );

  const handleFeedback = useCallback(async (messageID: string, rating: ResponseRating) => {
    setFeedbackError(null);
    setFeedbackSavingID(messageID);
    try {
      await rateResponse(messageID, rating);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : 'PADI could not save your feedback. Please try again.');
    } finally {
      setFeedbackSavingID(current => current === messageID ? null : current);
    }
  }, [rateResponse]);

  const handleSignOut = useCallback(async () => {
    const current = session;
    let revokeFailed = false;
    let pushUnregisterFailed = false;
    if (current) {
      try {
        await unregisterCurrentPushDevice(current.token);
      } catch {
        pushUnregisterFailed = true;
      }
    }
    try {
      await clearSession();
    } catch {
      setSessionError('The saved session could not be cleared. Restart the app before signing in again.');
      setSession(null);
      reset();
      return;
    }
    setSession(null);
    reset();
    if (current) {
      try {
        await revokeSession(current.token);
      } catch {
        revokeFailed = true;
      }
    }
    if (revokeFailed || pushUnregisterFailed) {
      const notices = [
        pushUnregisterFailed ? 'Push notifications could not be disabled on the server.' : '',
        revokeFailed ? 'The server could not confirm session revocation; the session will expire automatically.' : '',
      ].filter(Boolean);
      setSignOutNotice(`You are signed out on this device. ${notices.join(' ')}`);
    }
  }, [reset, session]);

  const greeting = preferences.displayName
    ? `Hey ${preferences.displayName}! 😊 Good to see you. What are we talking about today?`
    : undefined;

  if (status === 'loading') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted, fontSize: type.bodySmall }]}>
            {t('common.loading')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('common.error')}
          message="Your conversation could not be read from this phone."
          actionTitle={t('common.retry')}
          onAction={() => router.replace('/(tabs)/chat')}
        />
      </SafeAreaView>
    );
  }

  if (sessionLoading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to chat with PADI"
          message={
            sessionError ??
            signOutNotice ??
            (hasBackend
              ? 'Create an account or sign in with your phone number. We will verify it with a one-time SMS code.'
              : 'Real chat needs a backend URL configured for this app. Set EXPO_PUBLIC_API_URL, then sign in.')
          }
          actionTitle="Continue with phone"
          onAction={() => router.push('/auth')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}>
      <ChatHeader
        name={t('chat.title')}
        status={t('chat.status')}
        onOpenSettings={() => router.push('/(tabs)/settings')}
        settingsLabel={t('chat.settings')}
        onNewChat={reset}
        newChatLabel={t('chat.newChat')}
        onOpenWeather={() => router.push('/weather')}
        weatherLabel="Check local weather"
        onSignOut={handleSignOut}
        signOutLabel="Sign out"
      />

      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <FlatList
          ref={listRef}
        data={visibleChatMessages(messages, session.user.id)}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <MessageBubble
              message={
                index === 0 && greeting && item.role === 'padi' && !item.visual
                  ? { ...item, text: greeting }
                  : item
              }
              voiceLabel={t('chat.voiceNote')}
              feedbackLabels={{
                helpful: t('chat.feedback.helpful'),
                not_helpful: t('chat.feedback.notHelpful'),
                liked_humour: t('chat.feedback.likedHumour'),
                unwanted_humour: t('chat.feedback.unwantedHumour'),
              }}
              feedbackSaving={feedbackSavingID === item.id}
              onFeedback={handleFeedback}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
          ListFooterComponent={
            <View style={styles.footer}>
              <Text style={[styles.notice, { color: colors.muted, fontSize: type.micro }]}>
                {t('chat.mockNotice')}
              </Text>
            </View>
          }
        />

        {messages.length <= 2 ? (
          <SuggestionChips
            suggestions={SUGGESTIONS.slice(0, 5)}
            onPick={handleSend}
            title={t('chat.suggestions')}
          />
        ) : null}

        {sendError || feedbackError ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
            {sendError || feedbackError}
          </Text>
        ) : null}

        <Composer
          key={session.user.id}
          onSend={handleSend}
          onOpenVoice={() => {
            void unlockVoicePlayback().catch(() => undefined);
            router.push({ pathname: '/voice', params: { connect: '1' } });
          }}
          placeholder={t('chat.placeholder')}
          sendLabel={t('chat.send')}
          voiceLabel={t('chat.voice')}
          disabled={isThinking}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { fontFamily: fonts.regular },
  list: { padding: spacing.base, gap: spacing.base, paddingBottom: spacing.sm },
  footer: { paddingTop: spacing.md, alignItems: 'center' },
  notice: { fontFamily: fonts.regular, textAlign: 'center' },
  error: { paddingHorizontal: spacing.base, paddingVertical: spacing.xs, fontFamily: fonts.medium, textAlign: 'center' },
});
