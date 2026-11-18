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
    messages: recent
      .filter((message) => (message.memoryRevision ?? 0) === memoryRevision)
      .map((message) => ({
        role: message.role === 'padi' ? ('assistant' as const) : ('user' as const),
        content: message.text,
      })),
  };
}
