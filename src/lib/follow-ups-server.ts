import { prisma } from "@/lib/prisma";
import { chatIdentities } from "@/lib/chat-identities";
import { nameMaps } from "@/lib/message-marks-server";
import type { FollowUpView, ReminderView } from "@/lib/follow-ups";

export async function listPending(dbSessionId: string): Promise<{ messages: FollowUpView[]; reminders: ReminderView[] }> {
    const [rows, reminders] = await Promise.all([
        prisma.followUpMessage.findMany({ where: { sessionId: dbSessionId }, orderBy: { createdAt: "desc" }, take: 300 }),
        prisma.chatReminder.findMany({ where: { sessionId: dbSessionId }, orderBy: { updatedAt: "desc" }, take: 300 }),
    ]);
    if (!rows.length && !reminders.length) return { messages: [], reminders: [] };
    const [messages, names] = await Promise.all([
        rows.length ? prisma.message.findMany({ where: { sessionId: dbSessionId, keyId: { in: rows.map(r => r.keyId) } } }) : [],
        nameMaps(dbSessionId),
    ]);
    const byKey = new Map(messages.map(m => [m.keyId, m]));
    return {
        messages: rows.flatMap(row => {
            const m = byKey.get(row.keyId);
            return m ? [{ keyId: row.keyId, remoteJid: m.remoteJid, chatName: names.chat(m.remoteJid), senderName: names.sender(m), content: m.content, type: m.type, fromMe: m.fromMe, timestamp: m.timestamp.toISOString(), markedAt: row.createdAt.toISOString() }] : [];
        }),
        reminders: reminders.map(r => ({ chatJid: r.chatJid, chatName: names.chat(r.chatJid), note: r.note, updatedAt: r.updatedAt.toISOString() })),
    };
}

// The canonical jid (phone jid when known) and all aliases of a conversation of this account.
export async function conversationIdentity(dbSessionId: string, jid: string) {
    const contacts = await prisma.contact.findMany({ where: { sessionId: dbSessionId }, select: { jid: true, lid: true, remoteJidAlt: true } });
    const identities = chatIdentities(contacts);
    return { canonical: identities.canonical(jid), aliases: identities.aliases(jid) };
}
