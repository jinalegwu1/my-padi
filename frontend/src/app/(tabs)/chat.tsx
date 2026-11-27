import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ChatLocation } from '@/components/chat/chat-location';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { Composer } from '@/components/chat/composer';
import { MessageBubble } from '@/components/chat/message-bubble';
import { VoiceConversation } from '@/components/chat/voice-conversation';
import { WakeManager } from '@/components/wake-manager';
import { EmptyState } from '@/components/ui/empty-state';
import { fonts, spacing, useColors, useType } from '@/constants/theme';
import { useChat } from '@/hooks/use-chat';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslation } from '@/hooks/use-translation';
import { revokeSession } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { visibleChatMessages } from '@/lib/chat-context';
import { createChatResponseSpeech } from '@/lib/chat-response-speech';
import { unregisterCurrentPushDevice } from '@/lib/push-notifications';
import { syncAccountCountry } from '@/lib/account-country';
import { clearSession, readSession, type AppSession } from '@/lib/session';
import { unlockVoicePlayback } from '@/lib/voice-playback';
import type { Message, ResponseRating } from '@/types';

/**
 * The main conversation screen — the centre of the application.
 *
 * Spoken and typed turns share the selected conversation.
 */
export default function ConversationScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const textMode = mode === 'text';
  const focused = useIsFocused();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const { messages, status, isThinking, sendError, sendWithResponse, greet, rateResponse, conversationID, historyFor, selectConversation, newChat } = useChat();
  const listRef = useRef<FlatList<Message>>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSavingID, setFeedbackSavingID] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const greetingAttempt = useRef<string | null>(null);
  const [speech, setSpeech] = useState<{
    messageID: string;
    state: 'loading' | 'speaking' | 'paused' | 'error';
    error?: string;
  } | null>(null);
  const speechRef = useRef<{
    messageID: string;
    controller: AbortController;
    task: ReturnType<typeof createChatResponseSpeech>;
    automatic: boolean;
  } | null>(null);
  const spokenAutomatically = useRef(new Set<string>());
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const stopSpeech = useCallback(() => {
    const active = speechRef.current;
    if (!active) return;
    speechRef.current = null;
    active.controller.abort();
    setSpeech(current => current?.messageID === active.messageID ? null : current);
  }, []);

  const playReply = useCallback((message: Message, automatic = false) => {
    if (message.role !== 'padi' || !message.backendChat || !message.backendUserID ||
        message.backendUserID !== session?.user.id) return;
    if (automatic && spokenAutomatically.current.has(message.id)) return;
    if (speechRef.current?.messageID === message.id) return;
    stopSpeech();
    if (automatic) spokenAutomatically.current.add(message.id);
    void unlockVoicePlayback().catch(() => undefined);

    const controller = new AbortController();
    const selected = preferencesRef.current;
    const task = createChatResponseSpeech({
      text: message.text,
      voiceId: selected.voiceId,
      voiceRate: selected.voiceRate,
      languageCode: selected.languageCode,
      signal: controller.signal,
      onStart: () => {
        if (speechRef.current?.messageID === message.id && !controller.signal.aborted) {
          setSpeech({ messageID: message.id, state: 'speaking' });
        }
      },
    });
    const active = { messageID: message.id, controller, task, automatic };
    speechRef.current = active;
    setSpeech({ messageID: message.id, state: 'loading' });
    void task.play().then(() => {
      if (speechRef.current === active) {
        speechRef.current = null;
        setSpeech(current => current?.messageID === message.id ? null : current);
      }
    }).catch(error => {
      if (speechRef.current !== active || controller.signal.aborted) return;
      speechRef.current = null;
      setSpeech({
        messageID: message.id,
        state: 'error',
        error: error instanceof Error ? error.message : 'PADI could not generate or play this reply.',
      });
    });
  }, [session?.user.id, stopSpeech]);

  const pauseSpeech = useCallback(() => {
    const active = speechRef.current;
    if (!active) return;
    void active.task.pause().then(() => {
      if (speechRef.current === active) setSpeech({ messageID: active.messageID, state: 'paused' });
    }).catch(error => {
      if (speechRef.current === active) {
        active.controller.abort();
        speechRef.current = null;
        setSpeech({
          messageID: active.messageID,
          state: 'error',
          error: error instanceof Error ? error.message : 'PADI could not pause audio.',
        });
      }
    });
  }, []);

  const resumeSpeech = useCallback(() => {
    const active = speechRef.current;
    if (!active) return;
    void active.task.resume().then(() => {
      if (speechRef.current === active) setSpeech({ messageID: active.messageID, state: 'speaking' });
    }).catch(error => {
      if (speechRef.current === active) {
        active.controller.abort();
        speechRef.current = null;
        setSpeech({
          messageID: active.messageID,
          state: 'error',
          error: error instanceof Error ? error.message : 'PADI could not resume audio.',
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!preferences.autoSpeakReplies && speechRef.current?.automatic) stopSpeech();
  }, [preferences.autoSpeakReplies, stopSpeech]);

  useFocusEffect(
    useCallback(() => {
    let active = true;
    setSessionLoading(true);
    readSession()
      .then(async (current) => {
        if (current) await syncAccountCountry(current, false, true);
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
      stopSpeech();
    };
    }, [stopSpeech]),
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      stopSpeech();
      if (preferencesRef.current.autoSpeakReplies) {
        void unlockVoicePlayback().catch(() => undefined);
      }
      const result = await sendWithResponse(text, session?.user.id);
      if (result.status === 'unauthorized') {
        setSession(null);
        router.push('/auth');
      }
      if (result.status === 'sent') {
        scrollToEnd();
        if (preferencesRef.current.autoSpeakReplies && result.messageID && result.reply) {
          playReply({
            id: result.messageID,
            role: 'padi',
            text: result.reply,
            createdAt: Date.now(),
            backendChat: true,
            backendUserID: session?.user.id,
          }, true);
        }
      }
      return result.status === 'sent';
    },
    [playReply, router, scrollToEnd, sendWithResponse, session?.user.id, stopSpeech],
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
    stopSpeech();
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
      setSpeech(null);
      return;
    }
    setSession(null);
    setSpeech(null);
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
  }, [session, stopSpeech]);

  useEffect(() => {
    if (!session) { greetingAttempt.current = null; return; }
    if (!textMode || !focused) return;
    const checkIn = session.user.id + '/' + conversationID;
    if (status !== 'ready' || isThinking || greetingAttempt.current === checkIn) return;
    const history = visibleChatMessages(messages, session.user.id);
    if (history.some(message => message.backendUserID === session.user.id || message.role === 'user')) return;
    greetingAttempt.current = checkIn;
    void greet(session.user.id, preferences.languageCode);
  }, [status, session, messages, conversationID, isThinking, greet, preferences.languageCode, textMode, focused]);

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
        <ChatLocation />
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

  const sidebar = <ChatSidebar
        visible={sidebarOpen}
        displayName={preferences.displayName}
        onClose={() => setSidebarOpen(false)}
        history={sidebarOpen ? historyFor(session.user.id) : []}
        selectedID={conversationID}
        onOpenChat={id => { stopSpeech(); setFeedbackError(null); selectConversation(id); router.setParams({ mode: 'text' }); setSidebarOpen(false); }}
        onNewChat={() => { stopSpeech(); setFeedbackError(null); newChat(); setSidebarOpen(false); }}
        onSettings={() => { setSidebarOpen(false); router.push('/(tabs)/settings'); }}
        onMemory={() => { setSidebarOpen(false); router.push('/memory'); }}
        onDeviceActions={() => { setSidebarOpen(false); router.push('/device-actions'); }}
        onReminders={() => { setSidebarOpen(false); router.push('/(tabs)/reminders'); }}
        onWeather={() => { setSidebarOpen(false); router.push('/weather'); }}
        onSignOut={() => { setSidebarOpen(false); void handleSignOut(); }}
      />;

  const switchToText = () => router.setParams({ mode: 'text' });
  const switchToVoice = () => {
    stopSpeech();
    void unlockVoicePlayback().catch(() => undefined);
    router.setParams({ mode: 'voice' });
  };
  if (!textMode) {
    return <>
      <VoiceConversation key={session.user.id + '/' + conversationID} autoStart
        onText={switchToText} onEnd={switchToText} onMenu={() => setSidebarOpen(true)} />
      {sidebar}
    </>;
  }
  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}>
      {focused && preferences.wakeWordEnabled && <WakeManager />}
      <ChatHeader
        name={t('chat.title')}
        status={t('chat.status')}
        onOpenMenu={() => setSidebarOpen(true)}
        menuLabel="Open PADI menu"
        onSwitchToVoice={switchToVoice}
        voiceLabel="Switch to voice"
      />
      <ChatLocation key={session.user.id} />
      {sidebar}

      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <FlatList
          ref={listRef}
          data={visibleChatMessages(messages, session.user.id)}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              voiceLabel={t('chat.voiceNote')}
              feedbackLabels={{
                helpful: t('chat.feedback.helpful'),
                not_helpful: t('chat.feedback.notHelpful'),
                liked_humour: t('chat.feedback.likedHumour'),
                unwanted_humour: t('chat.feedback.unwantedHumour'),
              }}
              feedbackSaving={feedbackSavingID === item.id}
              onFeedback={handleFeedback}
              speechState={speech?.messageID === item.id ? speech.state : 'idle'}
              speechError={speech?.messageID === item.id ? speech.error : undefined}
              onSpeak={playReply}
              onPauseSpeech={pauseSpeech}
              onResumeSpeech={resumeSpeech}
              onStopSpeech={stopSpeech}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
        />

        {sendError || feedbackError ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
            {sendError || feedbackError}
          </Text>
        ) : null}

        <Composer
          key={conversationID}
          onSend={handleSend}
          onOpenVoice={switchToVoice}
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
