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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.emit(SESSION_LOST_EVENT, null);
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
        this.ws = null;
        if (this.sessionId) {
          this.reconnectTimer = setTimeout(() => {
            // Re-bind to the existing session after reconnecting; the server now
            // requires an authenticated session for every non-pair call. If the
            // resume is rejected the session is gone (revoked/expired) — return
            // to pairing instead of looping forever.
            this.connect()
              .then(() => this.resume())
              .catch(() => this.handleSessionLost());
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
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

  async pair(token: string): Promise<PairResult> {
    const result = (await this.call("pair", { token })) as PairResult;
    this.sessionId = result.session_id;
    this.pairResult = result;
    if (result.bridge_wss) {
      this.setBridgeWss(result.bridge_wss);
    }
    this.persist();
    return result;
  }

  // Re-authenticate a reconnected socket to the existing session (no re-pair).
  async resume(): Promise<void> {
    if (!this.sessionId) return;
    await this.call("resume", { session_id: this.sessionId });
  }
}
