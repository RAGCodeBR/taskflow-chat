export interface MentionPerson { current?: boolean; jid: string; name: string; aliases: string[] }
export function formatMentions(text: string | null | undefined, people: MentionPerson[]): string {
    if (!text) return text || '';
    const names = new Map<string,string>();
    for (const person of people) for (const id of [person.jid,...person.aliases]) names.set(id.split('@')[0].split(':')[0], person.name);
    return text.replace(/(^|[^\w@])@(\d{5,20})(?!\d)/g, (full, prefix, id) => names.has(id) ? `${prefix}@${names.get(id)}` : full);
}
export function mentionPayload(text: string, selected: { token: string; jid: string }[]) {
    const mentions: string[] = [];
    let result = text;
    for (const entry of [...selected].sort((a,b) => b.token.length-a.token.length)) {
        const special = new Set(['.','*','+','?','^','$','{','}','(',')','|','[',']',String.fromCharCode(92)]);
        const escaped = [...entry.token].map(character => special.has(character) ? String.fromCharCode(92) + character : character).join('');
        const pattern = new RegExp(`(^|[^\\w@])${escaped}(?![\\p{L}\\p{N}_])`, 'gu');
        if (pattern.test(result)) { result = result.replace(pattern, (_full, prefix) => `${prefix}@${entry.jid.split('@')[0]}`); mentions.push(entry.jid); }
    }
    return { text: result, mentions: [...new Set(mentions)] };
}
