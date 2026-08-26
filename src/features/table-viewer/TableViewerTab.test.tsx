import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { ConfirmProvider } from "../../components/ConfirmDialog";
import { useAppStore, type Tab } from "../../store";
import type { ConnectionProfile } from "../../lib/bindings";
import type { CellValue, ResultColumn, TableQueryRequest, TableQueryResult } from "./types";
import { TableViewerTab } from "./TableViewerTab";

// The tab talks to the backend through `tableApi`; both reads are faked so the
// tests describe what the grid asks for (sort/page/filter/WHERE) and what it
// renders back.
const queryTableData = vi.fn<(sessionId: string, request: TableQueryRequest, signal?: AbortSignal) => Promise<TableQueryResult>>();
const queryTableCount = vi.fn<(sessionId: string, request: TableQueryRequest, signal?: AbortSignal) => Promise<{ count: number; isEstimate: boolean }>>();

vi.mock("./api", () => ({
  tableApi: {
    queryTableData: (sessionId: string, request: TableQueryRequest, signal?: AbortSignal) =>
      queryTableData(sessionId, request, signal),
    queryTableCount: (sessionId: string, request: TableQueryRequest, signal?: AbortSignal) =>
      queryTableCount(sessionId, request, signal),
    updateRows: () => Promise.resolve(),
    previewUpdateRowsSql: () => Promise.resolve(""),
    deleteRows: () => Promise.resolve([]),
    previewDeleteRowsSql: () => Promise.resolve(""),
  },
}));

// The WHERE bar is CodeMirror, which needs layout jsdom doesn't do. This
// stand-in keeps the contract the tab depends on: it owns the live text (the
// tab only sees it on apply) and exposes the same imperative handle the "Run"
// button calls.
vi.mock("../query-editor/MiniSqlEditor", () => ({
  MiniSqlEditor: ({
    value,
    onChange,
    onApply,
    onClear,
    ref,
  }: {
    value: string;
    onChange: (v: string) => void;
    onApply: (v: string) => void;
    onClear: () => void;
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
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onApply(textRef.current); }
          if (e.key === "Escape") { e.preventDefault(); onClear(); }
        }}
      />
    );
  },
}));

// The virtualizer measures a scroll container jsdom never lays out, so it would
// yield zero rows. Rendering every row keeps the assertions about the grid.
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

// ─── Fixture ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const TOTAL_ROWS = 70;

const COLUMNS: ResultColumn[] = [
  { name: "id", dataType: "int4", isNullable: false, isPrimaryKey: true, isForeignKey: false, isEnum: false },
  { name: "email", dataType: "text", isNullable: false, isPrimaryKey: false, isForeignKey: false, isEnum: false },
  { name: "created_at", dataType: "timestamptz", isNullable: true, isPrimaryKey: false, isForeignKey: false, isEnum: false },
];

function fixtureRow(id: number): CellValue[] {
  return [
    { t: "int", v: id },
    { t: "text", v: `user${id}@example.com` },
    { t: "other", v: `2026-01-01T00:00:${String(id % 60).padStart(2, "0")}Z` },
  ];
}

/** Serves the fixture table, honouring only the paging the assertions read back. */
function serveFixturePage(_sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
  const first = request.page * request.pageSize + 1;
  const last = Math.min(TOTAL_ROWS, (request.page + 1) * request.pageSize);
  const ids = last < first ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return Promise.resolve({
    columns: COLUMNS,
    rows: ids.map(fixtureRow),
    ctids: ids.map(() => null),
    page: request.page,
    pageSize: request.pageSize,
    executionMs: 4,
    // The backend probes one row past the page; mirror that here.
    hasMore: last < TOTAL_ROWS,
  });
}

const TAB: Tab = {
  id: "tab-1",
  type: "table",
  title: "users",
  sessionId: "session-1",
  tableContext: {
    database: "app",
    schema: "public",
    table: "users",
    connectionId: "conn-1",
    estimatedRows: TOTAL_ROWS,
    isView: false,
  },
};

const PROFILE = {
  id: "conn-1",
  displayName: "Local",
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

// ─── Harness ─────────────────────────────────────────────────────────────────

/** The last `query_table_data` request — what the grid's controls produced. */
function lastDataRequest(): TableQueryRequest {
  const call = queryTableData.mock.calls.at(-1);
  if (!call) throw new Error("queryTableData was never called");
  return call[1];
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider>
        <ToastProvider>
          <ConfirmProvider>{ui}</ConfirmProvider>
        </ToastProvider>
      </Tooltip.Provider>
    </QueryClientProvider>,
  );
}

