import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { chatIdentities } from "@/lib/chat-identities";

// PUT: Archive or unarchive chat. Our own archive list is the source of truth for the
// Kanban and the list; archiving on WhatsApp (the phone) is best effort.
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const body = await request.json().catch(() => ({}));
        const { archive } = body;

        if (typeof archive !== "boolean") {
            return NextResponse.json({ status: false, message: "archive (boolean) is required", error: "archive (boolean) is required" }, { status: 400 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
        const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
        const identities = chatIdentities(contacts);
        const decodedJid = identities.canonical(decodeURIComponent(jid));
        const aliases = identities.aliases(decodedJid);

        if (archive) {
            await prisma.archivedChat.upsert({
                where: { sessionId_jid: { sessionId: session.id, jid: decodedJid } },
                create: { sessionId: session.id, jid: decodedJid },
                update: { archivedAt: new Date() },
            });
        } else {
            await prisma.archivedChat.deleteMany({ where: { sessionId: session.id, jid: { in: aliases } } });
        }

        // WhatsApp needs the chat's last message to archive it on the phone.
        let phoneSynced = false;
        const instance = waManager.getInstance(sessionId);
        const last = await prisma.message.findFirst({ where: { sessionId: session.id, remoteJid: { in: aliases } }, orderBy: { timestamp: "desc" } });
        if (instance?.socket && last) {
            try {
                await instance.socket.chatModify({
                    archive,
                    lastMessages: [{ key: { remoteJid: last.remoteJid, id: last.keyId, fromMe: last.fromMe, ...(last.remoteJid.endsWith("@g.us") && !last.fromMe && last.senderJid ? { participant: last.senderJid } : {}) }, messageTimestamp: Math.floor(last.timestamp.getTime() / 1000) }],
                }, last.remoteJid);
                phoneSynced = true;
            } catch (error) {
                console.warn("WhatsApp archive failed", error);
            }
        }

        return NextResponse.json({
            success: true,
            archived: archive,
            phoneSynced,
            message: archive ? "Chat archived" : "Chat unarchived"
        });

    } catch (error) {
        console.error("Archive chat error:", error);
        return NextResponse.json({ status: false, message: "Failed to archive/unarchive chat", error: "Failed to archive/unarchive chat" }, { status: 500 });
    }
}
