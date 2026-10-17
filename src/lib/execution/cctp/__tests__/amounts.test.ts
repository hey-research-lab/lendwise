import { describe, expect, it } from 'vitest'

import {
  BridgeAmountError,
  MIN_BRIDGE_AMOUNT,
  assertBridgeAmount,
  evmToStellarAtomic,
  formatStellarAmount,
  formatUsdcAmount,
  maxBridgeAmount,
  parseUsdcAmount,
} from '../amounts'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof BridgeAmountError ? e.code : 'other'
  }
  return undefined
}

describe('parseUsdcAmount', () => {
  it('parses whole and fractional amounts to 6-decimal atomic units', () => {
    expect(parseUsdcAmount('25')).toBe(25_000_000n)
    expect(parseUsdcAmount(' 25.5 ')).toBe(25_500_000n)
    expect(parseUsdcAmount('0.000001')).toBe(1n)
  })

  it('refuses a locale comma, signs, exponents and empty input as a format error', () => {
    expect(codeOf(() => parseUsdcAmount('1,5'))).toBe('format')
    expect(codeOf(() => parseUsdcAmount('-1'))).toBe('format')
    expect(codeOf(() => parseUsdcAmount('1e3'))).toBe('format')
    expect(codeOf(() => parseUsdcAmount(''))).toBe('format')
    expect(codeOf(() => parseUsdcAmount('.5'))).toBe('format')
  })

  it('refuses a seventh decimal instead of rounding it', () => {
    expect(codeOf(() => parseUsdcAmount('0.1234567'))).toBe('decimals')
  })

  it('refuses zero', () => {
    expect(codeOf(() => parseUsdcAmount('0.000000'))).toBe('non-positive')
  })
})

describe('formatting and rescaling', () => {
  it('formats without trailing zeros', () => {
    expect(formatUsdcAmount(25_500_000n)).toBe('25.5')
    expect(formatUsdcAmount(25_000_000n)).toBe('25')
    expect(formatUsdcAmount(1n)).toBe('0.000001')
    expect(formatStellarAmount(255_000_001n)).toBe('25.5000001')
  })

  it('rescales EVM 6-decimal USDC to Stellar 7-decimal USDC by ×10', () => {
    expect(evmToStellarAtomic(25_500_000n)).toBe(255_000_000n)
  })
})

describe('bridge amount bounds', () => {
  it('caps mainnet at 1,000 USDC by default and testnet not at all', () => {
    expect(maxBridgeAmount('mainnet', {})).toBe(1_000_000_000n)
    expect(maxBridgeAmount('testnet', { CCTP_MAX_AMOUNT_USDC: '5' })).toBeNull()
  })

  it('reads CCTP_MAX_AMOUNT_USDC and falls back to the default when it is malformed', () => {
    expect(maxBridgeAmount('mainnet', { CCTP_MAX_AMOUNT_USDC: '250' })).toBe(
      250_000_000n
    )
    expect(maxBridgeAmount('mainnet', { CCTP_MAX_AMOUNT_USDC: 'lots' })).toBe(
      1_000_000_000n
    )
  })

  it('refuses below 1 USDC and above the cap', () => {
    expect(
      codeOf(() => assertBridgeAmount(MIN_BRIDGE_AMOUNT - 1n, 'testnet', {}))
    ).toBe('below-minimum')
    expect(
      codeOf(() => assertBridgeAmount(1_000_000_001n, 'mainnet', {}))
    ).toBe('above-cap')
    expect(
      codeOf(() => assertBridgeAmount(1_000_000_000n, 'mainnet', {}))
    ).toBeUndefined()
    expect(
      codeOf(() => assertBridgeAmount(5_000_000_000n, 'testnet', {}))
    ).toBeUndefined()
  })
})
