import { greetingRequest } from './greeting';
import type { Message } from '@/types';

/** Account-tagged replies may contain private recalled facts. */
export function visibleChatMessages(messages: Message[], userID: string) {
  return messages.filter((message) => !message.backendUserID || message.backendUserID === userID);
}

/** Keep account ownership and memory-consent boundaries in follow-up context. */
export function chatContext(messages: Message[], userID: string) {
  const recent = messages
    .filter((message) => message.backendChat && message.backendUserID === userID && !message.pending)
    .slice(-19);
  const memoryRevision = recent.at(-1)?.memoryRevision ?? 0;
  const eligible=recent.filter(message=>(message.memoryRevision??0)===memoryRevision);
  const lastReply=eligible.filter(message=>message.role==='padi').at(-1);
  return {
    memoryRevision,
    ...(lastReply?.voiceInterrupted?{voiceContext:{interrupted_reply:lastReply.text,spoken_prefix:lastReply.voiceSpokenText??''}}:{}),
    messages: eligible.flatMap(message => {
      const turn = { role: message.role === 'padi' ? 'assistant' as const : 'user' as const, content: message.text };
      // Restore the invisible greeting request so the first actual gist can
      // use its cue after the person has had a turn to answer the welcome.
      return message.checkIn
        ? [{ role: 'user' as const, content: greetingRequest(message.checkIn) }, turn]
        : [turn];
    }).slice(-19),
  };
}

// Untagged authenticated messages from earlier releases share one history per account.
const originalConversation = 'original';
export function conversationMessages(messages: Message[], conversationID: string) {
  return messages.filter(message => (message.conversationID ?? originalConversation) === conversationID);
}

export function conversationHistory(messages: Message[], userID: string) {
  const history = new Map<string, { id: string; title: string; updatedAt: number; hasUserTitle: boolean }>();
  for (const message of messages) {
    if (message.backendUserID !== userID || !message.backendChat || message.pending) continue;
    const id = message.conversationID ?? originalConversation;
    const existing = history.get(id);
    const useTitle = !existing || (message.role === 'user' && !existing.hasUserTitle);
    history.set(id, {
      id,
      title: useTitle ? message.text.replace(/\s+/g, ' ').trim().slice(0, 70) : existing.title,
      hasUserTitle: message.role === 'user' || existing?.hasUserTitle === true,
      updatedAt: Math.max(existing?.updatedAt ?? 0, message.createdAt),
    });
  }
  return [...history.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
