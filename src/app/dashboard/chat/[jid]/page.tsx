import { prisma } from "@/lib/prisma";
import { chatIdentities } from "@/lib/chat-identities";
import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { canAccessSession } from "@/lib/api-auth";
import { SessionGuard } from "@/components/dashboard/session-guard";

export default async function ChatWithJidPage({
    params,
}: {
    params: Promise<{ jid: string }>;
}) {
    const { jid: rawJid } = await params;
    const session = await auth();

    if (!session?.user?.id) return <div>Unauthorized</div>;

    let clean = rawJid.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.substring(1);
    let resolvedJid = rawJid.includes("@") ? rawJid : `${clean}@s.whatsapp.net`;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("sessionId")?.value;
    let validSessionId: string | null = null;

    if (sessionId) {
        const hasAccess = await canAccessSession(session.user.id, session.user.role, sessionId);
        if (hasAccess) {
            validSessionId = sessionId;
        }
    }

    if (!validSessionId) {
        return (
            <SessionGuard>
                <ChatInterface sessionId={null} />
            </SessionGuard>
        );
    }

    const dbSession = await prisma.session.findUnique({ where: { sessionId: validSessionId }, select: { id: true } });
    if (dbSession) {
        const contacts = await prisma.contact.findMany({ where: { sessionId: dbSession.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
        const identities = chatIdentities(contacts);
        if (!rawJid.includes("@") && !contacts.some(c => c.jid === resolvedJid)) {
            const linked = identities.canonical(`${clean}@lid`);
            if (linked !== `${clean}@lid`) resolvedJid = linked;
        }
        resolvedJid = identities.canonical(resolvedJid);
    }

    return (
        <div className="h-[calc(100vh-6.5rem)] sm:h-[calc(100vh-6rem)]">
            <ChatLayoutClient
                key={`${validSessionId}-${resolvedJid}`}
                sessionId={validSessionId}
                initialJid={resolvedJid}
            />
        </div>
    );
}
