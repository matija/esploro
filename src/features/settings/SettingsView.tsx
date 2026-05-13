import { Code2, Database, Info, KeyRound, Palette, Settings, Table2, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { AppearanceSettings } from "./AppearanceSettings";
import { EditorSettings } from "./EditorSettings";
import { DataGridSettings } from "./DataGridSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { AboutSettings } from "./AboutSettings";
import { LicenseSettings } from "../license";
import { NAV_ITEMS, type SettingsSection } from "./settingsNav";

const SECTION_ICON: Record<SettingsSection, LucideIcon> = {
  appearance: Palette,
  editor: Code2,
  grid: Table2,
  connections: Database,
  licensing: KeyRound,
  advanced: Settings,
  about: Info,
};

interface SettingsViewProps {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
}

export function SettingsView({ section, onSectionChange }: SettingsViewProps) {
  return (
    <div className="flex h-full">
      {/* Left nav */}
      <nav className="w-40 shrink-0 border-r border-separator bg-sidebar p-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = SECTION_ICON[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] text-left w-full",
                "transition-colors duration-[var(--motion-fast)]",
                section === item.id
                  ? "bg-accent/12 text-accent font-medium"
                  : "text-secondary hover:bg-hover hover:text-label active:bg-pressed",
              )}
            >
              <span
                className={cn(
                  "shrink-0",
                  section === item.id ? "text-accent" : "text-tertiary",
                )}
              >
                <Icon size={14} />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-md w-full">
          {section === "appearance" && <AppearanceSettings />}
          {section === "editor" && <EditorSettings />}
          {section === "grid" && <DataGridSettings />}
          {section === "connections" && <ConnectionsSettings />}
          {section === "licensing" && <LicenseSettings />}
          {section === "advanced" && <AdvancedSettings />}
          {section === "about" && (
            <AboutSettings onNavigateToLicense={() => onSectionChange("licensing")} />
          )}
        </div>
      </div>
    </div>
  );
}
