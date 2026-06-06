import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";

/**
 * The structured error shape returned by every Rust command (`AppError`,
 * serialized as `{ kind, message, code, position }`). The backend is the source
 * of truth; see `src-tauri/src/error.rs`.
 */
export type AppErrorKind =
  | "SessionNotFound"
  | "Connection"
  | "Sql"
  | "Validation"
  | "License"
  | "Io"
  | "Internal";

/** A normalized command error: a real `Error` (so `.message` keeps working in
 *  existing `catch` sites) that also carries the structured `kind`/`code`. */
export class IpcError extends Error {
  kind: AppErrorKind | string;
  code: string | null;
  position: number | null;

  constructor(kind: string, message: string, code: string | null, position: number | null) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
    this.code = code;
    this.position = position;
  }
}

function isSerializedAppError(value: unknown): value is {
  kind: string;
  message: string;
  code: string | null;
  position: number | null;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

/** Convert a rejected command value into an `IpcError`. */
export function normalizeError(raw: unknown): Error {
  if (isSerializedAppError(raw)) {
    return new IpcError(raw.kind, raw.message, raw.code ?? null, raw.position ?? null);
  }
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : String(raw));
}

/** True when the error is `AppError::SessionNotFound`. */
export function isSessionNotFound(err: unknown): boolean {
  return err instanceof IpcError && err.kind === "SessionNotFound";
}

/**
 * Drop-in replacement for `@tauri-apps/api/core`'s `invoke` that normalizes the
 * structured error returned by Rust commands into an `IpcError`. Import this
 * instead of the raw `invoke` so error consumers get both a readable `.message`
 * and a branchable `.kind`.
 */
export async function invoke<T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args, options);
  } catch (raw) {
    throw normalizeError(raw);
  }
}
