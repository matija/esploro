import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { useAppStore } from "./store";

export default function App() {
  const { addTab, closeTab, activeTabId, setCommandPaletteOpen } =
    useAppStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "t") {
        e.preventDefault();
        addTab({ type: "query", title: "Query" });
      } else if (e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTabId, setCommandPaletteOpen]);

  return <AppShell />;
}
