import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, type McpStatus } from "../../lib/bindings";
import type { FakeCommands } from "../../test/fakeBindings";
import { McpSettings } from "./McpSettings";
import { NAV_ITEMS, TITLE_TO_SECTION } from "./settingsNav";

vi.mock("../../lib/bindings", async () => ({
  commands: (await import("../../test/fakeBindings")).createFakeCommands(),
}));

const fake = commands as FakeCommands;

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><McpSettings /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.getMcpPolicy.mockResolvedValue({ version: 1, enabled: false, permittedConnectionIds: [] });
  fake.listConnections.mockResolvedValue([]);
  fake.getMcpStatus.mockResolvedValue({ state: "stopped" });
  fake.getMcpEndpoint.mockResolvedValue("http://127.0.0.1:19482/mcp");
  fake.getMcpToken.mockReset().mockResolvedValue("test-token");
});

it.each(["starting", "running", "stopped"] as const)("shows %s status", async (state) => {
  fake.getMcpStatus.mockResolvedValue({ state } as McpStatus);
  mount();
  expect(await screen.findByText(`Server status: ${state}`)).toBeDefined();
});

it("shows server and command errors", async () => {
  fake.getMcpStatus.mockResolvedValue({ state: "error", message: "MCP listener unavailable. Check port 19482 and Keychain access, then retry." });
  fake.getMcpEndpoint.mockRejectedValue(new Error("Endpoint unavailable. Reopen Settings to retry."));
  mount();
  expect(await screen.findByText("MCP listener unavailable. Check port 19482 and Keychain access, then retry.")).toBeDefined();
  expect(await screen.findByText("Endpoint unavailable. Reopen Settings to retry.")).toBeDefined();
});

it("shows status fetch errors", async () => {
  fake.getMcpStatus.mockRejectedValue(new Error("Status unavailable"));
  mount();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "MCP listener unavailable. Check port 19482 and Keychain access, then retry.");
});

it("reveals and hides the token only on request", async () => {
  const user = userEvent.setup();
  mount();
  expect(screen.queryByText("test-token")).toBeNull();
  expect(fake.getMcpToken).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reveal token" }));
  expect(await screen.findByText("test-token")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Hide token" }));
  expect(screen.queryByText("test-token")).toBeNull();
});

it("copies endpoint, token and authenticated HTTP configuration without revealing the token", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  mount();
  await screen.findByText("http://127.0.0.1:19482/mcp");
  await user.click(screen.getByRole("button", { name: "Copy endpoint" }));
  expect(copy).toHaveBeenLastCalledWith("http://127.0.0.1:19482/mcp");
  await user.click(screen.getByRole("button", { name: "Copy token" }));
  expect(copy).toHaveBeenLastCalledWith("test-token");
  await user.click(screen.getByRole("button", { name: "Copy configuration" }));
  expect(JSON.parse(copy.mock.calls.at(-1)![0])).toEqual({ mcpServers: { esploro: { type: "http", url: "http://127.0.0.1:19482/mcp", headers: { Authorization: "Bearer test-token" } } } });
  expect(screen.queryByText("test-token")).toBeNull();
  expect(await screen.findByText("Copied to clipboard.")).toBeDefined();
});

it("reports token and clipboard failures", async () => {
  const user = userEvent.setup();
  fake.getMcpToken.mockRejectedValueOnce(new Error("Keychain unavailable"));
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard unavailable"));
  mount();
  await user.click(screen.getByRole("button", { name: "Reveal token" }));
  expect(await screen.findByText("Could not access the token or clipboard. Check Keychain and clipboard access, then retry.")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Copy token" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not access the token or clipboard. Check Keychain and clipboard access, then retry."));
});

it("registers MCP navigation and explains the access boundary", () => {
  expect(NAV_ITEMS).toContainEqual({ id: "mcp", label: "MCP" });
  expect(TITLE_TO_SECTION.MCP).toBe("mcp");
  mount();
  expect(screen.getByText(/Only permitted Connection profiles are exposed read-only/).textContent).toContain("cloud agents");
  expect(screen.getByText(/Use restricted database Roles/).textContent).toContain("not absolute isolation");
  expect(screen.getByText(/MCP starts disabled/).textContent).toContain("including after upgrading");
});


it("enables, disables and retries the listener without restarting", async () => {
  const user = userEvent.setup();
  fake.setMcpEnabled.mockImplementation(async (enabled) => {
    fake.getMcpPolicy.mockResolvedValue({ version: 1, enabled, permittedConnectionIds: [] });
    return null;
  });
  mount();
  const enable = await screen.findByRole("checkbox", { name: "Enable MCP" });
  await waitFor(() => expect(enable).toHaveProperty("disabled", false));
  await user.click(enable);
  await waitFor(() => expect(enable).toHaveProperty("checked", true));
  await user.click(screen.getByRole("button", { name: "Retry listener" }));
  await waitFor(() => expect(fake.retryMcp).toHaveBeenCalledOnce());
  await waitFor(() => expect(enable).toHaveProperty("disabled", false));
  await user.click(enable);
  await waitFor(() => expect(enable).toHaveProperty("checked", false));
  expect(fake.setMcpEnabled.mock.calls.map(([value]) => value)).toEqual([true, false]);
});

it("grants and revokes individual profiles while disabled", async () => {
  const user = userEvent.setup();
  fake.listConnections.mockResolvedValue([{ id: "local", displayName: "Local database" } as Awaited<ReturnType<typeof commands.listConnections>>[number]]);
  fake.setMcpGrants.mockImplementation(async (ids) => {
    fake.getMcpPolicy.mockResolvedValue({ version: 1, enabled: false, permittedConnectionIds: ids });
    return null;
  });
  mount();
  const grant = await screen.findByRole("checkbox", { name: "Local database" });
  await user.click(grant);
  await waitFor(() => expect(grant).toHaveProperty("checked", true));
  expect(fake.setMcpGrants).toHaveBeenLastCalledWith(["local"]);
  await user.click(grant);
  await waitFor(() => expect(grant).toHaveProperty("checked", false));
  expect(fake.setMcpGrants).toHaveBeenLastCalledWith([]);
});

it("requires confirmation and discards cached credentials after replacement", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Reveal token" }));
  expect(await screen.findByText("test-token")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Replace token" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fake.replaceMcpToken).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("test-token")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Replace token" }));
  fake.getMcpToken.mockResolvedValue("new-secret");
  await user.click(screen.getByRole("button", { name: "Confirm replacement" }));
  expect(await screen.findByText("Token replaced. Replace the configuration in every agent.")).toBeDefined();
  expect(screen.queryByText("test-token")).toBeNull();
  expect(screen.queryByText("new-secret")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Reveal token" }));
  expect(await screen.findByText("new-secret")).toBeDefined();
});

it("refreshes known state after failures without disclosing secrets", async () => {
  const user = userEvent.setup();
  fake.replaceMcpToken.mockRejectedValueOnce(new Error("Bearer private-secret"));
  fake.getMcpStatus.mockResolvedValue({ state: "error", message: "private-secret" });
  mount();
  await user.click(screen.getByRole("button", { name: "Replace token" }));
  await user.click(screen.getByRole("button", { name: "Confirm replacement" }));
  expect(await screen.findByText(/MCP change failed/)).toBeDefined();
  expect(fake.getMcpPolicy.mock.calls.length).toBeGreaterThan(1);
  expect(fake.getMcpStatus.mock.calls.length).toBeGreaterThan(1);
  expect(screen.queryByText(/private-secret/)).toBeNull();
});
