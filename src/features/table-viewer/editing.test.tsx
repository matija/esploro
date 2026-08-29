import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { ConfirmProvider } from "../../components/ConfirmDialog";
import { useAppStore, type Tab } from "../../store";
import type { ConnectionProfile } from "../../lib/bindings";
import type {
  CellValue,
  DeleteRowResult,
  DeleteRowsRequest,
  InsertRowResult,
  InsertRowsRequest,
  ResultColumn,
  TableQueryRequest,
  TableQueryResult,
} from "./types";
import { TableViewerTab } from "./TableViewerTab";

// Companion to TableViewerTab.test.tsx, which covers reading the grid. This
// file covers the write paths: the inline cell editor and row deletion. Both
// are driven through `user-event` so the assertions describe the gestures a
// user makes, and the write half of `tableApi` is faked so the tests can read
// back the payloads the grid built.
const queryTableData = vi.fn<(sessionId: string, request: TableQueryRequest) => Promise<TableQueryResult>>();
const queryTableCount = vi.fn<(sessionId: string, request: TableQueryRequest) => Promise<{ count: number; isEstimate: boolean }>>();
const deleteRows = vi.fn<(sessionId: string, request: DeleteRowsRequest) => Promise<DeleteRowResult[]>>();
const previewDeleteRowsSql = vi.fn<(sessionId: string, request: DeleteRowsRequest) => Promise<string>>();
const insertRows = vi.fn<(sessionId: string, request: InsertRowsRequest) => Promise<InsertRowResult[]>>();
const previewInsertRowsSql = vi.fn<(sessionId: string, request: InsertRowsRequest) => Promise<string>>();

vi.mock("./api", () => ({
  tableApi: {
    queryTableData: (sessionId: string, request: TableQueryRequest) => queryTableData(sessionId, request),
    queryTableCount: (sessionId: string, request: TableQueryRequest) => queryTableCount(sessionId, request),
    updateRows: () => Promise.resolve(),
    previewUpdateRowsSql: () => Promise.resolve(""),
    deleteRows: (sessionId: string, request: DeleteRowsRequest) => deleteRows(sessionId, request),
    previewDeleteRowsSql: (sessionId: string, request: DeleteRowsRequest) =>
      previewDeleteRowsSql(sessionId, request),
    insertRows: (sessionId: string, request: InsertRowsRequest) => insertRows(sessionId, request),
    previewInsertRowsSql: (sessionId: string, request: InsertRowsRequest) =>
      previewInsertRowsSql(sessionId, request),
  },
}));

