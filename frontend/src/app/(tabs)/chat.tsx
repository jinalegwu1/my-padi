import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
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
import type { Message } from '@/types';

/**
 * The main conversation screen — the centre of the application.
 *
 * PADI's animated Orb is deliberately NOT here: it belongs to the voice screen
 * and only appears once the user activates voice. Text messages always get text
 * replies; voice is never played automatically.
 */
export default function ConversationScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const { messages, status, isThinking, send, reset } = useChat();
  const listRef = useRef<FlatList<Message>>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      send(text);
      scrollToEnd();
    },
    [scrollToEnd, send],
  );

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
      />

      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <MessageBubble
              message={
                index === 0 && greeting && item.role === 'padi' && !item.visual
                  ? { ...item, text: greeting }
                  : item
              }
              voiceLabel={t('chat.voiceNote')}
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

        <Composer
          onSend={handleSend}
          onOpenVoice={() => router.push('/voice')}
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
});
