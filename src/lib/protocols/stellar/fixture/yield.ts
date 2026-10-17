import { Version } from '@blend-capital/blend-sdk'

import { getBigQueryClient } from '@/lib/bigquery/client'
import type { SpotPayload, SupplyProduct } from '@/lib/db/types'
import { blendHistoryDecoder } from '@/lib/protocols/blend/common/apy-history'
import { defineYieldAdapter } from '@/lib/protocols/core/define'
import { requestedProducts } from '@/lib/protocols/core/history-result'
import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'
import type {
  FetchOpts,
  HistoryParams,
  HistoryResult,
  HistoryTarget,
} from '@/lib/protocols/core/types'
import { fetchStellarHubbleHistory } from '@/lib/protocols/stellar/hubble-history'

import { FIXTURE_POOL_ID, FIXTURE_USDC_ASSET_ID } from './config'

/**
 * The yield face of the Stellar fixture (SCF #45 Tranche 3): a Stellar lending
 * venue registered through the same adapter contract as Blend, for the CI test
 * of the chain-family-aware ranking (deliverable 4) and the staging run of
 * reconcile (deliverable 5). The grant does not assume a live Stellar venue.
 *
 * One USDC supply product on the Blend v2.1 Fixed pool's USDC reserve. Its spot
 * rate is a documented constant, so the ranking test is deterministic; its
 * history is the reserve's real history, rebuilt from Hubble with Blend's
 * decoder, so the reconcile refetch path is exercised for real. Healed hours
 * therefore carry the reserve's real rates, not the constant — expected for a
 * fixture.
 *
 * Catalogue identity: provider 'stellar', version 'fixture', so
 * `adapterId(row)` is 'stellar_fixture'. Registered only when
 * `isStellarYieldFixtureEnabled()` (see `yieldAdapters` in
 * `@/config/protocols-server`), never in production.
 */
export const STELLAR_FIXTURE_YIELD_ID = 'stellar_fixture' as const
export const FIXTURE_YIELD_PROVIDER = 'stellar'
export const FIXTURE_YIELD_VERSION = 'fixture'

export const FIXTURE_YIELD_PRODUCT_ID = `stellar:fixture:stellar:reserve:${FIXTURE_POOL_ID.toLowerCase()}:${FIXTURE_USDC_ASSET_ID.toLowerCase()}:supply`

/** Constant spot rates, as fractions like every adapter's (0.075 = 7.5 %). */
export const FIXTURE_YIELD_SPOT = {
  base: 0.08,
  rewards: 0,
  fees: 0.005,
  net: 0.075,
} as const

/** Constant market state: deep enough to pass the tables' default TVL floor. */
export const FIXTURE_YIELD_MARKET = {
  supplyAssets: 2_500_000,
  supplyAssetsUsd: 2_500_000,
  utilizationRate: 0.6,
  assetPriceUsd: 1,
} as const

/** What `blendHistoryDecoder` reads back: the pool, the reserve, the storage version. */
const FIXTURE_META = {
  poolId: FIXTURE_POOL_ID,
  assetId: FIXTURE_USDC_ASSET_ID,
  version: 'v2.1',
}

export const FIXTURE_YIELD_TARGET: HistoryTarget = {
  productId: FIXTURE_YIELD_PRODUCT_ID,
  chainId: -1,
  kind: 'supply',
  meta: FIXTURE_META,
}

function servesStellar(opts?: FetchOpts): boolean {
  return !opts?.chainIds || opts.chainIds.includes(-1)
}

function fixtureProduct(now: Date): SupplyProduct {
  return {
    _id: FIXTURE_YIELD_PRODUCT_ID,
    kind: 'supply',
    protocol: {
      provider: FIXTURE_YIELD_PROVIDER,
      type: 'reserve',
      version: FIXTURE_YIELD_VERSION,
      subgraphUrl: '',
      name: 'Stellar fixture',
      chain: { id: -1, name: CHAIN_SLUG_MAP['-1'] },
      address: FIXTURE_POOL_ID,
      meta: { ...FIXTURE_META },
    },
    asset: {
      symbol: 'USDC',
      name: 'USD Coin',
      address: FIXTURE_USDC_ASSET_ID,
      decimals: 7,
    },
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

function fixtureSpot(): SpotPayload {
  return {
    productId: FIXTURE_YIELD_PRODUCT_ID,
    kind: 'supply',
    protocol: FIXTURE_YIELD_PROVIDER,
    chainId: -1,
    asset: 'USDC',
    apy: { ...FIXTURE_YIELD_SPOT, rewardItems: [] },
    market: { ...FIXTURE_YIELD_MARKET },
  }
}

async function fixtureHistory(params: HistoryParams): Promise<HistoryResult> {
  const requested = requestedProducts(params)
  if (requested && !requested.ids.has(FIXTURE_YIELD_PRODUCT_ID)) {
    return { points: [], failures: [] }
  }

  const client = getBigQueryClient()
  if (!client) {
    throw new Error(
      '[history:stellar_fixture] BigQuery client unavailable; set GCP_PROJECT and GCP_SERVICE_ACCOUNT_BASE64'
    )
  }

  return fetchStellarHubbleHistory({
    client,
    targets: [FIXTURE_YIELD_TARGET],
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    interval: params.interval,
    // Blend v2.1 runs the v2 pool contract (blend/common/deployments.ts).
    decoder: blendHistoryDecoder(Version.V2),
    onProgress: params.onProgress,
  })
}

export const stellarFixtureYieldAdapter = defineYieldAdapter({
  id: STELLAR_FIXTURE_YIELD_ID,
  name: 'Stellar fixture',
  provider: FIXTURE_YIELD_PROVIDER,
  version: FIXTURE_YIELD_VERSION,
  chains: {
    '-1': { slug: CHAIN_SLUG_MAP['-1'] },
  },
  getProducts: async (opts) =>
    servesStellar(opts) ? [fixtureProduct(new Date())] : [],
  getApySpot: async (opts) => (servesStellar(opts) ? [fixtureSpot()] : []),
  getApyHistory: fixtureHistory,
})
