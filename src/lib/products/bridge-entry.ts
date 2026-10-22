import {
  MIN_BRIDGE_AMOUNT,
  formatUsdcAmount,
} from '@/lib/execution/cctp/amounts'
import { cctpSourceChainBySlug } from '@/lib/execution/cctp/config'
import { bridgeHref, flooredUsdcAtomic } from '@/lib/execution/cctp/deep-link'
import { chainSlugFor } from '@/lib/protocols/core/toolkit/chain-slugs'

import {
  type RankableProduct,
  chainFamilyOfProduct,
  productEntry,
} from './ranking'

/**
 * The "Bridge to Stellar" action of a table row — USDC rows only, since
 * CCTP moves USDC only.
 *
 *   - Stellar row: its bridge entry, with the product pre-filled, so the flow
 *     can name the venue as the next step.
 *   - EVM row: the bridge with the row's chain as source, only when that chain
 *     is a source of the bridge's menu. The chain comes from `poolChainId`, so
 *     an Aave `ethereum-lido` row starts from Ethereum; a Polygon row gets no
 *     action, since the bridge cannot take USDC from there.
 */
export function bridgeActionFor(p: RankableProduct): string | null {
  if (p.assetSymbol !== 'USDC') return null
  const entry = productEntry(p)
  if (entry.kind === 'bridge') return entry.href
  const chain = chainSlugFor(p.poolChainId)
  if (!chain || !cctpSourceChainBySlug(chain)) return null
  return bridgeHref({ sourceSlug: chain })
}

/** Whether the tables' Network filter currently includes Stellar. */
export function isStellarNetworkFiltered(
  filters: readonly { id: string; value: unknown }[]
): boolean {
  const network = filters.find((f) => f.id === 'network')?.value
  return Array.isArray(network)
    ? network.includes('stellar')
    : network === 'stellar'
}

/**
 * The bridge link of an optimizer allocation on a Stellar USDC venue, with the
 * allocated amount pre-filled, rounded DOWN to USDC's 6 decimals (never more
 * than the user put in). Null for an EVM venue, a non-USDC asset, a non-amount,
 * or an amount below the bridge minimum.
 */
export function allocationBridgeHref(
  p: RankableProduct,
  allocatedAmount: number
): { href: string; amount: string } | null {
  if (p.assetSymbol !== 'USDC' || chainFamilyOfProduct(p) !== 'stellar') {
    return null
  }
  const atomic = flooredUsdcAtomic(allocatedAmount)
  if (atomic === null || atomic < MIN_BRIDGE_AMOUNT) return null
  const amount = formatUsdcAmount(atomic)
  return {
    href: bridgeHref({ amount, productId: p.productId ?? null }),
    amount,
  }
}