// The WHERE bar is CodeMirror, which needs layout jsdom doesn't do. None of
// these tests touch it; the stub just keeps the tab renderable.
vi.mock("../query-editor/MiniSqlEditor", () => ({
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
const TOTAL_ROWS = 4;

// `id` is the primary key, so both UPDATE and DELETE key off it rather than a
// ctid — the payload assertions below read those PK conditions back.
const COLUMNS: ResultColumn[] = [
  { name: "id", dataType: "int4", isNullable: false, isPrimaryKey: true, isForeignKey: false, isEnum: false },
  { name: "email", dataType: "text", isNullable: false, isPrimaryKey: false, isForeignKey: false, isEnum: false },
  { name: "created_at", dataType: "timestamptz", isNullable: true, isPrimaryKey: false, isForeignKey: false, isEnum: false },
];

function fixtureRow(id: number): CellValue[] {
  return [
    { t: "int", v: id },
    { t: "text", v: `user${id}@example.com` },
    { t: "other", v: `2026-01-01T00:00:0${id}Z` },
  ];
}

function serveFixturePage(_sessionId: string, request: TableQueryRequest): Promise<TableQueryResult> {
  const ids = Array.from({ length: TOTAL_ROWS }, (_, i) => i + 1);
  return Promise.resolve({
    columns: COLUMNS,
    rows: ids.map(fixtureRow),
    ctids: ids.map(() => null),
    page: request.page,
    pageSize: request.pageSize,
    executionMs: 4,
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
async function renderTableViewer() {
  const user = userEvent.setup();
  renderWithProviders(<TableViewerTab tab={TAB} />);
  await screen.findByRole("grid");
  await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS));
  return user;
}

/** Body rows only — `getAllByRole("row")` also returns the header row. */
function bodyRows(): HTMLElement[] {
  return screen.queryAllByRole("row").filter((row) => row.getAttribute("aria-rowindex") !== "1");
}

/**
 * A body cell. Column 0 is the row-number gutter; the fixture columns follow in
 * the order the grid displays them (`id`, `email`, `created_at`).
 */
function cell(rowIdx: number, colIdx: number): HTMLElement {
  return within(bodyRows()[rowIdx]).getAllByRole("gridcell")[colIdx];
}

function gutter(rowIdx: number): HTMLElement {
  return cell(rowIdx, 0);
}

/** The open inline editor, wherever it currently is. */
function editorInput(): HTMLInputElement {
  return screen.getByLabelText("Edit cell value") as HTMLInputElement;
}

/** Opens the inline editor on a cell the way a user does. */
async function startEditing(user: ReturnType<typeof userEvent.setup>, rowIdx: number, colIdx: number) {
  await user.dblClick(cell(rowIdx, colIdx));
  return await screen.findByLabelText("Edit cell value");
}

/** Selects a single row by clicking its gutter, optionally holding a modifier. */
async function clickGutter(
  user: ReturnType<typeof userEvent.setup>,
  rowIdx: number,
  modifier?: "Shift" | "Meta",
) {
  if (!modifier) {
    await user.click(gutter(rowIdx));
    return;
  }
  await user.keyboard(`{${modifier}>}`);
  await user.click(gutter(rowIdx));
  await user.keyboard(`{/${modifier}}`);
}

function columnHeader(name: string): HTMLElement {
  const header = screen.getByTitle(`Filter by ${name}`).closest('[role="columnheader"]');
  if (!header) throw new Error(`no column header for ${name}`);
  return header as HTMLElement;
}

/** Opens the cell context menu on a body cell, the way a right-click does. */
function openCellMenu(rowIdx: number, colIdx: number) {
  fireEvent.contextMenu(cell(rowIdx, colIdx));
}

/** Duplicates a row via its context menu, the way a user does. */
async function duplicateRowViaMenu(user: ReturnType<typeof userEvent.setup>, rowIdx: number) {
  openCellMenu(rowIdx, 1);
  await user.click(screen.getByRole("button", { name: "Duplicate row" }));
}

beforeAll(() => {
  // Radix popovers and dialogs position through floating-ui, which observes
  // its elements.
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
  deleteRows.mockReset();
  deleteRows.mockImplementation((_sessionId, request) =>
    Promise.resolve(request.rows.map(() => ({ sql: "DELETE …", error: null }))),
  );
  previewDeleteRowsSql.mockReset();
  previewDeleteRowsSql.mockResolvedValue(
    `DELETE FROM "public"."users" WHERE "id" = 1;`,
  );
  insertRows.mockReset();
  insertRows.mockImplementation((_sessionId, request) =>
    Promise.resolve(request.rows.map(() => ({ sql: "INSERT …", error: null }))),
  );
  previewInsertRowsSql.mockReset();
  previewInsertRowsSql.mockResolvedValue(
    `INSERT INTO "public"."users" ("email") VALUES ('user1@example.com');`,
  );
  useAppStore.setState({
    profiles: [PROFILE],
    activeSessions: { "conn-1": "session-1" },
    gridPageSize: PAGE_SIZE,
    gridRowDensity: "compact",
    showTotalCount: true,
  });
});

// ─── Cell editing ────────────────────────────────────────────────────────────

describe("cell editing", () => {
  it("opens an editor seeded with the cell's current value on double-click", async () => {
    const user = await renderTableViewer();

    const input = await startEditing(user, 0, 2);

    expect((input as HTMLInputElement).value).toBe("user1@example.com");
    // The editor replaces the rendered value inside that one cell only.
    expect(within(cell(0, 2)).getByLabelText("Edit cell value")).toBe(input);
    expect(screen.getAllByLabelText("Edit cell value")).toHaveLength(1);
    expect(cell(1, 2).textContent).toBe("user2@example.com");
  });

  it("commits the draft on Enter and stages it as a pending change", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "renamed@example.com{Enter}");

    await waitFor(() => expect(screen.queryByLabelText("Edit cell value")).toBe(null));
    expect(cell(0, 2).textContent).toBe("renamed@example.com");
    // Staged, not saved: the save bar appears and the row is flagged as dirty.
    expect(screen.getByText("1 unsaved change")).toBeDefined();
    expect(within(gutter(0)).getByLabelText("Unsaved changes")).toBeDefined();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDefined();
  });

  it("keeps the original value on Escape", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "discarded@example.com");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByLabelText("Edit cell value")).toBe(null));
    expect(cell(0, 2).textContent).toBe("user1@example.com");
    expect(screen.queryByText(/unsaved change/)).toBe(null);
    expect(within(gutter(0)).queryByLabelText("Unsaved changes")).toBe(null);
  });

  it("drops the pending change when the draft is edited back to the original", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "renamed@example.com{Enter}");
    await waitFor(() => expect(screen.getByText("1 unsaved change")).toBeDefined());

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "user1@example.com{Enter}");

    await waitFor(() => expect(screen.queryByText(/unsaved change/)).toBe(null));
    expect(cell(0, 2).textContent).toBe("user1@example.com");
  });

  it("commits and moves to the next cell in the row on Tab", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 1);
    await user.clear(editorInput());
    await user.type(editorInput(), "99");
    await user.keyboard("{Tab}");

    // The editor is now on `email`, seeded with that cell's value…
    await waitFor(() => expect(within(cell(0, 2)).getByLabelText("Edit cell value")).toBeDefined());
    expect(editorInput().value).toBe("user1@example.com");
    // …and the `id` draft was committed on the way out.
    expect(cell(0, 1).textContent).toBe("99");
    expect(screen.getByText("1 unsaved change")).toBeDefined();
  });

  it("walks Tab through the row and closes the editor past the last column", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 1);
    await user.keyboard("{Tab}");
    await waitFor(() => expect(within(cell(0, 2)).getByLabelText("Edit cell value")).toBeDefined());

    await user.keyboard("{Tab}");
    await waitFor(() => expect(within(cell(0, 3)).getByLabelText("Edit cell value")).toBeDefined());

    await user.keyboard("{Tab}");
    await waitFor(() => expect(screen.queryByLabelText("Edit cell value")).toBe(null));
    // Tabbing through without typing leaves every value untouched.
    expect(screen.queryByText(/unsaved change/)).toBe(null);
  });

  it("steps back to the previous cell on Shift+Tab", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 3);
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    await waitFor(() => expect(within(cell(0, 2)).getByLabelText("Edit cell value")).toBeDefined());
    expect(editorInput().value).toBe("user1@example.com");
  });

  it("accumulates pending changes across two rows", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "one@example.com{Enter}");
    await startEditing(user, 2, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "three@example.com{Enter}");

    await waitFor(() => expect(screen.getByText("2 unsaved changes")).toBeDefined());
    expect(screen.getByText("in 2 rows")).toBeDefined();
    expect(cell(0, 2).textContent).toBe("one@example.com");
    expect(cell(2, 2).textContent).toBe("three@example.com");
  });

  it("throws the pending changes away when Discard is clicked", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "renamed@example.com{Enter}");
    await waitFor(() => expect(screen.getByText("1 unsaved change")).toBeDefined());

    await user.click(screen.getByRole("button", { name: /Discard/ }));

    await waitFor(() => expect(screen.queryByText(/unsaved change/)).toBe(null));
    expect(cell(0, 2).textContent).toBe("user1@example.com");
  });
});

