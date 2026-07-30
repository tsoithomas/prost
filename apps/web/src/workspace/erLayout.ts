import type { SchemaForeignKey, TableMetadata } from '@prost/shared-types';

/** A column as the diagram shows it: name, type, and its key roles. */
export interface ErColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

/** One table in the diagram. Geometry is filled in by `layoutErGraph`. */
export interface ErNode {
  /** `schema.table` — the stable identity used by edges and React keys. */
  key: string;
  schema: string;
  table: string;
  /** Every column, in catalog order. */
  columns: ErColumn[];
  /** PK/FK columns only — what a node card shows unless "all columns" is on. */
  keyColumns: ErColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One FK constraint, whatever its arity: `source` (child) references `target` (parent). */
export interface ErEdge {
  /** Unique within a graph: constraint names repeat across tables on MySQL/SQLite. */
  id: string;
  constraintName: string;
  source: string;
  target: string;
  /** Ordered local→referenced column pairs; a composite FK has more than one. */
  pairs: { from: string; to: string }[];
  onDelete?: string;
  onUpdate?: string;
  selfReference: boolean;
}

export interface ErGraph {
  nodes: ErNode[];
  edges: ErEdge[];
  /** FKs pointing outside this schema, which the diagram can't draw. Surfaced as a note. */
  droppedEdges: number;
}

export interface ErLayoutOptions {
  /** Size nodes for every column rather than just PK/FK columns. */
  showAllColumns?: boolean;
}

// Geometry constants (px, at zoom 1). Sizes are derived arithmetically from identifier lengths —
// never measured from the DOM — so the layout is deterministic and unit-testable.
const NODE_MIN_WIDTH = 168;
const NODE_MAX_WIDTH = 300;
const CHAR_WIDTH = 6.6;
const NODE_PADDING = 28;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 20;
const NODE_PADDING_Y = 8;
const GAP_X = 96;
const GAP_Y = 28;
const COMPONENT_GAP_Y = 56;

function nodeKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

/**
 * Builds the diagram graph from already-fetched metadata: one node per table, one edge per FK
 * constraint (a composite FK is a single edge carrying its column pairs). `schema` resolves FK
 * endpoints on engines with no schema namespace (MySQL/SQLite report `null`). Edges pointing at a
 * table outside this schema are dropped — the diagram is bounded to one schema by design.
 */
export function buildErGraph(
  tables: TableMetadata[],
  foreignKeys: SchemaForeignKey[],
  schema: string,
): ErGraph {
  const fkColumnsByTable = new Map<string, Set<string>>();
  for (const fk of foreignKeys) {
    const key = nodeKey(fk.schema ?? schema, fk.table);
    const set = fkColumnsByTable.get(key) ?? new Set<string>();
    for (const column of fk.columns) set.add(column);
    fkColumnsByTable.set(key, set);
  }

  const nodes: ErNode[] = tables.map((table) => {
    const key = nodeKey(table.schema, table.name);
    const fkColumns = fkColumnsByTable.get(key) ?? new Set<string>();
    const columns: ErColumn[] = table.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      isPrimaryKey: column.isPrimaryKey,
      isForeignKey: fkColumns.has(column.name),
    }));
    return {
      key,
      schema: table.schema,
      table: table.name,
      columns,
      keyColumns: columns.filter((column) => column.isPrimaryKey || column.isForeignKey),
      x: 0,
      y: 0,
      width: NODE_MIN_WIDTH,
      height: HEADER_HEIGHT,
    };
  });

  const byKey = new Set(nodes.map((node) => node.key));
  const edges: ErEdge[] = [];
  let droppedEdges = 0;

  for (const fk of foreignKeys) {
    const source = nodeKey(fk.schema ?? schema, fk.table);
    const target = nodeKey(fk.referencedSchema ?? schema, fk.referencedTable);
    if (!byKey.has(source) || !byKey.has(target)) {
      droppedEdges += 1;
      continue;
    }
    edges.push({
      id: `${source}:${fk.constraintName}`,
      constraintName: fk.constraintName,
      source,
      target,
      pairs: fk.columns.map((from, i) => ({ from, to: fk.referencedColumns[i] ?? '' })),
      ...(fk.onDelete ? { onDelete: fk.onDelete } : {}),
      ...(fk.onUpdate ? { onUpdate: fk.onUpdate } : {}),
      selfReference: source === target,
    });
  }

  return { nodes, edges, droppedEdges };
}

function measureNode(node: ErNode, showAllColumns: boolean): { width: number; height: number } {
  const visible = showAllColumns ? node.columns : node.keyColumns;
  const longest = visible.reduce(
    (max, column) => Math.max(max, column.name.length + column.dataType.length + 2),
    node.table.length,
  );
  return {
    width: Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, Math.round(longest * CHAR_WIDTH + NODE_PADDING))),
    height: HEADER_HEIGHT + visible.length * ROW_HEIGHT + (visible.length > 0 ? NODE_PADDING_Y : 0),
  };
}

