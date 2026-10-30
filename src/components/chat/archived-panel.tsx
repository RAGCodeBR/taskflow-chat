"use client";
import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatAvatar } from "./chat-avatar";
import { MEDIA_LABELS } from "./pinned-bar";

type ArchivedItem = { jid: string; name: string; profilePic: string | null; lastMessage?: { content: string | null; timestamp: string; type: string }; archivedAt?: string };

export async function setChatArchived(sessionId: string, jid: string, archive: boolean) {
    const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/archive`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive }) });
    if (!response.ok) throw new Error();
    window.dispatchEvent(new CustomEvent("wa:archived-changed", { detail: { jid, archived: archive } }));
}

// Archived conversations: hidden from the board and the list; open or unarchive them here.
export function ArchivedPanel({ sessionId, open, onOpenChange, onOpenChat }: { sessionId: string; open: boolean; onOpenChange: (open: boolean) => void; onOpenChat: (jid: string, name: string) => void }) {
    const [items, setItems] = useState<ArchivedItem[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const load = useCallback(async () => {
        setLoading(true); setFailed(false);
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/archived`);
            if (!response.ok) throw new Error();
            setItems((await response.json()).items || []);
        } catch { setFailed(true); }
        finally { setLoading(false); }
    }, [sessionId]);
    useEffect(() => { if (open) load(); }, [open, load]);
    useEffect(() => {
        if (!open) return;
        window.addEventListener("wa:archived-changed", load); return () => window.removeEventListener("wa:archived-changed", load);
    }, [open, load]);

    const unarchive = async (item: ArchivedItem) => {
        setItems(current => current.filter(i => i.jid !== item.jid));
        try { await setChatArchived(sessionId, item.jid, false); toast.success(`${item.name} voltou para as conversas`); }
        catch { toast.error("Não foi possível desarquivar"); load(); }
    };
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const visible = q ? items.filter(item => `${item.name} ${item.lastMessage?.content || ""}`.toLocaleLowerCase("pt-BR").includes(q)) : items;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" data-starred-panel className="tf-archived-panel tf-starred-panel flex w-full flex-col gap-0 p-0 sm:max-w-md">
                <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle className="flex items-center gap-2 text-base"><Archive className="h-4 w-4" />Conversas arquivadas</SheetTitle>
                    <SheetDescription className="text-xs">Ficam fora do Kanban e da lista até você desarquivar.</SheetDescription>
                    {items.length > 5 && <label className="relative mt-2 block">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar conversa arquivada…" aria-label="Buscar nas arquivadas" className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>}
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-3 py-2" aria-busy={loading}>
                    {failed && <p role="alert" className="p-4 text-sm text-destructive">Não foi possível carregar as arquivadas. Feche e abra de novo.</p>}
                    {!failed && !loading && !visible.length && <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
                        <Archive className="h-6 w-6 opacity-40" />
                        {q ? "Nenhuma conversa arquivada com esse nome." : "Nenhuma conversa arquivada. Clique com o botão direito num card do Kanban ou use o botão Arquivar no topo da conversa."}
                    </div>}
                    <ul className="space-y-1.5">
                        {visible.map(item => <li key={item.jid} className="tf-starred-item flex items-center gap-3 rounded-xl border bg-card p-3">
                            <ChatAvatar sessionId={sessionId} jid={item.jid} name={item.name} profilePic={item.profilePic} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{item.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{item.lastMessage?.content || (item.lastMessage ? MEDIA_LABELS[item.lastMessage.type] || "Mensagem" : "Sem mensagens")}</p>
                                {item.archivedAt && <p className="mt-0.5 text-[10px] text-muted-foreground">Arquivada em {new Date(item.archivedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                                <button type="button" onClick={() => unarchive(item)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"><ArchiveRestore className="h-3.5 w-3.5" />Desarquivar</button>
                                <button type="button" onClick={() => onOpenChat(item.jid, item.name)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><MessageCircle className="h-3.5 w-3.5" />Abrir</button>
                            </div>
                        </li>)}
                    </ul>
                </div>
            </SheetContent>
        </Sheet>
    );
}
