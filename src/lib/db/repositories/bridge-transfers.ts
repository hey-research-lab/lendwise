import { type SQL, sql } from 'drizzle-orm'

import type { StellarNetworkId } from '@/config/stellar-network'
import { db } from '@/lib/db/postgres'

export type BridgeTransferStatus =
  | 'planned'
  | 'burn_submitted'
  | 'burn_confirmed'
  | 'attested'
  | 'mint_submitted'
  | 'completed'
  | 'failed'

export interface BridgeTransfer {
  id: string
  network: StellarNetworkId
  status: BridgeTransferStatus
  stellarAddress: string
  evmAddress: string | null
  sourceChainId: number
  sourceDomain: number
  amount: bigint
  maxFee: bigint
  feeExecuted: bigint | null
  minFinalityThreshold: number
  finalityThresholdExecuted: number | null
  changeTrustTxHash: string | null
  approvalTxHash: string | null
  burnTxHash: string | null
  mintTxHash: string | null
  irisEventNonce: string | null
  message: string | null
  attestation: string | null
  mintedAmount: bigint | null
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export type NewBridgeTransfer = Pick<
  BridgeTransfer,
  | 'network'
  | 'stellarAddress'
  | 'sourceChainId'
  | 'sourceDomain'
  | 'amount'
  | 'maxFee'
  | 'minFinalityThreshold'
> & {
  status: 'planned' | 'burn_confirmed'
  evmAddress?: string
  burnTxHash?: string
  changeTrustTxHash?: string
}

/** Columns a transition may write, besides `status`. */
const PATCH_COLUMNS = {
  evmAddress: 'evm_address',
  feeExecuted: 'fee_executed',
  finalityThresholdExecuted: 'finality_threshold_executed',
  changeTrustTxHash: 'change_trust_tx_hash',
  approvalTxHash: 'approval_tx_hash',
  burnTxHash: 'burn_tx_hash',
  mintTxHash: 'mint_tx_hash',
  irisEventNonce: 'iris_event_nonce',
  message: 'message',
  attestation: 'attestation',
  mintedAmount: 'minted_amount',
  error: 'error',
} as const

export type TransferPatch = Partial<
  Pick<BridgeTransfer, keyof typeof PATCH_COLUMNS>
>

/**
 * Statuses a user can carry on from: USDC left the source chain and has not
 * arrived yet. `failed` qualifies only once the burn was confirmed — see
 * `isResumable`.
 */
export const RESUMABLE_STATUSES: BridgeTransferStatus[] = [
  'burn_submitted',
  'burn_confirmed',
  'attested',
  'mint_submitted',
  'failed',
]

/** A reverted burn has a hash but moved nothing: only a confirmed one is resumable. */
export function isResumable(t: BridgeTransfer): boolean {
  if (t.status === 'failed') return t.evmAddress !== null
  return RESUMABLE_STATUSES.includes(t.status)
}

/** Postgres `unique_violation`, whether the driver wraps the error or not. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

const big = (v: unknown): bigint | null =>
  v == null ? null : BigInt(String(v))
const text = (v: unknown): string | null => (v == null ? null : String(v))
const int = (v: unknown): number | null => (v == null ? null : Number(v))

export function rowToTransfer(r: Record<string, unknown>): BridgeTransfer {
  return {
    id: String(r.id),
    network: r.network as StellarNetworkId,
    status: r.status as BridgeTransferStatus,
    stellarAddress: String(r.stellar_address),
    evmAddress: text(r.evm_address),
    sourceChainId: Number(r.source_chain_id),
    sourceDomain: Number(r.source_domain),
    amount: BigInt(String(r.amount)),
    maxFee: BigInt(String(r.max_fee)),
    feeExecuted: big(r.fee_executed),
    minFinalityThreshold: Number(r.min_finality_threshold),
    finalityThresholdExecuted: int(r.finality_threshold_executed),
    changeTrustTxHash: text(r.change_trust_tx_hash),
    approvalTxHash: text(r.approval_tx_hash),
    burnTxHash: text(r.burn_tx_hash),
    mintTxHash: text(r.mint_tx_hash),
    irisEventNonce: text(r.iris_event_nonce),
    message: text(r.message),
    attestation: text(r.attestation),
    mintedAmount: big(r.minted_amount),
    error: text(r.error),
    createdAt: new Date(r.created_at as string | Date),
    updatedAt: new Date(r.updated_at as string | Date),
  }
}

const toParam = (v: unknown) =>
  typeof v === 'bigint' ? v.toString() : (v ?? null)

/** `updated_at = now()`, then every patched column, in PATCH_COLUMNS order. */
function setClause(patch: TransferPatch): SQL {
  const parts: SQL[] = [sql`updated_at = now()`]
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!(key in patch)) continue
    const value = patch[key as keyof TransferPatch]
    parts.push(sql`${sql.identifier(column)} = ${toParam(value)}`)
  }
  return sql.join(parts, sql`, `)
}

