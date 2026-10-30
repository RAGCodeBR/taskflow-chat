"use client";
import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCheck, Clock, MessageCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PENDING_CHANGED_EVENT, REMINDER_MAX, type FollowUpView, type ReminderView } from "@/lib/follow-ups";
import { MEDIA_LABELS } from "./pinned-bar";

export interface PendingData { messages: FollowUpView[]; reminders: ReminderView[] }
const TZ = "America/Sao_Paulo";
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const pendingChanged = () => window.dispatchEvent(new CustomEvent(PENDING_CHANGED_EVENT));

// "Ver depois" messages and reminders of this account; reloads whenever any panel changes them.
export function usePending(sessionId: string): PendingData & { loaded: boolean } {
    const [data, setData] = useState<PendingData & { loaded: boolean }>({ messages: [], reminders: [], loaded: false });
    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/pending`, { signal });
            if (!response.ok) return;
            const result = await response.json();
            setData({ messages: result.messages || [], reminders: result.reminders || [], loaded: true });
        } catch { /* Keep the last list; the next change or minute retries. */ }
    }, [sessionId]);
    useEffect(() => {
        const controller = new AbortController();
        const first = setTimeout(() => void load(controller.signal), 0);
        const reload = () => void load();
        const timer = setInterval(reload, 60_000);
        window.addEventListener(PENDING_CHANGED_EVENT, reload);
        return () => { controller.abort(); clearTimeout(first); clearInterval(timer); window.removeEventListener(PENDING_CHANGED_EVENT, reload); };
    }, [load]);
    return data;
}

export async function setMessageLater(sessionId: string, jid: string, keyId: string, later: boolean) {
    try {
        const response = await fetch(`/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/${encodeURIComponent(keyId)}/later`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ later }) });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message);
        toast.success(later ? "Guardada em Pendências para ver depois" : "Marcada como vista");
    } catch (error) { toast.error(error instanceof Error && error.message ? error.message : "Não foi possível atualizar"); }
    finally { pendingChanged(); }
}

export async function finishReminder(sessionId: string, jid: string) {
    try {
        const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/reminder`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        toast.success("Lembrete concluído");
    } catch { toast.error("Não foi possível concluir o lembrete"); }
    finally { pendingChanged(); }
}

// Write, edit or finish the reminder of one conversation.
export function ReminderDialog({ sessionId, jid, name, current, open, onOpenChange }: { sessionId: string; jid: string; name: string; current?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [note, setNote] = useState(current || "");
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) setNote(current || ""); }, [open, current]);
    const save = async () => {
        setBusy(true);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/reminder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message);
            toast.success("Lembrete salvo");
            pendingChanged(); onOpenChange(false);
        } catch (error) { toast.error(error instanceof Error && error.message ? error.message : "Não foi possível salvar o lembrete"); }
        finally { setBusy(false); }
    };
    return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
        <DialogContent className="sm:max-w-md" data-no-card-drag onClick={e => e.stopPropagation()}>
            <DialogTitle className="flex items-center gap-2"><BellRing className="h-4 w-4 text-amber-500" />Lembrete: {name}</DialogTitle>
            <DialogDescription>Uma anotação só sua. Aparece no cartão do Kanban e em Pendências até você concluir.</DialogDescription>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
                <textarea autoFocus required maxLength={REMINDER_MAX} rows={3} value={note} disabled={busy} onChange={e => setNote(e.target.value)} aria-label="Texto do lembrete" placeholder="Ex.: chamar para falar sobre o pagamento do contrato" className="w-full resize-none rounded-lg border bg-background p-3 text-sm" />
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{note.length}/{REMINDER_MAX}</span>
                    {current && <button type="button" disabled={busy} onClick={async () => { setBusy(true); await finishReminder(sessionId, jid); setBusy(false); onOpenChange(false); }} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs hover:bg-muted"><CheckCheck className="h-3.5 w-3.5" />Concluir</button>}
                    <button type="submit" disabled={busy || !note.trim()} className={`${current ? "" : "ml-auto "}rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40`}>{busy ? "Salvando…" : "Salvar lembrete"}</button>
                </div>
            </form>
        </DialogContent>
    </Dialog>;
}

