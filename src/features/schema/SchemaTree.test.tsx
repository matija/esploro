import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { ConfirmProvider } from "../../components/ConfirmDialog";
import { useAppStore } from "../../store";
import type { ConnectionProfile } from "../../lib/bindings";
import type { ColumnDef, SchemaObjects } from "./types";
import { SchemaTree } from "./SchemaTree";

// The tree fetches one level at a time through `schemaApi`. Faking all three
// reads is what makes "lazy" observable: a level that was never expanded is a
// call that was never made.
const listSchemas = vi.fn<(sessionId: string, database: string) => Promise<string[]>>();
const listObjects = vi.fn<(sessionId: string, database: string, schema: string) => Promise<SchemaObjects>>();
const listColumns = vi.fn<(sessionId: string, database: string, schema: string, table: string) => Promise<ColumnDef[]>>();
const refreshSchemaCache = vi.fn<(sessionId: string, database: string | null, schema: string | null) => Promise<null>>();

vi.mock("./api", () => ({
  schemaApi: {
    listSchemas: (sessionId: string, database: string) => listSchemas(sessionId, database),
    listObjects: (sessionId: string, database: string, schema: string) =>
      listObjects(sessionId, database, schema),
    listColumns: (sessionId: string, database: string, schema: string, table: string) =>
      listColumns(sessionId, database, schema, table),
    refreshSchemaCache: (sessionId: string, database: string | null = null, schema: string | null = null) =>
      refreshSchemaCache(sessionId, database, schema),
  },
}));

// The Roles group hangs off the same tree but is a different feature; it stays
// collapsed here, so an empty stub keeps it from reaching Tauri.
vi.mock("../roles/api", () => ({
  rolesApi: {
    listRoles: () => Promise.resolve([]),
    getRoleDependents: () => Promise.resolve([]),
    createRole: () => Promise.resolve(),
    dropRole: () => Promise.resolve(),
  },
}));

// ─── Fixture ─────────────────────────────────────────────────────────────────

const OBJECTS: SchemaObjects = {
  tables: [
    { name: "users", estimatedRowCount: 70 },
    { name: "orders", estimatedRowCount: null },
  ],
  views: ["active_users"],
  sequences: [],
  functions: [],
};

const COLUMNS: ColumnDef[] = [
  {
    name: "id",
    dataType: "int4",
    isNullable: false,
    columnDefault: null,
    isPrimaryKey: true,
    isForeignKey: false,
    foreignKeyRef: null,
    isEnum: false,
  },
  {
    name: "email",
    dataType: "text",
    isNullable: true,
    columnDefault: null,
    isPrimaryKey: false,
    isForeignKey: false,
    foreignKeyRef: null,
    isEnum: false,
  },
];

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

/** A promise the test resolves by hand, to hold a level in its loading state. */
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
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Renders the tree and waits for the root level to land. */
async function renderTree() {
  const user = userEvent.setup();
  const { container } = renderWithProviders(
    <SchemaTree sessionId="session-1" connectionId="conn-1" />,
  );
  return { user, container };
}

/** The tree row whose label is `label` — rows are flat, so text identifies them. */
function row(label: string): HTMLElement {
  const match = screen
    .getAllByRole("treeitem")
    .find((item) => within(item).queryByText(label) !== null);
  if (!match) throw new Error(`no tree row labelled "${label}"`);
  return match;
}

function queryRow(label: string): HTMLElement | null {
  return (
    screen
      .queryAllByRole("treeitem")
      .find((item) => within(item).queryByText(label) !== null) ?? null
  );
}

/** Clicks a row's chevron — clicking the row itself would open a tab instead. */
async function expandRow(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(within(row(label)).getByRole("button", { name: "Expand" }));
}

/** The skeleton bars a pending level renders in place of its children. */
function skeletonCount(container: HTMLElement): number {
  return container.querySelectorAll(".animate-pulse").length;
}

