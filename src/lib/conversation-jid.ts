// Status posts, broadcast feeds and channels must not alert as direct conversations.
export function isConversationJid(jid: unknown): jid is string {
    return typeof jid === 'string' && /@(s\.whatsapp\.net|c\.us|lid|g\.us)$/.test(jid);
}
