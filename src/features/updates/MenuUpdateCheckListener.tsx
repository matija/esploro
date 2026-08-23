import { useEffect } from "react";
import { onMenuEvent } from "../../lib/tauriEvents";
import { useUpdateCheckAction } from "./useUpdateCheckAction";

/**
 * Bridges the "Check for Updates…" app-menu item to the shared check action.
 * Must be rendered inside `ToastProvider` because `useUpdateCheckAction`
 * reports its outcome through toasts; renders nothing itself.
 */
export function MenuUpdateCheckListener() {
  const { checkNow } = useUpdateCheckAction();

  useEffect(() => {
    return onMenuEvent("menu:check-for-updates", () => { void checkNow(); });
  }, [checkNow]);

  return null;
}
