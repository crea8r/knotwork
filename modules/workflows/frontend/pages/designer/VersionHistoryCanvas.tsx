// VersionHistoryCanvas — dagre TB layout; zoomToNodeId centers on node; detailContent overlays it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { GraphVersion } from '@data-models'
import type { HistorySelection } from './graphVersionUtils'
import { formatVersionName } from './graphVersionUtils'

const VW = 176, VH = 68, DW = 156, DH = 50, PAD = 48

function buildLayout(versions: GraphVersion[], rootDraft: GraphVersion | null) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 80, marginx: PAD, marginy: PAD })
  if (rootDraft) g.setNode(`d:${rootDraft.id}`, { width: DW, height: DH })
  for (const v of versions) {
    g.setNode(`v:${v.id}`, { width: VW, height: VH })
    if (v.draft) g.setNode(`d:${v.draft.id}`, { width: DW, height: DH })
    if (v.parent_version_id) g.setEdge(`v:${v.parent_version_id}`, `v:${v.id}`)
    if (v.draft) g.setEdge(`v:${v.id}`, `d:${v.draft.id}`)
  }
  dagre.layout(g)
  return g
}

function edgePath(g: dagre.graphlib.Graph, src: string, tgt: string): string {
  const data = g.edge(src, tgt) as { points?: Array<{ x: number; y: number }> } | undefined
  if (data?.points?.length) return data.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const s = g.node(src), t = g.node(tgt)
  return `M${s.x},${s.y} L${t.x},${t.y}`
}

