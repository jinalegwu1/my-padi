import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { WELCOME_MESSAGE, nextId } from '@/data/mock-conversations';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { APIError, sendChat, submitResponseFeedback } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { chatContext } from '@/lib/chat-context';
import { clearSession, readSession, subscribeSession } from '@/lib/session';
import type { Message, ResponseRating } from '@/types';

type SendResult = { status: 'sent' | 'unauthorized' | 'failed' | 'ignored'; reply?: string; messageID?: string };
const ChatContext = createContext<ReturnType<typeof useChatState> | null>(null);

/** One shared conversation and one in-flight send for text and voice screens. */
function useChatState() {
  const [messages, setMessages, status] = usePersistentState<Message[]>('chat-messages', []);
  const latest = useRef(messages);
  latest.current = messages;
  const [isThinking, setIsThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeSession(() => {
      epoch.current++;
      active.current?.abort();
      setSendError(null);
    });
    return () => { epoch.current++; active.current?.abort(); unsubscribe(); };
  }, []);

  const performSend = useCallback(async (rawText: string, expectedUserID?: string, viaVoice = false, signal?: AbortSignal, languageCode?: string): Promise<SendResult> => {
    const text = rawText.trim();
    if (!text || active.current || status !== 'ready' || signal?.aborted) return { status: 'ignored' };
    if (!hasBackend) {
      setSendError('Real chat is not configured in this app build. Set EXPO_PUBLIC_API_URL and try again.');
      return { status: 'failed' };
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    active.current = controller;
    const started = epoch.current;
    setIsThinking(true);
    setSendError(null);
    let userMessage: Message | undefined;
    let pending: Message | undefined;
    const removeTurn = () => setMessages(prev => prev.filter(message => message.id !== pending?.id && message.id !== userMessage?.id));
    try {
      const session = await readSession();
      if (controller.signal.aborted || started !== epoch.current) return { status: 'ignored' };
      if (!session) return { status: 'unauthorized' };
      if (expectedUserID && session.user.id !== expectedUserID) return { status: 'ignored' };
      userMessage = { id: nextId('user'), role: 'user', text, createdAt: Date.now(), backendUserID: session.user.id, viaVoice };
      pending = { id: nextId('pending'), role: 'padi', text: '', createdAt: Date.now(), pending: true, backendUserID: session.user.id, viaVoice };
      const context = chatContext(latest.current, session.user.id);
      setMessages(prev => [...prev, userMessage!, pending!]);
      try {
        const response = await sendChat(session.token, [...context.messages, { role: 'user', content: text }], context.memoryRevision, controller.signal, viaVoice?'voice':'text',context.voiceContext,languageCode);
        const currentSession = await readSession();
        if (controller.signal.aborted || started !== epoch.current || currentSession?.token !== session.token) {
          removeTurn();
          return { status: 'ignored' };
        }
        if (typeof response.reply !== 'string' || !response.reply.trim()) throw new Error('PADI could not get a response right now. Please try again.');
        const replyID=nextId('padi');
        setMessages(prev => prev.map(message => message.id === userMessage!.id
          ? { ...message, backendChat: true, memoryRevision: response.memory_revision }
          : message.id === pending!.id
          ? { ...message, id: replyID, text: response.reply, createdAt: Date.now(), pending: false, backendChat: true, memoryRevision: response.memory_revision }
          : message));
        return { status: 'sent', reply: response.reply, messageID: replyID };
      } catch (error) {
        removeTurn();
        if (controller.signal.aborted || started !== epoch.current) return { status: 'ignored' };
        if (error instanceof APIError && error.status === 401) {
          const currentSession = await readSession();
          if (started !== epoch.current || currentSession?.token !== session.token) return { status: 'ignored' };
          await clearSession();
          return { status: 'unauthorized' };
        }
        throw error;
      }
    } catch (error) {
      if (controller.signal.aborted || started !== epoch.current) return { status: 'ignored' };
      setSendError(error instanceof Error ? error.message : 'PADI could not respond. Please try again.');
      return { status: 'failed' };
    } finally {
      signal?.removeEventListener('abort', abort);
      if (active.current === controller) { active.current = null; setIsThinking(false); }
    }
  }, [setMessages, status]);

  const send = useCallback(async (text: string, expectedUserID?: string) => (await performSend(text, expectedUserID)).status, [performSend]);
  const sendWithResponse = useCallback((text: string, expectedUserID?: string) => performSend(text, expectedUserID), [performSend]);
  const sendVoice = useCallback((text: string, expectedUserID: string, signal: AbortSignal, languageCode = 'en-NG') => performSend(text, expectedUserID, true, signal, languageCode), [performSend]);
  const rateResponse = useCallback(async (messageID: string, rating: ResponseRating) => {
    const message = latest.current.find(item => item.id === messageID);
    if (!message || message.role !== 'padi' || !message.backendChat || !message.backendUserID) {
      throw new Error('Only a signed-in PADI reply can receive feedback.');
    }
    const session = await readSession();
    if (!session || session.user.id !== message.backendUserID) {
      throw new Error('Sign in to rate this PADI reply.');
    }
    const started = epoch.current;
    await submitResponseFeedback(session.token, messageID, rating);
    const currentSession = await readSession();
    if (started !== epoch.current || currentSession?.token !== session.token) return;
    setMessages(prev => prev.map(item => item.id === messageID && item.backendUserID === session.user.id
      ? { ...item, responseFeedback: rating }
      : item));
  }, [setMessages]);
  const delivered=useCallback((id:string,text:string,interrupted:boolean,accountID:string)=>{
    setMessages(prev=>prev.map(message=>message.id===id&&message.backendUserID===accountID?{...message,voiceSpokenText:text,voiceInterrupted:interrupted}:message));
  },[setMessages]);
  const addGreeting = useCallback((text: string) => setMessages(prev => [...prev, { id: nextId('padi'), role: 'padi', text, createdAt: Date.now() }]), [setMessages]);
  const reset = useCallback(() => {
    active.current?.abort();
    setSendError(null);
    setMessages([{ id: nextId('padi'), role: 'padi', text: WELCOME_MESSAGE, createdAt: Date.now() }]);
  }, [setMessages]);
  return { messages, status, isThinking, sendError, send, sendWithResponse, sendVoice, rateResponse, delivered, addGreeting, reset };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChatState();
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside ChatProvider');
  return value;
}
