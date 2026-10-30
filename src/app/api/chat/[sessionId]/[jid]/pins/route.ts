import { NextResponse, NextRequest } from 'next/server';
import { getAuthenticatedUser, canAccessSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { chatIdentities } from '@/lib/chat-identities';
import { listPins } from '@/lib/message-marks-server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ message: 'Entre novamente.' }, { status: 401 });
        const { sessionId, jid: rawJid } = await params;
        if (!await canAccessSession(user.id, user.role, sessionId)) return NextResponse.json({ message: 'Sem acesso.' }, { status: 403 });
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: 'Sessão não encontrada.' }, { status: 404 });
        const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
        const pins = await listPins(session.id, chatIdentities(contacts).aliases(decodeURIComponent(rawJid)));
        return NextResponse.json({ pins });
    } catch (error) {
        console.error('Pins failed', error);
        return NextResponse.json({ message: 'Não foi possível carregar as mensagens fixadas.' }, { status: 500 });
    }
}