/** Undirected adjacency over the drawable edges, used for both components and layering. */
function neighbourMap(graph: ErGraph): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const node of graph.nodes) map.set(node.key, new Set());
  for (const edge of graph.edges) {
    if (edge.selfReference) continue;
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

/** Connected components, each a list of node keys, ordered largest-first then alphabetically. */
function components(graph: ErGraph, neighbours: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const found: string[][] = [];
  for (const node of graph.nodes) {
    if (seen.has(node.key)) continue;
    const queue = [node.key];
    const group: string[] = [];
    seen.add(node.key);
    while (queue.length > 0) {
      const key = queue.shift()!;
      group.push(key);
      for (const next of Array.from(neighbours.get(key) ?? []).sort()) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    found.push(group);
  }
  return found.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}

/**
 * Assigns positions with a small dependency-free layered layout: each connected component is laid
 * out in columns of BFS distance from its most-referenced table, ordered within a column by the
 * barycenter of its previous-column neighbours, and components are stacked vertically. Fully
 * deterministic — same input, same coordinates.
 */
export function layoutErGraph(graph: ErGraph, options: ErLayoutOptions = {}): ErGraph {
  const showAllColumns = options.showAllColumns ?? false;
  const nodes = graph.nodes.map((node) => ({ ...node, ...measureNode(node, showAllColumns) }));
  const sized = new Map(nodes.map((node) => [node.key, node]));
  const neighbours = neighbourMap({ ...graph, nodes });

  const incoming = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.selfReference) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  let componentTop = 0;

  for (const group of components({ ...graph, nodes }, neighbours)) {
    const root = group
      .slice()
      .sort((a, b) => (incoming.get(b) ?? 0) - (incoming.get(a) ?? 0) || a.localeCompare(b))[0]!;

    // BFS distance from the root = the column a node sits in.
    const layers: string[][] = [];
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    while (queue.length > 0) {
      const key = queue.shift()!;
      const level = depth.get(key)!;
      (layers[level] ??= []).push(key);
      for (const next of Array.from(neighbours.get(key) ?? []).sort()) {
        if (depth.has(next)) continue;
        depth.set(next, level + 1);
        queue.push(next);
      }
    }

    // One barycenter pass: pull each node next to the previous column's neighbours it connects to.
    for (let level = 1; level < layers.length; level++) {
      const previous = layers[level - 1]!;
      const rank = new Map(previous.map((key, index) => [key, index]));
      layers[level] = layers[level]!.slice().sort((a, b) => {
        const centre = (key: string) => {
          const ranks = Array.from(neighbours.get(key) ?? [])
            .map((n) => rank.get(n))
            .filter((r): r is number => r !== undefined);
          return ranks.length > 0 ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : Number.MAX_SAFE_INTEGER;
        };
        return centre(a) - centre(b) || a.localeCompare(b);
      });
    }

    const layerHeights = layers.map(
      (layer) => layer.reduce((sum, key) => sum + sized.get(key)!.height, 0) + GAP_Y * Math.max(0, layer.length - 1),
    );
    const tallest = Math.max(0, ...layerHeights);

    let x = 0;
    layers.forEach((layer, level) => {
      const width = Math.max(...layer.map((key) => sized.get(key)!.width));
      let y = componentTop + (tallest - layerHeights[level]!) / 2;
      for (const key of layer) {
        const node = sized.get(key)!;
        node.x = x;
        node.y = y;
        y += node.height + GAP_Y;
      }
      x += width + GAP_X;
    });

    componentTop += tallest + COMPONENT_GAP_Y;
  }

  return { ...graph, nodes };
}

export interface ErBounds {
  width: number;
  height: number;
}

/** The laid-out graph's extent, for "fit to view" and the SVG canvas size. */
export function graphBounds(nodes: ErNode[]): ErBounds {
  return {
    width: Math.max(0, ...nodes.map((node) => node.x + node.width)),
    height: Math.max(0, ...nodes.map((node) => node.y + node.height)),
  };
}

/**
 * The SVG path for an edge: a horizontal cubic bezier between the facing sides of the two nodes,
 * or a loop off the right side for a self-reference.
 */
export function edgePath(source: ErNode, target: ErNode): string {
  if (source.key === target.key) {
    const x = source.x + source.width;
    const y = source.y + source.height / 2;
    return `M ${x} ${y - 8} C ${x + 44} ${y - 28}, ${x + 44} ${y + 28}, ${x} ${y + 8}`;
  }

  const sourceIsLeft = source.x + source.width / 2 <= target.x + target.width / 2;
  const x1 = sourceIsLeft ? source.x + source.width : source.x;
  const x2 = sourceIsLeft ? target.x : target.x + target.width;
  const y1 = source.y + source.height / 2;
  const y2 = target.y + target.height / 2;
  const curve = Math.max(32, Math.abs(x2 - x1) / 2);
  const c1 = sourceIsLeft ? x1 + curve : x1 - curve;
  const c2 = sourceIsLeft ? x2 - curve : x2 + curve;

  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}
