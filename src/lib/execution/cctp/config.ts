import {
  type StellarNetworkId,
  stellarNetworkId,
} from '@/config/stellar-network'

/**
 * Circle's CCTP domain for Stellar — a CCTP identifier, not a chain id. Routing
 * a burn to any other number sends the message to another chain's context.
 */
export const STELLAR_CCTP_DOMAIN = 27

/** `minFinalityThreshold` of a burn: ≤ 1000 asks for Fast Transfer, 2000 for Standard. */
export const FINALITY_THRESHOLD = { fast: 1000, standard: 2000 } as const

export type CctpSourceSlug = 'ethereum' | 'base' | 'arbitrum' | 'optimism'

export interface CctpSourceChain {
  chainId: number
  slug: CctpSourceSlug
  name: string
  domain: number
  usdc: `0x${string}`
  tokenMessengerV2: `0x${string}`
  explorerTxBase: string
}

export interface StellarCctpContracts {
  tokenMessengerMinter: string
  messageTransmitter: string
  forwarder: string
}

export interface CctpNetworkConfig {
  network: StellarNetworkId
  irisBaseUrl: string
  stellar: StellarCctpContracts
  sourceChains: readonly CctpSourceChain[]
}

// Same address on every EVM chain of an environment (CREATE2), per Circle.
const TOKEN_MESSENGER_V2_MAINNET = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'
const TOKEN_MESSENGER_V2_TESTNET = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

/**
 * One table per network, constants only — no environment override. A mainnet
 * burn aimed at the testnet forwarder (whose destinationCaller nobody can ever
 * satisfy on mainnet) is impossible by construction: both come from the same
 * row of this table.
 */
const CONFIGS: Record<StellarNetworkId, CctpNetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    irisBaseUrl: 'https://iris-api.circle.com',
    stellar: {
      tokenMessengerMinter:
        'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
      messageTransmitter:
        'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
      forwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    },
    sourceChains: [
      {
        chainId: 1,
        slug: 'ethereum',
        name: 'Ethereum',
        domain: 0,
        usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenMessengerV2: TOKEN_MESSENGER_V2_MAINNET,
        explorerTxBase: 'https://etherscan.io/tx/',
      },
      {
        chainId: 8453,
        slug: 'base',
        name: 'Base',
        domain: 6,
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        tokenMessengerV2: TOKEN_MESSENGER_V2_MAINNET,
        explorerTxBase: 'https://basescan.org/tx/',
      },
      {
        chainId: 42161,
        slug: 'arbitrum',
        name: 'Arbitrum',
        domain: 3,
        usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        tokenMessengerV2: TOKEN_MESSENGER_V2_MAINNET,
        explorerTxBase: 'https://arbiscan.io/tx/',
      },
      {
        chainId: 10,
        slug: 'optimism',
        name: 'Optimism',
        domain: 2,
        usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        tokenMessengerV2: TOKEN_MESSENGER_V2_MAINNET,
        explorerTxBase: 'https://optimistic.etherscan.io/tx/',
      },
    ],
  },
  testnet: {
    network: 'testnet',
    irisBaseUrl: 'https://iris-api-sandbox.circle.com',
    stellar: {
      tokenMessengerMinter:
        'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
      messageTransmitter:
        'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
      forwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    },
    sourceChains: [
      {
        chainId: 11155111,
        slug: 'ethereum',
        name: 'Ethereum Sepolia',
        domain: 0,
        usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        tokenMessengerV2: TOKEN_MESSENGER_V2_TESTNET,
        explorerTxBase: 'https://sepolia.etherscan.io/tx/',
      },
      {
        chainId: 84532,
        slug: 'base',
        name: 'Base Sepolia',
        domain: 6,
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        tokenMessengerV2: TOKEN_MESSENGER_V2_TESTNET,
        explorerTxBase: 'https://sepolia.basescan.org/tx/',
      },
      {
        chainId: 421614,
        slug: 'arbitrum',
        name: 'Arbitrum Sepolia',
        domain: 3,
        usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        tokenMessengerV2: TOKEN_MESSENGER_V2_TESTNET,
        explorerTxBase: 'https://sepolia.arbiscan.io/tx/',
      },
    ],
  },
}

/** The CCTP side of a network; by default the deployment's (`stellarNetworkId()`). */
export function cctpConfig(
  network: StellarNetworkId = stellarNetworkId()
): CctpNetworkConfig {
  return CONFIGS[network]
}

/** A bridge source of the network, or null — including for a chain of the other network. */
export function cctpSourceChain(
  chainId: number,
  network: StellarNetworkId = stellarNetworkId()
): CctpSourceChain | null {
  return (
    CONFIGS[network].sourceChains.find((c) => c.chainId === chainId) ?? null
  )
}

export function cctpSourceChainBySlug(
  slug: string,
  network: StellarNetworkId = stellarNetworkId()
): CctpSourceChain | null {
  return CONFIGS[network].sourceChains.find((c) => c.slug === slug) ?? null
}

export function evmTxUrl(chain: CctpSourceChain, hash: string): string {
  return `${chain.explorerTxBase}${hash}`
}
