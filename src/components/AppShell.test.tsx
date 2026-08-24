import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore, type Tab } from "../store";
import type {
  CellValue,
  ConnectionProfile,
  ResultColumn,
  TableQueryRequest,
  TableQueryResult,
} from "../lib/bindings";
import { AppShell } from "./AppShell";

// The shell mounts the sidebar, the tab bar, both editor surfaces, licensing
// and updates at once. Every one of those features reaches the backend through
// `lib/bindings`, so a single fake at that invoke layer stands the whole shell
// up — no per-feature api mocks.
vi.mock("../lib/bindings", async () => ({
  commands: (await import("../test/fakeBindings")).createFakeCommands(),
}));

// Menu items are emitted from Rust; the registry lets tests fire them.
const menuListeners = new Map<string, Set<() => void>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: () => void) => {
    const set = menuListeners.get(name) ?? new Set<() => void>();
    set.add(handler);
    menuListeners.set(name, set);
    return Promise.resolve(() => set.delete(handler));
  },
}));

// Both editors are CodeMirror, which needs layout jsdom doesn't do. The
// stand-ins keep the contracts the tabs depend on.
vi.mock("../features/query-editor/SqlEditor", () => ({
  SqlEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="SQL editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../features/query-editor/MiniSqlEditor", () => ({
  MiniSqlEditor: ({
    value,
    onChange,
    onApply,
    ref,
  }: {
    value: string;
    onChange: (v: string) => void;
    onApply: (v: string) => void;
    ref?: Ref<{ apply: () => void; getNormalizedValue: () => string }>;
  }) => {
    const [text, setText] = useState(value);
    const textRef = useRef(text);
    textRef.current = text;
    useEffect(() => { setText(value); }, [value]);
    useImperativeHandle(ref, () => ({
      apply: () => onApply(textRef.current),
      getNormalizedValue: () => textRef.current.trim(),
    }), [onApply]);
    return (
      <textarea
        aria-label="WHERE clause"
        value={text}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value); }}
      />
    );
  },
}));

// The virtualizer measures a scroll container jsdom never lays out, so it would
// yield zero rows. Rendering every row keeps the grid assertions meaningful.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
    scrollToIndex: () => {},
  }),
}));

import { commands } from "../lib/bindings";
import { resetFakeCommands, type FakeCommands } from "../test/fakeBindings";

const fakeCommands = commands as unknown as FakeCommands;

// ─── Fixture ─────────────────────────────────────────────────────────────────

const SESSION_ID = "session-1";
const TOTAL_ROWS = 3;

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

const COLUMNS: ResultColumn[] = [
  { name: "id", dataType: "int4", isNullable: false, isPrimaryKey: true, isForeignKey: false, isEnum: false },
  { name: "email", dataType: "text", isNullable: false, isPrimaryKey: false, isForeignKey: false, isEnum: false },
];

function serveFixturePage(_sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
  const ids = Array.from({ length: TOTAL_ROWS }, (_, i) => i + 1);
  return Promise.resolve({
    columns: COLUMNS,
    rows: ids.map((id): CellValue[] => [
      { t: "int", v: id },
      { t: "text", v: `user${id}@example.com` },
    ]),
    ctids: ids.map(() => null),
    page: request.page,
    pageSize: request.pageSize,
    executionMs: 2,
  });
}

const WELCOME_TAB: Tab = { id: "welcome", type: "welcome", title: "Welcome" };

const TABLE_TAB: Tab = {
  id: "tab-users",
  type: "table",
  title: "public.users",
  sessionId: SESSION_ID,
  tableContext: {
    database: "app",
    schema: "public",
    table: "users",
    connectionId: "conn-1",
    estimatedRows: TOTAL_ROWS,
    isView: false,
  },
};

// ─── Harness ─────────────────────────────────────────────────────────────────

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  // The same two providers `main.tsx` wraps the shell in.
  render(
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={500}>
        <AppShell />
      </Tooltip.Provider>
    </QueryClientProvider>,
  );
  return user;
}