// ─── Row selection ───────────────────────────────────────────────────────────

describe("row selection", () => {
  it("selects one row per plain gutter click", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    expect(await screen.findByText("1 row selected")).toBeDefined();

    // Plain click is spreadsheet-style: it replaces the selection.
    await clickGutter(user, 2);
    expect(await screen.findByText("1 row selected")).toBeDefined();
  });

  it("adds rows one at a time with Cmd-click", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await clickGutter(user, 2, "Meta");
    expect(await screen.findByText("2 rows selected")).toBeDefined();

    // Cmd-click toggles, so clicking the same row again removes it.
    await clickGutter(user, 2, "Meta");
    expect(await screen.findByText("1 row selected")).toBeDefined();
  });

  it("extends a range from the anchor with Shift-click", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await clickGutter(user, 2, "Shift");

    expect(await screen.findByText("3 rows selected")).toBeDefined();
  });

  it("clears the selection from the action bar", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await clickGutter(user, 2, "Shift");
    await screen.findByText("3 rows selected");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(screen.queryByText(/rows? selected/)).toBe(null));
  });
});

// ─── Row deletion ────────────────────────────────────────────────────────────

/** The confirm dialog's Delete button — the second step of every delete. */
function confirmDeleteButton(): HTMLElement {
  return within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" });
}

