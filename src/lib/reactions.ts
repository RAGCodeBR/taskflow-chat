export interface ChatReaction { sender: string; emoji: string; fromMe: boolean }
export function mergeReaction(current: unknown, sender: string, emoji: string, fromMe: boolean): ChatReaction[] {
    const previous = Array.isArray(current) ? current.filter((r): r is ChatReaction => !!r && typeof r.sender === 'string' && typeof r.emoji === 'string') : [];
    return [...previous.filter(r => r.sender !== sender), ...(emoji ? [{sender,emoji,fromMe}] : [])];
}
