"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { ChatWindow } from "./chat-window";
import { ChatAvatar } from "./chat-avatar";
import type { BoardChat } from "./conversation-board";
import { cn } from "@/lib/utils";
import {
    DOCK_GAP, DOCK_TRAY_WIDTH, clearFocusInDock, closeInDock, dockCapacity, dockSlotWidth, fitDock, focusInDock, isDockMobile, usedSlots,
    minimizeInDock, minimizedEntries, openInDock, parseDock, renameInDock, serializeDock, toggleExpandInDock,
    visibleEntries, type DockEntry,
} from "@/lib/chat-dock";

const newestVisible = (list: DockEntry[]) => visibleEntries(list).sort((a, b) => b.touched - a.touched)[0]?.jid;

/** Conversation windows over the Kanban, remembered per WhatsApp account in this browser. */
export function useConversationDock(sessionId: string) {
    const key = `chat-dock:${sessionId}`;
    const [entries, setEntries] = useState<DockEntry[]>([]);
    // Which account the entries belong to; nothing is saved until that account's windows are restored.
    const loadedKey = useRef<string | null>(null);
    const capacity = useRef(1);
    useEffect(() => {
        let saved: DockEntry[] = [];
        try { saved = parseDock(localStorage.getItem(key)); } catch {}
        loadedKey.current = key;
        // Restoring from browser storage can only happen after mount (the server has no storage).
        setEntries(fitDock(saved, capacity.current, newestVisible(saved)));
    }, [key]);
    useEffect(() => { if (loadedKey.current === key) try { localStorage.setItem(key, serializeDock(entries)); } catch {} }, [entries, key]);

    const open = useCallback((chat: { jid: string; name?: string; focusKeyId?: string }) =>
        setEntries(list => openInDock(list, chat, capacity.current, Date.now())), []);
    const close = useCallback((jid: string) => setEntries(list => closeInDock(list, jid)), []);
    const minimize = useCallback((jid: string) => setEntries(list => minimizeInDock(list, jid)), []);
    const focus = useCallback((jid: string) => setEntries(list => {
        const next = focusInDock(list, jid, Date.now());
        // Focus happens on every click inside a window; skip the re-render when it is already the newest.
        return newestVisible(list) === jid ? list : next;
    }), []);
    const toggleExpand = useCallback((jid: string) => setEntries(list => toggleExpandInDock(list, jid, capacity.current, Date.now())), []);
    const rename = useCallback((jid: string, name: string) => setEntries(list => renameInDock(list, jid, name)), []);
    const clearFocus = useCallback((jid: string) => setEntries(list => clearFocusInDock(list, jid)), []);
    const setCapacity = useCallback((value: number) => {
        if (capacity.current === value) return;
        capacity.current = value;
        setEntries(list => fitDock(list, value, newestVisible(list)));
    }, []);
    const visibleJids = useMemo(() => visibleEntries(entries).map(entry => entry.jid), [entries]);
    return { entries, visibleJids, open, close, minimize, focus, toggleExpand, rename, clearFocus, setCapacity };
}

export type ConversationDockState = ReturnType<typeof useConversationDock>;

