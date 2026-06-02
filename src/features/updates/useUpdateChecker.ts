import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export const UPDATE_CHECK_KEY = ["update-check"] as const;

const SIX_HOURS = 6 * 60 * 60 * 1000;

export interface UpdateCheckerState {
  /** Non-null ⇒ a newer version is available ⇒ show the indicator. */
  updateInfo: UpdateInfo | null;
  checking: boolean;
  lastCheckedAt: number | null;
  /** Manual trigger. Resolves with the result and throws on failure so the
   *  caller can surface a visible error (background checks stay silent). */
  checkNow: () => Promise<UpdateInfo | null>;
}

/**
 * Single source of truth for update availability. Wraps the `check_for_update`
 * Tauri command in a React Query that auto-checks on startup and every ~6h of
 * uptime, re-checking on window focus only when stale. Background failures are
 * silent (retry: false, never inspected); the manual `checkNow` throws so the
 * About panel can show its error state.
 */
export function useUpdateChecker(): UpdateCheckerState {
  const { data, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: UPDATE_CHECK_KEY,
    queryFn: () => invoke<UpdateInfo | null>("check_for_update"),
    refetchInterval: SIX_HOURS,
    refetchOnWindowFocus: true,
    staleTime: SIX_HOURS,
    retry: false,
  });

  // Backend only returns a value when an update exists, but guard the
  // equal-version edge case defensively.
  const updateInfo = data && data.version !== __APP_VERSION__ ? data : null;

  return {
    updateInfo,
    checking: isFetching,
    lastCheckedAt: dataUpdatedAt || null,
    checkNow: async () => {
      const result = await refetch();
      if (result.error) throw result.error;
      const info = result.data ?? null;
      return info && info.version !== __APP_VERSION__ ? info : null;
    },
  };
}
