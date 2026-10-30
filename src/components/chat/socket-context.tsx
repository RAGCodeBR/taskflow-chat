"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

type SocketContextValue = {
    getSocket: () => Socket | null;
    joinSession: (sessionId: string) => void;
};

const SocketContext = createContext<SocketContextValue>({
    getSocket: () => null,
    joinSession: () => {},
});

export function useSocket() {
    return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
    const socketRef = useRef<Socket | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const socket = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelayMax: 10_000,
        });

        socket.on("connect", () => {
            setReady(true);
            socket.emit("resume-connections");
        });

        socket.on("disconnect", () => {
            setReady(false);
        });

        const resume = () => {
            if (navigator.onLine === false) return;
            if (!socket.connected) socket.connect();
            else socket.emit("resume-connections");
        };
        window.addEventListener("online",resume);
        window.addEventListener("focus",resume);
        socketRef.current = socket;

        return () => {
            window.removeEventListener("online",resume);
            window.removeEventListener("focus",resume);
            socket.disconnect();
            socketRef.current = null;
        };
    }, []);

    const getSocket = useCallback(() => socketRef.current, [ready]);

    const joinSession = useCallback((sessionId: string) => {
        const s = socketRef.current;
        if (s?.connected) {
            s.emit("join-session", sessionId);
        }
    }, []);

    return (
        <SocketContext.Provider value={{ getSocket, joinSession }}>
            {children}
        </SocketContext.Provider>
    );
}
