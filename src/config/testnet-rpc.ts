import { type Transport, fallback, http } from 'viem'

/**
 * Public RPCs of the bridge's testnet source chains, for the wallet (browser)
 * and the burn receipt check (server). The provider keys never reach a testnet
 * host. Explicit rather than viem's chain defaults: viem's Sepolia default is
 * keyless dRPC, which refuses Sepolia since October 2026 ("chain is not
 * available on free plan"). Each URL answered with CORS open on 2026-10-16.
 */
export const TESTNET_RPC_URLS: Record<number, readonly string[]> = {
  // Ethereum Sepolia
  11155111: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.gateway.tenderly.co',
  ],
  // Base Sepolia
  84532: [
    'https://sepolia.base.org',
    'https://base-sepolia-rpc.publicnode.com',
  ],
  // Arbitrum Sepolia
  421614: [
    'https://sepolia-rollup.arbitrum.io/rpc',
    'https://arbitrum-sepolia-rpc.publicnode.com',
  ],
}

/** Tries each public RPC of the chain in order. */
export function testnetTransport(chainId: number): Transport {
  const urls = TESTNET_RPC_URLS[chainId]
  if (!urls) throw new Error(`No public RPC for testnet chain ${chainId}`)
  return fallback(urls.map((url) => http(url)))
}