/** Tab titles in the tab bar, left to right. */
function tabTitles(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

function tab(title: string): HTMLElement {
  const match = screen.getAllByRole("tab").find((t) => (t.textContent ?? "").includes(title));
  if (!match) throw new Error(`no tab titled ${title} — have ${tabTitles().join(", ")}`);
  return match;
}

function activeTabTitle(): string | undefined {
  return screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")
    ?.textContent ?? undefined;
}

/** Fires a menu event the way the Rust side does. */
function emitMenuEvent(name: string) {
  act(() => { menuListeners.get(name)?.forEach((handler) => handler()); });
}

function bodyRows(): HTMLElement[] {
  return screen.queryAllByRole("row").filter((row) => row.getAttribute("aria-rowindex") !== "1");
}

/** A body cell. Column 0 is the row-number gutter; fixture columns follow. */
function cell(rowIdx: number, colIdx: number): HTMLElement {
  return within(bodyRows()[rowIdx]).getAllByRole("gridcell")[colIdx];
}

function columnHeader(name: string): HTMLElement {
  const header = screen.getByTitle(`Filter by ${name}`).closest('[role="columnheader"]');
  if (!header) throw new Error(`no column header for ${name}`);
  return header as HTMLElement;
}

beforeAll(() => {
  // Radix popovers and dialogs position through floating-ui, which observes its
  // elements; the palette and the grid both scroll their selection into view.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

beforeEach(() => {
  menuListeners.clear();
  resetFakeCommands(fakeCommands);
  fakeCommands.queryTableData.mockImplementation(serveFixturePage);
  fakeCommands.queryTableCount.mockResolvedValue({ count: TOTAL_ROWS, isEstimate: false });
  useAppStore.setState({
    tabs: [WELCOME_TAB],
    activeTabId: WELCOME_TAB.id,
    profiles: [PROFILE],
    activeSessions: { "conn-1": SESSION_ID },
    commandPaletteOpen: false,
    pendingNewConnection: false,
    gridPageSize: 50,
    gridRowDensity: "compact",
    showTotalCount: true,
  });
});

// ─── Opening tabs ────────────────────────────────────────────────────────────

describe("opening tabs", () => {
  it("opens a query tab on ⌘T, bound to the live session", async () => {
    const user = renderShell();

    await user.keyboard("{Meta>}t{/Meta}");

    expect(tabTitles()).toEqual(["Welcome", "Query"]);
    expect(activeTabTitle()).toBe("Query");
    expect(useAppStore.getState().tabs.at(-1)).toMatchObject({
      type: "query",
      sessionId: SESSION_ID,
      queryContext: { sql: "", connectionId: "conn-1" },
    });
    expect(await screen.findByLabelText("SQL editor")).toBeDefined();
  });

  it("opens a query tab from the toolbar button", async () => {
    const user = renderShell();

    await user.click(screen.getByTitle("New Query (⌘T)"));

    expect(tabTitles()).toEqual(["Welcome", "Query"]);
  });

  it("opens the settings tab on ⌘, and renders the requested section", async () => {
    const user = renderShell();

    await user.keyboard("{Meta>},{/Meta}");

    expect(tabTitles()).toEqual(["Welcome", "Appearance"]);
    expect(useAppStore.getState().tabs.at(-1)).toMatchObject({ type: "settings" });
  });

  it("hands ⌘N to the sidebar's connection form rather than opening a tab", async () => {
    const user = renderShell();

    await user.keyboard("{Meta>}n{/Meta}");

    // The sidebar consumes the flag as it opens the form, so the dialog — not
    // the flag — is what's left to assert on.
    expect(await screen.findByLabelText("New connection")).toBeDefined();
    // The modal hides the rest of the shell from the a11y tree, so the tab
    // list is read from the store here.
    expect(useAppStore.getState().tabs.map((t) => t.title)).toEqual(["Welcome"]);
  });

  it("opens the command palette on ⌘K", async () => {
    const user = renderShell();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(useAppStore.getState().commandPaletteOpen).toBe(true);
    expect(await screen.findByLabelText("Search commands, tables, connections")).toBeDefined();
  });
});

// ─── Focusing an existing tab ────────────────────────────────────────────────

describe("focusing an existing tab", () => {
  it("reuses the open settings tab instead of stacking another one", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>},{/Meta}");
    await user.click(tab("Welcome"));
    expect(activeTabTitle()).toBe("Welcome");

    await user.keyboard("{Meta>},{/Meta}");

    expect(tabTitles()).toEqual(["Welcome", "Appearance"]);
    expect(activeTabTitle()).toBe("Appearance");
  });

  it("retitles the settings tab to the section the app menu asked for", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>},{/Meta}");

    emitMenuEvent("menu:open-about");

    expect(tabTitles()).toEqual(["Welcome", "About"]);
    expect(useAppStore.getState().tabs).toHaveLength(2);
  });

  it("opens settings from the app menu when none is open yet", async () => {
    renderShell();

    emitMenuEvent("menu:open-settings");

    await waitFor(() => expect(tabTitles()).toEqual(["Welcome", "Appearance"]));
  });

  it("jumps to a tab by ordinal with ⌘1", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>}t{/Meta}");
    expect(activeTabTitle()).toBe("Query");

    await user.keyboard("{Meta>}1{/Meta}");

    expect(activeTabTitle()).toBe("Welcome");
  });

  it("cycles tabs with ⌘⇧]", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>}t{/Meta}");
    await user.keyboard("{Meta>}t{/Meta}");
    await user.keyboard("{Meta>}1{/Meta}");

    // `[Code]` rather than `{Key}`: the shortcut keys off `e.code` so it
    // survives layouts where Shift turns "]" into "}".
    await user.keyboard("{Meta>}{Shift>}[BracketRight]{/Shift}{/Meta}");

    expect(activeTabTitle()).toBe("Query");
    expect(useAppStore.getState().activeTabId).toBe(useAppStore.getState().tabs[1].id);
  });
});

