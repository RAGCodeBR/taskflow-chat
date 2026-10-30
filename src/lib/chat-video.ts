import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const run = promisify(execFile);

/** QuickTime screen recordings are often 1080p/60fps. Prepare a smaller,
 * broadly playable copy for WhatsApp while leaving the uploaded file alone. */
export async function prepareChatVideo(buffer: Buffer, mimeType: string, fileName: string) {
    if (mimeType !== "video/quicktime" && !/\.mov$/i.test(fileName)) {
        return { buffer, mimeType, fileName };
    }
    if (!ffmpeg) throw new Error("Conversor de vídeo indisponível.");

    const directory = await mkdtemp(path.join(tmpdir(), "taskflow-chat-video-"));
    const input = path.join(directory, "original.mov");
    const output = path.join(directory, "enviar.mp4");
    try {
        await writeFile(input, buffer);
        await run(ffmpeg, [
            "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", input,
            "-map", "0:v:0", "-map", "0:a?",
            "-vf", "scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart", "-map_metadata", "-1", output,
        ], { timeout: 240_000, maxBuffer: 1024 * 1024 });
        return {
            buffer: await readFile(output),
            mimeType: "video/mp4",
            fileName: fileName.replace(/\.mov$/i, "") + ".mp4",
        };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
