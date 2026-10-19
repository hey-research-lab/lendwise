import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CIRCLE_USDC_ISSUER,
  HORIZON_TIMEOUT_MS,
  type HorizonBalance,
  getStellarWalletHoldings,
  holdingsFromBalances,
} from './wallet-holdings'

vi.mock('@/lib/db/repositories/price', () => ({ latestPrice: vi.fn() }))

const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

const balances: HorizonBalance[] = [
  { balance: '120.5000000', asset_type: 'native' },
  {
    balance: '42.0000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: CIRCLE_USDC_ISSUER,
  },
  {
    balance: '7.0000000',
    asset_type: 'credit_alphanum12',
    asset_code: 'AQUARIUS',
    asset_issuer: 'GISSUER',
  },
  { balance: '3.0000000', asset_type: 'liquidity_pool_shares' },
]

const respond = (status: number, body: unknown) =>
  vi.fn(
    async () => new Response(JSON.stringify(body), { status })
  ) as unknown as typeof fetch

describe('holdingsFromBalances', () => {
  it('tags every holding as a Stellar holding', () => {
    for (const h of holdingsFromBalances(G, balances)) {
      expect(h.chainFamily).toBe('stellar')
      expect(h.network).toBe('stellar')
    }
  })

  it('keeps XLM and every trustline, and skips pool shares', () => {
    expect(
      holdingsFromBalances(G, balances).map((h) => [h.code, h.balance])
    ).toEqual([
      ['XLM', 120.5],
      ['USDC', 42],
      ['AQUARIUS', 7],
    ])
  })
})

describe('getStellarWalletHoldings', () => {
  it('prices XLM and Circle USDC, leaves the rest unpriced', async () => {
    const price = vi.fn(async (symbol: string) => (symbol === 'XLM' ? 0.3 : 1))
    const holdings = await getStellarWalletHoldings([G], {
      fetchImpl: respond(200, { balances }),
      price,
    })
    expect(holdings.map((h) => [h.code, h.valueUsd])).toEqual([
      ['XLM', 120.5 * 0.3],
      ['USDC', 42],
      ['AQUARIUS', null],
    ])
    expect(price).toHaveBeenCalledTimes(2)
  })

  it('treats an unfunded account (404) as empty', async () => {
    expect(
      await getStellarWalletHoldings([G], {
        fetchImpl: respond(404, {}),
        price: vi.fn(),
      })
    ).toEqual([])
  })

  it('rejects when Horizon fails', async () => {
    await expect(
      getStellarWalletHoldings([G], {
        fetchImpl: respond(503, {}),
        price: vi.fn(),
      })
    ).rejects.toThrow('Horizon 503')
  })

  it('passes an abort signal and rejects when Horizon never answers', async () => {
    expect(HORIZON_TIMEOUT_MS).toBe(8_000)
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          )
        })
    ) as unknown as typeof fetch
    await expect(
      getStellarWalletHoldings([G], {
        fetchImpl,
        timeoutMs: 20,
        price: vi.fn(),
      })
    ).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(G),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('keeps balances when a price lookup throws', async () => {
    const holdings = await getStellarWalletHoldings([G], {
      fetchImpl: respond(200, { balances: [balances[0]] }),
      price: async () => {
        throw new Error('db down')
      },
    })
    expect(holdings[0]).toMatchObject({
      code: 'XLM',
      balance: 120.5,
      valueUsd: null,
    })
  })
})

describe('getStellarWalletHoldings on a testnet deployment', () => {
  const TESTNET_USDC_ISSUER =
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_NETWORK
  })

  it('reads testnet Horizon and prices Circle testnet USDC as USDC', async () => {
    process.env.NEXT_PUBLIC_NETWORK = 'testnet'
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            balances: [
              {
                balance: '10.0000000',
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                asset_issuer: TESTNET_USDC_ISSUER,
              },
            ],
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch

    const [usdc] = await getStellarWalletHoldings([G], {
      fetchImpl,
      price: async (s) => (s === 'USDC' ? 1 : null),
    })

    expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toBe(
      `https://horizon-testnet.stellar.org/accounts/${G}`
    )
    expect(usdc.priceUsd).toBe(1)
    expect(usdc.valueUsd).toBe(10)
  })
})