describe("row deletion", () => {
  it("previews the exact SQL before deleting a single row", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await user.click(await screen.findByRole("button", { name: /Delete selected/ }));

    // One row: the tab asks the backend to render the statement and shows it.
    await waitFor(() => expect(previewDeleteRowsSql).toHaveBeenCalledTimes(1));
    expect(previewDeleteRowsSql.mock.calls[0]).toEqual([
      "session-1",
      { schema: "public", table: "users", rows: [{ pkConditions: [{ column: "id", value: "1" }], ctid: null }] },
    ]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete this row?")).toBeDefined();
    expect(within(dialog).getByText(`DELETE FROM "public"."users" WHERE "id" = 1;`)).toBeDefined();
    // Nothing has happened yet — the delete waits on the confirm step.
    expect(deleteRows).not.toHaveBeenCalled();

    await user.click(confirmDeleteButton());

    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1));
    expect(deleteRows.mock.calls[0][1]).toEqual({
      schema: "public",
      table: "users",
      rows: [{ pkConditions: [{ column: "id", value: "1" }], ctid: null }],
    });
    expect(await screen.findByText("Row deleted")).toBeDefined();
  });

  it("does not delete when the confirm step is cancelled", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await user.click(await screen.findByRole("button", { name: /Delete selected/ }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(deleteRows).not.toHaveBeenCalled();
    // The selection survives so the user can try again.
    expect(screen.getByText("1 row selected")).toBeDefined();
  });

  it("confirms by count for a multi-row delete and sends every row", async () => {
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await clickGutter(user, 2, "Shift");
    await screen.findByText("3 rows selected");

    await user.click(screen.getByRole("button", { name: /Delete selected/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete 3 rows?")).toBeDefined();
    expect(
      within(dialog).getByText("Permanently delete 3 selected rows from public.users?"),
    ).toBeDefined();
    // The per-row SQL preview is a single-row affordance only.
    expect(previewDeleteRowsSql).not.toHaveBeenCalled();

    await user.click(confirmDeleteButton());

    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1));
    expect(deleteRows.mock.calls[0][1].rows).toEqual([
      { pkConditions: [{ column: "id", value: "1" }], ctid: null },
      { pkConditions: [{ column: "id", value: "2" }], ctid: null },
      { pkConditions: [{ column: "id", value: "3" }], ctid: null },
    ]);
    expect(await screen.findByText("3 rows deleted")).toBeDefined();
    await waitFor(() => expect(screen.queryByText(/rows? selected/)).toBe(null));
  });

  it("warns in the confirm step when the selection has unsaved edits", async () => {
    const user = await renderTableViewer();

    await startEditing(user, 0, 2);
    await user.clear(editorInput());
    await user.type(editorInput(), "renamed@example.com{Enter}");
    await waitFor(() => expect(screen.getByText("1 unsaved change")).toBeDefined());

    await clickGutter(user, 0);
    await user.click(await screen.findByRole("button", { name: /Delete selected/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/unsaved edits on selected rows will be discarded/)).toBeDefined();

    await user.click(confirmDeleteButton());

    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1));
    // The row is gone, so its staged edit goes with it.
    await waitFor(() => expect(screen.queryByText(/unsaved change/)).toBe(null));
  });

  it("reports a failure instead of claiming success", async () => {
    deleteRows.mockResolvedValue([
      { sql: `DELETE FROM "public"."users" WHERE "id" = 1;`, error: "violates foreign key constraint" },
    ]);
    const user = await renderTableViewer();

    await clickGutter(user, 0);
    await user.click(await screen.findByRole("button", { name: /Delete selected/ }));
    await user.click(confirmDeleteButton());

    await waitFor(() => expect(deleteRows).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/violates foreign key constraint/)).toBeDefined();
    expect(screen.queryByText("Row deleted")).toBe(null);
  });
});

