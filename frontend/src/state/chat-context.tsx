import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { nextId } from '@/data/mock-conversations';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { APIError, sendChat, streamVoiceChat, submitResponseFeedback } from '@/lib/api';
import { hasBackend } from '@/lib/config';
import { chatContext, conversationHistory, conversationMessages } from '@/lib/chat-context';
import { greetingRequest, nextCheckIn } from '@/lib/greeting';
import { clearSession, readSession, subscribeSession } from '@/lib/session';
import type { Message, ResponseRating } from '@/types';

type SendResult = { status: 'sent' | 'unauthorized' | 'failed' | 'ignored'; reply?: string; messageID?: string };
const ChatContext = createContext<ReturnType<typeof useChatState> | null>(null);

/** Text and voice share the selected check-in and its in-flight request. */
function useChatState() {
  const [savedMessages, setMessages, status] = usePersistentState<Message[]>('chat-messages', []);
  const latest = useRef(savedMessages);
  latest.current = savedMessages;
  const [conversationID, setConversationID] = useState(() => nextId('chat'));
  const selected = useRef(conversationID);
  const messages = useMemo(() => conversationMessages(savedMessages, conversationID), [savedMessages, conversationID]);
  const historyFor = useCallback((owner: string) => conversationHistory(latest.current, owner), []);
  const [isThinking, setIsThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const epoch = useRef(0);

  const selectConversation = useCallback((id: string) => {
    if (selected.current === id) return;
    selected.current = id;
    epoch.current++;
    active.current?.abort();
    active.current = null;
    setIsThinking(false);
    setSendError(null);
    setConversationID(id);
  }, []);
  const newChat = useCallback(() => selectConversation(nextId('chat')), [selectConversation]);

  useEffect(() => {
    const unsubscribe = subscribeSession(newChat);
    return () => { epoch.current++; active.current?.abort(); unsubscribe(); };
  }, [newChat]);

  const performSend = useCallback(async (rawText: string, expectedUserID?: string, viaVoice = false, signal?: AbortSignal, languageCode?: string,
    onDelta?: (delta: string) => void, onStart?: (messageID: string) => void, greeting = false): Promise<SendResult> => {
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
    const threadID = selected.current;
    setIsThinking(true);
    setSendError(null);
    let userMessage: Message | undefined;
    let pending: Message | undefined;
    let streamedText = '';
    let requestMemoryRevision = 0;
    const removeTurn = () => setMessages(prev => prev.filter(message => message.id !== pending?.id && message.id !== userMessage?.id));
    const keepPartialStream = () => setMessages(prev => prev.map(message => message.id === userMessage?.id
      ? {...message,backendChat:true,memoryRevision:requestMemoryRevision}
      : message.id === pending?.id
      ? { ...message, text: streamedText, pending: false, backendChat: true, memoryRevision:requestMemoryRevision,voiceInterrupted: true }
      : message));
    try {
      const session = await readSession();
      if (controller.signal.aborted || started !== epoch.current) return { status: 'ignored' };
      if (!session) return { status: 'unauthorized' };
      if (expectedUserID && session.user.id !== expectedUserID) return { status: 'ignored' };
      if (!greeting) userMessage = { id: nextId('user'), role: 'user', text, createdAt: Date.now(), backendUserID: session.user.id, conversationID: threadID, viaVoice };
      pending = { id: viaVoice ? nextId('padi') : nextId('pending'), role: 'padi', text: '', createdAt: Date.now(), pending: true, backendUserID: session.user.id, conversationID: threadID, viaVoice };
      const thread = conversationMessages(latest.current, threadID);
      const context = chatContext(thread, session.user.id);
      const cue = greeting ? nextCheckIn(latest.current, session.user.id) : undefined;
      if (cue) pending.checkIn = cue;
      requestMemoryRevision = context.memoryRevision;
      setMessages(prev => [...prev, ...(userMessage ? [userMessage] : []), pending!]);
      if (viaVoice) onStart?.(pending.id);
      try {
        const messages = [...context.messages, { role: 'user' as const, content: cue ? greetingRequest(cue) : text }];
        const response = viaVoice
          ? await streamVoiceChat(session.token, messages, context.memoryRevision, controller.signal, delta => {
            streamedText += delta;
            setMessages(prev => prev.map(message => message.id === pending!.id ? { ...message, text: streamedText } : message));
            onDelta?.(delta);
          }, context.voiceContext, languageCode, greeting)
          : await sendChat(session.token, messages, context.memoryRevision, controller.signal, 'text', context.voiceContext, languageCode, greeting);
        const currentSession = await readSession();
        if (controller.signal.aborted || started !== epoch.current || currentSession?.token !== session.token) {
          removeTurn();
          return { status: 'ignored' };
        }
        if (typeof response.reply !== 'string' || !response.reply.trim()) throw new Error('PADI could not get a response right now. Please try again.');
        const replyID=nextId('padi');
        setMessages(prev => prev.map(message => message.id === userMessage?.id
          ? { ...message, backendChat: true, memoryRevision: response.memory_revision }
          : message.id === pending!.id
          ? { ...message, id: replyID, text: response.reply, createdAt: Date.now(), pending: false, backendChat: true, memoryRevision: response.memory_revision }
          : message));
        return { status: 'sent', reply: response.reply, messageID: replyID };
      } catch (error) {
        if (controller.signal.aborted || started !== epoch.current) {
          if (started === epoch.current && viaVoice && streamedText.trim()) keepPartialStream();
          else removeTurn();
          return { status: 'ignored' };
        }
        if (viaVoice && streamedText.trim()) keepPartialStream();
        else removeTurn();
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
  const sendVoice = useCallback((text: string, expectedUserID: string, signal: AbortSignal, languageCode = 'en-NG',
    onDelta?: (delta: string) => void, onStart?: (messageID: string) => void) =>
    performSend(text, expectedUserID, true, signal, languageCode, onDelta, onStart), [performSend]);
  const greet = useCallback((expectedUserID: string, languageCode = 'en-NG', signal?: AbortSignal,
    onDelta?: (delta: string) => void) => {
    return performSend(greetingRequest(), expectedUserID, !!signal, signal, languageCode, onDelta, undefined, true);
  }, [performSend]);
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
  return { messages, status, isThinking, sendError, send, sendWithResponse, sendVoice, greet, rateResponse, delivered,
    conversationID, historyFor, selectConversation, newChat };
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
