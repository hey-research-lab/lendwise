import { getDefaultConfig } from '@rainbow-me/rainbowkit'

import { stellarNetworkId } from '@/config/stellar-network'

import { walletChains } from './chains'

// Vérifier que les variables d'environnement sont définies
const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID

if (!projectId) {
  throw new Error('NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is not defined')
}

// The testnet staging adds the bridge's testnet source chains.
const { chains, transports } = walletChains(stellarNetworkId())

// Configuration Wagmi avec support SSR
export const config = getDefaultConfig({
  appName: 'Yield Optimizer',
  projectId,
  chains,
  ssr: true,
  transports,
})
