// Rebuilds a stored message so it can be sent again, marked as forwarded, to another conversation.
export const MAX_FORWARD_TARGETS = 5;
export const FORWARDED_CONTEXT = { isForwarded: true, forwardingScore: 1 };

const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', '3gpp': 'video/3gpp',
    ogg: 'audio/ogg; codecs=opus', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg', mpeg: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
    pdf: 'application/pdf',
};

// Only files this account downloaded ("/api/media/<session>-<id>.<ext>") can be forwarded.
export function forwardMediaFile(mediaUrl: string | null | undefined, sessionId: string): { fileName: string; ext: string } | null {
    const match = mediaUrl?.match(/^\/api\/media\/([A-Za-z0-9_-]+\.([a-z0-9]{1,10}))$/i);
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!match || !match[1].startsWith(`${safeSession}-`)) return null;
    return { fileName: match[1], ext: match[2].toLowerCase() };
}

export function forwardPayload(
    message: { type: string; content: string | null },
    media: { buffer: Buffer; ext: string } | null,
): Record<string, unknown> | null {
    const text = message.content?.trim() || '';
    const contextInfo = FORWARDED_CONTEXT;
    if (message.type === 'TEXT') return text ? { text, contextInfo } : null;
    if (!media) return null;
    const mimetype = MIME[media.ext] || 'application/octet-stream';
    switch (message.type) {
        case 'IMAGE': return { image: media.buffer, mimetype, ...(text ? { caption: text } : {}), contextInfo };
        case 'VIDEO': return { video: media.buffer, mimetype, ...(text ? { caption: text } : {}), contextInfo };
        case 'AUDIO': return { audio: media.buffer, mimetype, ptt: mimetype.startsWith('audio/ogg'), contextInfo };
        case 'STICKER': return { sticker: media.buffer, contextInfo };
        case 'DOCUMENT': return { document: media.buffer, mimetype, fileName: text || `documento.${media.ext}`, contextInfo };
        default: return null;
    }
}

export function validForwardTargets(value: unknown, fromJid: string): string[] | null {
    if (!Array.isArray(value)) return null;
    const targets = [...new Set(value)].filter(jid => typeof jid === 'string' && jid !== fromJid) as string[];
    return targets.length && targets.length <= MAX_FORWARD_TARGETS ? targets : null;
}