export default function VersionHistoryCanvas({
  namedVersions, rootDraft, graphDefaultVersionId,
  historySelection, zoomToNodeId, detailContent,
  onSelectHistoryItem, onBackgroundClick,
}: {
  namedVersions: GraphVersion[]
  rootDraft: GraphVersion | null
  graphDefaultVersionId: string | null
  historySelection: HistorySelection | null
  zoomToNodeId: string | null
  detailContent?: React.ReactNode
  onSelectHistoryItem: (sel: HistorySelection) => void
  onBackgroundClick?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [animated, setAnimated] = useState(false)
  const [ready, setReady] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const wasDragging = useRef(false)

  const g = useMemo(() => buildLayout(namedVersions, rootDraft), [namedVersions, rootDraft])
  const { width: gw = 400, height: gh = 300 } = g.graph() as { width?: number; height?: number }

  const draftMeta = useMemo(() => {
    const map = new Map<string, { parentVersionId: string | null; isRoot: boolean }>()
    if (rootDraft) map.set(rootDraft.id, { parentVersionId: null, isRoot: true })
    for (const v of namedVersions) if (v.draft) map.set(v.draft.id, { parentVersionId: v.id, isRoot: false })
    return map
  }, [namedVersions, rootDraft])

  const selectedNodeId = useMemo(() => {
    if (!historySelection) return null
    return historySelection.kind === 'version' ? `v:${historySelection.id}` : `d:${historySelection.id}`
  }, [historySelection])

  // Screen position of the focused node (for overlay centering)
  const focusedScreenPos = useMemo(() => {
    if (!zoomToNodeId) return null
    const pos = g.node(zoomToNodeId)
    if (!pos) return null
    return { x: pos.x * zoom + pan.x, y: pos.y * zoom + pan.y }
  }, [zoomToNodeId, zoom, pan, g])

  const fitToView = useCallback(() => {
    const svg = svgRef.current; if (!svg) return
    const { clientWidth: cw, clientHeight: ch } = svg; if (!cw || !ch) return
    const s = Math.min(cw / (gw + PAD * 2), ch / (gh + PAD * 2))
    setZoom(s); setPan({ x: (cw - gw * s) / 2, y: (ch - gh * s) / 2 })
  }, [gh, gw])

  // Fit to view on mount and whenever the version count changes — no animation.
  useEffect(() => { const id = requestAnimationFrame(() => { fitToView(); setReady(true) }); return () => cancelAnimationFrame(id) },
    [fitToView])

  // Zoom to a specific node with animation, or fit back without animation.
  // userHasInteracted gates animation so the very first open never flashes.
  const userHasInteracted = useRef(false)
  useEffect(() => {
    if (!zoomToNodeId) {
      const id = requestAnimationFrame(fitToView)
      return () => cancelAnimationFrame(id)
    }
    const pos = g.node(zoomToNodeId); const svg = svgRef.current
    if (!pos || !svg) return
    const { clientWidth: cw, clientHeight: ch } = svg; if (!cw || !ch) return
    const tz = 1.5
    if (userHasInteracted.current) {
      setAnimated(true)
      setTimeout(() => setAnimated(false), 400)
    }
    setZoom(tz); setPan({ x: cw / 2 - pos.x * tz, y: ch / 2 - pos.y * tz })
  }, [fitToView, g, zoomToNodeId])

  function handleNodeClick(nodeId: string) {
    if (wasDragging.current) return
    userHasInteracted.current = true
    if (nodeId.startsWith('v:')) { onSelectHistoryItem({ kind: 'version', id: nodeId.slice(2) }); return }
    const did = nodeId.slice(2), info = draftMeta.get(did); if (!info) return
    onSelectHistoryItem(info.isRoot ? { kind: 'root-draft', id: did } : { kind: 'draft', id: did, parentVersionId: info.parentVersionId })
  }

  const onMD = (e: React.MouseEvent<SVGSVGElement>) => { if (e.button !== 0) return; wasDragging.current = false; dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y } }
  const onMM = (e: React.MouseEvent<SVGSVGElement>) => { if (!dragRef.current) return; const dx = e.clientX - dragRef.current.sx, dy = e.clientY - dragRef.current.sy; if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragging.current = true; setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy }) }
  const onMU = () => { dragRef.current = null }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => { e.preventDefault(); const svg = svgRef.current; if (!svg) return; const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; const nz = Math.max(0.05, Math.min(8, zoom * (e.deltaY > 0 ? 0.85 : 1.18))); setPan(p => ({ x: mx - (mx - p.x) * (nz / zoom), y: my - (my - p.y) * (nz / zoom) })); setZoom(nz) }

  const vEdges = namedVersions.filter(v => v.parent_version_id).map(v => ({ src: `v:${v.parent_version_id!}`, tgt: `v:${v.id}` }))
  const dEdges = namedVersions.filter(v => v.draft).map(v => ({ src: `v:${v.id}`, tgt: `d:${v.draft!.id}` }))
  const draftNodes = [...(rootDraft ? [rootDraft] : []), ...namedVersions.filter(v => v.draft).map(v => v.draft!)]
  const btn = 'w-8 h-8 flex items-center justify-center bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:bg-gray-50'
  if (!namedVersions.length && !rootDraft) return <div className="flex h-full items-center justify-center text-sm text-gray-400">No versions yet — publish a draft to create a snapshot.</div>

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', opacity: ready ? 1 : 0 }}>
      <svg ref={svgRef} width="100%" height="100%"
        style={{ display: 'block', background: '#f9fafb', borderRadius: 8, cursor: wasDragging.current ? 'grabbing' : 'grab' }}
        onClick={(e) => { if (!wasDragging.current && e.target === e.currentTarget) onBackgroundClick?.() }}
        onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU} onWheel={onWheel}>
        <defs>
          <marker id="vh-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#9ca3af" /></marker>
          <marker id="vh-arr-d" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#f59e0b" /></marker>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`} style={{ transition: animated ? 'transform 0.35s cubic-bezier(0.4,0,0.2,1)' : 'none' }}>
          {vEdges.map(({ src, tgt }) => g.hasNode(src) && g.hasNode(tgt) && (
            <path key={`${src}-${tgt}`} d={edgePath(g, src, tgt)} fill="none" stroke="#9ca3af" strokeWidth={1.5} markerEnd="url(#vh-arr)" />
          ))}
          {dEdges.map(({ src, tgt }) => g.hasNode(src) && g.hasNode(tgt) && (
            <path key={`${src}-${tgt}`} d={edgePath(g, src, tgt)} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" markerEnd="url(#vh-arr-d)" />
          ))}
          {namedVersions.map(v => {
            const pos = g.node(`v:${v.id}`); if (!pos) return null
            const sel = selectedNodeId === `v:${v.id}`, def = graphDefaultVersionId === v.id
            const [x, y] = [pos.x - VW / 2, pos.y - VH / 2]
            const label = formatVersionName(v); const short = label.length > 21 ? label.slice(0, 19) + '…' : label
            return (
              <g key={v.id} transform={`translate(${x},${y})`} onClick={() => handleNodeClick(`v:${v.id}`)} style={{ cursor: 'pointer' }}>
                {sel && <rect x={-5} y={-5} width={VW + 10} height={VH + 10} rx={14} fill="none" stroke="rgba(37,99,235,0.28)" strokeWidth={10} />}
                <rect width={VW} height={VH} rx={9} fill={def ? '#f0fdf4' : '#fff'} stroke={sel ? '#2563eb' : def ? '#86efac' : '#e5e7eb'} strokeWidth={sel ? 2.5 : 1.5} />
                <rect width={4} height={VH} rx={2} fill={def ? '#22c55e' : '#6b7280'} />
                <text x={14} y={21} fontSize={10} fill="#9ca3af" fontFamily="sans-serif">{v.version_id ?? '—'}</text>
                <text x={14} y={40} fontSize={12} fontWeight="600" fill="#111827" fontFamily="sans-serif">{short}</text>
                <text x={14} y={58} fontSize={10} fill="#9ca3af" fontFamily="sans-serif">{v.run_count ?? 0} run(s){def ? ' · Default' : ''}</text>
              </g>
            )
          })}
          {draftNodes.map(draft => {
            const pos = g.node(`d:${draft.id}`); if (!pos) return null
            const sel = selectedNodeId === `d:${draft.id}`
            const [x, y] = [pos.x - DW / 2, pos.y - DH / 2]
            const label = formatVersionName(draft); const short = label.length > 18 ? label.slice(0, 16) + '…' : label
            return (
              <g key={draft.id} transform={`translate(${x},${y})`} onClick={() => handleNodeClick(`d:${draft.id}`)} style={{ cursor: 'pointer' }}>
                {sel && <rect x={-5} y={-5} width={DW + 10} height={DH + 10} rx={13} fill="none" stroke="rgba(37,99,235,0.28)" strokeWidth={10} />}
                <rect width={DW} height={DH} rx={8} fill="#fffbeb" stroke={sel ? '#2563eb' : '#fcd34d'} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray={sel ? undefined : '4,2'} />
                <rect width={4} height={DH} rx={2} fill="#f59e0b" />
                <text x={13} y={18} fontSize={10} fill="#92400e" fontFamily="sans-serif">Draft · Live</text>
                <text x={13} y={36} fontSize={12} fontWeight="600" fill="#78350f" fontFamily="sans-serif">{short}</text>
              </g>
            )
          })}
        </g>
      </svg>

      {detailContent && focusedScreenPos && (
        <div style={{
          position: 'absolute',
          left: focusedScreenPos.x,
          top: focusedScreenPos.y,
          transform: 'translate(-50%, -50%)',
          zIndex: 20,
          width: 480,
          maxHeight: 'calc(100% - 48px)',
          pointerEvents: 'auto',
        }} className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
          {detailContent}
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className={btn} onClick={() => setZoom(z => Math.min(8, z * 1.25))} title="Zoom in"><Plus size={14} /></button>
        <button className={btn} onClick={() => setZoom(z => Math.max(0.05, z * 0.8))} title="Zoom out"><Minus size={14} /></button>
        <button className={btn} onClick={fitToView} title="Fit to view"><Maximize2 size={14} /></button>
      </div>
    </div>
  )
}
