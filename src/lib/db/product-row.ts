import type { Product } from '@/lib/db/types'

/**
 * A fetched Product document → its `products` row. Pure — no database import —
 * so the catalogue → table path can be tested end to end without one.
 */
export function productToRow(p: Product) {
  return {
    id: p._id,
    active: p.active ?? true,
    kind: p.kind,
    provider: p.protocol.provider,
    productType: p.protocol.type,
    version: p.protocol.version,
    protocolName: p.protocol.name,
    chainId: p.protocol.chain.id,
    chainName: p.protocol.chain.name,
    assetSymbol: p.asset.symbol,
    assetName: p.asset.name,
    assetAddress: p.asset.address,
    assetDecimals: p.asset.decimals,
    protocolAddress: p.protocol.address,
    subgraphUrl: p.protocol.subgraphUrl ?? null,
    meta: p.protocol.meta,
    collaterals: 'collaterals' in p ? p.collaterals : null,
    createdAt: p.createdAt ?? new Date(),
    updatedAt: new Date(),
  }
}
