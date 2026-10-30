import type { proto } from "@whiskeysockets/baileys";

// Pinned and starred messages: pure helpers shared by the store, the API routes and tests.
export const PIN_DURATIONS = [86400, 604800, 2592000] as const;
export type PinDuration = typeof PIN_DURATIONS[number];
export const DEFAULT_PIN_SECONDS: PinDuration = 604800;

export function pinKeyFor(m: { remoteJid: string; keyId: string; fromMe: boolean; senderJid: string | null }) {
    const key: { remoteJid: string; id: string; fromMe: boolean; participant?: string } = { remoteJid: m.remoteJid, id: m.keyId, fromMe: m.fromMe };
    // WhatsApp identifies a group message from someone else by its sender too.
    if (m.remoteJid.endsWith("@g.us") && !m.fromMe && m.senderJid) key.participant = m.senderJid;
    return key;
}

export function parsePinEvent(msg: proto.IWebMessageInfo) {
    const pin = msg.message?.pinInChatMessage;
    const keyId = pin?.key?.id;
    if (!pin || !keyId || !msg.key?.remoteJid) return null;
    const seconds = Number(msg.message?.messageContextInfo?.messageAddOnDurationInSecs) || DEFAULT_PIN_SECONDS;
    return {
        remoteJid: msg.key.remoteJid,
        keyId,
        pin: pin.type !== 2,
        seconds,
        by: msg.key.participant || (msg.key.fromMe ? null : msg.key.remoteJid) || null,
    };
}

export function activePins<T extends { expiresAt: Date | null }>(rows: T[], now: Date): T[] {
    return rows.filter(row => !row.expiresAt || row.expiresAt > now);
}

export function normalizeSearch(text: string) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function matchesStarQuery(row: { content: string | null; chatName: string; senderName: string }, q: string) {
    const query = normalizeSearch(q);
    if (!query) return true;
    return [row.content || "", row.chatName, row.senderName].some(field => normalizeSearch(field).includes(query));
}

export function pinResultFromError(_error: unknown): { scope: "local"; warning: string } {
    return { scope: "local", warning: "O WhatsApp não aceitou a fixação. Ela ficou fixada só para você." };
}
