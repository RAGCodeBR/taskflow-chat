/** Extract only ordinary HTTP(S) links from message text. React renders all other text escaped. */
export function messageLinkParts(text: string): { text: string; href?: string }[] {
    const parts: { text: string; href?: string }[] = [];
    const pattern = /https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;
    let previous = 0;
    for (const match of text.matchAll(pattern)) {
        const start = match.index;
        if (start > previous) parts.push({ text: text.slice(previous, start) });
        const raw = match[0];
        const url = raw.replace(/[.,!?;:]+$/g, '').replace(/\)+$/g, closing => {
            const opens = (raw.match(/\(/g) || []).length;
            const closes = (raw.match(/\)/g) || []).length;
            return ')'.repeat(Math.max(0, closing.length - Math.max(0, closes - opens)));
        });
        if (url) parts.push({ text: url, href: url.startsWith('www.') ? `https://${url}` : url });
        if (raw.length > url.length) parts.push({ text: raw.slice(url.length) });
        previous = start + raw.length;
    }
    if (previous < text.length) parts.push({ text: text.slice(previous) });
    const merged: typeof parts = [];
    for (const part of parts) {
        const last = merged[merged.length - 1];
        if (!part.href && last && !last.href) last.text += part.text;
        else merged.push(part);
    }
    return merged.length ? merged : [{ text }];
}
