import { beforeAll, describe, expect, it, vi } from 'vitest'

let walletChains: typeof import('../chains').walletChains

beforeAll(async () => {
  // chains.ts validates the browser RPC config at import.
  vi.stubEnv('NEXT_PUBLIC_RPC_PROVIDER', 'drpc')
  vi.stubEnv('NEXT_PUBLIC_RPC_API_KEY', 'test-key')
  ;({ walletChains } = await import('../chains'))
})

const SEPOLIA = 11155111
const BASE_SEPOLIA = 84532
const ARBITRUM_SEPOLIA = 421614

describe('walletChains', () => {
  it('has no testnet on mainnet', () => {
    const ids = walletChains('mainnet').chains.map((c) => c.id)
    expect(ids).not.toContain(SEPOLIA)
    expect(ids).toContain(8453)
  })

  it('adds the bridge testnets, with a transport each, on testnet', () => {
    const { chains, transports } = walletChains('testnet')
    const ids = chains.map((c) => c.id)
    for (const id of [SEPOLIA, BASE_SEPOLIA, ARBITRUM_SEPOLIA]) {
      expect(ids).toContain(id)
      expect(transports[id]).toBeDefined()
    }
    expect(ids).toContain(8453)
  })
})
