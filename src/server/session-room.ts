interface SessionSocket {
    data: { sessionRoomRequest?: number; activeSessionRoom?: string; [key: string]: any };
    connected: boolean;
    join(room: string): void | Promise<void>;
    leave(room: string): void | Promise<void>;
}
// A tab displays one account at a time. A slower authorization for an older
// selection must never rejoin that account after a newer selection completes.
export async function selectSessionRoom(socket: SessionSocket, sessionId: string, authorize: () => Promise<boolean>) {
    const request = (socket.data.sessionRoomRequest || 0) + 1;
    socket.data.sessionRoomRequest = request;
    if (!await authorize()) return 'forbidden';
    if (!socket.connected || socket.data.sessionRoomRequest !== request) return 'superseded';
    const previous = socket.data.activeSessionRoom;
    if (previous && previous !== sessionId) await socket.leave(previous);
    if (!socket.connected || socket.data.sessionRoomRequest !== request) return 'superseded';
    await socket.join(sessionId);
    socket.data.activeSessionRoom = sessionId;
    return 'joined';
}
