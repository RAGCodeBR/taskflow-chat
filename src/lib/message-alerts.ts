// Text shown in new-message alerts (panel toast and system notification).
const TYPE_PREVIEW: Record<string, string> = {
    IMAGE: '📷 Foto', VIDEO: '🎥 Vídeo', AUDIO: '🎤 Áudio', DOCUMENT: '📄 Documento',
    STICKER: 'Figurinha', LOCATION: '📍 Localização', CONTACT: '👤 Contato',
};
export function alertPreview(message: { type: string; content: string | null }, max = 120): string {
    const text = message.content?.replace(/\s+/g, ' ').trim() || '';
    const base = TYPE_PREVIEW[message.type];
    const preview = base ? (text && message.type !== 'STICKER' ? `${base}: ${text}` : base) : text || 'Nova mensagem';
    return preview.length > max ? preview.slice(0, max - 1).trimEnd() + '…' : preview;
}
// One persistent alert per conversation, so new messages update it instead of piling up.
export const alertToastId = (sessionId: string, jid: string) => `incoming:${sessionId}:${jid}`;
