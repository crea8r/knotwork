/**
 * InputSchemaEditor — manage the run input schema fields.
 * Listed in the right sidebar "Run Input" tab of GraphDetailPage.
 */
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import type { InputFieldDef } from '@/types'

interface Props {
  fields: InputFieldDef[]
  onChange: (fields: InputFieldDef[]) => void
}

const FIELD_TYPES: InputFieldDef['type'][] = ['text', 'textarea', 'number']

export default function InputSchemaEditor({ fields, onChange }: Props) {
  function update(index: number, patch: Partial<InputFieldDef>) {
    onChange(fields.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index))
  }

  function move(index: number, dir: -1 | 1) {
    const next = index + dir
    if (next < 0 || next >= fields.length) return
    const arr = [...fields]
    ;[arr[index], arr[next]] = [arr[next], arr[index]]
    onChange(arr)
  }

  function addField() {
    onChange([...fields, { name: `field_${fields.length + 1}`, label: '', description: '', required: true, type: 'text' }])
  }

  const inputCls = 'border border-gray-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500'

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b flex-shrink-0">
        <h2 className="font-medium text-gray-900 text-sm">Run Input Schema</h2>
        <p className="text-xs text-gray-400 mt-0.5">Define the fields operators fill in when triggering a run.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {fields.length === 0 && (
          <p className="text-xs text-gray-400 italic">No fields yet. Add a field below.</p>
        )}
        {fields.map((f, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
            <div className="flex items-center justify-between gap-1">
              <input
                className={`${inputCls} flex-1`}
                placeholder="field_key"
                value={f.name}
                onChange={e => update(i, { name: e.target.value })}
              />
              <select
                className={inputCls}
                value={f.type}
                onChange={e => update(i, { type: e.target.value as InputFieldDef['type'] })}
              >
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={e => update(i, { required: e.target.checked })}
                  className="rounded"
                />
                req
              </label>
            </div>
            <input
              className={`${inputCls} w-full`}
              placeholder="Label (shown to operator)"
              value={f.label}
              onChange={e => update(i, { label: e.target.value })}
            />
            <input
              className={`${inputCls} w-full`}
              placeholder="Description (optional)"
              value={f.description}
              onChange={e => update(i, { description: e.target.value })}
            />
            <div className="flex justify-end gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 p-0.5">
                <ChevronUp size={13} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 p-0.5">
                <ChevronDown size={13} />
              </button>
              <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 p-0.5 ml-1">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t flex-shrink-0">
        <button
          onClick={addField}
          className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
        >
          <Plus size={13} /> Add field
        </button>
      </div>
    </div>
  )
}
