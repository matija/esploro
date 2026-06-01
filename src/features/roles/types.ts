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
