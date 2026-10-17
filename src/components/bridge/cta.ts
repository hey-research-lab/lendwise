import {
  BridgeAmountError,
  formatUsdcAmount,
  parseUsdcAmount,
} from '@/lib/execution/cctp/amounts'
import { BRIDGE_PAUSED_MESSAGE } from '@/lib/execution/cctp/kill-switch'
import type { PreflightResult } from '@/lib/execution/cctp/trustline'
import type { BridgeQuote, BridgeTransferView } from '@/lib/execution/cctp/view'

import { STATUS_TEXT } from './steps'

/** The widget's single action button. `action` null: the button is disabled. */
export interface Cta<A extends string> {
  label: string
  action: A | null
  spinner: boolean
  /** A line under the button, for what its label cannot say. */
  hint: string | null
}

export type FormAction =
  | 'record-burn'
  | 'connect-evm'
  | 'connect-stellar'
  | 'fund-stellar'
  | 'add-trustline'
  | 'bridge'

export type ProgressAction =
  | 'record-burn'
  | 'fund-stellar'
  | 'add-trustline'
  | 'mint'
  | 'retry'
  | 'portfolio'

type AccountAction = 'fund-stellar' | 'add-trustline'

const act = <A extends string>(
  label: string,
  action: A,
  hint: string | null = null
): Cta<A> => ({ label, action, spinner: false, hint })

const off = <A extends string>(
  label: string,
  opts: { spinner?: boolean; hint?: string } = {}
): Cta<A> => ({
  label,
  action: null,
  spinner: opts.spinner ?? false,
  hint: opts.hint ?? null,
})

/** The button for a Stellar account that is not ready yet; null once it is. */
export function accountCta(
  p: PreflightResult,
  friendbot: boolean
): Cta<AccountAction> | null {
  switch (p.state) {
    case 'ready':
      return null
    case 'unfunded':
      return friendbot
        ? act(
            'Fund your Stellar account',
            'fund-stellar',
            'Friendbot opens in a new tab. Come back here once it is done.'
          )
        : off('Fund your Stellar account', {
            hint: `Send at least ${p.requiredXlm} XLM to this account first.`,
          })
    case 'insufficient-xlm':
      return off('Not enough XLM on Stellar', {
        hint: `Your Stellar account needs ${p.requiredXlm} XLM available for the reserve and fees; it has ${p.availableXlm}.`,
      })
    case 'missing-trustline':
      return act(
        'Add USDC to your Stellar wallet',
        'add-trustline',
        'Stellar accounts opt in to USDC before they can receive it. This locks 0.5 XLM of reserve, before any USDC leaves your EVM wallet.'
      )
    case 'limit-too-low':
      return act(
        'Add USDC to your Stellar wallet',
        'add-trustline',
        'Your USDC trustline limit is below this amount: update it to receive the transfer.'
      )
    case 'not-authorized':
      return off('Bridge', {
        hint: 'The USDC issuer has not authorized your trustline.',
      })
  }
}

/** The mint can be signed: attested, or a failed mint (a fee is known) that can be resumed. */
export function canMint(t: BridgeTransferView): boolean {
  return (
    t.status === 'attested' ||
    (t.status === 'failed' && t.resumable && t.feeExecuted !== null)
  )
}

/** A stopped transfer without an attestation yet, which "Retry" resumes. */
export function canRetry(t: BridgeTransferView): boolean {
  return t.status === 'failed' && t.resumable && t.feeExecuted === null
}

export interface FormCtaInput {
  /** The running action's message; null when idle. */
  busy: string | null
  /** A burn the wallet sent that the server has not recorded. */
  pendingBurn: boolean
  /** `CCTP_BRIDGE_ENABLED`. */
  enabled: boolean
  evmConnected: boolean
  /** A valid Stellar session (SEP-10). */
  signedIn: boolean
  /** The chosen source chain's name; null before a choice. */
  chainName: string | null
  amount: string
  /** USDC on the chosen chain (6 decimals); null when unknown, which never blocks. */
  balance: bigint | null
  /** The per-transfer cap (6 decimals); null without one. */
  cap: bigint | null
  /** A quote or account check is on its way. */
  checking: boolean
  /** The quote or the account check was refused; the widget shows it under the button. */
  checkError: string | null
  quote: BridgeQuote | null
  preflight: PreflightResult | null
  /** Friendbot exists on this network (testnet). */
  friendbot: boolean
}

/** The form's button: the first row of spec 0007's table that applies. */
export function formCta(i: FormCtaInput): Cta<FormAction> {
  if (i.busy) return off(i.busy, { spinner: true })
  if (i.pendingBurn) return act('Record the burn', 'record-burn')
  if (!i.enabled) return off('Bridge paused', { hint: BRIDGE_PAUSED_MESSAGE })
  if (!i.evmConnected) return act('Connect wallet', 'connect-evm')
  if (!i.signedIn) return act('Sign in with Stellar', 'connect-stellar')
  if (i.chainName === null) return off('Choose a chain')
  if (!i.amount) return off('Enter amount')
  let wanted: bigint
  try {
    wanted = parseUsdcAmount(i.amount)
  } catch (err) {
    if (!(err instanceof BridgeAmountError)) throw err
    return off('Enter a valid amount', { hint: err.message })
  }
  if (i.balance !== null && i.balance < wanted)
    return off(`Not enough USDC on ${i.chainName}`)
  if (i.cap !== null && wanted > i.cap)
    return off(`Max ${formatUsdcAmount(i.cap)} USDC per transfer`)
  if (i.checking) return off('Getting a quote…', { spinner: true })
  if (i.checkError) return off('Bridge')
  if (!i.quote || !i.preflight)
    return off('Getting a quote…', { spinner: true })
  return (
    accountCta(i.preflight, i.friendbot) ??
    act(`Bridge ${i.quote.amount} USDC`, 'bridge')
  )
}

export interface ProgressCtaInput {
  transfer: BridgeTransferView
  busy: string | null
  pendingBurn: boolean
  /** Set by a re-check before the mint (or after a ChangeTrust); null otherwise. */
  preflight: PreflightResult | null
  friendbot: boolean
}

/** Statuses the server moves on its own: the button waits with a spinner. */
const MOVING = new Set<BridgeTransferView['status']>([
  'burn_submitted',
  'burn_confirmed',
  'mint_submitted',
])

/** The button of the transfer on screen. */
export function progressCta(i: ProgressCtaInput): Cta<ProgressAction> {
  const t = i.transfer
  if (i.busy) return off(i.busy, { spinner: true })
  if (i.pendingBurn) return act('Record the burn', 'record-burn')
  if (canMint(t)) {
    const account = i.preflight ? accountCta(i.preflight, i.friendbot) : null
    return account ?? act('Mint USDC on Stellar', 'mint')
  }
  if (canRetry(t)) return act('Retry', 'retry')
  if (t.status === 'completed') return act('View in portfolio', 'portfolio')
  return off(STATUS_TEXT[t.status], { spinner: MOVING.has(t.status) })
}

export interface VisibleMessageInput {
  flowError: string | null
  checkError: string | null
  warning: string | null
  inTransfer: boolean
}

/** The one message under the card: an action's error, then the check's, then a warning. */
export function visibleMessage(
  i: VisibleMessageInput
): { kind: 'error' | 'check' | 'warning'; text: string } | null {
  if (i.flowError) return { kind: 'error', text: i.flowError }
  if (i.checkError && !i.inTransfer)
    return { kind: 'check', text: i.checkError }
  if (i.warning) return { kind: 'warning', text: i.warning }
  return null
}
