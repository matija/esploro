import { useState, type ReactNode } from "react";
import {
  Code2,
  Database,
  Info,
  KeyRound,
  Palette,
  Settings,
  Table2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { AppearanceSettings } from "./AppearanceSettings";
import { EditorSettings } from "./EditorSettings";
import { DataGridSettings } from "./DataGridSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { AboutSettings } from "./AboutSettings";
import { LicenseSettings } from "../license";

type SettingsSection =
  | "appearance"
  | "editor"
  | "grid"
  | "connections"
  | "licensing"
  | "advanced"
  | "about";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={14} /> },
  { id: "editor", label: "Editor", icon: <Code2 size={14} /> },
  { id: "grid", label: "Data Grid", icon: <Table2 size={14} /> },
  { id: "connections", label: "Connections", icon: <Database size={14} /> },
  { id: "licensing", label: "Licensing", icon: <KeyRound size={14} /> },
  { id: "advanced", label: "Advanced", icon: <Settings size={14} /> },
  { id: "about", label: "About", icon: <Info size={14} /> },
];

const TITLE_TO_SECTION: Record<string, SettingsSection> = {
  "Appearance": "appearance",
  "Editor": "editor",
  "Data Grid": "grid",
  "Connections": "connections",
  "License": "licensing",
  "Advanced": "advanced",
  "About": "about",
};

export function SettingsView({ initialSection }: { initialSection?: string }) {
  const resolved = (initialSection && TITLE_TO_SECTION[initialSection]) || "appearance";
  const [section, setSection] = useState<SettingsSection>(resolved);

  return (
    <div className="flex h-full">
      {/* Left nav */}
      <nav className="w-40 shrink-0 border-r border-separator bg-sidebar p-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
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
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
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
            <AboutSettings onNavigateToLicense={() => setSection("licensing")} />
          )}
        </div>
      </div>
    </div>
  );
}
