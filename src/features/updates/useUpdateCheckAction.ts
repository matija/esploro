import { useCallback, useRef, useState } from "react";
import { useToast } from "../../components/Toast";
import { useAppStore } from "../../store";
import { useUpdateChecker } from "./useUpdateChecker";
import type { UpdateInfo } from "./api";

/** Outcome of the most recent manual check. */
export type UpdateCheckResult =
  | { status: "update-available"; info: UpdateInfo }
  | { status: "up-to-date"; version: string }
  | { status: "error"; message: string };

export interface UpdateCheckAction {
  /** True while a manually triggered check is in flight. */
  checking: boolean;
  /** Null until the user has triggered at least one check this session. */
  lastResult: UpdateCheckResult | null;
  checkNow: () => Promise<void>;
}

/**
 * User-facing wrapper around {@link useUpdateChecker}: runs a manual check,
 * opens the update sheet when a newer version exists, and otherwise reports
 * the outcome through the toast surface. Concurrent invocations are ignored.
 */
export function useUpdateCheckAction(): UpdateCheckAction {
  const { checkNow: runCheck } = useUpdateChecker();
  const setUpdateSheetOpen = useAppStore((s) => s.setUpdateSheetOpen);
  const { toast } = useToast();

  const [checking, setChecking] = useState(false);
  const [lastResult, setLastResult] = useState<UpdateCheckResult | null>(null);
  // Ref rather than state so back-to-back clicks in one tick can't both pass.
  const inFlightRef = useRef(false);

  const checkNow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    try {
      const info = await runCheck();
      if (info) {
        setLastResult({ status: "update-available", info });
        setUpdateSheetOpen(true);
      } else {
        setLastResult({ status: "up-to-date", version: __APP_VERSION__ });
        toast(`You're up to date — ${__APP_VERSION__}`, "success");
      }
    } catch (e) {
      const message = String(e);
      setLastResult({ status: "error", message });
      toast(message, "error");
    } finally {
      inFlightRef.current = false;
      setChecking(false);
    }
  }, [runCheck, setUpdateSheetOpen, toast]);

  return { checking, lastResult, checkNow };
}
