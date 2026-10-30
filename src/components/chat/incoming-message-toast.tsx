"use client";
import { ChatAvatar } from "./chat-avatar";
import { X } from "lucide-react";
// A new message from the same conversation updates this temporary alert.
export function IncomingMessageToast({ sessionId, jid, name, profilePic, count, preview, onOpen, onClose }: {
    sessionId: string; jid: string; name: string; profilePic: string | null; count: number; preview: string; onOpen: () => void; onClose: () => void;
}) {
    return <div role="status" className="relative flex w-[min(440px,calc(100vw-2rem))] items-center gap-3 overflow-hidden rounded-xl border border-border bg-background p-3 pl-4 text-foreground shadow-lg">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-emerald-500/70" />
        <div className="relative h-10 w-10 shrink-0">
            <div className="h-10 w-10 overflow-hidden rounded-full"><ChatAvatar sessionId={sessionId} jid={jid} name={name} profilePic={profilePic} /></div>
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white ring-2 ring-background">
                <span className="relative">{count > 99 ? "99+" : count}</span>
            </span>
        </div>
        <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{count > 1 ? `${count} novas mensagens` : "Nova mensagem"}</p>
            <p className="truncate text-sm font-semibold" title={name}>{name}</p>
            <p className="truncate text-xs text-muted-foreground" title={preview}>{preview}</p>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Abrir</button>
        <button type="button" aria-label="Fechar notificação" onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
    </div>;
}
