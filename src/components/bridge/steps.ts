import type { BridgeTransferStatus } from '@/lib/db/repositories/bridge-transfers'
import type {
  ActionResult,
  BridgeTransferView,
} from '@/lib/execution/cctp/view'

export type StepKey = 'trustline' | 'approval' | 'burn' | 'attestation' | 'mint'
export type StepState = 'todo' | 'active' | 'done' | 'failed'

export interface StepView {
  key: StepKey
  label: string
  state: StepState
  link: string | null
}

const STEPS: {
  key: StepKey
  label: string
  link: (t: BridgeTransferView) => string | null
}[] = [
  {
    key: 'trustline',
    label: 'USDC trustline on Stellar',
    link: (t) => t.links.changeTrust,
  },
  { key: 'approval', label: 'USDC approval', link: (t) => t.links.approval },
  { key: 'burn', label: 'Burn on the source chain', link: (t) => t.links.burn },
  { key: 'attestation', label: "Circle's attestation", link: () => null },
  { key: 'mint', label: 'Mint on Stellar', link: (t) => t.links.mint },
]

export const STATUS_TEXT: Record<BridgeTransferStatus, string> = {
  planned: 'Waiting for the burn',
  burn_submitted: 'Burn sent — waiting for its confirmation',
  burn_confirmed: "Burn confirmed — waiting for Circle's attestation",
  attested: 'Attested — sign the mint in your Stellar wallet',
  mint_submitted: 'Mint sent to Stellar',
  completed: 'Done — native USDC is in your Stellar wallet',
  failed: 'Stopped',
}

/** Index in STEPS of the step the transfer is at; 5 once completed. */
export function currentStep(t: BridgeTransferView): number {
  switch (t.status) {
    case 'planned':
      return 1
    case 'burn_submitted':
      return 2
    case 'burn_confirmed':
      return 3
    case 'attested':
    case 'mint_submitted':
      return 4
    case 'completed':
      return 5
    case 'failed':
      // Attested (a fee is known) or a mint was sent: the mint failed.
      if (t.hashes.mint || t.feeExecuted !== null) return 4
      // Burn confirmed (resumable) but no attestation: the attestation check failed.
      if (t.resumable) return 3
      return t.hashes.burn ? 2 : 1
  }
}

export function bridgeSteps(t: BridgeTransferView): StepView[] {
  const at = currentStep(t)
  return STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    link: s.link(t),
    state:
      i < at
        ? 'done'
        : i > at
          ? 'todo'
          : t.status === 'failed'
            ? 'failed'
            : 'active',
  }))
}

/**
 * What to tell the user about the speed of the attestation, or null for a
 * plain Fast transfer. A Standard request is announced up front; a Fast
 * request that Circle executed as Standard is a fallback.
 */
export function attestationNote(t: BridgeTransferView): string | null {
  if (t.tier === 'standard') return 'Standard transfer: ~15–20 min'
  if (t.tierExecuted === 'standard')
    return 'Circle fell back to a Standard transfer.'
  return null
}

/** Milliseconds since `createdAt` on the given client clock; never negative. */
export function elapsedSince(createdAt: string, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(createdAt))
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${pad2(m)} min`
  if (m > 0) return `${m} min ${pad2(s)} s`
  return `${s} s`
}

/**
 * Whether "New transfer" may be offered. Never once USDC may have left the
 * source chain: a recorded burn, or one sent but not yet recorded
 * (`pendingBurn`). Never while an action runs.
 */
export function canStartNew(
  transfer: BridgeTransferView | null,
  pendingBurn: { chainId: number; hash: string } | null,
  busy: string | null
): boolean {
  if (transfer === null || pendingBurn !== null || busy !== null) return false
  return (
    transfer.hashes.burn === null ||
    transfer.status === 'completed' ||
    (transfer.status === 'failed' && !transfer.resumable)
  )
}

export const BURN_REPLACED_OR_CANCELLED =
  'Your burn was replaced or cancelled in your wallet; no USDC left it.'

/**
 * What the burn's receipt says once the wallet's transaction is mined. A
 * wallet can speed up or cancel a transaction by sending another one with the
 * same nonce; the receipt is then the replacement's, under another hash.
 *
 *   - `sent`: the receipt of the hash that was sent and recorded.
 *   - `replaced`: a successful replacement, to import by its own hash.
 *   - `cancelled`: a replacement that reverted, so nothing was burned.
 */
export function burnReceiptOutcome(
  sentHash: string,
  receipt: { transactionHash: string; status: 'success' | 'reverted' }
):
  | { kind: 'sent' }
  | { kind: 'replaced'; hash: `0x${string}` }
  | { kind: 'cancelled' } {
  if (receipt.transactionHash.toLowerCase() === sentHash.toLowerCase())
    return { kind: 'sent' }
  if (receipt.status !== 'success') return { kind: 'cancelled' }
  return {
    kind: 'replaced',
    hash: receipt.transactionHash.toLowerCase() as `0x${string}`,
  }
}

/**
 * Import refusals that mean the replacement burned nothing for this bridge: no
 * CCTP burn at all (a cancel: `burn-no-event`, `burn-wrong-contract`), or not
 * a burn to this bridge (`not-a-bridge-burn`).
 */
const CANCELLED_IMPORT_CODES = new Set([
  'not-a-bridge-burn',
  'burn-no-event',
  'burn-wrong-contract',
])

/** What to do with the result of importing a replacement burn. */
export function replacementImportOutcome(
  result: ActionResult<BridgeTransferView>
):
  | { kind: 'adopt'; transfer: BridgeTransferView }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string } {
  if (result.ok) return { kind: 'adopt', transfer: result.value }
  if (result.code && CANCELLED_IMPORT_CODES.has(result.code))
    return { kind: 'cancelled' }
  return { kind: 'error', message: result.error }
}

export const EVM_ACCOUNT_CHANGED =
  'Your EVM account changed. Start again from the amount.'

/**
 * Whether the wallet's current EVM account is still `owner`, the account whose
 * balance and allowance were checked and that approved the burn. Addresses
 * compare without their checksum casing; a missing one never matches.
 */
export function sameEvmAccount(
  owner: string | undefined,
  current: string | undefined
): boolean {
  return (
    owner !== undefined &&
    current !== undefined &&
    owner.toLowerCase() === current.toLowerCase()
  )
}

/**
 * A burn the wallet sent that the server refused to record. The "Record the
 * burn" button sits above the error, with the burn's hash.
 */
export function burnNotRecordedMessage(hash: string, error: string): string {
  return `Burn sent (${hash}) but not recorded: ${error} Use “Record the burn” above.`
}
