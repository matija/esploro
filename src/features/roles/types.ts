export interface RoleSummary {
  name: string;
  isSuperuser: boolean;
  inherit: boolean;
  createRole: boolean;
  createDb: boolean;
  canLogin: boolean;
  replication: boolean;
  bypassRls: boolean;
  connLimit: number;
  validUntil: string | null;
}

export interface RoleMembers {
  memberOf: string[];
  members: string[];
}

export interface RoleDependent {
  kind: string;
  name: string;
}

export interface CreateRoleRequest {
  name: string;
  isSuperuser?: boolean;
  inherit?: boolean;
  createRole?: boolean;
  createDb?: boolean;
  canLogin?: boolean;
  replication?: boolean;
  bypassRls?: boolean;
  connLimit?: number;
  validUntil?: string;
  password?: string;
}

export interface AlterRoleRequest {
  isSuperuser?: boolean;
  inherit?: boolean;
  createRole?: boolean;
  createDb?: boolean;
  canLogin?: boolean;
  replication?: boolean;
  bypassRls?: boolean;
  connLimit?: number;
  validUntil?: string;
  password?: string;
}

export type MembershipOpKind = 'grant' | 'revoke';

export interface MembershipOp {
  op: MembershipOpKind;
  role: string;
  member: string;
}

export interface MembershipResult {
  op: string;
  role: string;
  member: string;
  error: string | null;
}

export interface RoleTableGrant {
  schema: string;
  table: string;
  privileges: string[];
}

export interface RoleSchemaGrant {
  schema: string;
  privileges: string[];
}

export interface RolePrivileges {
  tableGrants: RoleTableGrant[];
  schemaGrants: RoleSchemaGrant[];
}

export interface PrivilegeOp {
  op: 'grant' | 'revoke';
  objectType: 'table' | 'schema';
  schema: string;
  name: string;
  privilege: string;
}

export interface PrivilegeResult {
  sql: string;
  error: string | null;
}

export interface TableGrantee {
  grantee: string;
  privileges: string[];
}

export interface TablePrivilegeOp {
  op: 'grant' | 'revoke';
  grantee: string;
  privilege: string;
}

export interface SchemaGrantee {
  grantee: string;
  privileges: string[];
}

export interface SchemaInfo {
  owner: string;
  grantees: SchemaGrantee[];
}

export interface SchemaPrivilegeOp {
  op: 'grant' | 'revoke';
  grantee: string;
  privilege: string;
}
