import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { MAX_CHAT_UPLOAD_BYTES, MAX_CHAT_UPLOAD_MB } from "@/lib/upload-limits";
import { waManager } from "@/modules/whatsapp/manager";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { prepareChatVideo } from "@/lib/chat-video";

// Multipart route avoids the 1 MB Server Action limit and changing action IDs.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ message: "Entre novamente para enviar arquivos." }, { status: 401 });
        if (!await canAccessSession(user.id, user.role, sessionId)) return NextResponse.json({ message: "Sem acesso a esta sessão." }, { status: 403 });
        const tooLarge = () => NextResponse.json({ message: `O arquivo deve ter no máximo ${MAX_CHAT_UPLOAD_MB} MB.` }, { status: 413 });
        if (Number(request.headers.get("content-length") || 0) > MAX_CHAT_UPLOAD_BYTES + 1024 * 1024) return tooLarge();
        let form: FormData;
        try { form = await request.formData(); }
        catch { return NextResponse.json({ message: "Não foi possível ler o anexo. Selecione o arquivo novamente." }, { status: 400 }); }
        const file = form.get("file"), jid = form.get("jid"), type = form.get("type"), caption = form.get("caption");
        if (!(file instanceof File) || !file.size || typeof jid !== "string" || !/^[-\d]+@(s\.whatsapp\.net|lid|g\.us|newsletter)$/.test(jid) || typeof type !== "string" || !["image", "video", "audio", "voice", "document", "sticker"].includes(type)) {
            return NextResponse.json({ message: "Selecione um arquivo válido e uma conversa para enviar." }, { status: 400 });
        }
        if (file.size > MAX_CHAT_UPLOAD_BYTES) return tooLarge();
        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket || instance.status !== "CONNECTED") return NextResponse.json({ message: "WhatsApp desconectado. Aguarde a conexão e tente novamente." }, { status: 409 });
        const original = Buffer.from(await file.arrayBuffer());
        let media: { buffer: Buffer; mimeType: string; fileName: string } = {
            buffer: original, mimeType: file.type || "application/octet-stream", fileName: file.name,
        };
        if (type === "video") {
            try {
                media = await prepareChatVideo(original, file.type, file.name);
            } catch (error) {
                console.error("Could not prepare chat video", error);
                return NextResponse.json({ message: "Não foi possível preparar este vídeo MOV. Converta para MP4 ou envie como documento." }, { status: 422 });
            }
        }
        if (media.buffer.length > MAX_CHAT_UPLOAD_BYTES) return tooLarge();
        const result = await ChatService.sendMediaMessage(sessionId, jid, media.buffer, type, media.mimeType, media.fileName, typeof caption === "string" ? caption : "");
        return NextResponse.json({ success: true, message: result.localMessage });
    } catch (error) {
        console.error("Chat attachment send failed", error);
        return NextResponse.json({ message: "Não foi possível confirmar o envio. Confira a conversa no WhatsApp antes de tentar novamente." }, { status: 502 });
    }
}
