import {
  Account,
  Asset,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

import type { StellarNetworkConfig } from '@/config/stellar-network'

import { SignedTxError, parseSignedTransaction } from './signed-tx'

export { SignedTxError } from './signed-tx'

export type PreflightState =
  | 'unfunded'
  | 'missing-trustline'
  | 'insufficient-xlm'
  | 'limit-too-low'
  | 'not-authorized'
  | 'ready'

/** The fields of Horizon's `GET /accounts/{id}` the preflight reads. */
export interface HorizonAccount {
  sequence?: string
  balances: {
    asset_type: string
    asset_code?: string
    asset_issuer?: string
    balance: string
    limit?: string
    is_authorized?: boolean
    selling_liabilities?: string
  }[]
  subentry_count: number
  num_sponsoring?: number
  num_sponsored?: number
}

export interface PreflightResult {
  state: PreflightState
  availableXlm: string
  requiredXlm: string
  trustline: { balance: string; limit: string } | null
}

type Usdc = StellarNetworkConfig['usdc']

export const TRUSTLINE_RESERVE_XLM = 0.5
/** Stellar's maximum trustline limit: what "no limit" means on the ledger. */
export const MAX_TRUSTLINE_LIMIT = '922337203685.4775807'
export const FEE_MARGIN_XLM = 0.1

const STROOPS = 10_000_000n
const BASE_RESERVE = 5_000_000n // 0.5 XLM per ledger entry
const TRUSTLINE_RESERVE = 5_000_000n
const FEE_MARGIN = 1_000_000n
/** A fresh account: 2 base reserves, then the trustline and the fees. */
const UNFUNDED_REQUIRED = 2n * BASE_RESERVE + TRUSTLINE_RESERVE + FEE_MARGIN
/** Max fee for the ChangeTrust: 0.001 XLM, enough under surge pricing. */
const CHANGE_TRUST_FEE = '10000'
const HORIZON_TIMEOUT_MS = 8_000

/** "1.5" or "1.5000000" → stroops. Horizon amounts have at most 7 decimals. */
function toStroops(amount: string | undefined): bigint {
  if (!amount) return 0n
  const [whole, fraction = ''] = amount.split('.')
  return BigInt(whole) * STROOPS + BigInt(fraction.padEnd(7, '0').slice(0, 7))
}

function fromStroops(stroops: bigint): string {
  const fraction = (stroops % STROOPS)
    .toString()
    .padStart(7, '0')
    .replace(/0+$/, '')
  return `${stroops / STROOPS}${fraction ? `.${fraction}` : ''}`
}

/**
 * Whether the account can receive `expectedStellarAtomic` USDC. With
 * `mintFeeStroops`, the full fee of the prepared mint (inclusion + resource):
 * the available XLM must also cover it, and `requiredXlm` is that fee plus
 * the margin.
 */
export function preflightFromAccount(
  account: HorizonAccount | null,
  usdc: Usdc,
  expectedStellarAtomic: bigint,
  mintFeeStroops?: bigint
): PreflightResult {
  if (!account) {
    return {
      state: 'unfunded',
      availableXlm: '0',
      requiredXlm: fromStroops(UNFUNDED_REQUIRED),
      trustline: null,
    }
  }
  const native = account.balances.find((b) => b.asset_type === 'native')
  const entries =
    2n +
    BigInt(account.subentry_count) +
    BigInt(account.num_sponsoring ?? 0) -
    BigInt(account.num_sponsored ?? 0)
  const raw =
    toStroops(native?.balance) -
    entries * BASE_RESERVE -
    toStroops(native?.selling_liabilities)
  const available = raw > 0n ? raw : 0n
  const availableXlm = fromStroops(available)

  const line = account.balances.find(
    (b) =>
      b.asset_type !== 'native' &&
      b.asset_code === usdc.code &&
      b.asset_issuer === usdc.issuer
  )
  if (!line) {
    const required = TRUSTLINE_RESERVE + FEE_MARGIN
    return {
      state: available >= required ? 'missing-trustline' : 'insufficient-xlm',
      availableXlm,
      requiredXlm: fromStroops(required),
      trustline: null,
    }
  }

  const trustline = { balance: line.balance, limit: line.limit ?? '0' }
  const fee = mintFeeStroops ?? 0n
  const base = {
    availableXlm,
    requiredXlm: fromStroops(fee + FEE_MARGIN),
    trustline,
  }
  if (line.is_authorized === false) return { state: 'not-authorized', ...base }
  if (available < FEE_MARGIN || available < fee)
    return { state: 'insufficient-xlm', ...base }
  if (
    toStroops(trustline.limit) - toStroops(trustline.balance) <
    expectedStellarAtomic
  ) {
    return { state: 'limit-too-low', ...base }
  }
  return { state: 'ready', ...base }
}

/** Horizon's account record, or null when the account does not exist (404). */
export async function fetchHorizonAccount(
  address: string,
  deps: { horizonUrl: string; fetchFn?: typeof fetch }
): Promise<HorizonAccount | null> {
  const fetchFn = deps.fetchFn ?? fetch
  const res = await fetchFn(`${deps.horizonUrl}/accounts/${address}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Horizon ${res.status} for the Stellar account`)
  return (await res.json()) as HorizonAccount
}

/**
 * Whether `hash` is a successful transaction from `address` holding only a
 * ChangeTrust on this network's USDC, per Horizon. Only decides whether the
 * hash is shown on the transfer, so any doubt (timeout, an error page instead
 * of JSON) is false, never an error that would stop the transfer.
 */
export async function isChangeTrustBy(
  hash: string,
  address: string,
  deps: {
    horizonUrl: string
    passphrase: string
    usdc: Usdc
    fetchFn?: typeof fetch
  }
): Promise<boolean> {
  const fetchFn = deps.fetchFn ?? fetch
  let tx: {
    successful?: boolean
    source_account?: string
    envelope_xdr?: string
  }
  try {
    const res = await fetchFn(`${deps.horizonUrl}/transactions/${hash}`, {
      signal: AbortSignal.timeout(HORIZON_TIMEOUT_MS),
    })
    if (!res.ok) return false
    tx = await res.json()
  } catch {
    return false
  }
  if (!tx?.successful || tx.source_account !== address || !tx.envelope_xdr)
    return false
  try {
    assertSignedChangeTrust(tx.envelope_xdr, {
      passphrase: deps.passphrase,
      usdc: deps.usdc,
      source: address,
    })
    return true
  } catch {
    return false
  }
}

/**
 * The unsigned ChangeTrust the wallet signs: USDC of the network, no limit
 * (Stellar's maximum), so it also fixes a `limit-too-low` trustline.
 */
export async function buildChangeTrustXdr(
  address: string,
  deps: {
    horizonUrl: string
    passphrase: string
    usdc: Usdc
    fetchFn?: typeof fetch
  }
): Promise<string> {
  const account = await fetchHorizonAccount(address, deps)
  if (!account?.sequence) {
    throw new Error(
      'This Stellar account does not exist yet: fund it with XLM first'
    )
  }
  return new TransactionBuilder(new Account(address, account.sequence), {
    fee: CHANGE_TRUST_FEE,
    networkPassphrase: deps.passphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(deps.usdc.code, deps.usdc.issuer),
        limit: MAX_TRUSTLINE_LIMIT,
      })
    )
    .setTimeout(300)
    .build()
    .toXDR()
}

/** Before relaying: one ChangeTrust on the network's USDC, from and signed by the session account. */
export function assertSignedChangeTrust(
  xdr: string,
  expected: { passphrase: string; usdc: Usdc; source: string }
): void {
  const tx = parseSignedTransaction(xdr, expected.passphrase, expected.source)
  if (tx.operations.length !== 1) {
    throw new SignedTxError('operations', 'Expected exactly one operation')
  }
  const op = tx.operations[0]
  if (op.type !== 'changeTrust') {
    throw new SignedTxError('operation', 'Expected a ChangeTrust operation')
  }
  if (op.source && op.source !== expected.source) {
    throw new SignedTxError(
      'source',
      'The operation source is not your account'
    )
  }
  const line = op.line
  if (
    !(line instanceof Asset) ||
    line.getCode() !== expected.usdc.code ||
    line.getIssuer() !== expected.usdc.issuer
  ) {
    throw new SignedTxError(
      'asset',
      'The trustline is not for this network’s USDC'
    )
  }
  if (op.limit !== MAX_TRUSTLINE_LIMIT) {
    throw new SignedTxError(
      'operation',
      'The USDC trustline must have no limit (Stellar maximum)'
    )
  }
}
