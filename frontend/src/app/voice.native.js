import { createElement } from 'react';
import { PortraitChat } from '@/components/chat/portrait-chat';
import ExistingVoice from './voice.tsx';

export default function Voice() { return createElement(PortraitChat, {fallback:ExistingVoice}); }
