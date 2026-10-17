import { describe, expect, it, vi } from 'vitest'

import { type PacedQueue, QueueFullError } from '@/lib/net/paced-queue'

import {
  BridgeFeeError,
  type FeeTierCache,
  fetchFeeTiers,
  planBridgeFee,
} from '../fees'

const QUOTE = [
  { finalityThreshold: 1000, minimumFee: 1.3 },
  { finalityThreshold: 2000, minimumFee: 0 },
]

describe('planBridgeFee', () => {
  it('takes Fast with a 20 % buffer over the quoted fee, rounded up', () => {
    const plan = planBridgeFee(100_000_000n, QUOTE) // 100 USDC
    expect(plan).toEqual({
      tier: 'fast',
      minFinalityThreshold: 1000,
      feeBps: 1.3,
      maxFee: 15_600n, // 100 × 1.3 bps × 1.2 = 0.0156 USDC
      minimumReceived: (100_000_000n - 15_600n) * 10n,
    })
  })

  it('rounds the maximum fee up, never down', () => {
    // 1.000001 USDC × 1.3 bps × 1.2 = 156.000156 micro-USDC
    expect(planBridgeFee(1_000_001n, QUOTE).maxFee).toBe(157n)
  })

  it('keeps the ceiling for quotes finer than 0.01 bps', () => {
    const q = (minimumFee: number) => [{ finalityThreshold: 1000, minimumFee }]
    expect(planBridgeFee(1_000_000_000n, q(0.004)).maxFee).toBe(480n)
    expect(planBridgeFee(1_000_000_000n, q(0.014)).maxFee).toBe(1_680n)
    expect(planBridgeFee(1_000_000_000n, q(1.234)).maxFee).toBe(148_080n)
    expect(planBridgeFee(1_000_000n, q(1.005)).maxFee).toBe(121n)
    expect(planBridgeFee(1_000_000n, q(1.4)).maxFee).toBe(168n)
  })

  it('falls back to Standard when Fast costs more than the ceiling', () => {
    const plan = planBridgeFee(100_000_000n, [
      { finalityThreshold: 1000, minimumFee: 6 },
      { finalityThreshold: 2000, minimumFee: 0 },
    ])
    expect(plan).toMatchObject({
      tier: 'standard',
      minFinalityThreshold: 2000,
      maxFee: 0n,
    })
    expect(plan.minimumReceived).toBe(1_000_000_000n)
  })

  it('honours a lower Fast ceiling', () => {
    expect(planBridgeFee(100_000_000n, QUOTE, { fastMaxFeeBps: 1 }).tier).toBe(
      'standard'
    )
  })

  it('takes Standard when the quote has no Fast tier', () => {
    expect(planBridgeFee(100_000_000n, [QUOTE[1]]).tier).toBe('standard')
  })

  it('applies the buffer to a non-zero Standard fee too', () => {
    const plan = planBridgeFee(100_000_000n, [
      { finalityThreshold: 2000, minimumFee: 0.5 },
    ])
    expect(plan.maxFee).toBe(6_000n)
  })

  it('ignores tiers with a negative or non-finite fee', () => {
    const plan = planBridgeFee(100_000_000n, [
      { finalityThreshold: 1000, minimumFee: Number.NaN },
      { finalityThreshold: 2000, minimumFee: 0 },
    ])
    expect(plan.tier).toBe('standard')
  })

  it('refuses a quote without any usable tier', () => {
    expect(() => planBridgeFee(100_000_000n, [])).toThrow(BridgeFeeError)
  })

  it('refuses a fee that would eat the whole amount', () => {
    try {
      planBridgeFee(1n, QUOTE)
      expect.unreachable()
    } catch (e) {
      expect((e as BridgeFeeError).code).toBe('fee-exceeds-amount')
    }
  })
})

