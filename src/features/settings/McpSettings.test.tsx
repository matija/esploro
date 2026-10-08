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
  fake.getMcpStatus.mockResolvedValue({ state: "error", message: "Port already in use" });
  fake.getMcpEndpoint.mockRejectedValue(new Error("Endpoint unavailable"));
  mount();
  expect(await screen.findByText("Port already in use")).toBeDefined();
  expect(await screen.findByText("Endpoint unavailable")).toBeDefined();
});

it("shows status fetch errors", async () => {
  fake.getMcpStatus.mockRejectedValue(new Error("Status unavailable"));
  mount();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Status unavailable");
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
  expect(await screen.findByText("Keychain unavailable")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Copy token" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Clipboard unavailable"));
});

it("registers MCP navigation and explains the access boundary", () => {
  expect(NAV_ITEMS).toContainEqual({ id: "mcp", label: "MCP" });
  expect(TITLE_TO_SECTION.MCP).toBe("mcp");
  mount();
  expect(screen.getByText(/All saved Connection profiles are exposed read-only/).textContent).toContain("cloud agents");
  expect(screen.getByText(/Use restricted database Roles/).textContent).toContain("not absolute isolation");
});
