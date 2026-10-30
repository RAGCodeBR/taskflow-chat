"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ZoomIn, ZoomOut, Download, ImageOff } from "lucide-react";

export function MessageImage({ src, alt = "Imagem da conversa" }: { src: string; alt?: string }) {
    const [open, setOpen] = useState(false);
    const [zoom, setZoom] = useState(false);
    const [failed, setFailed] = useState(false);
    const [version, setVersion] = useState(0);
    const url = version ? `${src}${src.includes('?') ? '&' : '?'}retry=${version}` : src;
    if (failed) return <div className="max-w-xs space-y-2 rounded-lg border p-3 text-xs"><p className="flex items-center gap-2"><ImageOff className="h-4 w-4" />Não foi possível carregar esta imagem.</p><button type="button" className="underline" onClick={() => { setVersion(v => v+1); setFailed(false); }}>Tentar carregar novamente</button></div>;
    return <>
        <button type="button" aria-label="Ampliar imagem da conversa" onClick={() => { setZoom(false); setOpen(true); }} className="group relative mb-1.5 block max-w-full overflow-hidden rounded-xl border border-border/30 text-left">
            <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-h-64 max-w-full object-contain rounded-xl" />
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white"><ZoomIn className="h-3 w-3" />Ampliar</span>
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="flex h-[92dvh] w-[calc(100vw-1rem)] max-w-none sm:max-w-[1400px] flex-col gap-0 overflow-hidden rounded-xl p-0">
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3 pr-12">
                    <div className="min-w-0 flex-1"><DialogTitle className="text-sm">Imagem da conversa</DialogTitle><DialogDescription className="text-xs">Visualize o print completo ou amplie os detalhes.</DialogDescription></div>
                    <button type="button" onClick={() => setZoom(v => !v)} className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs">{zoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}{zoom ? "Ajustar à tela" : "Ampliar detalhes"}</button>
                    <a href={src} download className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs"><Download className="h-4 w-4" />Baixar</a>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-black/90 p-3">
                    <div className={zoom ? "min-h-full min-w-full" : "flex h-full w-full items-center justify-center"}>
                        <img src={url} alt={alt} onError={() => { setOpen(false); setFailed(true); }} className={zoom ? "block max-w-none" : "max-h-full max-w-full object-contain"} />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    </>;
}
