"use client";

import { useEffect, useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Limit WhatsApp lookups while scrolling through virtualized conversations.
const lanes = new Map<string, { active: number; waiting: Array<() => void> }>();
const pictures = new Map<string, { expires: number; promise: Promise<string | null> }>();

function loadPicture(sessionId: string, jid: string, signal?: AbortSignal): Promise<string | null> {
    const key = `${sessionId}:${jid}`;
    if (signal?.aborted) return Promise.resolve(null);
    const cached = pictures.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const entry = { expires: Date.now() + 30 * 60_000, promise: Promise.resolve(null) as Promise<string | null> };
    entry.promise = (async () => {
        let lane = lanes.get(sessionId);
        if (!lane) { lane = { active: 0, waiting: [] }; lanes.set(sessionId, lane); }
        if (lane.active >= 4) await new Promise<void>(resolve => lane!.waiting.push(resolve));
        else lane.active++;
        try {
            if (signal?.aborted) { entry.expires = 0; return null; }
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/profile-picture`, { method: "POST", signal: AbortSignal.timeout(12_000) });
            if (!response.ok) throw new Error("Profile picture unavailable");
            const data = await response.json();
            if (!data.profilePicUrl) entry.expires = Date.now() + 5 * 60_000;
            return data.profilePicUrl || null;
        } catch {
            entry.expires = Date.now() + 60_000;
            return null;
        } finally {
            const next = lane.waiting.shift();
            if (next) next();
            else lane.active--;
        }
    })();
    if (pictures.size >= 1000) pictures.delete(pictures.keys().next().value!);
    pictures.set(key, entry);
    return entry.promise;
}

export function ChatAvatar({ sessionId, jid, name, profilePic }: {
    sessionId: string; jid: string; name: string; profilePic: string | null;
}) {
    const [picture, setPicture] = useState(profilePic);

    const element = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        let current = true;
        const controller = new AbortController();
        setPicture(profilePic);
        // Saved local photos arrive with the chat list and need no WhatsApp request.
        if (profilePic?.startsWith('/api/media/')) return () => { current = false; };
        const load = () => loadPicture(sessionId, jid, controller.signal).then(url => { if (current && url) setPicture(url); });
        const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
        }, { rootMargin: "100px" }) : null;
        if (observer && element.current) observer.observe(element.current);
        else load();
        return () => { current = false; controller.abort(); observer?.disconnect(); };
    }, [sessionId, jid, profilePic]);

    return (
        <Avatar ref={element} className="h-10 w-10 flex-shrink-0">
            <AvatarImage src={picture || ""} alt={`Foto de ${name}`} className="object-cover" />
            <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-primary/20 to-blue-500/20 text-primary">
                {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
        </Avatar>
    );
}
