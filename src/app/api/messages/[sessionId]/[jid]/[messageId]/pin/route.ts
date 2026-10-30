import { NextResponse, NextRequest } from 'next/server';
import { waManager } from '@/modules/whatsapp/manager';
import { getAuthenticatedUser, canAccessSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { chatIdentities } from '@/lib/chat-identities';
import { PIN_DURATIONS, DEFAULT_PIN_SECONDS, pinKeyFor, pinResultFromError, type PinDuration } from '@/lib/message-marks';
import { listPins } from '@/lib/message-marks-server';

type Params = { params: Promise<{ sessionId: string; jid: string; messageId: string }> };

async function resolveTarget(request: NextRequest, { params }: Params) {
    const user = await getAuthenticatedUser(request);
    if (!user) return { error: NextResponse.json({ message: 'Entre novamente.' }, { status: 401 }) };
    const { sessionId, jid: rawJid, messageId } = await params;
    const jid = decodeURIComponent(rawJid);
    if (!await canAccessSession(user.id, user.role, sessionId)) return { error: NextResponse.json({ message: 'Sem acesso.' }, { status: 403 }) };
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) return { error: NextResponse.json({ message: 'Sessão não encontrada.' }, { status: 404 }) };
    const target = await prisma.message.findUnique({ where: { sessionId_keyId: { sessionId: session.id, keyId: messageId } } });
    const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
    if (!target || !chatIdentities(contacts).aliases(jid).includes(target.remoteJid)) return { error: NextResponse.json({ message: 'Mensagem não encontrada nesta conversa.' }, { status: 404 }) };
    return { sessionId, dbSessionId: session.id, target };
}

// WhatsApp needs our own jid as participant for our group messages (same as reactions).
function keyFor(target: { remoteJid: string; keyId: string; fromMe: boolean; senderJid: string | null }, self: string | undefined) {
    const key = pinKeyFor(target);
    if (target.remoteJid.endsWith('@g.us') && target.fromMe && self) key.participant = self;
    return key;
}

export async function POST(request: NextRequest, context: Params) {
    try {
        const resolved = await resolveTarget(request, context);
        if ('error' in resolved) return resolved.error;
        const { sessionId, dbSessionId, target } = resolved;
        const body = await request.json().catch(() => null);
        const time: PinDuration = PIN_DURATIONS.includes(body?.time) ? body.time : DEFAULT_PIN_SECONDS;
        const instance = waManager.getInstance(sessionId);
        let scope: 'whatsapp' | 'local' = 'whatsapp';
        let warning: string | undefined;
        try {
            if (!instance?.socket || instance.status !== 'CONNECTED') throw new Error('disconnected');
            const self = instance.socket.user?.id?.replace(/:\d+@/, '@');
            await instance.socket.sendMessage(target.remoteJid, { pin: keyFor(target, self), type: 1, time } as any);
        } catch (error) {
            ({ scope, warning } = pinResultFromError(error));
        }
        const where = { sessionId_remoteJid_keyId: { sessionId: dbSessionId, remoteJid: target.remoteJid, keyId: target.keyId } };
        const expiresAt = new Date(Date.now() + time * 1000);
        await prisma.pinnedMessage.upsert({ where, create: { sessionId: dbSessionId, remoteJid: target.remoteJid, keyId: target.keyId, scope, expiresAt }, update: { scope, pinnedBy: null, pinnedAt: new Date(), expiresAt } });
        const pin = (await listPins(dbSessionId, [target.remoteJid])).find(p => p.keyId === target.keyId);
        return NextResponse.json({ pin, ...(warning ? { warning } : {}) });
    } catch (error) {
        console.error('Pin failed', error);
        return NextResponse.json({ message: 'Não foi possível fixar a mensagem.' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, context: Params) {
    try {
        const resolved = await resolveTarget(request, context);
        if ('error' in resolved) return resolved.error;
        const { sessionId, dbSessionId, target } = resolved;
        const row = await prisma.pinnedMessage.findUnique({ where: { sessionId_remoteJid_keyId: { sessionId: dbSessionId, remoteJid: target.remoteJid, keyId: target.keyId } } });
        if (row?.scope === 'whatsapp') {
            const instance = waManager.getInstance(sessionId);
            const self = instance?.socket?.user?.id?.replace(/:\d+@/, '@');
            // Best effort: the local pin is removed even if WhatsApp refuses.
            await instance?.socket?.sendMessage(target.remoteJid, { pin: keyFor(target, self), type: 2 } as any).catch(() => {});
        }
        await prisma.pinnedMessage.deleteMany({ where: { sessionId: dbSessionId, remoteJid: target.remoteJid, keyId: target.keyId } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Unpin failed', error);
        return NextResponse.json({ message: 'Não foi possível desfixar a mensagem.' }, { status: 500 });
    }
}