describe('fetchFeeTiers', () => {
  it('asks Iris for the source → Stellar route and keeps well-formed tiers', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      Response.json([...QUOTE, { finalityThreshold: 'x', minimumFee: 1 }])
    )
    const tiers = await fetchFeeTiers(6, {
      irisBaseUrl: 'https://iris-api.circle.com',
      fetchFn: fetchFn as unknown as typeof fetch,
      cache: new Map(),
    })
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://iris-api.circle.com/v2/burn/USDC/fees/6/27'
    )
    expect(tiers).toEqual(QUOTE)
  })

  it('throws on an HTTP error, so no plan is built without a quote', async () => {
    const fetchFn = vi.fn(async () => new Response('busy', { status: 503 }))
    await expect(
      fetchFeeTiers(6, {
        irisBaseUrl: 'https://x',
        fetchFn: fetchFn as unknown as typeof fetch,
        cache: new Map(),
      })
    ).rejects.toThrow(/503/)
  })

  it('goes through the paced queue when one is given', async () => {
    let runs = 0
    const queue: PacedQueue = {
      run: (fn) => {
        runs += 1
        return fn()
      },
    }
    await fetchFeeTiers(6, {
      irisBaseUrl: 'https://x',
      fetchFn: (async () => Response.json(QUOTE)) as unknown as typeof fetch,
      queue,
      cache: new Map(),
    })
    expect(runs).toBe(1)
  })

  it('reports a full Iris queue as no fee tier, without calling Iris', async () => {
    const fetchFn = vi.fn()
    const full: PacedQueue = {
      run: () => Promise.reject(new QueueFullError(20)),
    }
    const quote = fetchFeeTiers(6, {
      irisBaseUrl: 'https://x',
      fetchFn: fetchFn as unknown as typeof fetch,
      queue: full,
      cache: new Map(),
    })
    await expect(quote).rejects.toBeInstanceOf(BridgeFeeError)
    await expect(quote).rejects.toMatchObject({ code: 'no-tier' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('fetchFeeTiers cache', () => {
  const MAINNET = 'https://iris-api.circle.com'
  const SANDBOX = 'https://iris-api-sandbox.circle.com'

  function setup() {
    let t = 1_000
    const fetchFn = vi.fn(async (_url: string) => Response.json(QUOTE))
    const cache: FeeTierCache = new Map()
    const deps = (irisBaseUrl = MAINNET) => ({
      irisBaseUrl,
      fetchFn: fetchFn as unknown as typeof fetch,
      cache,
      now: () => t,
    })
    return { fetchFn, deps, advance: (ms: number) => (t += ms) }
  }

  it('serves two quotes within 30 s from one Iris request', async () => {
    const { fetchFn, deps, advance } = setup()
    await fetchFeeTiers(6, deps())
    advance(29_999)
    expect(await fetchFeeTiers(6, deps())).toEqual(QUOTE)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('asks Iris again once 30 s have passed', async () => {
    const { fetchFn, deps, advance } = setup()
    await fetchFeeTiers(6, deps())
    advance(30_000)
    await fetchFeeTiers(6, deps())
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('shares one request between concurrent quotes', async () => {
    const { fetchFn, deps } = setup()
    await Promise.all([fetchFeeTiers(6, deps()), fetchFeeTiers(6, deps())])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('keeps source domains and Iris networks apart', async () => {
    const { fetchFn, deps } = setup()
    await fetchFeeTiers(6, deps(MAINNET))
    await fetchFeeTiers(3, deps(MAINNET))
    await fetchFeeTiers(6, deps(SANDBOX))
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      `${MAINNET}/v2/burn/USDC/fees/6/27`,
      `${MAINNET}/v2/burn/USDC/fees/3/27`,
      `${SANDBOX}/v2/burn/USDC/fees/6/27`,
    ])
  })

  it('does not keep a failed quote', async () => {
    const { fetchFn, deps } = setup()
    fetchFn.mockResolvedValueOnce(new Response('busy', { status: 503 }))
    await expect(fetchFeeTiers(6, deps())).rejects.toThrow(/503/)
    expect(await fetchFeeTiers(6, deps())).toEqual(QUOTE)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
