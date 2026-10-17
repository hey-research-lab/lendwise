import { buildProductId } from '@/lib/protocols/blend/common/utils'
import { toBaseUnits } from '@/lib/protocols/core/toolkit/units'
import type { StellarPositionsAdapter } from '@/lib/protocols/core/types'
import { resolveRiskPrices } from '@/lib/risk/prices'
import {
  type PriceKey,
  type PriceMap,
  type RiskAccount,
  priceKeyId,
  riskAccountId,
} from '@/lib/risk/types'
import type { BorrowPosition, SupplyPosition } from '@/types'

import { FIXTURE_POOL_ID } from './config'

/**
 * Staging fixture for SCF #45 Tranche 2: known positions and per-reserve risk
 * weights for ONE configured Stellar address, registered through the same
 * adapter contract as Blend. Its prices are the real ones of the Blend v2.1
 * Fixed pool, read from the spot pipeline — removing one from the map
 * (RISK_DROP_PRICE_KEYS) shows the "unknown" state.
 */
export const FIXTURE_PROTOCOL = 'stellar_fixture' as const
export { FIXTURE_POOL_ID }
const CHAIN_ID = -1

export const FIXTURE_RESERVES = [
  {
    assetId: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    symbol: 'XLM',
    name: 'Stellar Lumens',
    collateral: 10_000,
    liability: 0,
    collateralWeight: 0.75,
    liabilityWeight: null,
  },
  {
    assetId: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    symbol: 'USDC',
    name: 'USD Coin',
    collateral: 0,
    liability: 1_000,
    collateralWeight: null,
    liabilityWeight: 0.95,
  },
] as const

export function fixturePriceKey(assetId: string): PriceKey {
  return {
    productId: buildProductId({
      poolId: FIXTURE_POOL_ID,
      assetId,
      kind: 'supply',
      version: 'v2.1',
    }),
    leg: 'asset',
  }
}

export function fixtureRiskAccount(address: string): RiskAccount {
  return {
    id: riskAccountId({
      protocol: FIXTURE_PROTOCOL,
      chainId: CHAIN_ID,
      poolId: FIXTURE_POOL_ID,
      user: address,
    }),
    protocol: FIXTURE_PROTOCOL,
    chainFamily: 'stellar',
    chainId: CHAIN_ID,
    poolId: FIXTURE_POOL_ID,
    user: address,
    reserves: FIXTURE_RESERVES.map((r) => ({
      priceKey: fixturePriceKey(r.assetId),
      symbol: r.symbol,
      collateral: r.collateral,
      liability: r.liability,
      collateralWeight: r.collateralWeight,
      liabilityWeight: r.liabilityWeight,
    })),
  }
}

const usd = (assetId: string, amount: number, prices: PriceMap) =>
  amount * (prices.get(priceKeyId(fixturePriceKey(assetId))) ?? 0)

const common = (address: string) => ({
  protocol: FIXTURE_PROTOCOL,
  network: 'stellar',
  userAddress: address,
  poolName: 'Stellar fixture (Fixed v2.1 prices)',
  poolAddress: FIXTURE_POOL_ID,
  poolId: FIXTURE_POOL_ID,
  poolChainId: CHAIN_ID,
})

export function createStellarFixtureAdapter(
  address: string,
  resolve: (keys: PriceKey[]) => Promise<PriceMap> = resolveRiskPrices
): StellarPositionsAdapter {
  const served = (addresses: string[]) => addresses.includes(address)
  const prices = () =>
    resolve(FIXTURE_RESERVES.map((r) => fixturePriceKey(r.assetId)))

  return {
    async getUserSupplyPositions({ addresses }) {
      if (!served(addresses)) return []
      const p = await prices()
      return FIXTURE_RESERVES.filter((r) => r.collateral > 0).map(
        (r): SupplyPosition => ({
          ...common(address),
          id: `${FIXTURE_PROTOCOL}:${address}:${r.assetId}:supply`,
          assetAddress: r.assetId,
          assetName: r.name,
          assetSymbol: r.symbol,
          assetDecimals: 7,
          assetAmount: toBaseUnits(r.collateral, 7),
          assetAmountUsd: usd(r.assetId, r.collateral, p),
          assetLiveAmountUsd: usd(r.assetId, r.collateral, p),
          apy: 0,
        })
      )
    },
    async getUserBorrowPositions({ addresses }) {
      if (!served(addresses)) return []
      const p = await prices()
      const collaterals = FIXTURE_RESERVES.filter((r) => r.collateral > 0).map(
        (r) => ({
          address: r.assetId,
          name: r.name,
          symbol: r.symbol,
          decimals: 7,
          lltv: r.collateralWeight,
          amount: r.collateral,
          amountUsd: usd(r.assetId, r.collateral, p),
        })
      )
      return FIXTURE_RESERVES.filter((r) => r.liability > 0).map(
        (r): BorrowPosition => ({
          ...common(address),
          id: `${FIXTURE_PROTOCOL}:${address}:${r.assetId}:borrow`,
          healthFactor: 0,
          loanAssetAddress: r.assetId,
          loanAssetName: r.name,
          loanAssetSymbol: r.symbol,
          loanAssetDecimals: 7,
          loanAssetAmount: r.liability,
          loanAssetAmountUsd: usd(r.assetId, r.liability, p),
          loanLiveAssetAmountUsd: usd(r.assetId, r.liability, p),
          loanTimestamp: 0,
          collaterals,
          apy: 0,
          riskAccountId: fixtureRiskAccount(address).id,
        })
      )
    },
    async getRiskAccounts({ addresses }) {
      return served(addresses) ? [fixtureRiskAccount(address)] : []
    },
  }
}
