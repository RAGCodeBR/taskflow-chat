export function phoneFromJid(jid: string): string | null {
    const match = jid.match(/^(\d{6,15})@(s\.whatsapp\.net|c\.us)$/);
    return match?.[1] || null;
}
export function formatContactPhone(phone: string): string {
    if (/^55\d{10,11}$/.test(phone)) return `+55 (${phone.slice(2,4)}) ${phone.slice(4,-4)}-${phone.slice(-4)}`;
    return `+${phone}`;
}
export function contactVCard(name: string, phone: string): string {
    if (!/^\d{6,15}$/.test(phone)) throw Error('Telefone inválido');
    const escaped = name.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
    return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${escaped}\r\nTEL;TYPE=CELL;waid=${phone}:+${phone}\r\nEND:VCARD`;
}
export const CONTACT_UPDATED_EVENT = 'chat:contact-updated';
