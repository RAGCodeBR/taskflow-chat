"use client";
import { isChatSessionEvent } from "@/lib/chat-session-events";

import { useState, useEffect, useCallback, useRef } from "react";
import { CONTACT_UPDATED_EVENT } from "@/lib/contact-card";
import {useOtherAccountAlerts} from "./use-other-account-alerts";
import { useSocket } from "./socket-context";
import { CONFIRMED_CHAT_EVENT, updateConversationPreviews, type ChatMessageUpdate } from "@/lib/chat-message-updates";
import { useChatFilters } from "./use-chat-filters";
import { useConversationAlerts } from "./use-conversation-alerts";
import { ChatList } from "./chat-list";
import { ChatWindow } from "./chat-window";
import { ConversationBoard, type BoardData } from "./conversation-board";
import { type ChatStageId } from "@/lib/chat-stages";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { MessageCircle, List, Columns3, RefreshCw, X, Volume2, VolumeX, Bell, BellOff, Pin, Star, Archive, BellRing } from "lucide-react";
import { PendingPanel, usePending } from "./follow-ups";
import { StarredPanel } from "./starred-panel";
import { ArchivedPanel } from "./archived-panel";
import { useTranslations } from "next-intl";

interface ChatLayoutClientProps {
    sessionId: string;
    initialJid?: string;
}

interface SelectedChat {
    jid: string;
    name?: string;
    /** Message to scroll to once the chat opens (from the favorites list). */
    focusKeyId?: string;
}

