import { formatUsdcAmount, parseUsdcAmount } from '@/lib/execution/cctp/amounts'
import type { BridgeQuote } from '@/lib/execution/cctp/view'

/** Whether the bridge can read `input` as an amount (format, decimals, above zero). */
export function isUsdcAmount(input: string): boolean {
  try {
    parseUsdcAmount(input)
    return true
  } catch {
    return false
  }
}

/** The Receive amount: at least the quote's minimum; a dash without a quote. */
export function receiveText(quote: BridgeQuote | null): string {
  return quote ? `≥ ${quote.minimumReceived}` : '—'
}

/** "≈ $2.00": USDC counted one for one. Empty for an empty or unreadable amount. */
export function usdText(amount: string | null): string {
  if (!amount) return ''
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) return ''
  return `≈ $${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** What "Max" fills: the balance, capped by the per-transfer cap. Null with nothing to fill. */
export function maxAmount(
  balance: bigint | null,
  cap: bigint | null
): string | null {
  if (balance === null || balance <= 0n) return null
  return formatUsdcAmount(cap !== null && balance > cap ? cap : balance)
}

/** A Horizon amount ("2.9996400") without its trailing zeros ("2.99964"). */
export function trimBalance(raw: string): string {
  if (!raw.includes('.')) return raw
  return raw.replace(/0+$/, '').replace(/\.$/, '')
}

/** The Receive balance: the trustline's, "0" without one, null before a check. */
export function stellarUsdcBalance(
  preflight: { trustline: { balance: string } | null } | null
): string | null {
  if (!preflight) return null
  return preflight.trustline ? trimBalance(preflight.trustline.balance) : '0'
}

/** The folded details line under Receive. */
export function detailsSummary(quote: BridgeQuote): string {
  const speed =
    quote.tier === 'fast' ? 'Fast · ~1 min' : 'Standard · up to ~20 min'
  const fee =
    Number(quote.maxFee) === 0 ? 'no fee' : `fee ≤ ${quote.maxFee} USDC`
  return `${speed} · ${fee}`
}
