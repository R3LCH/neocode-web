import type {
  BridgePush,
  JsonRpcRequest,
  JsonRpcResponse,
  PairResult,
} from "@protocol/schema";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export type BridgeEventHandler = (event: string, data: unknown) => void;

// Reserved local event emitted to handlers when the session is gone for good
// (host revoked it, or it expired) so the UI can return to the pairing screen.
export const SESSION_LOST_EVENT = "session.lost";
const STORAGE_KEY = "claw-remote.session";

type StoredSession = {
  sessionId: string;
  host: string;
  port: number;
  bridgeWss?: string;
};

export class BridgeClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string | number, Pending>();
  private reqId = 0;
  private handlers = new Set<BridgeEventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  // The socket a `resume` last succeeded on: RPCs on any other socket must
  // re-resume first, or the server rejects them as unauthenticated.
  private resumedOn: WebSocket | null = null;
  sessionId: string | null = null;
  pairResult: PairResult | null = null;

  constructor(
    private host: string,
    private port: number,
    private bridgeWss?: string,
  ) {}

  // Rebuild a client from a previously paired session so a page reload/relaunch
  // can `resume` instead of forcing a re-scan. Returns null if nothing stored.
  static restore(): BridgeClient | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as StoredSession;
      if (!s.sessionId) return null;
      const client = new BridgeClient(s.host ?? "", s.port ?? 0, s.bridgeWss || undefined);
      client.sessionId = s.sessionId;
      return client;
    } catch {
      return null;
    }
  }

  private persist() {
    if (!this.sessionId) return;
    try {
      const data: StoredSession = {
        sessionId: this.sessionId,
        host: this.host,
        port: this.port,
        bridgeWss: this.bridgeWss,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode) — session just won't survive reload */
    }
  }

  private clearStored() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // The session is unrecoverable: drop it, stop reconnecting, wipe storage and
  // tell the UI to show pairing again.
  private handleSessionLost() {
    this.sessionId = null;
    this.pairResult = null;
    this.clearStored();
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.resumedOn = null;
    this.emit(SESSION_LOST_EVENT, null);
  }

  // App-level keepalive: browsers can't send WS ping frames, and idle sockets
  // get closed by phone radios / tunnel proxies after a minute or two. A tiny
  // RPC every 25s keeps the link warm; if it fails, `call` already falls into
  // the reconnect+resume path.
  private startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.sessionId && this.ws?.readyState === WebSocket.OPEN) {
        this.call("ping").catch(() => undefined);
      }
    }, 25_000);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  get url() {
    if (this.bridgeWss) {
      const base = this.bridgeWss.replace(/\/$/, "");
      return base.endsWith("/ws") ? base : `${base}/ws`;
    }
    return `ws://${this.host}:${this.port}/ws`;
  }

  setBridgeWss(wss?: string) {
    this.bridgeWss = wss;
  }

  on(handler: BridgeEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(event: string, data: unknown) {
    for (const h of this.handlers) h(event, data);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        resolve();
      };
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        if (this.resumedOn === ws) this.resumedOn = null;
        if (this.sessionId) {
          this.reconnectTimer = setTimeout(() => {
            // Re-bind to the existing session after reconnecting. Only an
            // explicit server rejection of `resume` means the session is gone
            // (revoked/expired); a network failure keeps the session and the
            // next close/`call` retries, so a spotty link never forces a
            // re-scan of the QR code.
            this.connect()
              .then(() =>
                this.resume().catch(() => this.handleSessionLost()),
              )
              .catch(() => {
                /* still offline — onclose of the failed socket reschedules */
              });
          }, 2000);
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as JsonRpcResponse | BridgePush;
          if ("event" in msg && msg.event) {
            // Host explicitly disconnected us: drop the session and go to pairing
            // before the socket close can trigger a (doomed) resume.
            if (msg.event === "session.revoked") {
              this.handleSessionLost();
              return;
            }
            this.emit(msg.event, msg.data);
            return;
          }
          const res = msg as JsonRpcResponse;
          const p = this.pending.get(res.id);
          if (!p) return;
          this.pending.delete(res.id);
          if (res.error) p.reject(new Error(res.error.message));
          else p.resolve(res.result);
        } catch {
          /* ignore malformed */
        }
      };
    });
  }

  disconnect() {
    this.sessionId = null;
    this.pairResult = null;
    this.clearStored();
    this.stopKeepalive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.resumedOn = null;
  }

  private rawCall<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.reqId;
    const req: JsonRpcRequest = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws!.send(JSON.stringify(req));
    });
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    // A freshly (re)connected socket is unauthenticated: resume the session
    // first or the server rejects the call and the UI misreads it as fatal.
    if (
      this.sessionId &&
      this.ws &&
      this.resumedOn !== this.ws &&
      method !== "pair" &&
      method !== "resume"
    ) {
      await this.resume();
    }
    return this.rawCall<T>(method, params);
  }

  async pair(token: string): Promise<PairResult> {
    const result = (await this.call("pair", { token })) as PairResult;
    this.sessionId = result.session_id;
    this.pairResult = result;
    this.resumedOn = this.ws;
    if (result.bridge_wss) {
      this.setBridgeWss(result.bridge_wss);
    }
    this.persist();
    this.startKeepalive();
    return result;
  }

  // Re-authenticate a reconnected socket to the existing session (no re-pair).
  async resume(): Promise<void> {
    if (!this.sessionId) return;
    const ws = this.ws;
    await this.rawCall("resume", { session_id: this.sessionId });
    this.resumedOn = ws;
    this.startKeepalive();
  }
}
