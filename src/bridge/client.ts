import WebApp from "@twa-dev/sdk";
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

/** The server refused the session itself (revoked/expired) — as opposed to a
 *  transport failure, which must never cost the user their pairing. */
export function isSessionRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid or expired session|not paired/i.test(msg);
}

// Telegram wipes/partitions webview localStorage aggressively (especially when
// the mini-app tab is closed), which silently dropped paired sessions and
// forced a re-scan. CloudStorage is tied to the bot+user and survives, so
// persist there too and read it back as the fallback.
function cloudGet(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // CloudStorage callbacks never fire outside Telegram — don't hang restore.
    setTimeout(() => finish(null), 1500);
    try {
      WebApp.CloudStorage.getItem(key, (err, value) =>
        finish(err ? null : (value ?? null)),
      );
    } catch {
      finish(null);
    }
  });
}

function cloudSet(key: string, value: string) {
  try {
    WebApp.CloudStorage.setItem(key, value, () => undefined);
  } catch {
    /* not in Telegram */
  }
}

function cloudRemove(key: string) {
  try {
    WebApp.CloudStorage.removeItem(key, () => undefined);
  } catch {
    /* not in Telegram */
  }
}

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
  // can `resume` instead of forcing a re-scan. Checks localStorage first, then
  // Telegram CloudStorage (which survives the mini-app tab being closed even
  // when the webview's localStorage doesn't). Returns null if nothing stored.
  static async restore(): Promise<BridgeClient | null> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    if (!raw) raw = await cloudGet(STORAGE_KEY);
    if (!raw) return null;
    try {
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
    const data: StoredSession = {
      sessionId: this.sessionId,
      host: this.host,
      port: this.port,
      bridgeWss: this.bridgeWss,
    };
    const raw = JSON.stringify(data);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      /* storage unavailable (private mode) — CloudStorage below still covers us */
    }
    cloudSet(STORAGE_KEY, raw);
  }

  private clearStored() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    cloudRemove(STORAGE_KEY);
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
        // Reject in-flight RPCs: their responses can never arrive on this
        // socket, and leaving them pending hangs resume()/call() forever.
        const closeErr = new Error("connection closed");
        for (const p of this.pending.values()) p.reject(closeErr);
        this.pending.clear();
        if (this.sessionId) this.scheduleReconnect();
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

  // Re-bind to the existing session after reconnecting. Only an explicit
  // server rejection of `resume` means the session is gone (revoked/expired);
  // any transport failure keeps the session and retries, so a spotty link or
  // a briefly-down IDE never forces a re-scan of the QR code.
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect()
        .then(() =>
          this.resume().catch((err) => {
            if (isSessionRejected(err)) this.handleSessionLost();
            else this.scheduleReconnect();
          }),
        )
        .catch(() => {
          /* still offline — onclose of the failed socket reschedules */
        });
    }, 2000);
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