async function rows(query: SQL): Promise<BridgeTransfer[]> {
  const result = (await db.execute(query)) as unknown as {
    rows: Record<string, unknown>[]
  }
  return result.rows.map(rowToTransfer)
}

export async function insertTransfer(
  input: NewBridgeTransfer
): Promise<BridgeTransfer> {
  const [t] = await rows(sql`
    INSERT INTO bridge_transfers
      (network, status, stellar_address, evm_address, source_chain_id,
       source_domain, amount, max_fee, min_finality_threshold, burn_tx_hash,
       change_trust_tx_hash)
    VALUES
      (${input.network}, ${input.status}, ${input.stellarAddress},
       ${input.evmAddress?.toLowerCase() ?? null}, ${input.sourceChainId},
       ${input.sourceDomain}, ${input.amount.toString()},
       ${input.maxFee.toString()}, ${input.minFinalityThreshold},
       ${input.burnTxHash?.toLowerCase() ?? null},
       ${input.changeTrustTxHash ?? null})
    RETURNING *`)
  return t
}

export async function findTransfer(
  id: string,
  stellarAddress: string
): Promise<BridgeTransfer | null> {
  const [t] = await rows(sql`
    SELECT * FROM bridge_transfers
    WHERE id = ${id} AND stellar_address = ${stellarAddress}`)
  return t ?? null
}

export async function findTransferByBurn(
  sourceDomain: number,
  burnTxHash: string,
  stellarAddress: string
): Promise<BridgeTransfer | null> {
  const [t] = await rows(sql`
    SELECT * FROM bridge_transfers
    WHERE source_domain = ${sourceDomain}
      AND burn_tx_hash = ${burnTxHash.toLowerCase()}
      AND stellar_address = ${stellarAddress}`)
  return t ?? null
}

export async function listTransfers(
  stellarAddress: string,
  network: StellarNetworkId,
  limit = 20
): Promise<BridgeTransfer[]> {
  return rows(sql`
    SELECT * FROM bridge_transfers
    WHERE stellar_address = ${stellarAddress} AND network = ${network}
    ORDER BY created_at DESC LIMIT ${limit}`)
}

/**
 * Moves a transfer from one of `from` to `to` in a single statement. Null when
 * the row was no longer in an allowed state: another request moved it first,
 * and the caller must re-read instead of writing again.
 */
export async function advanceTransfer(
  id: string,
  from: BridgeTransferStatus[],
  to: BridgeTransferStatus,
  patch: TransferPatch = {}
): Promise<BridgeTransfer | null> {
  const allowed = sql.join(
    from.map((s) => sql`${s}`),
    sql`, `
  )
  const [t] = await rows(sql`
    UPDATE bridge_transfers SET status = ${to}, ${setClause(patch)}
    WHERE id = ${id} AND status IN (${allowed}) RETURNING *`)
  return t ?? null
}

export async function patchTransfer(
  id: string,
  patch: TransferPatch
): Promise<void> {
  await db.execute(sql`
    UPDATE bridge_transfers SET ${setClause(patch)} WHERE id = ${id}`)
}
