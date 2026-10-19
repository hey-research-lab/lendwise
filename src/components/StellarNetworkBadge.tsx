import { stellarNetworkId } from '@/config/stellar-network'

/** Shown on the testnet staging only, so no one mistakes it for lendwise.fi. */
export function StellarNetworkBadge() {
  if (stellarNetworkId() !== 'testnet') return null
  return (
    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
      Testnet
    </span>
  )
}
