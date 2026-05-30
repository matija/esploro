import { Database, FileText, Table2, Eye, X } from "lucide-react";
import { useAppStore, type RecentObject } from "../../store";
import { cn } from "../../lib/utils";

function objectIcon(type: RecentObject["type"]) {
  switch (type) {
    case "table":
      return <Table2 size={12} className="text-schema-table shrink-0" />;
    case "view":
      return <Eye size={12} className="text-schema-view shrink-0" />;
    case "query":
      return <FileText size={12} className="text-accent shrink-0" />;
  }
}

function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RecentRow({ item }: { item: RecentObject }) {
  const { addTab, activeSessions } = useAppStore();

  function handleClick() {
    if (item.type === "table" || item.type === "view") {
      const sessionId = item.connectionId
        ? (activeSessions[item.connectionId] ?? item.sessionId)
        : (item.sessionId ?? Object.values(activeSessions)[0]);
      if (!item.connectionId || !item.schema || !item.table || !item.database) return;
      addTab({
        type: "table",
        title: item.title,
        sessionId,
        tableContext: {
          database: item.database,
          schema: item.schema,
          table: item.table,
          connectionId: item.connectionId,
        },
      });
    } else if (item.type === "query") {
      const sessionId = item.sessionId ?? Object.values(activeSessions)[0];
      addTab({
        type: "query",
        title: item.title,
        sessionId,
        queryContext: {
          sql: item.sql ?? "",
          savedQueryId: item.savedQueryId,
        },
      });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5",
        "text-left transition-colors duration-[var(--motion-fast)]",
        "hover:bg-hover active:bg-pressed",
      )}
    >
      {objectIcon(item.type)}
      <span className="flex-1 min-w-0 truncate text-[13px] text-label">
        {item.title}
      </span>
      <span className="shrink-0 text-[11px] text-tertiary tabular-nums opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)]">
        {formatAge(item.timestamp)}
      </span>
    </button>
  );
}

export function RecentObjectsSection() {
  const { recentObjects, clearRecentObjects } = useAppStore();

  if (recentObjects.length === 0) {
    return (
      <div className="px-3 py-3 text-center">
        <div className="flex items-center justify-center w-7 h-7 mx-auto mb-2 rounded-[var(--radius-control)] bg-accent/8">
          <Database size={14} className="text-tertiary" />
        </div>
        <p className="text-[12px] text-tertiary leading-relaxed">
          Recently opened tables and queries will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-1">
      {recentObjects.map((item, i) => (
        <RecentRow key={`${item.title}-${item.timestamp}-${i}`} item={item} />
      ))}
      {recentObjects.length > 3 && (
        <button
          type="button"
          onClick={clearRecentObjects}
          className="flex items-center gap-1.5 px-2 py-1 mt-1 text-[12px] text-tertiary hover:text-secondary transition-colors duration-[var(--motion-fast)]"
        >
          <X size={10} />
          Clear recents
        </button>
      )}
    </div>
  );
}