// ─── Duplicate row ───────────────────────────────────────────────────────────

describe("duplicate row", () => {
  it("creates a visually distinct row right after the source, with the PK cell empty", async () => {
    const user = await renderTableViewer();

    await duplicateRowViaMenu(user, 0);

    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));
    const draftRow = bodyRows()[1];
    expect(within(draftRow).getByLabelText("New unsaved row")).toBeDefined();
    expect(draftRow.className).toContain("bg-accent");
    // PK is cleared so the database assigns it — rendered as the NULL badge.
    expect(cell(1, 1).textContent).toBe("NULL");
    // Non-PK columns carry over the source row's values.
    expect(cell(1, 2).textContent).toBe("user1@example.com");
    expect(cell(1, 3).textContent).toBe("2026-01-01T00:00:01Z");
    // The source row itself is untouched.
    expect(cell(0, 1).textContent).toBe("1");
  });

  it("edits a draft row's cells the same way as a persisted row", async () => {
    const user = await renderTableViewer();
    await duplicateRowViaMenu(user, 0);
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));

    await user.dblClick(cell(1, 2));
    const input = await screen.findByLabelText("Edit new row cell value");
    expect((input as HTMLInputElement).value).toBe("user1@example.com");
    await user.clear(input);
    await user.type(input, "duplicate@example.com{Enter}");

    await waitFor(() => expect(screen.queryByLabelText("Edit new row cell value")).toBe(null));
    expect(cell(1, 2).textContent).toBe("duplicate@example.com");
  });

  it("reflects draft rows in the unsaved bar", async () => {
    const user = await renderTableViewer();

    await duplicateRowViaMenu(user, 0);

    expect(await screen.findByText(/1 new row/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDefined();
  });

  it("invokes insertRows on Save and removes the draft on success", async () => {
    const user = await renderTableViewer();
    await duplicateRowViaMenu(user, 0);
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));

    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(insertRows).toHaveBeenCalledTimes(1));
    expect(insertRows.mock.calls[0]).toEqual([
      "session-1",
      {
        schema: "public",
        table: "users",
        rows: [
          {
            columnValues: [
              { column: "email", value: "user1@example.com" },
              { column: "created_at", value: "2026-01-01T00:00:01Z" },
            ],
          },
        ],
      },
    ]);

    expect(await screen.findByText("Inserted 1 row")).toBeDefined();
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS));
    expect(screen.queryByText(/new row/)).toBe(null);
  });

  it("keeps the draft and surfaces the error when its insert fails", async () => {
    insertRows.mockResolvedValue([
      { sql: "INSERT …", error: "duplicate key value violates unique constraint" },
    ]);
    const user = await renderTableViewer();
    await duplicateRowViaMenu(user, 0);
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));

    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(insertRows).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/duplicate key value violates unique constraint/)).toBeDefined();
    // The failed draft survives so the user can fix and retry.
    expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1);
    expect(screen.getByText(/1 new row/)).toBeDefined();
  });

  it("clears drafts when Discard is clicked", async () => {
    const user = await renderTableViewer();
    await duplicateRowViaMenu(user, 0);
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));

    await user.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS));
    expect(screen.queryByText(/new row/)).toBe(null);
    expect(insertRows).not.toHaveBeenCalled();
  });

  it("fires the navigation guard when a draft row is pending", async () => {
    const user = await renderTableViewer();
    await duplicateRowViaMenu(user, 0);
    await waitFor(() => expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1));

    await user.click(columnHeader("email"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard unsaved changes?")).toBeDefined();

    // Cancelling leaves the draft in place.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(bodyRows()).toHaveLength(TOTAL_ROWS + 1);
  });
});
