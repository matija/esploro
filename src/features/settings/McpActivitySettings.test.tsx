import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { settingsApi, type McpActivity } from "./api";
import { McpActivitySettings } from "./McpActivitySettings";
import { NAV_ITEMS, TITLE_TO_SECTION } from "./settingsNav";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./api", () => ({ settingsApi: { getMcpHistory: vi.fn(), clearMcpHistory: vi.fn() } }));

let update: () => void;
const unlisten = vi.fn();
function entry(id: string, extra: Partial<McpActivity> = {}): McpActivity {
  return { id, startedAt: `2026-01-01T00:00:${id.padStart(2, "0")}Z`, profileId: "profile-id", profileLabel: "Production", sql: `SELECT '${id}'`, status: "succeeded", durationMs: 42, returnedRowCount: 0, truncated: false, error: null, ...extra };
}
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><McpActivitySettings /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([]);
  vi.mocked(settingsApi.clearMcpHistory).mockResolvedValue();
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    update = () => callback({ event: "mcp-activity-changed", id: 1, payload: [] });
    return unlisten;
  });
});

it("registers separate navigation and explains local SQL storage", async () => {
  expect(NAV_ITEMS).toContainEqual({ id: "mcp-activity", label: "MCP Activity" });
  expect(TITLE_TO_SECTION["MCP Activity"]).toBe("mcp-activity");
  mount();
  expect(await screen.findByText("No MCP query attempts yet.")).toBeDefined();
  expect(screen.getByText(/SQL literals/).textContent).toContain("No result data is stored");
  expect(screen.getByRole("button", { name: "Clear History" })).toHaveProperty("disabled", true);
});

it("shows all columns, newest 20 rows, zero row counts and profile fallback", async () => {
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue(Array.from({ length: 22 }, (_, i) => entry(String(i), { profileLabel: null })));
  mount();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Time", "Connection profile", "Query preview", "Status", "Duration", "Rows"]);
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(20);
  expect(rows[0].textContent).toContain("SELECT '21'");
  expect(rows[19].textContent).toContain("SELECT '2'");
  expect(rows[0].textContent).toContain("profile-id");
  expect(within(rows[0]).getByText("42 ms")).toBeDefined();
  expect(within(rows[0]).getByText("0")).toBeDefined();
});

it("shows full SQL and truncation details", async () => {
  const sql = "SELECT 'secret literal'\nFROM very_long_table";
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1", { sql, truncated: true, returnedRowCount: 1000 })]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: /SELECT 'secret literal'/ }));
  const details = screen.getByRole("region", { name: "Query attempt details" });
  expect(details.querySelector("pre")?.textContent).toBe(sql);
  expect(within(details).getByText(/Results truncated: 1000 rows/)).toBeDefined();
});

it.each([
  ["running", null, "Running"],
  ["succeeded", null, "Success"],
  ["interrupted", null, "Interrupted"],
  ["failed", { kind: "Validation", message: "Only read-only SQL is allowed", code: null, position: null }, "Rejected"],
  ["failed", { kind: "Connection", message: "Query timed out; connection discarded", code: null, position: null }, "Timed out"],
  ["failed", { kind: "Sql", message: "Syntax error", code: "42601", position: 8 }, "Failed"],
] as const)("renders %s as %s with error details", async (state, error, label) => {
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1", { status: state, error })]);
  mount();
  expect(await screen.findByText(label)).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "SELECT '1'" }));
  const details = screen.getByRole("region", { name: "Query attempt details" });
  if (error) expect(within(details).getByText(`${error.kind}: ${error.message}`)).toBeDefined();
  if (error?.code) {
    expect(within(details).getByText("Error code: 42601")).toBeDefined();
    expect(within(details).getByText("SQL position: 8")).toBeDefined();
  }
});

it("updates selected running attempts live and unsubscribes", async () => {
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1", { status: "running", durationMs: null })]);
  const view = mount();
  await userEvent.click(await screen.findByRole("button", { name: "SELECT '1'" }));
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1"), entry("2")]);
  act(() => update());
  await waitFor(() => expect(screen.queryByText("Production · Running")).toBeNull());
  expect(screen.getByText("Production · Success")).toBeDefined();
  expect(screen.getAllByRole("row")[1].textContent).toContain("SELECT '2'");
  view.unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
});

it("clears persisted history and selected details", async () => {
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1")]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "SELECT '1'" }));
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([]);
  await userEvent.click(screen.getByRole("button", { name: "Clear History" }));
  expect(await screen.findByText("No MCP query attempts yet.")).toBeDefined();
  expect(settingsApi.clearMcpHistory).toHaveBeenCalledOnce();
  expect(screen.queryByRole("region", { name: "Query attempt details" })).toBeNull();
});

it("retains history on clear failure and reports errors", async () => {
  vi.mocked(settingsApi.getMcpHistory).mockResolvedValue([entry("1")]);
  vi.mocked(settingsApi.clearMcpHistory).mockRejectedValue(new Error("Cannot clear history"));
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Clear History" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Cannot clear history");
  expect(screen.getByRole("table")).toBeDefined();
});
