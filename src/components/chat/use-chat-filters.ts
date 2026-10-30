"use client";
import { useEffect, useState } from "react";
import { chatFiltersKey, DEFAULT_CHAT_FILTERS, readChatFilters, type ChatFilters } from "@/lib/chat-filters";

export function useChatFilters(sessionId: string) {
    const [state, setState] = useState<{ sessionId: string; ready: boolean; filters: ChatFilters }>({ sessionId, ready: false, filters: { ...DEFAULT_CHAT_FILTERS } });
    const filters = state.sessionId === sessionId ? state.filters : DEFAULT_CHAT_FILTERS;
    useEffect(() => {
        let filters = { ...DEFAULT_CHAT_FILTERS };
        try { filters = readChatFilters(localStorage.getItem(chatFiltersKey(sessionId))); } catch {}
        setState({ sessionId, ready: true, filters });
    }, [sessionId]);
    useEffect(() => {
        if (!state.ready || state.sessionId !== sessionId) return;
        try {
            if (state.filters.pinned) localStorage.setItem(chatFiltersKey(sessionId), JSON.stringify(state.filters));
            else localStorage.removeItem(chatFiltersKey(sessionId));
        } catch {}
    }, [sessionId, state]);
    const updateFilters = (patch: Partial<ChatFilters>) => setState(current => ({
        sessionId, ready: true,
        filters: { ...(current.sessionId === sessionId ? current.filters : DEFAULT_CHAT_FILTERS), ...patch },
    }));
    return { filters, updateFilters };
}
