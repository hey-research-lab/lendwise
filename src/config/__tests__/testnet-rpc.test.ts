import { describe, expect, it } from 'vitest'

import { cctpConfig } from '@/lib/execution/cctp/config'

import { TESTNET_RPC_URLS, testnetTransport } from '../testnet-rpc'

describe('testnet RPCs', () => {
  const sourceChains = cctpConfig('testnet').sourceChains

  it('covers every testnet source chain of the bridge', () => {
    for (const chain of sourceChains) {
      expect(TESTNET_RPC_URLS[chain.chainId]?.length).toBeGreaterThan(0)
      expect(() => testnetTransport(chain.chainId)).not.toThrow()
    }
  })

  it('never uses keyless dRPC, which refuses Sepolia on its free plan', () => {
    for (const url of Object.values(TESTNET_RPC_URLS).flat()) {
      expect(url).toMatch(/^https:\/\//)
      expect(url).not.toContain('drpc.org')
    }
  })

  it('refuses a chain it has no RPC for', () => {
    expect(() => testnetTransport(1)).toThrow(/No public RPC/)
  })
})
