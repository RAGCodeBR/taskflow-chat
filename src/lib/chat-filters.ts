export type ChatKind = "all" | "private" | "groups";
export interface ChatFilters {
    labelId: string;
    columnId: string;
    kind: ChatKind;
    search: string;
    pinned: boolean;
}
export const DEFAULT_CHAT_FILTERS: ChatFilters = { labelId: "", columnId: "", kind: "all", search: "", pinned: false };
export const chatFiltersKey = (sessionId: string) => `chat-filters:${sessionId}`;
export function readChatFilters(raw: string | null): ChatFilters {
    try {
        const value = JSON.parse(raw || "null");
        if (!value || value.pinned !== true) return { ...DEFAULT_CHAT_FILTERS };
        return {
            pinned: true,
            labelId: typeof value.labelId === "string" ? value.labelId : "",
            columnId: typeof value.columnId === "string" ? value.columnId : "",
            search: typeof value.search === "string" ? value.search : "",
            kind: value.kind === "groups" || value.kind === "private" ? value.kind : "all",
        };
    } catch { return { ...DEFAULT_CHAT_FILTERS }; }
}
