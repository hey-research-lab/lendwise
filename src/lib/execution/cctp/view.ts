import {
  type StellarNetworkConfig,
  type StellarNetworkId,
  stellarTxUrl,
} from '@/config/stellar-network'
import {
  type BridgeTransfer,
  type BridgeTransferStatus,
  isResumable,
} from '@/lib/db/repositories/bridge-transfers'

import { formatStellarAmount, formatUsdcAmount } from './amounts'
import { type CctpNetworkConfig, evmTxUrl } from './config'

export type BridgeTier = 'fast' | 'standard'

/** CCTP V2: a finality threshold of 1000 or less is Fast, above it Standard. */
const FAST_FINALITY_THRESHOLD = 1000
const tierOf = (threshold: number): BridgeTier =>
  threshold <= FAST_FINALITY_THRESHOLD ? 'fast' : 'standard'

/** What the browser sees of a transfer: decimals as strings, never the raw message. */
export interface BridgeTransferView {
  id: string
  network: StellarNetworkId
  status: BridgeTransferStatus
  /** The tier requested at burn time (from `minFinalityThreshold`). */
  tier: BridgeTier
  /** The tier Circle attested with; null until attested. Fast then Standard means a fallback. */
  tierExecuted: BridgeTier | null
  sourceChainId: number
  /** The EVM account that burned (lowercase), once the burn is verified; null before. */
  evmAddress: string | null
  amount: string
  maxFee: string
  feeExecuted: string | null
  mintedAmount: string | null
  hashes: {
    changeTrust: string | null
    approval: string | null
    burn: string | null
    mint: string | null
  }
  links: {
    changeTrust: string | null
    approval: string | null
    burn: string | null
    mint: string | null
  }
  error: string | null
  resumable: boolean
  createdAt: string
}

export interface BridgeQuote {
  sourceChainId: number
  amount: string
  tier: BridgeTier
  feeBps: number
  maxFee: string
  minimumReceived: string
  cap: string | null
}

/** The burn the wallet signs as is. `amount` is EVM atomic units (6 decimals), base 10. */
export interface BurnRequest {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  usdc: `0x${string}`
  amount: string
}

export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: string; code?: string }

/** User-facing sentence for a stored `<code>: <detail>` error. The detail stays in the logs. */
const ERROR_MESSAGES: Record<string, string> = {
  'burn-reverted':
    'The burn transaction reverted on the source chain. No USDC left your wallet.',
  'burn-wrong-contract':
    'This transaction is not a burn on the CCTP TokenMessenger.',
  'burn-no-event': 'This transaction did not burn USDC through CCTP.',
  'burn-wrong-destination': 'This burn is not addressed to Stellar.',
  'burn-mismatch': 'The burn on chain does not match this transfer.',
  'burn-not-found':
    'The source chain never confirmed this burn: your wallet may have sped it up or replaced it. If USDC left your wallet, paste the burn hash shown in your wallet in “Resume from a burn hash”.',
  'message-mismatch':
    'The attested message does not match the burn. Nothing was minted; resume later or contact support.',
  'mint-failed': 'The mint failed on Stellar. Resume to sign it again.',
  'mint-network-busy':
    'The Stellar network is busy. Resume in a minute to sign the mint again.',
  'mint-not-found':
    'The mint transaction did not reach Stellar. Resume to sign it again.',
  'minted-amount-mismatch':
    'USDC arrived, but not the expected amount. Contact support if this persists.',
}

export function transferErrorMessage(stored: string | null): string | null {
  if (!stored) return null
  const code = stored.split(':')[0]
  return (
    ERROR_MESSAGES[code] ?? 'This transfer stopped. Resume it to try again.'
  )
}

export function toView(
  t: BridgeTransfer,
  cctp: CctpNetworkConfig,
  network: StellarNetworkConfig
): BridgeTransferView {
  const chain =
    cctp.sourceChains.find((c) => c.chainId === t.sourceChainId) ?? null
  const evm = (hash: string | null) =>
    hash && chain ? evmTxUrl(chain, hash) : null
  const stellar = (hash: string | null) =>
    hash ? stellarTxUrl(hash, network) : null
  return {
    id: t.id,
    network: t.network,
    status: t.status,
    tier: tierOf(t.minFinalityThreshold),
    tierExecuted:
      t.finalityThresholdExecuted === null
        ? null
        : tierOf(t.finalityThresholdExecuted),
    sourceChainId: t.sourceChainId,
    evmAddress: t.evmAddress,
    amount: formatUsdcAmount(t.amount),
    maxFee: formatUsdcAmount(t.maxFee),
    feeExecuted:
      t.feeExecuted === null ? null : formatUsdcAmount(t.feeExecuted),
    mintedAmount:
      t.mintedAmount === null ? null : formatStellarAmount(t.mintedAmount),
    hashes: {
      changeTrust: t.changeTrustTxHash,
      approval: t.approvalTxHash,
      burn: t.burnTxHash,
      mint: t.mintTxHash,
    },
    links: {
      changeTrust: stellar(t.changeTrustTxHash),
      approval: evm(t.approvalTxHash),
      burn: evm(t.burnTxHash),
      mint: stellar(t.mintTxHash),
    },
    error: transferErrorMessage(t.error),
    resumable: isResumable(t),
    createdAt: t.createdAt.toISOString(),
  }
}
