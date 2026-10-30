"use client";

import type { ChatKind } from "@/lib/chat-filters";
import {createPortal} from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConsultoriaNotice } from "./consultoria-notice";
import { ContactTools } from "./contact-tools";
import {phoneFromJid,formatContactPhone} from "@/lib/contact-card";
import { LabelAssignPopover } from "./chat-list";
import { ChatAvatar } from "./chat-avatar";
import { edgeScrollSpeed } from "@/lib/board-autoscroll";
import { DEFAULT_KANBAN_COLUMNS, matchesKanbanColumn, sortKanbanCards, moveKanbanCard, reorderPinned, type KanbanColumnConfig, type ChatStageId } from "@/lib/chat-stages";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, MessageCircle, Settings2, GripVertical, Tag, Plus, Pin, PinOff, Megaphone, BellRing } from "lucide-react";
import { ReminderDialog } from "./follow-ups";
import type { ReminderView } from "@/lib/follow-ups";

export interface BoardChat {
    aliases?: string[];
    jid: string; name: string | null; notify: string | null; profilePic: string | null;
    lastMessage?: { content: string | null; timestamp: string; type: string };
}
export interface BoardData {
    columns?: KanbanColumnConfig[];
    chats: BoardChat[];
    labels: { id: string; name: string; colorHex: string }[];
    assignments: { chatJid: string; labelId: string }[];
    stages: { chatJid: string; stage: string }[];
}

