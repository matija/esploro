import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { useAppStore, type Tab } from "../../store";
import type { ConnectionProfile } from "../../lib/bindings";
import type { CellValue, ResultColumn } from "../table-viewer/types";
import type { QueryResult } from "./types";
import { QueryEditorTab } from "./QueryEditorTab";

// The tab's only backend call is `executeSql`; faking it lets the tests describe
// what a run sends and what the result pane makes of the statements it gets back.
const executeSql = vi.fn<(sessionId: string, sql: string) => Promise<QueryResult[]>>();
const saveQuery = vi.fn<(params: { name: string; folder?: string; sql: string }) => Promise<string>>();

vi.mock("./api", () => ({
  queryEditorApi: {
    executeSql: (sessionId: string, sql: string) => executeSql(sessionId, sql),
  },
  savedQueriesApi: {
    list: () => Promise.resolve([]),
    save: (params: { name: string; folder?: string; sql: string }) => saveQuery(params),
    get: () => Promise.reject(new Error("not stubbed")),
    delete: () => Promise.resolve(),
  },
}));

// The editor is CodeMirror behind a `lazy()` boundary and needs layout jsdom
// doesn't do. This stand-in keeps the contract the tab depends on: it owns the
// text, reports changes, and runs on ⌘↵.
vi.mock("./SqlEditor", () => ({
  SqlEditor: ({
    value,
    onChange,
    onRun,
  }: {
    value: string;
    onChange: (v: string) => void;
    onRun: (v: string) => void;
  }) => (
    <textarea
      aria-label="SQL editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onRun(value);
        }
      }}
    />
  ),
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

const COLUMNS: ResultColumn[] = [
  { name: "id", dataType: "int4", isNullable: false, isPrimaryKey: true, isForeignKey: false, isEnum: false },
  { name: "email", dataType: "text", isNullable: true, isPrimaryKey: false, isForeignKey: false, isEnum: false },
];

const ROWS: CellValue[][] = [
  [{ t: "int", v: 1 }, { t: "text", v: "ada@example.com" }],
  [{ t: "int", v: 2 }, { t: "null" }],
];

function selectResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: COLUMNS,
    rows: ROWS,
    rowsAffected: null,
    executionMs: 12,
    error: null,
    ...overrides,
  };
}

const SQL = "select id, email from users;";

