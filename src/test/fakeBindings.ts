import { vi, type Mock } from "vitest";
import { defaultUiPreferences } from "../features/settings/preferences";

/**
 * A fake for `src/lib/bindings.ts`, the single generated module every feature's
 * `api.ts` routes its Tauri `invoke` calls through. Component tests that span
 * several features — the app shell, the command palette — would otherwise need
 * one `vi.mock` per feature api; faking the invoke layer once covers all of
 * them, and the returned mocks stay individually configurable per test.
 *
 * Usage:
 *
 *     vi.mock("../lib/bindings", async () => ({
 *       commands: (await import("../test/fakeBindings")).createFakeCommands(),
 *     }));
 *     import { commands } from "../lib/bindings";  // the fake instance
 */
type RealCommands = typeof import("../lib/bindings").commands;

export type FakeCommands = { [K in keyof RealCommands]: Mock<RealCommands[K]> };

/**
 * Every command answers with the empty-but-valid shape its caller expects, so a
 * test only has to say what it actually cares about. Anything that mutates on
 * the Rust side resolves to `null`, matching the generated signatures.
 */
const defaultImpls: RealCommands = {
  listConnections: () => Promise.resolve([]),
  createConnection: () => Promise.resolve("new-connection"),
  updateConnection: () => Promise.resolve(null),
  deleteConnection: () => Promise.resolve(null),
  testConnection: () => Promise.resolve(1),
  // Sessions are named after the profile so assertions can tell them apart.
  connect: (id) => Promise.resolve(`session-${id}`),
  disconnect: () => Promise.resolve(null),
  queryTableData: (_sessionId, request) =>
    Promise.resolve({
      columns: [],
      rows: [],
      ctids: [],
      page: request.page,
      pageSize: request.pageSize,
      executionMs: 0,
    }),
  queryTableCount: () => Promise.resolve({ count: 0, isEstimate: false }),
  updateRows: () => Promise.resolve(null),
  previewUpdateRowsSql: () => Promise.resolve(""),
  deleteRows: () => Promise.resolve([]),
  previewDeleteRowsSql: () => Promise.resolve(""),
  executeSql: () => Promise.resolve([]),
  saveQuery: () => Promise.resolve("saved-query"),
  listSavedQueries: () => Promise.resolve([]),
  getSavedQuery: (id) =>
    Promise.resolve({ id, name: "Query", folder: null, sql: "", createdAt: "", updatedAt: "" }),
  deleteSavedQuery: () => Promise.resolve(null),
  listSchemas: () => Promise.resolve([]),
  listObjects: () => Promise.resolve({ tables: [], views: [], sequences: [], functions: [] }),
  listColumns: () => Promise.resolve([]),
  listRoles: () => Promise.resolve([]),
  listRoleMembers: () => Promise.resolve({ memberOf: [], members: [] }),
  getRoleDependents: () => Promise.resolve([]),
  createRole: () => Promise.resolve(null),
  alterRole: () => Promise.resolve(null),
  dropRole: () => Promise.resolve(null),
  manageRoleMembership: () => Promise.resolve([]),
  listRolePrivileges: () => Promise.resolve({ schemaGrants: [], tableGrants: [] }),
  manageRolePrivileges: () => Promise.resolve([]),
  listTablePrivileges: () => Promise.resolve([]),
  manageTablePrivileges: () => Promise.resolve([]),
  listSchemaPrivileges: () => Promise.resolve({ owner: "postgres", grantees: [] }),
  manageSchemaPrivileges: () => Promise.resolve([]),
  getLicenseStatus: () =>
    Promise.resolve({
      tier: "Personal",
      bannerVisible: false,
      gracePeriodEnds: null,
      showUsageDialog: false,
      revalidationRequired: false,
    }),
  activateLicense: () => Promise.reject(new Error("not configured")),
  deactivateLicense: () => Promise.reject(new Error("not configured")),
  answerUsageDialog: () => Promise.reject(new Error("not configured")),
  dismissLicenseBanner: () => Promise.resolve(null),
  notifyConnectionCount: () =>
    Promise.resolve({
      tier: "Personal",
      bannerVisible: false,
      gracePeriodEnds: null,
      showUsageDialog: false,
      revalidationRequired: false,
    }),
  openCustomerPortal: () => Promise.resolve(null),
  openUrl: () => Promise.resolve(null),
  getUiPreferences: () => Promise.resolve(defaultUiPreferences),
  setUiPreferences: () => Promise.resolve(null),
  checkForUpdate: () => Promise.resolve(null),
  installUpdate: () => Promise.resolve(null),
};

function entries(): [keyof RealCommands, RealCommands[keyof RealCommands]][] {
  return Object.entries(defaultImpls) as [
    keyof RealCommands,
    RealCommands[keyof RealCommands],
  ][];
}

export function createFakeCommands(): FakeCommands {
  return Object.fromEntries(
    entries().map(([name, impl]) => [name, vi.fn(impl)]),
  ) as FakeCommands;
}

/** Clears recorded calls and restores the default answers. Call from `beforeEach`. */
export function resetFakeCommands(commands: FakeCommands): void {
  for (const [name, impl] of entries()) {
    (commands[name] as Mock).mockReset().mockImplementation(impl as never);
  }
}
