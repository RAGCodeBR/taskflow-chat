import { chatIdentities } from "./chat-identities";

export interface DestinationContact { jid: string; lid: string | null; remoteJidAlt: string | null; name: string | null; notify: string | null; customName: string | null; profilePic?: string | null }
export interface Destination { jid: string; name: string | null; notify: string | null; profilePic?: string | null; phone?: string | null; contactOnly?: boolean }

const INDIVIDUAL = /^\d+@(s\.whatsapp\.net|c\.us|lid)$/;
const phoneOf = (ids: (string | null)[]) => ids.map(id => id?.match(/^(\d{6,15})@(s\.whatsapp\.net|c\.us)$/)?.[1]).find(Boolean) || null;

// Saved contacts of the account that have no conversation yet, one per person, so a message can be
// forwarded (or a card shared) to anyone in the address book, as in WhatsApp.
export function contactDestinations(contacts: DestinationContact[], chatJids: string[]): Destination[] {
    const identities = chatIdentities(contacts);
    const taken = new Set(chatJids.map(jid => identities.canonical(jid)));
    const people = new Map<string, Destination>();
    for (const c of contacts) {
        if (!INDIVIDUAL.test(c.jid)) continue;
        const key = identities.canonical(c.jid);
        if (taken.has(key) || !INDIVIDUAL.test(key)) continue;
        const prev = people.get(key);
        const name = prev?.name && prev.name !== prev.notify ? prev.name : c.customName || c.name || prev?.name || null;
        people.set(key, { jid: key, name, notify: prev?.notify || c.notify, profilePic: prev?.profilePic || c.profilePic || null, phone: prev?.phone || phoneOf([key, c.jid, c.remoteJidAlt]), contactOnly: true });
        if (c.customName) people.get(key)!.name = c.customName;
    }
    return [...people.values()].filter(d => d.name || d.notify || d.phone)
        .sort((a, b) => (a.name || a.notify || a.phone || '').localeCompare(b.name || b.notify || b.phone || '', 'pt-BR'));
}

export function matchesDestination(d: Destination, query: string): boolean {
    const norm = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
    const q = norm(query.trim());
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    return norm(`${d.name || ''} ${d.notify || ''}`).includes(q) || (digits.length >= 3 && `${d.phone || ''} ${d.jid}`.includes(digits));
}