const TAB: Tab = {
  id: "tab-1",
  type: "query",
  title: "Query",
  sessionId: "session-1",
  queryContext: { sql: SQL, connectionId: "conn-1" },
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

/** A promise the test resolves by hand, to hold a run in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

/** Renders the tab and waits for the lazy editor to arrive. */
async function renderEditor(tab: Tab = TAB) {
  const user = userEvent.setup();
  renderWithProviders(<QueryEditorTab tab={tab} />);
  await screen.findByLabelText("SQL editor");
  return user;
}

function runButton(): HTMLButtonElement {
  return screen.getByTitle("Run query (⌘↵)") as HTMLButtonElement;
}

/** A result grid's body cells, left to right, top to bottom. */
function gridText(): string[] {
  return screen.getAllByRole("gridcell").map((cell) => cell.textContent ?? "");
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  executeSql.mockReset();
  executeSql.mockResolvedValue([selectResult()]);
  saveQuery.mockReset();
  saveQuery.mockResolvedValue("saved-1");
  useAppStore.setState({
    profiles: [PROFILE],
    activeSessions: { "conn-1": "session-1" },
    tabs: [TAB],
    activeTabId: TAB.id,
    gridRowDensity: "compact",
    lastAction: null,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("running a query", () => {
  it("shows no result pane until the first run", async () => {
    await renderEditor();

    expect(screen.queryByText(/to run the query/)).toBe(null);
    expect(screen.queryByRole("separator", { name: "Resize result pane" })).toBe(null);
  });

  it("sends the editor's SQL on the live session and renders the rows", async () => {
    const user = await renderEditor();

    await user.click(runButton());

    await waitFor(() => expect(executeSql).toHaveBeenCalledWith("session-1", SQL));
    expect(await screen.findByText("2 rows")).toBeDefined();
    expect(gridText()).toEqual(["1", "ada@example.com", "2", "NULL"]);
    expect(screen.getByTitle("id")).toBeDefined();
    expect(screen.getByTitle("email")).toBeDefined();
    expect(screen.getByText("12ms")).toBeDefined();
    // A single statement gets no "Result n" heading.
    expect(screen.queryByText("Result 1")).toBe(null);
  });

  it("reports progress on the Run button and summarises the run", async () => {
    const run = deferred<QueryResult[]>();
    executeSql.mockReturnValue(run.promise);
    const user = await renderEditor();

    await user.click(runButton());

    expect(runButton().textContent).toContain("Running");
    expect(runButton().disabled).toBe(true);

    run.resolve([selectResult()]);

    await waitFor(() => expect(runButton().textContent).toContain("Done"));
    expect(await screen.findByText("Query completed — 2 rows — 12ms")).toBeDefined();
    expect(useAppStore.getState().lastAction).toMatchObject({
      label: "Query executed",
      durationMs: 12,
      rowCount: 2,
    });
  });

  it("runs the current editor text on ⌘↵", async () => {
    const user = await renderEditor();
    const editor = screen.getByLabelText("SQL editor");

    await user.clear(editor);
    await user.type(editor, "select 42;");
    await user.type(editor, "{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(executeSql).toHaveBeenCalledWith("session-1", "select 42;"));
  });

  it("renders an empty pane when the statement returns nothing at all", async () => {
    executeSql.mockResolvedValue([]);
    const user = await renderEditor();

    await user.click(runButton());

    expect(await screen.findByText(/to run the query/)).toBeDefined();
    expect(screen.queryAllByRole("gridcell")).toEqual([]);
  });

  it("cannot be run without a live session", async () => {
    useAppStore.setState({ activeSessions: {} });
    await renderEditor();

    expect(runButton().disabled).toBe(true);
  });

  it("refuses to render at all without a connection", async () => {
    renderWithProviders(<QueryEditorTab tab={{ ...TAB, queryContext: { sql: SQL } }} />);

    expect(await screen.findByText("No connection — pick one")).toBeDefined();
    expect(screen.queryByTitle("Run query (⌘↵)")).toBe(null);
  });
});

describe("multi-statement results", () => {
  const MULTI: QueryResult[] = [
    selectResult(),
    { columns: [], rows: [], rowsAffected: 3, executionMs: 5, error: null },
    selectResult({ rows: [], executionMs: 2 }),
  ];

  it("labels each statement and reports its own outcome", async () => {
    executeSql.mockResolvedValue(MULTI);
    const user = await renderEditor();

    await user.click(runButton());

    expect(await screen.findByText("Result 1")).toBeDefined();
    expect(screen.getByText("Result 2")).toBeDefined();
    expect(screen.getByText("Result 3")).toBeDefined();

    // Statement 1 returned rows, 2 affected rows, 3 returned columns but no rows.
    expect(screen.getByText("2 rows")).toBeDefined();
    expect(screen.getByText("3 rows affected")).toBeDefined();
    expect(screen.getByText("0 rows")).toBeDefined();
    expect(screen.getByText("No rows returned.")).toBeDefined();
    expect(gridText()).toEqual(["1", "ada@example.com", "2", "NULL"]);
  });

  it("totals rows and time across the statements", async () => {
    executeSql.mockResolvedValue(MULTI);
    const user = await renderEditor();

    await user.click(runButton());

    expect(await screen.findByText("Query completed — 2 rows — 19ms")).toBeDefined();
    expect(useAppStore.getState().lastAction).toMatchObject({
      label: "Query executed",
      durationMs: 19,
      rowCount: 2,
    });
  });

  it("singularises a lone affected row", async () => {
    executeSql.mockResolvedValue([
      { columns: [], rows: [], rowsAffected: 1, executionMs: 4, error: null },
    ]);
    const user = await renderEditor();

    await user.click(runButton());

    expect(await screen.findByText("1 row affected")).toBeDefined();
    expect(screen.queryByText("Result 1")).toBe(null);
  });
});

describe("SQL errors", () => {
  it("surfaces a failing statement without dropping the ones that succeeded", async () => {
    executeSql.mockResolvedValue([
      selectResult(),
      {
        columns: [],
        rows: [],
        rowsAffected: null,
        executionMs: 1,
        error: { message: 'relation "userz" does not exist', position: 15, code: "42P01" },
      },
    ]);
    const user = await renderEditor();

    await user.click(runButton());

    // Once in the failing section's header, once in the summary above the pane.
    const messages = await screen.findAllByText('relation "userz" does not exist');
    expect(messages).toHaveLength(2);
    expect(screen.getByText("42P01")).toBeDefined();
    expect(await screen.findByText('Query error: relation "userz" does not exist')).toBeDefined();
    expect(runButton().textContent).toContain("Error");
    // The first statement's grid survives the second statement's failure.
    expect(gridText()).toEqual(["1", "ada@example.com", "2", "NULL"]);
    expect(useAppStore.getState().lastAction).toMatchObject({ label: "Query error" });
  });

  it("surfaces a run that never reached the server", async () => {
    executeSql.mockRejectedValue(new Error("Session not found"));
    const user = await renderEditor();

    await user.click(runButton());

    expect(await screen.findByText("Session not found")).toBeDefined();
    expect(await screen.findByText("Query failed: Session not found")).toBeDefined();
    expect(runButton().textContent).toContain("Error");
    expect(screen.queryAllByRole("gridcell")).toEqual([]);
    // No result pane content, but the pane itself opens after a run.
    expect(screen.getByText(/to run the query/)).toBeDefined();
  });

  it("clears the previous error when the next run starts", async () => {
    executeSql.mockRejectedValueOnce(new Error("Session not found"));
    const user = await renderEditor();

    await user.click(runButton());
    await screen.findByText("Session not found");

    const rerun = deferred<QueryResult[]>();
    executeSql.mockReturnValue(rerun.promise);
    await user.click(runButton());

    expect(screen.queryByText("Session not found")).toBe(null);

    rerun.resolve([selectResult()]);

    expect(await screen.findByText("2 rows")).toBeDefined();
  });
});
