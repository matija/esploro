import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../store";
import type { ConnectionProfile, SavedQuery, SchemaObjects } from "../lib/bindings";
import { CommandPalette } from "./CommandPalette";

// The palette pulls connections, schema objects and saved queries from three
// different features. Faking `lib/bindings` — the one module every feature api
// invokes through — covers all of them at once.
vi.mock("../lib/bindings", async () => ({
  commands: (await import("../test/fakeBindings")).createFakeCommands(),
}));

import { commands } from "../lib/bindings";
import { resetFakeCommands, type FakeCommands } from "../test/fakeBindings";

const fakeCommands = commands as unknown as FakeCommands;

// ─── Fixture ─────────────────────────────────────────────────────────────────

const SESSION_ID = "session-1";

const PROFILE = {
  id: "conn-1",
  displayName: "Local Postgres",
  color: null,
  folder: null,
  driver: "postgres",
  host: "localhost",
  port: 5432,
  socketPath: null,
  database: "app",
  username: "postgres",
  sslMode: "disable",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as ConnectionProfile;

const OBJECTS: SchemaObjects = {
  tables: [
    { name: "orders", estimatedRowCount: 12 },
    { name: "order_items", estimatedRowCount: 40 },
  ],
  views: ["active_orders"],
  sequences: [],
  functions: [],
};

const SAVED_QUERY: SavedQuery = {
  id: "sq-1",
  name: "OI reconciliation",
  folder: "Reports",
  sql: "select 1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * Renders the palette already open, with the schema and saved-query caches
 * warmed the way the sidebar warms them in the running app — the palette reads
 * both straight out of the React Query cache rather than fetching.
 */
function renderPalette({ withCache = true }: { withCache?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (withCache) {
    queryClient.setQueryData(["objects", SESSION_ID, "app", "public"], OBJECTS);
    queryClient.setQueryData(["saved-queries"], [SAVED_QUERY]);
  }
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
  return user;
}

function searchInput(): HTMLInputElement {
  return screen.getByLabelText("Search commands, tables, connections") as HTMLInputElement;
}

/**
 * Result titles in the order the palette lists them. A result renders its title
 * in a span nested inside its label span; group headers are plain divs and the
 * footer hints aren't buttons, so this picks out exactly the results.
 */
function resultTitles(): string[] {
  return within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((button) => button.querySelector("span > span")?.textContent ?? "")
    .filter(Boolean);
}

function result(title: string): HTMLElement {
  const match = screen.getByText(title).closest("button");
  if (!match) throw new Error(`no palette result titled ${title}`);
  return match;
}

beforeAll(() => {
  // Radix's dialog positions through floating-ui, which observes its elements,
  // and the palette scrolls the highlighted row into view on every move.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

beforeEach(() => {
  resetFakeCommands(fakeCommands);
  useAppStore.setState({
    commandPaletteOpen: true,
    tabs: [{ id: "welcome", type: "welcome", title: "Welcome" }],
    activeTabId: "welcome",
    profiles: [PROFILE],
    activeSessions: { "conn-1": SESSION_ID },
    recentObjects: [],
    pendingNewConnection: false,
    theme: "github-dark",
  });
});

// ─── Fuzzy matching ──────────────────────────────────────────────────────────

describe("fuzzy matching", () => {
  it("lists a curated set of commands before anything is typed", () => {
    renderPalette();

    const titles = resultTitles();
    expect(titles).toContain("New Query");
    expect(titles).toContain("New Connection");
    expect(titles).toContain("Local Postgres");
    expect(titles).toContain("OI reconciliation");
    // Schema objects are search-only — they would swamp the default list.
    expect(titles).not.toContain("public.orders");
  });

  it("matches titles on a subsequence, not just a substring", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "apst");

    const titles = resultTitles();
    // a-p-…-s-…-t, in order, inside "Appearance Settings".
    expect(titles).toContain("Appearance Settings");
    expect(titles).not.toContain("Editor Settings");
  });

  it("searches schema objects loaded into the cache", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "order");

    const titles = resultTitles();
    expect(titles).toContain("public.orders");
    expect(titles).toContain("public.order_items");
    expect(titles).toContain("public.active_orders");
  });

  it("ranks a substring match above a subsequence match", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "oi");

    const titles = resultTitles();
    // "OI reconciliation" contains "oi"; "order_items" only spells it out.
    expect(titles.indexOf("OI reconciliation")).toBeLessThan(titles.indexOf("public.order_items"));
  });

  it("offers escape hatches when nothing matches", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "zzzz");

    expect(screen.getByText(/No results for/)).toBeDefined();
    expect(screen.getByRole("button", { name: /New Query/ })).toBeDefined();
  });

  it("forgets the query when it is reopened", async () => {
    const user = renderPalette();
    await user.type(searchInput(), "order");
    expect(searchInput().value).toBe("order");

    // Two separate commits — the palette clears its query on the closed render.
    act(() => useAppStore.getState().setCommandPaletteOpen(false));
    act(() => useAppStore.getState().setCommandPaletteOpen(true));

    await waitFor(() => expect(searchInput().value).toBe(""));
  });
});

