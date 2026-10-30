import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  distDir: process.env.WA_NEXT_DIST || ".next",
  serverExternalPackages: [
    "sharp",
    "ffmpeg-static",
    "bcryptjs",
    "@whiskeysockets/baileys",
    "whatsapp-rust-bridge",
    "jimp",
    "pino",
    "qrcode-terminal",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withNextIntl(nextConfig);
