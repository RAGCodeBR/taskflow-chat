import {prepareVoiceMessage} from "@/lib/voice-audio";
import { archivedSet } from "@/lib/archived-chats";
import { chatIdentities } from "@/lib/chat-identities";
import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import Sticker from "wa-sticker-formatter";
import type { InteractiveMessagePayload, AlbumItem } from "./interactive";

/**
 * Chat list filter:
 * - "all": every chat except status/broadcast lists
 * - "private": only 1:1 chats (no groups, broadcasts or newsletters)
 * - "groups": only group chats (@g.us)
 */
export type ChatListFilter = "all" | "private" | "groups";

const CHAT_FILTER_SQL: Record<ChatListFilter, string> = {
    all: "AND m1.remoteJid NOT LIKE '%@broadcast'",
    private: "AND m1.remoteJid NOT LIKE '%@g.us' AND m1.remoteJid NOT LIKE '%@broadcast' AND m1.remoteJid NOT LIKE '%@newsletter'",
    groups: "AND m1.remoteJid LIKE '%@g.us'",
};

export class ChatService {
    /**
     * Get active chats list for a session with last message preview.
     * Cursor-based pagination — `before` is ISO timestamp of last seen chat.
     * Returns chats with last message timestamp < before (older).
     * `filter` is optional; when omitted no JID filtering is applied (API behavior).
     */
    static async getChatsList(
        dbSessionId: string,
        limit: number | null = 50,
        before?: string,
        search?: string,
        filter?: ChatListFilter,
        allowedJids?: string[],
        hideArchived = false
    ) {
        if (allowedJids && allowedJids.length === 0) return [];
        const qParams: any[] = [dbSessionId];


        // Rank ties before applying pagination so each conversation occupies one row.
        const isPostgres = /^postgres(?:ql)?:/.test(process.env.DATABASE_URL || "");
        let chatQuery = `
            SELECT m1.remoteJid, m1.content, m1.timestamp, m1.type
            FROM (
                SELECT remoteJid, content, timestamp, type,
                    ROW_NUMBER() OVER (PARTITION BY remoteJid ORDER BY timestamp DESC, id DESC) AS rn
                FROM \`Message\` WHERE sessionId = ?
            ) m1
            WHERE m1.rn = 1
            AND m1.remoteJid NOT LIKE '%@broadcast'
            AND m1.remoteJid NOT LIKE '%@newsletter'
            ${filter && Object.hasOwn(CHAT_FILTER_SQL, filter) ? CHAT_FILTER_SQL[filter] : ''}
            ORDER BY m1.timestamp DESC, m1.remoteJid ASC
        `;
        if (isPostgres) {
            let parameter = 0;
            chatQuery = chatQuery
                .replace(/`Message`/g, '"Message"')
                .replace(/\b(remoteJid|sessionId)\b/g, '"$1"')
                .replace(/\?/g, () => `$${++parameter}`);
        }
        const rawLastMessages = await prisma.$queryRawUnsafe<Array<{
            remoteJid: string;
            content: string | null;
            timestamp: Date;
            type: string;
        }>>(chatQuery, ...qParams);

        // Fast return if no messages
        if (rawLastMessages.length === 0) return [];

        // 2. Batch fetch contacts & groups ONLY for JIDs that have messages
        const jids = rawLastMessages.map(m => m.remoteJid);
        const [contacts, groups] = await Promise.all([
            prisma.contact.findMany({
                where: { sessionId: dbSessionId },
                select: { jid: true, lid: true, remoteJidAlt: true, name: true, customName: true, notify: true, profilePic: true }
            }),
            prisma.group.findMany({
                where: { sessionId: dbSessionId, jid: { in: jids } },
                select: { jid: true, subject: true }
            })
        ]);

        const identities = chatIdentities(contacts);
        const archived = hideArchived
            ? archivedSet((await prisma.archivedChat.findMany({ where: { sessionId: dbSessionId }, select: { jid: true } })).map(row => row.jid), identities.canonical)
            : null;
        // Build lookup map
        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null; customName?: string | null }>();
        contacts.forEach(c => {
            const key = identities.canonical(c.jid);
            const existing = infoMap.get(key);
            infoMap.set(key, { customName: existing?.customName || c.customName, name: existing?.customName || c.customName || existing?.name || c.name, notify: existing?.notify || c.notify, profilePic: existing?.profilePic || c.profilePic });
        });
        groups.forEach(g => infoMap.set(g.jid, { name: g.subject, notify: g.subject, profilePic: infoMap.get(g.jid)?.profilePic || null }));

