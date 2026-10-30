"use client";
import { useState } from "react";
import { Pin, X } from "lucide-react";
import type { PinView } from "@/lib/message-marks-server";

export const MEDIA_LABELS: Record<string, string> = { IMAGE: "Imagem", AUDIO: "Áudio", VIDEO: "Vídeo", DOCUMENT: "Documento", STICKER: "Figurinha" };

// Pinned messages of the open chat, one at a time; the pin icon cycles through them.
export function PinnedBar({ pins, onOpen, onUnpin }: { pins: PinView[]; onOpen: (keyId: string) => void; onUnpin: (keyId: string) => void }) {
    const [index, setIndex] = useState(0);
    if (!pins.length) return null;
    const current = index % pins.length;
    const pin = pins[current];
    const preview = pin.content || MEDIA_LABELS[pin.type] || "Mensagem";
    return (
        <div className="tf-pinned-bar shrink-0 flex items-center gap-2 border-b bg-background/90 px-3 py-1.5 text-xs" role="region" aria-label="Mensagens fixadas">
            <button type="button" onClick={() => setIndex(current + 1)} disabled={pins.length < 2}
                aria-label={pins.length > 1 ? `Mensagem fixada ${current + 1} de ${pins.length}. Mostrar a próxima` : "Mensagem fixada"}
                className="flex shrink-0 items-center gap-1 rounded-md p-1 text-primary disabled:cursor-default">
                <Pin className="h-3.5 w-3.5" />{pins.length > 1 && <span className="tabular-nums">{current + 1}/{pins.length}</span>}
            </button>
            <button type="button" onClick={() => onOpen(pin.keyId)} className="min-w-0 flex-1 text-left" title="Ir até a mensagem">
                <span className="font-semibold">{pin.senderName}</span>
                {pin.scope === "local" && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">só para você</span>}
                <span className="block truncate text-muted-foreground">{preview}</span>
            </button>
            <button type="button" onClick={() => onUnpin(pin.keyId)} aria-label="Desfixar mensagem" title="Desfixar" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
