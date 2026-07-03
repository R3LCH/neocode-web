/** Canonical WebSocket protocol — mirror of src/remote_bridge/protocol.rs */

export type JsonRpcRequest = {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

export type BridgePush = {
  event: string;
  data: unknown;
};

export type PairParams = { token: string };
export type PairResult = {
  session_id: string;
  bridge_wss?: string;
  vnc_ws_url: string;
  vnc_password: string;
};

export type ApprovalSnapshot = {
  id: string;
  server_name: string;
  tool_name: string;
  arguments: string;
};

export type DesignElement = {
  tag: string;
  selector: string;
  html: string;
};

export type ChatSendParams = {
  query: string;
  mode?: "plan" | "edit" | "agent";
  thread_id?: string;
};

export type EditorKeyParams = { keys: string };
export type EditorResizeParams = { width: number; height: number };

export type GridCell = { text: string; hl_id: number };
export type GridHighlight = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
};
export type EditorGridEvent = {
  width: number;
  height: number;
  cells: GridCell[];
  cursor_row: number;
  cursor_col: number;
  mode_text: string;
  terminal_id: number;
  /** Highlight ids used in `cells` → colors. Absent on older desktops. */
  highlights?: Record<number, GridHighlight>;
};

export type TerminalSnapshot = {
  id: number;
  name: string;
  kind: string;
  active: boolean;
  viewed: boolean;
  running: boolean;
};

export type ChatThreadSnapshot = {
  id: string;
  title: string;
  status: string;
  archived: boolean;
  active: boolean;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    status?: string;
    changed_files?: string[];
  }>;
};

/** One file's unified diff from `changes.list`. */
export type ChangedFileDiff = { path: string; patch: string };

/** Per-file outcome of `changes.revert`. */
export type RevertFileResult = {
  path: string;
  applied: number;
  written: boolean;
  failed: Array<{ line: number; reason: string }>;
};

export type IdLabel = { id: string; label: string };

/** Result of `settings.get` / `settings.set` — mirrors the IDE pill bar. */
export type BridgeSettings = {
  mode: "plan" | "edit" | "agent";
  environment: "local" | "cloud" | "new_worktree";
  provider_id: string;
  providers: IdLabel[];
  model_id: string;
  models: IdLabel[];
  workspace: string;
  selected_branch: string | null;
  current_branch: string | null;
  branches: string[];
};

export type PreviewState = {
  url: string;
  design_mode: boolean;
  preview_text: string;
};

export type RemoteStatus = {
  vnc_running: boolean;
  proxy_active: boolean;
  allow_control: boolean;
  vnc_hint: string;
};

export const BRIDGE_DEFAULT_PORT = 9473;
export const VNC_PROXY_DEFAULT_PORT = 9474;
