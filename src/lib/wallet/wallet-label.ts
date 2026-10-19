/**
 * The line under a wallet in the wallet list: its family, and whether it can
 * sign right now (an EVM wallet needs a wagmi client, a Stellar wallet a
 * session).
 */
export function walletSubtitle(
  wallet: { chainFamily: string; isConnected: boolean },
  hasClient: boolean
): string | null {
  if (wallet.chainFamily === 'stellar') {
    return wallet.isConnected ? 'Stellar' : 'Stellar · Not signed in'
  }
  if (wallet.chainFamily === 'evm') {
    return hasClient ? 'EVM' : 'EVM · Not connected'
  }
  return null
}

/**
 * The wallet list's row menu. A wallet that cannot sign right now is offered a
 * way back in, and leaving the list is "Remove": there is nothing to
 * disconnect.
 */
export function walletRowMenu(
  wallet: { chainFamily: string; isConnected: boolean },
  hasClient: boolean
): { connect: 'Connect' | 'Sign in' | null; remove: 'Remove' | 'Disconnect' } {
  if (wallet.chainFamily === 'stellar' && !wallet.isConnected)
    return { connect: 'Sign in', remove: 'Remove' }
  if (wallet.chainFamily === 'evm' && !hasClient)
    return { connect: 'Connect', remove: 'Remove' }
  return { connect: null, remove: 'Disconnect' }
}
