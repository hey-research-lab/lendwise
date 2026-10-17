import { describe, expect, it } from 'vitest'

import { BRIDGE_PAUSED_MESSAGE, isBridgeEnabled } from '../kill-switch'

describe('isBridgeEnabled', () => {
  it('is on by default on testnet, and only "0" turns it off', () => {
    expect(isBridgeEnabled('testnet', {})).toBe(true)
    expect(isBridgeEnabled('testnet', { CCTP_BRIDGE_ENABLED: '' })).toBe(true)
    expect(isBridgeEnabled('testnet', { CCTP_BRIDGE_ENABLED: '1' })).toBe(true)
    expect(isBridgeEnabled('testnet', { CCTP_BRIDGE_ENABLED: '0' })).toBe(false)
    expect(isBridgeEnabled('testnet', { CCTP_BRIDGE_ENABLED: ' 0 ' })).toBe(
      false
    )
  })

  it('is off by default on mainnet, and only "1" turns it on', () => {
    expect(isBridgeEnabled('mainnet', {})).toBe(false)
    expect(isBridgeEnabled('mainnet', { CCTP_BRIDGE_ENABLED: '' })).toBe(false)
    expect(isBridgeEnabled('mainnet', { CCTP_BRIDGE_ENABLED: '0' })).toBe(false)
    expect(isBridgeEnabled('mainnet', { CCTP_BRIDGE_ENABLED: 'true' })).toBe(
      false
    )
    expect(isBridgeEnabled('mainnet', { CCTP_BRIDGE_ENABLED: '1' })).toBe(true)
    expect(isBridgeEnabled('mainnet', { CCTP_BRIDGE_ENABLED: ' 1 ' })).toBe(
      true
    )
  })

  it('tells the user that transfers in progress can still be finished', () => {
    expect(BRIDGE_PAUSED_MESSAGE).toBe(
      'The bridge is paused. Transfers in progress can still be finished here.'
    )
  })
})
