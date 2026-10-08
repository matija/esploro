export type SettingsSection =
  | "appearance"
  | "editor"
  | "grid"
  | "connections"
  | "licensing"
  | "mcp"
  | "mcp-activity"
  | "advanced"
  | "about";

export interface NavItem {
  id: SettingsSection;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "grid", label: "Data Grid" },
  { id: "connections", label: "Connections" },
  { id: "licensing", label: "Licensing" },
  { id: "mcp", label: "MCP" },
  { id: "mcp-activity", label: "MCP Activity" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
];

export const TITLE_TO_SECTION: Record<string, SettingsSection> = {
  Appearance: "appearance",
  Editor: "editor",
  "Data Grid": "grid",
  Connections: "connections",
  License: "licensing",
  Licensing: "licensing",
  MCP: "mcp",
  "MCP Activity": "mcp-activity",
  Advanced: "advanced",
  About: "about",
};
