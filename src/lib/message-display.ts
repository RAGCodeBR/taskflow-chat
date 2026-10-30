export interface DisplayMessage { type: string; content?: string | null; mediaUrl?: string | null }
export const UNAVAILABLE_MESSAGE = "Conteúdo não disponível nesta sincronização. Consulte no WhatsApp.";
export function messageFallback(message: DisplayMessage): string | null {
    const mediaNames: Record<string, string> = { IMAGE: "Imagem", VIDEO: "Vídeo", AUDIO: "Áudio", STICKER: "Figurinha" };
    if (mediaNames[message.type] && !message.mediaUrl) return `${mediaNames[message.type]} indisponível nesta sincronização. Consulte no WhatsApp.`;
    if (message.type === 'TEXT' && !message.content?.trim()) return UNAVAILABLE_MESSAGE;
    return null;
}
export function unsupportedMessageText(message: Record<string, any> | null | undefined): string {
    if (!message) return UNAVAILABLE_MESSAGE;
    const poll = message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3;
    if (poll) return `📊 Enquete: ${poll.name || 'Sem título'}${poll.options?.length ? '\n' + poll.options.map((o: any) => `• ${o.optionName || 'Opção'}`).join('\n') : ''}`;
    if (message.contactsArrayMessage) return `👤 Contatos: ${(message.contactsArrayMessage.contacts || []).map((c: any) => c.displayName || 'Contato').join(', ') || 'Consulte no WhatsApp'}`;
    if (message.liveLocationMessage) return '📍 Localização em tempo real — consulte no WhatsApp.';
    if (message.eventMessage) return `📅 Evento: ${message.eventMessage.name || 'Consulte no WhatsApp'}`;
    if (message.buttonsMessage) return message.buttonsMessage.contentText || message.buttonsMessage.text || UNAVAILABLE_MESSAGE;
    if (message.listMessage) return [message.listMessage.title, message.listMessage.description].filter(Boolean).join('\n') || UNAVAILABLE_MESSAGE;
    return UNAVAILABLE_MESSAGE;
}
