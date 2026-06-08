import type { ColumnDef } from "../../lib/bindings";

export type {
  ColumnDef,
  FunctionSummary,
  SchemaObjects,
  TableSummary,
} from "../../lib/bindings";

export type GroupLabel = 'Tables' | 'Views' | 'Sequences' | 'Functions';

export type TreeNode =
  | { kind: 'schema'; name: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'group'; label: GroupLabel; count: number; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'table'; name: string; schema: string; database: string; sessionId: string; connectionId: string; estimatedRows: number | null }
  | { kind: 'view'; name: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'sequence'; name: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'function'; name: string; resultType: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'column'; def: ColumnDef; table: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'roles-group'; sessionId: string; connectionId: string }
  | { kind: 'role'; name: string; sessionId: string; connectionId: string }
  | { kind: 'loading'; depth: number }
  | { kind: 'error'; message: string; depth: number; onRetry?: () => void };


