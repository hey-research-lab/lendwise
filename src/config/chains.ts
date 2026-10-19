import { type Transport, defineChain, http } from 'viem'
import type { Chain } from 'viem/chains'
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  bsc,
  celo,
  linea,
  mainnet,
  mantle,
  optimism,
  polygon,
  scroll,
  sepolia,
  unichain,
  zksync,
} from 'viem/chains'

import { isRpcProvider, rpcUrl } from '@/config/rpc-providers'
import type { RpcNetwork, RpcProvider } from '@/config/rpc-providers'
import type { StellarNetworkId } from '@/config/stellar-network'
import { testnetTransport } from '@/config/testnet-rpc'
import type { RegisteredChainId } from '@/lib/protocols/core/toolkit'

/**
 * Execution layer — the chains where Lendwise can drive a wallet (send a
 * transaction, wait for a receipt, read a native balance).
 *
 * Identity lives in the chain registry (core/toolkit/chain-slugs.ts) and data
 * coverage in each adapter config; both extend without touching this file. A
 * chain ingested for data but absent here is simply view-only in the UI —
 * `isTxSupported` is the one predicate consumers ask.
 *
 * Membership = the network is enabled on both of the provider's keys, browser
 * and server (checked live before adding — an entry whose RPC 403s is worse
 * than none). Remaining view-only chains (gnosis, metis, soneium, sonic,
 * plasma, ink, xlayer, katana, …) are not served by Infura; adding one means
 * finding it an RPC first.
 *
 * EVM-only by nature (wagmi). A future non-EVM execution stack (e.g. Stellar
 * wallets for Blend) gets its own module; it shares the registry, not this file.
 */

// Literal references: Next.js inlines only those into the browser bundle.
const RPC_PROVIDER = process.env.NEXT_PUBLIC_RPC_PROVIDER
const RPC_API_KEY = process.env.NEXT_PUBLIC_RPC_API_KEY

if (!isRpcProvider(RPC_PROVIDER)) {
  throw new Error('NEXT_PUBLIC_RPC_PROVIDER is missing or not a known provider')
}
if (!RPC_API_KEY) {
  throw new Error('NEXT_PUBLIC_RPC_API_KEY is not defined')
}
const provider: RpcProvider = RPC_PROVIDER
const browserKey: string = RPC_API_KEY

/**
 * Browser URL of a tx chain: the restricted browser key (origins, read
 * methods, credit caps set at the provider). Server reads use the server
 * key through `rpc.server.ts`, never this.
 */
function browserRpc(network: RpcNetwork): string {
  const url = rpcUrl(provider, network, browserKey)
  if (!url) throw new Error(`${provider} does not serve ${network}`)
  return url
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Not in our viem version yet — minimal definitions, explorers can come later.
// `rpcUrls.default` is what wallets receive when the app adds a chain, so it
// is never a keyed URL: the wallet would call it from its own origin, which is
// not in the browser key's allowlist. wagmi reads go through `rpc` instead.
// multicall3 (canonical address) was checked on-chain on 2026-10-13, so
// `blockCreated` is left out.
const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  contracts: { multicall3: { address: MULTICALL3 } },
})

const megaeth = defineChain({
  id: 4326,
  name: 'MegaETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.megaeth.com/rpc'] } },
  contracts: { multicall3: { address: MULTICALL3 } },
})

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  contracts: { multicall3: { address: MULTICALL3 } },
})

export const TX_CHAINS = [
  { ...mainnet, rpc: browserRpc('ethereum') },
  { ...arbitrum, rpc: browserRpc('arbitrum') },
  { ...optimism, rpc: browserRpc('optimism') },
  { ...polygon, rpc: browserRpc('polygon') },
  { ...base, rpc: browserRpc('base') },
  { ...linea, rpc: browserRpc('linea') },
  { ...avalanche, rpc: browserRpc('avalanche') },
  { ...bsc, rpc: browserRpc('bsc') },
  { ...celo, rpc: browserRpc('celo') },
  { ...zksync, rpc: browserRpc('zksync') },
  { ...mantle, rpc: browserRpc('mantle') },
  { ...scroll, rpc: browserRpc('scroll') },
  { ...unichain, rpc: browserRpc('unichain') },
  { ...hyperevm, rpc: browserRpc('hyperevm') },
  { ...megaeth, rpc: browserRpc('megaeth') },
  { ...monad, rpc: browserRpc('monad') },
] as const

/** Compile-time guard: every tx chain must exist in the chain registry. */
type AssertRegistered<T extends RegisteredChainId> = T
export type TxChainId = AssertRegistered<(typeof TX_CHAINS)[number]['id']>

const TX_CHAIN_IDS: ReadonlySet<number> = new Set(TX_CHAINS.map((c) => c.id))

/**
 * Execution count — chains with wallet support. The data/marketing count is
 * STANDARDIZED_CHAIN_COUNT in `@/config/chains-coverage`.
 */
export const TX_CHAIN_COUNT = TX_CHAINS.length

/** Can Lendwise drive a wallet on this chain? false = view-only in the UI. */
export function isTxSupported(chainId: number): boolean {
  return TX_CHAIN_IDS.has(chainId)
}

export const ALL_CHAINS = TX_CHAINS

export const CHAINS = {
  MAINNETS: TX_CHAINS,
  TESTNETS: [] as readonly Chain[],
} as const

export const CHAIN_TRANSPORTS = Object.fromEntries(
  TX_CHAINS.map((chain) => [chain.id, http(chain.rpc)])
)

/**
 * Source chains of the CCTP bridge on the testnet staging. Wallet-only: no
 * adapter reads them and `isTxSupported` stays false for them. Public RPCs
 * (`TESTNET_RPC_URLS`): the provider keys are never sent to a testnet host.
 */
export const BRIDGE_TESTNET_CHAINS = [
  sepolia,
  baseSepolia,
  arbitrumSepolia,
] as const

/** The chains wagmi offers the wallet on this deployment's network. */
export function walletChains(network: StellarNetworkId): {
  chains: readonly [Chain, ...Chain[]]
  transports: Record<number, Transport>
} {
  if (network !== 'testnet') {
    return { chains: ALL_CHAINS, transports: CHAIN_TRANSPORTS }
  }
  return {
    chains: [...ALL_CHAINS, ...BRIDGE_TESTNET_CHAINS],
    transports: {
      ...CHAIN_TRANSPORTS,
      ...Object.fromEntries(
        BRIDGE_TESTNET_CHAINS.map((c) => [c.id, testnetTransport(c.id)])
      ),
    },
  }
}
