const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'] as const;
export function selectMediaPayload(content: Record<string, any>) {
    const type = MEDIA_TYPES.find(key => content[key] && typeof content[key] === 'object');
    if (!type) return null;
    const original = content[type];
    const media = { ...original };
    if (!media.url && typeof media.directPath === 'string' && media.directPath.startsWith('/')) media.url = `https://mmg.whatsapp.net${media.directPath}`;
    return { type, media };
}
