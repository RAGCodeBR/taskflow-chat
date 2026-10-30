import { normalizeMessageContent as normalizeBaileysContent } from "@whiskeysockets/baileys";

// Baileys does not currently unwrap the FutureProof lottie sticker envelope.
// Keep its standard normalization and explicitly unwrap that envelope as well.
export function normalizeChatContent(content: Parameters<typeof normalizeBaileysContent>[0]): ReturnType<typeof normalizeBaileysContent> {
    let current = content;
    for (let i = 0; i < 5; i++) {
        const normalized = normalizeBaileysContent(current);
        const stickerContent = normalized?.lottieStickerMessage?.message;
        if (!stickerContent) return normalized;
        current = stickerContent;
    }
    return normalizeBaileysContent(current);
}
