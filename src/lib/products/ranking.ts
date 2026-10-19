import { bridgeHref } from '@/lib/execution/cctp/deep-link'
import {
  CHAIN_BY_ID,
  type ChainFamily,
} from '@/lib/protocols/core/toolkit/chain-slugs'

/**
 * How the comparison tables and the optimizer rank products, for every chain
 * family alike (SCF #45 Tranche 3, deliverable 4).
 *
 * The ranking itself knows no chain: a Stellar adapter that writes the shared
 * rate tables is ranked next to Aave, Morpho and Compound by its rate alone.
 * The family only decides the row's ENTRY POINT — a Stellar USDC market is
 * reached by bridging USDC over CCTP, an EVM market through its protocol.
 */

export type ProductEntry =
  { kind: 'bridge'; href: string } | { kind: 'protocol' }

/** What ranking and entry points need from a Supply or Borrow table row. */
export interface RankableProduct {
  poolChainId: number
  assetSymbol: string
  productId?: string
}

/**
 * The row's chain family, from the chain registry. An unregistered chain id is
 * read as EVM: every non-EVM chain the pipeline ingests is registered there.
 */
export function chainFamilyOfProduct(
  p: Pick<RankableProduct, 'poolChainId'>
): ChainFamily {
  return CHAIN_BY_ID[p.poolChainId]?.family ?? 'evm'
}

/**
 * A Stellar USDC market is reached through the guided CCTP flow, with the
 * product pre-filled; anything else through its protocol. A non-USDC Stellar
 * row (XLM on Blend) keeps its protocol entry: CCTP moves USDC only.
 */
export function productEntry(p: RankableProduct): ProductEntry {
  if (chainFamilyOfProduct(p) === 'stellar' && p.assetSymbol === 'USDC') {
    return {
      kind: 'bridge',
      href: bridgeHref({ productId: p.productId ?? null }),
    }
  }
  return { kind: 'protocol' }
}

function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Rows ranked by the rate under `apyKey` — highest first by default (supply),
 * cheapest first with `order: 'asc'` (borrow). An unmeasured rate (undefined,
 * null, NaN) is ranked last in both orders: "we have not measured it" is not
 * "0 %". Ties go to the deeper market (`tvlKey`, descending), then to the
 * product id, so the order is stable from one render to the next.
 *
 * Returns a new array; the input is left as it was.
 */
export function rankProducts<T>(
  rows: readonly T[],
  opts: {
    apyKey: keyof T
    order?: 'desc' | 'asc'
    tvlKey?: keyof T
    idKey?: keyof T
  }
): T[] {
  const { apyKey, order = 'desc', tvlKey, idKey } = opts
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = measured(a.row[apyKey])
      const y = measured(b.row[apyKey])
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1
      } else if (x !== y) {
        return order === 'desc' ? y - x : x - y
      }
      if (tvlKey) {
        const depth =
          (measured(b.row[tvlKey]) ?? 0) - (measured(a.row[tvlKey]) ?? 0)
        if (depth !== 0) return depth
      }
      if (idKey) {
        const byId = String(a.row[idKey] ?? '').localeCompare(
          String(b.row[idKey] ?? '')
        )
        if (byId !== 0) return byId
      }
      return a.index - b.index
    })
    .map(({ row }) => row)
}
