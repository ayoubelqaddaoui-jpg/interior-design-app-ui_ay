import { api } from '@/lib/backend';
import { mockServices } from '../mock/services';
import type { ChatService } from './types';

/**
 * AI chat over `/api/chat/reply` (free provider chain on the server: Gemini → Groq → OpenRouter → Pollinations).
 * The device token identifies the visitor; keys never reach the client. If the server cannot answer
 * (no provider configured, offline, timeout) the visitor still gets the local canned reply instead of an error bubble.
 */
export const remoteChat = (): ChatService => ({
  async reply(args) {
    // Only the recent turns are sent: it keeps the request small and the provider quota low.
    const turns = args.messages.slice(-12).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      text: (m.text || '').slice(0, 2000),
      ...(m.image ? { image: true } : {}),
    }));
    try {
      const out = await api<{ text: string }>('/chat/reply', { method: 'POST', client: true, body: { messages: turns }, timeoutMs: 30000 });
      if (out?.text?.trim()) return out.text.trim();
    } catch {
      // NO_PROVIDER, ASSISTANT_DISABLED, rate limit, offline or timeout: use the local reply below.
    }
    return mockServices.chat.reply(args);
  },
});
