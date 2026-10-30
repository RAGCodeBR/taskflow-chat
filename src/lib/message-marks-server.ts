import type { Server } from "socket.io";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { activePins, matchesStarQuery, type parsePinEvent } from "@/lib/message-marks";

export type PinView = { keyId: string; scope: "whatsapp" | "local"; expiresAt: string | null; content: string | null; type: string; senderName: string; fromMe: boolean; timestamp: string };
export type StarView = { keyId: string; remoteJid: string; chatName: string; senderName: string; content: string | null; type: string; fromMe: boolean; timestamp: string; starredAt: string };

type PinEvent = NonNullable<ReturnType<typeof parsePinEvent>>;

// A pin notice from WhatsApp (ours from another device, or someone else's in the chat).
export async function applyPinEvent(event: PinEvent, dbSessionId: string, sessionId: string, io: Server | null) {
    try {
        // Store pins under the jid the message itself was saved with (LID vs phone jid).
        const target = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: dbSessionId, keyId: event.keyId } }, select: { remoteJid: true } });
        const remoteJid = target?.remoteJid || event.remoteJid;
        if (event.pin) {
            const expiresAt = new Date(Date.now() + event.seconds * 1000);
            await prisma.pinnedMessage.upsert({
                where: { sessionId_remoteJid_keyId: { sessionId: dbSessionId, remoteJid, keyId: event.keyId } },
                create: { sessionId: dbSessionId, remoteJid, keyId: event.keyId, scope: "whatsapp", pinnedBy: event.by, expiresAt },
                update: { scope: "whatsapp", pinnedBy: event.by, pinnedAt: new Date(), expiresAt },
            });
        } else {
            await prisma.pinnedMessage.deleteMany({ where: { sessionId: dbSessionId, remoteJid, keyId: event.keyId } });
        }
        io?.to(sessionId).emit("message.pins", { jid: remoteJid }, { sessionId });
    } catch (error) {
        logger.error("Store", "Pin sync failed", error);
    }
}

export async function nameMaps(dbSessionId: string) {
    const [contacts, groups] = await Promise.all([
        prisma.contact.findMany({ where: { sessionId: dbSessionId }, select: { jid: true, lid: true, remoteJidAlt: true, customName: true, name: true, notify: true, verifiedName: true } }),
        prisma.group.findMany({ where: { sessionId: dbSessionId }, select: { jid: true, subject: true } }),
    ]);
    const names = new Map<string, string>();
    for (const c of contacts) {
        const name = c.customName || c.name || c.notify || c.verifiedName;
        if (name) for (const id of [c.jid, c.lid, c.remoteJidAlt]) if (id) names.set(id, name);
    }
    for (const g of groups) if (g.subject) names.set(g.jid, g.subject);
    const phone = (jid: string) => jid.split("@")[0].split(":")[0];
    return {
        chat: (jid: string) => names.get(jid) || phone(jid),
        sender: (m: { fromMe: boolean; senderJid: string | null; pushName: string | null }) =>
            m.fromMe ? "Você" : (m.senderJid && names.get(m.senderJid)) || m.pushName || (m.senderJid ? phone(m.senderJid) : "Contato"),
    };
}

export async function listPins(dbSessionId: string, jids: string[]): Promise<PinView[]> {
    const rows = activePins(await prisma.pinnedMessage.findMany({ where: { sessionId: dbSessionId, remoteJid: { in: jids } }, orderBy: { pinnedAt: "desc" } }), new Date());
    if (!rows.length) return [];
    const [messages, names] = await Promise.all([
        prisma.message.findMany({ where: { sessionId: dbSessionId, keyId: { in: rows.map(r => r.keyId) } } }),
        nameMaps(dbSessionId),
    ]);
    const byKey = new Map(messages.map(m => [m.keyId, m]));
    return rows.flatMap(row => {
        const m = byKey.get(row.keyId);
        if (!m) return [];
        return [{ keyId: row.keyId, scope: row.scope === "local" ? "local" : "whatsapp", expiresAt: row.expiresAt?.toISOString() || null, content: m.content, type: m.type, senderName: names.sender(m), fromMe: m.fromMe, timestamp: m.timestamp.toISOString() }];
    });
}

export async function listStarred(dbSessionId: string, q: string, jids?: string[]): Promise<StarView[]> {
    const rows = await prisma.starredMessage.findMany({ where: { sessionId: dbSessionId, ...(jids ? { remoteJid: { in: jids } } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
    if (!rows.length) return [];
    const [messages, names] = await Promise.all([
        prisma.message.findMany({ where: { sessionId: dbSessionId, keyId: { in: rows.map(r => r.keyId) } } }),
        nameMaps(dbSessionId),
    ]);
    const byKey = new Map(messages.map(m => [m.keyId, m]));
    const items: StarView[] = [];
    for (const row of rows) {
        const m = byKey.get(row.keyId);
        if (!m) continue;
        const item = { keyId: row.keyId, remoteJid: m.remoteJid, chatName: names.chat(m.remoteJid), senderName: names.sender(m), content: m.content, type: m.type, fromMe: m.fromMe, timestamp: m.timestamp.toISOString(), starredAt: row.createdAt.toISOString() };
        if (matchesStarQuery(item, q)) items.push(item);
        if (items.length >= 200) break;
    }
    return items;
}
