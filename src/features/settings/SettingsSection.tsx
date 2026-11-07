import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function SettingsSection({ title, action, children }: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-7 text-[13px]">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-label">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SettingSwitch({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-label">
      {label}
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-[var(--motion-fast)]",
          checked ? "bg-accent" : "bg-control shadow-[var(--shadow-hairline)]",
        )}
      >
        <span className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-[var(--motion-fast)]",
          checked ? "translate-x-4" : "translate-x-0",
        )} />
      </button>
    </label>
  );
}
