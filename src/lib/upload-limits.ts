// Keep the multipart request below the 100 MB cap of common reverse proxies.
// WhatsApp supports larger documents, but this gateway currently relays each
// upload in one request and reads it into memory before sending.
export const MAX_CHAT_UPLOAD_MB = 90;
export const MAX_CHAT_UPLOAD_BYTES = MAX_CHAT_UPLOAD_MB * 1024 * 1024;
