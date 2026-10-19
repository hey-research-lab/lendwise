import { type PacedQueue, QueueFullError } from '@/lib/net/paced-queue'

import { evmToStellarAtomic } from './amounts'
import { FINALITY_THRESHOLD, STELLAR_CCTP_DOMAIN } from './config'

/** One row of Circle's `GET /v2/burn/USDC/fees/{src}/{dst}`; the fee is in basis points. */
export interface IrisFeeTier {
  finalityThreshold: number
  minimumFee: number
}

export interface BridgeFeePlan {
  tier: 'fast' | 'standard'
  minFinalityThreshold: 1000 | 2000
  feeBps: number
  /** EVM atomic units (6 decimals). */
  maxFee: bigint
  /** Stellar atomic units (7 decimals): what reaches the wallet if the whole maxFee is charged. */
  minimumReceived: bigint
}

/** Above this, Fast is not worth it and the transfer goes Standard. */
export const DEFAULT_FAST_MAX_FEE_BPS = 5

/** Circle advises 10–20 % above the quote: the burn reverts when the fee exceeds maxFee. */
const FEE_BUFFER_PERCENT = 120n

export class BridgeFeeError extends Error {
  constructor(
    public code: 'no-tier' | 'fee-exceeds-amount',
    message: string
  ) {
    super(message)
    this.name = 'BridgeFeeError'
  }
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

/**
 * amount × bps × 1.2 / 10 000, rounded up. bps is scaled to 1e-6 (the round absorbs
 * float noise), so the ceiling holds for any quote down to a millionth of a bps.
 */
function bufferedFee(amount: bigint, bps: number): bigint {
  const microBps = BigInt(Math.round(bps * 1_000_000))
  return ceilDiv(
    amount * microBps * FEE_BUFFER_PERCENT,
    10_000n * 1_000_000n * 100n
  )
}

function usable(t: IrisFeeTier): boolean {
  return Number.isFinite(t.minimumFee) && t.minimumFee >= 0
}

export function planBridgeFee(
  amount: bigint,
  tiers: IrisFeeTier[],
  opts: { fastMaxFeeBps?: number } = {}
): BridgeFeePlan {
  const fastMax = opts.fastMaxFeeBps ?? DEFAULT_FAST_MAX_FEE_BPS
  const fast = tiers.find(
    (t) => t.finalityThreshold === FINALITY_THRESHOLD.fast && usable(t)
  )
  const standard = tiers.find(
    (t) => t.finalityThreshold === FINALITY_THRESHOLD.standard && usable(t)
  )
  const chosen =
    fast && fast.minimumFee <= fastMax
      ? { tier: 'fast' as const, row: fast }
      : standard
        ? { tier: 'standard' as const, row: standard }
        : null
  if (!chosen) {
    throw new BridgeFeeError(
      'no-tier',
      'Circle returned no usable fee tier for this route'
    )
  }
  const maxFee = bufferedFee(amount, chosen.row.minimumFee)
  if (maxFee >= amount) {
    throw new BridgeFeeError(
      'fee-exceeds-amount',
      'The transfer fee would take the whole amount'
    )
  }
  return {
    tier: chosen.tier,
    minFinalityThreshold:
      chosen.tier === 'fast'
        ? FINALITY_THRESHOLD.fast
        : FINALITY_THRESHOLD.standard,
    feeBps: chosen.row.minimumFee,
    maxFee,
    minimumReceived: evmToStellarAtomic(amount - maxFee),
  }
}

/** How long one Iris fee quote serves every quote of the same route. */
export const FEE_TIERS_TTL_MS = 30_000

/** Key `<Iris base URL>|<source domain>`; the promise is shared by concurrent quotes. */
export type FeeTierCache = Map<
  string,
  { at: number; tiers: Promise<IrisFeeTier[]> }
>

// One per process, like irisQueue: every quote served by this instance shares it.
const feeTierCache: FeeTierCache = new Map()

interface FeeTierDeps {
  irisBaseUrl: string
  fetchFn?: typeof fetch
  queue?: PacedQueue
}

/**
 * Circle's fee quote for `sourceDomain` → Stellar. Throws rather than plan
 * without one. A quote is reused for 30 s, so a burst of quotes costs one
 * Iris request per route. The Iris base URL is part of the key: testnet and
 * mainnet quotes never mix. A failure is not kept.
 */
export function fetchFeeTiers(
  sourceDomain: number,
  deps: FeeTierDeps & { cache?: FeeTierCache; now?: () => number }
): Promise<IrisFeeTier[]> {
  const cache = deps.cache ?? feeTierCache
  const now = (deps.now ?? Date.now)()
  const key = `${deps.irisBaseUrl}|${sourceDomain}`
  const hit = cache.get(key)
  if (hit && now - hit.at < FEE_TIERS_TTL_MS) return hit.tiers
  const entry = { at: now, tiers: requestFeeTiers(sourceDomain, deps) }
  cache.set(key, entry)
  entry.tiers.catch(() => {
    if (cache.get(key) === entry) cache.delete(key)
  })
  return entry.tiers
}

async function requestFeeTiers(
  sourceDomain: number,
  deps: FeeTierDeps
): Promise<IrisFeeTier[]> {
  const fetchFn = deps.fetchFn ?? fetch
  const url = `${deps.irisBaseUrl}/v2/burn/USDC/fees/${sourceDomain}/${STELLAR_CCTP_DOMAIN}`
  const call = () =>
    fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  let res: Response
  try {
    res = await (deps.queue ? deps.queue.run(call) : call())
  } catch (err) {
    // The Iris queue is full: no quote right now, the user tries again.
    if (err instanceof QueueFullError)
      throw new BridgeFeeError('no-tier', 'The Iris queue is full')
    throw err
  }
  if (!res.ok) throw new Error(`Circle fee quote failed: HTTP ${res.status}`)
  const body: unknown = await res.json()
  if (!Array.isArray(body)) throw new Error('Circle fee quote is not a list')
  return body.flatMap((t: unknown): IrisFeeTier[] => {
    const row = t as Partial<IrisFeeTier> | null
    return typeof row?.finalityThreshold === 'number' &&
      typeof row?.minimumFee === 'number'
      ? [
          {
            finalityThreshold: row.finalityThreshold,
            minimumFee: row.minimumFee,
          },
        ]
      : []
  })
}
