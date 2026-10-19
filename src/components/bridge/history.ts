import type { BridgeTransferStatus } from '@/lib/db/repositories/bridge-transfers'
import type { BridgeTransferView } from '@/lib/execution/cctp/view'

/** `listBridgeTransfers` returns at most this many transfers (the repository's default limit). */
export const HISTORY_LIMIT = 20

/** The status of a transfer in one or two words, for the history rows. */
export const STATUS_SHORT: Record<BridgeTransferStatus, string> = {
  planned: 'Not started',
  burn_submitted: 'Burn sent',
  burn_confirmed: 'Waiting for Circle',
  attested: 'Ready to mint',
  mint_submitted: 'Mint sent',
  completed: 'Done',
  failed: 'Stopped',
}

const newestFirst = (a: BridgeTransferView, b: BridgeTransferView) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

/** Resumable transfers first, then the others; newest first in each. A new array. */
export function orderTransfers(
  transfers: readonly BridgeTransferView[]
): BridgeTransferView[] {
  return [
    ...transfers.filter((t) => t.resumable).sort(newestFirst),
    ...transfers.filter((t) => !t.resumable).sort(newestFirst),
  ]
}

/** The dot on the history button: a resumable transfer other than the one on screen. */
export function hasOtherResumable(
  transfers: readonly BridgeTransferView[],
  currentId: string | null
): boolean {
  return transfers.some((t) => t.resumable && t.id !== currentId)
}

/**
 * The banner above the form: the newest resumable transfer, and how many other
 * resumable ones wait in the transfers window. Null when none.
 */
export function resumeNotice(
  transfers: readonly BridgeTransferView[]
): { transfer: BridgeTransferView; others: number } | null {
  const waiting = transfers.filter((t) => t.resumable).sort(newestFirst)
  if (waiting.length === 0) return null
  return { transfer: waiting[0], others: waiting.length - 1 }
}

/** A transfer list, tagged with the Stellar account it was listed for. */
export interface TransferList {
  owner: string
  list: BridgeTransferView[]
}

/** The list, only for the account it was listed for: never another account's. */
export function transfersOf(
  transfers: TransferList | null,
  address: string | null
): readonly BridgeTransferView[] {
  return transfers && transfers.owner === address ? transfers.list : []
}

/** The server returned as many transfers as it can: older ones are not listed. */
export function isHistoryTruncated(
  transfers: readonly BridgeTransferView[]
): boolean {
  return transfers.length >= HISTORY_LIMIT
}
