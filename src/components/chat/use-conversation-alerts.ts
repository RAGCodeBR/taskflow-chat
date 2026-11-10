"use client";
import { isConversationJid } from "@/lib/conversation-jid";
import { isChatSessionEvent } from "@/lib/chat-session-events";

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IncomingMessageToast } from "./incoming-message-toast";
import { useSocket } from "./socket-context";
import type { BoardChat } from "./conversation-board";
import { alertPreview, alertToastId } from "@/lib/message-alerts";

const ALERT_DISPLAY_MS = 8000;
const DESKTOP_ALERT_INTERVAL_MS = 15000;

export interface IncomingMessage {
    keyId: string; remoteJid: string; fromMe: boolean; timestamp: string;
    content: string | null; type: string; pushName?: string | null;
}
export function newIncomingMessages(messages: IncomingMessage[], seen: Set<string>) {
    return messages.filter(message => {
        if (!message.keyId || !isConversationJid(message.remoteJid) || message.fromMe !== false || seen.has(message.keyId)) return false;
        seen.add(message.keyId);
        if (seen.size > 2000) seen.delete(seen.values().next().value!);
        return true;
    });
}

export function useConversationAlerts({ sessionId, chats, selectedJids, onSelect, onIncoming }: {
    sessionId: string; chats: BoardChat[];
    /** Conversations on screen right now (the list view has one; the Kanban can show several windows). */
    selectedJids: string[];
    onSelect: (jid: string, name?: string) => void;
    onIncoming: (messages: IncomingMessage[]) => void;
}) {
    const { getSocket, joinSession } = useSocket();
    const [unread, setUnread] = useState<Record<string, number>>({});
    const [sound, setSound] = useState(false);
    const [desktop, setDesktop] = useState(false);
    const [ready, setReady] = useState(false);
    const audio = useRef<AudioContext | null>(null);
    const lastSound = useRef(0);
    const seen = useRef(new Set<string>());
    const lastDesktopAlert = useRef(new Map<string, number>());
    // Open alerts per conversation: unread count shown on the toast and the matching system notification.
    const alerts = useRef(new Map<string, { count: number; notification?: Notification }>());
    const clearAlert = useCallback((jid: string) => {
        const alert = alerts.current.get(jid);
        if (!alert) return;
        alerts.current.delete(jid);
        toast.dismiss(alertToastId(sessionId, jid));
        alert.notification?.close();
    }, [sessionId]);
    const latest = useRef({ chats, selectedJids, onSelect, onIncoming, sound, desktop });
    latest.current = { chats, selectedJids, onSelect, onIncoming, sound, desktop };
    const openKey = selectedJids.join("|");
    const resolve = (jid: string) => latest.current.chats.find(c => c.jid === jid || c.aliases?.includes(jid));
    const markRead = useCallback((jid: string) => {
        setUnread(previous => {
            const next = { ...previous };
            const chat = latest.current.chats.find(c => c.jid === jid || c.aliases?.includes(jid));
            for (const alias of [jid, ...(chat?.aliases || []), ...(chat ? [chat.jid] : [])]) delete next[alias];
            return next;
        });
        const chat = latest.current.chats.find(c => c.jid === jid || c.aliases?.includes(jid));
        for (const alias of new Set([jid, ...(chat ? [chat.jid, ...(chat.aliases || [])] : [])])) clearAlert(alias);
    }, [clearAlert]);
    // Alerts belong to this account's panel: remove them when switching account or leaving the chat.
    useEffect(() => {
        const open = alerts.current;
        const desktopTimes = lastDesktopAlert.current;
        return () => { for (const [jid, alert] of open) { toast.dismiss(alertToastId(sessionId, jid)); alert.notification?.close(); } open.clear(); desktopTimes.clear(); };
    }, [sessionId]);
    useEffect(() => {
        setReady(false);
        seen.current.clear();
        try {
            const saved = JSON.parse(localStorage.getItem(`chat-unread:${sessionId}`) || '{}');
            setUnread(Object.fromEntries(Object.entries(saved).filter(([,n]) => typeof n === 'number' && n > 0)) as Record<string, number>);
            setSound(localStorage.getItem('chat-alert-sound') === 'true');
            setDesktop(localStorage.getItem('chat-alert-desktop') === 'true');
        } catch { setUnread({}); }
        setReady(true);
    }, [sessionId]);
    useEffect(() => { if (ready) try { localStorage.setItem(`chat-unread:${sessionId}`, JSON.stringify(unread)); } catch {} }, [unread, sessionId, ready]);
    useEffect(() => {
        const readOpen = () => {
            if (document.visibilityState === 'visible' && document.hasFocus()) for (const jid of latest.current.selectedJids) markRead(jid);
        };
        readOpen();
        window.addEventListener('focus', readOpen);
        document.addEventListener('visibilitychange', readOpen);
        return () => { window.removeEventListener('focus', readOpen); document.removeEventListener('visibilitychange', readOpen); };
    }, [openKey, markRead, ready]);
    const unlockAudio = useCallback(() => {
        if (!audio.current) audio.current = new AudioContext();
        void audio.current.resume().catch(() => {});
    }, []);
    useEffect(() => {
        const unlock = () => { if (latest.current.sound) unlockAudio(); };
        window.addEventListener('pointerdown', unlock);
        return () => window.removeEventListener('pointerdown', unlock);
    }, [unlockAudio]);
    useEffect(() => () => { void audio.current?.close().catch(() => {}); }, []);
    const toggleSound = () => {
        const enabled = !sound;
        if (enabled) unlockAudio();
        setSound(enabled);
        try { localStorage.setItem('chat-alert-sound', String(enabled)); } catch {}
    };
    const toggleDesktop = async () => {
        if (typeof Notification === 'undefined') { toast.error('Este navegador não oferece notificações do sistema'); return; }
        const enabled = !desktop && (Notification.permission === 'granted' || await Notification.requestPermission() === 'granted');
        setDesktop(enabled);
        try { localStorage.setItem('chat-alert-desktop', String(enabled)); } catch {}
        if (!enabled && !desktop) toast.info('Notificações não permitidas. Os avisos no painel continuam ativos.');
    };
    useEffect(() => {
        const socket = getSocket();
        if (!socket || !ready) return;
        const connect = () => joinSession(sessionId);
        connect();
        const handler = (batch: IncomingMessage[], source: unknown) => {
            if (!isChatSessionEvent(sessionId, source)) return;
            const incoming = newIncomingMessages(batch, seen.current);
            if (!incoming.length) return;
            latest.current.onIncoming(incoming);
            const hidden = incoming.filter(message => {
                const jid = resolve(message.remoteJid)?.jid || message.remoteJid;
                const onScreen = latest.current.selectedJids.some(selected => selected === jid || resolve(selected)?.jid === jid);
                return !onScreen || document.visibilityState !== 'visible' || !document.hasFocus();
            });
            if (!hidden.length) return;
            setUnread(previous => {
                const next = { ...previous };
                for (const message of hidden) { const jid = resolve(message.remoteJid)?.jid || message.remoteJid; next[jid] = (next[jid] || 0) + 1; }
                return next;
            });
            // Latest message of each conversation in this batch.
            const byChat = new Map<string, { message: IncomingMessage; count: number }>();
            for (const message of hidden) {
                const jid = resolve(message.remoteJid)?.jid || message.remoteJid;
                byChat.set(jid, { message, count: (byChat.get(jid)?.count || 0) + 1 });
            }
            for (const [jid, { message, count }] of byChat) {
                const chat = resolve(message.remoteJid);
                const name = chat?.name || chat?.notify || message.pushName || jid.split('@')[0];
                const preview = alertPreview(message);
                const alert = alerts.current.get(jid) || { count: 0 };
                alert.count += count;
                alerts.current.set(jid, alert);
                // Always opens through the current panel state, even after a reconnect re-ran this effect.
                const open = () => { window.focus(); latest.current.onSelect(jid, name); markRead(jid); };
                toast.custom(() => createElement(IncomingMessageToast, {
                    sessionId, jid, name, profilePic: chat?.profilePic || null, count: alert.count, preview,
                    onOpen: open, onClose: () => clearAlert(jid),
                }), {
                    id: alertToastId(sessionId, jid), duration: ALERT_DISPLAY_MS,
                    onDismiss: () => { if (alerts.current.get(jid) === alert) alerts.current.delete(jid); },
                    onAutoClose: () => { if (alerts.current.get(jid) === alert) alerts.current.delete(jid); },
                });
                if (latest.current.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
                    const now = Date.now();
                    if (now - (lastDesktopAlert.current.get(jid) || 0) < DESKTOP_ALERT_INTERVAL_MS) continue;
                    lastDesktopAlert.current.set(jid, now);
                    alert.notification?.close();
                    const options = { body: alert.count > 1 ? `${alert.count} novas mensagens · ${preview}` : preview, tag: `chat:${sessionId}:${jid}`, icon: chat?.profilePic || undefined, requireInteraction: false, renotify: false };
                    const notification = new Notification(`Mensagem de ${name}`, options as NotificationOptions);
                    notification.onclick = () => { open(); notification.close(); };
                    const closeTimer = window.setTimeout(() => notification.close(), ALERT_DISPLAY_MS);
                    notification.onclose = () => { window.clearTimeout(closeTimer); if (alert.notification === notification) alert.notification = undefined; };
                    alert.notification = notification;
                }
            }
            const context = audio.current;
            if (latest.current.sound && context?.state === 'running' && Date.now() - lastSound.current > 1500) {
                lastSound.current = Date.now();
                const oscillator = context.createOscillator(), gain = context.createGain();
                oscillator.connect(gain); gain.connect(context.destination);
                oscillator.frequency.setValueAtTime(740, context.currentTime);
                oscillator.frequency.setValueAtTime(990, context.currentTime + .09);
                gain.gain.setValueAtTime(.06, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .25);
                oscillator.start(); oscillator.stop(context.currentTime + .25);
            }
        };
        socket.on('connect', connect); socket.on('chat.incoming', handler);
        return () => { socket.off('connect', connect); socket.off('chat.incoming', handler); };
    }, [getSocket, joinSession, sessionId, ready, markRead, clearAlert]);
    const canonicalUnread: Record<string, number> = {};
    for (const [jid, count] of Object.entries(unread)) {
        const canonical = chats.find(c => c.jid === jid || c.aliases?.includes(jid))?.jid || jid;
        canonicalUnread[canonical] = (canonicalUnread[canonical] || 0) + count;
    }
    return { unread: canonicalUnread, markRead, sound, toggleSound, desktop, toggleDesktop };
}
