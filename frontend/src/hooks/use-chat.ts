import { useCallback, useRef, useState } from 'react';

import { WELCOME_MESSAGE, nextId } from '@/data/mock-conversations';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { APIError, sendChat } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { clearSession, readSession, type AppSession } from '@/lib/session';
import type { Message } from '@/types';

/**
 * Conversation state for the main chat screen.
 *
 * User messages and successful replies are sent to the authenticated Go chat API.
 * Old simulated exchanges and local greetings are deliberately excluded from AI
 * context when the app is upgraded.
 */
export function useChat() {
  const [messages, setMessages, status] = usePersistentState<Message[]>(
    'chat-messages',
    [],
  );
  const [isThinking, setIsThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sending = useRef(false);

  const send = useCallback(
    async (rawText: string): Promise<'sent' | 'unauthorized' | 'failed' | 'ignored'> => {
      const text = rawText.trim();
      if (!text || sending.current) return 'ignored';
      if (!hasBackend) {
        setSendError('Real chat is not configured in this app build. Set EXPO_PUBLIC_API_URL and try again.');
        return 'failed';
      }

      sending.current = true;
      setIsThinking(true);
      setSendError(null);
      let session: AppSession | null;
      try {
        session = await readSession();
      } catch {
        sending.current = false;
        setIsThinking(false);
        setSendError('Session storage could not be read. Please sign in again.');
        return 'failed';
      }
      if (!session) {
        sending.current = false;
        setIsThinking(false);
        return 'unauthorized';
      }

      const userMessage: Message = {
        id: nextId('user'),
        role: 'user',
        text,
        createdAt: Date.now(),
        backendChat: true,
      };
      const pending: Message = {
        id: nextId('pending'),
        role: 'padi',
        text: '',
        createdAt: Date.now(),
        pending: true,
      };

      setMessages((prev) => [...prev, userMessage, pending]);
      try {
        const history = messages
          .filter((message) => message.backendChat && !message.pending)
          .slice(-19)
          .map((message) => ({
            role: message.role === 'padi' ? ('assistant' as const) : ('user' as const),
            content: message.text,
          }));
        const response = await sendChat(session.token, [
          ...history,
          { role: 'user', content: text },
        ]);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === pending.id
              ? {
                  ...message,
                  id: nextId('padi'),
                  text: response.reply,
                  createdAt: Date.now(),
                  pending: false,
                  backendChat: true,
                }
              : message,
          ),
        );
        return 'sent';
      } catch (error) {
        setMessages((prev) =>
          prev.filter((message) => message.id !== pending.id && message.id !== userMessage.id),
        );
        if (error instanceof APIError && error.status === 401) {
          try {
            await clearSession();
          } catch {
            setSendError('Your session expired, but its saved credential could not be cleared. Please sign in again.');
          }
          setMessages((prev) =>
            prev.map((message) => ({ ...message, backendChat: false })),
          );
          return 'unauthorized';
        }
        setSendError(error instanceof Error ? error.message : 'PADI could not respond. Please try again.');
        return 'failed';
      } finally {
        sending.current = false;
        setIsThinking(false);
      }
    },
    [messages, setMessages],
  );

  /** Adds a message produced by the simulated voice session. */
  const addVoiceExchange = useCallback(
    (userText: string, padiText: string) => {
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: nextId('user'), role: 'user', text: userText, createdAt: now, viaVoice: true },
        { id: nextId('padi'), role: 'padi', text: padiText, createdAt: now + 1, viaVoice: true },
      ]);
    },
    [setMessages],
  );

  const addGreeting = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        { id: nextId('padi'), role: 'padi', text, createdAt: Date.now() },
      ]);
    },
    [setMessages],
  );

  const reset = useCallback(() => {
    setSendError(null);
    setMessages([
      { id: nextId('padi'), role: 'padi', text: WELCOME_MESSAGE, createdAt: Date.now() },
    ]);
  }, [setMessages]);

  return { messages, status, isThinking, sendError, send, addVoiceExchange, addGreeting, reset };
}
