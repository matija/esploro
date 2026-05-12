import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import appIconUrl from "../../assets/app-icon.png";
import { licenseApi, LICENSE_STATUS_KEY } from "../license/api";
import { UpdateSheet } from "../updates/UpdateSheet";

interface UpdateInfo {
  version: string;
  notes: string | null;
}

async function openUrl(url: string) {
  await invoke("open_url", { url });
}

interface Props {
  onNavigateToLicense: () => void;
}

type CheckState = "idle" | "checking" | "up-to-date" | "update-found" | "error";

export function AboutSettings({ onNavigateToLicense }: Props) {
  const { data: status } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });

  const licenseLabel =
    status?.tier === "Commercial"
      ? "Commercial"
      : status?.tier === "Personal"
        ? "Personal"
        : "Unlicensed";

  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current); }, []);

  async function handleCheckForUpdates() {
    if (checkState === "checking") return;
    setCheckState("checking");
    setCheckError(null);
    try {
      const info = await invoke<UpdateInfo | null>("check_for_update");
      if (info) {
        setUpdateInfo(info);
        setCheckState("update-found");
        setSheetOpen(true);
      } else {
        setCheckState("up-to-date");
        resetTimerRef.current = setTimeout(() => setCheckState("idle"), 5000);
      }
    } catch (e) {
      setCheckError(String(e));
      setCheckState("error");
      resetTimerRef.current = setTimeout(() => setCheckState("idle"), 5000);
    }
  }

  const checkButtonLabel =
    checkState === "checking" ? "Checking…"
    : checkState === "up-to-date" ? `Up to date — ${__APP_VERSION__}`
    : checkState === "update-found" ? "Update available"
    : checkState === "error" ? "Check failed"
    : "Check for Updates";

  return (
    <section className="flex flex-col gap-6">
      {/* Identity block */}
      <div className="flex items-center gap-4">
        <img
          src={appIconUrl}
          alt="Esploro"
          className="w-16 h-16 rounded-[22%] shadow-[var(--shadow-popover)]"
        />
        <div>
          <p className="text-[15px] font-semibold text-label">Esploro</p>
          <p className="text-[13px] text-tertiary mt-0.5">{__APP_VERSION__}</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-secondary leading-relaxed">
        A native macOS database client for PostgreSQL, MySQL, and MariaDB.
      </p>

      {/* Links */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void openUrl("https://matija.eu")}
          className="flex items-center gap-1.5 text-[14px] text-accent hover:text-accent/80 transition-colors duration-[var(--motion-fast)] w-fit"
        >
          Built by Matija Munjaković
          <ExternalLink size={11} className="text-tertiary" />
        </button>
        <button
          type="button"
          onClick={() => void openUrl("https://tandoku.hr")}
          className="flex items-center gap-1.5 text-[13px] text-tertiary hover:text-secondary transition-colors duration-[var(--motion-fast)] w-fit"
        >
          A Tandoku product
          <ExternalLink size={11} className="opacity-60" />
        </button>
        <button
          type="button"
          onClick={() => void openUrl("https://github.com/matija/esploro")}
          className="flex items-center gap-1.5 text-[14px] text-accent hover:text-accent/80 transition-colors duration-[var(--motion-fast)] w-fit"
        >
          Source on GitHub
          <ExternalLink size={11} className="text-tertiary" />
        </button>
      </div>

      {/* Separator */}
      <div className="border-t border-separator" />

      {/* License row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-secondary">License</span>
          <span className="inline-flex items-center rounded-full border border-separator bg-sidebar px-2 py-0.5 text-[12px] font-medium text-label">
            {licenseLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={onNavigateToLicense}
          className="text-[14px] text-accent hover:text-accent/80 transition-colors duration-[var(--motion-fast)]"
        >
          Manage →
        </button>
      </div>

      {/* Separator */}
      <div className="border-t border-separator" />

      {/* Check for Updates */}
      <div className="flex items-center justify-between">
        <span className="text-[14px] text-secondary">Updates</span>
        <button
          type="button"
          onClick={() => {
            if (checkState === "update-found") {
              setSheetOpen(true);
            } else {
              void handleCheckForUpdates();
            }
          }}
          disabled={checkState === "checking" || checkState === "up-to-date"}
          className="text-[14px] text-accent hover:text-accent/80 disabled:text-tertiary
            disabled:cursor-default transition-colors duration-[var(--motion-fast)]"
        >
          {checkButtonLabel}
        </button>
      </div>
      {checkState === "error" && checkError && (
        <p className="text-[12px] text-destructive leading-relaxed">{checkError}</p>
      )}

      {updateInfo && (
        <UpdateSheet
          open={sheetOpen}
          currentVersion={__APP_VERSION__}
          updateVersion={updateInfo.version}
          notes={updateInfo.notes}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
