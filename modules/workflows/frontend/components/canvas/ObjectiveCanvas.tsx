import { useEffect, useMemo, useRef, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { Objective } from '@data-models'

const PAD = 36
const NODE_W = 240
const NODE_H = 132
const SELECT_RING = '#2563eb'
const SELECT_GLOW = 'rgba(37, 99, 235, 0.24)'

interface Props {
  objectives: Objective[]
  selectedObjectiveId?: string | null
  onSelectObjective?: (objectiveId: string | null) => void
}

interface LayoutNode {
  x: number
  y: number
}

function clampTitle(title: string): string {
  return title.length > 30 ? `${title.slice(0, 27)}...` : title
}

function clampSummary(summary: string | null): string {
  if (!summary) return 'No status note yet.'
  return summary.length > 110 ? `${summary.slice(0, 107)}...` : summary
}

function progressTone(progress: number): string {
  if (progress >= 80) return '#15803d'
  if (progress >= 40) return '#c2410c'
  return '#475569'
}

function computeObjectiveLayout(objectives: Objective[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 42, ranksep: 72, marginx: PAD, marginy: PAD })
  for (const objective of objectives) {
    g.setNode(objective.id, { width: NODE_W, height: NODE_H })
  }
  for (const objective of objectives) {
    if (objective.parent_objective_id) {
      g.setEdge(objective.parent_objective_id, objective.id)
    }
  }
  dagre.layout(g)
  return g
}

export default function ObjectiveCanvas({ objectives, selectedObjectiveId, onSelectObjective }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const wasDragging = useRef(false)
  const graph = useMemo(() => computeObjectiveLayout(objectives), [objectives])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [ready, setReady] = useState(false)

  const { width: graphWidth = 640, height: graphHeight = 420 } = graph.graph() as { width?: number; height?: number }

  function fitToView() {
    const svg = svgRef.current
    if (!svg) return
    const { clientWidth, clientHeight } = svg
    if (!clientWidth || !clientHeight) return
    const scale = Math.min(clientWidth / (graphWidth + PAD * 2), clientHeight / (graphHeight + PAD * 2))
    setZoom(scale)
    setPan({ x: (clientWidth - graphWidth * scale) / 2, y: (clientHeight - graphHeight * scale) / 2 })
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitToView()
      setReady(true)
    })
    return () => cancelAnimationFrame(id)
  }, [graphWidth, graphHeight])

  useEffect(() => {
    if (!selectedObjectiveId) return
    const svg = svgRef.current
    const node = graph.node(selectedObjectiveId) as LayoutNode | undefined
    if (!svg || !node) return
    const { clientWidth, clientHeight } = svg
    setPan({
      x: clientWidth / 2 - node.x * zoom,
      y: clientHeight / 2 - node.y * zoom,
    })
  }, [graph, selectedObjectiveId, zoom])

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    wasDragging.current = false
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.sx
    const dy = e.clientY - dragRef.current.sy
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragging.current = true
    setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy })
  }

  function onMouseUp() {
    dragRef.current = null
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.85 : 1.18
    const nextZoom = Math.max(0.2, Math.min(2.4, zoom * factor))
    setPan((current) => ({
      x: mx - (mx - current.x) * (nextZoom / zoom),
      y: my - (my - current.y) * (nextZoom / zoom),
    }))
    setZoom(nextZoom)
  }

  if (objectives.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white text-sm text-gray-500">
        No objectives yet. Add the first objective to map this project.
      </div>
    )
  }

  const btnClassName = 'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:border-gray-400 hover:bg-gray-50'

  return (
    <div className="relative h-full w-full" style={{ opacity: ready ? 1 : 0 }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="block rounded-[28px] bg-[#f4f1e8]"
        style={{ cursor: wasDragging.current ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onClick={(e) => {
          if (wasDragging.current) return
          if (e.target === e.currentTarget) onSelectObjective?.(null)
        }}
      >
        <defs>
          <marker id="objective-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#cbd5e1" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {objectives.map((objective) => {
            if (!objective.parent_objective_id) return null
            const source = graph.node(objective.parent_objective_id) as LayoutNode | undefined
            const target = graph.node(objective.id) as LayoutNode | undefined
            if (!source || !target) return null
            const d = `M ${source.x},${source.y + NODE_H / 2 - 4} C ${source.x},${source.y + 64} ${target.x},${target.y - 64} ${target.x},${target.y - NODE_H / 2 + 4}`
            return (
              <path
                key={`${objective.parent_objective_id}-${objective.id}`}
                d={d}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={2}
                markerEnd="url(#objective-arrow)"
              />
            )
          })}
          {objectives.map((objective) => {
            const node = graph.node(objective.id) as LayoutNode | undefined
            if (!node) return null
            const isSelected = selectedObjectiveId === objective.id
            const progress = Math.max(0, Math.min(100, objective.progress_percent ?? 0))
            const accent = progressTone(progress)
            return (
              <g
                key={objective.id}
                transform={`translate(${node.x - NODE_W / 2},${node.y - NODE_H / 2})`}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (wasDragging.current) return
                  onSelectObjective?.(objective.id)
                }}
              >
                {isSelected && (
                  <rect
                    x={-8}
                    y={-8}
                    width={NODE_W + 16}
                    height={NODE_H + 16}
                    rx={26}
                    fill="none"
                    stroke={SELECT_GLOW}
                    strokeWidth={16}
                  />
                )}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={22}
                  fill="#fffdf8"
                  stroke={isSelected ? SELECT_RING : '#d6d3d1'}
                  strokeWidth={isSelected ? 3 : 1.5}
                />
                <text x={18} y={24} fontSize={11} fontWeight="700" fill="#78716c" fontFamily="sans-serif">
                  {(objective.code || 'OBJ').slice(0, 5).toUpperCase()}
                </text>
                <text x={18} y={48} fontSize={15} fontWeight="700" fill="#1c1917" fontFamily="sans-serif">
                  {clampTitle(objective.title)}
                </text>
                <rect x={18} y={62} width={NODE_W - 36} height={10} rx={5} fill="#e7e5e4" />
                <rect x={18} y={62} width={(NODE_W - 36) * (progress / 100)} height={10} rx={5} fill={accent} />
                <text x={NODE_W - 18} y={70} fontSize={10} fontWeight="700" fill="#44403c" fontFamily="sans-serif" textAnchor="end">
                  {progress}%
                </text>
                <foreignObject x={18} y={80} width={NODE_W - 36} height={40}>
                  <div
                    style={{
                      fontSize: '11px',
                      lineHeight: '1.25',
                      color: '#57534e',
                      fontFamily: 'sans-serif',
                    }}
                  >
                    {clampSummary(objective.status_summary)}
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button className={btnClassName} onClick={() => setZoom((value) => Math.min(2.4, value * 1.2))} title="Zoom in">
          <Plus size={14} />
        </button>
        <button className={btnClassName} onClick={() => setZoom((value) => Math.max(0.2, value * 0.82))} title="Zoom out">
          <Minus size={14} />
        </button>
        <button className={btnClassName} onClick={fitToView} title="Fit to view">
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  )
}
