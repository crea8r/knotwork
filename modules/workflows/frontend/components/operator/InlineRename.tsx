import { useEffect, useRef, useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import { useRenameRun } from "@modules/workflows/frontend/api/runs"

interface Props {
  runId: string
  workspaceId: string
  currentName: string | null
}

export default function InlineRename({ runId, workspaceId, currentName }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName ?? '')
  const rename = useRenameRun(workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    if (value.trim()) rename.mutate({ runId, name: value.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="border border-brand-400 rounded px-2 py-0.5 text-sm font-semibold text-gray-900 outline-none w-56"
        />
        <button onClick={commit} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
      </div>
    )
  }
  return (
    <button
      onClick={() => { setValue(currentName ?? ''); setEditing(true) }}
      className="flex items-center gap-1 group"
      title="Click to rename"
    >
      <span className="font-semibold text-gray-900 text-sm">
        {currentName ?? <span className="text-gray-400 font-normal">Untitled run</span>}
      </span>
      <Pencil size={11} className="text-gray-300 group-hover:text-gray-500" />
    </button>
  )
}
