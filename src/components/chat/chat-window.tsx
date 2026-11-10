"use client";
import { isChatSessionEvent } from "@/lib/chat-session-events";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_CHAT_UPLOAD_BYTES, MAX_CHAT_UPLOAD_MB } from "@/lib/upload-limits";
import { AttachmentPreview } from "./attachment-preview";
import { MessageImage } from "./message-image";
import { publishConfirmedChatMessage, type ChatMessageUpdate } from "@/lib/chat-message-updates";
import { ContactTools } from "./contact-tools";
import { phoneFromJid,formatContactPhone } from "@/lib/contact-card";
import {mergeConversationMessages,quotePreviewText} from "@/lib/conversation-messages";
import { messageSenderName } from "@/lib/message-sender";
import { messageFallback } from "@/lib/message-display";
import { messageLinkParts } from "@/lib/message-links";
import { ChatAvatar } from "./chat-avatar";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, ArrowLeft, FileText, Image as ImageIcon, Music, Video, Download, ArrowDown, CornerUpLeft, Copy, Trash2, Info, X, Sparkles, Smile, Star, StarOff, Pin, PinOff, Archive, Forward, Contact, Clock, CheckCheck, BellRing, MoreVertical } from "lucide-react";
import { usePending, setMessageLater, ReminderDialog, finishReminder } from "./follow-ups";
import { ChatPickerDialog } from "./chat-picker-dialog";
import { MAX_FORWARD_TARGETS } from "@/lib/forward-message";
import { setChatArchived } from "./archived-panel";
import { PinnedBar } from "./pinned-bar";
import type { PinView } from "@/lib/message-marks-server";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatMentions, mentionPayload, type MentionPerson } from "@/lib/mentions";
import { EmojiPicker } from "./emoji-picker";
import { VoiceRecorder } from "./voice-recorder";
import { MessageInfo } from "./message-info";
import { participantHue } from "@/lib/participant-colors";
import { StickerPicker } from "./sticker-picker";
import type { ChatReaction } from "@/lib/reactions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getChatMessages } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { InteractiveMessageDialog } from "./interactive-message-dialog";
import { useTranslations } from "next-intl";

interface Message {
    reactions?: ChatReaction[];
    id: string;
    keyId: string;
    content: string;
    fromMe: boolean;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    senderJid?: string | null;
    mediaUrl?: string;
    remoteJid?: string;
    quoteId?: string | null;
    quoted?: {
        type?: string;
        mediaUrl?: string | null;
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
    } | null;
}

interface ChatWindowProps {
    sessionId: string;
    jid: string;
    name?: string;
    onBack?: () => void;
    onClose?: () => void;
    /** Scroll to and highlight this message once loaded (from the favorites list). */
    focusKeyId?: string;
    onFocusDone?: (found: boolean) => void;
    /** Extra window controls (minimize, expand) shown before the close button. */
    headerActions?: ReactNode;
    /** Narrow window: secondary header actions move into a menu. */
    compact?: boolean;
}

const PAGE_LIMIT = 50;

// ─── Lazy media (unchanged) ────────
function LazyVideo({ src }: { src: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {visible ? <video src={src} controls className="max-w-full max-h-60 rounded-xl" preload="none" />
                : <div className="h-32 bg-muted/30 rounded-xl animate-pulse flex items-center justify-center"><Video className="h-6 w-6 text-muted-foreground/50" /></div>}
        </div>
    );
}

function useDateLabel() {
    const t = useTranslations("chat");
    const cache = useRef(new Map<string, string>());
    return (timestamp: string): string => {
        const cached = cache.current.get(timestamp);
        if (cached) return cached;
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        let label: string;
        if (diffDays === 0) label = t("today");
        else if (diffDays === 1) label = t("yesterday");
        else label = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        cache.current.set(timestamp, label);
        return label;
    };
}

function handleDownload(url: string, fileName: string) {
    toast.info("Downloading...");
    fetch(url).then(res => { if (!res.ok) throw new Error(); return res.blob(); }).then(blob => {
        const dlUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = dlUrl; link.download = fileName;
        document.body.appendChild(link);
        link.click(); link.remove();
        window.URL.revokeObjectURL(dlUrl);
    }).catch(() => toast.error("Download failed!"));
}

