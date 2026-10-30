import type { MentionPerson } from './mentions';
interface SenderIdentity { senderJid?: string | null; pushName?: string | null }
export function messageSenderName(message: SenderIdentity, people: MentionPerson[]): string {
    const jid = message.senderJid?.replace(/@c\.us$/, '@s.whatsapp.net');
    const person = jid ? people.find(person => person.jid === jid || person.aliases?.includes(jid)) : undefined;
    const name = person?.name?.trim();
    if (name && !/^\d+$/.test(name)) return name;
    return message.pushName?.trim() || 'Participante não identificado';
}
