import { describe, expect, it } from 'vitest'

import type { BridgeQuote } from '@/lib/execution/cctp/view'

import {
  detailsSummary,
  isUsdcAmount,
  maxAmount,
  receiveText,
  stellarUsdcBalance,
  trimBalance,
  usdText,
} from './amount-view'

const fast: BridgeQuote = {
  sourceChainId: 84532,
  amount: '2',
  tier: 'fast',
  feeBps: 1.3,
  maxFee: '0.000312',
  minimumReceived: '1.999688',
  cap: null,
}

describe('isUsdcAmount', () => {
  it.each([
    ['2', true],
    ['2.5', true],
    ['0.000001', true],
    ['0', false],
    ['1,5', false],
    ['1.1234567', false],
    ['', false],
    ['-1', false],
  ])('%s → %s', (input, expected) => {
    expect(isUsdcAmount(input)).toBe(expected)
  })
})

describe('receiveText', () => {
  it('shows the minimum received, or a dash without a quote', () => {
    expect(receiveText(fast)).toBe('≥ 1.999688')
    expect(receiveText(null)).toBe('—')
  })
})

describe('usdText', () => {
  it('counts USDC one for one, with two decimals', () => {
    expect(usdText('2')).toBe('≈ $2.00')
    expect(usdText('1234.5')).toBe('≈ $1,234.50')
  })

  it('is empty for an empty or unreadable amount', () => {
    expect(usdText('')).toBe('')
    expect(usdText(null)).toBe('')
    expect(usdText('abc')).toBe('')
  })
})

describe('maxAmount', () => {
  it('fills the balance, capped by the per-transfer cap', () => {
    expect(maxAmount(18_000_000n, null)).toBe('18')
    expect(maxAmount(18_000_000n, 10_000_000n)).toBe('10')
    expect(maxAmount(5_000_000n, 10_000_000n)).toBe('5')
  })

  it('has nothing to fill without a balance', () => {
    expect(maxAmount(null, null)).toBeNull()
    expect(maxAmount(0n, 10_000_000n)).toBeNull()
  })
})

describe('Stellar balance', () => {
  it('drops the trailing zeros of a Horizon amount', () => {
    expect(trimBalance('2.9996400')).toBe('2.99964')
    expect(trimBalance('0.0000000')).toBe('0')
    expect(trimBalance('12')).toBe('12')
  })

  it("reads the trustline's balance, 0 without one, null without a check", () => {
    expect(stellarUsdcBalance(null)).toBeNull()
    expect(stellarUsdcBalance({ trustline: null })).toBe('0')
    expect(stellarUsdcBalance({ trustline: { balance: '1.5000000' } })).toBe(
      '1.5'
    )
  })
})

describe('detailsSummary', () => {
  it('folds speed and fee into one line', () => {
    expect(detailsSummary(fast)).toBe('Fast · ~1 min · fee ≤ 0.000312 USDC')
    expect(
      detailsSummary({ ...fast, tier: 'standard', feeBps: 0, maxFee: '0' })
    ).toBe('Standard · up to ~20 min · no fee')
  })
})