// ─── Context Menu ──────────────────
const FORWARDABLE = new Set(["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER"]);
interface ContextMenuState {
    x: number;
    y: number;
    msg: Message;
}
function ContextMenu({ state, onClose, onReply, onForward, onDelete, onInfo, starred, pinned, onStar, onPin, later, onLater }: { later: boolean; onLater: (msg: Message) => void; state: ContextMenuState; onClose: () => void; onReply: (msg: Message) => void; onForward: (msg: Message) => void; onDelete: (msg: Message) => void; onInfo: (msg: Message) => void; starred: boolean; pinned: boolean; onStar: (msg: Message) => void; onPin: (msg: Message, seconds: number | null) => void }) {
    const t = useTranslations("chat");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const items = [
        { label: t("reply"), icon: CornerUpLeft, action: () => { onReply(state.msg); onClose(); } },
        ...(FORWARDABLE.has(state.msg.type) ? [{ label: "Encaminhar", icon: Forward, action: () => { onForward(state.msg); onClose(); } }] : []),
        { label: t("copy"), icon: Copy, action: () => { navigator.clipboard.writeText(state.msg.content || "").then(() => toast.success(t("copied"))).catch(() => {}); onClose(); } },
        { label: t("delete"), icon: Trash2, action: () => { onDelete(state.msg); onClose(); }, dangerous: true },
        { label: t("info"), icon: Info, action: () => { onInfo(state.msg); onClose(); } },
        { label: later ? "Já vi" : "Ver depois", icon: later ? CheckCheck : Clock, action: () => { onLater(state.msg); onClose(); } },
        { label: starred ? "Remover favorita" : "Favoritar", icon: starred ? StarOff : Star, action: () => { onStar(state.msg); onClose(); } },
        ...(pinned
            ? [{ label: "Desfixar", icon: PinOff, action: () => { onPin(state.msg, null); onClose(); } }]
            : ([[86400, "Fixar por 24 horas"], [604800, "Fixar por 7 dias"], [2592000, "Fixar por 30 dias"]] as const).map(([seconds, label]) => ({ label, icon: Pin, action: () => { onPin(state.msg, seconds); onClose(); } }))),
    ];

    // Adjust position to not overflow viewport
    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (state.x > window.innerWidth - 180) style.left = state.x - 180;
    if (state.y > window.innerHeight - 410) style.top = Math.max(8, state.y - 400);

    return (
        <div ref={ref} style={style} className="w-44 rounded-xl bg-popover border shadow-xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.filter(item => item.icon !== Info || state.msg.fromMe).map((item, i) => (
                <button key={i} onClick={item.action} className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                    item.dangerous ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-muted"
                )}>
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// ─── Main Component ─────────────────
export function ChatWindow(props: ChatWindowProps) {
    if (props.jid.endsWith("@broadcast") || props.jid.endsWith("@newsletter")) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Status e canais não fazem parte das conversas de atendimento. Volte para a lista ou para o quadro.</p>
        {(props.onBack || props.onClose) && <Button variant="outline" onClick={props.onClose || props.onBack}>Voltar às conversas</Button>}
    </div>;
    return <ChatConversationWindow key={`${props.sessionId}:${props.jid}`} {...props} />;
}
function ChatConversationWindow({ sessionId, jid, name, onBack, onClose, focusKeyId, onFocusDone, headerActions, compact }: ChatWindowProps) {
    const t = useTranslations("chat");
    const tCommon = useTranslations("common");
    const [infoMessage,setInfoMessage] = useState<Message|null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const draftKey = `chat-draft:${sessionId}:${jid}`;
    const [input, setInput] = useState("");
    const [draftReady, setDraftReady] = useState(false);
    useEffect(() => {
        try { setInput(sessionStorage.getItem(draftKey) || ""); } catch {}
        setDraftReady(true);
    }, [draftKey]);
    useEffect(() => {
        if (!draftReady) return;
        try { if (input) sessionStorage.setItem(draftKey, input); else sessionStorage.removeItem(draftKey); } catch {}
    }, [draftKey, input, draftReady]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [people, setPeople] = useState<MentionPerson[]>([]);
    const [mentionCursor, setMentionCursor] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionDismissed, setMentionDismissed] = useState(false);
    const [chosenMentions, setChosenMentions] = useState<{token:string;jid:string}[]>([]);
    useEffect(() => {
        setPeople([]); setChosenMentions([]); setMentionDismissed(false);
        if (!jid.endsWith('@g.us')) return;
        const controller = new AbortController();
        fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/participants`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : Promise.reject())
            .then(result => setPeople(result.people || [])).catch(() => {});
        return () => controller.abort();
    }, [sessionId, jid]);
    const mentionMatch = jid.endsWith('@g.us') && !mentionDismissed ? input.slice(0,mentionCursor).match(/(?:^|\s)@([^\s@]*)$/) : null;
    const suggestions = mentionMatch ? people.filter(person => person.current !== false && person.name.toLocaleLowerCase('pt-BR').includes(mentionMatch[1].toLocaleLowerCase('pt-BR'))).slice(0,8) : [];
    const chooseMention = (person: MentionPerson) => {
        const start = input.lastIndexOf('@', mentionCursor - 1);
        if (start < 0) return;
        const duplicate = people.filter(p => p.current !== false && p.name === person.name).length > 1;
        const token = `@${person.name}${duplicate ? ' ('+person.jid.split('@')[0].slice(-4)+')' : ''}`;
        const updated = input.slice(0,start)+token+' '+input.slice(mentionCursor);
        setInput(updated); setChosenMentions(current => [...current.filter(m => m.token !== token),{token,jid:person.jid}]);
        setMentionDismissed(true);
        requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(start+token.length+1,start+token.length+1); });
    };
    const [attachment, setAttachment] = useState<{ files: File[]; type: string; session: string; jid: string } | null>(null);
    useEffect(() => { setAttachment(null); }, [sessionId, jid]);
    const selectAttachments = (files: File[], explicitType?: string) => {
        const accepted = files.filter(file => {
            if (!file.size) { toast.error(`${file.name}: arquivo vazio.`); return false; }
            if (file.size > MAX_CHAT_UPLOAD_BYTES) { toast.error(`${file.name}: máximo de ${MAX_CHAT_UPLOAD_MB} MB.`); return false; }
            return true;
        });
        if (!accepted.length) return;
        setAttachment({ files: accepted, type: explicitType || '*', session: sessionId, jid });
    };
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [uploadType, setUploadType] = useState<string>("image");
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [newMsgBadge, setNewMsgBadge] = useState(false);

    // Delete confirmation
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    // Interactive message dialog state
    const [interactiveDialogOpen, setInteractiveDialogOpen] = useState(false);
    const [forwarding, setForwarding] = useState<Message | null>(null);
    const [sharingContact, setSharingContact] = useState(false);
    const forwardMessage = async (msg: Message, toJids: string[]) => {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/forward`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyId: msg.keyId, toJids }) });
            const result = await response.json().catch(() => ({}));
            for (const message of result.messages || []) publishConfirmedChatMessage(sessionId, message);
            if (!response.ok) throw Error(result.message || "Não foi possível encaminhar");
            toast.success(toJids.length > 1 ? `Mensagem encaminhada para ${toJids.length} conversas` : "Mensagem encaminhada");
            return true;
        } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível encaminhar"); return false; }
    };
    const shareContact = async (contactJid: string) => {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(contactJid)}/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toJid: jid }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw Error(result.message || "Não foi possível enviar o contato");
            publishConfirmedChatMessage(sessionId, result.message);
            setAutoScroll(true); fetchMessages();
            toast.success("Contato enviado");
            return true;
        } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível enviar o contato"); return false; }
    };

    const { getSocket, joinSession } = useSocket();
    const getDateLabel = useDateLabel();

    const scrollToBottom = useCallback((smooth = true) => {
        bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }, []);

    const fetchMessages = useCallback(async (before?: string, reconcile = false) => {
        try {
            if (!before && !reconcile) setLoading(true);
            else if (before) setLoadingMore(true);
            const data: any = await getChatMessages(sessionId, jid, PAGE_LIMIT, before);
            if (!before && reconcile) setMessages(prev => mergeConversationMessages(prev, data.messages || []));
            else if (!before) { setMessages(data.messages || []); setAutoScroll(true); }
            else if (data.messages?.length > 0) setMessages(prev => [...(data.messages || []), ...prev]);
            if (!reconcile) {
                setHasMore(data.hasMore);
                if (data.messages?.length > 0) setOldestTimestamp(data.messages[0].timestamp);
            }
        } catch (e) { console.error("Failed to load messages", e); }
        finally { setLoading(false); setLoadingMore(false); }
    }, [sessionId, jid]);

    useEffect(() => { setMessages([]); setOldestTimestamp(null); setHasMore(false); fetchMessages(); }, [fetchMessages]);
    useEffect(() => {
        let lastRefresh = 0;
        const refresh = () => {
            if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastRefresh < 4000) return;
            lastRefresh = Date.now();
            void fetchMessages(undefined, true);
        };
        const socket = getSocket();
        socket?.on("connect", refresh);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        document.addEventListener("visibilitychange", refresh);
        const timer = window.setInterval(refresh, 60000);
        return () => { socket?.off("connect", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
    }, [fetchMessages, getSocket]);

    // Auto focus input when chat changes and finished loading
    useEffect(() => {
        if (!loading && inputRef.current) {
            // A tiny delay ensures React has fully flushed the DOM for the new chat
            setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
        }
    }, [jid, loading]);

    // Socket real-time
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);
        const normalizedJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
        const handler = (newMessages: Message[], source: unknown) => {
            if (!isChatSessionEvent(sessionId, source)) return;
            setMessages(prev => {
                const relevant = newMessages.filter(m => m.remoteJid === normalizedJid || prev.some(p => p.remoteJid === m.remoteJid));
                if (relevant.length === 0) return prev;
                return mergeConversationMessages(prev,relevant);
            });
        };
        socket.on("message.update", handler);
        return () => { socket.off("connect", onConnect); socket.off("message.update", handler); };
    }, [sessionId, jid, getSocket, joinSession]);

    useEffect(() => { if (autoScroll) scrollToBottom(false); }, [messages, autoScroll, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        setAutoScroll(atBottom);
        if (atBottom) setNewMsgBadge(false);
        if (el.scrollTop < 100 && hasMore && !loadingMore && oldestTimestamp) {
            const prevHeight = el.scrollHeight;
            fetchMessages(oldestTimestamp).then(() => {
                requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight; });
            });
        }
    }, [hasMore, loadingMore, oldestTimestamp, fetchMessages]);

    const reactTo = async (message: Message, emoji: string) => {
        try {
            const response = await fetch(`/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/${encodeURIComponent(message.keyId)}/react`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({emoji}) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            setMessages(current => current.map(m => m.keyId === message.keyId ? {...m,reactions:result.reactions} : m));
        } catch(error) { toast.error(error instanceof Error ? error.message : 'Não foi possível reagir'); }
    };
    useEffect(() => {
        const socket = getSocket(); if (!socket) return;
        const handler = (update: {keyId:string;reactions:ChatReaction[]}, source: unknown) => {
            if (!isChatSessionEvent(sessionId, source)) return;
            setMessages(current => current.map(m => m.keyId === update.keyId ? {...m,reactions:update.reactions} : m));
        };
        socket.on('message.reactions',handler);return()=>{socket.off('message.reactions',handler)};
    }, [sessionId,jid,getSocket]);
    // Pinned and starred messages of this chat.
    const [pins, setPins] = useState<PinView[]>([]);
    const [starred, setStarred] = useState<Set<string>>(new Set());
    // "Ver depois" marks and this conversation's reminder (Pendências).
    const pending = usePending(sessionId);
    const later = new Set(pending.messages.map(item => item.keyId));
    const reminder = pending.reminders.find(item => item.chatJid === jid);
    const [reminderOpen, setReminderOpen] = useState(false);
    const marksBase = `/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}`;
    const loadPins = useCallback(async () => {
        try {
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/pins`);
            if (response.ok) setPins((await response.json()).pins || []);
        } catch { /* the bar simply stays as it was */ }
    }, [sessionId, jid]);
    const loadStarred = useCallback(async () => {
        try {
            const response = await fetch(`/api/messages/${encodeURIComponent(sessionId)}/starred?jid=${encodeURIComponent(jid)}`);
            if (response.ok) setStarred(new Set(((await response.json()).items || []).map((item: { keyId: string }) => item.keyId)));
        } catch { /* stars stay as they were */ }
    }, [sessionId, jid]);
    useEffect(() => { loadPins(); loadStarred(); }, [loadPins, loadStarred]);
    useEffect(() => {
        const socket = getSocket(); if (!socket) return;
        const handler = (_update: unknown, source: unknown) => { if (isChatSessionEvent(sessionId, source)) loadPins(); };
        socket.on('message.pins', handler); return () => { socket.off('message.pins', handler); };
    }, [sessionId, getSocket, loadPins]);
    useEffect(() => {
        const reload = () => loadStarred();
        window.addEventListener('wa:stars-changed', reload); return () => window.removeEventListener('wa:stars-changed', reload);
    }, [loadStarred]);
    const toggleStar = async (message: Message) => {
        const star = !starred.has(message.keyId);
        setStarred(current => { const next = new Set(current); if (star) next.add(message.keyId); else next.delete(message.keyId); return next; });
        try {
            const response = await fetch(`${marksBase}/${encodeURIComponent(message.keyId)}/star`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ star }) });
            if (!response.ok) throw new Error();
            toast.success(star ? 'Mensagem favoritada' : 'Removida das favoritas');
            window.dispatchEvent(new CustomEvent('wa:stars-changed'));
        } catch { toast.error('Não foi possível salvar a favorita'); loadStarred(); }
    };
    const togglePin = async (message: { keyId: string }, seconds: number | null) => {
        try {
            const response = await fetch(`${marksBase}/${encodeURIComponent(message.keyId)}/pin`, seconds === null ? { method: 'DELETE' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time: seconds }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message);
            if (result.warning) toast.warning(result.warning); else toast.success(seconds === null ? 'Mensagem desfixada' : 'Mensagem fixada');
        } catch (error) { toast.error(error instanceof Error && error.message ? error.message : 'Não foi possível fixar a mensagem'); }
        loadPins();
    };

    // Focus a message (favorites list or pinned bar): load older pages until it shows up,
    // then scroll to it and highlight it. Bounded so a missing message never loops.
    const [focusTarget, setFocusTarget] = useState<string | null>(focusKeyId || null);
    useEffect(() => { if (focusKeyId) setFocusTarget(focusKeyId); }, [focusKeyId]);
    const focusPages = useRef(0);
    useEffect(() => {
        if (!focusTarget || loading || loadingMore) return;
        const element = scrollRef.current?.querySelector(`[data-key-id="${CSS.escape(focusTarget)}"]`);
        if (element) {
            setAutoScroll(false);
            element.scrollIntoView({ block: 'center' });
            element.classList.add('tf-focus'); setTimeout(() => element.classList.remove('tf-focus'), 1600);
            setFocusTarget(null); focusPages.current = 0; onFocusDone?.(true);
            return;
        }
        if (hasMore && oldestTimestamp && focusPages.current < 20) { focusPages.current++; setAutoScroll(false); fetchMessages(oldestTimestamp); return; }
        setFocusTarget(null); focusPages.current = 0; onFocusDone?.(false);
    }, [focusTarget, messages, loading, loadingMore, hasMore, oldestTimestamp, fetchMessages, onFocusDone]);

    const sendingRef = useRef(false);
    const [sending, setSending] = useState(false);
    const handleSend = async () => {
        if (!input.trim() || sendingRef.current) return;
        const submitted = input;
        sendingRef.current = true; setSending(true);
        try {
            const payload = mentionPayload(input, chosenMentions);
            const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/send-text`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jid,text:payload.text,quotedMessageId:replyingTo?.keyId,mentions:payload.mentions})});
            const result = await response.json().catch(()=>null);
            if (!response.ok) throw Error(result?.message || "Não foi possível confirmar o envio. Confira no WhatsApp antes de tentar novamente.");
            if (result.message) {
                const message = result.message as unknown as Message;
                setMessages(current => mergeConversationMessages(current,[message]));
                publishConfirmedChatMessage(sessionId, result.message);
                setAutoScroll(true);
            } else await fetchMessages();
            setChosenMentions([]);
            setInput(current => current === submitted ? "" : current);
            setReplyingTo(null);
            setAutoScroll(true);
        } catch (e: any) { toast.error(e.message || "Failed to send"); }
        finally { sendingRef.current = false; setSending(false); }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Focus input when replying
    useEffect(() => {
        if (replyingTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyingTo]);

    // Global keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Escape: cancel reply
            if (e.key === "Escape" && replyingTo) {
                e.preventDefault();
                setReplyingTo(null);
                return;
            }
            // ? : show shortcuts
            if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                toast.success("Shortcuts", {
                    description: "Enter: Send\nShift+Enter: New line\nEsc: Cancel reply\n?: Show this help"
                });
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [replyingTo]);

    const processFileUpload = async (file: File, explicitType?: string, caption = "", onProgress?: (percent: number) => void, mentions: string[] = []): Promise<boolean> => {
        if (!file.size) { toast.error("O arquivo está vazio."); return false; }
        if (file.size > MAX_CHAT_UPLOAD_BYTES) { toast.error(`O arquivo deve ter no máximo ${MAX_CHAT_UPLOAD_MB} MB.`); return false; }
        const formData = new FormData();
        formData.append("file", file);
        formData.append("caption", caption);
        formData.append("mentions", JSON.stringify(mentions));
        let type = explicitType;
        if (!type || type === '*') {
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }
        formData.append("type", type);
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);
        try {
            toast.info(`Enviando ${file.name}…`);
            const result = await new Promise<{ message?: ChatMessageUpdate }>((resolve, reject) => {
                const request = new XMLHttpRequest();
                request.open("POST", `/api/chat/${encodeURIComponent(sessionId)}/send-media`);
                request.upload.onprogress = (event) => {
                    if (event.lengthComputable) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100)));
                };
                request.onload = () => {
                    let body: { message?: ChatMessageUpdate | string } | null = null;
                    try { body = JSON.parse(request.responseText); } catch { /* Keep the HTTP failure below. */ }
                    if (request.status >= 200 && request.status < 300) resolve({ message: typeof body?.message === "object" ? body.message : undefined });
                    else reject(new Error(typeof body?.message === "string" ? body.message : "Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente."));
                };
                request.onerror = () => reject(new Error("A conexão caiu durante o envio. Confira a conversa antes de tentar novamente."));
                request.send(formData);
            });
            toast.info("Arquivo aceito pelo servidor. Aguardando confirmação de entrega no WhatsApp.");
            publishConfirmedChatMessage(sessionId, result?.message);
            await fetchMessages();
            return true;
        } catch (error: any) { toast.error(error.message || "Não foi possível confirmar o envio. Confira a conversa no WhatsApp antes de tentar novamente."); return false; }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        selectAttachments(files, uploadType);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const triggerUpload = (type: string) => {
        setUploadType(type);
        if (fileInputRef.current) {
            fileInputRef.current.accept = type === 'image' ? "image/*" : type === 'video' ? "video/*" : type === 'audio' ? "audio/*" : "*/*";
            fileInputRef.current.click();
        }
    };

    // Right-click handler
    const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, msg });
    }, []);

    const [moreOpen, setMoreOpen] = useState(false);
    const [contactName,setContactName] = useState<string | null>(null);
    const [contactPhone,setContactPhone] = useState<string | null>(null);
    const displayName = contactName || name || jid.split('@')[0];

    // Loading is now handled gracefully inside the message list to prevent unmounting the layout

    return (
        <div
            className="flex-1 flex flex-col bg-muted/20 min-w-0 min-h-0 relative"
            onPaste={e => { const images = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/')); if (images.length) { e.preventDefault(); selectAttachments(images); } }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setIsDragging(true); } }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault(); setIsDragging(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length) selectAttachments(files);
            }}
        >
            {attachment && attachment.session === sessionId && attachment.jid === jid && <AttachmentPreview key={`${sessionId}:${jid}:${attachment.files.map(file => `${file.name}:${file.lastModified}`).join('|')}`} files={attachment.files} people={jid.endsWith('@g.us') ? people : []} onCancel={() => setAttachment(null)} onSend={(file, caption, mentions, onProgress) => processFileUpload(file, attachment.type, caption, onProgress, mentions)} />}
            {infoMessage && <MessageInfo sessionId={sessionId} jid={jid} message={infoMessage} onClose={()=>setInfoMessage(null)} />}
            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onInfo={setInfoMessage}
                    onClose={() => setContextMenu(null)}
                    onReply={(msg) => { setReplyingTo(msg); scrollToBottom(true); }}
                    onForward={setForwarding}
                    onDelete={(msg) => {
                        setDeleteConfirmMsg(msg);
                    }}
                    starred={starred.has(contextMenu.msg.keyId)}
                    pinned={pins.some(pin => pin.keyId === contextMenu.msg.keyId)}
                    onStar={toggleStar}
                    later={later.has(contextMenu.msg.keyId)}
                    onLater={msg => setMessageLater(sessionId, jid, msg.keyId, !later.has(msg.keyId))}
                    onPin={togglePin}
                />
            )}

            <ChatPickerDialog sessionId={sessionId} open={!!forwarding} onOpenChange={open => { if (!open) setForwarding(null); }}
                title="Encaminhar mensagem" description={`Escolha até ${MAX_FORWARD_TARGETS} conversas. A mensagem chega marcada como encaminhada.`}
                max={MAX_FORWARD_TARGETS} exclude={jid} confirmLabel={count => count > 1 ? `Encaminhar para ${count}` : "Encaminhar"}
                onConfirm={toJids => forwarding ? forwardMessage(forwarding, toJids) : Promise.resolve(false)} />
            <ChatPickerDialog sessionId={sessionId} open={sharingContact} onOpenChange={setSharingContact} onlyContacts exclude={jid}
                title="Compartilhar contato" description={`O cartão do contato escolhido será enviado para ${name}.`}
                confirmLabel={() => "Enviar contato"} onConfirm={([contactJid]) => shareContact(contactJid)} />

            {/* Drag overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary flex items-center justify-center flex-col gap-3 rounded-lg m-2">
                    <Paperclip className="h-8 w-8 text-primary" />
                    <p className="text-lg font-semibold text-primary">Drop files here</p>
                </div>
            )}

            {/* Delete confirmation dialog */}
            <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("deleteDescription")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const msg = deleteConfirmMsg;
                                if (!msg) return;
                                fetch(`/api/messages/${sessionId}/${jid}/${msg.keyId}`, { method: "DELETE" })
                                    .then(() => { setMessages(p => p.filter(m => m.keyId !== msg.keyId)); toast.success(tCommon("deleted")); })
                                    .catch(() => toast.error(tCommon("error")));
                                setDeleteConfirmMsg(null);
                            }}
                        >{t("delete")}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Loading older indicator */}
            {loadingMore && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border text-xs flex items-center gap-2">
                    <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    {t("loadingOlder")}
                </div>
            )}

            {/* Header */}
            <div className="shrink-0 px-3 py-2.5 border-b bg-background/80 backdrop-blur-sm flex items-center gap-3 z-10">
                {onBack && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0 text-muted-foreground hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                )}
                <ChatAvatar sessionId={sessionId} jid={jid} name={displayName} profilePic={null} />
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{displayName}</h3>
                    <p className="text-[10px] text-muted-foreground truncate">{jid.endsWith("@g.us") ? jid : contactPhone || (phoneFromJid(jid) ? formatContactPhone(phoneFromJid(jid)!) : "Telefone ainda não sincronizado")}</p>
                </div>
                {(() => {
                    const archive = async () => { try { await setChatArchived(sessionId, jid, true); toast.success('Conversa arquivada. Ela fica em Arquivadas.'); } catch { toast.error('Não foi possível arquivar a conversa'); } };
                    const openStarred = () => window.dispatchEvent(new CustomEvent('wa:open-starred'));
                    if (!compact) return <>
                        <button type="button" onClick={archive} title="Arquivar conversa" aria-label="Arquivar conversa" className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Archive className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setReminderOpen(true)} title={reminder ? "Editar lembrete" : "Criar lembrete para esta conversa"} aria-label={reminder ? "Editar lembrete desta conversa" : "Criar lembrete para esta conversa"} className={cn("shrink-0 rounded-full p-2 hover:bg-muted", reminder ? "text-amber-500" : "text-muted-foreground hover:text-foreground")}><BellRing className="h-4 w-4" /></button>
                        <button type="button" onClick={openStarred} title="Mensagens favoritas" aria-label="Abrir mensagens favoritas" className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Star className="h-4 w-4" /></button>
                    </>;
                    const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted";
                    return <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                        <PopoverTrigger asChild><button type="button" title="Mais opções" aria-label="Mais opções da conversa" className="relative shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreVertical className="h-4 w-4" />{reminder && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" />}</button></PopoverTrigger>
                        <PopoverContent align="end" className="wa-more-menu w-56 p-1">
                            <button type="button" className={item} onClick={() => { setMoreOpen(false); setReminderOpen(true); }}><BellRing className={cn("h-4 w-4", reminder ? "text-amber-500" : "text-muted-foreground")} />{reminder ? "Editar lembrete" : "Criar lembrete"}</button>
                            <button type="button" className={item} onClick={() => { setMoreOpen(false); openStarred(); }}><Star className="h-4 w-4 text-muted-foreground" />Mensagens favoritas</button>
                            <button type="button" className={item} onClick={() => { setMoreOpen(false); void archive(); }}><Archive className="h-4 w-4 text-muted-foreground" />Arquivar conversa</button>
                        </PopoverContent>
                    </Popover>;
                })()}
                {!jid.endsWith("@g.us") && <ContactTools sessionId={sessionId} jid={jid} name={displayName} onResolved={contact=>{setContactName(contact.name);setContactPhone(contact.phoneFormatted)}} />}
                {headerActions}
                {onClose && <button type="button" onClick={onClose} title="Voltar ao quadro" aria-label="Fechar conversa e voltar ao Kanban" className="shrink-0 rounded-full border border-border/50 p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            {reminder && <div role="note" className="flex shrink-0 items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-100">
                <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words"><span className="font-semibold">Lembrete: </span>{reminder.note}</p>
                <button type="button" onClick={() => setReminderOpen(true)} className="shrink-0 rounded px-2 py-0.5 hover:bg-amber-500/20">Editar</button>
                <button type="button" onClick={() => finishReminder(sessionId, jid)} className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-medium hover:bg-amber-500/20"><CheckCheck className="h-3.5 w-3.5" />Concluir</button>
            </div>}
            <ReminderDialog sessionId={sessionId} jid={jid} name={displayName} current={reminder?.note} open={reminderOpen} onOpenChange={setReminderOpen} />
            <PinnedBar pins={pins} onOpen={setFocusTarget} onUnpin={keyId => togglePin({ keyId }, null)} />

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 min-h-0 styled-scrollbar" onScroll={handleScroll}
                style={{ backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.04) 1px, transparent 0)`, backgroundSize: '24px 24px' }}
            >
                <div className="flex flex-col gap-3 max-w-5xl w-full mx-auto">
                    {loading && messages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center py-32">
                            <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        </div>
                    )}
                    {!hasMore && messages.length > 0 && (
                        <div className="text-center py-4">
                            <span className="text-[10px] font-medium text-muted-foreground bg-background/80 px-3 py-1 rounded-full border border-border/30">{t("beginningOfConversation")}</span>
                        </div>
                    )}
                    {messages.length === 0 && !loading && (
                        <div className="flex-1 flex items-center justify-center py-16"><p className="text-sm text-muted-foreground">{t("noMessages")}</p></div>
                    )}
                    {messages.map((msg, idx) => {
                        const showDate = idx === 0 || getDateLabel(msg.timestamp) !== getDateLabel(messages[idx - 1].timestamp);
                        const previous = messages[idx - 1];
                        const tail = showDate || !previous || previous.fromMe !== msg.fromMe || (!msg.fromMe && (previous.senderJid || previous.pushName) !== (msg.senderJid || msg.pushName));
                        return (
                            <div key={msg.keyId} id={`msg-${msg.keyId}`}>
                                {showDate && (
                                    <div className="flex justify-center my-3">
                                        <span className="text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-border/30">
                                            {getDateLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                )}
                                <div className={cn("flex gap-1 group", msg.fromMe ? "justify-end" : "justify-start")}>
                                    {/* Reply button: my msg on left */}
                                    {msg.fromMe && (
                                        <button onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                            className="self-center p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0 order-first"
                                            title="Reply">
                                            <CornerUpLeft className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <div className={cn(
                                        "flex flex-col max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm overflow-hidden cursor-context-menu",
                                        msg.fromMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-background border border-border/40 rounded-bl-sm"
                                    )} data-key-id={msg.keyId} data-tail={tail ? "true" : undefined} data-participant-bubble={!msg.fromMe && jid.endsWith("@g.us") ? "true" : undefined} style={!msg.fromMe && jid.endsWith("@g.us") ? {"--participant-hue": participantHue(people.find(person=>person.jid===msg.senderJid || person.aliases?.includes(msg.senderJid || ""))?.jid || msg.senderJid || msg.pushName || "unknown")} as React.CSSProperties : undefined} onContextMenu={(e) => handleContextMenu(e, msg)}>
                                        {!msg.fromMe && jid.endsWith("@g.us") && (
                                            <span className="text-[10px] font-semibold text-primary block mb-0.5">{messageSenderName(msg, people)}</span>
                                        )}
                                        {msg.fromMe && <button type="button" onClick={()=>setInfoMessage(msg)} aria-label="Ver quem recebeu e leu esta mensagem" className="self-end rounded p-1 opacity-70 hover:opacity-100"><Info className="h-3.5 w-3.5"/></button>}
                                        {msg.quoted && (
                                            <div 
                                                className={cn(
                                                    "mb-1.5 px-2 py-1 rounded-lg border-l-4 text-xs select-none cursor-pointer text-left bg-muted/40",
                                                    msg.fromMe 
                                                        ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground/90 hover:bg-primary-foreground/15" 
                                                        : "border-primary bg-muted text-muted-foreground hover:bg-muted/60"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const target = document.getElementById(`msg-${msg.quoted?.keyId}`);
                                                    if (target) {
                                                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                                                        target.classList.add("bg-primary/10", "transition-colors", "duration-500");
                                                        setTimeout(() => {
                                                            target.classList.remove("bg-primary/10");
                                                        }, 1500);
                                                    } else {
                                                        toast.info("A mensagem original não está carregada. Carregue as mensagens anteriores para encontrá-la.");
                                                    }
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <span className="font-semibold block text-[10px]">{msg.quoted.fromMe ? t("you") : jid.endsWith("@g.us") ? messageSenderName(msg.quoted,people) : displayName}</span>
                                                        <span className="line-clamp-2 block break-words text-xs">{formatMentions(quotePreviewText(msg.quoted),people)}</span>
                                                    </div>
                                                    {(msg.quoted.type==='IMAGE'||msg.quoted.type==='STICKER') && msg.quoted.mediaUrl && <img src={msg.quoted.mediaUrl} alt="Imagem da mensagem citada" draggable={false} loading="lazy" className="h-12 w-12 shrink-0 rounded object-cover" />}
                                                </div>
                                            </div>
                                        )}
                                        {/* IMAGE */}
                                        {msg.type === 'IMAGE' && msg.mediaUrl && (
                                            <div className="relative group/media">
                                                <MessageImage key={msg.mediaUrl} src={msg.mediaUrl} alt="Imagem recebida na conversa" />
                                                <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `IMAGE-${msg.keyId}.jpg`)}><Download className="h-4 w-4" /></Button>
                                            </div>
                                        )}
                                        {/* VIDEO */}
                                        {msg.type === 'VIDEO' && msg.mediaUrl && (
                                            <div className="relative group/media">
                                                <LazyVideo src={msg.mediaUrl} />
                                                <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm z-10"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `VIDEO-${msg.keyId}.mp4`)}><Download className="h-4 w-4" /></Button>
                                            </div>
                                        )}
                                        {/* AUDIO */}
                                        {msg.type === 'AUDIO' && msg.mediaUrl && (
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <audio src={msg.mediaUrl} controls className="h-8 max-w-[200px]" preload="none" />
                                                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => handleDownload(msg.mediaUrl!, `AUDIO-${msg.keyId}.mp3`)}><Download className="h-3.5 w-3.5" /></Button>
                                            </div>
                                        )}
                                        {/* STICKER */}
                                        {msg.type === 'STICKER' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1">
                                                <img src={msg.mediaUrl} alt="Sticker" className="max-h-32 object-contain rounded-lg" loading="lazy" />
                                                <Button size="icon" variant="secondary" className="absolute -top-1 -right-1 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `STICKER-${msg.keyId}.webp`)}><Download className="h-3 w-3" /></Button>
                                            </div>
                                        )}
                                        {/* DOCUMENT */}
                                        {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && (
                                            <div className={cn("flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg mb-1", msg.fromMe ? "bg-white/15" : "bg-muted/50")}>
                                                <div className="flex items-center gap-2 truncate min-w-0">
                                                    <FileText className="h-3.5 w-3.5 shrink-0" />
                                                    <span className="text-xs font-medium truncate">{msg.type} Message</span>
                                                </div>
                                                {msg.mediaUrl && <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full shrink-0" onClick={() => handleDownload(msg.mediaUrl!, `${msg.type}-${msg.keyId}`)}><Download className="h-3.5 w-3.5" /></Button>}
                                            </div>
                                        )}
                                        {/* Interactive Response Badge */}
                                        {(msg.content?.includes("[Interactive Response]") || msg.content?.includes("[Button Response]") || msg.content?.includes("[List Response]") || msg.content?.includes("[Button Reply]")) && (
                                            <div className="mb-1">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                                                    msg.fromMe ? "bg-white/20 text-primary-foreground" : "bg-primary/10 text-primary border border-primary/20"
                                                )}>
                                                    <Sparkles className="h-2.5 w-2.5" /> {t("buttonClicked")}
                                                </span>
                                            </div>
                                        )}
                                        {messageFallback(msg) && <p className="max-w-sm py-1 text-xs italic opacity-80" role="note">{messageFallback(msg)}</p>}
                                        <div className="flex items-center justify-end gap-1">
                                            {(msg.reactions || []).map(reaction => <button type="button" key={reaction.sender} title={reaction.fromMe ? 'Sua reação — clique para remover' : 'Reação recebida'} onClick={() => { if (reaction.fromMe) reactTo(msg,''); }} className="rounded-full border bg-background/70 px-1.5 py-0.5 text-xs">{reaction.emoji}</button>)}
                                            <Popover><PopoverTrigger asChild><button type="button" aria-label="Reagir à mensagem" title="Reagir" className="rounded-full p-1 opacity-50 hover:opacity-100 focus:opacity-100"><Smile className="h-3.5 w-3.5"/></button></PopoverTrigger><PopoverContent className="w-auto p-2" side="top"><div className="flex gap-1">{['👍','❤️','😂','😮','😢','🙏','🔥','✅'].map(emoji => <button type="button" key={emoji} aria-label={`Reagir com ${emoji}`} onClick={()=>reactTo(msg,emoji)} className="rounded p-1.5 text-xl hover:bg-muted">{emoji}</button>)}</div>{msg.reactions?.some(r=>r.fromMe)&&<button type="button" onClick={()=>reactTo(msg,'')} className="mt-1 text-xs underline">Remover minha reação</button>}</PopoverContent></Popover>
                                        </div>
                                        {/* Text */}
                                        <div className="flex items-end gap-2">
                                            <span className="flex-1 text-sm break-words whitespace-pre-wrap">{messageLinkParts(formatMentions(msg.content, people)).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="underline underline-offset-2 hover:opacity-75">{part.text}</a> : <span key={index}>{part.text}</span>)}</span>
                                            <span className={cn("text-[9px] shrink-0 leading-none", msg.fromMe ? "text-primary-foreground/60" : "text-muted-foreground")}>
                                                {later.has(msg.keyId) && <Clock aria-label="Para ver depois" className="mr-0.5 inline h-2.5 w-2.5 align-[-1px]" />}{starred.has(msg.keyId) && <Star aria-label="Favoritada" className="mr-0.5 inline h-2.5 w-2.5 fill-current align-[-1px]" />}
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                {msg.fromMe && <span className="ml-1" title={msg.status === 'DELIVERED' ? 'Entregue ao destinatário' : msg.status === 'READ' ? 'Lida' : msg.status === 'SENT' ? 'Enviada ao servidor; entrega ainda não confirmada' : 'Envio pendente'}>{msg.status === 'DELIVERED' ? '✓✓' : msg.status === 'READ' ? '✓✓' : msg.status === 'SENT' ? '✓' : '○'}</span>}
                                            </span>
                                        </div>
                                    </div>
                                    {/* Reply button: other msg on right */}
                                    {!msg.fromMe && (
                                        <button onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                            className="self-center p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                                            title={t("reply")}>
                                            <CornerUpLeft className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* New message badge */}
            {newMsgBadge && (
                <button onClick={() => { scrollToBottom(true); setNewMsgBadge(false); }}
                    className="absolute bottom-[90px] right-6 z-20 flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-bounce">
                    <ArrowDown className="h-4 w-4" /> {t("newMessagesBadge")}
                </button>
            )}

            {/* Input */}
            <div className="shrink-0 px-3 py-2.5 bg-background/80 backdrop-blur-sm border-t">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 max-w-5xl w-full mx-auto">
                    <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"><Paperclip className="h-4.5 w-4.5" /></Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-1.5" side="top" align="start">
                            <div className="flex flex-col gap-0.5">
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('image')}><ImageIcon className="h-3.5 w-3.5 text-blue-500" /> {t("image")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('video')}><Video className="h-3.5 w-3.5 text-purple-500" /> {t("video")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('audio')}><Music className="h-3.5 w-3.5 text-orange-500" /> {t("audio")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('document')}><FileText className="h-3.5 w-3.5 text-emerald-500" /> {t("document")}</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => setSharingContact(true)}><Contact className="h-3.5 w-3.5 text-sky-500" /> Contato</Button>
                                <div className="my-1 border-t border-border/30" />
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 hover:bg-amber-500/10 font-medium" onClick={() => setInteractiveDialogOpen(true)}>
                                    <Sparkles className="h-3.5 w-3.5 text-amber-500" /> {t("interactiveAndTest")}
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full shrink-0 text-amber-500/80 hover:text-amber-500 hover:bg-amber-500/10"
                        title={t("interactiveTitle")}
                        onClick={() => setInteractiveDialogOpen(true)}
                    >
                        <Sparkles className="h-4.5 w-4.5" />
                    </Button>

                    <EmojiPicker onSelect={emoji=>{const el=inputRef.current;const start=el?.selectionStart ?? input.length;const end=el?.selectionEnd ?? start;setInput(value=>value.slice(0,start)+emoji+value.slice(end));requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+emoji.length,start+emoji.length)})}} />
                    <VoiceRecorder onSend={file=>processFileUpload(file,"voice")} />
                    <StickerPicker key={`${sessionId}:${jid}`} sessionId={sessionId} jid={jid} onSent={() => { setAutoScroll(true); fetchMessages(); }} />
                    <div className="order-first w-full sm:order-none sm:w-auto sm:flex-1 min-w-0">
                        {/* Reply preview bar */}
                        {replyingTo && (
                            <div className="mb-2 flex items-start gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border-l-2 border-amber-500 text-xs animate-in slide-in-from-bottom-1 overflow-hidden">
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <span className="font-semibold text-amber-500 block text-[10px]">{t("replyingTo", { name: replyingTo.fromMe ? t("you") : messageSenderName(replyingTo, people) })}</span>
                                    <span className="text-muted-foreground truncate block w-full">{replyingTo.content || `[${replyingTo.type}]`}</span>
                                </div>
                                <button onClick={() => setReplyingTo(null)} className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                        )}
                        <div className="relative flex items-end gap-2 p-1 rounded-2xl border border-border/30 bg-background">
                            {mentionMatch && <div role="listbox" aria-label="Participantes para mencionar" className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-64 overflow-auto rounded-xl border bg-popover p-1 shadow-xl">
                                {suggestions.length ? suggestions.map((person,index) => <button type="button" role="option" aria-selected={index === mentionIndex} key={person.jid} onMouseDown={e => e.preventDefault()} onClick={() => chooseMention(person)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${index === mentionIndex ? 'bg-muted' : 'hover:bg-muted/60'}`}><span className="font-medium">@{person.name}</span></button>) : <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum participante encontrado.</p>}
                            </div>}
                            <textarea ref={inputRef} value={input} onChange={(e) => { setInput(e.target.value); setMentionCursor(e.target.selectionStart); setMentionDismissed(false); setMentionIndex(0); const el = e.target; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }}
                                onClick={e => { setMentionCursor(e.currentTarget.selectionStart); setMentionDismissed(false); }}
                                onKeyDown={e => {
                                    if (mentionMatch) {
                                        if (e.key === 'Escape') { e.preventDefault(); setMentionDismissed(true); return; }
                                        if (suggestions.length && ['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)) {
                                            e.preventDefault();
                                            if (e.key === 'ArrowDown') setMentionIndex(i => (i+1)%suggestions.length);
                                            else if (e.key === 'ArrowUp') setMentionIndex(i => (i+suggestions.length-1)%suggestions.length);
                                            else chooseMention(suggestions[mentionIndex] || suggestions[0]);
                                            return;
                                        }
                                    }
                                    handleKeyDown(e);
                                }} placeholder={t("typePlaceholder")} rows={1} style={{ minHeight: "36px", maxHeight: "120px" }}
                                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none leading-normal" />
                        </div>
                    </div>

                    <Button onClick={handleSend} disabled={!input.trim() || sending} aria-label={sending ? "Enviando mensagem" : "Enviar mensagem"} size="icon" className="h-9 w-9 rounded-full shrink-0"><Send className="h-4 w-4" /></Button>
                </div>
            </div>

            {/* Interactive Message & Test Trigger Dialog */}
            <InteractiveMessageDialog
                open={interactiveDialogOpen}
                onOpenChange={setInteractiveDialogOpen}
                sessionId={sessionId}
                jid={jid}
                recipientName={displayName}
                onSuccess={() => {
                    fetchMessages();
                }}
            />
        </div>
    );
}
