import type { StellarSession, Wallet } from '@/stores/walletStore'

/**
 * Partial store update applied to a persisted Stellar wallet on restore.
 * Only the wallet owning the server SEP-10 session stays connected; every
 * other one is kept but shown as signed out and never active.
 */
export function restoredStellarWalletUpdate(
  wallet: Pick<Wallet, 'address' | 'isActive'>,
  session: StellarSession | null | undefined
): Partial<Wallet> {
  if (session && session.address === wallet.address) {
    return {
      isConnected: true,
      isCurrentlyConnected: wallet.isActive,
      stellarSession: session,
    }
  }
  return {
    isConnected: false,
    isCurrentlyConnected: false,
    isActive: false,
    stellarSession: undefined,
  }
}

/**
 * The session the server cookie holds: the newest unexpired Stellar session in
 * the store. Each sign-in replaces the cookie, so an older session is dead even
 * while its wallet still carries it (expiresAt and issuedAt are in epoch seconds).
 */
export function currentStellarSession(
  wallets: readonly Pick<Wallet, 'chainFamily' | 'stellarSession'>[],
  now: number = Math.floor(Date.now() / 1000)
): StellarSession | null {
  let current: StellarSession | null = null
  for (const w of wallets) {
    const s = w.stellarSession
    if (w.chainFamily !== 'stellar' || !s || s.expiresAt <= now) continue
    if (!current || s.issuedAt > current.issuedAt) current = s
  }
  return current
}

/**
 * Fail closed: skip clearing the server session only when it is known to
 * belong to a different address.
 */
export function shouldClearStellarSession(
  address: string,
  server: { ok: true; sessionAddress: string | null } | { ok: false }
): boolean {
  if (!server.ok || server.sessionAddress === null) return true
  return server.sessionAddress === address
}

/**
 * True when the wallet was signed in while the restore request was in flight:
 * its session now exists and differs (by issuedAt) from the pre-await one.
 */
export function signedInDuringRestore(
  before: Pick<Wallet, 'stellarSession'> | undefined,
  after: Pick<Wallet, 'stellarSession'> | undefined
): boolean {
  const next = after?.stellarSession
  if (!next) return false
  const prev = before?.stellarSession
  return !prev || prev.issuedAt !== next.issuedAt
}

/**
 * Whether an active wallet may be shown as the header wallet. A Stellar
 * wallet needs its own, unexpired session (expiresAt is in epoch seconds).
 */
export function isDisplayableActive(
  wallet: Pick<Wallet, 'address' | 'chainFamily' | 'stellarSession'>,
  now: number = Math.floor(Date.now() / 1000)
): boolean {
  if (wallet.chainFamily !== 'stellar') return true
  const session = wallet.stellarSession
  return (
    !!session && session.address === wallet.address && session.expiresAt > now
  )
}