export function ChatLayoutClient({ sessionId, initialJid }: ChatLayoutClientProps) {
    const t = useTranslations("chat");
    useOtherAccountAlerts(sessionId);
    const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(
        initialJid ? { jid: initialJid } : null
    );

    const [boardToolbar,setBoardToolbar] = useState<HTMLDivElement|null>(null);
    const [view, setView] = useState<"list" | "kanban">("list");
    const { filters, updateFilters } = useChatFilters(sessionId);
    const { labelId, columnId } = filters;
    const setLabelId = (labelId: string) => updateFilters({ labelId });
    const setColumnId = (columnId: string) => updateFilters({ columnId });
    const [data, setData] = useState<BoardData>({ chats: [], labels: [], assignments: [], stages: [] });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [pending, setPending] = useState<Set<string>>(new Set());
    const pendingRef = useRef(new Set<string>());
    const generation = useRef(0);
    const [listVersion, setListVersion] = useState(0);

    useEffect(() => {
        try { if (localStorage.getItem(`chat-view:${sessionId}`) === "kanban") setView("kanban"); } catch {}
    }, [sessionId]);
    const loadBoard = useCallback(async () => {
        const current = ++generation.current;
        setLoading(true);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`);
            if (!response.ok) throw new Error("load");
            const result: BoardData = await response.json();
            if (current === generation.current && pendingRef.current.size === 0) {
                setData(result);
                setLoadError(false);
            }
        } catch {
            if (current === generation.current) setLoadError(true);
        } finally { if (current === generation.current) setLoading(false); }
    }, [sessionId]);
    useEffect(() => {
        loadBoard();
        const timer = setInterval(() => { if (!pendingRef.current.size) loadBoard(); }, 30_000);
        return () => { clearInterval(timer); generation.current++; };
    }, [loadBoard, view]);

    const alerts = useConversationAlerts({
        sessionId, chats: data.chats, selectedJid: selectedChat?.jid,
        onSelect: (jid, name) => { setSelectedChat({ jid, name }); },
        onIncoming: messages => {
            setData(current => {
                const chats = [...current.chats];
                for (const message of messages) {
                    const index = chats.findIndex(chat => chat.jid === message.remoteJid || chat.aliases?.includes(message.remoteJid));
                    const lastMessage = { content: message.content, timestamp: message.timestamp, type: message.type };
                    if (index >= 0) {
                        if (new Date(message.timestamp).getTime() >= new Date(chats[index].lastMessage?.timestamp || 0).getTime()) chats[index] = { ...chats[index], lastMessage };
                    } else if (!message.remoteJid.endsWith("@broadcast")) chats.push({ jid: message.remoteJid, name: message.pushName || null, notify: null, profilePic: null, lastMessage });
                }
                chats.sort((a,b) => new Date(b.lastMessage?.timestamp || 0).getTime() - new Date(a.lastMessage?.timestamp || 0).getTime());
                return { ...current, chats };
            });
        },
    });

    const { getSocket, joinSession } = useSocket();
    useEffect(() => {
        const socket = getSocket();
        const update = (messages: ChatMessageUpdate[], source: unknown) => {
            if (!isChatSessionEvent(sessionId, source)) return;
            // Invalidate an older board request so it cannot overwrite the new preview.
            generation.current++;
            setLoading(false);
            setData(current => ({ ...current, chats: updateConversationPreviews(current.chats, messages) }));
        };
        const local = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.sessionId === sessionId) update(detail.messages, { sessionId: detail.sessionId });
        };
        const connect = () => joinSession(sessionId);
        if (socket?.connected) connect();
        socket?.on("connect", connect);
        socket?.on("message.update", update);
        window.addEventListener(CONFIRMED_CHAT_EVENT, local);
        return () => {
            socket?.off("connect", connect); socket?.off("message.update", update);
            window.removeEventListener(CONFIRMED_CHAT_EVENT, local);
        };
    }, [sessionId, getSocket, joinSession]);

    const moveChat = async (jid: string, stage: ChatStageId) => {
        if (pendingRef.current.has(jid)) return;
        const previous = data.stages.find(s => s.chatJid === jid)?.stage || "new";
        if (previous === stage) return;
        generation.current++;
        setLoading(false);
        pendingRef.current.add(jid);
        setPending(new Set(pendingRef.current));
        const setStage = (value: string) => setData(current => ({ ...current, stages: [...current.stages.filter(s => s.chatJid !== jid), { chatJid: jid, stage: value }] }));
        setStage(stage);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`, {
                method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jid, stage }),
            });
            if (!response.ok) throw new Error("save");
            toast.success("Etapa salva");
        } catch {
            setStage(previous);
            toast.error("Não foi possível salvar a etapa. Tente novamente.");
        } finally {
            pendingRef.current.delete(jid);
            setPending(new Set(pendingRef.current));
        }
    };

    // Sync selected chat to URL pathname
    useEffect(() => {
        if (typeof window === "undefined") return;
        const base = "/dashboard/chat";
        if (selectedChat) {
            const number = encodeURIComponent(selectedChat.jid);
            const newPath = `${base}/${number}`;
            if (window.location.pathname !== newPath) {
                window.history.replaceState(null, "", newPath);
            }
        } else {
            if (window.location.pathname !== base) {
                window.history.replaceState(null, "", base);
            }
        }
    }, [selectedChat]);

    // Handle browser back/forward
    useEffect(() => {
        const handlePopState = () => {
            const path = window.location.pathname;
            if (path.startsWith("/dashboard/chat/")) {
                const rawJid = decodeURIComponent(path.replace("/dashboard/chat/", ""));
                setSelectedChat({ jid: rawJid.includes("@") ? rawJid : `${rawJid.replace(/\D/g, "")}@s.whatsapp.net` });
            } else {
                setSelectedChat(null);
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const handleSelectChat = (jid: string, name?: string) => {
        if (jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) { toast.info("Status e canais não fazem parte das conversas de atendimento."); return; }
        alerts.markRead(jid);
        setSelectedChat({ jid, name });
    };

    useEffect(() => {
        const update = (event: Event) => {
            const contact = (event as CustomEvent).detail;
            if (contact?.sessionId !== sessionId || typeof contact.jid!=="string" || typeof contact.name!=="string") return;
            generation.current++;
            setLoading(false);
            setData(current=>({...current,chats:current.chats.map(chat=>chat.jid===contact.jid || chat.aliases?.includes(contact.jid) ? {...chat,name:contact.name} : chat)}));
            setSelectedChat(current=>current && current.jid===contact.jid?{...current,name:contact.name}:current);
            setListVersion(v=>v+1);
        };
        window.addEventListener(CONTACT_UPDATED_EVENT,update);
        return()=>window.removeEventListener(CONTACT_UPDATED_EVENT,update);
    },[sessionId]);

    // Favorites panel: opened from the toolbar or from a chat header (wa:open-starred).
    const [starredOpen, setStarredOpen] = useState(false);
    // Pendências: reminders and "Ver depois" messages, always counted in the toolbar so they are not forgotten.
    const followUps = usePending(sessionId);
    const [pendingOpen, setPendingOpen] = useState(false);
    const pendingCount = followUps.messages.length + followUps.reminders.length;
    useEffect(() => {
        const openPanel = () => setStarredOpen(true);
        window.addEventListener("wa:open-starred", openPanel); return () => window.removeEventListener("wa:open-starred", openPanel);
    }, []);
    // Archived conversations: refresh board and list when one is archived or unarchived
    // (here, from the card menu, or on the phone), and close it if it was open.
    const [archivedOpen, setArchivedOpen] = useState(false);
    const loadBoardRef = useRef<() => void>(() => {});
    useEffect(() => { loadBoardRef.current = loadBoard; }, [loadBoard]);
    useEffect(() => {
        const changed = (event: Event) => {
            const detail = (event as CustomEvent).detail as { jid?: string; archived?: boolean } | undefined;
            if (detail?.archived) setSelectedChat(current => current?.jid === detail.jid ? null : current);
            loadBoardRef.current(); setListVersion(v => v + 1);
        };
        window.addEventListener("wa:archived-changed", changed); return () => window.removeEventListener("wa:archived-changed", changed);
    }, []);
    useEffect(() => {
        const socket = getSocket(); if (!socket) return;
        const handler = (_changes: unknown, source: unknown) => { if (isChatSessionEvent(sessionId, source)) { loadBoardRef.current(); setListVersion(v => v + 1); } };
        socket.on("chats.archived", handler); return () => { socket.off("chats.archived", handler); };
    }, [sessionId, getSocket]);

    const focusDone = useCallback((found: boolean) => {
        if (!found) toast.info("Não foi possível chegar até essa mensagem: ela é antiga demais para o histórico carregado desta conversa.");
        setSelectedChat(current => current ? { ...current, focusKeyId: undefined } : current);
    }, []);

    const handleBack = () => {
        setSelectedChat(null);
        if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/dashboard/chat");
        }
    };

    return (
        // Outer: flex row, full height, overflow hidden — containment chain root
        <div className="flex flex-col h-full bg-background rounded-xl border border-border/40 shadow-sm overflow-hidden min-h-0">
            <div className="relative z-10 shrink-0 border-b bg-background px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg bg-muted p-0.5 gap-1" role="group" aria-label="Visualização das conversas">
                        {([['list','Lista',List],['kanban','Kanban',Columns3]] as const).map(([id,title,Icon])=><button key={id} type="button" aria-pressed={view===id} onClick={()=>{setView(id);setSelectedChat(null);try{localStorage.setItem(`chat-view:${sessionId}`,id)}catch{}}} className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${view===id?'bg-background shadow-sm font-medium':'text-muted-foreground'}`}><Icon className="h-3.5 w-3.5"/>{title}</button>)}
                    </div>
                    {view==='kanban'&&<div ref={setBoardToolbar} className="flex flex-1 flex-wrap items-center gap-2"/>}
                    <div className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={()=>setPendingOpen(true)} title="Lembretes e mensagens para ver depois" aria-label={`Pendências: ${pendingCount}`} className={`relative inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${pendingCount?'bg-amber-500/15 font-semibold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300':'hover:bg-muted'}`}><BellRing className={`h-4 w-4 ${pendingCount?'text-amber-500':''}`}/>Pendências{pendingCount>0&&<span className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{pendingCount>99?'99+':pendingCount}</span>}</button>
                        <button type="button" onClick={()=>setArchivedOpen(true)} title="Conversas arquivadas" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-muted"><Archive className="h-4 w-4"/>Arquivadas</button>
                        <button type="button" onClick={()=>setStarredOpen(true)} title="Mensagens favoritas" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-muted"><Star className="h-4 w-4"/>Favoritas</button>
                        <button type="button" aria-label={alerts.sound?'Desativar som':'Ativar som'} aria-pressed={alerts.sound} onClick={alerts.toggleSound} title={alerts.sound?'Som ligado':'Ativar som'} className="rounded p-2 hover:bg-muted">{alerts.sound?<Volume2 className="h-4 w-4"/>:<VolumeX className="h-4 w-4"/>}</button>
                        <button type="button" aria-label={alerts.desktop?'Desativar notificações':'Notificar no sistema'} aria-pressed={alerts.desktop} onClick={alerts.toggleDesktop} title="Notificações no sistema" className="rounded p-2 hover:bg-muted">{alerts.desktop?<Bell className="h-4 w-4"/>:<BellOff className="h-4 w-4"/>}</button>
                        <button type="button" aria-label="Atualizar conversas e etiquetas" disabled={loading} onClick={()=>{loadBoard();setListVersion(v=>v+1)}} className="rounded p-2 hover:bg-muted disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {view==='kanban'&&<><input aria-label="Buscar no Kanban" placeholder="Buscar conversa…" value={filters.search} onChange={e=>updateFilters({search:e.target.value})} className="h-8 w-44 rounded-md border bg-background px-2 text-xs"/><select aria-label="Tipo de conversa no Kanban" value={filters.kind} onChange={e=>updateFilters({kind:e.target.value as 'all'|'private'|'groups'})} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="all">Todos os tipos</option><option value="private">Só conversas individuais</option><option value="groups">Só grupos</option></select></>}
                    <select aria-label="Filtrar conversas por etiqueta" value={labelId} onChange={e=>setLabelId(e.target.value)} className="h-8 max-w-44 rounded-md border bg-background px-2 text-xs"><option value="">Todas as etiquetas</option>{data.labels.map(label=><option key={label.id} value={label.id}>{label.name}</option>)}</select>
                    <select aria-label="Filtrar conversas por coluna" value={columnId} onChange={e=>setColumnId(e.target.value)} className="h-8 max-w-44 rounded-md border bg-background px-2 text-xs"><option value="">Todas as colunas</option>{(data.columns||[]).map(column=><option key={column.id} value={column.id}>{column.name}</option>)}</select>
                    <button type="button" aria-pressed={filters.pinned} onClick={()=>updateFilters({pinned:!filters.pinned})} title="Guardar os filtros desta conta neste navegador" className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${filters.pinned?'text-primary bg-primary/10':''}`}><Pin className="h-3 w-3"/>{filters.pinned?'Filtros fixados':'Fixar filtros'}</button>
                    {(labelId||columnId||filters.kind!=='all'||filters.search)&&<button type="button" onClick={()=>updateFilters({labelId:'',columnId:'',kind:'all',search:''})} className="text-xs underline">Limpar filtros</button>}
                </div>
            </div>
            {loadError && <div role="alert" className="px-3 py-2 text-sm text-destructive">Não foi possível atualizar o quadro e as etiquetas. Use o botão de atualizar para tentar novamente.</div>}
            {view === "kanban" ? <div className="flex flex-1 min-h-0 min-w-0 relative">
                <ConversationBoard reminders={followUps.reminders} compactFiltersTop toolbarTarget={boardToolbar} kind={filters.kind} search={filters.search} onKindChange={kind => updateFilters({ kind })} onSearchChange={search => updateFilters({ search })} sessionId={sessionId} data={data} labelId={labelId} columnId={columnId} unread={alerts.unread} onAddColumn={column => { generation.current++; setData(current=>({...current,columns:[...(current.columns || []),column]})); }} onColumnsOrder={ids=>{generation.current++;setData(current=>({...current,columns:ids.map(id=>current.columns!.find(c=>c.id===id)!)}));}} onLabelsChange={loadBoard} onCreateLabel={label => setData(current => ({ ...current, labels: [...current.labels.filter(l => l.id !== label.id), label] }))} loading={loading} pending={pending} onMove={moveChat} onSelect={handleSelectChat} onSaveColumn={column => {
                    generation.current++;
                    setLoading(false);
                    setData(current => ({ ...current, columns: (current.columns || []).map(c => c.id === column.id ? column : c) }));
                }} />
                <Dialog open={!!selectedChat} onOpenChange={open => { if (!open) handleBack(); }}>
                    <DialogContent showCloseButton={false} className="flex flex-col gap-0 p-0 overflow-hidden w-[calc(100vw-1rem)] max-w-none sm:max-w-[1600px] h-[calc(100dvh-1rem)] max-h-none rounded-xl" aria-describedby="kanban-chat-description"
                        // The favorites panel and message alerts sit on top of this dialog; using them must not close the chat behind it.
                        onInteractOutside={event => { if ((event.target as HTMLElement | null)?.closest?.("[data-starred-panel],[data-sonner-toaster]")) event.preventDefault(); }}>
                        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b shrink-0 bg-background">
                            <div className="min-w-0">
                                <DialogTitle className="text-sm font-semibold">Atendimento pelo Kanban</DialogTitle>
                                <DialogDescription id="kanban-chat-description" className="text-xs mt-1">Leia e responda aqui. Ao fechar, você volta ao quadro.</DialogDescription>
                            </div>
                            <DialogClose asChild><button type="button" className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"><span aria-hidden="true">←</span> Voltar ao quadro</button></DialogClose>
                        </div>
                        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                            {selectedChat && <ChatWindow key={selectedChat.jid} sessionId={sessionId} jid={selectedChat.jid} name={selectedChat.name} focusKeyId={selectedChat.focusKeyId} onFocusDone={focusDone} />}
                        </div>
                    </DialogContent>
                </Dialog>
            </div> : <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Chat List Panel */}
            <div className={`w-full md:w-80 lg:w-[340px] border-r border-border/30 overflow-hidden shrink-0 flex flex-col
                ${selectedChat ? "hidden md:flex" : "flex"}`}
            >
                {/* Inner flex-col: header fixed + virtuoso fills rest */}
                <ChatList
                    key={`${sessionId}:${listVersion}`}
                    unread={alerts.unread}
                    labelId={labelId || undefined}
                    columnId={columnId || undefined}
                    sessionId={sessionId}
                    onSelectChat={handleSelectChat}
                    selectedJid={selectedChat?.jid}
                />
            </div>

            {/* Chat Window Panel */}
            <div className={`flex-1 overflow-hidden flex flex-col min-w-0
                ${!selectedChat ? "hidden md:flex" : "flex"}`}
            >
                {selectedChat ? (
                    <ChatWindow
                        sessionId={sessionId}
                        jid={selectedChat.jid}
                        name={selectedChat.name}
                        onBack={handleBack}
                        focusKeyId={selectedChat.focusKeyId}
                        onFocusDone={focusDone}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center min-w-0 min-h-0">
                        <div className="text-center p-6">
                            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                                <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {t("selectChat")}
                            </p>
                        </div>
                    </div>
                )}
            </div>
            </div>}
            <ArchivedPanel sessionId={sessionId} open={archivedOpen} onOpenChange={setArchivedOpen} onOpenChat={(jid, name) => { setArchivedOpen(false); setSelectedChat({ jid, name }); }} />
            <PendingPanel sessionId={sessionId} open={pendingOpen} onOpenChange={setPendingOpen} data={followUps}
                onGoMessage={item => { setPendingOpen(false); alerts.markRead(item.remoteJid); setSelectedChat({ jid: item.remoteJid, name: item.chatName, focusKeyId: item.keyId }); }}
                onOpenChat={(jid, name) => { setPendingOpen(false); handleSelectChat(jid, name); }} />
            <StarredPanel sessionId={sessionId} open={starredOpen} onOpenChange={setStarredOpen} onGo={item => {
                setStarredOpen(false);
                alerts.markRead(item.remoteJid);
                setSelectedChat({ jid: item.remoteJid, name: item.chatName, focusKeyId: item.keyId });
            }} />
        </div>
    )
}