// Everything the owner left to come back to: reminders first, then "Ver depois" messages.
export function PendingPanel({ sessionId, open, onOpenChange, data, onGoMessage, onOpenChat }: { sessionId: string; open: boolean; onOpenChange: (open: boolean) => void; data: PendingData; onGoMessage: (item: FollowUpView) => void; onOpenChat: (jid: string, name: string) => void }) {
    const [editing, setEditing] = useState<ReminderView | null>(null);
    const empty = !data.messages.length && !data.reminders.length;
    return <>
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" data-starred-panel className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
                <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-amber-500" />Pendências</SheetTitle>
                    <SheetDescription className="text-xs">Lembretes de conversas e mensagens que você marcou para ver depois. Só você vê.</SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-3 py-2">
                    {empty && <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
                        <CheckCheck className="h-6 w-6 opacity-40" />
                        Nada pendente. Clique com o botão direito numa mensagem e escolha Ver depois, ou use o sininho de uma conversa para criar um lembrete.
                    </div>}
                    {!!data.reminders.length && <section className="mb-4">
                        <h4 className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lembretes ({data.reminders.length})</h4>
                        <ul className="space-y-1.5">{data.reminders.map(reminder => <li key={reminder.chatJid} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                            <div className="flex items-center gap-2 text-xs"><BellRing className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="min-w-0 flex-1 truncate font-semibold">{reminder.chatName}</span><time className="shrink-0 text-muted-foreground" dateTime={reminder.updatedAt}>{when(reminder.updatedAt)}</time></div>
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{reminder.note}</p>
                            <div className="mt-2 flex items-center gap-1">
                                <button type="button" onClick={() => onOpenChat(reminder.chatJid, reminder.chatName)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"><MessageCircle className="h-3.5 w-3.5" />Abrir conversa</button>
                                <button type="button" onClick={() => setEditing(reminder)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"><Pencil className="h-3.5 w-3.5" />Editar</button>
                                <button type="button" onClick={() => finishReminder(sessionId, reminder.chatJid)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><CheckCheck className="h-3.5 w-3.5" />Concluir</button>
                            </div>
                        </li>)}</ul>
                    </section>}
                    {!!data.messages.length && <section className="mb-3">
                        <h4 className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ver depois ({data.messages.length})</h4>
                        <ul className="space-y-1.5">{data.messages.map(item => <li key={item.keyId} className="rounded-xl border bg-card p-3">
                            <div className="flex items-center gap-2 text-xs"><Clock className="h-3.5 w-3.5 shrink-0 text-sky-500" /><span className="min-w-0 flex-1 truncate font-semibold">{item.chatName}</span><time className="shrink-0 text-muted-foreground" dateTime={item.timestamp}>{when(item.timestamp)}</time></div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.senderName}</p>
                            <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">{item.content || MEDIA_LABELS[item.type] || "Mensagem"}</p>
                            <div className="mt-2 flex items-center gap-1">
                                <button type="button" onClick={() => onGoMessage(item)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"><MessageCircle className="h-3.5 w-3.5" />Ir para a mensagem</button>
                                <button type="button" onClick={() => setMessageLater(sessionId, item.remoteJid, item.keyId, false)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><CheckCheck className="h-3.5 w-3.5" />Já vi</button>
                            </div>
                        </li>)}</ul>
                    </section>}
                </div>
            </SheetContent>
        </Sheet>
        {editing && <ReminderDialog sessionId={sessionId} jid={editing.chatJid} name={editing.chatName} current={editing.note} open onOpenChange={value => { if (!value) setEditing(null); }} />}
    </>;
}
