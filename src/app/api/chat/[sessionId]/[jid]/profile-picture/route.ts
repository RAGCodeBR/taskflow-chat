import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { safeFetchBuffer } from "@/lib/security";
import { mkdir, writeFile, stat } from "fs/promises";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

const pending = new Map<string, Promise<string | null>>();
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string; jid: string }> }) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        const { sessionId, jid } = await params;
        if (!await canAccessSession(user.id, user.role, sessionId)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
        const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!session) return NextResponse.json({ message: "Session not found" }, { status: 404 });
        const filename = `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '')}-avatar${crypto.createHash('sha256').update(jid).digest('hex').slice(0,24)}.jpg`;
        const file = path.join(process.cwd(), 'data', 'media', filename);
        const localUrl = `/api/media/${filename}`;
        const cached = await stat(file).catch(() => null);
        if (cached && Date.now() - cached.mtimeMs < 24 * 3600_000) return NextResponse.json({ success: true, profilePicUrl: localUrl });
        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket || instance.status !== 'CONNECTED') return NextResponse.json({ success: true, profilePicUrl: cached ? localUrl : null });
        const key = `${sessionId}:${jid}`;
        if (!pending.has(key)) pending.set(key, (async () => {
            try {
                const remote = await instance.socket!.profilePictureUrl(jid, 'image', 5000);
                if (!remote) return null;
                const { buffer } = await safeFetchBuffer(remote, { allowedHostnames: ['whatsapp.net', 'fbcdn.net'], maxBytes: 3 * 1024 * 1024, timeoutMs: 5000 });
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, await sharp(buffer).rotate().resize(160, 160, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer());
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: session.id, jid } },
                    create: { sessionId: session.id, jid, profilePic: localUrl }, update: { profilePic: localUrl },
                });
                return localUrl;
            } catch { return cached ? localUrl : null; }
            finally { pending.delete(key); }
        })());
        return NextResponse.json({ success: true, profilePicUrl: await pending.get(key) });
    } catch (error) {
        console.error('Profile photo cache failed', error);
        return NextResponse.json({ message: 'Não foi possível carregar a foto' }, { status: 500 });
    }
}
