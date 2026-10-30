// Archived conversations: hidden from the Kanban and the list until unarchived.

/** Archived jids in the canonical form the chat list uses (LID and phone jids collapse to one). */
export function archivedSet(jids: string[], canonical: (jid: string) => string) {
    return new Set(jids.map(jid => canonical(jid)));
}

/** Archive/unarchive done on the phone arrives as chats.update; keep only those changes. */
export function archiveChanges(updates: { id?: string | null; archived?: boolean | null }[]) {
    return updates.flatMap(update => update.id && typeof update.archived === "boolean" ? [{ jid: update.id, archived: update.archived }] : []);
}
