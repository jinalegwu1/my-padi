import { createElement } from 'react';
import { PortraitChat } from '@/components/chat/portrait-chat';
import ExistingChat from './chat.tsx';

export default function Chat() { return createElement(PortraitChat, {fallback:ExistingChat}); }
