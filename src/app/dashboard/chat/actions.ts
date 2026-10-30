"use server";

import { chatIdentities } from "@/lib/chat-identities";
import { CHAT_STAGES, matchesKanbanColumn, resolveKanbanColumns } from "@/lib/chat-stages";
import { prisma } from "@/lib/prisma";
import { ChatService, type ChatListFilter } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { effectiveDirectMessageStatus, readMessageReceipts } from "@/lib/message-receipts";

const CHAT_PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "50", 10);

// Fetch chat list with cursor-based pagination & search
export async function getChatsStatus(
    sessionId: string,
    limit = CHAT_PAGE_SIZE,
    before?: string,
    search?: string,
    filter: ChatListFilter = "all",
    labelId?: string,
    columnId?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const assignments = labelId ? await prisma.chatLabel.findMany({
        where: { labelId, label: { sessionId } }, select: { chatJid: true }
    }) : undefined;
    if (columnId) {
        const [saved, labels, allAssignments, stages, chats, contacts] = await Promise.all([
            prisma.kanbanColumn.findMany({ where: { sessionId: session.id } }),
            prisma.label.findMany({ where: { sessionId }, select: { id: true } }),
            prisma.chatLabel.findMany({ where: { label: { sessionId } }, select: { chatJid: true, labelId: true } }),
            prisma.chatStage.findMany({ where: { sessionId: session.id }, select: { chatJid: true, stage: true }, orderBy: { updatedAt: "desc" } }),
            ChatService.getChatsList(session.id, null, before, search, filter, assignments?.map(a => a.chatJid), true),
            prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } }),
        ]);
        const identities = chatIdentities(contacts);
        allAssignments.forEach(a => { a.chatJid = identities.canonical(a.chatJid); });
        stages.forEach(s => { s.chatJid = identities.canonical(s.chatJid); });
        const columns = resolveKanbanColumns(saved, labels);
        return chats.filter(c => matchesKanbanColumn(c.jid, columnId, columns, allAssignments, stages)).slice(0, limit);
    }
    return await ChatService.getChatsList(session.id, limit, before, search, filter, assignments?.map(a => a.chatJid), true);
}

// Fetch messages for a specific chat with cursor pagination
export async function getChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const { messages, hasMore } = await ChatService.getMessages(session.id, jid, limit, before);

    return {
        messages: await Promise.all(messages.map(async (msg: any) => {
            let status = msg.status;
            if (msg.fromMe && !jid.endsWith('@g.us') && status !== 'READ') {
                const receipts = await readMessageReceipts(session.id, msg.keyId);
                status = effectiveDirectMessageStatus(status, receipts);
            }
            return {
                ...msg,
                status,
                timestamp: msg.timestamp instanceof Date
                    ? msg.timestamp.toISOString()
                    : String(msg.timestamp)
            };
        })),
        hasMore
    };
}

// Send a basic text message
export async function sendChatMessage(sessionId: string, jid: string, text: string, quotedMessageId?: string, mentions?: string[]) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        if (mentions && (mentions.length > 50 || mentions.some(id => !/^\d+@(lid|s\.whatsapp\.net)$/.test(id)))) throw new Error("Menções inválidas");
        const result = await ChatService.sendTextMessage(sessionId, jid, { text }, mentions, quotedMessageId);
        return { success: true, message: result.localMessage };
    } catch (error: any) {
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

// Upload and Send Media
export async function sendMediaMessage(formData: FormData) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const sessionId = formData.get("sessionId") as string;
    const jid = formData.get("jid") as string;
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    const caption = formData.get("caption") as string || "";

    if (!sessionId || !jid || !file || !type) {
        throw new Error("Missing required fields");
    }

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const buffer = Buffer.from(await file.arrayBuffer());

        await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption
        );

        return { success: true };
    } catch (error: any) {
        console.error("Media send error:", error);
        throw new Error(`Failed to send media: ${error.message}`);
    }
}

// Send Interactive Message (Native Flow buttons, single_select, CTA links, etc.)
export async function sendInteractiveChatMessage(
    sessionId: string,
    jid: string,
    payload: {
        title?: string;
        body: string;
        footer?: string;
        header?: any;
        buttons?: any[];
    }
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const result = await ChatService.sendInteractiveMessage(sessionId, jid, payload);
        return { success: true, result };
    } catch (error: any) {
        console.error("Interactive send error:", error);
        throw new Error(`Failed to send interactive message: ${error.message}`);
    }
}

