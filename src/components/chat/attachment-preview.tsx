"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileText, Send, Loader2 } from "lucide-react";

export function AttachmentPreview({ files, onCancel, onSend }: {
    files: File[];
    onCancel: () => void;
    onSend: (file: File, caption: string, onProgress: (percent: number) => void) => Promise<boolean>;
}) {
    const [index, setIndex] = useState(0);
    const [url, setUrl] = useState<string | null>(null);
    const [caption, setCaption] = useState("");
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const file = files[index];
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
            for (let current = index; current < files.length; current++) {
                setIndex(current);
                setProgress(null);
                setElapsed(0);
                // A caption belongs to the first pending file, avoiding duplicates.
                if (!await onSend(files[current], current === index ? caption : "", setProgress)) return;
                if (current + 1 < files.length) setIndex(current + 1);
            }
            onCancel();
        } finally { setSending(false); }
    };
    return <Dialog open onOpenChange={open => { if (!open && !sending) onCancel(); }}>
        <DialogContent showCloseButton={!sending} className="flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-3xl">
            <DialogTitle>Revisar {files.length > 1 ? `${files.length} anexos` : "anexo"}</DialogTitle>
            <DialogDescription className="break-words">{file?.name} · {(file?.size / (1024 * 1024)).toFixed(2)} MB · {index + 1} de {files.length}. Os arquivos serão enviados um por vez ao clicar em Enviar.</DialogDescription>
            {files.length > 1 && <div className="flex gap-1 overflow-x-auto text-xs" aria-label="Arquivos selecionados">{files.map((item, position) => <span key={`${item.name}-${position}`} className={`shrink-0 rounded-full border px-2 py-1 ${position === index ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{position < index ? '✓ ' : ''}{item.name}</span>)}</div>}
            <div className="flex min-h-32 min-w-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-muted/40 p-3">
                {url && !failed && file.type.startsWith('image/') ? <img src={url} alt="Prévia do arquivo selecionado" onError={() => setFailed(true)} className="max-h-[55dvh] max-w-full object-contain" />
                    : url && file.type.startsWith('video/') ? <video src={url} controls className="max-h-[55dvh] max-w-full" />
                    : url && file.type.startsWith('audio/') ? <audio src={url} controls className="max-w-full" />
                    : <div className="p-8 text-center text-muted-foreground"><FileText className="mx-auto mb-2 h-10 w-10" /><p className="text-sm">{failed ? 'Este formato não permite prévia. Você ainda pode enviar o arquivo.' : 'Documento selecionado para envio'}</p></div>}
            </div>
            {!file.type.startsWith('audio/') && <label className="text-sm">Legenda do primeiro arquivo (opcional)<textarea disabled={sending} value={caption} onChange={e => setCaption(e.target.value)} rows={2} maxLength={4000} className="mt-1 w-full resize-none rounded-lg border bg-background p-2" placeholder="Adicione uma mensagem ao anexo…" /></label>}
            {sending && <div role="status" className="space-y-1 text-xs text-muted-foreground">
                <p>{progress === null ? "Preparando arquivo…" : progress < 100 ? `Enviando arquivo: ${progress}%` : "Arquivo recebido pelo servidor. Aguardando o WhatsApp processar…"}</p>
                {progress !== null && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div>}
                {elapsed >= 60 && <p>Isso está demorando mais que o normal. Aguarde a resposta; reenviar agora pode duplicar a mensagem.</p>}
            </div>}
            <div className="flex shrink-0 justify-end gap-2">
                <button type="button" disabled={sending} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={sending} onClick={sendRemaining} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{sending ? `Enviando ${index + 1}/${files.length}…` : index ? 'Tentar restante' : `Enviar ${files.length > 1 ? `${files.length} arquivos` : 'anexo'}`}</button>
            </div>
        </DialogContent>
    </Dialog>;
}