// ─── Action dispatch ─────────────────────────────────────────────────────────

describe("action dispatch", () => {
  it("opens a query tab and closes the palette", async () => {
    const user = renderPalette();

    await user.click(result("New Query"));

    const { tabs, activeTabId, commandPaletteOpen } = useAppStore.getState();
    expect(tabs.at(-1)).toMatchObject({ type: "query", title: "Query", sessionId: SESSION_ID });
    expect(activeTabId).toBe(tabs.at(-1)!.id);
    expect(commandPaletteOpen).toBe(false);
  });

  it("opens a table tab for a schema object and remembers it as recent", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "order_items");
    await user.click(result("public.order_items"));

    const { tabs, recentObjects } = useAppStore.getState();
    expect(tabs.at(-1)).toMatchObject({
      type: "table",
      title: "public.order_items",
      sessionId: SESSION_ID,
      tableContext: {
        database: "app",
        schema: "public",
        table: "order_items",
        connectionId: "conn-1",
      },
    });
    expect(recentObjects[0]).toMatchObject({ type: "table", title: "public.order_items" });
  });

  it("opens a saved query with its SQL", async () => {
    const user = renderPalette();

    await user.click(result("OI reconciliation"));

    expect(useAppStore.getState().tabs.at(-1)).toMatchObject({
      type: "query",
      title: "OI reconciliation",
      queryContext: { sql: "select 1", savedQueryId: "sq-1" },
    });
  });

  it("connects a profile through the connect command and records the session", async () => {
    const user = renderPalette();
    useAppStore.setState({ activeSessions: {} });

    await user.click(result("Local Postgres"));

    expect(fakeCommands.connect).toHaveBeenCalledWith("conn-1");
    await waitFor(() =>
      expect(useAppStore.getState().activeSessions).toEqual({ "conn-1": "session-conn-1" }),
    );
  });

  it("leaves the sessions untouched when connecting fails", async () => {
    const user = renderPalette();
    useAppStore.setState({ activeSessions: {} });
    fakeCommands.connect.mockRejectedValue(new Error("refused"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await user.click(result("Local Postgres"));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(useAppStore.getState().activeSessions).toEqual({});
    consoleError.mockRestore();
  });

  it("switches the theme and persists it through the settings command", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "Tokyo Night Day");
    await user.click(result("Theme: Tokyo Night Day"));

    expect(useAppStore.getState().theme).toBe("tokyo-night-day");
    await waitFor(() => expect(fakeCommands.setUiPreferences).toHaveBeenCalled());
    expect(fakeCommands.setUiPreferences.mock.lastCall?.[0].ui.theme).toBe("tokyo-night-day");
  });

  it("hands a new connection back to the sidebar rather than opening a tab", async () => {
    const user = renderPalette();

    await user.click(result("New Connection"));

    expect(useAppStore.getState().pendingNewConnection).toBe(true);
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  it("runs the highlighted result on Enter", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "editor settings");
    await user.keyboard("{Enter}");

    expect(useAppStore.getState().tabs.at(-1)).toMatchObject({
      type: "settings",
      title: "Editor",
    });
  });

  it("moves the selection with the arrow keys", async () => {
    const user = renderPalette();

    await user.type(searchInput(), "settings");
    expect(resultTitles().slice(0, 3)).toEqual([
      "Appearance Settings",
      "Editor Settings",
      "Data Grid Settings",
    ]);

    // Down to the third result, back up to the second.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(useAppStore.getState().tabs.at(-1)).toMatchObject({
      type: "settings",
      title: "Editor",
    });
  });

  it("closes on the dialog's own dismissal path", async () => {
    const user = renderPalette();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(useAppStore.getState().commandPaletteOpen).toBe(false));
    expect(within(document.body).queryByLabelText("Search commands, tables, connections")).toBe(null);
  });
});
