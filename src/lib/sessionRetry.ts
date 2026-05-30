import { connectionsApi } from "../features/connections/api";
import { useAppStore } from "../store";

// The string is emitted by state.sessions.lock().await.get(&session_id).ok_or_else(...)
// in src-tauri/src/commands/data.rs (lines 237, 848) and schema.rs (lines 53, 96, 135, 261).
const SESSION_NOT_FOUND = "Session not found";

// Dedup concurrent reconnect attempts per connectionId.
const inflight = new Map<string, Promise<string>>();
// Per-reconnect toast dedup: cleared when a new reconnect starts, set when the first
// concurrent caller fires the toast so subsequent callers skip it.
const toastFiredForReconnect = new Set<string>();

async function reconnectOnce(connectionId: string): Promise<string> {
  const existing = inflight.get(connectionId);
  if (existing) return existing;
  toastFiredForReconnect.delete(connectionId);
  const p = connectionsApi.connect(connectionId).finally(() =>
    inflight.delete(connectionId),
  );
  inflight.set(connectionId, p);
  return p;
}

export async function withSessionRetry<T>(
  connectionId: string,
  fn: (sessionId: string) => Promise<T>,
  toast?: (message: string, variant: "success" | "error" | "info" | "warning") => void,
): Promise<T> {
  let sessionId = useAppStore.getState().activeSessions[connectionId];
  if (!sessionId) {
    sessionId = await reconnectOnce(connectionId);
    useAppStore.getState().connectSession(connectionId, sessionId);
  }

  try {
    return await fn(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(SESSION_NOT_FOUND)) throw err;

    console.warn("[sessionRetry] Session not found — reconnecting", {
      connectionId,
      prevSessionId: sessionId,
      error: msg,
      stack: new Error().stack,
    });

    let newSessionId: string;
    try {
      newSessionId = await reconnectOnce(connectionId);
    } catch (reconnectErr) {
      const connName =
        useAppStore.getState().profiles.find((p) => p.id === connectionId)?.displayName ??
        connectionId;
      const reason = reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr);
      const message = `Could not reconnect to ${connName}: ${reason}`;
      toast?.(message, "error");
      throw new Error(message);
    }

    useAppStore.getState().connectSession(connectionId, newSessionId);

    if (!toastFiredForReconnect.has(connectionId)) {
      toastFiredForReconnect.add(connectionId);
      const connName =
        useAppStore.getState().profiles.find((p) => p.id === connectionId)?.displayName ??
        connectionId;
      toast?.(`Reconnected to ${connName}`, "success");
    }

    return fn(newSessionId);
  }
}