/** The inline error row, identified by its Retry affordance. */
function errorRow(): HTMLElement {
  const retry = screen.getByRole("button", { name: /Retry/ });
  if (!retry.parentElement) throw new Error("Retry button has no row");
  return retry.parentElement;
}

beforeAll(() => {
  // The tree scrolls the focused row into view; jsdom has no layout for it.
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  listSchemas.mockReset();
  listSchemas.mockResolvedValue(["public", "audit"]);
  listObjects.mockReset();
  listObjects.mockResolvedValue(OBJECTS);
  listColumns.mockReset();
  listColumns.mockResolvedValue(COLUMNS);
  refreshSchemaCache.mockReset();
  refreshSchemaCache.mockResolvedValue(null);
  useAppStore.setState({
    profiles: [PROFILE],
    activeSessions: { "conn-1": "session-1" },
    expandedNodes: {},
    tabs: [],
    activeTabId: null,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lazy expansion", () => {
  it("lists schemas without touching the levels below", async () => {
    await renderTree();

    expect(await screen.findByText("public")).toBeDefined();
    // `public` is pinned above the alphabetical rest.
    expect(
      screen.getAllByRole("treeitem").map((item) => item.textContent),
    ).toEqual(["public", "audit", "Roles"]);
    expect(listObjects).not.toHaveBeenCalled();
    expect(listColumns).not.toHaveBeenCalled();
  });

  it("shows a skeleton while a schema's objects load, then its groups", async () => {
    const objects = deferred<SchemaObjects>();
    listObjects.mockReturnValue(objects.promise);
    const { user, container } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");

    await waitFor(() => expect(skeletonCount(container)).toBeGreaterThan(0));
    expect(queryRow("Tables")).toBe(null);
    expect(listObjects).toHaveBeenCalledWith("session-1", "app", "public");

    objects.resolve(OBJECTS);

    expect(await screen.findByText("Tables")).toBeDefined();
    expect(skeletonCount(container)).toBe(0);
    // Only groups that hold something are rendered, each with its count.
    expect(row("Tables").textContent).toBe("Tables2");
    expect(row("Views").textContent).toBe("Views1");
    expect(queryRow("Sequences")).toBe(null);
    expect(queryRow("Functions")).toBe(null);
    // Still one query per expanded schema — `audit` stayed collapsed.
    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it("fetches a table's columns only once that table is expanded", async () => {
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await screen.findByText("Tables");
    await expandRow(user, "Tables");

    expect(await screen.findByText("users")).toBeDefined();
    expect(screen.getByText("orders")).toBeDefined();
    expect(listColumns).not.toHaveBeenCalled();

    await expandRow(user, "users");

    await waitFor(() =>
      expect(listColumns).toHaveBeenCalledWith("session-1", "app", "public", "users"),
    );
    expect(await screen.findByText("email")).toBeDefined();
    // `orders` was never expanded, so it contributed no query.
    expect(listColumns).toHaveBeenCalledTimes(1);
  });

  it("renders the loaded columns with their type and key badges", async () => {
    const columns = deferred<ColumnDef[]>();
    listColumns.mockReturnValue(columns.promise);
    const { user, container } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await expandRow(user, "Tables");
    await screen.findByText("users");
    await expandRow(user, "users");

    await waitFor(() => expect(skeletonCount(container)).toBeGreaterThan(0));
    expect(queryRow("email")).toBe(null);

    columns.resolve(COLUMNS);

    expect(await screen.findByText("id")).toBeDefined();
    expect(row("id").textContent).toBe("idPKint4");
    // Nullable, non-key column: `?` badge, no PK/FK.
    expect(row("email").textContent).toBe("email?text");
  });

  it("stops fetching a level again once it is collapsed and re-expanded", async () => {
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await screen.findByText("Tables");

    await user.click(within(row("public")).getByRole("button", { name: "Collapse" }));
    expect(queryRow("Tables")).toBe(null);

    await expandRow(user, "public");

    expect(await screen.findByText("Tables")).toBeDefined();
    // The result was cached, so re-expanding replays it rather than refetching.
    expect(listObjects).toHaveBeenCalledTimes(1);
  });
});

describe("error nodes", () => {
  it("reports a failed schema list and recovers on retry", async () => {
    listSchemas.mockRejectedValueOnce(new Error("connection reset by peer"));
    const { user } = await renderTree();

    expect(await screen.findByText("connection reset by peer")).toBeDefined();
    expect(queryRow("public")).toBe(null);

    await user.click(within(errorRow()).getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("public")).toBeDefined();
    expect(screen.queryByText("connection reset by peer")).toBe(null);
  });

  it("reports a failed object load under the schema it belongs to", async () => {
    listObjects.mockRejectedValueOnce(new Error("permission denied for schema public"));
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");

    expect(await screen.findByText("permission denied for schema public")).toBeDefined();
    // The failure replaces that schema's children only; the tree stays usable.
    expect(screen.getByText("audit")).toBeDefined();
    expect(queryRow("Tables")).toBe(null);

    await user.click(within(errorRow()).getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("Tables")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBe(null);
  });

  it("falls back to a generic message when the failure carries none", async () => {
    listObjects.mockRejectedValueOnce(new Error("   "));
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");

    expect(await screen.findByText("Could not load schema objects")).toBeDefined();
  });

  it("reports a failed column load under the table it belongs to", async () => {
    listColumns.mockRejectedValueOnce(new Error("relation \"users\" does not exist"));
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await expandRow(user, "Tables");
    await screen.findByText("users");

    await expandRow(user, "users");

    expect(await screen.findByText('relation "users" does not exist')).toBeDefined();
    // Sibling rows are untouched — only the expanded table shows the error.
    expect(screen.getByText("orders")).toBeDefined();

    await user.click(within(errorRow()).getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("email")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBe(null);
  });
});

describe("per-node refresh", () => {
  it("drops the backend cache for one schema and refetches just that schema", async () => {
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await screen.findByText("Tables");
    await expandRow(user, "audit");
    await waitFor(() => expect(listObjects).toHaveBeenCalledTimes(2));

    await user.click(within(row("public")).getByRole("button", { name: "Refresh schema" }));

    await waitFor(() =>
      expect(refreshSchemaCache).toHaveBeenCalledWith("session-1", "app", "public"),
    );
    // `public` re-introspects; `audit` keeps replaying its cached result.
    await waitFor(() => expect(listObjects).toHaveBeenCalledTimes(3));
    expect(listObjects.mock.calls.at(-1)).toEqual(["session-1", "app", "public"]);
  });

  it("refreshes a table's columns from the row's context menu", async () => {
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await expandRow(user, "Tables");
    await screen.findByText("users");
    await expandRow(user, "users");
    await waitFor(() => expect(listColumns).toHaveBeenCalledTimes(1));

    await user.pointer({ keys: "[MouseRight]", target: row("users") });
    // The row carries an inline Refresh too, so take the one in the popover.
    const menuItem = await waitFor(() => {
      const item = screen
        .getAllByRole("button", { name: "Refresh schema" })
        .find((b) => b.closest(".fixed.z-50") !== null);
      if (!item) throw new Error("no Refresh item in the context menu");
      return item;
    });
    await user.click(menuItem);

    await waitFor(() =>
      expect(refreshSchemaCache).toHaveBeenCalledWith("session-1", "app", "public"),
    );
    await waitFor(() => expect(listColumns).toHaveBeenCalledTimes(2));
  });

  it("surfaces a failed refresh without disturbing the tree", async () => {
    refreshSchemaCache.mockRejectedValueOnce(new Error("session is gone"));
    const { user } = await renderTree();
    await screen.findByText("public");

    await expandRow(user, "public");
    await screen.findByText("Tables");

    await user.click(within(row("public")).getByRole("button", { name: "Refresh schema" }));

    expect(await screen.findByText("session is gone")).toBeDefined();
    expect(screen.getByText("Tables")).toBeDefined();
    // The cache was never cleared, so nothing was refetched behind the failure.
    expect(listObjects).toHaveBeenCalledTimes(1);
  });
});
