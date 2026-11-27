import { useEffect } from 'react';
import { API_URL } from '@/lib/config';
import { openWebChat } from '../../../public/padi-chat/web-config';

export default function OpenWebChat() {
  useEffect(() => { openWebChat(API_URL); }, []);
  return null;
}
