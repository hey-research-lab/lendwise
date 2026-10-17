import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchStellarHubbleHistory: vi.fn(),
  getBigQueryClient: vi.fn(),
}))

vi.mock('@/lib/bigquery/client', () => ({
  getBigQueryClient: mocks.getBigQueryClient,
}))
vi.mock('@/lib/protocols/stellar/hubble-history', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/protocols/stellar/hubble-history')
  >()),
  fetchStellarHubbleHistory: mocks.fetchStellarHubbleHistory,
}))

const { FIXTURE_POOL_ID, FIXTURE_USDC_ASSET_ID, isStellarYieldFixtureEnabled } =
  await import('./config')
const {
  FIXTURE_YIELD_PRODUCT_ID,
  FIXTURE_YIELD_SPOT,
  FIXTURE_YIELD_TARGET,
  stellarFixtureYieldAdapter,
} = await import('./yield')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBigQueryClient.mockReturnValue({ fake: 'bigquery' })
  mocks.fetchStellarHubbleHistory.mockResolvedValue({
    points: [],
    failures: [],
  })
})

describe('isStellarYieldFixtureEnabled', () => {
  it('is off without the variable', () => {
    expect(isStellarYieldFixtureEnabled({})).toBe(false)
  })

  it('is on with STELLAR_YIELD_FIXTURE=1 outside production', () => {
    expect(
      isStellarYieldFixtureEnabled({
        VERCEL_ENV: 'preview',
        STELLAR_YIELD_FIXTURE: '1',
      })
    ).toBe(true)
  })

  it('is off in production whatever the variable says', () => {
    expect(
      isStellarYieldFixtureEnabled({
        VERCEL_ENV: 'production',
        STELLAR_YIELD_FIXTURE: '1',
      })
    ).toBe(false)
  })

  it('accepts only "1"', () => {
    expect(
      isStellarYieldFixtureEnabled({ STELLAR_YIELD_FIXTURE: 'true' })
    ).toBe(false)
  })
})

describe('stellarFixtureYieldAdapter', () => {
  it('sits on the Blend v2.1 Fixed pool USDC reserve', () => {
    expect(FIXTURE_POOL_ID).toBe(
      'CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO'
    )
    expect(FIXTURE_USDC_ASSET_ID).toBe(
      'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
    )
  })

  it('lists one USDC supply product on Stellar, keyed stellar_fixture', async () => {
    const [product, ...rest] = await stellarFixtureYieldAdapter.getProducts()
    expect(rest).toEqual([])
    expect(product._id).toBe(FIXTURE_YIELD_PRODUCT_ID)
    expect(product.kind).toBe('supply')
    expect(product.asset).toEqual({
      symbol: 'USDC',
      name: 'USD Coin',
      address: FIXTURE_USDC_ASSET_ID,
      decimals: 7,
    })
    expect(product.protocol.chain).toEqual({ id: -1, name: 'stellar' })
    expect(product.protocol.meta).toEqual({
      poolId: FIXTURE_POOL_ID,
      assetId: FIXTURE_USDC_ASSET_ID,
      version: 'v2.1',
    })
    // from-catalogue.ts keys a row by `${provider}_${version}`.
    expect(`${product.protocol.provider}_${product.protocol.version}`).toBe(
      'stellar_fixture'
    )
  })

  it('lists nothing when asked for other chains only', async () => {
    expect(
      await stellarFixtureYieldAdapter.getProducts({ chainIds: [1] })
    ).toEqual([])
    expect(
      await stellarFixtureYieldAdapter.getApySpot({ chainIds: [1] })
    ).toEqual([])
  })

  it('serves a constant spot rate', async () => {
    const [spot] = await stellarFixtureYieldAdapter.getApySpot()
    expect(spot.productId).toBe(FIXTURE_YIELD_PRODUCT_ID)
    expect(spot.chainId).toBe(-1)
    expect(spot.asset).toBe('USDC')
    expect(spot.apy).toEqual({ ...FIXTURE_YIELD_SPOT, rewardItems: [] })
  })

  it('rebuilds its history through Hubble with the Blend decoder', async () => {
    const result = { points: [], failures: [] }
    mocks.fetchStellarHubbleHistory.mockResolvedValue(result)

    const out = await stellarFixtureYieldAdapter.getApyHistory!({
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_036_000,
      interval: 'HOUR',
      productIds: [FIXTURE_YIELD_PRODUCT_ID],
    })

    expect(out).toBe(result)
    expect(mocks.fetchStellarHubbleHistory).toHaveBeenCalledTimes(1)
    const call = mocks.fetchStellarHubbleHistory.mock.calls[0][0]
    expect(call.targets).toEqual([FIXTURE_YIELD_TARGET])
    expect(call.interval).toBe('HOUR')
    expect(call.startTimestamp).toBe(1_700_000_000)
    expect(call.endTimestamp).toBe(1_700_036_000)
    // The Blend decoder reads the pool back from the meta the fixture wrote.
    expect(call.decoder.contractId(FIXTURE_YIELD_TARGET)).toBe(FIXTURE_POOL_ID)
  })

  it('answers nothing for a request that does not name it', async () => {
    const out = await stellarFixtureYieldAdapter.getApyHistory!({
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_036_000,
      interval: 'HOUR',
      productIds: ['blend:v2.1:stellar:pool:x:y:supply'],
    })
    expect(out).toEqual({ points: [], failures: [] })
    expect(mocks.fetchStellarHubbleHistory).not.toHaveBeenCalled()
  })

  it('fails loudly without BigQuery credentials', async () => {
    mocks.getBigQueryClient.mockReturnValue(null)
    await expect(
      stellarFixtureYieldAdapter.getApyHistory!({
        startTimestamp: 1_700_000_000,
        endTimestamp: 1_700_036_000,
        interval: 'HOUR',
      })
    ).rejects.toThrow(/BigQuery client unavailable/)
  })
})
