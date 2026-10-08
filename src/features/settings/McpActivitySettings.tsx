import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { settingsApi, type McpActivity } from "./api";

const queryKey = ["mcp-history"];

function status(entry: McpActivity) {
  if (entry.status === "succeeded") return "Success";
  if (entry.status === "failed") {
    if (entry.error?.kind === "Validation") return "Rejected";
    if (entry.error?.kind === "Connection" && entry.error.message.startsWith("Query timed out")) return "Timed out";
  }
  return entry.status[0].toUpperCase() + entry.status.slice(1);
}

const colors: Record<string, string> = {
  Running: "text-accent", Success: "text-green-600", Rejected: "text-orange-600",
  Failed: "text-red-600", "Timed out": "text-amber-600", Interrupted: "text-secondary",
};

export function McpActivitySettings() {
  const client = useQueryClient();
  const history = useQuery({ queryKey, queryFn: settingsApi.getMcpHistory, refetchInterval: 5000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  useEffect(() => {
    const subscription = listen("mcp-activity-changed", () => { void client.invalidateQueries({ queryKey }); });
    subscription.then(() => { void client.invalidateQueries({ queryKey }); }).catch((error: unknown) => setEventError(String(error)));
    return () => { void subscription.then((unlisten) => unlisten()).catch(() => undefined); };
  }, [client]);
  const clear = useMutation({
    mutationFn: settingsApi.clearMcpHistory,
    onSuccess: () => {
      setSelectedId(null);
      client.setQueryData(queryKey, []);
      void client.invalidateQueries({ queryKey });
    },
  });
  const entries = [...(history.data ?? [])].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 20);
  const selected = entries.find((entry) => entry.id === selectedId);
  return (
    <section className="space-y-4 text-[13px] text-label">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">MCP Activity</h2>
        <button type="button" className="rounded border border-separator px-3 py-1.5 disabled:opacity-50" disabled={clear.isPending || !entries.length} onClick={() => clear.mutate()}>Clear History</button>
      </div>
      <p className="text-secondary">Latest 20 persisted query attempts. Full SQL, including SQL literals, remains locally stored. No result data is stored.</p>
      {(history.error || clear.error) && <p role="alert">{(history.error || clear.error)?.message}</p>}
      {eventError && <p role="alert">Live updates unavailable: {eventError}. History refreshes every five seconds.</p>}
      {history.isPending ? <p>Loading activity…</p> : !entries.length && !history.error ? <p>No MCP query attempts yet.</p> : null}
      {!!entries.length && <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left">
          <thead><tr>{["Time", "Connection profile", "Query preview", "Status", "Duration", "Rows"].map((label) => <th key={label} className="border-b border-separator p-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id} onClick={() => setSelectedId(entry.id)} className={selectedId === entry.id ? "bg-accent/10" : "cursor-pointer hover:bg-hover"}>
            <td className="p-2 whitespace-nowrap"><time dateTime={entry.startedAt}>{new Date(entry.startedAt).toLocaleString()}</time></td>
            <td className="p-2">{entry.profileLabel ?? entry.profileId}</td>
            <td className="p-2"><button type="button" aria-pressed={selectedId === entry.id} onClick={() => setSelectedId(entry.id)} className="block max-w-[400px] truncate text-left font-mono" title={entry.sql}>{entry.sql.replace(/\s+/g, " ").trim()}</button></td>
            <td className={`p-2 whitespace-nowrap ${colors[status(entry)]}`}>{status(entry)}</td>
            <td className="p-2 whitespace-nowrap">{entry.durationMs === null ? "—" : `${entry.durationMs} ms`}</td>
            <td className="p-2">{entry.returnedRowCount ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {selected && <section aria-label="Query attempt details" className="space-y-3 rounded border border-separator p-4">
        <h3 className="font-semibold">Query attempt details</h3>
        <p>{selected.profileLabel ?? selected.profileId} · {status(selected)}</p>
        <pre className="whitespace-pre-wrap break-words font-mono">{selected.sql}</pre>
        {selected.error && <div><p>{selected.error.kind}: {selected.error.message}</p>{selected.error.code && <p>Error code: {selected.error.code}</p>}{selected.error.position !== null && <p>SQL position: {selected.error.position}</p>}</div>}
        <p>{selected.truncated ? `Results truncated: ${selected.returnedRowCount ?? 0} rows returned; additional rows were omitted.` : "Results were not truncated."}</p>
      </section>}
    </section>
  );
}
