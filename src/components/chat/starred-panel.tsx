"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Star, StarOff, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { StarView } from "@/lib/message-marks-server";
import { MEDIA_LABELS } from "./pinned-bar";

const TZ = "America/Sao_Paulo";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ });
function dayLabel(iso: string) {
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
    const key = dayKey(iso);
    return key === today ? "Hoje" : key === yesterday ? "Ontem" : key;
}

// Saved (starred) messages of this WhatsApp account, searchable, grouped by the day they were sent.
export function StarredPanel({ sessionId, open, onOpenChange, onGo }: { sessionId: string; open: boolean; onOpenChange: (open: boolean) => void; onGo: (item: StarView) => void }) {
    const [query, setQuery] = useState("");
    const [items, setItems] = useState<StarView[]>([]);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async (q: string, signal?: AbortSignal) => {
        setLoading(true); setFailed(false);
        try {
            const response = await fetch(`/api/messages/${encodeURIComponent(sessionId)}/starred?q=${encodeURIComponent(q)}`, { signal });
            if (!response.ok) throw new Error();
            setItems((await response.json()).items || []);
        } catch (error) { if ((error as Error)?.name !== "AbortError") setFailed(true); }
        finally { setLoading(false); }
    }, [sessionId]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        const timer = setTimeout(() => load(query, controller.signal), 250);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [open, query, load]);
    useEffect(() => {
        if (!open) return;
        const reload = () => load(query);
        window.addEventListener("wa:stars-changed", reload); return () => window.removeEventListener("wa:stars-changed", reload);
    }, [open, query, load]);

    const groups = useMemo(() => {
        const result: { label: string; items: StarView[] }[] = [];
        for (const item of [...items].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
            const label = dayLabel(item.timestamp);
            if (result.at(-1)?.label === label) result.at(-1)!.items.push(item); else result.push({ label, items: [item] });
        }
        return result;
    }, [items]);

    const unstar = async (item: StarView) => {
        setItems(current => current.filter(i => i.keyId !== item.keyId));
        try {
            const response = await fetch(`/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(item.remoteJid)}/${encodeURIComponent(item.keyId)}/star`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ star: false }) });
            if (!response.ok) throw new Error();
            window.dispatchEvent(new CustomEvent("wa:stars-changed"));
        } catch { toast.error("Não foi possível remover a favorita"); load(query); }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" data-starred-panel className="tf-starred-panel flex w-full flex-col gap-0 p-0 sm:max-w-md">
                <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle className="flex items-center gap-2 text-base"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />Mensagens favoritas</SheetTitle>
                    <SheetDescription className="text-xs">Mensagens que você salvou nesta conta do WhatsApp.</SheetDescription>
                    <label className="relative mt-2 block">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por texto, conversa ou pessoa…" aria-label="Buscar nas favoritas" className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm" />
                    </label>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-3 py-2" aria-busy={loading}>
                    {failed && <p role="alert" className="p-4 text-sm text-destructive">Não foi possível carregar as favoritas. Feche e abra de novo.</p>}
                    {!failed && !loading && !items.length && <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
                        <Star className="h-6 w-6 opacity-40" />
                        {query ? "Nenhuma favorita encontrada para essa busca." : "Nenhuma mensagem favoritada ainda. Clique com o botão direito numa mensagem e escolha Favoritar."}
                    </div>}
                    {groups.map(group => <section key={group.label} className="mb-3">
                        <h4 className="sticky top-0 z-10 bg-background/95 px-1 py-1.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">{group.label}</h4>
                        <ul className="space-y-1.5">
                            {group.items.map(item => <li key={item.keyId} className="tf-starred-item group rounded-xl border bg-card p-3">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="min-w-0 flex-1 truncate font-semibold">{item.chatName}</span>
                                    <time className="shrink-0 tabular-nums text-muted-foreground" dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })}</time>
                                </div>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.senderName}</p>
                                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">{item.content || MEDIA_LABELS[item.type] || "Mensagem"}</p>
                                <div className="mt-2 flex items-center gap-1">
                                    <button type="button" onClick={() => onGo(item)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"><MessageCircle className="h-3.5 w-3.5" />Ir para a conversa</button>
                                    <button type="button" onClick={() => unstar(item)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><StarOff className="h-3.5 w-3.5" />Remover</button>
                                </div>
                            </li>)}
                        </ul>
                    </section>)}
                </div>
            </SheetContent>
        </Sheet>
    );
}