        // 3. Build result array (already sorted by SQL DESC)
        const result: any[] = [];
        const seenJids = new Set<string>();
        for (const msg of rawLastMessages) {
            const canonicalJid = identities.canonical(msg.remoteJid);
            if (seenJids.has(canonicalJid)) continue;
            seenJids.add(canonicalJid);
            if (before && msg.timestamp >= new Date(before)) continue;
            if (allowedJids && !allowedJids.some(jid => identities.canonical(jid) === canonicalJid)) continue;
            if (archived?.has(canonicalJid)) continue;
            const info = infoMap.get(canonicalJid);
            result.push({
                jid: canonicalJid,
                aliases: identities.aliases(canonicalJid),
                name: info?.name || null,
                notify: info?.notify || null,
                profilePic: info?.profilePic || null,
                lastMessage: {
                    content: msg.content,
                    timestamp: msg.timestamp instanceof Date
                        ? msg.timestamp.toISOString()
                        : String(msg.timestamp),
                    type: msg.type
                }
            });
        }

        // 4. Apply in-memory search filter if needed
        if (search && search.trim()) {
            const q = search.toLowerCase();
            const searched = result.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.notify || '').toLowerCase().includes(q) ||
                c.jid.toLowerCase().includes(q)
            );
            return limit === null ? searched : searched.slice(0, limit);
        }

        return limit === null ? result : result.slice(0, limit);
    }

    /**
     * Get messages for a specific chat with cursor pagination (infinite scroll).
     * @param before ISO timestamp — load messages older than this
     * @param limit max messages to return
     */
    static async getMessages(
        dbSessionId: string,
        jid: string,
        limit = 50,
        before?: string
    ) {
        const normalizedJid = normalizeJid(jid);
        if (normalizedJid.endsWith("@broadcast") || normalizedJid.endsWith("@newsletter")) return { messages: [], hasMore: false };

        const identityContacts = await prisma.contact.findMany({
            where: { sessionId: dbSessionId }, select: { jid: true, lid: true, remoteJidAlt: true }
        });
        const queryJids = new Set(chatIdentities(identityContacts).aliases(normalizedJid));

        const where: any = {
            sessionId: dbSessionId,
            remoteJid: { in: Array.from(queryJids) }
        };

        // Cursor-based: load older messages before this timestamp
        if (before) {
            where.timestamp = { lt: new Date(before) };
        }

        const messages = await prisma.message.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit + 1 // fetch 1 extra to know if there's more
        });

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        // Fetch quoted messages
        const quoteIds = messages.map(m => m.quoteId).filter((id): id is string => !!id);
        const quotedMessagesMap = new Map<string, { content: string | null; fromMe: boolean; senderJid: string | null; pushName: string | null; type: string; mediaUrl: string | null }>();
        if (quoteIds.length > 0) {
            try {
                const quotedMsgs = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, remoteJid: { in: Array.from(queryJids) }, keyId: { in: quoteIds } },
                    select: { keyId: true, content: true, fromMe: true, senderJid: true, pushName: true, type: true, mediaUrl: true }
                });
                quotedMsgs.forEach(qm => {
                    quotedMessagesMap.set(qm.keyId, {
                        content: qm.content,
                        fromMe: qm.fromMe,
                        senderJid: qm.senderJid,
                        type: qm.type, mediaUrl: qm.mediaUrl,
                        pushName: qm.pushName
                    });
                });
            } catch (e) {
                console.error("Failed to batch load quoted messages:", e);
            }
        }

        const messagesWithQuote = messages.map((m: any) => {
            const quoted = m.quoteId ? quotedMessagesMap.get(m.quoteId) : undefined;
            return {
                ...m,
                quoted: quoted ? {
                    keyId: m.quoteId,
                    content: quoted.content,
                    fromMe: quoted.fromMe,
                    senderJid: quoted.senderJid,
                    type: quoted.type, mediaUrl: quoted.mediaUrl,
                    pushName: quoted.pushName
                } : null
            };
        });

        // Return chronological order (oldest first)
        return {
            messages: messagesWithQuote.reverse(),
            hasMore
        };
    }

    static async sendTextMessage(sessionId: string, jid: string, messagePayload: any, mentions?: string[], quotedMessageId?: string) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        // A reply can only quote a message from this account and this conversation.
        let quotedOption: any = undefined;
        if (quotedMessageId) {
            const dbSession = await prisma.session.findUnique({where:{sessionId},select:{id:true}});
            if (!dbSession) throw Error("Conta não encontrada");
            const contacts = await prisma.contact.findMany({where:{sessionId:dbSession.id},select:{jid:true,lid:true,remoteJidAlt:true}});
            const aliases = chatIdentities(contacts).aliases(jid);
            const quotedMsg = await prisma.message.findFirst({where:{sessionId:dbSession.id,keyId:quotedMessageId,remoteJid:{in:aliases}},select:{keyId:true,remoteJid:true,fromMe:true,content:true,senderJid:true}});
            if (!quotedMsg) throw Error("A mensagem citada não pertence a esta conversa");
            const rawParticipant = quotedMsg.fromMe ? instance.socket.user?.id : quotedMsg.senderJid || quotedMsg.remoteJid;
            const cleanParticipant = rawParticipant?.replace(/:\d+(?=@)/,'');
            quotedOption = {key:{remoteJid:quotedMsg.remoteJid,fromMe:quotedMsg.fromMe,id:quotedMsg.keyId,...(cleanParticipant?{participant:cleanParticipant}:{})},message:{conversation:quotedMsg.content || ""}};
        }

        let msgPayload = { ...messagePayload };

        // Normalize "text" to "caption" if a media message is sent with "text"
        if (msgPayload.text && (msgPayload.image || msgPayload.video || msgPayload.document || msgPayload.audio)) {
            if (!msgPayload.caption) {
                msgPayload.caption = msgPayload.text;
            }
            delete msgPayload.text;
        }

        const { safeFetchBuffer } = await import("@/lib/security");

        if (msgPayload.sticker && (msgPayload.sticker.url || typeof msgPayload.sticker === 'string')) {
            const url = msgPayload.sticker.url || msgPayload.sticker;
            try {
                const { buffer } = await safeFetchBuffer(url, { maxBytes: 10 * 1024 * 1024 });
                const sticker = new Sticker(buffer, {
                    pack: msgPayload.sticker.pack || "WA-AKG Bot",
                    author: msgPayload.sticker.author || "WA-AKG",
                    type: "full",
                    quality: 50
                });
                msgPayload = { sticker: await sticker.toBuffer() };
            } catch (e: any) {
                throw new Error(`Failed to generate sticker from URL: ${e.message}`);
            }
        }

        if (msgPayload.image && typeof msgPayload.image === 'object' && msgPayload.image.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.image.url, { maxBytes: 25 * 1024 * 1024 });
                msgPayload.image = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch image from URL: ${e.message}`);
            }
        }

        if (msgPayload.video && typeof msgPayload.video === 'object' && msgPayload.video.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.video.url, { maxBytes: 100 * 1024 * 1024 });
                msgPayload.video = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch video from URL: ${e.message}`);
            }
        }

        if (msgPayload.document && typeof msgPayload.document === 'object' && msgPayload.document.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.document.url, { maxBytes: 100 * 1024 * 1024 });
                msgPayload.document = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch document from URL: ${e.message}`);
            }
        }

        if (msgPayload.audio && typeof msgPayload.audio === 'object' && msgPayload.audio.url) {
            try {
                const { buffer } = await safeFetchBuffer(msgPayload.audio.url, { maxBytes: 50 * 1024 * 1024 });
                msgPayload.audio = buffer;
            } catch (e: any) {
                throw new Error(`Failed to fetch audio from URL: ${e.message}`);
            }
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }

        const options: any = { mentions: mentions || [] };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload, options);

        // Fire webhook for sent message (non-blocking)
        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: typeof msgPayload.text === 'string' ? msgPayload.text : (msgPayload.caption || "")
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media types to proper message structure for webhook
            if (msgPayload.image) {
                webhookMsg.message = {
                    imageMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "image/jpeg" }
                };
            } else if (msgPayload.video) {
                webhookMsg.message = {
                    videoMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "video/mp4" }
                };
            } else if (msgPayload.audio) {
                webhookMsg.message = {
                    audioMessage: { mimetype: msgPayload.ptt ? "audio/ogg; codecs=opus" : "audio/mp4" }
                };
            } else if (msgPayload.document) {
                webhookMsg.message = {
                    documentMessage: { caption: msgPayload.caption || "", fileName: msgPayload.fileName || "document", mimetype: msgPayload.mimetype || "application/octet-stream" }
                };
            } else if (msgPayload.sticker) {
                webhookMsg.message = {
                    stickerMessage: {}
                };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking — webhook failure shouldn't break message send
        }

        let localMessage = null;
        try {
            const { persistConfirmedOutgoing } = await import("./store");
            if (sendResult) localMessage = await persistConfirmedOutgoing(sessionId, sendResult, instance.socket, instance.io);
        } catch (error) {
            // WhatsApp has confirmed the send. Do not invite a duplicate retry if local persistence fails.
            console.error("Confirmed send local update failed", error);
        }
        return { ...sendResult, localMessage };
    }

    /**
     * Send a media message locally from a buffer.
     */
    static async sendMediaMessage(
        sessionId: string,
        jid: string,
        buffer: Buffer,
        type: string,
        mimetype: string,
        fileName: string,
        caption: string
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        const messageOptions: any = {};
        if (caption) messageOptions.caption = caption;
        messageOptions.mimetype = mimetype;

        let content: any = {};

        if (type === 'image') {
            content = { image: buffer, ...messageOptions };
        } else if (type === 'video') {
            content = { video: buffer, ...messageOptions };
        } else if (type === 'audio') {
            content = { audio: buffer, mimetype, ptt: false };
        } else if (type === 'voice') {
            content = await prepareVoiceMessage(buffer);
        } else if (type === 'document') {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        } else if (type === 'sticker') {
            const sticker = new Sticker(buffer, {
                pack: "WA-AKG Bot",
                author: "WA-AKG",
                type: "full",
                quality: 50
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        }

        const sendResult = await instance.socket.sendMessage(jid, content);

        let localMessage = null;
        try {
            const { persistConfirmedOutgoing } = await import("./store");
            if (sendResult) localMessage = await persistConfirmedOutgoing(sessionId, sendResult, instance.socket, instance.io);
        } catch (error) {
            // WhatsApp has confirmed the send. Do not invite a duplicate retry if local persistence fails.
            console.error("Confirmed send local update failed", error);
        }
        // Keep the real uploaded message (URL, key, hashes and duration) intact.
        // A synthetic audioMessage containing only a MIME type is not downloadable.
        if (sendResult?.message) onMessageSent(sessionId, sendResult, localMessage?.mediaUrl).catch(error => console.error("Sent media webhook failed", error));
        return { ...sendResult, localMessage };
    }

    /**
     * Send rich interactive message (Native Flow buttons, single_select list, etc.)
     */
    static async sendInteractiveMessage(
        sessionId: string,
        jid: string,
        payload: InteractiveMessagePayload,
        options: any = {}
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        const sendResult = await instance.socket.sendMessage(jid, {
            interactiveMessage: payload
        } as any, options);

        // Fire webhook for sent interactive message
        try {
            const webhookMsg: any = {
                key: sendResult?.key || {},
                message: {
                    conversation: payload.body || payload.title || "Interactive Message"
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };
            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }

    /**
     * Send Album message with multiple images/videos
     */
    static async sendAlbumMessage(
        sessionId: string,
        jid: string,
        items: AlbumItem[],
        options: { caption?: string; quoted?: any } = {}
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        const sendResult = await instance.socket.sendMessage(jid, {
            albumMessage: items
        } as any, options);

        try {
            const webhookMsg: any = {
                key: sendResult?.key || {},
                message: {
                    conversation: options.caption || "Album Message"
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };
            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }
}
