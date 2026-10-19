/**
 * The Stellar network of this deployment, for everything a user signs or
 * holds: SEP-10, the wallet kit, Horizon reads, the CCTP bridge.
 *
 * One switch per deployment, `NEXT_PUBLIC_NETWORK` (`mainnet` or `testnet`).
 * Production is mainnet whatever the variable says. A preview without a valid
 * value runs on testnet, so a preview missing the variable never signs on
 * mainnet; anywhere else (local dev, CI) the default is mainnet.
 * Market data (Blend spot, Hubble history, Blend positions) never reads this:
 * it is pubnet data, see blend/common/api.ts.
 *
 * Client-safe: no SDK import, so the browser bundle stays light.
 */

export type StellarNetworkId = 'mainnet' | 'testnet'

export interface StellarNetworkEnv {
  NEXT_PUBLIC_NETWORK?: string
  VERCEL_ENV?: string
  NEXT_PUBLIC_VERCEL_ENV?: string
}

export interface StellarNetworkConfig {
  id: StellarNetworkId
  passphrase: string
  horizonUrl: string
  explorerUrl: string
  friendbotUrl: string | null
  publicSorobanRpcUrl: string
  usdc: { code: 'USDC'; issuer: string; contractId: string }
}

export const STELLAR_NETWORKS: Record<StellarNetworkId, StellarNetworkConfig> =
  {
    mainnet: {
      id: 'mainnet',
      passphrase: 'Public Global Stellar Network ; September 2015',
      horizonUrl: 'https://horizon.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/public',
      friendbotUrl: null,
      publicSorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
      usdc: {
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        contractId: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
      },
    },
    testnet: {
      id: 'testnet',
      passphrase: 'Test SDF Network ; September 2015',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      friendbotUrl: 'https://friendbot.stellar.org',
      publicSorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      usdc: {
        code: 'USDC',
        issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        contractId: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      },
    },
  }

// Literal references, read at call time: Next.js inlines only those into the
// browser bundle, and tests can set them after import.
function processEnv(): StellarNetworkEnv {
  return {
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  }
}

export function stellarNetworkId(
  env: StellarNetworkEnv = processEnv()
): StellarNetworkId {
  if (
    env.VERCEL_ENV === 'production' ||
    env.NEXT_PUBLIC_VERCEL_ENV === 'production'
  ) {
    return 'mainnet'
  }
  const value = env.NEXT_PUBLIC_NETWORK?.trim()
  if (value === 'mainnet' || value === 'testnet') return value
  return env.VERCEL_ENV === 'preview' ||
    env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
    ? 'testnet'
    : 'mainnet'
}

export function stellarNetwork(
  env: StellarNetworkEnv = processEnv()
): StellarNetworkConfig {
  return STELLAR_NETWORKS[stellarNetworkId(env)]
}

export function stellarTxUrl(
  hash: string,
  net: StellarNetworkConfig = stellarNetwork()
): string {
  return `${net.explorerUrl}/tx/${hash}`
}
