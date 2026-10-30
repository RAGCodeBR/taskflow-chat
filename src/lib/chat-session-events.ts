export interface ChatSessionSource { sessionId: string }
// Fail closed: an event without an account cannot be shown in an account's chat.
export function isChatSessionEvent(activeSessionId: string, source: unknown): source is ChatSessionSource {
    return !!source && typeof source === 'object' && 'sessionId' in source && source.sessionId === activeSessionId;
}
