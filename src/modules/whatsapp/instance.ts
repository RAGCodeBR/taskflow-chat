import makeWASocket, {
    DisconnectReason,
    DEFAULT_CONNECTION_CONFIG,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { bindPpGuard } from "./store/ppguard";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";
import { isInteractiveContent, handleInteractiveMessageDispatch } from "./interactive";

import { ReconnectLoop } from "./reconnect";
let versionPromise: Promise<{version:typeof DEFAULT_CONNECTION_CONFIG.version}> | null = null;
function connectionVersion() {
    if (!versionPromise) versionPromise = new Promise(resolve => {
        const timer = setTimeout(()=>resolve({version:DEFAULT_CONNECTION_CONFIG.version}),8_000);
        fetchLatestBaileysVersion().then(result=>{clearTimeout(timer);resolve(result)},()=>{clearTimeout(timer);resolve({version:DEFAULT_CONNECTION_CONFIG.version})});
    });
    return versionPromise;
}

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    private initializing: Promise<void> | null = null;
    private generation = 0;
    private reconnect = new ReconnectLoop(() => this.connectOnce(), error => {
        logger.warn("Instance", `Session ${this.sessionId} still offline; retrying automatically.`, error instanceof Error ? error.message : error);
    });
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    async init() {
        if (this.isStopped) return;
        try { await this.connectOnce(); }
        catch (error) {
            if (this.isStopped) return;
            this.status = "DISCONNECTED";
            this.io?.to(this.sessionId).emit("connection.update",{status:"DISCONNECTED",qr:null,reconnecting:true});
            await prisma.session.update({where:{sessionId:this.sessionId},data:{status:"DISCONNECTED",qr:null}}).catch(()=>{});
            logger.warn("Instance", `Session ${this.sessionId} initialization failed; retrying automatically.`, error instanceof Error ? error.message : error);
            this.reconnect.schedule();
        }
    }

    resumeConnection() {
        if (!this.isStopped && this.status === "DISCONNECTED") this.reconnect.resume();
    }

    private connectOnce(): Promise<void> {
        if (this.isStopped || (this.socket && (this.status === "CONNECTED" || this.socket.ws.isConnecting || this.socket.ws.isOpen))) return Promise.resolve();
        if (!this.initializing) {
            this.initializing = this.createSocket(++this.generation).finally(()=>{this.initializing=null;});
        }
        return this.initializing;
    }

    private async createSocket(generation: number) {
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            include: { botConfig: true }
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            this.isStopped = true; this.reconnect.stop(); this.onRemovedFromManager?.();
            return;
        }
        this.config = sessionData?.config || {};
        const botConfig = (sessionData as any)?.botConfig;

        const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
        const { version } = await connectionVersion();
        if (this.isStopped || generation !== this.generation) return;
        const previous = this.socket;
        this.socket = null;
        previous?.ev.removeAllListeners("connection.update");
        previous?.end(undefined);

        this.socket = makeWASocket({
            version,
            logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            syncFullHistory: true,
        });

        // Attach Lekzo Baileys compatible helper methods
        const currentSocket = this.socket as any;
        currentSocket.newsletterId = async (url: string) => {
            const cleanUrl = url.trim();
            const inviteCode = cleanUrl.includes("/") ? cleanUrl.split("/").filter(Boolean).pop()! : cleanUrl;
            const meta = await currentSocket.newsletterMetadata("invite", inviteCode);
            return meta?.id || null;
        };
        currentSocket.checkWhatsApp = async (target: string) => {
            return await currentSocket.onWhatsApp(target);
        };

        // Apply Anti-Spam & Interactive Message Wrapper to sendMessage
        const originalSendMessage = this.socket.sendMessage.bind(this.socket);
        const sessionId = this.sessionId;
        const sock = this.socket;
        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {
            await antispam.enqueue(sessionId, jid, content);
            if (isInteractiveContent(content)) {
                const interactiveMsg = await handleInteractiveMessageDispatch(sock, jid, content, options);
                if (interactiveMsg) {
                    return interactiveMsg;
                }
            }
            return originalSendMessage(jid, content, options);
        } as any;

        // Bind Store for DB Sync
        bindSessionStore(this.socket, this.sessionId, this.io);

        // Bind Contact Sync
        bindContactSync(this.socket, this.sessionId);

        this.socket.ev.on("creds.update", saveCreds);

        this.socket.ev.on("connection.update", async (update) => {
            if (this.socket !== sock || generation !== this.generation || this.isStopped) return;
            await this.handleConnectionUpdate(update);
        });
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>) {
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                // Reset reconnect count on new QR (user is re-scanning)
                this.reconnect.reset();
                this.qr = qr;
                this.status = "SCAN_QR";

                this.io?.to(this.sessionId).emit("connection.update", { status: this.status, qr });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const code = (lastDisconnect?.error as any)?.output?.statusCode;
                const isLoggedOut = code === DisconnectReason.loggedOut;

                if (isLoggedOut) {
                    // Logged out: stop permanently, remove from memory
                    this.isStopped = true; this.generation++; this.reconnect.stop();
                    this.status = "LOGGED_OUT";
                    this.socket = null;
                    this.config = {};
                    this.io?.to(this.sessionId).emit("connection.update", { status: "LOGGED_OUT", qr: null });

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId }
                            })
                        ]);
                    } catch (e) { /* ignore */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Explicitly stopped: preserve creds for restart
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnect.reset();
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    const { waManager } = require("./manager");
                    waManager.removeInstance(this.sessionId);
                    return;
                }

                this.socket = null;
                if (code === DisconnectReason.connectionReplaced) {
                    // A competing connection must not trigger an endless reconnect fight.
                    this.isStopped = true; this.generation++; this.reconnect.stop();
                    this.status = "STOPPED";
                    await prisma.session.update({where:{sessionId:this.sessionId},data:{status:"STOPPED",qr:null}}).catch(()=>{});
                    this.io?.to(this.sessionId).emit("connection.update",{status:"STOPPED",qr:null});
                    this.onRemovedFromManager?.();
                    return;
                }
                this.status = "DISCONNECTED";
                this.qr = null;
                this.io?.to(this.sessionId).emit("connection.update", { status: "DISCONNECTED", qr: null, reconnecting: true });
                await prisma.session.update({where:{sessionId:this.sessionId},data:{status:"DISCONNECTED",qr:null}}).catch(()=>{});
                logger.warn("Instance", `Session ${this.sessionId} disconnected; automatic reconnect remains active.`);
                this.reconnect.schedule();
            }

            if (connection === "open") {
                const connectedSocket = this.socket;
                if (!connectedSocket || this.isStopped) return;
                // Connected — reset reconnect count
                this.reconnect.reset();
                this.isStopped = false;
                this.status = "CONNECTED";
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", { status: "CONNECTED", qr: null });

                try {
                    await syncGroups(connectedSocket, this.sessionId);
                } catch (e) {
                    logger.error("Instance", "Group sync failed:", e);
                }

                if (this.isStopped || this.socket !== connectedSocket || this.status !== "CONNECTED") return;
                bindAutoReply(connectedSocket, this.sessionId);
                bindPpGuard(connectedSocket, this.sessionId);

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null }
                });

                logger.success("Instance", `Session ${this.sessionId} connected and synced successfully`);
            }
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.isStopped = true; this.generation++; this.reconnect.stop();
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.io?.to(this.sessionId).emit("connection.update", {
                status: this.status,
                qr: this.qr,
                pairingCode: code
            });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        this.generation++; this.reconnect.stop();
        const socket = this.socket; this.socket = null;
        socket?.end(undefined);
    }
}
