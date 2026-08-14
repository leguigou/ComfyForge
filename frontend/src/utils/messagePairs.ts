import type { Message } from '../types';

const isGenerationPair = (userMessage: Message | undefined, botMessage: Message | undefined) => (
  userMessage?.role === 'user'
  && botMessage?.role === 'bot'
  && Boolean(userMessage.text?.trim())
  && (botMessage.prompt || '').trim() === userMessage.text.trim()
);

/** Returns the selected message and its adjacent prompt/result counterpart. */
export const getLinkedMessageIds = (messages: Message[], messageId: string) => {
  const index = messages.findIndex(message => message.id === messageId);
  if (index < 0) return [messageId];

  const message = messages[index];
  if (message.role === 'user' && isGenerationPair(message, messages[index + 1])) {
    return [message.id, messages[index + 1].id];
  }
  if (message.role === 'bot' && isGenerationPair(messages[index - 1], message)) {
    return [messages[index - 1].id, message.id];
  }
  return [message.id];
};
