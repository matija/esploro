import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type {
  AlterRoleRequest,
  CreateRoleRequest,
  MembershipOp,
  PrivilegeOp,
  SchemaPrivilegeOp,
  TablePrivilegeOp,
} from './types';

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const rolesApi = {
  listRoles: (sessionId: string) =>
    normalizeCommandError(commands.listRoles(sessionId)),

  listRoleMembers: (sessionId: string, roleName: string) =>
    normalizeCommandError(commands.listRoleMembers(sessionId, roleName)),

  getRoleDependents: (sessionId: string, roleName: string) =>
    normalizeCommandError(commands.getRoleDependents(sessionId, roleName)),

  createRole: (sessionId: string, request: CreateRoleRequest) =>
    normalizeCommandError(commands.createRole(sessionId, request)).then(() => undefined),

  alterRole: (sessionId: string, roleName: string, request: AlterRoleRequest) =>
    normalizeCommandError(commands.alterRole(sessionId, roleName, request)).then(() => undefined),

  dropRole: (sessionId: string, roleName: string) =>
    normalizeCommandError(commands.dropRole(sessionId, roleName)).then(() => undefined),

  manageRoleMembership: (sessionId: string, ops: MembershipOp[]) =>
    normalizeCommandError(commands.manageRoleMembership(sessionId, ops)),

  listRolePrivileges: (sessionId: string, roleName: string) =>
    normalizeCommandError(commands.listRolePrivileges(sessionId, roleName)),

  manageRolePrivileges: (sessionId: string, roleName: string, ops: PrivilegeOp[]) =>
    normalizeCommandError(commands.manageRolePrivileges(sessionId, roleName, ops)),

  listTablePrivileges: (sessionId: string, schema: string, table: string) =>
    normalizeCommandError(commands.listTablePrivileges(sessionId, schema, table)),

  manageTablePrivileges: (sessionId: string, schema: string, table: string, ops: TablePrivilegeOp[]) =>
    normalizeCommandError(commands.manageTablePrivileges(sessionId, schema, table, ops)),

  listSchemaPrivileges: (sessionId: string, schema: string) =>
    normalizeCommandError(commands.listSchemaPrivileges(sessionId, schema)),

  manageSchemaPrivileges: (sessionId: string, schema: string, ops: SchemaPrivilegeOp[]) =>
    normalizeCommandError(commands.manageSchemaPrivileges(sessionId, schema, ops)),
};
