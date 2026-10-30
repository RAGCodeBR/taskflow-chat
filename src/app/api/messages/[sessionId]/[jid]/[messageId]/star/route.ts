import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { chatIdentities } from "@/lib/chat-identities";

/**
 * POST /api/messages/{sessionId}/{jid}/{messageId}/star
 * Star or unstar a specific message. The favorite is saved in our own list first;
 * the WhatsApp star is best effort so a refusal never loses the favorite.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string; messageId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid: rawJid, messageId } = await params;
        const jid = decodeURIComponent(rawJid);

        const body = await request.json().catch(() => ({}));
        const star = body?.star !== false;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
        const target = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: session.id, keyId: messageId } } });
        const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
        if (!target || !chatIdentities(contacts).aliases(jid).includes(target.remoteJid)) {
            return NextResponse.json({ message: "Mensagem não encontrada nesta conversa." }, { status: 404 });
        }

        if (star) {
            await prisma.starredMessage.upsert({
                where: { sessionId_keyId: { sessionId: session.id, keyId: target.keyId } },
                create: { sessionId: session.id, remoteJid: target.remoteJid, keyId: target.keyId },
                update: {},
            });
        } else {
            await prisma.starredMessage.deleteMany({ where: { sessionId: session.id, keyId: target.keyId } });
        }

        const instance = waManager.getInstance(sessionId);
        if (instance?.socket) {
            await (instance.socket as any).chatModify({
                star: { messages: [{ id: target.keyId, fromMe: target.fromMe }], star }
            }, target.remoteJid).catch((error: unknown) => console.warn("WhatsApp star failed", error));
        }

        return NextResponse.json({ success: true, starred: star });

    } catch (error) {
        console.error("Star message error:", error);
        return NextResponse.json({ status: false, message: "Failed to star/unstar message", error: "Failed to star/unstar message" }, { status: 500 });
    }
}
