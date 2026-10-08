import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "./api";

export function McpSettings() {
  const status = useQuery({ queryKey: ["mcp-status"], queryFn: settingsApi.getMcpStatus, refetchInterval: 5000 });
  const endpoint = useQuery({ queryKey: ["mcp-endpoint"], queryFn: settingsApi.getMcpEndpoint });
  const [token, setToken] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function act(action: "reveal" | "token" | "endpoint" | "config") {
    setError("");
    setMessage("");
    try {
      if (action === "endpoint") {
        await navigator.clipboard.writeText(endpoint.data!);
      } else {
        const secret = token ?? await settingsApi.getMcpToken();
        setToken(secret);
        if (action === "reveal") {
          setRevealed(true);
          return;
        }
        await navigator.clipboard.writeText(action === "token" ? secret : JSON.stringify({
          mcpServers: { esploro: { type: "http", url: endpoint.data, headers: { Authorization: `Bearer ${secret}` } } },
        }, null, 2));
      }
      setMessage("Copied to clipboard.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const buttonClass = "rounded-[var(--radius-control)] border border-separator px-2.5 py-1 text-[13px] hover:bg-hover disabled:opacity-50";

  return (
    <section className="flex flex-col gap-6 text-[13px]">
      <div>
        <h3 className="text-[12px] font-medium text-secondary uppercase mb-1">MCP</h3>
        <p className="text-tertiary">Connect an agent harness using Streamable HTTP.</p>
      </div>
      <p role="status">Server status: {status.data?.state ?? "Loading"}</p>
      {status.data?.state === "error" && <p role="alert">{status.data.message}</p>}
      {status.error && <p role="alert">{status.error.message}</p>}
      {endpoint.error && <p role="alert">{endpoint.error.message}</p>}
      <div className="space-y-2">
        <p>Endpoint</p>
        <code className="block break-all">{endpoint.data ?? "Loading…"}</code>
        <button className={buttonClass} disabled={!endpoint.data} onClick={() => void act("endpoint")}>Copy endpoint</button>
      </div>
      <div className="space-y-2">
        <p>Persistent bearer token</p>
        <code className="block break-all">{revealed ? token : "••••••••"}</code>
        <div className="flex gap-2">
          <button className={buttonClass} onClick={() => revealed ? setRevealed(false) : void act("reveal")}>{revealed ? "Hide token" : "Reveal token"}</button>
          <button className={buttonClass} onClick={() => void act("token")}>Copy token</button>
        </div>
        <p className="text-tertiary">The token persists across app restarts. Keep it secret; it grants access to all saved Connection profiles.</p>
      </div>
      <div className="space-y-2">
        <p>Harness configuration</p>
        <p className="text-tertiary">Copy a Streamable HTTP configuration with an Authorization: Bearer header. The copied configuration contains your token.</p>
        <button className={buttonClass} disabled={!endpoint.data} onClick={() => void act("config")}>Copy configuration</button>
      </div>
      <p className="text-tertiary">All saved Connection profiles are exposed read-only. Query results can reach cloud agents. Use restricted database Roles to limit access to sensitive data. Read-only access is not absolute isolation and does not prevent data disclosure.</p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