export function ConversationBoard({ reminders = [], sessionId, data, labelId, loading, pending, onMove, onSelect, onSaveColumn, columnId = "", onCreateLabel, onLabelsChange, onAddColumn, onColumnsOrder, unread = {}, kind = "all", search = "", onKindChange, onSearchChange, toolbarTarget, compactFiltersTop = false }: {
    toolbarTarget?: HTMLElement | null;
    compactFiltersTop?: boolean;
    sessionId: string; data: BoardData; labelId: string; loading: boolean; pending: Set<string>;
    onMove: (jid: string, stage: ChatStageId) => void;
    onSelect: (jid: string, name?: string) => void;
    columnId?: string;
    kind?: ChatKind;
    search?: string;
    onKindChange?: (kind: ChatKind) => void;
    onSearchChange?: (search: string) => void;
    unread?: Record<string, number>;
    onAddColumn?: (column: KanbanColumnConfig) => void;
    onColumnsOrder?: (ids: string[]) => void;
    onLabelsChange?: () => void;
    onCreateLabel?: (label: BoardData["labels"][number]) => void;
    onSaveColumn?: (column: KanbanColumnConfig) => void;
    reminders?: ReminderView[];
}) {
    const [orientation,setOrientation] = useState<'horizontal'|'vertical'>('vertical');
    useEffect(()=>{try{setOrientation(localStorage.getItem(`kanban-orientation:${sessionId}`)==='horizontal'?'horizontal':'vertical')}catch{}},[sessionId]);
    const columns = data.columns || DEFAULT_KANBAN_COLUMNS;
    const suppressClickUntil = useRef(0);
    const [noticeOpen,setNoticeOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [columnName, setColumnName] = useState('');
    const [columnDragging, setColumnDragging] = useState<string | null>(null);
    const [columnSaving, setColumnSaving] = useState(false);
    const createColumn = async () => {
        if (!columnName.trim() || columnSaving) return;
        setColumnSaving(true);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'createColumn',name:columnName.trim()})});
            const result = await response.json(); if (!response.ok) throw Error(result.message);
            onAddColumn?.(result.column); setAdding(false); setColumnName('');
        } catch(error) {toast.error(error instanceof Error ? error.message : 'Não foi possível criar a coluna');}
        finally {setColumnSaving(false);}
    };
    const reorderColumns = async (source: string, target: string) => {
        if (columnSaving || source === target) return;
        const order = moveKanbanCard(columns.map(c=>c.id),source,target,'before');
        setColumnSaving(true);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reorderColumns',order})});
            const result = await response.json(); if (!response.ok) throw Error(result.message);
            onColumnsOrder?.(order);
        } catch(error) {toast.error(error instanceof Error ? error.message : 'Não foi possível ordenar as colunas');}
        finally {setColumnSaving(false);}
    };
    const [editing, setEditing] = useState<KanbanColumnConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [pinSaving, setPinSaving] = useState<string | null>(null);
    const pinCard = async (stage: KanbanColumnConfig, jid: string, pinned: boolean) => {
        if (pinSaving) return;
        setPinSaving(`${stage.id}:${jid}`);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pinCard',stage:stage.id,jid,pinned})});
            const result = await response.json();
            if (!response.ok) throw Error(result.message || 'Não foi possível salvar a fixação');
            onSaveColumn?.(result.column);
        } catch(error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a fixação'); }
        finally { setPinSaving(null); }
    };
    const [savingOrder, setSavingOrder] = useState<string | null>(null);
    const [newLabel, setNewLabel] = useState("");
    const [creatingLabel, setCreatingLabel] = useState(false);
    const createLabel = async () => {
        if (!newLabel.trim() || creatingLabel) return;
        setCreatingLabel(true);
        try {
            const response = await fetch(`/api/labels/${encodeURIComponent(sessionId)}`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newLabel.trim(), color: 8 }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error("Não foi possível criar a etiqueta. Verifique se o nome já existe.");
            onCreateLabel?.(result.data.label);
            setEditing(current => current ? { ...current, labelIds: [...current.labelIds, result.data.label.id] } : null);
            setNewLabel("");
            toast.success("Etiqueta criada");
        } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível criar"); }
        finally { setCreatingLabel(false); }
    };
    const saveColumn = async () => {
        if (!editing || !editing.name.trim() || saving) return;
        setSaving(true);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stage: editing.id, name: editing.name.trim(), labelIds: editing.labelIds, color: editing.color }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "Não foi possível salvar");
            onSaveColumn?.(result.column);
            setEditing(null);
            toast.success("Coluna salva");
        } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar"); }
        finally { setSaving(false); }
    };
    const reorder = async (stage: KanbanColumnConfig, columnChats: BoardChat[], jid: string, neighbor: string | null, edge: "before" | "after" = "before") => {
        if (savingOrder || saving) return;
        // Dropping a pinned conversation on another pinned one changes the pin order.
        const pins = stage.pinnedJids || [];
        if (neighbor && pins.includes(jid) && pins.includes(neighbor)) {
            const pinOrder = reorderPinned(pins, jid, neighbor, edge);
            if (pinOrder.every((id, index) => pins[index] === id)) return;
            setSavingOrder(stage.id);
            try {
                const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reorderPins", stage: stage.id, order: pinOrder }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || "Não foi possível salvar a ordem das fixadas");
                onSaveColumn?.(result.column);
            } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar a ordem das fixadas"); }
            finally { setSavingOrder(null); }
            return;
        }
        const original = columnChats.map(chat => chat.jid);
        const order = moveKanbanCard(original, jid, neighbor, edge);
        if (order === original || order.every((id, index) => original[index] === id)) return;
        setSavingOrder(stage.id);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/board`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: stage.id, order }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "Não foi possível salvar a ordem");
            onSaveColumn?.(result.column);
        } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar a ordem"); }
        finally { setSavingOrder(null); }
    };
    const [over, setOver] = useState<string | null>(null);
    const [dragging, setDragging] = useState<{ jid: string; stage: string } | null>(null);
    const [dropTarget, setDropTarget] = useState<{ jid: string; stage: string; edge: "before" | "after" } | null>(null);
    // Dragging a card or column near the board edge scrolls the board, so far columns can be reached.
    // Stops once dragover events stop arriving (drop, cancel or pointer outside the board).
    const boardRef = useRef<HTMLDivElement>(null);
    const edgeScroll = useRef({ x: 0, y: 0, last: 0, frame: 0 });
    const followDrag = (e: React.DragEvent) => {
        const board = boardRef.current, s = edgeScroll.current;
        if (!board || (!dragging && !columnDragging)) return;
        const rect = board.getBoundingClientRect();
        s.x = orientation === 'vertical' ? edgeScrollSpeed(e.clientX, rect.left, rect.right) : 0;
        s.y = orientation === 'vertical' ? 0 : edgeScrollSpeed(e.clientY, rect.top, rect.bottom);
        s.last = performance.now();
        if (s.frame || (!s.x && !s.y)) return;
        const step = () => {
            if ((!s.x && !s.y) || performance.now() - s.last > 200 || !boardRef.current) { s.frame = 0; return; }
            boardRef.current.scrollLeft += s.x; boardRef.current.scrollTop += s.y;
            s.frame = requestAnimationFrame(step);
        };
        s.frame = requestAnimationFrame(step);
    };
    useEffect(() => {
        if (dragging || columnDragging) return;
        const s = edgeScroll.current; cancelAnimationFrame(s.frame); s.frame = 0; s.x = s.y = 0;
    }, [dragging, columnDragging]);
    // Reminders are saved under the conversation's canonical jid; match aliases too.
    const reminderOf = useMemo(() => {
        const byJid = new Map(reminders.map(r => [r.chatJid, r]));
        return (chat: BoardChat) => byJid.get(chat.jid) || chat.aliases?.map(a => byJid.get(a)).find(Boolean);
    }, [reminders]);
    const [reminderFor, setReminderFor] = useState<{ jid: string; name: string; note?: string } | null>(null);
    const labelsByChat = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const a of data.assignments) map.set(a.chatJid, [...(map.get(a.chatJid) || []), a.labelId]);
        return map;
    }, [data.assignments]);
    const filtered = useMemo(() => data.chats.filter(chat => {
        if (labelId && !labelsByChat.get(chat.jid)?.includes(labelId)) return false;
        if (columnId && !matchesKanbanColumn(chat.jid, columnId, columns, data.assignments, data.stages)) return false;
        if (kind === "private" && (chat.jid.endsWith("@g.us") || chat.jid.endsWith("@newsletter"))) return false;
        if (kind === "groups" && !chat.jid.endsWith("@g.us")) return false;
        const q = search.trim().toLocaleLowerCase("pt-BR");
        return !q || `${chat.name || ""} ${chat.notify || ""} ${chat.jid}`.toLocaleLowerCase("pt-BR").includes(q);
    }), [data.chats, labelId, labelsByChat, search, kind, columnId, columns, data.assignments, data.stages]);

    const toolbar = <>
        <div className={`flex flex-wrap gap-2 items-center ${toolbarTarget ? "" : "px-3 py-2 border-b"}`}>
            {!compactFiltersTop && <><div className="relative flex-1 min-w-48 max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input aria-label="Buscar no Kanban" placeholder="Buscar conversa…" value={search} onChange={e => onSearchChange?.(e.target.value)} className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
            </div>
            <select aria-label="Tipo de conversa no Kanban" value={kind} onChange={e => onKindChange?.(e.target.value as ChatKind)} className="h-9 rounded-lg border bg-background px-2 text-sm">
                <option value="all">Todos os tipos</option><option value="private">Só conversas individuais</option><option value="groups">Só grupos</option>
            </select></>}
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Orientação do Kanban">{(["vertical","horizontal"] as const).map(value=><button key={value} type="button" aria-pressed={orientation===value} title={value==='vertical'?'Cards empilhados, colunas lado a lado e rolagem para a direita':'Cards lado a lado, colunas em faixas'} onClick={()=>{setOrientation(value);try{localStorage.setItem(`kanban-orientation:${sessionId}`,value)}catch{}}} className={`rounded px-2 py-1 text-xs ${orientation===value?"bg-muted font-medium":"text-muted-foreground"}`}>{value==='horizontal'?'Horizontal':'Vertical'}</button>)}</div>
            <button type="button" disabled={columnSaving} onClick={()=>setAdding(true)} className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 text-xs"><Plus className="h-4 w-4"/>Adicionar coluna</button>
            <span className="text-xs text-muted-foreground" aria-live="polite">{loading ? "Atualizando…" : `${filtered.length} conversas`}</span>

        </div>
    </>;
    return <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-muted/20">
        {noticeOpen && <ConsultoriaNotice key={sessionId} sessionId={sessionId} onClose={()=>setNoticeOpen(false)} />}
        {toolbarTarget ? createPortal(toolbar,toolbarTarget) : toolbar}
        <div ref={boardRef} onDragOverCapture={followDrag} className={`flex flex-1 min-h-0 gap-3 p-3 ${orientation==='vertical'?'overflow-x-auto overflow-y-hidden':'flex-col overflow-y-auto'}`} aria-label="Quadro de atendimento">
            {columns.filter(c => !columnId || c.id === columnId).map(stage => {
                const automatic = stage.labelIds.length > 0;
                const columnChats = sortKanbanCards(data.chats.filter(c => matchesKanbanColumn(c.jid, stage.id, columns, data.assignments, data.stages)), stage, unread);
                const visibleJids = new Set(filtered.map(c => c.jid));
                const cards = columnChats.filter(c => visibleJids.has(c.jid));
                return <section key={stage.id} aria-label={stage.name}
                    className={`flex flex-col ${orientation==='vertical'?'w-[300px] min-w-[300px] shrink-0 min-h-0':'w-full shrink-0 min-h-[180px]'} rounded-2xl border border-border/50 bg-muted/30 ${over === stage.id ? "ring-2 ring-primary bg-primary/5" : ""}`}
                    onDragOver={e => {
                        if (dragging && !savingOrder && (dragging.stage === stage.id || (!automatic && columns.some(c => c.id === dragging.stage && !c.labelIds.length)))) { e.preventDefault(); setOver(stage.id); }
                    }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                    onDrop={e => {
                        suppressClickUntil.current = Date.now() + 200;
                        e.preventDefault(); setOver(null); setDropTarget(null);
                        if (dragging && e.dataTransfer.getData("text/plain") === dragging.jid) {
                            if (dragging.stage === stage.id) reorder(stage, columnChats, dragging.jid, null);
                            else if (!automatic && columns.some(c => c.id === dragging.stage && !c.labelIds.length)) onMove(dragging.jid, stage.id);
                        }
                        setDragging(null);
                    }}>
                    <header className={`p-3 border-b border-border/50 space-y-2 ${columnDragging ? 'bg-primary/5' : ''}`}
                        onDragOver={e=>{if(columnDragging){e.preventDefault();e.stopPropagation();}}}
                        onDrop={e=>{if(columnDragging){e.preventDefault();e.stopPropagation();reorderColumns(columnDragging,stage.id);setColumnDragging(null);}}}>

                        <div className="flex items-center gap-2">
                            <button type="button" draggable={!columnSaving} aria-label={`Arrastar coluna ${stage.name}`} title="Arraste para reordenar as colunas" onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('text/plain',stage.id);setColumnDragging(stage.id);}} onDragEnd={()=>setColumnDragging(null)} className="cursor-grab text-muted-foreground/50"><GripVertical className="h-4 w-4 rotate-90"/></button>
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
                            <h3 className="font-semibold text-sm truncate" title={stage.name}>{stage.name}</h3>
                            <span className="ml-auto rounded-full bg-muted px-2 text-xs">{cards.length}</span>
                            {sessionId==='zap-rei' && stage.name.trim().toLocaleLowerCase('pt-BR')==='consultoria' && <button type="button" aria-label="Preparar aviso para a Consultoria" title="Avisar a coluna Consultoria" onClick={()=>setNoticeOpen(true)} className="p-1 rounded hover:bg-muted"><Megaphone className="h-4 w-4 text-muted-foreground"/></button>}
                            <button type="button" disabled={saving || !!savingOrder} aria-label={`Configurar coluna ${stage.name}`} onClick={() => { setNewLabel(""); setEditing({ ...stage, labelIds: [...stage.labelIds] }); }} className="p-1 rounded hover:bg-muted"><Settings2 className="h-4 w-4 text-muted-foreground" /></button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {automatic ? stage.labelIds.map(id => {
                                const label = data.labels.find(l => l.id === id);
                                return label && <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: label.colorHex }} />{label.name}</span>;
                            }) : <span className="text-[10px] text-muted-foreground">Organização manual</span>}
                        </div>
                    </header>
                    <div className={orientation==='vertical'?"flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5":"flex items-start gap-2.5 overflow-x-auto p-2.5"} onDragOver={e => {
                        if (!dragging) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (e.clientY < rect.top + 55) e.currentTarget.scrollTop -= 16;
                        if (e.clientY > rect.bottom - 55) e.currentTarget.scrollTop += 16;
                    }}>
                        {!cards.length && <div className="py-10 text-center text-xs text-muted-foreground"><MessageCircle className="mx-auto mb-2 h-5 w-5 opacity-40" />{loading ? "Carregando…" : "Nenhuma conversa nesta etapa"}</div>}
                        {cards.map((chat, cardIndex) => {
                            const name = chat.name || chat.notify || chat.jid.split("@")[0];
                            const busy = pending.has(chat.jid);
                            const pinned = stage.pinnedJids?.includes(chat.jid) || false;
                            const count = unread[chat.jid] || 0;
                            const reminder = reminderOf(chat);
                            const targeted = dropTarget?.jid === chat.jid && dropTarget.stage === stage.id;
                            return <article key={chat.jid} aria-label={`Conversa com ${name}`}
                                draggable={!busy && !savingOrder} tabIndex={0}
                                title={`Arrastar cartão de ${name}. Pelo teclado: Alt + seta para cima ou para baixo.`}
                                onDragStart={e => {
                                    if ((e.target as HTMLElement).closest('[data-no-card-drag]')) { e.preventDefault(); e.stopPropagation(); return; }
                                    e.stopPropagation();
                                    e.dataTransfer.setData("text/plain", chat.jid);
                                    e.dataTransfer.effectAllowed = "move";
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    e.dataTransfer.setDragImage(e.currentTarget, Math.max(0, e.clientX - rect.left), Math.max(0, e.clientY - rect.top));
                                    suppressClickUntil.current = Infinity;
                                    setDragging({ jid: chat.jid, stage: stage.id });
                                }}
                                onDragEnd={() => { suppressClickUntil.current = Date.now() + 200; setDragging(null); setOver(null); setDropTarget(null); }}
                                onClickCapture={e => { if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }}
                                onKeyDown={e => {
                                    if ((e.target as HTMLElement).closest('[data-no-card-drag]') || !e.altKey || !['ArrowUp','ArrowDown'].includes(e.key) || busy || savingOrder) return;
                                    e.preventDefault();
                                    const target = cards[cardIndex + (e.key === 'ArrowUp' ? -1 : 1)];
                                    if (target) reorder(stage, columnChats, chat.jid, target.jid, e.key === 'ArrowUp' ? 'before' : 'after');
                                }}
                                onDragOver={e => {
                                    if (!dragging || savingOrder || dragging.stage !== stage.id || dragging.jid === chat.jid) return;
                                    e.preventDefault();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setDropTarget({ jid: chat.jid, stage: stage.id, edge: (orientation==='vertical' ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2) ? "before" : "after" });
                                }}
                                onDrop={e => {
                                    suppressClickUntil.current = Date.now() + 200;
                                    if (!dragging || dragging.stage !== stage.id) return;
                                    e.preventDefault(); e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    if (e.dataTransfer.getData("text/plain") === dragging.jid) reorder(stage, columnChats, dragging.jid, chat.jid, (orientation==='vertical' ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2) ? "before" : "after");
                                    setDragging(null); setOver(null); setDropTarget(null);
                                }}
                                className={`group relative ${orientation==='horizontal'?'w-[300px] min-w-[300px] shrink-0':''} cursor-grab active:cursor-grabbing select-none rounded-xl border bg-background p-3 shadow-sm transition-[box-shadow,border-color,opacity] hover:shadow-md ${targeted ? dropTarget.edge === "before" ? (orientation==='vertical'?"border-t-primary border-t-[3px]":"border-l-primary border-l-[3px]") : (orientation==='vertical'?"border-b-primary border-b-[3px]":"border-r-primary border-r-[3px]") : "border-border/50"} ${count ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30" : ""} ${busy || (dragging?.jid === chat.jid && dragging.stage === stage.id) ? "opacity-50" : ""}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{pinned ? <><Pin className="h-3 w-3 text-primary" />Fixada</> : <GripVertical aria-hidden="true" className="h-4 w-4 opacity-40" />}</span>
                                    <div data-no-card-drag className="flex items-center gap-1">
                                        {!chat.jid.endsWith("@g.us") && <ContactTools compact sessionId={sessionId} jid={chat.jid} name={name} />}
                                        <button type="button" aria-label={`${reminder ? 'Editar lembrete' : 'Criar lembrete'} de ${name}`} title={reminder ? 'Editar lembrete' : 'Criar lembrete para esta conversa'} onClick={() => setReminderFor({ jid: chat.jid, name, note: reminder?.note })} className={`rounded p-1 hover:bg-muted ${reminder ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-foreground'}`}><BellRing className="h-3.5 w-3.5" /></button>
                                        <button type="button" aria-label={`${pinned ? 'Desafixar' : 'Fixar'} conversa de ${name} nesta coluna`} aria-pressed={pinned} disabled={!!pinSaving || busy} title={pinned ? 'Desafixar desta coluna' : 'Fixar no topo desta coluna'} onClick={() => pinCard(stage,chat.jid,!pinned)} className={`rounded p-1 hover:bg-muted disabled:opacity-40 ${pinned ? 'text-primary' : 'text-muted-foreground/60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'}`}>{pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
                                    <LabelAssignPopover sessionId={sessionId} jid={chat.jid} onChange={onLabelsChange}>
                                        <button type="button" aria-label={`Etiquetas de ${name}`} title="Etiquetas" className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><Tag className="h-3.5 w-3.5" /></button>
                                    </LabelAssignPopover>
                                    </div>
                                </div>
                                <button type="button" onClick={() => onSelect(chat.jid, name)} className="flex gap-2.5 items-start w-full cursor-grab active:cursor-grabbing text-left rounded focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Abrir conversa com ${name}`}>
                                    <ChatAvatar sessionId={sessionId} jid={chat.jid} name={name} profilePic={chat.profilePic} />
                                    <div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{name}</span>{count > 0 && <span aria-label={`${count} mensagens não lidas`} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] text-white"><span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />{count > 99 ? "99+" : count}</span>}</p>
                                        {phoneFromJid(chat.jid) && <p className="mt-0.5 text-[10px] text-muted-foreground">{formatContactPhone(phoneFromJid(chat.jid)!)}</p>}
                                        <p className="line-clamp-2 text-xs text-muted-foreground mt-1 break-words">{chat.lastMessage?.content || (chat.lastMessage?.type ? { IMAGE: "Imagem", AUDIO: "Áudio", VIDEO: "Vídeo", DOCUMENT: "Documento", STICKER: "Figurinha" }[chat.lastMessage.type] || "Mensagem" : "Sem mensagens")}</p>
                                        {chat.lastMessage?.timestamp && <time className="text-[10px] text-muted-foreground" dateTime={chat.lastMessage.timestamp}>{new Date(chat.lastMessage.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</time>}
                                    </div>
                                </button>
                                {reminder && <button type="button" data-no-card-drag data-tf-reminder onClick={() => setReminderFor({ jid: chat.jid, name, note: reminder.note })} title="Lembrete: clique para editar ou concluir" className="mt-2 flex w-full items-start gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-left text-xs text-amber-900 hover:bg-amber-500/20 dark:text-amber-100"><BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="line-clamp-3 whitespace-pre-wrap break-words">{reminder.note}</span></button>}
                                {!!labelsByChat.get(chat.jid)?.length && <div className="flex flex-wrap gap-1 mt-2">{labelsByChat.get(chat.jid)!.map(id => {
                                    const label = data.labels.find(l => l.id === id);
                                    return label && <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full" style={{ background: label.colorHex }} />{label.name}</span>;
                                })}</div>}
                                {!automatic && <select data-no-card-drag aria-label={`Etapa de ${name}`} value={stage.id} disabled={busy} onChange={e => onMove(chat.jid, e.target.value as ChatStageId)} className="mt-2 h-6 max-w-full rounded border-0 bg-transparent px-0 text-[10px] text-muted-foreground opacity-60 hover:opacity-100 focus:opacity-100">
                                    {columns.filter(s => !s.labelIds.length).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>}
                            </article>;
                        })}
                    </div>
                </section>;
            })}
        </div>
        {reminderFor && <ReminderDialog sessionId={sessionId} jid={reminderFor.jid} name={reminderFor.name} current={reminderFor.note} open onOpenChange={open => { if (!open) setReminderFor(null); }} />}
        <Dialog open={adding} onOpenChange={value=>{if(!columnSaving)setAdding(value)}}><DialogContent className="sm:max-w-md"><DialogTitle>Adicionar coluna</DialogTitle><DialogDescription>Crie uma etapa para separar suas conversas. Depois, ajuste as etiquetas na engrenagem.</DialogDescription><form onSubmit={e=>{e.preventDefault();createColumn();}} className="space-y-3"><label className="block text-sm">Nome da coluna<input autoFocus maxLength={60} required disabled={columnSaving} value={columnName} onChange={e=>setColumnName(e.target.value)} className="mt-1 w-full rounded-lg border bg-background p-2"/></label><button type="submit" disabled={columnSaving||!columnName.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{columnSaving?'Criando…':'Criar coluna'}</button></form></DialogContent></Dialog>
        <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving && !creatingLabel) setEditing(null); }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle>Configurar coluna</DialogTitle>
                <DialogDescription>Escolha o nome, a cor e as etiquetas que definem quais conversas aparecem aqui.</DialogDescription>
                {editing && <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveColumn(); }}>
                    <label className="block text-sm font-medium">Nome da coluna
                        <input autoFocus required maxLength={60} disabled={saving} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 bg-background" />
                    </label>
                    <fieldset disabled={saving} className="space-y-2">
                        <legend className="text-sm font-medium">Cor da coluna</legend>
                        <div className="flex flex-wrap items-center gap-2">
                            {["#64748b", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#06b6d4"].map(color => <button key={color} type="button" aria-label={`Usar cor ${color}`} aria-pressed={editing.color.toLowerCase() === color} onClick={() => setEditing({ ...editing, color })} className={`h-7 w-7 rounded-full border-2 border-background ${editing.color.toLowerCase() === color ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`} style={{ backgroundColor: color }} />)}
                            <label className="flex items-center gap-2 text-xs">Personalizada<input aria-label="Cor personalizada da coluna" type="color" value={editing.color} onChange={e => setEditing({ ...editing, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border bg-background p-0.5" /></label>
                        </div>
                    </fieldset>
                    <fieldset disabled={saving} className="space-y-2">
                        <legend className="text-sm font-medium mb-2">Etiquetas da coluna</legend>
                        <div className="flex gap-2 mb-2">
                            <input aria-label="Nome da nova etiqueta" maxLength={60} value={newLabel} disabled={creatingLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); createLabel(); } }} placeholder="Nova etiqueta…" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" />
                            <button type="button" disabled={creatingLabel || !newLabel.trim()} onClick={createLabel} className="rounded-lg border px-3 text-sm disabled:opacity-50">{creatingLabel ? "Criando…" : "Criar etiqueta"}</button>
                        </div>
                        <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border p-2">
                            {data.labels.length ? data.labels.map(label => <label key={label.id} className="flex items-center gap-2 rounded p-2 text-sm hover:bg-muted cursor-pointer">
                                <input type="checkbox" checked={editing.labelIds.includes(label.id)} onChange={e => setEditing({ ...editing, labelIds: e.target.checked ? [...editing.labelIds, label.id] : editing.labelIds.filter(id => id !== label.id) })} />
                                <span className="h-2 w-2 rounded-full" style={{ background: label.colorHex }} />{label.name}
                            </label>) : <p className="p-2 text-sm text-muted-foreground">Nenhuma etiqueta disponível. Crie etiquetas na seção Etiquetas e atualize o quadro.</p>}
                        </div>
                        <p className="text-xs text-muted-foreground">Com etiquetas, aparecem as conversas com qualquer uma das selecionadas. Sem etiquetas, a organização é manual. Uma conversa pode aparecer em mais de uma coluna.</p>
                    </fieldset>
                    <div className="flex justify-end gap-2">
                        <button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
                        <button type="submit" disabled={saving || creatingLabel || !editing.name.trim()} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">{saving ? "Salvando…" : "Salvar coluna"}</button>
                    </div>
                </form>}
            </DialogContent>
        </Dialog>
    </div>;
}
