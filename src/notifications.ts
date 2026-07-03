import type { BridgeClient } from "./bridge/client";
import type { ChatThreadSnapshot } from "@protocol/schema";
import { loadPrefs } from "./settings/webPrefs";

/** Thread status → UI color/meaning, shared by dots and notifications. */
export const THREAD_STATES: Record<
  string,
  { color: string; label: string }
> = {
  Idle: { color: "var(--text-muted)", label: "idle" },
  Running: { color: "#e5a53d", label: "working" },
  WaitingApproval: { color: "#e5a53d", label: "needs your decision" },
  Done: { color: "#57c793", label: "done" },
  Error: { color: "#ef5b62", label: "failed" },
};

export function threadStateColor(status: string): string {
  return THREAD_STATES[status]?.color ?? "var(--text-muted)";
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function notify(title: string, body: string) {
  if (!loadPrefs().notifications) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: `claw-${title}` });
  } catch {
    /* some Android browsers only allow notifications from service workers */
  }
}

/** Watch thread status transitions on the bridge and raise system
 *  notifications for the ones the user cares about: needs a decision,
 *  finished, or failed. Returns an unsubscribe function. */
export function watchThreadNotifications(client: BridgeClient): () => void {
  const lastStatus = new Map<string, string>();
  let primed = false;

  const inspect = (threads: ChatThreadSnapshot[]) => {
    for (const t of threads) {
      const prev = lastStatus.get(t.id);
      lastStatus.set(t.id, t.status);
      // Don't fire for the snapshot that seeds the map (page load).
      if (!primed || prev === t.status || prev === undefined) continue;
      if (t.status === "WaitingApproval") {
        notify(t.title, "Needs your decision");
      } else if (t.status === "Done" && prev === "Running") {
        notify(t.title, "Finished the work");
      } else if (t.status === "Error") {
        notify(t.title, "Failed — check the thread");
      }
    }
    primed = true;
  };

  client
    .call<ChatThreadSnapshot[]>("chat.threads")
    .then(inspect)
    .catch(() => undefined);

  return client.on((event, data) => {
    if (event === "chat.threads") inspect(data as ChatThreadSnapshot[]);
    // Scheduled jobs run headless on the desktop; the bridge relays their
    // completion as a dedicated event since no live thread transition occurs.
    if (event === "job.completed") {
      const name = (data as { name?: string } | null)?.name ?? "Scheduled job";
      notify(name, "Scheduled run finished");
    }
  });
}
