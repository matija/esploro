import { useEffect } from "react";
import { onMenuEvent } from "../../lib/tauriEvents";
import { useUpdateCheckAction } from "./useUpdateCheckAction";
import { isSelfUpdateAvailable } from "./api";

/**
 * Bridges the "Check for Updates…" app-menu item to the shared check action.
 * Must be rendered inside `ToastProvider` because `useUpdateCheckAction`
 * reports its outcome through toasts; renders nothing itself. Builds that
 * cannot self-update have no such menu item, so the subscription is skipped.
 */
export function MenuUpdateCheckListener() {
  const { checkNow } = useUpdateCheckAction();

  useEffect(() => {
    if (!isSelfUpdateAvailable()) return;
    return onMenuEvent("menu:check-for-updates", () => { void checkNow(); });
  }, [checkNow]);

  return null;
}
