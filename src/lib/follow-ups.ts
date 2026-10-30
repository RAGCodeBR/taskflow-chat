// "Ver depois" messages and conversation reminders: the owner's own pending list in the chat panel.
export const REMINDER_MAX = 200;
export const PENDING_CHANGED_EVENT = "wa:pending-changed";

export type FollowUpView = { keyId: string; remoteJid: string; chatName: string; senderName: string; content: string | null; type: string; fromMe: boolean; timestamp: string; markedAt: string };
export type ReminderView = { chatJid: string; chatName: string; note: string; updatedAt: string };

// Trimmed, single spaces kept as typed, at most REMINDER_MAX characters; null when empty or invalid.
export function reminderNote(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const note = value.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return note && note.length <= REMINDER_MAX ? note : null;
}

// Reminders keyed by conversation, matching any identity (phone jid or LID) the board shows.
export function remindersByChat(reminders: ReminderView[], canonical: (jid: string) => string): Map<string, ReminderView> {
    return new Map(reminders.map(reminder => [canonical(reminder.chatJid), reminder]));
}
