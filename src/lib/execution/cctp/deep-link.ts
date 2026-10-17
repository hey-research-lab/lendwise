import { BridgeAmountError, formatUsdcAmount, parseUsdcAmount } from './amounts'
import { type CctpSourceChain, cctpSourceChainBySlug } from './config'

export const BRIDGE_PATH = '/bridge/stellar'

const MAX_PRODUCT_ID_LENGTH = 200

/**
 * Floors to 6 decimals: a pre-filled amount may be a micro-unit below what the
 * optimizer allocated, never above it. The epsilon absorbs binary noise
 * (1.005 × 1e6 = 1004999.999…) without reaching the next micro-unit.
 */
export function flooredUsdcAtomic(amount: string | number): bigint | null {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0) return null
    const atomic = BigInt(Math.floor(amount * 1e6 + 1e-6))
    return atomic > 0n ? atomic : null
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) return null
  const atomic =
    BigInt(match[1]) * 1_000_000n +
    BigInt((match[2] ?? '').slice(0, 6).padEnd(6, '0'))
  return atomic > 0n ? atomic : null
}

/**
 * Link into the guided bridge. `source` is emitted only for a bridge source of
 * the current network — an Aave `lido` market or a Stellar row gets none rather
 * than a silent fallback to Base.
 */
export function bridgeHref(p: {
  amount?: string | number | null
  sourceSlug?: string | null
  productId?: string | null
}): string {
  const params = new URLSearchParams({ asset: 'USDC' })
  const atomic = p.amount == null ? null : flooredUsdcAtomic(p.amount)
  if (atomic !== null) params.set('amount', formatUsdcAmount(atomic))
  if (p.sourceSlug && cctpSourceChainBySlug(p.sourceSlug)) {
    params.set('source', p.sourceSlug)
  }
  if (p.productId) params.set('product', p.productId)
  return `${BRIDGE_PATH}?${params.toString()}`
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** The bridge page's query, keeping only what it can trust. */
export function parseBridgeParams(
  sp: Record<string, string | string[] | undefined>
): {
  amount: string | null
  /** An `amount` was in the link but could not be read: the page says so. */
  amountInvalid: boolean
  source: CctpSourceChain | null
  productId: string | null
} {
  let amount: string | null = null
  const rawAmount = first(sp.amount)
  if (rawAmount) {
    try {
      amount = formatUsdcAmount(parseUsdcAmount(rawAmount))
    } catch (e) {
      if (!(e instanceof BridgeAmountError)) throw e
    }
  }
  const slug = first(sp.source)
  const product = first(sp.product)?.trim()
  return {
    amount,
    amountInvalid: Boolean(rawAmount) && amount === null,
    source: slug ? cctpSourceChainBySlug(slug) : null,
    productId:
      product && product.length <= MAX_PRODUCT_ID_LENGTH ? product : null,
  }
}
