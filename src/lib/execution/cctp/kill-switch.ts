import type { StellarNetworkId } from '@/config/stellar-network'

export const BRIDGE_PAUSED_MESSAGE =
  'The bridge is paused. Transfers in progress can still be finished here.'

/**
 * The kill switch of NEW transfers, `CCTP_BRIDGE_ENABLED`: on by default on
 * testnet (only "0" pauses it), off by default on mainnet (only "1" opens it).
 *
 * A server-only variable, read by the server with the env passed in, never
 * inlined in the browser bundle. It blocks the quote and the creation of a
 * transfer only: a transfer whose USDC already left the source chain can
 * always be resumed, imported and minted.
 */
export function isBridgeEnabled(
  network: StellarNetworkId,
  env: Record<string, string | undefined>
): boolean {
  const value = env.CCTP_BRIDGE_ENABLED?.trim()
  return network === 'mainnet' ? value === '1' : value !== '0'
}