/** Renders the tab and waits for the first page to land. */
async function renderTableViewer(contextOverrides: Partial<Tab["tableContext"]> = {}) {
  const user = userEvent.setup();
  const tab: Tab = { ...TAB, tableContext: { ...TAB.tableContext!, ...contextOverrides } };
  renderWithProviders(<TableViewerTab tab={tab} />);
  await screen.findByRole("grid");
  await waitFor(() => expect(queryTableData).toHaveBeenCalledTimes(1));
  return user;
}

/** Body rows only — `getAllByRole("row")` also returns the header row. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").filter((row) => row.getAttribute("aria-rowindex") !== "1");
}

/** A row's cells left to right, gutter first. */
function rowText(row: HTMLElement): string[] {
  return within(row).getAllByRole("gridcell").map((cell) => cell.textContent ?? "");
}

function columnHeader(name: string): HTMLElement {
  const header = screen.getByTitle(`Filter by ${name}`).closest('[role="columnheader"]');
  if (!header) throw new Error(`no column header for ${name}`);
  return header as HTMLElement;
}

/** The applied-WHERE chip in the filter bar (not the editor's own text). */
function whereChip(): HTMLElement {
  const label = screen.getByText("WHERE");
  if (!label.parentElement) throw new Error("WHERE chip has no container");
  return label.parentElement;
}

beforeAll(() => {
  // Radix popovers position through floating-ui, which observes its elements.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  queryTableData.mockReset();
  queryTableData.mockImplementation(serveFixturePage);
  queryTableCount.mockReset();
  queryTableCount.mockResolvedValue({ count: TOTAL_ROWS, isEstimate: false });
  useAppStore.setState({
    profiles: [PROFILE],
    activeSessions: { "conn-1": "session-1" },
    gridPageSize: PAGE_SIZE,
    gridRowDensity: "compact",
    showTotalCount: true,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("row rendering", () => {
  it("renders a header per column and a row per fixture row", async () => {
    await renderTableViewer();

    expect(screen.getAllByRole("columnheader").map((h) => within(h).getByTitle(/^Filter by /).title))
      .toEqual(["Filter by id", "Filter by email", "Filter by created_at"]);
    expect(bodyRows()).toHaveLength(PAGE_SIZE);

    // Cell 1 is the row-number gutter; the fixture columns follow.
    expect(rowText(bodyRows()[0])).toEqual(["1", "1", "user1@example.com", "2026-01-01T00:00:01Z"]);
    expect(rowText(bodyRows()[PAGE_SIZE - 1])).toEqual([
      "50",
      "50",
      "user50@example.com",
      "2026-01-01T00:00:50Z",
    ]);
  });

  it("requests the first page unsorted and unfiltered", async () => {
    await renderTableViewer();

    expect(lastDataRequest()).toMatchObject({
      database: "app",
      schema: "public",
      table: "users",
      filters: [],
      rawWhere: null,
      sortColumn: null,
      sortDirection: null,
      page: 0,
      pageSize: PAGE_SIZE,
    });
  });
});

describe("sorting", () => {
  it("cycles a column through ascending, descending and unsorted", async () => {
    const user = await renderTableViewer();

    await user.click(columnHeader("email"));
    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({ sortColumn: "email", sortDirection: "Asc" }),
    );
    expect(columnHeader("email").getAttribute("aria-sort")).toBe("ascending");

    await user.click(columnHeader("email"));
    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({ sortColumn: "email", sortDirection: "Desc" }),
    );
    expect(columnHeader("email").getAttribute("aria-sort")).toBe("descending");

    await user.click(columnHeader("email"));
    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({ sortColumn: null, sortDirection: null }),
    );
    expect(columnHeader("email").getAttribute("aria-sort")).toBe(null);
  });

  it("sorts ascending when switching to another column", async () => {
    const user = await renderTableViewer();

    await user.click(columnHeader("email"));
    await user.click(columnHeader("email"));
    await user.click(columnHeader("created_at"));

    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({ sortColumn: "created_at", sortDirection: "Asc" }),
    );
    expect(columnHeader("email").getAttribute("aria-sort")).toBe(null);
  });

  it("returns to the first page when the sort changes", async () => {
    const user = await renderTableViewer();

    await user.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(lastDataRequest().page).toBe(1));

    await user.click(columnHeader("id"));

    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({ page: 0, sortColumn: "id", sortDirection: "Asc" }),
    );
  });
});

