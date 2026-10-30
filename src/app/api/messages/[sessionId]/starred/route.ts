import { NextResponse, NextRequest } from 'next/server';
import { getAuthenticatedUser, canAccessSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { chatIdentities } from '@/lib/chat-identities';
import { listStarred } from '@/lib/message-marks-server';

// GET ?q=text&jid=chat (jid optional: only that conversation's favorites)
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ message: 'Entre novamente.' }, { status: 401 });
        const { sessionId } = await params;
        if (!await canAccessSession(user.id, user.role, sessionId)) return NextResponse.json({ message: 'Sem acesso.' }, { status: 403 });
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: 'Sessão não encontrada.' }, { status: 404 });
        const q = (request.nextUrl.searchParams.get('q') || '').slice(0, 200);
        const jid = request.nextUrl.searchParams.get('jid');
        let jids: string[] | undefined;
        if (jid) {
            const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
            jids = chatIdentities(contacts).aliases(jid);
        }
        return NextResponse.json({ items: await listStarred(session.id, q, jids) });
    } catch (error) {
        console.error('Starred list failed', error);
        return NextResponse.json({ message: 'Não foi possível carregar as favoritas.' }, { status: 500 });
    }
}
