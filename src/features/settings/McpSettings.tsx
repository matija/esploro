import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "./api";
import { connectionsApi } from "../connections/api";

export function McpSettings() {
  const status = useQuery({ queryKey: ["mcp-status"], queryFn: settingsApi.getMcpStatus, refetchInterval: 5000 });
  const endpoint = useQuery({ queryKey: ["mcp-endpoint"], queryFn: settingsApi.getMcpEndpoint });
  const policy = useQuery({ queryKey: ["mcp-policy"], queryFn: settingsApi.getMcpPolicy });
  const profiles = useQuery({ queryKey: ["connections"], queryFn: connectionsApi.list });
  const [busy, setBusy] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [token, setToken] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function change(action: () => Promise<unknown>, replacement = false) {
    setBusy(true);
    setError("");
    setMessage("");
    if (replacement) {
      setToken(undefined);
      setRevealed(false);
      setConfirmReplacement(false);
    }
    try {
      await action();
      setMessage(replacement ? "Token replaced. Replace the configuration in every agent." : "MCP settings updated.");
    } catch {
      setError("MCP change failed. Review the current listener and access settings, then retry.");
    } finally {
      await Promise.all([policy.refetch(), status.refetch()]);
      setBusy(false);
    }
  }

  async function act(action: "reveal" | "token" | "endpoint" | "config") {
    setBusy(true);
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
    } catch {
      setError("Could not access the token or clipboard. Check Keychain and clipboard access, then retry.");
    } finally {
      setBusy(false);
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
      {(status.data?.state === "error" || status.error) && <p role="alert">MCP listener unavailable. Check port 19482 and Keychain access, then retry.</p>}
      {endpoint.error && <p role="alert">Endpoint unavailable. Reopen Settings to retry.</p>}
      <p className="text-tertiary">MCP starts disabled, including after upgrading from earlier versions. Enable it and grant individual Connection profiles to restore agent access. New profiles have no grant.</p>
      {policy.error && <p role="alert">Cannot load MCP access policy. Check local policy storage and reopen Settings.</p>}
      <label><input type="checkbox" checked={policy.data?.enabled ?? false} disabled={busy || !policy.data || !!policy.error} onChange={(event) => void change(() => settingsApi.setMcpEnabled(event.target.checked))} /> Enable MCP</label>
      <button className={buttonClass} disabled={busy || !policy.data?.enabled} onClick={() => void change(settingsApi.retryMcp)}>Retry listener</button>
      <fieldset disabled={busy || !policy.data || !!policy.error} className="space-y-2">
        <legend>Permitted Connection profiles</legend>
        {profiles.error && <p role="alert">Cannot load Connection profiles. Reopen Settings to retry.</p>}
        {profiles.data?.length === 0 && <p>No saved Connection profiles.</p>}
        {profiles.data?.map((profile) => <label key={profile.id} className="block"><input type="checkbox" checked={policy.data?.permittedConnectionIds?.includes(profile.id) ?? false} onChange={(event) => {
          const ids = policy.data!.permittedConnectionIds ?? [];
          const next = event.target.checked ? [...ids, profile.id] : ids.filter((id) => id !== profile.id);
          void change(() => settingsApi.setMcpGrants(next));
        }} /> {profile.displayName}</label>)}
      </fieldset>
      <div className="space-y-2">
        <p>Endpoint</p>
        <code className="block break-all">{endpoint.data ?? "Loading…"}</code>
        <button className={buttonClass} disabled={busy || !endpoint.data} onClick={() => void act("endpoint")}>Copy endpoint</button>
      </div>
      <div className="space-y-2">
        <p>Persistent bearer token</p>
        <code className="block break-all">{revealed ? token : "••••••••"}</code>
        <div className="flex gap-2">
          <button className={buttonClass} disabled={busy} onClick={() => revealed ? setRevealed(false) : void act("reveal")}>{revealed ? "Hide token" : "Reveal token"}</button>
          <button className={buttonClass} disabled={busy} onClick={() => void act("token")}>Copy token</button>
        </div>
        <p className="text-tertiary">The token persists across app restarts. Keep it secret; it grants access only to permitted Connection profiles.</p>
      </div>
      <div className="space-y-2">
        <button className={buttonClass} disabled={busy} onClick={() => setConfirmReplacement(true)}>Replace token</button>
        {confirmReplacement && <div role="dialog" aria-label="Replace MCP token" aria-modal="true">
          <p>Replace the token? This stops current MCP work and invalidates the old token. Replace the configuration in every agent afterward. If replacement fails, the previous token remains valid; check listener status.</p>
          <button className={buttonClass} onClick={() => void change(settingsApi.replaceMcpToken, true)}>Confirm replacement</button>
          <button className={buttonClass} onClick={() => setConfirmReplacement(false)}>Cancel</button>
        </div>}
      </div>
      <div className="space-y-2">
        <p>Harness configuration</p>
        <p className="text-tertiary">Copy a Streamable HTTP configuration with an Authorization: Bearer header. The copied configuration contains your token.</p>
        <button className={buttonClass} disabled={busy || !endpoint.data} onClick={() => void act("config")}>Copy configuration</button>
      </div>
      <p className="text-tertiary">Only permitted Connection profiles are exposed read-only. Query results can reach cloud agents. Use restricted database Roles to limit access to sensitive data. Read-only access is not absolute isolation and does not prevent data disclosure.</p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
