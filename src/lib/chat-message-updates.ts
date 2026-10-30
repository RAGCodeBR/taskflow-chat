import { isConversationJid } from "./conversation-jid";
export interface ChatMessageUpdate {
    keyId: string; remoteJid: string; timestamp: string; content: string | null; type: string;
    pushName?: string | null;
}
export const CONFIRMED_CHAT_EVENT = "chat:confirmed-send";
export function publishConfirmedChatMessage(sessionId: string, message: ChatMessageUpdate | null | undefined) {
    if (message && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CONFIRMED_CHAT_EVENT, { detail: { sessionId, messages: [message] } }));
}
export function updateConversationPreviews<T extends { jid: string; aliases?: string[]; lastMessage?: {timestamp:string;content:string|null;type:string} }>(chats: T[], messages: ChatMessageUpdate[]): T[] {
    return chats.map(chat => {
        let latest = chat.lastMessage;
        for (const message of messages) {
            if (!isConversationJid(message.remoteJid)) continue;
            if (message.remoteJid !== chat.jid && !chat.aliases?.includes(message.remoteJid)) continue;
            if (!latest || new Date(message.timestamp).getTime() >= new Date(latest.timestamp).getTime()) latest = { timestamp: message.timestamp, content: message.content, type: message.type };
        }
        return latest === chat.lastMessage ? chat : { ...chat, lastMessage: latest };
    }).sort((a,b) => new Date(b.lastMessage?.timestamp || 0).getTime() - new Date(a.lastMessage?.timestamp || 0).getTime());
}
