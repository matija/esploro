import { invoke } from '@tauri-apps/api/core';
import type {
  AlterRoleRequest,
  CreateRoleRequest,
  MembershipOp,
  MembershipResult,
  PrivilegeOp,
  PrivilegeResult,
  RoleDependent,
  RoleMembers,
  RolePrivileges,
  RoleSummary,
} from './types';

export const rolesApi = {
  listRoles: (sessionId: string) =>
    invoke<RoleSummary[]>('list_roles', { sessionId }),

  listRoleMembers: (sessionId: string, roleName: string) =>
    invoke<RoleMembers>('list_role_members', { sessionId, roleName }),

  getRoleDependents: (sessionId: string, roleName: string) =>
    invoke<RoleDependent[]>('get_role_dependents', { sessionId, roleName }),

  createRole: (sessionId: string, request: CreateRoleRequest) =>
    invoke<void>('create_role', { sessionId, request }),

  alterRole: (sessionId: string, roleName: string, request: AlterRoleRequest) =>
    invoke<void>('alter_role', { sessionId, roleName, request }),

  dropRole: (sessionId: string, roleName: string) =>
    invoke<void>('drop_role', { sessionId, roleName }),

  manageRoleMembership: (sessionId: string, ops: MembershipOp[]) =>
    invoke<MembershipResult[]>('manage_role_membership', { sessionId, ops }),

  listRolePrivileges: (sessionId: string, roleName: string) =>
    invoke<RolePrivileges>('list_role_privileges', { sessionId, roleName }),

  manageRolePrivileges: (sessionId: string, roleName: string, ops: PrivilegeOp[]) =>
    invoke<PrivilegeResult[]>('manage_role_privileges', { sessionId, roleName, ops }),
};
