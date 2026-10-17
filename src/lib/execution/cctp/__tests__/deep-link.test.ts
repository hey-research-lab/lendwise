import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BRIDGE_PATH,
  bridgeHref,
  flooredUsdcAtomic,
  parseBridgeParams,
} from '../deep-link'

afterEach(() => vi.unstubAllEnvs())

const query = (href: string) =>
  new URL(href, 'https://lendwise.fi').searchParams

describe('flooredUsdcAtomic', () => {
  it('floors to 6 decimals without rounding up, absorbing binary noise', () => {
    expect(flooredUsdcAtomic(1.005)).toBe(1_005_000n)
    expect(flooredUsdcAtomic('1.0000009')).toBe(1_000_000n)
  })

  it('returns null for zero or non-numeric input', () => {
    expect(flooredUsdcAtomic(0)).toBeNull()
    expect(flooredUsdcAtomic('abc')).toBeNull()
  })
})

describe('bridgeHref', () => {
  it('always targets USDC on the bridge page', () => {
    expect(bridgeHref({})).toBe(`${BRIDGE_PATH}?asset=USDC`)
  })

  it('floors a numeric amount to 6 decimals, never rounding up', () => {
    expect(query(bridgeHref({ amount: 12.3456789 })).get('amount')).toBe(
      '12.345678'
    )
    expect(query(bridgeHref({ amount: 1.005 })).get('amount')).toBe('1.005')
    expect(query(bridgeHref({ amount: '7.1234569' })).get('amount')).toBe(
      '7.123456'
    )
  })

  it('omits an amount that floors to zero or is not a number', () => {
    expect(query(bridgeHref({ amount: 1e-7 })).has('amount')).toBe(false)
    expect(query(bridgeHref({ amount: Number.NaN })).has('amount')).toBe(false)
    expect(query(bridgeHref({ amount: '1,5' })).has('amount')).toBe(false)
    expect(query(bridgeHref({ amount: -3 })).has('amount')).toBe(false)
  })

  it('emits source only for a supported chain of the current network', () => {
    expect(query(bridgeHref({ sourceSlug: 'base' })).get('source')).toBe('base')
    // Aave market slugs and Stellar rows: no silent fallback to base.
    for (const slug of ['lido', 'etherfi', 'horizon', 'stellar', 'polygon']) {
      expect(query(bridgeHref({ sourceSlug: slug })).has('source')).toBe(false)
    }
    vi.stubEnv('NEXT_PUBLIC_NETWORK', 'testnet')
    expect(query(bridgeHref({ sourceSlug: 'optimism' })).has('source')).toBe(
      false
    )
  })

  it('passes the product id through', () => {
    expect(
      query(bridgeHref({ productId: 'blend:v2.1:pool:usdc:supply' })).get(
        'product'
      )
    ).toBe('blend:v2.1:pool:usdc:supply')
  })
})

describe('parseBridgeParams', () => {
  it('reads a pre-filled link back', () => {
    const p = parseBridgeParams({
      asset: 'USDC',
      amount: '25.5',
      source: 'arbitrum',
      product: 'x',
    })
    expect(p.amount).toBe('25.5')
    expect(p.source?.chainId).toBe(42161)
    expect(p.productId).toBe('x')
  })

  it('drops what it cannot trust instead of guessing', () => {
    const p = parseBridgeParams({
      amount: '0.1234567',
      source: 'lido',
      product: 'p'.repeat(201),
    })
    expect(p).toEqual({
      amount: null,
      amountInvalid: true,
      source: null,
      productId: null,
    })
  })

  it('flags an amount it could not read, never a missing one', () => {
    expect(parseBridgeParams({ amount: '1,5' }).amountInvalid).toBe(true)
    expect(parseBridgeParams({}).amountInvalid).toBe(false)
    expect(parseBridgeParams({ amount: '25' }).amountInvalid).toBe(false)
  })

  it('takes the first value of a repeated parameter', () => {
    expect(parseBridgeParams({ amount: ['3', '4'] }).amount).toBe('3')
  })
})
