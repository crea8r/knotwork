import type { Location, NavigateOptions } from 'react-router-dom'
import type { ShellTopBarSnapshot } from './ShellTopBarSlots'

export type AssetChatReturnTarget = {
  kind: 'channel' | 'page'
  label: string
  pathname: string
  search?: string
}

export type AssetChatLocationState = {
  assetChatReturnTo?: AssetChatReturnTarget
  assetChatSourceHeader?: ShellTopBarSnapshot
}

export function buildAssetChatNavigateOptions(
  returnTo: AssetChatReturnTarget | null,
  sourceHeader?: ShellTopBarSnapshot | null,
): NavigateOptions | undefined {
  if (!returnTo && !sourceHeader) return undefined
  return {
    state: {
      assetChatReturnTo: returnTo ?? undefined,
      assetChatSourceHeader: sourceHeader ?? undefined,
    } satisfies AssetChatLocationState,
  }
}

export function readAssetChatReturnTarget(
  location: Pick<Location, 'state'>,
): AssetChatReturnTarget | null {
  const state = location.state as AssetChatLocationState | null | undefined
  return state?.assetChatReturnTo ?? null
}

export function readAssetChatSourceHeader(
  location: Pick<Location, 'state'>,
): ShellTopBarSnapshot | null {
  const state = location.state as AssetChatLocationState | null | undefined
  return state?.assetChatSourceHeader ?? null
}

export function assetChatReturnHref(target: AssetChatReturnTarget): string {
  return `${target.pathname}${target.search ?? ''}`
}
