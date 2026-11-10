// Conversation windows opened over the Kanban board. Several can be open side by side;
// the ones that do not fit are minimized into the tray. Pure functions: the component owns the state.

export interface DockEntry {
    jid: string;
    name?: string;
    /** Message to scroll to once the window opens (favorites, pending items). Never persisted. */
    focusKeyId?: string;
    minimized: boolean;
    expanded: boolean;
    /** Last time this window was opened or focused; the least recent is minimized first. */
    touched: number;
}

/** Preferred and smallest width of one conversation window; windows shrink to fit more side by side. */
export const DOCK_WINDOW_WIDTH = 420;
export const DOCK_WINDOW_MIN_WIDTH = 340;
export const DOCK_GAP = 12;
export const DOCK_TRAY_WIDTH = 64;
export const DOCK_MAX_ENTRIES = 12;
/** Below this the board area is a phone: one conversation at a time, full screen. */
export const DOCK_MOBILE_WIDTH = 640;

export const isDockMobile = (width: number) => width < DOCK_MOBILE_WIDTH;

/** How many windows fit side by side in the board area (the minimized tray floats and takes no slot). */
export function dockCapacity(width: number) {
    if (isDockMobile(width)) return 1;
    return Math.max(1, Math.floor((width - DOCK_GAP) / (DOCK_WINDOW_MIN_WIDTH + DOCK_GAP)));
}

/** Width of one slot when `slots` windows share the board area. */
export function dockSlotWidth(width: number, slots: number) {
    const share = Math.floor((width - DOCK_GAP * (slots + 1)) / Math.max(1, slots));
    return Math.max(DOCK_WINDOW_MIN_WIDTH, Math.min(DOCK_WINDOW_WIDTH, share));
}

/** An expanded window takes two slots when there is room for two. */
const slots = (entry: DockEntry, capacity: number) => entry.expanded && capacity >= 2 ? 2 : 1;

export const usedSlots = (list: DockEntry[], capacity: number) =>
    list.filter(entry => !entry.minimized).reduce((total, entry) => total + (entry.expanded && capacity >= 2 ? 2 : 1), 0);

export const visibleEntries = (list: DockEntry[]) => list.filter(entry => !entry.minimized);
export const minimizedEntries = (list: DockEntry[]) => list.filter(entry => entry.minimized);

/** Minimizes the least recently used windows until the visible ones fit. `keep` is never minimized. */
export function fitDock(list: DockEntry[], capacity: number, keep?: string): DockEntry[] {
    let next = list.map(entry => entry.expanded && capacity < 2 ? { ...entry, expanded: false } : entry);
    const used = () => visibleEntries(next).reduce((total, entry) => total + slots(entry, capacity), 0);
    while (used() > capacity) {
        const victim = visibleEntries(next)
            .filter(entry => entry.jid !== keep)
            .sort((a, b) => a.touched - b.touched)[0];
        if (!victim) {
            // Only the kept window is left and it still does not fit: shrink it back to one slot.
            next = next.map(entry => entry.jid === keep ? { ...entry, expanded: false } : entry);
            break;
        }
        next = next.map(entry => entry.jid === victim.jid ? { ...entry, minimized: true, expanded: false } : entry);
    }
    return trimDock(next);
}

/** Keeps the tray bounded: the oldest minimized conversations leave first. */
function trimDock(list: DockEntry[]) {
    if (list.length <= DOCK_MAX_ENTRIES) return list;
    const drop = new Set(minimizedEntries(list).sort((a, b) => a.touched - b.touched)
        .slice(0, list.length - DOCK_MAX_ENTRIES).map(entry => entry.jid));
    return list.filter(entry => !drop.has(entry.jid));
}

export function openInDock(list: DockEntry[], chat: { jid: string; name?: string; focusKeyId?: string }, capacity: number, now: number) {
    const existing = list.find(entry => entry.jid === chat.jid);
    const next = existing
        ? list.map(entry => entry.jid === chat.jid
            ? { ...entry, name: chat.name || entry.name, focusKeyId: chat.focusKeyId ?? entry.focusKeyId, minimized: false, touched: now }
            : entry)
        : [...list, { jid: chat.jid, name: chat.name, focusKeyId: chat.focusKeyId, minimized: false, expanded: false, touched: now }];
    return fitDock(next, capacity, chat.jid);
}

export const closeInDock = (list: DockEntry[], jid: string) => list.filter(entry => entry.jid !== jid);

export const minimizeInDock = (list: DockEntry[], jid: string) =>
    list.map(entry => entry.jid === jid ? { ...entry, minimized: true, expanded: false } : entry);

export function focusInDock(list: DockEntry[], jid: string, now: number) {
    return list.some(entry => entry.jid === jid && !entry.minimized)
        ? list.map(entry => entry.jid === jid ? { ...entry, touched: now } : entry)
        : list;
}

export function toggleExpandInDock(list: DockEntry[], jid: string, capacity: number, now: number) {
    const target = list.find(entry => entry.jid === jid);
    if (!target) return list;
    const expanded = !target.expanded;
    // Only one wide window at a time.
    const next = list.map(entry => entry.jid === jid
        ? { ...entry, expanded, minimized: false, touched: now }
        : expanded ? { ...entry, expanded: false } : entry);
    return fitDock(next, capacity, jid);
}

export const renameInDock = (list: DockEntry[], jid: string, name: string) =>
    list.some(entry => entry.jid === jid) ? list.map(entry => entry.jid === jid ? { ...entry, name } : entry) : list;

export const clearFocusInDock = (list: DockEntry[], jid: string) =>
    list.map(entry => entry.jid === jid && entry.focusKeyId ? { ...entry, focusKeyId: undefined } : entry);

/** What is kept between visits: which conversations were open and how. */
export function serializeDock(list: DockEntry[]) {
    return JSON.stringify(list.map(({ jid, name, minimized, expanded, touched }) => ({ jid, name, minimized, expanded, touched })));
}

export function parseDock(raw: string | null): DockEntry[] {
    if (!raw) return [];
    try {
        const value: unknown = JSON.parse(raw);
        if (!Array.isArray(value)) return [];
        const seen = new Set<string>();
        const entries: DockEntry[] = [];
        for (const item of value) {
            if (!item || typeof item !== "object") continue;
            const { jid, name, minimized, expanded, touched } = item as Record<string, unknown>;
            if (typeof jid !== "string" || !jid.includes("@") || jid.length > 200 || seen.has(jid)) continue;
            seen.add(jid);
            entries.push({
                jid, name: typeof name === "string" ? name.slice(0, 200) : undefined,
                minimized: minimized === true, expanded: expanded === true,
                touched: typeof touched === "number" && Number.isFinite(touched) ? touched : 0,
            });
        }
        return entries.slice(-DOCK_MAX_ENTRIES);
    } catch { return []; }
}
