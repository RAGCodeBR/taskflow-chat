import { prisma } from './prisma';
import { chatIdentities } from './chat-identities';
import type { MentionPerson } from './mentions';
export async function getGroupPeople(dbSessionId: string, jid: string): Promise<MentionPerson[]> {
    const [group, contacts, senders] = await Promise.all([
        prisma.group.findUnique({ where: { sessionId_jid: { sessionId: dbSessionId, jid } }, select: { participants: true } }),
        prisma.contact.findMany({ where: { sessionId: dbSessionId }, select: { jid: true, lid: true, remoteJidAlt: true, name: true, customName: true, notify: true, verifiedName: true } }),
        prisma.message.findMany({ where: { sessionId: dbSessionId, remoteJid: jid, senderJid: { not: null }, pushName: { not: null } }, distinct: ['senderJid'], orderBy: { timestamp: 'desc' }, select: { senderJid: true, pushName: true } }),
    ]);
    const participants: any[] = Array.isArray(group?.participants) ? group.participants : [];
    const links = participants.filter(p => typeof p.id === 'string').map(p => ({ jid: p.id, lid: typeof p.lid === 'string' ? p.lid : null, remoteJidAlt: typeof p.phoneNumber === 'string' && p.phoneNumber.includes('@') ? p.phoneNumber : null }));
    const identities = chatIdentities([...contacts,...links]);
    const names = new Map<string,string>();
    for (const sender of senders) if (sender.senderJid && sender.pushName) names.set(identities.canonical(sender.senderJid),sender.pushName);
    for (const c of contacts) { const name = c.customName || c.name || c.notify || c.verifiedName; if (name) names.set(identities.canonical(c.jid),name); }
    for (const c of contacts) if (c.customName) names.set(identities.canonical(c.jid), c.customName);
    const result = new Map<string,MentionPerson>();
    for (const p of participants) {
        if (typeof p.id !== 'string') continue;
        const canonical = identities.canonical(p.id);
        result.set(canonical,{ current: true, jid: p.id, name: names.get(canonical) || p.name || p.notify || p.id.split('@')[0], aliases: identities.aliases(p.id) });
    }
    // Former participants still need names in historical mentions.
    for (const sender of senders) {
        if (!sender.senderJid) continue;
        const canonical = identities.canonical(sender.senderJid);
        if (!result.has(canonical)) result.set(canonical,{current:false,jid:canonical,name:names.get(canonical) || canonical.split('@')[0],aliases:identities.aliases(canonical)});
    }
    return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