describe("pagination", () => {
  it("steps forward and back, enabling each control at the right edge", async () => {
    const user = await renderTableViewer();

    const next = screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement;
    const prev = screen.getByRole("button", { name: /Prev/ }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    await user.click(next);

    await waitFor(() => expect(lastDataRequest().page).toBe(1));
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS - PAGE_SIZE));
    expect(within(bodyRows()[0]).getByText("user51@example.com")).toBeDefined();
    // Last page: nothing further to fetch, but going back is now possible.
    expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Prev/ }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: /Prev/ }));

    await waitFor(() => expect(lastDataRequest().page).toBe(0));
    await waitFor(() => expect(bodyRows()).toHaveLength(PAGE_SIZE));
    expect((screen.getByRole("button", { name: /Prev/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("steps forward on the backend's probe row when the total count is disabled", async () => {
    // No count to compare against, and no estimate either: `hasMore` decides.
    useAppStore.setState({ showTotalCount: false });
    const user = await renderTableViewer({ estimatedRows: null });

    const next = screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(queryTableCount).not.toHaveBeenCalled();

    await user.click(next);

    await waitFor(() => expect(lastDataRequest().page).toBe(1));
    // Final page: the probe row came back empty, so Next locks.
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it("locks Next on an exactly-full last page when the total count is disabled", async () => {
    // A full page used to imply "there is more"; only the probe row can tell
    // that this page ends the table.
    useAppStore.setState({ showTotalCount: false });
    queryTableData.mockImplementation((_sessionId, request) =>
      Promise.resolve({
        columns: COLUMNS,
        rows: Array.from({ length: request.pageSize }, (_, i) => fixtureRow(i + 1)),
        ctids: Array.from({ length: request.pageSize }, () => null),
        page: request.page,
        pageSize: request.pageSize,
        executionMs: 2,
        hasMore: false,
      }),
    );

    await renderTableViewer({ estimatedRows: null });

    expect(bodyRows()).toHaveLength(PAGE_SIZE);
    expect((screen.getByRole("button", { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("column filters", () => {
  it("applies a filter from the column popover and shows it as a chip", async () => {
    const user = await renderTableViewer();

    await user.click(screen.getByTitle("Filter by email"));
    await user.type(await screen.findByLabelText("Filter value"), "user7@example.com");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({
        filters: [{ column: "email", operator: "Eq", value: "user7@example.com" }],
        page: 0,
      }),
    );

    expect(screen.getByRole("button", { name: /email='user7@example\.com'/ })).toBeDefined();
  });

  it("drops the filter again when the chip is dismissed", async () => {
    const user = await renderTableViewer();

    await user.click(screen.getByTitle("Filter by email"));
    await user.type(await screen.findByLabelText("Filter value"), "user7@example.com");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(lastDataRequest().filters).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => expect(lastDataRequest().filters).toEqual([]));
    expect(screen.queryByRole("button", { name: /Clear all/ })).toBe(null);
  });

  it("keeps a filter applied while paging and sorting", async () => {
    const user = await renderTableViewer();

    await user.click(screen.getByTitle("Filter by email"));
    await user.type(await screen.findByLabelText("Filter value"), "user");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(lastDataRequest().filters).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Next/ }));

    await waitFor(() =>
      expect(lastDataRequest()).toMatchObject({
        page: 1,
        filters: [{ column: "email", operator: "Eq", value: "user" }],
      }),
    );
  });
});

describe("raw WHERE", () => {
  it("sends the clause on Run and shows it as a chip", async () => {
    const user = await renderTableViewer();

    await user.type(await screen.findByLabelText("WHERE clause"), "id > 3");
    await user.click(screen.getByTitle("Run filter"));

    await waitFor(() => expect(lastDataRequest()).toMatchObject({ rawWhere: "id > 3", page: 0 }));
    expect(whereChip().textContent).toContain("id > 3");
  });

  it("resets to the first page and clears via the chip", async () => {
    const user = await renderTableViewer();

    await user.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(lastDataRequest().page).toBe(1));

    await user.type(await screen.findByLabelText("WHERE clause"), "id > 3");
    await user.click(screen.getByTitle("Run filter"));
    await waitFor(() => expect(lastDataRequest()).toMatchObject({ rawWhere: "id > 3", page: 0 }));

    await user.click(within(whereChip()).getByRole("button"));

    await waitFor(() => expect(lastDataRequest().rawWhere).toBe(null));
    expect(screen.queryByText("WHERE")).toBe(null);
    expect((screen.getByLabelText("WHERE clause") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("query supersession", () => {
  it("aborts a slow superseded fetch and does not let it overwrite newer data", async () => {
    const user = await renderTableViewer();

    const resolvers = new Map<string, (result: TableQueryResult) => void>();
    const signals = new Map<string, AbortSignal | undefined>();
    queryTableData.mockImplementation((_sessionId, request, signal) => {
      const key = request.rawWhere ?? "";
      signals.set(key, signal);
      return new Promise<TableQueryResult>((resolve) => {
        resolvers.set(key, resolve);
      });
    });

    const resultFor = (id: number): TableQueryResult => ({
      columns: COLUMNS,
      rows: [fixtureRow(id)],
      ctids: [null],
      page: 0,
      pageSize: PAGE_SIZE,
      executionMs: 1,
      hasMore: false,
    });

    // First request (stays pending — simulates a slow query).
    await user.type(await screen.findByLabelText("WHERE clause"), "id > 1");
    await user.click(screen.getByTitle("Run filter"));
    await waitFor(() => expect(signals.has("id > 1")).toBe(true));

    // Superseding request before the first resolves.
    await user.clear(screen.getByLabelText("WHERE clause"));
    await user.type(screen.getByLabelText("WHERE clause"), "id > 2");
    await user.click(screen.getByTitle("Run filter"));
    await waitFor(() => expect(signals.has("id > 2")).toBe(true));

    // React Query aborts the outdated fetch once no observer wants it anymore.
    await waitFor(() => expect(signals.get("id > 1")?.aborted).toBe(true));

    // The newer request resolves first...
    resolvers.get("id > 2")!(resultFor(99));
    await waitFor(() => expect(screen.queryByText("user99@example.com")).not.toBeNull());

    // ...then the stale, superseded response finally arrives. It must not
    // clobber the newer data that's already on screen.
    resolvers.get("id > 1")!(resultFor(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("user99@example.com")).toBeDefined();
    expect(screen.queryByText("user1@example.com")).toBeNull();
  });
});

describe("footer", () => {
  it("reports the rendered range and the exact total", async () => {
    const user = await renderTableViewer();

    expect(await screen.findByText(`Showing 1–${PAGE_SIZE} of ${TOTAL_ROWS} rows`)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Next/ }));

    expect(
      await screen.findByText(`Showing ${PAGE_SIZE + 1}–${TOTAL_ROWS} of ${TOTAL_ROWS} rows`),
    ).toBeDefined();
  });

  it("marks the total as an estimate when the backend estimates it", async () => {
    queryTableCount.mockResolvedValue({ count: 1234, isEstimate: true });

    await renderTableViewer();

    expect(await screen.findByText(`Showing 1–${PAGE_SIZE} of ~1,234 rows`)).toBeDefined();
  });

  it("reports no rows when the table is empty", async () => {
    queryTableCount.mockResolvedValue({ count: 0, isEstimate: false });
    queryTableData.mockImplementation((_sessionId, request) =>
      Promise.resolve({
        columns: COLUMNS,
        rows: [],
        ctids: [],
        page: request.page,
        pageSize: request.pageSize,
        executionMs: 1,
        hasMore: false,
      }),
    );

    await renderTableViewer();

    expect(await screen.findByText("No rows")).toBeDefined();
    expect(screen.getByText("This table is empty")).toBeDefined();
  });
});

describe("slow query notice", () => {
  // Fake timers drive the one-second threshold; the data query is held open by
  // hand so the tab stays in its loading state for as long as the test needs.
  function deferredDataQuery() {
    let release!: () => void;
    queryTableData.mockImplementation(
      (sessionId, request) =>
        new Promise<TableQueryResult>((resolve) => {
          release = () => resolve(serveFixturePage(sessionId, request));
        }),
    );
    return () => release();
  }

  it("says the query is still running once it passes one second", async () => {
    vi.useFakeTimers();
    try {
      const finishQuery = deferredDataQuery();
      renderWithProviders(<TableViewerTab tab={TAB} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(screen.queryByText("Still running…")).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByRole("status").textContent).toContain("Still running…");

      // It clears as soon as the rows land.
      await act(async () => { finishQuery(); await vi.advanceTimersByTimeAsync(0); });
      expect(screen.queryByText("Still running…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet for a query that finishes inside a second", async () => {
    vi.useFakeTimers();
    try {
      const finishQuery = deferredDataQuery();
      renderWithProviders(<TableViewerTab tab={TAB} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      await act(async () => { finishQuery(); await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

      expect(screen.queryByText("Still running…")).toBeNull();
      expect(screen.getByRole("grid")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
