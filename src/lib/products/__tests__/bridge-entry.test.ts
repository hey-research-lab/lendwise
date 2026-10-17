import { describe, expect, it } from 'vitest'

import { bridgeHref } from '@/lib/execution/cctp/deep-link'
import {
  allocationBridgeHref,
  bridgeActionFor,
  isStellarNetworkFiltered,
} from '@/lib/products/bridge-entry'

const STELLAR_USDC = {
  poolChainId: -1,
  network: 'stellar',
  assetSymbol: 'USDC',
  productId: 'blend:v2.1:stellar:pool:p:usdc:supply',
}

describe('bridgeActionFor', () => {
  it('sends a Stellar USDC row to the bridge with its product', () => {
    expect(bridgeActionFor(STELLAR_USDC)).toBe(
      bridgeHref({ productId: STELLAR_USDC.productId })
    )
  })

  it('sends an EVM USDC row on a CCTP source chain with its chain as source', () => {
    const href = bridgeActionFor({
      poolChainId: 8453,
      network: 'base',
      assetSymbol: 'USDC',
    })
    expect(href).toBe(bridgeHref({ sourceSlug: 'base' }))
    expect(href).toContain('source=base')
  })

  it('never falls back to a source for a network CCTP does not serve', () => {
    for (const network of ['lido', 'etherfi', 'horizon', 'polygon']) {
      const href = bridgeActionFor({
        poolChainId: 1,
        network,
        assetSymbol: 'USDC',
      })
      expect(href).not.toBeNull()
      expect(href).not.toContain('source=')
    }
  })

  it('offers nothing for an asset the bridge does not carry', () => {
    expect(
      bridgeActionFor({
        poolChainId: 1,
        network: 'ethereum',
        assetSymbol: 'WETH',
      })
    ).toBeNull()
    expect(
      bridgeActionFor({
        poolChainId: -1,
        network: 'stellar',
        assetSymbol: 'XLM',
      })
    ).toBeNull()
  })
})

describe('isStellarNetworkFiltered', () => {
  it('is true when the network filter includes Stellar', () => {
    expect(
      isStellarNetworkFiltered([{ id: 'network', value: ['stellar', 'base'] }])
    ).toBe(true)
    expect(
      isStellarNetworkFiltered([{ id: 'network', value: 'stellar' }])
    ).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isStellarNetworkFiltered([])).toBe(false)
    expect(isStellarNetworkFiltered([{ id: 'network', value: ['base'] }])).toBe(
      false
    )
    expect(
      isStellarNetworkFiltered([{ id: 'assetSymbol', value: 'USDC' }])
    ).toBe(false)
  })
})

describe('allocationBridgeHref', () => {
  it('pre-fills the amount allocated to a Stellar USDC venue', () => {
    expect(allocationBridgeHref(STELLAR_USDC, 375)).toEqual({
      amount: '375',
      href: bridgeHref({ amount: '375', productId: STELLAR_USDC.productId }),
    })
  })

  it('rounds the amount down to USDC precision', () => {
    expect(allocationBridgeHref(STELLAR_USDC, 12.3456789)?.amount).toBe(
      '12.345678'
    )
  })

  it('keeps an exactly representable-looking amount whole', () => {
    expect(allocationBridgeHref(STELLAR_USDC, 1.005)?.amount).toBe('1.005')
  })

  it('offers nothing below the bridge minimum or for a non-amount', () => {
    expect(allocationBridgeHref(STELLAR_USDC, 0.99)).toBeNull()
    expect(allocationBridgeHref(STELLAR_USDC, 0)).toBeNull()
    expect(allocationBridgeHref(STELLAR_USDC, Number.NaN)).toBeNull()
  })

  it('offers nothing for an EVM venue or a non-USDC Stellar venue', () => {
    expect(
      allocationBridgeHref({ poolChainId: 8453, assetSymbol: 'USDC' }, 500)
    ).toBeNull()
    expect(
      allocationBridgeHref({ poolChainId: -1, assetSymbol: 'XLM' }, 500)
    ).toBeNull()
  })
})
