import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ShellHeaderIconKind } from './ShellHeaderMeta'

export type ShellTopBarSnapshot = {
  title?: string | null
  subtitle?: string | null
  iconKind?: ShellHeaderIconKind | null
}

type ShellTopBarSlots = {
  leadingTitle?: string | null
  leadingSubtitle?: string | null
  leadingIcon?: ReactNode | null
  leading?: ReactNode | null
  actions?: ReactNode | null
  context?: ReactNode | null
  snapshot?: ShellTopBarSnapshot | null
}

type ShellTopBarSlotsContextValue = ShellTopBarSlots & {
  setSlots: (slots: ShellTopBarSlots) => void
  clearSlots: () => void
}

const ShellTopBarSlotsContext = createContext<ShellTopBarSlotsContextValue | null>(null)

export function ShellTopBarSlotsProvider({ children }: { children: ReactNode }) {
  const [slots, setSlotsState] = useState<ShellTopBarSlots>({
    leadingTitle: null,
    leadingSubtitle: null,
    leadingIcon: null,
    leading: null,
    actions: null,
    context: null,
    snapshot: null,
  })

  const setSlots = useCallback((nextSlots: ShellTopBarSlots) => {
    setSlotsState({
      leadingTitle: nextSlots.leadingTitle ?? null,
      leadingSubtitle: nextSlots.leadingSubtitle ?? null,
      leadingIcon: nextSlots.leadingIcon ?? null,
      leading: nextSlots.leading ?? null,
      actions: nextSlots.actions ?? null,
      context: nextSlots.context ?? null,
      snapshot: nextSlots.snapshot ?? null,
    })
  }, [])

  const clearSlots = useCallback(() => {
    setSlotsState({
      leadingTitle: null,
      leadingSubtitle: null,
      leadingIcon: null,
      leading: null,
      actions: null,
      context: null,
      snapshot: null,
    })
  }, [])

  const value = useMemo<ShellTopBarSlotsContextValue>(() => ({
    ...slots,
    setSlots,
    clearSlots,
  }), [clearSlots, setSlots, slots])

  return (
    <ShellTopBarSlotsContext.Provider value={value}>
      {children}
    </ShellTopBarSlotsContext.Provider>
  )
}

export function useShellTopBarSlots() {
  const context = useContext(ShellTopBarSlotsContext)
  if (!context) {
    throw new Error('useShellTopBarSlots must be used within ShellTopBarSlotsProvider')
  }
  return context
}

export function useRegisterShellTopBarSlots({
  leadingTitle,
  leadingSubtitle,
  leadingIcon,
  leading,
  actions,
  context,
  snapshot,
}: ShellTopBarSlots) {
  const { setSlots, clearSlots } = useShellTopBarSlots()

  useEffect(() => {
    setSlots({ leadingTitle, leadingSubtitle, leadingIcon, leading, actions, context, snapshot })
    return () => clearSlots()
  }, [actions, clearSlots, context, leading, leadingIcon, leadingSubtitle, leadingTitle, setSlots, snapshot])
}
