// One retry at a time, with a bounded delay but no limit on temporary failures.
export class ReconnectLoop {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private stopped = false;
    private attempt = 0;
    private requested = false;
    constructor(private retry: () => Promise<void>, private onError: (error: unknown) => void = () => {}) {}
    schedule() {
        if (this.stopped) return;
        if (this.running) { this.requested = true; return; }
        if (this.timer) return;
        const delay = Math.min(30_000, 3_000 * 2 ** Math.min(this.attempt++, 4));
        this.timer = setTimeout(() => { this.timer = null; void this.run(); }, delay);
        this.timer.unref?.();
    }
    private async run() {
        if (this.stopped || this.running) return;
        this.running = true;
        let failed = false;
        try { await this.retry(); } catch (error) { failed = true; this.onError(error); }
        finally { this.running = false; }
        if (failed || this.requested) { this.requested = false; this.schedule(); }
    }
    resume() {
        if (this.stopped) return;
        this.cancelTimer();
        void this.run();
    }
    reset() { this.cancelTimer(); this.attempt = 0; this.requested = false; }
    stop() { this.stopped = true; this.requested = false; this.cancelTimer(); }
    private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
