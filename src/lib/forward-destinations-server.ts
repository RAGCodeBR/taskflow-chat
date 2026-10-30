import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { chatIdentities } from "@/lib/chat-identities";
import { contactDestinations, type Destination } from "@/lib/forward-destinations";

// Conversations first, then saved contacts with no conversation yet.
export async function loadDestinations(dbSessionId: string): Promise<{ chats: Destination[]; contacts: Destination[] }> {
    const [chats, contacts] = await Promise.all([
        ChatService.getChatsList(dbSessionId, null, undefined, undefined, 'all'),
        prisma.contact.findMany({ where: { sessionId: dbSessionId }, select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, customName: true, profilePic: true } }),
    ]);
    const identities = chatIdentities(contacts);
    const phone = (jid: string) => identities.aliases(jid).map(id => id.match(/^(\d{6,15})@(s\.whatsapp\.net|c\.us)$/)?.[1]).find(Boolean) || null;
    return {
        chats: chats.map(chat => ({ jid: chat.jid, name: chat.name, notify: chat.notify, profilePic: chat.profilePic, phone: phone(chat.jid) })),
        contacts: contactDestinations(contacts, chats.map(chat => chat.jid)),
    };
}

export async function isDestination(dbSessionId: string, jid: string): Promise<boolean> {
    const { chats, contacts } = await loadDestinations(dbSessionId);
    return chats.some(d => d.jid === jid) || contacts.some(d => d.jid === jid);
}
