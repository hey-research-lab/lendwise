import type { StellarNetworkId } from '@/config/stellar-network'

/**
 * USDC atomic units. Every EVM CCTP chain uses 6 decimals, Stellar uses 7, and
 * CCTP messages carry 6: the destination scales by 10. Amounts stay bigint end
 * to end — a float never touches a value that is burned or minted.
 */
const EVM_SCALE = 1_000_000n
const STELLAR_SCALE = 10_000_000n
const EVM_TO_STELLAR = STELLAR_SCALE / EVM_SCALE

export const MIN_BRIDGE_AMOUNT = 1_000_000n // 1 USDC
export const DEFAULT_MAINNET_MAX_USDC = 1000

export type BridgeAmountErrorCode =
  'format' | 'decimals' | 'non-positive' | 'below-minimum' | 'above-cap'

export class BridgeAmountError extends Error {
  constructor(
    public code: BridgeAmountErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'BridgeAmountError'
  }
}

const DECIMAL = /^\d+(\.\d+)?$/

/** "25.5" → 25_500_000n. A comma, a sign, an exponent or a 7th decimal is refused, never guessed. */
export function parseUsdcAmount(input: string): bigint {
  const s = input.trim()
  if (!DECIMAL.test(s)) {
    throw new BridgeAmountError('format', 'Enter an amount like 25 or 25.5')
  }
  const [whole, fraction = ''] = s.split('.')
  if (fraction.length > 6) {
    throw new BridgeAmountError('decimals', 'USDC has at most 6 decimals')
  }
  const atomic = BigInt(whole) * EVM_SCALE + BigInt(fraction.padEnd(6, '0'))
  if (atomic <= 0n) {
    throw new BridgeAmountError('non-positive', 'The amount must be above zero')
  }
  return atomic
}

function formatAtomic(atomic: bigint, scale: bigint, decimals: number): string {
  const negative = atomic < 0n
  const abs = negative ? -atomic : atomic
  const fraction = (abs % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${abs / scale}${fraction ? `.${fraction}` : ''}`
}

/** 25_500_000n → "25.5". */
export function formatUsdcAmount(atomic6: bigint): string {
  return formatAtomic(atomic6, EVM_SCALE, 6)
}

/** Stellar USDC (7 decimals): 255_000_001n → "25.5000001". */
export function formatStellarAmount(atomic7: bigint): string {
  return formatAtomic(atomic7, STELLAR_SCALE, 7)
}

/** The rescale the transfer logic applies: 6-decimal EVM units → 7-decimal Stellar units. */
export function evmToStellarAtomic(atomic6: bigint): bigint {
  return atomic6 * EVM_TO_STELLAR
}

/**
 * Per-transfer cap. Mainnet: `CCTP_MAX_AMOUNT_USDC`, or 1,000 USDC when unset or
 * malformed (fail closed on a typo). Testnet: no cap.
 */
export function maxBridgeAmount(
  network: StellarNetworkId,
  env: Record<string, string | undefined> = process.env
): bigint | null {
  if (network === 'testnet') return null
  const raw = env.CCTP_MAX_AMOUNT_USDC?.trim()
  if (raw) {
    try {
      return parseUsdcAmount(raw)
    } catch {
      console.error(
        '[bridge] CCTP_MAX_AMOUNT_USDC is not a valid amount; using the default cap'
      )
    }
  }
  return BigInt(DEFAULT_MAINNET_MAX_USDC) * EVM_SCALE
}

export function assertBridgeAmount(
  amount: bigint,
  network: StellarNetworkId,
  env: Record<string, string | undefined> = process.env
): void {
  if (amount < MIN_BRIDGE_AMOUNT) {
    throw new BridgeAmountError(
      'below-minimum',
      `The minimum is ${formatUsdcAmount(MIN_BRIDGE_AMOUNT)} USDC`
    )
  }
  const cap = maxBridgeAmount(network, env)
  if (cap !== null && amount > cap) {
    throw new BridgeAmountError(
      'above-cap',
      `The maximum per transfer is ${formatUsdcAmount(cap)} USDC`
    )
  }
}
