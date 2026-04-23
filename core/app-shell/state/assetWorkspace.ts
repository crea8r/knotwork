import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { namespacedStorageKey } from '@storage'

export type AssetWorkspaceScope =
  | {
      kind: 'project'
      workspaceId: string
      projectSlug: string
      projectTitle?: string | null
    }
  | {
      kind: 'knowledge'
      workspaceId: string
    }

export type AssetWorkspaceSelection = {
  scopeKind: 'project' | 'knowledge'
  workspaceId: string
  assetType: 'folder' | 'file' | 'knowledge-file' | 'workflow'
  path: string
  label: string
  projectSlug?: string
  projectTitle?: string | null
  graphId?: string
}

interface AssetWorkspaceState {
  isOpen: boolean
  isAssetChatOpen: boolean
  scope: AssetWorkspaceScope | null
  selection: AssetWorkspaceSelection | null
  open: (scope: AssetWorkspaceScope) => void
  toggle: (scope: AssetWorkspaceScope) => void
  openAssetChat: () => void
  toggleAssetChat: () => void
  closeAssetChat: () => void
  close: () => void
  setSelection: (selection: AssetWorkspaceSelection | null) => void
}

type PersistedAssetWorkspaceState = Pick<AssetWorkspaceState, 'scope' | 'selection'>

function scopeKey(scope: AssetWorkspaceScope | null): string | null {
  if (!scope) return null
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}:${scope.projectSlug}`
    : `knowledge:${scope.workspaceId}`
}

function sameSelection(a: AssetWorkspaceSelection | null, b: AssetWorkspaceSelection | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.scopeKind === b.scopeKind
    && a.workspaceId === b.workspaceId
    && a.assetType === b.assetType
    && a.path === b.path
    && a.label === b.label
    && (a.projectSlug ?? null) === (b.projectSlug ?? null)
    && (a.projectTitle ?? null) === (b.projectTitle ?? null)
    && (a.graphId ?? null) === (b.graphId ?? null)
  )
}

function defaultSelectionForScope(scope: AssetWorkspaceScope): AssetWorkspaceSelection {
  if (scope.kind === 'project') {
    return {
      scopeKind: 'project',
      workspaceId: scope.workspaceId,
      projectSlug: scope.projectSlug,
      projectTitle: scope.projectTitle ?? null,
      assetType: 'folder',
      path: '',
      label: scope.projectTitle ?? 'Project assets',
    }
  }

  return {
    scopeKind: 'knowledge',
    workspaceId: scope.workspaceId,
    assetType: 'folder',
    path: '',
    label: 'Knowledge',
  }
}

function selectionMatchesScope(
  selection: AssetWorkspaceSelection | null,
  scope: AssetWorkspaceScope,
): boolean {
  if (!selection) return false
  if (selection.workspaceId !== scope.workspaceId) return false
  if (scope.kind === 'project') {
    return selection.scopeKind === 'project' && selection.projectSlug === scope.projectSlug
  }
  return selection.scopeKind === 'knowledge'
}

const assetWorkspaceStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(name)
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(name, value)
  },
  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(name)
  },
}

export const useAssetWorkspaceStore = create<AssetWorkspaceState>()(
  persist<AssetWorkspaceState, [], [], PersistedAssetWorkspaceState>(
    (set, get) => ({
      isOpen: false,
      isAssetChatOpen: false,
      scope: null,
      selection: null,
      open: (scope) => set((state) => {
        const sameScope = scopeKey(state.scope) === scopeKey(scope)
        if (state.isOpen && sameScope) return state
        const nextSelection = sameScope || selectionMatchesScope(state.selection, scope)
          ? state.selection
          : defaultSelectionForScope(scope)
        return {
          ...state,
          isOpen: true,
          scope,
          selection: nextSelection,
        }
      }),
      toggle: (scope) => {
        const state = get()
        const sameScope = scopeKey(state.scope) === scopeKey(scope)
        if (state.isOpen && sameScope) {
          set((currentState) => (
            currentState.isOpen || currentState.isAssetChatOpen
              ? { ...currentState, isOpen: false, isAssetChatOpen: false }
              : currentState
          ))
          return
        }
        set((currentState) => {
          const nextSelection = sameScope || selectionMatchesScope(currentState.selection, scope)
            ? currentState.selection
            : defaultSelectionForScope(scope)
          return {
            ...currentState,
            isOpen: true,
            scope,
            selection: nextSelection,
          }
        })
      },
      openAssetChat: () => set((state) => (state.isAssetChatOpen ? state : { ...state, isAssetChatOpen: true })),
      toggleAssetChat: () => set((state) => ({ ...state, isAssetChatOpen: !state.isAssetChatOpen })),
      closeAssetChat: () => set((state) => (state.isAssetChatOpen ? { ...state, isAssetChatOpen: false } : state)),
      close: () => set((state) => (
        state.isOpen || state.isAssetChatOpen
          ? { ...state, isOpen: false, isAssetChatOpen: false }
          : state
      )),
      setSelection: (selection) => set((state) => (
        sameSelection(state.selection, selection)
          ? state
          : { ...state, selection }
      )),
    }),
    {
      name: namespacedStorageKey('asset-workspace'),
      storage: createJSONStorage(() => assetWorkspaceStorage),
      partialize: (state) => ({
        scope: state.scope,
        selection: state.selection,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as PersistedAssetWorkspaceState),
        isOpen: false,
      }),
    },
  ),
)

export function isSameAssetScope(a: AssetWorkspaceScope | null, b: AssetWorkspaceScope | null): boolean {
  return scopeKey(a) === scopeKey(b)
}

export function buildActiveAssetMessageMetadata(existing?: Record<string, unknown>): Record<string, unknown> | undefined {
  const selection = useAssetWorkspaceStore.getState().selection
  if (!selection) return existing

  return {
    ...(existing ?? {}),
    ui_asset_context: {
      scope_kind: selection.scopeKind,
      workspace_id: selection.workspaceId,
      project_slug: selection.projectSlug ?? null,
      project_title: selection.projectTitle ?? null,
      asset_type: selection.assetType,
      path: selection.path,
      label: selection.label,
      graph_id: selection.graphId ?? null,
    },
  }
}

export function formatAssetSelectionLabel(selection: AssetWorkspaceSelection | null): string | null {
  if (!selection) return null
  return selection.label || selection.path || (
    selection.scopeKind === 'project'
      ? selection.projectTitle ?? 'Project assets'
      : 'Knowledge'
  )
}
