import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useContext } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node as RFNode,
  Controls,
  Background,
  Handle,
  Position,
  ReactFlowProvider,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { NodeViewWrapper } from '@tiptap/react';
import { Layout, Maximize2, Minimize2, Bold, Link2, Square, FileText } from 'lucide-react';

const nodeWidth = 150;
const nodeHeight = 50;

const getLayoutedElements = (nodes: RFNode[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction, align: 'DL', nodesep: 40, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    
    // Set handle positions based on direction
    node.targetPosition = direction === 'LR' ? Position.Left : Position.Top;
    node.sourcePosition = direction === 'LR' ? Position.Right : Position.Bottom;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

type MindMapActions = {
  selectNode: (id: string) => void;
  startEditing: (id: string) => void;
  updateLabel: (id: string, label: string) => void;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  addChildNode: (parentId: string) => void;
  addSiblingNode: (siblingId: string) => void;
};

const MindMapActionsContext = React.createContext<MindMapActions | null>(null);

const useMindMapActions = () => {
  const ctx = useContext(MindMapActionsContext);
  if (!ctx) throw new Error('MindMapActionsContext is missing');
  return ctx;
};

const BoundaryNode = ({ id, data }: any) => {
  const actions = useMindMapActions();
  const w = typeof data?.w === 'number' ? data.w : nodeWidth;
  const h = typeof data?.h === 'number' ? data.h : nodeHeight;
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState<string>(typeof data?.label === 'string' ? data.label : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEditNonceRef = useRef<number>(0);

  useEffect(() => {
    setLabel(typeof data?.label === 'string' ? data.label : '');
  }, [data?.label]);

  useEffect(() => {
    const nextNonce = typeof data?.editNonce === 'number' ? data.editNonce : 0;
    if (nextNonce > 0 && nextNonce !== lastEditNonceRef.current) {
      lastEditNonceRef.current = nextNonce;
      setIsEditing(true);
    }
  }, [data?.editNonce]);

  useLayoutEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true } as any);
      el.select();
    } catch {
      el.focus();
      el.select();
    }
  }, [isEditing]);

  return (
    <div style={{ width: w, height: h }} className="relative">
      <div className="absolute inset-0 border-2 border-dashed border-gray-400/70 rounded-xl bg-transparent" />
      <div className="absolute left-1/2 -translate-x-1/2 -top-3">
        {isEditing ? (
          <input
            ref={inputRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              setIsEditing(false);
              actions.updateNodeData(id, { label });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setIsEditing(false);
                setLabel(typeof data?.label === 'string' ? data.label : '');
              }
            }}
            className="px-2 py-1 text-xs rounded-md border border-gray-300 bg-white text-gray-900 shadow-sm min-w-[80px] text-center"
          />
        ) : (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actions.selectNode(id);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actions.selectNode(id);
              actions.startEditing(id);
            }}
            className={`px-2 py-1 text-xs rounded-md border shadow-sm ${label ? 'border-gray-300 bg-white text-gray-900' : 'border-transparent bg-transparent text-transparent'} `}
          >
            {label || '...'}
          </button>
        )}
      </div>
    </div>
  );
};

const SummaryNode = ({ id, data }: any) => {
  const actions = useMindMapActions();
  const h = typeof data?.h === 'number' ? data.h : 120;
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState<string>(typeof data?.label === 'string' ? data.label : '概要');
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEditNonceRef = useRef<number>(0);

  useEffect(() => {
    setLabel(typeof data?.label === 'string' ? data.label : '概要');
  }, [data?.label]);

  useEffect(() => {
    const nextNonce = typeof data?.editNonce === 'number' ? data.editNonce : 0;
    if (nextNonce > 0 && nextNonce !== lastEditNonceRef.current) {
      lastEditNonceRef.current = nextNonce;
      setIsEditing(true);
    }
  }, [data?.editNonce]);

  useLayoutEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true } as any);
      el.select();
    } catch {
      el.focus();
      el.select();
    }
  }, [isEditing]);

  const braceW = 78;
  const mid = h / 2;
  const xTouch = 0;
  const xOuter = braceW - 14;
  const yTop = 0;
  const yBottom = h;
  const xMidOnCurve = xOuter * 0.75;

  const path = `M ${xTouch} ${yTop} C ${xOuter} ${yTop} ${xOuter} ${yBottom} ${xTouch} ${yBottom}`;

  return (
    <div style={{ width: braceW + 44, height: h }} className="relative">
      <svg width={braceW} height={h} className="absolute left-0 top-0">
        <path d={path} fill="none" stroke="#111827" strokeWidth={2} strokeLinecap="round" />
        <line x1={xMidOnCurve} y1={mid} x2={braceW} y2={mid} stroke="#111827" strokeWidth={2} strokeLinecap="round" />
      </svg>

      <div className="absolute" style={{ left: braceW + 10, top: '50%', transform: 'translateY(-50%)' }}>
        {isEditing ? (
          <input
            ref={inputRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              setIsEditing(false);
              actions.updateNodeData(id, { label: label.trim() || '概要' });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setIsEditing(false);
                setLabel(typeof data?.label === 'string' ? data.label : '概要');
              }
            }}
            className="px-4 py-2 text-sm rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm min-w-[84px] text-center"
          />
        ) : (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actions.selectNode(id);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actions.selectNode(id);
              actions.startEditing(id);
            }}
            className="px-4 py-2 text-sm rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm"
          >
            {label}
          </button>
        )}
      </div>
    </div>
  );
};

const CustomNode = ({ data, id, selected }: any) => {
  const actions = useMindMapActions();
  const [label, setLabel] = useState(data.label);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEditNonceRef = useRef<number>(0);

  useEffect(() => {
    setLabel(data.label);
  }, [data.label]);

  // Sync editing state from data if triggered externally
  useEffect(() => {
    const nextNonce = typeof data?.editNonce === 'number' ? data.editNonce : 0;
    if (nextNonce > 0 && nextNonce !== lastEditNonceRef.current) {
      lastEditNonceRef.current = nextNonce;
      setIsEditing(true);
    }
  }, [data?.editNonce]);

  const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    setLabel(evt.target.value);
  };

  const handleLabelBlur = () => {
    setIsEditing(false);
    actions.updateLabel(id, label);
  };

  const handleKeyDown = (evt: React.KeyboardEvent) => {
    // Stop propagation to Tiptap
    evt.stopPropagation();

    if (evt.key === 'Enter') {
        evt.preventDefault();
        handleLabelBlur();
        if (evt.shiftKey) {
            actions.addSiblingNode(id);
        }
    }
    if (evt.key === 'Tab') {
        evt.preventDefault();
        handleLabelBlur();
        actions.addChildNode(id);
    }
  };

  useLayoutEffect(() => {
      if (!isEditing) return;
      const el = inputRef.current;
      if (!el) return;
      try {
          el.focus({ preventScroll: true } as any);
          el.select();
      } catch {
          el.focus();
          el.select();
      }
  }, [isEditing]);

  useEffect(() => {
      if (!isEditing) return;
      const t = setTimeout(() => {
          const el = inputRef.current;
          if (!el) return;
          try {
              el.focus({ preventScroll: true } as any);
              el.select();
          } catch {
              el.focus();
              el.select();
          }
      }, 0);
      return () => clearTimeout(t);
  }, [isEditing]);

  const isRoot = id === 'root';

  return (
    <div 
        className={`
            px-4 py-3 shadow-sm rounded-xl min-w-[100px] text-center relative group transition-all duration-200
            ${isRoot ? 'bg-indigo-600 text-white border-2 border-indigo-600' : 'bg-white border-2 border-gray-200 text-gray-800'}
            ${selected ? (isRoot ? 'ring-4 ring-indigo-200' : 'border-indigo-500 ring-2 ring-indigo-100') : ''}
        `}
        onMouseDown={(e) => {
            e.stopPropagation();
            if (!isEditing) actions.selectNode(id);
        }}
        onClick={(e) => {
            e.stopPropagation();
            if (!isEditing) actions.selectNode(id);
        }}
        onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            actions.startEditing(id);
        }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0 !w-2 !h-2" />
      
      {isEditing ? (
          <input 
            ref={inputRef}
            value={label}
            onChange={handleLabelChange}
            onBlur={handleLabelBlur}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => {
                e.stopPropagation();
            }}
            onClick={(e) => {
                e.stopPropagation();
            }}
            className={`w-full text-sm text-center border-none focus:outline-none bg-transparent ${data?.bold ? 'font-bold' : 'font-medium'} ${isRoot ? 'text-white' : 'text-gray-900'}`}
          />
      ) : (
          <div className={`text-sm cursor-text select-none ${data?.bold ? 'font-bold' : 'font-medium'} ${isRoot ? 'text-lg' : ''}`}>
            {label}
          </div>
      )}

      <Handle type="source" position={Position.Right} className="!opacity-0 !w-2 !h-2" />
    </div>
  );
};

