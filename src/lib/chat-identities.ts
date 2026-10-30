import { normalizeJid } from "./jid-utils";

// Merge only explicit WhatsApp identifiers. Matching names never establishes identity.
export function chatIdentities(contacts: { jid: string; lid: string | null; remoteJidAlt: string | null }[]) {
    const parent = new Map<string, string>();
    const find = (jid: string): string => {
        const key = normalizeJid(jid);
        const next = parent.get(key);
        if (!next || next === key) return key;
        const root = find(next); parent.set(key, root); return root;
    };
    for (const contact of contacts) {
        const ids = [contact.jid, contact.lid, contact.remoteJidAlt].filter((id): id is string => !!id && /@(lid|s\.whatsapp\.net|c\.us)$/.test(id));
        for (const id of ids.slice(1)) {
            const a = find(ids[0]), b = find(id);
            if (a === b) continue;
            const preferred = [a, b].sort((x,y) => Number(y.endsWith('@s.whatsapp.net')) - Number(x.endsWith('@s.whatsapp.net')) || x.localeCompare(y))[0];
            parent.set(a, preferred); parent.set(b, preferred);
        }
    }
    const canonical = (jid: string) => find(jid);
    const aliases = (jid: string) => [...new Set([normalizeJid(jid), canonical(jid), ...[...parent.keys()].filter(key => canonical(key) === canonical(jid))])];
    return { canonical, aliases };
}