export function ConversationDock({ sessionId, dock, chats, unread, onFocusDone }: {
    sessionId: string;
    dock: ConversationDockState;
    chats: BoardChat[];
    unread: Record<string, number>;
    onFocusDone: (found: boolean) => void;
}) {
    const area = useRef<HTMLDivElement>(null);
    const [areaWidth, setAreaWidth] = useState(0);
    const mobile = areaWidth > 0 && isDockMobile(areaWidth);
    const { setCapacity } = dock;
    useLayoutEffect(() => {
        // Measure the board area, not the dock: on phones the dock itself becomes full screen.
        const element = area.current?.parentElement;
        if (!element) return;
        const measure = () => {
            const width = element.getBoundingClientRect().width;
            setAreaWidth(width);
            setCapacity(dockCapacity(width));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [setCapacity]);

    const chatFor = (jid: string) => chats.find(chat => chat.jid === jid || chat.aliases?.includes(jid));
    const nameFor = (entry: DockEntry) => {
        const chat = chatFor(entry.jid);
        return entry.name || chat?.name || chat?.notify || entry.jid.split("@")[0];
    };
    const visible = visibleEntries(dock.entries);
    const minimized = minimizedEntries(dock.entries);
    const slotWidth = dockSlotWidth(areaWidth, Math.max(1, usedSlots(dock.entries, dockCapacity(areaWidth))));
    const windowsWidth = visible.reduce((total, entry) => total + (entry.expanded ? slotWidth * 2 + DOCK_GAP : slotWidth) + DOCK_GAP, 0);
    const active = visible.slice().sort((a, b) => b.touched - a.touched)[0]?.jid;
    const totalUnread = (entry: DockEntry) => unread[chatFor(entry.jid)?.jid || entry.jid] || 0;

    const tray = minimized.length > 0 && <div role="toolbar" aria-label="Conversas minimizadas" className={cn("wa-dock-tray pointer-events-auto flex shrink-0 gap-2",
        mobile ? "flex-row overflow-x-auto px-3 py-2" : "flex-col-reverse items-center overflow-y-auto py-1")} style={mobile ? undefined : { width: DOCK_TRAY_WIDTH }}>
        {minimized.map(entry => {
            const name = nameFor(entry), count = totalUnread(entry);
            return <div key={entry.jid} className="wa-dock-head group/head relative shrink-0">
                <button type="button" onClick={() => dock.open({ jid: entry.jid, name })} title={name}
                    aria-label={`Abrir conversa com ${name}${count ? `, ${count} ${count === 1 ? "mensagem não lida" : "mensagens não lidas"}` : ""}`}
                    className="relative block rounded-full transition-transform duration-150 ease-out hover:scale-105 active:scale-95 motion-reduce:transition-none">
                    <ChatAvatar sessionId={sessionId} jid={entry.jid} name={name} profilePic={chatFor(entry.jid)?.profilePic || null} />
                    {count > 0 && <span key={count} className="wa-dock-badge absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums">{count > 99 ? "99+" : count}</span>}
                </button>
                {!mobile && <span aria-hidden="true" className="wa-dock-label pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium opacity-0 transition-opacity duration-150 group-hover/head:opacity-100">{name}</span>}
                <button type="button" onClick={() => dock.close(entry.jid)} aria-label={`Fechar conversa com ${name}`} title="Fechar"
                    className="wa-dock-head-close absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/head:opacity-100">
                    <X className="h-3 w-3" />
                </button>
            </div>;
        })}
    </div>;

    return <div ref={area} className={cn("wa-dock pointer-events-none z-30", mobile && visible.length ? "fixed inset-0 z-50 flex flex-col" : "absolute inset-0 flex items-stretch justify-end p-2")}
        style={mobile ? undefined : { gap: DOCK_GAP }}>
        {mobile && visible.length > 0 && tray}
        {visible.map(entry => {
            const name = nameFor(entry);
            const expanded = entry.expanded && !mobile;
            const width = mobile ? undefined : expanded ? slotWidth * 2 + DOCK_GAP : slotWidth;
            return <section key={entry.jid} aria-label={`Conversa com ${name}`} data-active={entry.jid === active ? "true" : undefined}
                onPointerDownCapture={() => dock.focus(entry.jid)} onFocusCapture={() => dock.focus(entry.jid)}
                className={cn("wa-dock-window pointer-events-auto flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
                    "animate-in fade-in-0 slide-in-from-bottom-3 duration-200 motion-reduce:animate-none",
                    mobile ? "flex-1" : "shrink-0 rounded-2xl border shadow-2xl transition-[width] duration-200 ease-out motion-reduce:transition-none")}
                style={width ? { width, maxWidth: "100%" } : undefined}>
                <ChatWindow sessionId={sessionId} jid={entry.jid} name={name} compact={!expanded}
                    onClose={() => dock.close(entry.jid)} focusKeyId={entry.focusKeyId}
                    onFocusDone={found => { dock.clearFocus(entry.jid); onFocusDone(found); }}
                    headerActions={<>
                        <button type="button" onClick={() => dock.minimize(entry.jid)} title="Minimizar" aria-label={`Minimizar conversa com ${name}`}
                            className="wa-dock-action shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Minus className="h-4 w-4" /></button>
                        {!mobile && <button type="button" onClick={() => dock.toggleExpand(entry.jid)} title={expanded ? "Reduzir" : "Ampliar"}
                            aria-label={expanded ? `Reduzir conversa com ${name}` : `Ampliar conversa com ${name}`} aria-pressed={expanded}
                            className="wa-dock-action shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>}
                    </>} />
            </section>;
        })}
        {/* The tray floats over the board, just left of the open windows, so it never takes a window's place. */}
        {(!mobile || !visible.length) && tray && <div className={cn("pointer-events-none absolute flex items-end", mobile ? "bottom-4 right-4" : "bottom-2")}
            style={mobile ? undefined : { right: 8 + windowsWidth }}>{tray}</div>}
    </div>;
}
