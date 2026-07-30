import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Key, Link2, ListTree, Maximize2, Table2, X, ZoomIn, ZoomOut } from 'lucide-react';
import clsx from 'clsx';
import { Badge, Button, IconButton } from '@prost/ui';
import { useMetadata, useSchemaForeignKeys } from '../api/metadata';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { buildErGraph, edgePath, graphBounds, layoutErGraph, type ErEdge, type ErNode } from './erLayout';

export interface ErDiagramViewProps {
  connectionId: string;
  schema: string;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const FIT_PADDING = 24;
/** Pointer travel (px) past which a press counts as a pan rather than a click. */
const DRAG_THRESHOLD = 4;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** `schema.table` → the bare table name, for labels. */
function tableOf(key: string): string {
  return key.slice(key.indexOf('.') + 1);
}

/**
 * The read-only ER diagram for one schema (Phase 36): tables as nodes, foreign keys as edges, laid
 * out client-side from metadata the app already fetches. Clicking a node opens that table; clicking
 * an edge shows its constraint detail and can open either side. Read + navigate only — no DDL, no
 * persisted layout (architecture-principles §13).
 */
export function ErDiagramView({ connectionId, schema }: ErDiagramViewProps) {
  const metadata = useMetadata(connectionId);
  const foreignKeys = useSchemaForeignKeys(connectionId, schema);
  const openTable = useWorkspaceStore((state) => state.openTable);

  const [showAllColumns, setShowAllColumns] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [transform, setTransform] = useState<Transform>({ x: FIT_PADDING, y: FIT_PADDING, scale: 1 });

  const viewportRef = useRef<HTMLDivElement>(null);
  // Active pointers on the canvas, for one-finger pan and two-finger pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const draggedRef = useRef(false);

  // Engines with no schema layer (SQLite) report a single namespace — fall back to it.
  const schemaMetadata =
    metadata.data?.find((entry) => entry.name === schema) ??
    (metadata.data?.length === 1 ? metadata.data[0] : undefined);

  const graph = useMemo(
    () => layoutErGraph(buildErGraph(schemaMetadata?.tables ?? [], foreignKeys.data ?? [], schema), { showAllColumns }),
    [schemaMetadata, foreignKeys.data, schema, showAllColumns],
  );

  const bounds = useMemo(() => graphBounds(graph.nodes), [graph]);
  const nodesByKey = useMemo(() => new Map(graph.nodes.map((node) => [node.key, node])), [graph]);
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || bounds.width === 0 || bounds.height === 0) return;
    const { width, height } = viewport.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const scale = clampScale(
      Math.min(1, (width - FIT_PADDING * 2) / bounds.width, (height - FIT_PADDING * 2) / bounds.height),
    );
    setTransform({
      scale,
      x: Math.max(FIT_PADDING, (width - bounds.width * scale) / 2),
      y: Math.max(FIT_PADDING, (height - bounds.height * scale) / 2),
    });
  }, [bounds]);

  // Fit once per schema/connection, not on every column-toggle re-layout.
  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema, graph.nodes.length]);

  // Wheel must be a non-passive native listener to stop the surrounding panel from scrolling.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      setTransform((current) => {
        const scale = clampScale(current.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
        const ratio = scale / current.scale;
        return { scale, x: pointerX - (pointerX - current.x) * ratio, y: pointerY - (pointerY - current.y) * ratio };
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
    // Re-attaches when the canvas first appears (it isn't rendered while loading or when empty).
  }, [graph.nodes.length]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: transform.scale };
      panRef.current = null;
      return;
    }
    panRef.current = {
      x: event.clientX - transform.x,
      y: event.clientY - transform.y,
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
    };
    draggedRef.current = false;
    // Optional: jsdom (and older browsers) don't implement pointer capture; panning still works.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch.distance > 0) {
        setTransform((current) => ({ ...current, scale: clampScale((pinch.scale * distance) / pinch.distance) }));
      }
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    if (Math.hypot(event.clientX - pan.originX, event.clientY - pan.originY) > DRAG_THRESHOLD) pan.moved = true;
    setTransform((current) => ({ ...current, x: event.clientX - pan.x, y: event.clientY - pan.y }));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      // Remember the drag past pointerup: the click that follows it must not select an edge.
      draggedRef.current = panRef.current?.moved ?? false;
      panRef.current = null;
    }
  }

  function selectEdge(id: string) {
    if (draggedRef.current) return;
    setSelectedEdgeId(id);
    setPanelOpen(true);
  }

  function zoomBy(factor: number) {
    setTransform((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  }

  if (metadata.isLoading || foreignKeys.isLoading) {
    return <p className="px-lg py-md text-sm text-text-faint">Loading diagram…</p>;
  }
  if (metadata.isError || foreignKeys.isError) {
    return <p className="px-lg py-md text-sm text-danger">Failed to load schema relationships.</p>;
  }

  const highlighted = selectedEdge ? new Set([selectedEdge.source, selectedEdge.target]) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-sm border-b border-border bg-surface px-sm py-1.5 text-xs text-text-faint">
        <span className="flex items-center gap-1 font-medium text-text">
          <Table2 size={13} className="text-accent" />
          {schema}
        </span>
        <span>
          {graph.nodes.length} {graph.nodes.length === 1 ? 'table' : 'tables'} · {graph.edges.length}{' '}
          {graph.edges.length === 1 ? 'relationship' : 'relationships'}
        </span>
        {graph.droppedEdges > 0 ? (
          <Badge variant="neutral">
            {graph.droppedEdges} outside this schema
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAllColumns}
            onClick={() => setShowAllColumns((value) => !value)}
          >
            {showAllColumns ? 'Key columns' : 'All columns'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((value) => !value)}
          >
            <ListTree size={13} />
            Relationships
          </Button>
          <IconButton aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <ZoomOut size={13} />
          </IconButton>
          <IconButton aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            <ZoomIn size={13} />
          </IconButton>
          <IconButton aria-label="Fit to view" onClick={fitToView}>
            <Maximize2 size={13} />
          </IconButton>
        </div>
      </div>

      {graph.nodes.length === 0 ? (
        <p className="px-lg py-md text-sm italic text-text-faint">No tables in this schema.</p>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-hidden bg-surface-sunken"
            style={{ touchAction: 'none', cursor: 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: bounds.width,
                height: bounds.height,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            >
              {/* Edges are reachable as real buttons in the Relationships panel, so the paths are decorative. */}
              <svg
                width={bounds.width}
                height={bounds.height}
                className="absolute left-0 top-0 overflow-visible"
                aria-hidden
              >
                {graph.edges.map((edge) => {
                  const source = nodesByKey.get(edge.source);
                  const target = nodesByKey.get(edge.target);
                  if (!source || !target) return null;
                  const d = edgePath(source, target);
                  const active = edge.id === selectedEdgeId;
                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        strokeWidth={14}
                        stroke="transparent"
                        data-edge={edge.id}
                        className="cursor-pointer"
                        onClick={() => selectEdge(edge.id)}
                      />
                      <path
                        d={d}
                        fill="none"
                        strokeWidth={active ? 2 : 1.5}
                        className={clsx('pointer-events-none', active ? 'stroke-accent' : 'stroke-border')}
                      />
                    </g>
                  );
                })}
              </svg>

              {graph.nodes.map((node) => (
                <ErNodeCard
                  key={node.key}
                  node={node}
                  showAllColumns={showAllColumns}
                  highlighted={highlighted?.has(node.key) ?? false}
                  onOpen={() => openTable(connectionId, node.schema, node.table, 'rows')}
                />
              ))}
            </div>
          </div>

          {panelOpen ? (
            <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-surface max-md:absolute max-md:inset-0 max-md:w-full">
              <div className="flex items-center gap-sm border-b border-border px-sm py-1.5">
                <span className="text-xs font-medium text-text">Relationships</span>
                <IconButton aria-label="Close relationships panel" className="ml-auto" onClick={() => setPanelOpen(false)}>
                  <X size={13} />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {graph.edges.length === 0 ? (
                  <p className="px-sm py-md text-xs italic text-text-faint">
                    No foreign-key relationships in this schema.
                  </p>
                ) : (
                  graph.edges.map((edge) => (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => setSelectedEdgeId(edge.id)}
                      className={clsx(
                        'flex w-full flex-col items-start gap-0.5 border-b border-border px-sm py-2 text-left text-xs transition-colors',
                        edge.id === selectedEdgeId ? 'bg-accent-muted text-accent' : 'text-text-muted hover:bg-surface-hover',
                      )}
                    >
                      <span className="font-medium">
                        {tableOf(edge.source)} → {tableOf(edge.target)}
                      </span>
                      <span className="truncate font-mono text-[11px] text-text-faint">{edge.constraintName}</span>
                    </button>
                  ))
                )}
              </div>
              {selectedEdge ? (
                <EdgeDetail
                  edge={selectedEdge}
                  onOpen={(key) => {
                    const node = nodesByKey.get(key);
                    if (node) openTable(connectionId, node.schema, node.table, 'rows');
                  }}
                />
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ErNodeCardProps {
  node: ErNode;
  showAllColumns: boolean;
  highlighted: boolean;
  onOpen: () => void;
}

function ErNodeCard({ node, showAllColumns, highlighted, onOpen }: ErNodeCardProps) {
  const columns = showAllColumns ? node.columns : node.keyColumns;
  return (
    <button
      type="button"
      aria-label={`Open table ${node.table}`}
      onClick={onOpen}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      className={clsx(
        'absolute flex flex-col overflow-hidden rounded-md border bg-surface text-left transition-colors hover:border-accent',
        highlighted ? 'border-accent' : 'border-border',
      )}
    >
      <span className="flex h-[30px] shrink-0 items-center gap-1 border-b border-border bg-surface-raised px-2 text-xs font-medium text-text">
        <Table2 size={12} className="shrink-0 text-accent" />
        <span className="truncate">{node.table}</span>
      </span>
      {columns.map((column) => (
        <span key={column.name} className="flex h-5 items-center gap-1 px-2 text-[11px] text-text-muted">
          {column.isPrimaryKey ? (
            <Key size={10} className="shrink-0 text-accent" aria-hidden />
          ) : column.isForeignKey ? (
            <Link2 size={10} className="shrink-0 text-text-faint" aria-hidden />
          ) : (
            <span className="w-2.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{column.name}</span>
          <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-text-faint">{column.dataType}</span>
        </span>
      ))}
    </button>
  );
}

interface EdgeDetailProps {
  edge: ErEdge;
  onOpen: (nodeKey: string) => void;
}

/** The selected constraint: its column mapping, referential actions, and both endpoints. */
function EdgeDetail({ edge, onOpen }: EdgeDetailProps) {
  return (
    <div className="shrink-0 border-t border-border p-sm text-xs">
      <p className="mb-1 truncate font-mono text-[11px] text-text-faint">{edge.constraintName}</p>
      <ul className="mb-sm space-y-0.5">
        {edge.pairs.map((pair) => (
          <li key={`${pair.from}:${pair.to}`} className="font-mono text-[11px] text-text">
            {tableOf(edge.source)}.{pair.from} → {tableOf(edge.target)}.{pair.to}
          </li>
        ))}
      </ul>
      <div className="mb-sm flex flex-wrap gap-1 text-[11px] text-text-faint">
        <span>on delete {edge.onDelete ?? 'NO ACTION'}</span>
        <span>· on update {edge.onUpdate ?? 'NO ACTION'}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button variant="secondary" size="sm" onClick={() => onOpen(edge.source)}>
          Open {tableOf(edge.source)}
        </Button>
        {edge.selfReference ? null : (
          <Button variant="secondary" size="sm" onClick={() => onOpen(edge.target)}>
            Open {tableOf(edge.target)}
          </Button>
        )}
      </div>
    </div>
  );
}
