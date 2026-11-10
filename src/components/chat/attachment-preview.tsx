"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileText, Send, Loader2, X, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { mentionPayload, type MentionPerson } from "@/lib/mentions";

export function AttachmentPreview({ files, people = [], onCancel, onSend }: {
    files: File[];
    people?: MentionPerson[];
    onCancel: () => void;
    onSend: (file: File, caption: string, mentions: string[], onProgress: (percent: number) => void) => Promise<boolean>;
}) {
    const [ordered, setOrdered] = useState(files);
    const [index, setIndex] = useState(0);
    const [sentCount, setSentCount] = useState(0);
    const [url, setUrl] = useState<string | null>(null);
    const [caption, setCaption] = useState("");
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [chosenMentions, setChosenMentions] = useState<{ token: string; jid: string }[]>([]);
    const [cursor, setCursor] = useState(0);
    const file = ordered[index];
    const mention = caption.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
    const suggestions = mention ? people.filter(person => person.current !== false && person.name.toLocaleLowerCase("pt-BR").includes(mention[1].toLocaleLowerCase("pt-BR"))).slice(0, 6) : [];
    const chooseMention = (person: MentionPerson) => {
        const start = caption.lastIndexOf("@", cursor - 1);
        if (start < 0) return;
        const token = `@${person.name}`;
        setCaption(caption.slice(0, start) + token + " " + caption.slice(cursor));
        setChosenMentions(current => [...current.filter(item => item.token !== token), { token, jid: person.jid }]);
        setCursor(start + token.length + 1);
    };
    const move = (from: number, direction: number) => {
        const to = from + direction;
        if (to < sentCount || to >= ordered.length) return;
        setOrdered(current => { const next = [...current]; [next[from], next[to]] = [next[to], next[from]]; return next; });
        setIndex(current => current === from ? to : current === to ? from : current);
    };
    const remove = (position: number) => {
        if (position < sentCount) return;
        if (ordered.length - sentCount === 1) { onCancel(); return; }
        setOrdered(current => current.filter((_, index) => index !== position));
        setIndex(current => Math.min(current > position ? current - 1 : current, ordered.length - 2));
    };
    useEffect(() => {
        const source = URL.createObjectURL(file);
        setUrl(source);
        setFailed(false);
        return () => URL.revokeObjectURL(source);
    }, [file]);
    useEffect(() => {
        if (!sending) return;
        const started = Date.now();
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [sending, index]);
    const sendRemaining = async () => {
        setSending(true);
        try {
            for (let current = sentCount; current < ordered.length; current++) {
                setIndex(current);
                setProgress(null);
                setElapsed(0);
                // A caption belongs to the first pending file, avoiding duplicates.
                const payload = current === 0 ? mentionPayload(caption, chosenMentions) : { text: "", mentions: [] };
                if (!await onSend(ordered[current], payload.text, payload.mentions, setProgress)) return;
                setSentCount(current + 1);
                if (current === 0) setCaption("");
                if (current + 1 < ordered.length) setIndex(current + 1);
            }
            onCancel();
        } finally { setSending(false); }
    };
    return <Dialog open onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()} className="flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-3xl">
            <div className="flex items-start justify-between gap-3"><DialogTitle>Revisar {ordered.length > 1 ? `${ordered.length} anexos` : "anexo"}</DialogTitle><button type="button" disabled={sending} onClick={onCancel} aria-label="Fechar anexos" className="rounded-full p-1 hover:bg-muted disabled:opacity-50"><X className="h-5 w-5" /></button></div>
            <DialogDescription className="break-words">{file?.name} · {(file?.size / (1024 * 1024)).toFixed(2)} MB · {index + 1} de {ordered.length}. Envio na ordem exibida abaixo.</DialogDescription>
            {ordered.length > 1 && <ol className="max-h-36 space-y-1 overflow-y-auto text-xs" aria-label="Ordem dos arquivos">{ordered.map((item, position) => <li key={`${item.name}-${item.lastModified}-${position}`} className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${position === index ? "border-primary" : ""}`}><button type="button" disabled={sending} onClick={() => setIndex(position)} className="min-w-0 flex-1 truncate text-left">{position < sentCount ? '✓ ' : `${position + 1}. `}{item.name}</button><button type="button" disabled={sending || position <= sentCount} onClick={() => move(position, -1)} aria-label={`Mover ${item.name} para cima`}><ArrowUp className="h-4 w-4" /></button><button type="button" disabled={sending || position === ordered.length - 1 || position < sentCount} onClick={() => move(position, 1)} aria-label={`Mover ${item.name} para baixo`}><ArrowDown className="h-4 w-4" /></button><button type="button" disabled={sending || position < sentCount} onClick={() => remove(position)} aria-label={`Remover ${item.name}`}><Trash2 className="h-4 w-4" /></button></li>)}</ol>}
            <div className="flex min-h-32 min-w-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-muted/40 p-3">
                {url && !failed && file.type.startsWith('image/') ? <img src={url} alt="Prévia do arquivo selecionado" onError={() => setFailed(true)} className="max-h-[55dvh] max-w-full object-contain" />
                    : url && file.type.startsWith('video/') ? <video src={url} controls className="max-h-[55dvh] max-w-full" />
                    : url && file.type.startsWith('audio/') ? <audio src={url} controls className="max-w-full" />
                    : <div className="p-8 text-center text-muted-foreground"><FileText className="mx-auto mb-2 h-10 w-10" /><p className="text-sm">{failed ? 'Este formato não permite prévia. Você ainda pode enviar o arquivo.' : 'Documento selecionado para envio'}</p></div>}
            </div>
            {!file.type.startsWith('audio/') && <div className="relative"><label className="text-sm">Legenda do primeiro arquivo (opcional)<textarea disabled={sending} value={caption} onChange={e => { setCaption(e.target.value); setCursor(e.target.selectionStart); }} onClick={e => setCursor(e.currentTarget.selectionStart)} rows={2} maxLength={4000} className="mt-1 w-full resize-none rounded-lg border bg-background p-2" placeholder={people.length ? "Escreva uma legenda e use @ para mencionar…" : "Adicione uma mensagem ao anexo…"} /></label>{!!suggestions.length && <div role="listbox" aria-label="Participantes para mencionar" className="absolute bottom-full z-20 mb-1 max-h-40 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">{suggestions.map(person => <button type="button" key={person.jid} onClick={() => chooseMention(person)} className="block w-full rounded px-2 py-1 text-left hover:bg-muted">@{person.name}</button>)}</div>}</div>}
            {sending && <div role="status" className="space-y-1 text-xs text-muted-foreground">
                <p>{progress === null ? "Preparando arquivo…" : progress < 100 ? `Enviando arquivo: ${progress}%` : "Arquivo recebido pelo servidor. Aguardando o WhatsApp processar…"}</p>
                {progress !== null && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div>}
                {elapsed >= 60 && <p>Isso está demorando mais que o normal. Aguarde a resposta; reenviar agora pode duplicar a mensagem.</p>}
            </div>}
            <div className="flex shrink-0 justify-end gap-2">
                <button type="button" disabled={sending} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={sending} onClick={sendRemaining} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{sending ? `Enviando ${index + 1}/${ordered.length}…` : sentCount ? 'Tentar restante' : `Enviar ${ordered.length > 1 ? `${ordered.length} arquivos` : 'anexo'}`}</button>
            </div>
        </DialogContent>
    </Dialog>;
}
