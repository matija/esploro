export interface TableSummary {
  name: string;
  estimatedRowCount: number | null;
}

export interface FunctionSummary {
  name: string;
  resultType: string;
}

export interface SchemaObjects {
  tables: TableSummary[];
  views: string[];
  sequences: string[];
  functions: FunctionSummary[];
}

export interface ColumnDef {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyRef: string | null;
}

export type GroupLabel = 'Tables' | 'Views' | 'Sequences' | 'Functions';

export type TreeNode =
  | { kind: 'database'; name: string; sessionId: string; connectionId: string }
  | { kind: 'schema'; name: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'group'; label: GroupLabel; count: number; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'table'; name: string; schema: string; database: string; sessionId: string; connectionId: string; estimatedRows: number | null }
  | { kind: 'view'; name: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'sequence'; name: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'function'; name: string; resultType: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'column'; def: ColumnDef; table: string; schema: string; database: string; sessionId: string; connectionId: string }
  | { kind: 'loading'; depth: number }
  | { kind: 'error'; message: string; depth: number };

export function nodeKey(node: TreeNode): string {
  switch (node.kind) {
    case 'database':
      return `${node.connectionId}:db:${node.name}`;
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
    default:
      return '';
  }
}

export function nodeDepth(node: TreeNode): number {
  switch (node.kind) {
    case 'database': return 0;
    case 'schema': return 1;
    case 'group': return 2;
    case 'table':
    case 'view':
    case 'sequence':
    case 'function': return 3;
    case 'column': return 4;
    case 'loading':
    case 'error': return node.depth;
    default: return 0;
  }
}
