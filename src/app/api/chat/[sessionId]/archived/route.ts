import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { chatIdentities } from "@/lib/chat-identities";
import { archivedSet } from "@/lib/archived-chats";
import { ChatService } from "@/modules/whatsapp/chat.service";

// GET: archived conversations of this account, most recently archived first.
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ message: "Entre novamente." }, { status: 401 });
        const { sessionId } = await params;
        if (!await canAccessSession(user.id, user.role, sessionId)) return NextResponse.json({ message: "Sem acesso." }, { status: 403 });
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
        const [rows, contacts, chats] = await Promise.all([
            prisma.archivedChat.findMany({ where: { sessionId: session.id }, orderBy: { archivedAt: "desc" } }),
            prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } }),
            ChatService.getChatsList(session.id, null, undefined, undefined, "all"),
        ]);
        const identities = chatIdentities(contacts);
        const archived = archivedSet(rows.map(row => row.jid), identities.canonical);
        const archivedAt = new Map(rows.map(row => [identities.canonical(row.jid), row.archivedAt.toISOString()]));
        const items = chats.filter((chat: { jid: string }) => archived.has(chat.jid))
            .map((chat: any) => ({ jid: chat.jid, name: chat.name || chat.notify || chat.jid.split("@")[0], profilePic: chat.profilePic, lastMessage: chat.lastMessage, archivedAt: archivedAt.get(chat.jid) }))
            .sort((a: any, b: any) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
        return NextResponse.json({ items });
    } catch (error) {
        console.error("Archived list failed", error);
        return NextResponse.json({ message: "Não foi possível carregar as conversas arquivadas." }, { status: 500 });
    }
}
