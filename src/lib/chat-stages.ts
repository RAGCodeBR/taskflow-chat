export const CHAT_STAGES = [
    { id: "new", name: "Novo contato", color: "#64748b" },
    { id: "active", name: "Em atendimento", color: "#3b82f6" },
    { id: "proposal", name: "Proposta enviada", color: "#f59e0b" },
    { id: "done", name: "Concluído", color: "#10b981" },
] as const;
export type ChatStageId = string;

export interface KanbanColumnConfig {
    cardOrder?: string[];
    pinnedJids?: string[];
    orderedAt?: string | null;
    id: ChatStageId;
    name: string;
    color: string;
    labelIds: string[];
}
export const DEFAULT_KANBAN_COLUMNS: KanbanColumnConfig[] = CHAT_STAGES.map(s => ({ ...s, labelIds: [] }));

export function matchesKanbanColumn(jid: string, columnId: string, columns: KanbanColumnConfig[], assignments: { chatJid: string; labelId: string }[], stages: { chatJid: string; stage: string }[]) {
    const column = columns.find(c => c.id === columnId);
    if (!column) return false;
    const labels = new Set(assignments.filter(a => a.chatJid === jid).map(a => a.labelId));
    if (column.labelIds.length) return column.labelIds.some(id => labels.has(id));
    if (columns.some(c => c.labelIds.some(id => labels.has(id)))) return false;
    return (stages.find(s => s.chatJid === jid)?.stage || "new") === columnId;
}

export function sortKanbanCards<T extends { jid: string; lastMessage?: { timestamp: string } }>(cards: T[], column: KanbanColumnConfig, unread: Record<string, number> = {}): T[] {
    const order = new Map((column.cardOrder || []).map((jid, index) => [jid, index]));
    // Pinned conversations keep the order the owner gave them; new messages never reshuffle them.
    const pinned = new Map((column.pinnedJids || []).map((jid, index) => [jid, index]));
    const cutoff = column.orderedAt ? new Date(column.orderedAt).getTime() : 0;
    const time = (card: T) => new Date(card.lastMessage?.timestamp || 0).getTime();
    return [...cards].sort((a,b) => {
        const pinPriority = Number(pinned.has(b.jid)) - Number(pinned.has(a.jid));
        if (pinPriority) return pinPriority;
        if (pinned.has(a.jid)) return pinned.get(a.jid)! - pinned.get(b.jid)!;
        if (cutoff) {
            const freshA = time(a) > cutoff, freshB = time(b) > cutoff;
            if (freshA || freshB) return Number(freshB) - Number(freshA) || time(b) - time(a);
            return (order.get(a.jid) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.jid) ?? Number.MAX_SAFE_INTEGER) || time(b) - time(a);
        }
        return Number((unread[b.jid] || 0) > 0) - Number((unread[a.jid] || 0) > 0) || time(b) - time(a);
    });
}

export function reorderPinned(pinned: string[], source: string, target: string, edge: 'before' | 'after'): string[] {
    if (!pinned.includes(source) || !pinned.includes(target)) return pinned;
    return moveKanbanCard(pinned, source, target, edge);
}

export function moveKanbanCard(order: string[], jid: string, target: string | null, edge: 'before' | 'after' = 'before') {
    if (!order.includes(jid) || jid === target || (target !== null && !order.includes(target))) return order;
    const result = order.filter(id => id !== jid);
    const index = target === null ? result.length : result.indexOf(target) + Number(edge === 'after');
    result.splice(index, 0, jid);
    return result;
}

export function resolveKanbanColumns(saved: { stage: string; name: string; labelIds: unknown; cardOrder?: unknown; pinnedJids?: unknown; orderedAt?: Date | string | null; position?: number | null; color?: string }[], labels: {id:string}[]): KanbanColumnConfig[] {
    const definitions = [...CHAT_STAGES.map(c => ({...c})), ...saved.filter(s => !CHAT_STAGES.some(c => c.id === s.stage)).map(s => ({ id: s.stage, name: s.name, color: s.color || '#8b5cf6' }))];
    return definitions.map((column,index) => {
        const config = saved.find(s => s.stage === column.id);
        return { ...column, color: config?.color || column.color, name: config?.name || column.name,
            labelIds: Array.isArray(config?.labelIds) ? config.labelIds.filter((id): id is string => typeof id === 'string' && labels.some(l => l.id === id)) : [],
            cardOrder: Array.isArray(config?.cardOrder) ? config.cardOrder.filter((id): id is string => typeof id === 'string') : [],
            pinnedJids: Array.isArray(config?.pinnedJids) ? config.pinnedJids.filter((id): id is string => typeof id === 'string') : [],
            orderedAt: config?.orderedAt instanceof Date ? config.orderedAt.toISOString() : config?.orderedAt || null,
            position: config?.position ?? index,
        };
    }).sort((a,b) => a.position-b.position);
}
