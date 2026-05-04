/**
 * Demo mode: pretend a Postgres backend is wired up.
 *
 * Activated by `VITE_DEMO=1` at dev/build time (see `main.tsx`). Used for
 * marketing screenshots, previews, and Storybook-style explorations without a
 * running Tauri backend or live database.
 *
 * Two halves:
 *   1. `mockIPC` from `@tauri-apps/api/mocks` intercepts every `invoke()` and
 *      returns canned responses for every command the frontend uses.
 *   2. We seed Zustand directly with profiles, an active session, expanded
 *      schema nodes, recent objects, saved queries, and a pre-opened tab so
 *      the first paint has the app fully loaded with content.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import { useAppStore, type Tab } from "../store";
import {
  defaultUiPreferences,
  type UiPreferences,
  type UiTheme,
} from "../features/settings/preferences";
import type { ConnectionProfile } from "../features/connections/types";
import type {
  SchemaObjects,
  ColumnDef,
  TableSummary,
  FunctionSummary,
} from "../features/schema/types";
import type {
  TableQueryRequest,
  TableQueryResult,
  ResultColumn,
} from "../features/table-viewer/types";
import type { SavedQuery, QueryResult } from "../features/query-editor/types";
import type { LicenseStatus } from "../features/license/types";

// ─── Profiles ────────────────────────────────────────────────────────────────

const PROD_ID = "conn-prod";
const PROD_SESSION = "sess-prod-7e1c";
const STAGING_ID = "conn-staging";
const ANALYTICS_ID = "conn-analytics";
const LOCAL_ID = "conn-local";

const NOW_ISO = "2025-09-04T08:00:00.000Z";

const PROFILES: ConnectionProfile[] = [
  {
    id: PROD_ID,
    displayName: "Acme — Production",
    color: "#34C759",
    host: "db.acme.io",
    port: 5432,
    database: "marketplace",
    username: "app_readonly",
    sslMode: "require",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: ANALYTICS_ID,
    displayName: "Analytics Warehouse",
    color: "#AF52DE",
    host: "warehouse.acme.io",
    port: 5432,
    database: "analytics",
    username: "analyst",
    sslMode: "require",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: STAGING_ID,
    displayName: "Acme — Staging",
    color: "#FFCC00",
    folder: "Staging",
    host: "stg-db.acme.io",
    port: 5432,
    database: "marketplace_stg",
    username: "app_admin",
    sslMode: "require",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: LOCAL_ID,
    displayName: "Local — dev",
    color: "#007AFF",
    folder: "Local",
    host: "localhost",
    port: 5432,
    database: "marketplace_dev",
    username: "matija",
    sslMode: "disable",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
];

// ─── Schema ──────────────────────────────────────────────────────────────────

const DATABASES = ["marketplace", "postgres"];
const SCHEMAS_BY_DB: Record<string, string[]> = {
  marketplace: ["public", "auth", "billing", "audit"],
  postgres: ["public"],
};

const TABLES: TableSummary[] = [
  { name: "users", estimatedRowCount: 184_392 },
  { name: "orders", estimatedRowCount: 2_481_037 },
  { name: "order_items", estimatedRowCount: 7_982_104 },
  { name: "products", estimatedRowCount: 12_847 },
  { name: "payments", estimatedRowCount: 2_105_998 },
  { name: "sessions", estimatedRowCount: 451_220 },
  { name: "audit_log", estimatedRowCount: 18_902_551 },
  { name: "addresses", estimatedRowCount: 312_604 },
];

const VIEWS = ["active_users", "monthly_revenue", "top_customers"];
const SEQUENCES = ["users_id_seq", "orders_id_seq"];
const FUNCTIONS: FunctionSummary[] = [
  { name: "calculate_lifetime_value", resultType: "numeric" },
  { name: "refresh_top_customers", resultType: "void" },
];

const PUBLIC_OBJECTS: SchemaObjects = {
  tables: TABLES,
  views: VIEWS,
  sequences: SEQUENCES,
  functions: FUNCTIONS,
};

const EMPTY_OBJECTS: SchemaObjects = {
  tables: [],
  views: [],
  sequences: [],
  functions: [],
};

const COLUMNS_BY_TABLE: Record<string, ColumnDef[]> = {
  users: [
    { name: "id", dataType: "uuid", isNullable: false, columnDefault: "gen_random_uuid()", isPrimaryKey: true, isForeignKey: false, foreignKeyRef: null },
    { name: "email", dataType: "citext", isNullable: false, columnDefault: null, isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "full_name", dataType: "text", isNullable: true, columnDefault: null, isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "role", dataType: "user_role", isNullable: false, columnDefault: "'member'", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "tier", dataType: "text", isNullable: true, columnDefault: null, isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "is_active", dataType: "bool", isNullable: false, columnDefault: "true", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "metadata", dataType: "jsonb", isNullable: true, columnDefault: "'{}'::jsonb", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "created_at", dataType: "timestamptz", isNullable: false, columnDefault: "now()", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "last_login_at", dataType: "timestamptz", isNullable: true, columnDefault: null, isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
  ],
  orders: [
    { name: "id", dataType: "bigint", isNullable: false, columnDefault: "nextval('orders_id_seq')", isPrimaryKey: true, isForeignKey: false, foreignKeyRef: null },
    { name: "user_id", dataType: "uuid", isNullable: false, columnDefault: null, isPrimaryKey: false, isForeignKey: true, foreignKeyRef: "users(id)" },
    { name: "status", dataType: "order_status", isNullable: false, columnDefault: "'pending'", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "total_cents", dataType: "int8", isNullable: false, columnDefault: "0", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "currency", dataType: "char", isNullable: false, columnDefault: "'USD'", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
    { name: "placed_at", dataType: "timestamptz", isNullable: false, columnDefault: "now()", isPrimaryKey: false, isForeignKey: false, foreignKeyRef: null },
  ],
};

// ─── Saved queries ──────────────────────────────────────────────────────────

const SAVED_QUERIES: SavedQuery[] = [
  {
    id: "sq-top-customers",
    name: "Top customers (last 30d)",
    folder: "Reports",
    sql: "SELECT u.email, SUM(o.total_cents) / 100.0 AS revenue, COUNT(*) AS orders\nFROM orders o\nJOIN users u ON u.id = o.user_id\nWHERE o.placed_at > now() - interval '30 days'\nGROUP BY u.email\nORDER BY revenue DESC\nLIMIT 50;",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: "sq-revenue-by-month",
    name: "Revenue by month",
    folder: "Reports",
    sql: "SELECT date_trunc('month', placed_at) AS month,\n       SUM(total_cents) / 100.0 AS revenue\nFROM orders\nWHERE status = 'paid'\nGROUP BY 1\nORDER BY 1 DESC;",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: "sq-stale-sessions",
    name: "Stale sessions",
    folder: null,
    sql: "DELETE FROM sessions\nWHERE last_seen_at < now() - interval '30 days';",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
];

// ─── Users table fixture ────────────────────────────────────────────────────

const USER_COLUMNS: ResultColumn[] = [
  { name: "id", dataType: "uuid", isNullable: false, isPrimaryKey: true, isForeignKey: false },
  { name: "email", dataType: "citext", isNullable: false, isPrimaryKey: false, isForeignKey: false },
  { name: "full_name", dataType: "text", isNullable: true, isPrimaryKey: false, isForeignKey: false },
  { name: "role", dataType: "user_role", isNullable: false, isPrimaryKey: false, isForeignKey: false },
  { name: "tier", dataType: "text", isNullable: true, isPrimaryKey: false, isForeignKey: false },
  { name: "is_active", dataType: "bool", isNullable: false, isPrimaryKey: false, isForeignKey: false },
  { name: "metadata", dataType: "jsonb", isNullable: true, isPrimaryKey: false, isForeignKey: false },
  { name: "created_at", dataType: "timestamptz", isNullable: false, isPrimaryKey: false, isForeignKey: false },
  { name: "last_login_at", dataType: "timestamptz", isNullable: true, isPrimaryKey: false, isForeignKey: false },
];

// Hand-rolled rows beat random data — every cell is plausible and the rows tell
// a small story (multiple roles, mix of active/inactive, NULLs, JSON, etc.).
const USER_ROWS: (string | null)[][] = [
  ["8a4c1f2e-9b15-4d3a-9c1d-1f2c3a4b5c6d", "amelia.holt@northpeak.io",   "Amelia Holt",        "admin",   "enterprise", "true",  '{"plan":"enterprise","seats":48}',     "2024-01-12 09:14:22+00", "2025-09-03 22:41:08+00"],
  ["1c2d3e4f-5061-7283-94a5-b6c7d8e9f001", "rahul.menon@brightlabs.com", "Rahul Menon",        "member",  "pro",        "true",  '{"plan":"pro","seats":3}',             "2024-02-03 15:08:11+00", "2025-09-04 06:02:54+00"],
  ["2c3d4e5f-6071-8293-a4b5-c6d7e8f90112", "sofia.alves@vinhedo.coop",   "Sofia Alves",        "member",  "free",       "true",  '{"plan":"free"}',                       "2024-02-19 11:45:39+00", "2025-08-31 13:50:12+00"],
  ["3c4d5e6f-7081-92a3-b4c5-d6e7f8901223", "kenji.tanaka@orbit.dev",     "Kenji Tanaka",       "owner",   "enterprise", "true",  '{"plan":"enterprise","seats":120}',    "2023-11-07 18:22:01+00", "2025-09-04 07:11:33+00"],
  ["4c5d6e7f-8091-a2b3-c4d5-e6f789012334", "mara.svensson@kollektiv.se", "Mara Svensson",      "billing", "pro",        "true",  null,                                    "2024-04-22 08:33:18+00", "2025-09-02 16:08:47+00"],
  ["5c6d7e8f-90a1-b2c3-d4e5-f67890123445", "leon.bauer@kraftwerk.de",    "Leon Bauer",         "member",  "pro",        "false", '{"plan":"pro","churn_risk":0.42}',     "2024-05-01 12:07:00+00", "2025-06-19 09:25:12+00"],
  ["6c7d8e9f-a0b1-c2d3-e4f5-678901234556", "aiyana.cloud@plains.org",    "Aiyana Cloud",       "member",  "free",       "true",  '{"plan":"free","beta":true}',          "2024-05-16 21:00:48+00", "2025-09-04 01:33:22+00"],
  ["7c8d9eaf-b0c1-d2e3-f405-890123456667", "diego.maldonado@horizon.mx", "Diego Maldonado",    "member",  "pro",        "true",  '{"plan":"pro","seats":1}',             "2024-06-08 13:54:13+00", "2025-09-03 18:42:01+00"],
  ["8c9daebf-c0d1-e2f3-0415-901234567778", "noor.haddad@beirut.studio",  "Noor Haddad",        "admin",   "enterprise", "true",  '{"plan":"enterprise","seats":62}',     "2024-06-21 17:18:55+00", "2025-09-04 05:18:46+00"],
  ["9daebfcd-d0e1-f203-1425-012345678889", "olek.kowalski@warsaw.it",    "Olek Kowalski",      "member",  "pro",        "true",  '{"plan":"pro","seats":4}',             "2024-07-03 06:41:30+00", "2025-09-01 22:09:51+00"],
  ["adbfcdde-e0f1-0314-2536-12345678999a", "yui.nakamura@kyoto.green",   "Yui Nakamura",       "member",  "free",       "true",  null,                                    "2024-07-19 22:55:09+00", "2025-08-28 12:36:18+00"],
  ["bdcddeef-f102-1425-3647-23456789aaab", "ezra.cohen@altitude.co",     "Ezra Cohen",         "member",  "pro",        "false", '{"plan":"pro","churn_risk":0.71}',     "2024-08-04 19:23:42+00", "2025-04-12 08:50:33+00"],
  ["cdedeff0-1213-2536-4758-3456789abbbc", "priya.iyer@mumbai.tea",      "Priya Iyer",         "owner",   "enterprise", "true",  '{"plan":"enterprise","seats":340}',    "2023-09-11 10:11:00+00", "2025-09-04 04:25:11+00"],
  ["deeff011-2324-3647-5869-456789abcccd", "jonas.lindqvist@nord.fi",    "Jonas Lindqvist",    "member",  "pro",        "true",  '{"plan":"pro","seats":2}',             "2024-09-09 14:38:24+00", "2025-09-03 11:08:28+00"],
  ["eff01122-3435-4758-697a-56789abcdddd", "amaya.cortez@bahia.br",      "Amaya Cortez",       "billing", "enterprise", "true",  '{"plan":"enterprise"}',                 "2024-09-18 07:09:55+00", "2025-09-04 06:55:13+00"],
  ["f0112233-4546-5869-7a8b-6789abcdeeee", "henri.dupont@grenoble.fr",   "Henri Dupont",       "member",  "free",       "true",  '{"plan":"free"}',                       "2024-10-01 15:00:00+00", "2025-08-30 19:14:09+00"],
  ["01223344-5657-697a-8b9c-789abcdef0a0", "isla.murphy@galway.ie",      "Isla Murphy",        "member",  "pro",        "true",  '{"plan":"pro","seats":6}',             "2024-10-12 11:25:47+00", "2025-09-02 14:31:51+00"],
  ["12233455-6768-7a8b-9cad-89abcdef0a1b", "thabo.dlamini@joburg.za",    "Thabo Dlamini",      "member",  "pro",        "true",  null,                                    "2024-11-01 09:01:09+00", "2025-09-01 20:48:23+00"],
  ["23344566-7879-8b9c-adbe-9abcdef0a1b2", "matti.rinne@helsinki.tech",  "Matti Rinne",        "admin",   "enterprise", "true",  '{"plan":"enterprise","seats":18}',     "2024-11-20 16:42:12+00", "2025-09-04 02:13:04+00"],
  ["3445667a-898a-9cad-becf-abcdef0a1b2c", "leila.farahani@tehran.io",   "Leila Farahani",     "member",  "free",       "false", '{"plan":"free","disabled":true}',       "2024-12-05 13:14:55+00", "2025-02-08 11:22:44+00"],
  ["4566778b-9a9b-adbe-cfd0-bcdef0a1b2c3", "samuel.adekunle@lagos.dev",  "Samuel Adekunle",    "owner",   "pro",        "true",  '{"plan":"pro","seats":12}',            "2025-01-09 08:07:33+00", "2025-09-03 22:00:18+00"],
  ["56678899-acac-bedf-d0e1-cdef0a1b2c3d", "freya.olsen@bergen.no",      "Freya Olsen",        "member",  "pro",        "true",  '{"plan":"pro","seats":3}',             "2025-01-22 18:29:18+00", "2025-09-04 03:46:39+00"],
  ["6678899a-bdbd-cfd0-e1f2-def0a1b2c3d4", "viktor.petrov@sofia.bg",     "Viktor Petrov",      "member",  "free",       "true",  null,                                    "2025-02-04 22:11:06+00", "2025-08-29 09:55:01+00"],
  ["7889aabc-cece-d0e1-f203-ef0a1b2c3d4e", "mei-ling.chan@taipei.tw",    "Mei-Ling Chan",      "member",  "pro",        "true",  '{"plan":"pro","seats":2}',             "2025-02-18 04:28:50+00", "2025-09-04 07:39:20+00"],
  ["89aabbcd-dfdf-e1f2-0314-f0a1b2c3d4e5", "ade.afolabi@nairobi.farm",   "Ade Afolabi",        "member",  "free",       "true",  '{"plan":"free"}',                       "2025-03-05 12:00:34+00", "2025-09-02 17:11:08+00"],
  ["9aabbcde-e0e0-f203-1425-0a1b2c3d4e5f", "noa.weiss@telaviv.io",       "Noa Weiss",          "member",  "pro",        "true",  '{"plan":"pro","seats":5}',             "2025-03-21 19:43:27+00", "2025-09-03 21:08:15+00"],
  ["abcdcdef-f1f1-0314-2536-1b2c3d4e5f60", "bruno.reis@lisboa.market",   "Bruno Reis",         "billing", "pro",        "true",  '{"plan":"pro","seats":7}',             "2025-04-02 10:55:41+00", "2025-09-01 08:24:29+00"],
  ["bcdedef0-0202-1425-3647-2c3d4e5f6071", "siti.rahman@kuala.lumpur",   "Siti Rahman",        "member",  "free",       "true",  null,                                    "2025-04-19 14:08:18+00", "2025-08-25 13:00:00+00"],
  ["cdef0011-1313-2536-4758-3d4e5f607182", "anders.berg@stockholm.se",   "Anders Berg",        "owner",   "enterprise", "true",  '{"plan":"enterprise","seats":210}',    "2023-08-15 06:32:10+00", "2025-09-04 06:18:55+00"],
  ["def01122-2424-3647-5869-4e5f60718293", "claudia.rossi@milano.it",    "Claudia Rossi",      "admin",   "pro",        "true",  '{"plan":"pro","seats":9}',             "2025-05-08 15:21:09+00", "2025-09-03 19:55:42+00"],
];

const USERS_RESULT: TableQueryResult = {
  columns: USER_COLUMNS,
  rows: USER_ROWS,
  totalCount: 184_392,
  page: 0,
  pageSize: 200,
  executionMs: 73,
};

// Generic fallback for any other table the user might click into during a demo
function genericTableResult(table: string): TableQueryResult {
  return {
    columns: [
      { name: "id", dataType: "bigint", isNullable: false, isPrimaryKey: true, isForeignKey: false },
      { name: "label", dataType: "text", isNullable: true, isPrimaryKey: false, isForeignKey: false },
      { name: "value", dataType: "numeric", isNullable: true, isPrimaryKey: false, isForeignKey: false },
      { name: "created_at", dataType: "timestamptz", isNullable: false, isPrimaryKey: false, isForeignKey: false },
    ],
    rows: Array.from({ length: 12 }, (_, i) => [
      String(1000 + i),
      `${table} row ${i + 1}`,
      (Math.random() * 1000).toFixed(2),
      "2025-09-04 12:00:00+00",
    ]),
    totalCount: 12,
    page: 0,
    pageSize: 200,
    executionMs: 41,
  };
}

// ─── Recents ────────────────────────────────────────────────────────────────

const RECENTS = [
  {
    type: "table" as const,
    title: "public.users",
    schema: "public",
    table: "users",
    database: "marketplace",
    connectionId: PROD_ID,
    sessionId: PROD_SESSION,
    timestamp: Date.now() - 1000 * 60 * 3,
  },
  {
    type: "query" as const,
    title: "Revenue by month",
    savedQueryId: "sq-revenue-by-month",
    sql: SAVED_QUERIES[1].sql,
    sessionId: PROD_SESSION,
    timestamp: Date.now() - 1000 * 60 * 18,
  },
  {
    type: "table" as const,
    title: "public.orders",
    schema: "public",
    table: "orders",
    database: "marketplace",
    connectionId: PROD_ID,
    sessionId: PROD_SESSION,
    timestamp: Date.now() - 1000 * 60 * 47,
  },
  {
    type: "query" as const,
    title: "Top customers (last 30d)",
    savedQueryId: "sq-top-customers",
    sql: SAVED_QUERIES[0].sql,
    sessionId: PROD_SESSION,
    timestamp: Date.now() - 1000 * 60 * 60 * 2,
  },
];

// ─── Tabs ────────────────────────────────────────────────────────────────────

const USERS_TAB_ID = "tab-users";
const QUERY_TAB_ID = "tab-revenue";

const SEED_TABS: Tab[] = [
  { id: "welcome", type: "welcome", title: "Welcome" },
  {
    id: QUERY_TAB_ID,
    type: "query",
    title: "Revenue by month",
    sessionId: PROD_SESSION,
    queryContext: {
      sql: SAVED_QUERIES[1].sql,
      savedQueryId: "sq-revenue-by-month",
    },
  },
  {
    id: USERS_TAB_ID,
    type: "table",
    title: "public.users",
    sessionId: PROD_SESSION,
    tableContext: {
      database: "marketplace",
      schema: "public",
      table: "users",
      connectionId: PROD_ID,
    },
  },
];

// ─── Expanded schema-tree nodes ─────────────────────────────────────────────

const EXPANDED: Record<string, true> = {
  [`${PROD_ID}:db:marketplace`]: true,
  [`${PROD_ID}:db:marketplace:schema:public`]: true,
  [`${PROD_ID}:db:marketplace:schema:public:group:Tables`]: true,
  [`${PROD_ID}:db:marketplace:schema:public:group:Views`]: true,
  [`${PROD_ID}:db:marketplace:schema:public:table:users`]: true,
};

// ─── License ────────────────────────────────────────────────────────────────

const LICENSE_STATUS: LicenseStatus = {
  tier: "Personal",
  licensee: "Matija Munjaković",
  expiresAt: null,
  daysUntilExpiry: null,
  bannerVisible: false,
  gracePeriodEnds: null,
  showUsageDialog: false,
};

// ─── Theme override (read from URL: ?theme=dark|light|macos-dark|…) ─────────

function readThemeOverride(): UiTheme | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("theme");
  if (!raw) return null;
  const aliases: Record<string, UiTheme> = {
    light: "tairiki-light",
    dark: "tairiki-dark",
    "macos-light": "macos-light",
    "macos-dark": "macos-dark",
    "tairiki-light": "tairiki-light",
    "tairiki-dark": "tairiki-dark",
    system: "system",
  };
  return aliases[raw] ?? null;
}

function buildPreferences(): UiPreferences {
  const override = readThemeOverride();
  return override
    ? { ...defaultUiPreferences, ui: { ...defaultUiPreferences.ui, theme: override } }
    : defaultUiPreferences;
}

// ─── Mock invoke handler ────────────────────────────────────────────────────

type InvokeArgs = Record<string, unknown> | undefined;

function handleInvoke(cmd: string, args: InvokeArgs): unknown {
  switch (cmd) {
    // ── Preferences ──────────────────────────────────────────────────────────
    case "get_ui_preferences":
      return buildPreferences();
    case "set_ui_preferences":
      return null;

    // ── Connections ──────────────────────────────────────────────────────────
    case "list_connections":
      return PROFILES;
    case "create_connection":
      return `conn-${Math.random().toString(36).slice(2, 8)}`;
    case "update_connection":
    case "delete_connection":
      return null;
    case "test_connection":
      return 12;
    case "connect":
      return PROD_SESSION;
    case "disconnect":
      return null;

    // ── Schema ───────────────────────────────────────────────────────────────
    case "list_databases":
      return DATABASES;
    case "list_schemas": {
      const db = (args?.database as string) ?? "marketplace";
      return SCHEMAS_BY_DB[db] ?? ["public"];
    }
    case "list_objects": {
      const schema = args?.schema as string;
      return schema === "public" ? PUBLIC_OBJECTS : EMPTY_OBJECTS;
    }
    case "list_columns": {
      const table = args?.table as string;
      return COLUMNS_BY_TABLE[table] ?? [];
    }

    // ── Table viewer ─────────────────────────────────────────────────────────
    case "query_table": {
      const req = (args?.request as TableQueryRequest) ?? null;
      if (req && req.table === "users") return USERS_RESULT;
      return genericTableResult(req?.table ?? "table");
    }

    // ── Query editor ─────────────────────────────────────────────────────────
    case "execute_sql":
      return [revenueByMonthResult()] satisfies QueryResult[];
    case "list_saved_queries":
      return SAVED_QUERIES;
    case "get_saved_query": {
      const id = args?.id as string;
      return SAVED_QUERIES.find((q) => q.id === id) ?? SAVED_QUERIES[0];
    }
    case "save_query":
      return (args?.id as string) ?? `sq-${Math.random().toString(36).slice(2, 8)}`;
    case "delete_saved_query":
      return null;

    // ── License ──────────────────────────────────────────────────────────────
    case "get_license_status":
    case "activate_license":
    case "deactivate_license":
    case "answer_usage_dialog":
    case "notify_connection_count":
      return LICENSE_STATUS;
    case "dismiss_license_banner":
    case "open_license_url":
      return null;

    default:
      // Surface unknown commands during development so the demo stays honest.
      console.warn(`[demo] Unhandled invoke: ${cmd}`, args);
      return null;
  }
}

function revenueByMonthResult(): QueryResult {
  return {
    columns: [
      { name: "month", dataType: "timestamptz", isNullable: false, isPrimaryKey: false, isForeignKey: false },
      { name: "revenue", dataType: "numeric", isNullable: true, isPrimaryKey: false, isForeignKey: false },
    ],
    rows: [
      ["2025-09-01 00:00:00+00", "412803.55"],
      ["2025-08-01 00:00:00+00", "398217.40"],
      ["2025-07-01 00:00:00+00", "411904.18"],
      ["2025-06-01 00:00:00+00", "395552.01"],
      ["2025-05-01 00:00:00+00", "367890.92"],
      ["2025-04-01 00:00:00+00", "352014.27"],
      ["2025-03-01 00:00:00+00", "338007.61"],
      ["2025-02-01 00:00:00+00", "311422.84"],
      ["2025-01-01 00:00:00+00", "289103.05"],
      ["2024-12-01 00:00:00+00", "402199.76"],
      ["2024-11-01 00:00:00+00", "350884.13"],
      ["2024-10-01 00:00:00+00", "318554.40"],
    ],
    rowsAffected: null,
    executionMs: 142,
    error: null,
  };
}

// ─── Public entrypoint ──────────────────────────────────────────────────────

export function installDemoMode(): void {
  // Persisted Zustand state from a real run would override our seed; wipe it.
  try {
    localStorage.removeItem("esploro-ui");
    localStorage.removeItem("esploro-ui-preferences");
    localStorage.removeItem("esploro-query-result-height");
  } catch {
    // Non-fatal if storage is unavailable (e.g. Safari private mode).
  }

  mockIPC((cmd, payload) => handleInvoke(cmd, payload as InvokeArgs));

  const themeOverride = readThemeOverride();

  useAppStore.setState({
    profiles: PROFILES,
    activeSessions: { [PROD_ID]: PROD_SESSION },
    expandedNodes: EXPANDED,
    recentObjects: RECENTS,
    tabs: SEED_TABS,
    activeTabId: USERS_TAB_ID,
    sidebarWidth: 260,
    ...(themeOverride ? { theme: themeOverride } : {}),
    lastAction: {
      label: "users",
      durationMs: 73,
      rowCount: 184_392,
      timestamp: Date.now() - 1000 * 4,
    },
  });
}
