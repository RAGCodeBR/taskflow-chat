import Image from "next/image";

export function TaskChatLogo({ className = "h-10 w-10" }: { className?: string }) {
    return <Image src="/taskchat-logo.svg" alt="TaskChat" width={64} height={64} className={className} unoptimized />;
}