const nodeTypes = {
  mindMap: CustomNode,
  boundary: BoundaryNode,
  summary: SummaryNode,
};

const PREVIEW_EDGE_ID = '__mindmap_preview_edge__';

const MindMapInner = ({ initialData, updateAttributes }: any) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges || []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isMindMapSelected, setIsMindMapSelected] = useState(false);
  const [toolbarMode, setToolbarMode] = useState<'none' | 'link'>('none');
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ visible: boolean; x: number; y: number; w: number; h: number }>({
      visible: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const rfInstanceRef = useRef<any>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const didInitialFitRef = useRef(false);
  const fitRafRef = useRef<number | null>(null);
  const selectionMoveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const clipboardRef = useRef<{
      nodes: any[];
      edges: any[];
      rootIds: string[];
      copiedAt: number;
  } | null>(null);
  const historyRef = useRef<{ past: Array<{ nodes: any[]; edges: any[] }>; future: Array<{ nodes: any[]; edges: any[] }> }>({
      past: [],
      future: [],
  });
  const suppressHistoryRef = useRef(false);

  const getNodeBounds = useCallback((ids: string[]) => {
      const byId = new Map<string, any>();
      for (const n of nodesRef.current) byId.set(n.id, n);

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let minCY = Number.POSITIVE_INFINITY;
      let maxCY = Number.NEGATIVE_INFINITY;

      for (const id of ids) {
          const n = byId.get(id);
          if (!n) continue;
          if (n.type !== 'mindMap') continue;
          const x = n.position?.x ?? 0;
          const y = n.position?.y ?? 0;
          const w = typeof n.width === 'number' ? n.width : nodeWidth;
          const h = typeof n.height === 'number' ? n.height : nodeHeight;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
          const cy = y + h / 2;
          minCY = Math.min(minCY, cy);
          maxCY = Math.max(maxCY, cy);
      }

      if (!Number.isFinite(minX)) return null;
      return { minX, minY, maxX, maxY, minCY, maxCY };
  }, []);

  const recomputeOverlays = useCallback(() => {
      setNodes((prev) => {
          let changed = false;
          const next = prev.map((n: any) => {
              if (n.type !== 'boundary' && n.type !== 'summary') return n;
              const memberIds: string[] = Array.isArray(n.data?.memberIds) ? n.data.memberIds : [];
              const bounds = getNodeBounds(memberIds);
              if (!bounds) return n;

              const padding = typeof n.data?.padding === 'number' ? n.data.padding : 20;
              if (n.type === 'boundary') {
                  const x = bounds.minX - padding;
                  const y = bounds.minY - padding;
                  const w = (bounds.maxX - bounds.minX) + padding * 2;
                  const h = (bounds.maxY - bounds.minY) + padding * 2;
                  const same = (n.position?.x === x && n.position?.y === y && n.data?.w === w && n.data?.h === h);
                  if (same) return n;
                  changed = true;
                  return { ...n, position: { x, y }, data: { ...n.data, w, h } };
              }

              const pad = 2;
              const x = bounds.maxX;
              const y = bounds.minCY - pad;
              const h = (bounds.maxCY - bounds.minCY) + pad * 2;
              const same = (n.position?.x === x && n.position?.y === y && n.data?.h === h);
              if (same) return n;
              changed = true;
              return { ...n, position: { x, y }, data: { ...n.data, h } };
          });
          return changed ? next : prev;
      });
  }, [getNodeBounds, setNodes]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    recomputeOverlays();
  }, [nodes, edges, recomputeOverlays]);
  
  const focusContainer = useCallback(() => {
      if (containerRef.current) {
          containerRef.current.focus();
      }
  }, []);

  const setActive = useCallback(() => {
      activeRef.current = true;
  }, []);

  const setSelectedIds = useCallback((ids: string[], primaryId?: string | null) => {
    const unique = Array.from(new Set(ids));
    const primary = primaryId ?? (unique.length > 0 ? unique[0] : null);
    setSelectedNodeIds(unique);
    setSelectedNodeId(primary);
    setNodes((prev) => prev.map((n) => ({ ...n, selected: unique.includes(n.id) })));
  }, [setNodes]);

  const snapshotGraph = useCallback((nodesToSnap?: any[], edgesToSnap?: any[]) => {
      const nodesSrc = nodesToSnap ?? nodesRef.current;
      const edgesSrc = edgesToSnap ?? edgesRef.current;
      const snapNodes = nodesSrc.map((n: any) => ({
          id: n.id,
          type: n.type,
          position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          data: (() => {
              if (n.type === 'mindMap') {
                  return { label: n.data?.label ?? '', bold: !!n.data?.bold };
              }
              if (n.type === 'boundary') {
                  return {
                      memberIds: Array.isArray(n.data?.memberIds) ? n.data.memberIds : [],
                      padding: typeof n.data?.padding === 'number' ? n.data.padding : 20,
                      w: typeof n.data?.w === 'number' ? n.data.w : undefined,
                      h: typeof n.data?.h === 'number' ? n.data.h : undefined,
                  };
              }
              if (n.type === 'summary') {
                  return {
                      memberIds: Array.isArray(n.data?.memberIds) ? n.data.memberIds : [],
                      padding: typeof n.data?.padding === 'number' ? n.data.padding : 12,
                      h: typeof n.data?.h === 'number' ? n.data.h : undefined,
                      label: typeof n.data?.label === 'string' ? n.data.label : '概要',
                  };
              }
              return { label: n.data?.label ?? '' };
          })(),
      }));
      const snapEdges = edgesSrc.map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          style: e.style,
          data: e.data,
      }));
      return { nodes: snapNodes, edges: snapEdges };
  }, []);

  const pushHistory = useCallback((nextNodes?: any[], nextEdges?: any[]) => {
      if (suppressHistoryRef.current) return;
      const snap = snapshotGraph(nextNodes, nextEdges);
      const h = historyRef.current;
      const last = h.past[h.past.length - 1];
      const same = last && JSON.stringify(last) === JSON.stringify(snap);
      if (same) return;
      h.past.push(snap);
      if (h.past.length > 200) h.past.shift();
      h.future = [];
  }, [snapshotGraph]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...params, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, eds);
        pushHistory(nodesRef.current, next);
        return next;
      });
    },
    [setEdges, pushHistory]
  );

  const selectNode = useCallback((id: string) => {
    setActive();
    setSelectedIds([id], id);
  }, [setActive, setSelectedIds]);

  const getNextNodeId = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const currentId = selectedNodeId;
    if (!currentId) return null;
    const all = nodesRef.current;
    const current = all.find((n: any) => n.id === currentId);
    if (!current) return null;

    const cx = current.position?.x ?? 0;
    const cy = current.position?.y ?? 0;

    let bestId: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const n of all) {
      if (!n || n.id === currentId) continue;
      if (n.type !== 'mindMap') continue;
      const nx = n.position?.x ?? 0;
      const ny = n.position?.y ?? 0;
      const dx = nx - cx;
      const dy = ny - cy;

      let score = Number.POSITIVE_INFINITY;
      if (direction === 'right') {
        if (dx <= 0) continue;
        score = dx + Math.abs(dy) * 2;
      } else if (direction === 'left') {
        if (dx >= 0) continue;
        score = -dx + Math.abs(dy) * 2;
      } else if (direction === 'down') {
        if (dy <= 0) continue;
        score = dy + Math.abs(dx) * 2;
      } else if (direction === 'up') {
        if (dy >= 0) continue;
        score = -dy + Math.abs(dx) * 2;
      }

      if (score < bestScore) {
        bestScore = score;
        bestId = n.id;
      }
    }

    return bestId;
  }, [selectedNodeId]);

  const getNearestNodeId = useCallback((anchor: { x: number; y: number }, candidates: any[]) => {
    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const n of candidates) {
      if (!n) continue;
      const nx = n.position?.x ?? 0;
      const ny = n.position?.y ?? 0;
      const dx = nx - anchor.x;
      const dy = ny - anchor.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = n.id;
      }
    }

    return bestId;
  }, []);

  const startEditing = useCallback((id: string) => {
    setNodes((prev) => prev.map((n) => {
      if (n.id !== id) return n;
      const nextNonce = (typeof n.data?.editNonce === 'number' ? n.data.editNonce : 0) + 1;
      return { ...n, data: { ...n.data, editNonce: nextNonce } };
    }));
  }, [setNodes]);

  const commitLayout = useCallback((nextNodes: any[], nextEdges: any[]) => {
    const mindNodes = nextNodes.filter((n: any) => n.type === 'mindMap');
    const otherNodes = nextNodes.filter((n: any) => n.type !== 'mindMap');
    const layoutEdges = nextEdges.filter((e: any) => e?.id !== PREVIEW_EDGE_ID && e?.data?.kind !== 'link');
    const otherEdges = nextEdges.filter((e: any) => e?.id === PREVIEW_EDGE_ID || e?.data?.kind === 'link');

    const { nodes: layoutedMind, edges: layoutedEdges } = getLayoutedElements(mindNodes, layoutEdges);
    const mindById = new Map(layoutedMind.map((n: any) => [n.id, n]));
    const mergedNodes = [...layoutedMind.map((n: any) => ({ ...n })), ...otherNodes.map((n: any) => ({ ...n }))].map((n: any) => {
        if (n.type !== 'mindMap') return n;
        const m = mindById.get(n.id);
        return m ? { ...n, position: m.position, targetPosition: m.targetPosition, sourcePosition: m.sourcePosition } : n;
    });

    const mergedEdges = [...layoutedEdges, ...otherEdges];
    setNodes(mergedNodes);
    setEdges(mergedEdges);
    pushHistory(mergedNodes, mergedEdges);
    requestAnimationFrame(() => {
        recomputeOverlays();
    });
  }, [setNodes, setEdges, recomputeOverlays, pushHistory]);

  const setGraphDirect = useCallback((nextNodes: any[], nextEdges: any[], record = true) => {
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (record) pushHistory(nextNodes, nextEdges);
  }, [setNodes, setEdges, pushHistory]);

  const undo = useCallback(() => {
      const h = historyRef.current;
      if (h.past.length <= 1) return;
      const current = h.past.pop()!;
      h.future.push(current);
      const prev = h.past[h.past.length - 1];
      if (!prev) return;
      suppressHistoryRef.current = true;
      const restoredNodes = prev.nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          data: n.data,
          position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          selected: false,
          draggable: n.type === 'mindMap',
          selectable: n.type === 'mindMap',
          connectable: n.type === 'mindMap',
      }));
      const restoredEdges = prev.edges.map((e: any) => ({
          ...e,
      }));
      setGraphDirect(restoredNodes, restoredEdges, false);
      setSelectedIds([], null);
      requestAnimationFrame(() => {
          suppressHistoryRef.current = false;
      });
  }, [setGraphDirect, setSelectedIds]);

  const redo = useCallback(() => {
      const h = historyRef.current;
      if (h.future.length === 0) return;
      const next = h.future.pop()!;
      h.past.push(next);
      suppressHistoryRef.current = true;
      const restoredNodes = next.nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          data: n.data,
          position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          selected: false,
          draggable: n.type === 'mindMap',
          selectable: n.type === 'mindMap',
          connectable: n.type === 'mindMap',
      }));
      const restoredEdges = next.edges.map((e: any) => ({
          ...e,
      }));
      setGraphDirect(restoredNodes, restoredEdges, false);
      setSelectedIds([], null);
      requestAnimationFrame(() => {
          suppressHistoryRef.current = false;
      });
  }, [setGraphDirect, setSelectedIds]);

  const deleteSelection = useCallback((idsToDelete: string[]) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;

    const first = currentNodes.find((n: any) => n.id === idsToDelete[0]);
    const anchor = { x: first?.position?.x ?? 0, y: first?.position?.y ?? 0 };

    const nodesToRemove = new Set<string>(idsToDelete);
    const edgesToRemove = new Set<string>();

    const queue = [...idsToDelete];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const childEdges = currentEdges.filter((edge: any) => edge.source === currentId);
      childEdges.forEach((edge: any) => {
        edgesToRemove.add(edge.id);
        if (!nodesToRemove.has(edge.target)) {
          nodesToRemove.add(edge.target);
          queue.push(edge.target);
        }
      });
      const incoming = currentEdges.find((edge: any) => edge.target === currentId);
      if (incoming) edgesToRemove.add(incoming.id);
    }

    const newNodes = currentNodes.filter((n: any) => !nodesToRemove.has(n.id));
    const newEdges = currentEdges.filter((edge: any) => !edgesToRemove.has(edge.id));

    if (newNodes.length > 0) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(newNodes, newEdges);
      const nextSelectedId = getNearestNodeId(anchor, layoutedNodes);
      const finalNodes = layoutedNodes.map((n: any) => ({
        ...n,
        selected: nextSelectedId ? n.id === nextSelectedId : false,
      }));
      setGraphDirect(finalNodes, layoutedEdges);
      setSelectedNodeId(nextSelectedId);
      setSelectedNodeIds(nextSelectedId ? [nextSelectedId] : []);
    } else {
      setGraphDirect(newNodes, newEdges);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
    }
  }, [getNearestNodeId, setEdges, setNodes]);

  const setEdgesAndRecord = useCallback((nextEdges: any[]) => {
      setEdges(nextEdges);
      pushHistory(nodesRef.current, nextEdges);
  }, [setEdges, pushHistory]);

  const getAutoConnectCandidate = useCallback((draggedId: string, pos: { x: number; y: number }) => {
      if (!draggedId || draggedId === 'root') return null;
      const hasIncoming = edgesRef.current.some((e: any) => e?.id !== PREVIEW_EDGE_ID && e?.target === draggedId);
      if (hasIncoming) return null;

      const dx0 = pos.x + nodeWidth / 2;
      const dy0 = pos.y + nodeHeight / 2;

      let best: { id: string; dist: number; dx: number; dy: number } | null = null;
      for (const n of nodesRef.current) {
          if (!n || n.id === draggedId) continue;
          if (n.type !== 'mindMap') continue;
          const cx = (n.position?.x ?? 0) + nodeWidth / 2;
          const cy = (n.position?.y ?? 0) + nodeHeight / 2;
          const dx = cx - dx0;
          const dy = cy - dy0;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (!best || d < best.dist) best = { id: n.id, dist: d, dx, dy };
      }

      if (!best) return null;
      if (best.dist > 160) return null;

      const isHorizontal = Math.abs(best.dx) >= Math.abs(best.dy);
      if (isHorizontal) {
          return { source: best.id, target: draggedId, mode: 'child' as const };
      }

      const parentMap = new Map<string, string>();
      for (const e of edgesRef.current) {
          if (e?.id === PREVIEW_EDGE_ID) continue;
          if (!e?.source || !e?.target) continue;
          parentMap.set(e.target, e.source);
      }
      const parentId = parentMap.get(best.id) || 'root';
      return { source: parentId, target: draggedId, mode: 'sibling' as const };
  }, []);

  const upsertPreviewEdge = useCallback((candidate: { source: string; target: string; mode: 'child' | 'sibling' } | null) => {
      const current = edgesRef.current;
      const without = current.filter((e: any) => e?.id !== PREVIEW_EDGE_ID);
      if (!candidate) {
          if (without.length !== current.length) {
              setEdges(without);
          }
          return;
      }
      const preview = {
          id: PREVIEW_EDGE_ID,
          source: candidate.source,
          target: candidate.target,
          type: 'smoothstep',
          style: { stroke: '#6366f1', strokeWidth: 2, strokeDasharray: candidate.mode === 'child' ? '6 4' : '4 4' },
          animated: false,
          markerEnd: candidate.mode === 'child' ? { type: MarkerType.ArrowClosed, color: '#6366f1' } : undefined,
      };
      setEdges([...without, preview]);
  }, [setEdges]);

  const finalizeAutoConnect = useCallback((candidate: { source: string; target: string; mode: 'child' | 'sibling' } | null) => {
      const current = edgesRef.current.filter((e: any) => e?.id !== PREVIEW_EDGE_ID);
      upsertPreviewEdge(null);
      if (!candidate) return;
      const exists = current.some((e: any) => e?.source === candidate.source && e?.target === candidate.target);
      if (exists) return;
      const newEdge = {
          id: `edge-${candidate.source}-${candidate.target}-${Math.random().toString(16).slice(2, 6)}`,
          source: candidate.source,
          target: candidate.target,
          type: 'default',
          style: { stroke: '#cbd5e1', strokeWidth: 2 },
      };
      setEdgesAndRecord([...current, newEdge]);
  }, [setEdgesAndRecord, upsertPreviewEdge]);

  const getParentMap = useCallback(() => {
      const map = new Map<string, string>();
      for (const e of edgesRef.current) {
          if (!e?.source || !e?.target) continue;
          map.set(e.target, e.source);
      }
      return map;
  }, []);

  const getTopSelectedIds = useCallback((ids: string[]) => {
      const parentMap = getParentMap();
      const selected = new Set(ids);
      const top: string[] = [];

      for (const id of ids) {
          let cur = id;
          let hasSelectedAncestor = false;
          while (parentMap.has(cur)) {
              cur = parentMap.get(cur)!;
              if (selected.has(cur)) {
                  hasSelectedAncestor = true;
                  break;
              }
          }
          if (!hasSelectedAncestor) top.push(id);
      }
      return top;
  }, [getParentMap]);

  const collectSubtree = useCallback((rootIds: string[]) => {
      const nodesById = new Map<string, any>();
      for (const n of nodesRef.current) nodesById.set(n.id, n);

      const edges = edgesRef.current;
      const childrenBySource = new Map<string, string[]>();
      for (const e of edges) {
          if (!e?.source || !e?.target) continue;
          const arr = childrenBySource.get(e.source) || [];
          arr.push(e.target);
          childrenBySource.set(e.source, arr);
      }

      const visited = new Set<string>();
      const queue = [...rootIds];
      while (queue.length > 0) {
          const id = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          const kids = childrenBySource.get(id) || [];
          kids.forEach((k) => {
              if (!visited.has(k)) queue.push(k);
          });
      }

      const outNodes = Array.from(visited)
          .map((id) => nodesById.get(id))
          .filter(Boolean)
          .map((n) => ({
              id: n.id,
              type: n.type,
              data: { label: n.data?.label ?? '' },
              position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
          }));

      const outEdges = edges
          .filter((e) => visited.has(e.source) && visited.has(e.target))
          .map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
              style: e.style,
          }));

      return { nodes: outNodes, edges: outEdges, rootIds };
  }, []);

  const copySelection = useCallback((mode: 'node' | 'subtree') => {
      const ids = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
      const filtered = ids.filter((id) => id !== 'root');
      if (filtered.length === 0) return;

      const top = getTopSelectedIds(filtered);

      if (mode === 'node') {
          const nodesById = new Map<string, any>();
          for (const n of nodesRef.current) nodesById.set(n.id, n);
          const outNodes = top
              .map((id) => nodesById.get(id))
              .filter(Boolean)
              .map((n) => ({
                  id: n.id,
                  type: n.type,
                  data: { label: n.data?.label ?? '' },
                  position: { x: 0, y: 0 },
              }));
          clipboardRef.current = { nodes: outNodes, edges: [], rootIds: top, copiedAt: Date.now() };
          return;
      }

      const clip = collectSubtree(top);
      clipboardRef.current = { ...clip, copiedAt: Date.now() };
  }, [collectSubtree, getTopSelectedIds, selectedNodeId, selectedNodeIds]);

  const pasteClipboard = useCallback(() => {
      const clip = clipboardRef.current;
      if (!clip || clip.nodes.length === 0) return;

      const parentId = selectedNodeId || 'root';

      const makeId = () => `node-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const idMap = new Map<string, string>();
      clip.nodes.forEach((n) => idMap.set(n.id, makeId()));

      const pastedNodes = clip.nodes.map((n) => {
          const newId = idMap.get(n.id)!;
          return {
              id: newId,
              type: n.type || 'mindMap',
              data: { label: n.data?.label ?? '', editNonce: 0 },
              position: { x: 0, y: 0 },
              selected: false,
          };
      });

      const pastedEdges = clip.edges.map((e) => ({
          id: `edge-${idMap.get(e.source)}-${idMap.get(e.target)}-${Math.random().toString(16).slice(2, 6)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          type: e.type || 'default',
          style: e.style || { stroke: '#cbd5e1', strokeWidth: 2 },
      }));

      const attachEdges = clip.rootIds.map((rid) => {
          const newRootId = idMap.get(rid)!;
          return {
              id: `edge-${parentId}-${newRootId}-${Math.random().toString(16).slice(2, 6)}`,
              source: parentId,
              target: newRootId,
              type: 'default',
              style: { stroke: '#cbd5e1', strokeWidth: 2 },
          };
      });

      const currentNodes = nodesRef.current.map((n: any) => ({ ...n, selected: false }));
      const currentEdges = edgesRef.current;

      commitLayout([...currentNodes, ...pastedNodes], [...currentEdges, ...pastedEdges, ...attachEdges]);

      const newRootIds = clip.rootIds.map((rid) => idMap.get(rid)!).filter(Boolean);
      requestAnimationFrame(() => {
          if (newRootIds.length > 0) {
              setSelectedIds(newRootIds, newRootIds[0]);
          }
          if (newRootIds.length === 1) {
              startEditing(newRootIds[0]);
          }
      });
  }, [commitLayout, selectedNodeId, setSelectedIds, startEditing]);

  const cutSelection = useCallback(() => {
      const ids = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
      const filtered = ids.filter((id) => id !== 'root');
      if (filtered.length === 0) return;
      const top = getTopSelectedIds(filtered);
      copySelection('subtree');
      deleteSelection(top);
  }, [copySelection, deleteSelection, getTopSelectedIds, selectedNodeId, selectedNodeIds]);

  const toggleBoldSelection = useCallback(() => {
      const ids = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
      const filtered = ids.filter((id) => id !== 'root');
      if (filtered.length === 0) return;

      setNodes((prev) => {
          const next = prev.map((n) => {
              if (!filtered.includes(n.id)) return n;
              const current = !!n.data?.bold;
              return { ...n, data: { ...n.data, bold: !current } };
          });
          pushHistory(next, edgesRef.current);
          return next;
      });
  }, [selectedNodeId, selectedNodeIds, setNodes, pushHistory]);

  const addFloatingTopicAt = useCallback((pos: { x: number; y: number }) => {
      const newNodeId = `node-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const currentNodes = nodesRef.current.map((n: any) => ({ ...n, selected: false }));
      const currentEdges = edgesRef.current;
      const newNode = {
          id: newNodeId,
          type: 'mindMap',
          data: { label: '自由主题', editNonce: 1, bold: false },
          position: { x: pos.x, y: pos.y },
          selected: true,
      };
      setGraphDirect([...currentNodes, newNode], currentEdges);
      setSelectedIds([newNodeId], newNodeId);
      requestAnimationFrame(() => {
          startEditing(newNodeId);
      });
  }, [setGraphDirect, setSelectedIds, startEditing]);

  const getSelectionMindMapIds = useCallback(() => {
      const ids = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
      const filtered = ids.filter((id) => id !== 'root');
      const byId = new Map<string, any>();
      for (const n of nodesRef.current) byId.set(n.id, n);
      return filtered.filter((id) => byId.get(id)?.type === 'mindMap');
  }, [selectedNodeId, selectedNodeIds]);

  const addBoundaryFromSelection = useCallback(() => {
      const memberIds = getSelectionMindMapIds();
      if (memberIds.length === 0) return;
      const bounds = getNodeBounds(memberIds);
      if (!bounds) return;
      const padding = 20;
      const x = bounds.minX - padding;
      const y = bounds.minY - padding;
      const w = (bounds.maxX - bounds.minX) + padding * 2;
      const h = (bounds.maxY - bounds.minY) + padding * 2;
      const id = `boundary-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      const newNode = {
          id,
          type: 'boundary',
          data: { memberIds, padding, w, h, label: '', editNonce: 0 },
          position: { x, y },
          selectable: true,
          draggable: false,
          connectable: false,
          selected: false,
      };
      setGraphDirect([...nodesRef.current, newNode], edgesRef.current);
  }, [getNodeBounds, getSelectionMindMapIds, setGraphDirect]);

  const addSummaryFromSelection = useCallback(() => {
      const memberIds = getSelectionMindMapIds();
      if (memberIds.length === 0) return;
      const bounds = getNodeBounds(memberIds);
      if (!bounds) return;
      const padding = 12;
      const x = bounds.maxX;
      const y = bounds.minY - padding;
      const h = (bounds.maxY - bounds.minY) + padding * 2;
      const id = `summary-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      const newNode = {
          id,
          type: 'summary',
          data: { memberIds, padding, h, label: '概要', editNonce: 0 },
          position: { x, y },
          selectable: true,
          draggable: false,
          connectable: false,
          selected: false,
      };
      setGraphDirect([...nodesRef.current, newNode], edgesRef.current);
  }, [getNodeBounds, getSelectionMindMapIds, setGraphDirect]);

  const createLinkEdge = useCallback((source: string, target: string) => {
      if (!source || !target || source === target) return;
      const current = edgesRef.current.filter((e: any) => e?.id !== PREVIEW_EDGE_ID);
      const exists = current.some((e: any) => e?.data?.kind === 'link' && e.source === source && e.target === target);
      if (exists) return;
      const id = `link-${source}-${target}-${Math.random().toString(16).slice(2, 6)}`;
      const linkEdge = {
          id,
          source,
          target,
          type: 'smoothstep',
          data: { kind: 'link' },
          style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '6 4' },
          animated: false,
      };
      setEdgesAndRecord([...current, linkEdge]);
  }, [setEdgesAndRecord]);

  const canToggleBold = useMemo(() => {
      const ids = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNodeId ? [selectedNodeId] : []);
      return ids.some((id) => id !== 'root');
  }, [selectedNodeId, selectedNodeIds]);

  const updateLabel = useCallback((id: string, label: string) => {
    setNodes((prev) => {
      const next = prev.map((n) => {
        if (n.id !== id) return n;
        return { ...n, data: { ...n.data, label } };
      });
      pushHistory(next, edgesRef.current);
      return next;
    });
  }, [setNodes, pushHistory]);

  const updateNodeData = useCallback((id: string, patch: Record<string, any>) => {
    setNodes((prev) => {
      const next = prev.map((n) => {
        if (n.id !== id) return n;
        return { ...n, data: { ...n.data, ...patch } };
      });
      pushHistory(next, edgesRef.current);
      return next;
    });
  }, [setNodes, pushHistory]);

  const addChildNode = useCallback((parentId: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const newNodeId = `node-${Date.now()}`;

    const cleanedNodes = currentNodes.map((n: any) => ({ ...n, selected: false }));
    const newNode = {
      id: newNodeId,
      type: 'mindMap',
      data: { label: '子主题', editNonce: 1, bold: false },
      position: { x: 0, y: 0 },
      selected: true,
    };

    const newEdge = {
      id: `edge-${parentId}-${newNodeId}`,
      source: parentId,
      target: newNodeId,
      type: 'default',
      style: { stroke: '#cbd5e1', strokeWidth: 2 },
    };

    commitLayout([...cleanedNodes, newNode], [...currentEdges, newEdge]);
    setSelectedNodeId(newNodeId);
    requestAnimationFrame(() => {
        selectNode(newNodeId);
        startEditing(newNodeId);
    });
  }, [commitLayout, selectNode, startEditing]);

  const addSiblingNode = useCallback((siblingId: string) => {
    if (siblingId === 'root') {
      addChildNode('root');
      return;
    }

    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;

    const parentEdge = currentEdges.find((e: any) => e.target === siblingId);
    const parentId = parentEdge?.source || 'root';

    const newNodeId = `node-${Date.now()}`;
    const cleanedNodes = currentNodes.map((n: any) => ({ ...n, selected: false }));
    const newNode = {
      id: newNodeId,
      type: 'mindMap',
      data: { label: '分支主题', editNonce: 1, bold: false },
      position: { x: 0, y: 0 },
      selected: true,
    };

    const newEdge = {
      id: `edge-${parentId}-${newNodeId}`,
      source: parentId,
      target: newNodeId,
      type: 'default',
      style: { stroke: '#cbd5e1', strokeWidth: 2 },
    };

    commitLayout([...cleanedNodes, newNode], [...currentEdges, newEdge]);
    setSelectedNodeId(newNodeId);
    requestAnimationFrame(() => {
        selectNode(newNodeId);
        startEditing(newNodeId);
    });
  }, [addChildNode, commitLayout, selectNode, startEditing]);

  useEffect(() => {
      const handlePointerDown = (e: PointerEvent) => {
          if (!containerRef.current) return;
          const inside = containerRef.current.contains(e.target as unknown as globalThis.Node);
          activeRef.current = inside ? activeRef.current : false;
          if (!inside) {
              setIsMindMapSelected(false);
          } else {
              if ((e as any).button === 0) {
                  activeRef.current = true;
              }
          }
      };

      const handleKeyDown = (e: KeyboardEvent) => {
          if (!activeRef.current) return;

          const target = e.target as HTMLElement | null;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

          const mod = e.ctrlKey || e.metaKey;
          if (mod) {
              const key = (e.key || '').toLowerCase();
              if (key === 'z') {
                  if (!isFullScreen) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  if (e.shiftKey) redo();
                  else undo();
                  return;
              }
              if (key === 'b') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  toggleBoldSelection();
                  return;
              }
              if (key === 'c') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  copySelection(e.altKey ? 'node' : 'subtree');
                  return;
              }
              if (key === 'x') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  cutSelection();
                  return;
              }
              if (key === 'v') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  pasteClipboard();
                  return;
              }
          }
          if (selectedNodeIds.length === 0) {
              if (e.key === ' ' && nodesRef.current.length > 0) {
                  const id = nodesRef.current[0].id;
                  selectNode(id);
                  startEditing(id);
              }
              return;
          }

          if (['Tab', 'Enter', 'Backspace', 'Delete', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
          }

          const selectedId = selectedNodeId || selectedNodeIds[0];

          if (e.key === ' ') {
              startEditing(selectedId);
              return;
          }

          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              const dir = e.key === 'ArrowUp'
                  ? 'up'
                  : e.key === 'ArrowDown'
                    ? 'down'
                    : e.key === 'ArrowLeft'
                      ? 'left'
                      : 'right';

              const nextId = getNextNodeId(dir);
              if (nextId) {
                  selectNode(nextId);
              }
              return;
          }

          if (e.key === 'Tab') {
              addChildNode(selectedId);
              return;
          }

          if (e.key === 'Enter') {
              addSiblingNode(selectedId);
              return;
          }

          if (e.key === 'Delete' || e.key === 'Backspace') {
              const ids = selectedNodeIds.filter((id) => id !== 'root');
              if (ids.length === 0) return;
              deleteSelection(ids);
          }
      };

      window.addEventListener('pointerdown', handlePointerDown, true);
      window.addEventListener('keydown', handleKeyDown, true);

      return () => {
          window.removeEventListener('pointerdown', handlePointerDown, true);
          window.removeEventListener('keydown', handleKeyDown, true);
      };
  }, [selectedNodeId, selectedNodeIds, setNodes, setEdges, addChildNode, addSiblingNode, startEditing, nodesRef, edgesRef, getNextNodeId, selectNode, deleteSelection, copySelection, cutSelection, pasteClipboard, toggleBoldSelection, isFullScreen, undo, redo]);

  useEffect(() => {
      const t = requestAnimationFrame(() => {
          if (!containerRef.current) return;
          setActive();
          focusContainer();
          if (!selectedNodeId && nodesRef.current.length > 0) {
              selectNode(nodesRef.current[0].id);
          }
      });
      return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
      if (historyRef.current.past.length > 0) return;
      if (nodesRef.current.length === 0) return;
      pushHistory(nodesRef.current, edgesRef.current);
  }, [nodes.length, edges.length, pushHistory]);

  useEffect(() => {
      if (didInitialFitRef.current) return;
      if (!rfInstanceRef.current) return;
      if (nodesRef.current.length === 0) return;
      didInitialFitRef.current = true;
      requestAnimationFrame(() => {
          try {
              rfInstanceRef.current.fitView({ padding: 0.25, duration: 0 });
          } catch {}
      });
  }, [nodes.length]);

  const scheduleFitView = useCallback(() => {
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = requestAnimationFrame(() => {
          const instance = rfInstanceRef.current;
          if (!instance) return;
          try {
              instance.fitView({ padding: 0.25, duration: 200 });
          } catch {}
      });
  }, []);

  useEffect(() => {
      if (isFullScreen) return;
      if (isMindMapSelected) return;
      if (!rfInstanceRef.current) return;
      if (nodesRef.current.length === 0) return;
      scheduleFitView();
  }, [isFullScreen, isMindMapSelected, nodes.length, edges.length, scheduleFitView]);

  useEffect(() => {
      if (isFullScreen) return;
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
          if (isMindMapSelected) return;
          scheduleFitView();
      });
      ro.observe(el);
      return () => ro.disconnect();
  }, [isFullScreen, isMindMapSelected, scheduleFitView]);

  useEffect(() => {
      const handler = () => {
          const current = containerRef.current;
          const fsEl = document.fullscreenElement;
          const next = !!(current && fsEl === current);
          setIsFullScreen(next);
          if (next && rfInstanceRef.current) {
              requestAnimationFrame(() => {
                  try {
                      rfInstanceRef.current.fitView({ padding: 0.2, duration: 200 });
                  } catch {}
              });
          }
      };
      document.addEventListener('fullscreenchange', handler);
      return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
      const el = containerRef.current;
      if (!el) return;
      try {
          if (document.fullscreenElement === el) {
              await document.exitFullscreen();
          } else {
              await el.requestFullscreen();
          }
      } catch {
          setIsFullScreen((v) => !v);
      }
  }, []);

  const onLayout = useCallback((direction: 'LR' | 'TB' = 'LR') => {
    if (nodesRef.current.length === 0) return;
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodesRef.current,
      edgesRef.current,
      direction
    );
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
  }, [setNodes, setEdges]);

  // Initial layout on mount if needed, but usually we respect saved positions
  // or layout once if positions are all 0,0
  useEffect(() => {
      const currentNodes = nodesRef.current;
      if (currentNodes.length > 1) {
        onLayout();
      }
  }, []); // Run once on mount

  // Keyboard Shortcuts Handler (Container level)
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Prevent default Tiptap/Browser behavior for these keys inside the mindmap wrapper
    // REGARDLESS of selection, to avoid breaking the editor
    if (['Tab', 'Enter', 'Backspace', 'Delete', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!selectedNodeId) return;
    
    const selectedId = selectedNodeId;
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;

    // SPACE: Start Editing
    if (event.key === ' ') {
        startEditing(selectedId);
        return;
    }

    // TAB: Add Child
    if (event.key === 'Tab') {
        addChildNode(selectedId);
    }

    // ENTER: Add Sibling
    if (event.key === 'Enter') {
        addSiblingNode(selectedId);
    }

    // DELETE/BACKSPACE: Delete Node
    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId === 'root') return; 
        
        const nodesToRemove = new Set([selectedId]);
        const edgesToRemove = new Set<string>();
        
        const queue = [selectedId];
        while(queue.length > 0) {
            const currentId = queue.shift()!;
            const childEdges = currentEdges.filter(e => e.source === currentId);
            childEdges.forEach(e => {
                edgesToRemove.add(e.id);
                if (!nodesToRemove.has(e.target)) {
                    nodesToRemove.add(e.target);
                    queue.push(e.target);
                }
            });
            const incomingEdge = currentEdges.find(e => e.target === currentId);
            if(incomingEdge) edgesToRemove.add(incomingEdge.id);
        }

        const newNodes = currentNodes.filter(n => !nodesToRemove.has(n.id));
        const newEdges = currentEdges.filter(e => !edgesToRemove.has(e.id));
        
        if (newNodes.length > 0) {
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                newNodes,
                newEdges
            );
            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
            setSelectedNodeId('root');
            setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === 'root' })));
        } else {
            setNodes(newNodes);
            setEdges(newEdges);
            setSelectedNodeId(null);
        }
    }

  }, [selectedNodeId, setNodes, setEdges, addChildNode, addSiblingNode, startEditing]);

  // Sync back to Tiptap
  useEffect(() => {
      const cleanNodes = nodes.map((n: any) => {
          const data = (() => {
              if (n.type === 'mindMap') {
                  return { label: n.data?.label ?? '', bold: !!n.data?.bold };
              }
              if (n.type === 'boundary') {
                  return {
                      kind: 'boundary',
                      memberIds: Array.isArray(n.data?.memberIds) ? n.data.memberIds : [],
                      padding: typeof n.data?.padding === 'number' ? n.data.padding : 20,
                      w: typeof n.data?.w === 'number' ? n.data.w : undefined,
                      h: typeof n.data?.h === 'number' ? n.data.h : undefined,
                  };
              }
              if (n.type === 'summary') {
                  return {
                      kind: 'summary',
                      memberIds: Array.isArray(n.data?.memberIds) ? n.data.memberIds : [],
                      padding: typeof n.data?.padding === 'number' ? n.data.padding : 12,
                      h: typeof n.data?.h === 'number' ? n.data.h : undefined,
                      label: typeof n.data?.label === 'string' ? n.data.label : '概要',
                  };
              }
              return { label: n.data?.label ?? '' };
          })();
          return {
              id: n.id,
              type: n.type,
              position: n.position,
              data,
          };
      });
      const cleanEdges = edges.map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          style: e.style,
          data: e.data,
      }));

      const data = { nodes: cleanNodes, edges: cleanEdges };
      const timer = setTimeout(() => {
          updateAttributes({ data: JSON.stringify(data) });
      }, 200);
      return () => clearTimeout(timer);
  }, [nodes, edges, updateAttributes]);

  useEffect(() => {
    if (!selectedNodeId && nodes.length > 0) {
      selectNode(nodes[0].id);
    }
  }, [nodes]);

  const actions = useMemo<MindMapActions>(() => ({
    selectNode,
    startEditing,
    updateLabel,
    updateNodeData,
    addChildNode,
    addSiblingNode,
  }), [selectNode, startEditing, updateLabel, updateNodeData, addChildNode, addSiblingNode]);

  return (
    <MindMapActionsContext.Provider value={actions}>
    <div 
        ref={containerRef}
        className={isFullScreen
            ? `w-full h-full bg-slate-50 border-2 ${isMindMapSelected ? 'border-indigo-500' : 'border-gray-200'} rounded-none relative overflow-hidden focus:outline-none`
            : `w-full h-[500px] bg-slate-50 border-2 ${isMindMapSelected ? 'border-indigo-500' : 'border-gray-200'} rounded-xl relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500/50`
        }
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheelCapture={(e) => {
            if (isMindMapSelected) {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
        }}
        onClick={() => {
            setActive();
            focusContainer();
        }}
        onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
            if (e.button === 0) {
                setIsMindMapSelected(true);
                setActive();
                focusContainer();
            }
            if (e.button !== 2) return;
            const target = e.target as HTMLElement | null;
            if (!target || !target.closest) return;
            const isPane = !!target.closest('.react-flow__pane');
            if (!isPane) return;

            if (isFullScreen) {
                e.preventDefault();
                e.stopPropagation();
                setActive();
                focusContainer();

                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

                if (!selectionStartRef.current) {
                    selectionStartRef.current = point;
                    setSelectionBox({ visible: true, x: point.x, y: point.y, w: 0, h: 0 });

                    const onMove = (ev: MouseEvent) => {
                        const r = containerRef.current?.getBoundingClientRect();
                        const s = selectionStartRef.current;
                        if (!r || !s) return;
                        const cx = ev.clientX - r.left;
                        const cy = ev.clientY - r.top;
                        const x = Math.min(s.x, cx);
                        const y = Math.min(s.y, cy);
                        const w = Math.abs(cx - s.x);
                        const h = Math.abs(cy - s.y);
                        setSelectionBox({ visible: true, x, y, w, h });
                    };
                    selectionMoveHandlerRef.current = onMove;
                    window.addEventListener('mousemove', onMove, true);
                    return;
                }

                const s = selectionStartRef.current;
                selectionStartRef.current = null;
                setSelectionBox((prev) => ({ ...prev, visible: false }));

                const moveHandler = selectionMoveHandlerRef.current;
                selectionMoveHandlerRef.current = null;
                if (moveHandler) window.removeEventListener('mousemove', moveHandler, true);

                const x1 = Math.min(s.x, point.x);
                const y1 = Math.min(s.y, point.y);
                const x2 = Math.max(s.x, point.x);
                const y2 = Math.max(s.y, point.y);

                const instance = rfInstanceRef.current;
                if (!instance || typeof instance.screenToFlowPosition !== 'function') return;
                const tl = instance.screenToFlowPosition({ x: x1 + rect.left, y: y1 + rect.top });
                const br = instance.screenToFlowPosition({ x: x2 + rect.left, y: y2 + rect.top });
                const minX = Math.min(tl.x, br.x);
                const minY = Math.min(tl.y, br.y);
                const maxX = Math.max(tl.x, br.x);
                const maxY = Math.max(tl.y, br.y);

                const hitIds: string[] = [];
                for (const n of nodesRef.current) {
                    const nx = n.position?.x ?? 0;
                    const ny = n.position?.y ?? 0;
                    const nMinX = nx;
                    const nMinY = ny;
                    const nMaxX = nx + nodeWidth;
                    const nMaxY = ny + nodeHeight;
                    const intersects = !(nMaxX < minX || nMinX > maxX || nMaxY < minY || nMinY > maxY);
                    if (intersects) hitIds.push(n.id);
                }

                if (hitIds.length > 0) {
                    setSelectedIds(hitIds, hitIds[0]);
                }
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            setActive();
            focusContainer();

            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            selectionStartRef.current = start;
            setSelectionBox({ visible: true, x: start.x, y: start.y, w: 0, h: 0 });

            const onMove = (ev: MouseEvent) => {
                const r = containerRef.current?.getBoundingClientRect();
                const s = selectionStartRef.current;
                if (!r || !s) return;
                const cx = ev.clientX - r.left;
                const cy = ev.clientY - r.top;
                const x = Math.min(s.x, cx);
                const y = Math.min(s.y, cy);
                const w = Math.abs(cx - s.x);
                const h = Math.abs(cy - s.y);
                setSelectionBox({ visible: true, x, y, w, h });
            };

            const onUp = (ev: MouseEvent) => {
                const r = containerRef.current?.getBoundingClientRect();
                const s = selectionStartRef.current;
                selectionStartRef.current = null;
                setSelectionBox((prev) => ({ ...prev, visible: false }));

                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);

                if (!r || !s) return;
                const ex = ev.clientX - r.left;
                const ey = ev.clientY - r.top;
                const x1 = Math.min(s.x, ex);
                const y1 = Math.min(s.y, ey);
                const x2 = Math.max(s.x, ex);
                const y2 = Math.max(s.y, ey);

                const instance = rfInstanceRef.current;
                if (!instance || typeof instance.screenToFlowPosition !== 'function') return;
                const tl = instance.screenToFlowPosition({ x: x1 + r.left, y: y1 + r.top });
                const br = instance.screenToFlowPosition({ x: x2 + r.left, y: y2 + r.top });
                const minX = Math.min(tl.x, br.x);
                const minY = Math.min(tl.y, br.y);
                const maxX = Math.max(tl.x, br.x);
                const maxY = Math.max(tl.y, br.y);

                const hitIds: string[] = [];
                for (const n of nodesRef.current) {
                    const nx = n.position?.x ?? 0;
                    const ny = n.position?.y ?? 0;
                    const w = 150;
                    const h = 50;
                    const nMinX = nx;
                    const nMinY = ny;
                    const nMaxX = nx + w;
                    const nMaxY = ny + h;
                    const intersects = !(nMaxX < minX || nMinX > maxX || nMaxY < minY || nMinY > maxY);
                    if (intersects) hitIds.push(n.id);
                }

                if (hitIds.length > 0) {
                    setSelectedIds(hitIds, hitIds[0]);
                }
            };

            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
        }}
        onDoubleClick={(e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target as HTMLElement | null;
            if (!target || !target.closest) return;
            const isPane = !!target.closest('.react-flow__pane');
            const isNode = !!target.closest('.react-flow__node');
            if (!isPane || isNode) return;

            const rect = containerRef.current?.getBoundingClientRect();
            const instance = rfInstanceRef.current;
            if (!rect || !instance || typeof instance.screenToFlowPosition !== 'function') return;
            const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            setIsMindMapSelected(true);
            setActive();
            focusContainer();
            addFloatingTopicAt(flowPos);
        }}
        onContextMenu={(e) => {
            e.preventDefault();
        }}
        onFocus={() => {
            setActive();
        }}
    >
      {isFullScreen && (
        <div className="absolute top-0 left-0 right-0 h-14 z-30 bg-gray-50/95 backdrop-blur border-b border-gray-200 flex items-center px-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setIsMindMapSelected(true);
                setActive();
                focusContainer();
                if (toolbarMode === 'link') {
                  setToolbarMode('none');
                  setLinkFromId(null);
                } else {
                  setToolbarMode('link');
                  setLinkFromId(null);
                }
              }}
              className={`w-14 h-12 rounded-lg border flex flex-col items-center justify-center text-[10px] leading-none ${toolbarMode === 'link' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:text-indigo-600 hover:border-indigo-100'}`}
              title="联系"
            >
              <Link2 size={16} className="mb-1" />
              联系
            </button>

            <button
              onClick={() => {
                setIsMindMapSelected(true);
                setActive();
                focusContainer();
                addSummaryFromSelection();
              }}
              className="w-14 h-12 rounded-lg border border-gray-200 bg-white flex flex-col items-center justify-center text-[10px] leading-none text-gray-600 hover:text-indigo-600 hover:border-indigo-100"
              title="概要"
            >
              <FileText size={16} className="mb-1" />
              概要
            </button>

            <button
              onClick={() => {
                setIsMindMapSelected(true);
                setActive();
                focusContainer();
                addBoundaryFromSelection();
              }}
              className="w-14 h-12 rounded-lg border border-gray-200 bg-white flex flex-col items-center justify-center text-[10px] leading-none text-gray-600 hover:text-indigo-600 hover:border-indigo-100"
              title="外框"
            >
              <Square size={16} className="mb-1" />
              外框
            </button>
          </div>

          <div className="flex-1" />

          {toolbarMode === 'link' && (
            <div className="text-xs text-gray-500 mr-4">
              {linkFromId ? '再点击一个节点完成联系' : '点击一个节点作为起点'}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button 
              onClick={() => onLayout('LR')} 
              className="p-2 bg-white rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-indigo-600 hover:border-indigo-100 transition-all text-xs flex items-center font-medium"
            >
              <Layout size={14} className="mr-1.5"/> 自动整理
            </button>

            <button 
              onClick={() => {
                  setIsMindMapSelected(true);
                  setActive();
                  focusContainer();
                  toggleBoldSelection();
              }}
              disabled={!canToggleBold}
              className={`p-2 bg-white rounded-lg shadow-sm border border-gray-100 transition-all text-xs flex items-center font-medium ${canToggleBold ? 'text-gray-600 hover:text-indigo-600 hover:border-indigo-100' : 'text-gray-300 cursor-not-allowed'}`}
              title="加粗 (Ctrl+B)"
            >
              <Bold size={14} className="mr-1.5"/>
              加粗
            </button>

            <button 
              onClick={toggleFullscreen}
              className="p-2 bg-white rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-indigo-600 hover:border-indigo-100 transition-all text-xs flex items-center font-medium"
              title={isFullScreen ? '退出全屏 (Esc)' : '全屏编辑'}
            >
              {isFullScreen ? <Minimize2 size={14} className="mr-1.5"/> : <Maximize2 size={14} className="mr-1.5"/>}
              {isFullScreen ? '退出全屏' : '全屏'}
            </button>
          </div>
        </div>
      )}

      <div className={isFullScreen ? 'absolute inset-0 top-14' : 'absolute inset-0'}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
          onInit={(instance) => {
              rfInstanceRef.current = instance;
          }}
          zoomOnScroll={isMindMapSelected}
          zoomOnDoubleClick={false}
          panOnDrag={isMindMapSelected ? [0] : false}
          zoomOnPinch={isMindMapSelected}
          preventScrolling={isMindMapSelected}
          defaultEdgeOptions={{
              type: 'default', 
              style: { stroke: '#cbd5e1', strokeWidth: 2 },
              animated: false
          }}
          onNodeClick={(_e, node) => {
              if (toolbarMode === 'link') {
                  setIsMindMapSelected(true);
                  setActive();
                  focusContainer();
                  if (!linkFromId) {
                      setLinkFromId(node.id);
                      setSelectedIds([node.id], node.id);
                      return;
                  }
                  if (linkFromId && linkFromId !== node.id) {
                      createLinkEdge(linkFromId, node.id);
                  }
                  setToolbarMode('none');
                  setLinkFromId(null);
                  return;
              }

              selectNode(node.id);
              focusContainer();
              setIsMindMapSelected(true);
          }}
          onNodeDrag={(_e: any, node: any) => {
              const candidate = getAutoConnectCandidate(node.id, node.position);
              upsertPreviewEdge(candidate);
          }}
          onNodeDragStop={(_e: any, node: any) => {
              const candidate = getAutoConnectCandidate(node.id, node.position);
              finalizeAutoConnect(candidate);
          }}
          onPaneClick={() => {
              focusContainer();
              setIsMindMapSelected(true);
          }}
        >
          <Controls showInteractive={false} className="!bg-white !border-gray-100 !shadow-sm !m-4" />
          <Background color="#e2e8f0" gap={20} size={1} />
        </ReactFlow>
      </div>

      {selectionBox.visible && (
        <div
          className="absolute z-20 border-2 border-indigo-400 bg-indigo-200/20 rounded"
          style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h, pointerEvents: 'none' }}
        />
      )}
      
      {!isFullScreen && (
      <div className="absolute top-4 right-4 z-10 flex space-x-2">
         <button 
            onClick={() => onLayout('LR')} 
            className="p-2 bg-white rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-indigo-600 hover:border-indigo-100 transition-all text-xs flex items-center font-medium"
         >
            <Layout size={14} className="mr-1.5"/> 自动整理
         </button>

         <button 
            onClick={() => {
                setIsMindMapSelected(true);
                setActive();
                focusContainer();
                toggleBoldSelection();
            }}
            disabled={!canToggleBold}
            className={`p-2 bg-white rounded-lg shadow-sm border border-gray-100 transition-all text-xs flex items-center font-medium ${canToggleBold ? 'text-gray-600 hover:text-indigo-600 hover:border-indigo-100' : 'text-gray-300 cursor-not-allowed'}`}
            title="加粗 (Ctrl+B)"
         >
            <Bold size={14} className="mr-1.5"/>
            加粗
         </button>

         <button 
            onClick={toggleFullscreen}
            className="p-2 bg-white rounded-lg shadow-sm border border-gray-100 text-gray-600 hover:text-indigo-600 hover:border-indigo-100 transition-all text-xs flex items-center font-medium"
            title={isFullScreen ? '退出全屏 (Esc)' : '全屏编辑'}
         >
            {isFullScreen ? <Minimize2 size={14} className="mr-1.5"/> : <Maximize2 size={14} className="mr-1.5"/>}
            {isFullScreen ? '退出全屏' : '全屏'}
         </button>
      </div>
      )}

      {isFullScreen && (
        <div className="absolute bottom-4 right-4 z-10 text-[10px] text-gray-500 bg-white/80 backdrop-blur border border-gray-100 rounded-lg px-2 py-1 pointer-events-none">
          Esc 退出全屏
        </div>
      )}
    </div>
    </MindMapActionsContext.Provider>
  );
};

export const MindMapComponent = (props: any) => {
    const { node, updateAttributes } = props;

    const fallbackData = {
        nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }],
        edges: [],
    };

    const parseData = (value: any) => {
        if (!value) return fallbackData;
        if (typeof value === 'object') return value;
        if (typeof value !== 'string') return fallbackData;

        const candidates: string[] = [value];

        try {
            candidates.push(decodeURIComponent(value));
        } catch {}

        candidates.push(
            value
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
        );

        for (const c of candidates) {
            try {
                const parsed = JSON.parse(c);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch {}
        }

        return fallbackData;
    };

    const initialData = parseData(node.attrs.data);

    return (
        <NodeViewWrapper className="mind-map-wrapper my-6" contentEditable={false}>
            <ReactFlowProvider>
                <MindMapInner 
                    initialData={initialData} 
                    updateAttributes={updateAttributes}
                />
            </ReactFlowProvider>
        </NodeViewWrapper>
    );
};
