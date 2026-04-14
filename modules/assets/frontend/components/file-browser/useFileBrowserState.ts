/**
 * useFileBrowserState — pure UI state for the file-browser shell.
 * No API calls. Compose with API hooks in the page component.
 */
import { useEffect, useRef, useState } from 'react'
import type { RightPanel } from './types'
import type { BrowserFile } from './types'
import type { ContextTarget } from '@modules/assets/frontend/components/handbook/FileContextMenu'
import { readNamespacedStorage, writeNamespacedStorage } from '@storage'

const MIN_PANEL_W = 200
const MAX_PANEL_W = 760
const DEFAULT_PANEL_W = 440

export interface FileBrowserState {
  rightPanel: RightPanel
  setRightPanel: (p: RightPanel) => void
  currentFolder: string
  setCurrentFolder: (f: string) => void
  multiSelected: Set<string>
  movingTarget: ContextTarget | null
  setMovingTarget: (t: ContextTarget | null) => void
  pageDragOver: boolean
  setPageDragOver: (v: boolean) => void
  panelWidth: number
  pageRef: React.RefObject<HTMLDivElement>
  selectedPath: string | null
  openFileName: string | undefined
  openFile: (file: BrowserFile) => void
  openFolder: (path: string) => void
  goBack: () => void
  ctrlSelectFile: (file: BrowserFile) => void
  onDividerMouseDown: (e: React.MouseEvent) => void
}

interface UseFileBrowserStateOptions {
  initialFolder?: string
  initialFilePath?: string | null
  panelWidthStorageKey?: string
}

export function useFileBrowserState(options: UseFileBrowserStateOptions = {}): FileBrowserState {
  const initialFolder = options.initialFolder ?? ''
  const initialFilePath = options.initialFilePath ?? null
  const panelWidthStorageKey = options.panelWidthStorageKey
  const [rightPanel, setRightPanel] = useState<RightPanel>(
    initialFilePath ? { kind: 'file', path: initialFilePath } : { kind: 'folder' },
  )
  const [currentFolder, setCurrentFolder] = useState(
    initialFilePath ? initialFilePath.split('/').slice(0, -1).join('/') : initialFolder,
  )
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  const [movingTarget, setMovingTarget] = useState<ContextTarget | null>(null)
  const [pageDragOver, setPageDragOver] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => {
    if (!panelWidthStorageKey || typeof window === 'undefined') return DEFAULT_PANEL_W
    const raw = readNamespacedStorage(panelWidthStorageKey)
    const value = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (Number.isNaN(value)) return DEFAULT_PANEL_W
    return Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, value))
  })
  const pageRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    if (!panelWidthStorageKey || typeof window === 'undefined') return
    writeNamespacedStorage(panelWidthStorageKey, String(panelWidth))
  }, [panelWidth, panelWidthStorageKey])

  function openFile(file: BrowserFile) {
    setCurrentFolder(file.path.split('/').slice(0, -1).join('/'))
    setRightPanel(
      file.entryKind === 'workflow' && file.graphId
        ? { kind: 'workflow', graphId: file.graphId, path: file.path }
        : { kind: 'file', path: file.path },
    )
    setMultiSelected(new Set())
  }

  function openFolder(path: string) {
    setCurrentFolder(path)
    setRightPanel({ kind: 'folder' })
  }

  function goBack() { setRightPanel({ kind: 'folder' }) }

  function ctrlSelectFile(file: BrowserFile) {
    setMultiSelected(prev => {
      const next = new Set(prev)
      next.has(file.path) ? next.delete(file.path) : next.add(file.path)
      return next
    })
  }

  function onDividerMouseDown(e: React.MouseEvent) {
    isDraggingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingRef.current) return
      setPanelWidth(Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, startWidthRef.current - (ev.clientX - startXRef.current))))
    }
    function onMouseUp() {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return {
    rightPanel, setRightPanel,
    currentFolder, setCurrentFolder,
    multiSelected, movingTarget, setMovingTarget,
    pageDragOver, setPageDragOver,
    panelWidth, pageRef,
    selectedPath: rightPanel.kind === 'file' || rightPanel.kind === 'workflow' ? rightPanel.path : null,
    openFileName: rightPanel.kind === 'file' || rightPanel.kind === 'workflow' ? rightPanel.path.split('/').pop() : undefined,
    openFile, openFolder, goBack, ctrlSelectFile, onDividerMouseDown,
  }
}