// ─── Closing tabs ────────────────────────────────────────────────────────────

describe("closing tabs", () => {
  it("closes the active tab on ⌘W and falls back to the last remaining one", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>}t{/Meta}");
    expect(tabTitles()).toEqual(["Welcome", "Query"]);

    await user.keyboard("{Meta>}w{/Meta}");

    expect(tabTitles()).toEqual(["Welcome"]);
    expect(activeTabTitle()).toBe("Welcome");
  });

  it("keeps the welcome tab when ⌘W lands on it", async () => {
    const user = renderShell();

    await user.keyboard("{Meta>}w{/Meta}");

    expect(tabTitles()).toEqual(["Welcome"]);
  });

  it("closes a tab from its close button without activating it first", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>}t{/Meta}");
    await user.keyboard("{Meta>},{/Meta}");
    expect(activeTabTitle()).toBe("Appearance");

    await user.click(within(tab("Query")).getByLabelText("Close Query"));

    expect(tabTitles()).toEqual(["Welcome", "Appearance"]);
    expect(activeTabTitle()).toBe("Appearance");
  });

  it("closes the other tabs from the tab context menu", async () => {
    const user = renderShell();
    await user.keyboard("{Meta>}t{/Meta}");
    await user.keyboard("{Meta>},{/Meta}");

    await user.pointer({ keys: "[MouseRight]", target: tab("Appearance") });
    await user.click(screen.getByRole("button", { name: "Close Others" }));

    expect(tabTitles()).toEqual(["Appearance"]);
    expect(activeTabTitle()).toBe("Appearance");
  });
});

// ─── The unsaved-edit guard ──────────────────────────────────────────────────

describe("the unsaved-edit guard", () => {
  /** Opens the table tab and puts one pending edit in the grid. */
  async function editACell() {
    useAppStore.setState({ tabs: [WELCOME_TAB, TABLE_TAB], activeTabId: TABLE_TAB.id });
    const user = renderShell();
    await screen.findByRole("grid");
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS));

    await user.dblClick(cell(0, 2));
    const input = await screen.findByLabelText("Edit cell value");
    await user.clear(input);
    await user.type(input, "ada@example.com{Enter}");
    await waitFor(() => expect(screen.getByText("1 unsaved change")).toBeDefined());
    return user;
  }

  it("marks the tab dirty in the tab bar", async () => {
    await editACell();

    expect(within(tab("public.users")).getByLabelText("Unsaved changes")).toBeDefined();
  });

  it("asks before a navigation that would drop the edit", async () => {
    const user = await editACell();

    await user.click(columnHeader("email"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard unsaved changes?")).toBeDefined();
  });

  it("keeps the edit and the current sort when the guard is cancelled", async () => {
    const user = await editACell();
    await user.click(columnHeader("email"));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(screen.getByText("1 unsaved change")).toBeDefined();
    expect(columnHeader("email").getAttribute("aria-sort")).toBe(null);
    expect(fakeCommands.queryTableData.mock.lastCall?.[1]).toMatchObject({ sortColumn: null });
  });

  it("drops the edit and navigates when the guard is confirmed", async () => {
    const user = await editACell();
    await user.click(columnHeader("email"));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByText(/unsaved change/)).toBe(null));
    await waitFor(() =>
      expect(fakeCommands.queryTableData.mock.lastCall?.[1]).toMatchObject({
        sortColumn: "email",
        sortDirection: "Asc",
      }),
    );
    expect(within(tab("public.users")).queryByLabelText("Unsaved changes")).toBe(null);
  });

  it("does not ask when there is nothing pending", async () => {
    useAppStore.setState({ tabs: [WELCOME_TAB, TABLE_TAB], activeTabId: TABLE_TAB.id });
    const user = renderShell();
    await screen.findByRole("grid");

    await user.click(columnHeader("email"));

    await waitFor(() =>
      expect(fakeCommands.queryTableData.mock.lastCall?.[1]).toMatchObject({ sortColumn: "email" }),
    );
    expect(screen.queryByText("Discard unsaved changes?")).toBe(null);
  });
});
