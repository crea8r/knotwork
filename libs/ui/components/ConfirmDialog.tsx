import Btn from './Btn'

interface Props {
  title: string
  message: string
  warning?: string
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
  isPending?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({
  title,
  message,
  warning,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  isPending = false,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{message}</p>
          {warning && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-800">{warning}</p>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn variant={confirmVariant} loading={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  )
}
