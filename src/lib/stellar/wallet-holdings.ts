import { stellarNetwork } from '@/config/stellar-network'
import { stellarHorizonUrl } from '@/config/stellar-network.server'
import { latestPrice } from '@/lib/db/repositories/price'
import type { WalletHolding } from '@/lib/portfolio/types'

/** Circle's USDC on Stellar mainnet — the only USDC priced as USDC. */
export const CIRCLE_USDC_ISSUER =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

export interface HorizonBalance {
  balance: string
  asset_type: string
  asset_code?: string
  asset_issuer?: string
}

/** Longest a Horizon account read may take before it fails. */
export const HORIZON_TIMEOUT_MS = 8_000

function horizonUrl(): string {
  return stellarHorizonUrl()
}

/** An unfunded account (404) holds nothing; any other failure throws. */
export async function fetchHorizonBalances(
  address: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = HORIZON_TIMEOUT_MS
): Promise<HorizonBalance[]> {
  const res = await fetchImpl(`${horizonUrl()}/accounts/${address}`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Horizon ${res.status} for ${address}`)
  const body = (await res.json()) as { balances?: HorizonBalance[] }
  return body.balances ?? []
}

export function holdingsFromBalances(
  owner: string,
  balances: HorizonBalance[]
): WalletHolding[] {
  return balances.flatMap((b): WalletHolding[] => {
    const base = {
      chainFamily: 'stellar' as const,
      network: 'stellar',
      owner,
      balance: Number(b.balance),
      priceUsd: null,
      valueUsd: null,
    }
    if (b.asset_type === 'native') {
      return [{ ...base, assetType: 'native', code: 'XLM', issuer: null }]
    }
    if (
      (b.asset_type === 'credit_alphanum4' ||
        b.asset_type === 'credit_alphanum12') &&
      b.asset_code
    ) {
      return [
        {
          ...base,
          assetType: 'credit',
          code: b.asset_code,
          issuer: b.asset_issuer ?? null,
        },
      ]
    }
    return []
  })
}

function priceSymbol(h: WalletHolding): string | null {
  if (h.assetType === 'native') return 'XLM'
  // Circle's USDC of the deployment's network; testnet USDC is priced as USDC.
  if (h.code === 'USDC' && h.issuer === stellarNetwork().usdc.issuer) {
    return 'USDC'
  }
  return null
}

/** Native XLM and every trustline of each address, USD-valued where we know the price. */
export async function getStellarWalletHoldings(
  addresses: string[],
  deps: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
    price?: (symbol: string) => Promise<number | null>
  } = {}
): Promise<WalletHolding[]> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const price = deps.price ?? latestPrice

  const holdings = (
    await Promise.all(
      addresses.map(async (a) =>
        holdingsFromBalances(
          a,
          await fetchHorizonBalances(a, fetchImpl, deps.timeoutMs)
        )
      )
    )
  ).flat()

  const symbols = [
    ...new Set(holdings.map(priceSymbol).filter((s): s is string => s != null)),
  ]
  const prices = new Map<string, number | null>()
  await Promise.all(
    symbols.map(async (s) => {
      prices.set(s, await price(s).catch(() => null))
    })
  )

  return holdings.map((h) => {
    const symbol = priceSymbol(h)
    const p = symbol ? (prices.get(symbol) ?? null) : null
    return { ...h, priceUsd: p, valueUsd: p == null ? null : h.balance * p }
  })
}
