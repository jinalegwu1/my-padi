import { useCallback, useEffect, useRef, useState } from 'react';

import { SEED_MESSAGES, WELCOME_MESSAGE, nextId } from '@/data/mock-conversations';
import { buildPendingMessage, buildReply, buildReplyMessage } from '@/data/mock-replies';
import { usePersistentState } from '@/hooks/use-persistent-state';
import type { Message } from '@/types';

const THINKING_MS = 1100;

/**
 * Conversation state for the main chat screen.
 *
 * Replies come from a local rule-based mock (`@/data/mock-replies`) — no AI
 * service is called and nothing leaves the phone. Text messages always get a
 * text reply; voice is never played automatically.
 */
export function useChat() {
  const [messages, setMessages, status] = usePersistentState<Message[]>(
    'chat-messages',
    SEED_MESSAGES,
  );
  const [isThinking, setIsThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const send = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || isThinking) return;

      const userMessage: Message = {
        id: nextId('user'),
        role: 'user',
        text,
        createdAt: Date.now(),
      };
      const pending = buildPendingMessage();

      setMessages((prev) => [...prev, userMessage, pending]);
      setIsThinking(true);

      timer.current = setTimeout(() => {
        const reply = buildReply(text);
        const replyMessage = buildReplyMessage(reply);
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? replyMessage : m)));
        setIsThinking(false);
      }, THINKING_MS);
    },
    [isThinking, setMessages],
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

  const reset = useCallback(() => {
    setMessages([
      { id: nextId('padi'), role: 'padi', text: WELCOME_MESSAGE, createdAt: Date.now() },
    ]);
  }, [setMessages]);

  return { messages, status, isThinking, send, addVoiceExchange, reset };
}
