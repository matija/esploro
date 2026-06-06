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

export function nodeKey(node: TreeNode): string {
  switch (node.kind) {
    case 'schema':
      return `${node.connectionId}:db:${node.database}:schema:${node.name}`;
    case 'group':
      return `${node.connectionId}:db:${node.database}:schema:${node.schema}:group:${node.label}`;
    case 'table':
      return `${node.connectionId}:db:${node.database}:schema:${node.schema}:table:${node.name}`;
    case 'view':
      return `${node.connectionId}:db:${node.database}:schema:${node.schema}:view:${node.name}`;
    case 'column':
      return `${node.connectionId}:db:${node.database}:schema:${node.schema}:table:${node.table}:col:${node.def.name}`;
    case 'roles-group':
      return `${node.connectionId}:roles`;
    case 'role':
      return `${node.connectionId}:role:${node.name}`;
    default:
      return '';
  }
}

export function nodeDepth(node: TreeNode): number {
  switch (node.kind) {
    case 'schema': return 1;
    case 'group': return 2;
    case 'table':
    case 'view':
    case 'sequence':
    case 'function': return 3;
    case 'column': return 4;
    case 'roles-group': return 1;
    case 'role': return 2;
    case 'loading':
    case 'error': return node.depth;
    default: return 0;
  }
}
