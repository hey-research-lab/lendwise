import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The SQL is under test, not the database: the client is stubbed and the
// statement it receives is compiled with PgDialect (a compiler, no connection).
const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/postgres', () => ({ db: { execute } }))

const {
  advanceTransfer,
  insertTransfer,
  isResumable,
  isUniqueViolation,
  listTransfers,
  rowToTransfer,
} = await import('@/lib/db/repositories/bridge-transfers')

const dialect = new PgDialect()
const issued = (call = 0) =>
  dialect.sqlToQuery(execute.mock.calls[call][0] as SQL)
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  network: 'testnet',
  status: 'burn_submitted',
  stellar_address: G,
  evm_address: null,
  source_chain_id: 84532,
  source_domain: 6,
  amount: '10000000',
  max_fee: '1560',
  fee_executed: null,
  min_finality_threshold: 1000,
  finality_threshold_executed: null,
  change_trust_tx_hash: null,
  approval_tx_hash: null,
  burn_tx_hash: '0xabc',
  mint_tx_hash: null,
  iris_event_nonce: null,
  message: null,
  attestation: null,
  minted_amount: null,
  error: null,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:01:00.000Z',
  ...over,
})

describe('bridge_transfers repository', () => {
  beforeEach(() => {
    execute.mockReset()
    execute.mockResolvedValue({ rows: [row()] })
  })

  it('maps numeric columns to bigint and keeps nulls', () => {
    const t = rowToTransfer(
      row({ fee_executed: '1300', minted_amount: '99987000' })
    )
    expect(t.amount).toBe(10_000_000n)
    expect(t.maxFee).toBe(1560n)
    expect(t.feeExecuted).toBe(1300n)
    expect(t.mintedAmount).toBe(99_987_000n)
    expect(t.evmAddress).toBeNull()
    expect(t.createdAt.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })

  it('advances in ONE guarded UPDATE: id and the allowed from-statuses', async () => {
    await advanceTransfer('t1', ['burn_submitted'], 'burn_confirmed', {
      evmAddress: '0xdead',
    })
    expect(execute).toHaveBeenCalledTimes(1)
    const { sql, params } = issued()
    expect(flat(sql)).toMatch(
      /^UPDATE bridge_transfers SET status = \$1, updated_at = now\(\)/
    )
    expect(flat(sql)).toMatch(
      /WHERE id = \$\d+ AND status IN \(\$\d+\) RETURNING \*$/
    )
    expect(sql).toContain('"evm_address" = ')
    expect(params).toEqual(['burn_confirmed', '0xdead', 't1', 'burn_submitted'])
  })

  it('returns null when the row was not in an allowed state (stale caller)', async () => {
    execute.mockResolvedValue({ rows: [] })
    const t = await advanceTransfer('t1', ['planned'], 'burn_submitted', {
      burnTxHash: '0xabc',
    })
    expect(t).toBeNull()
  })

  it('serializes bigint patches as decimal strings', async () => {
    await advanceTransfer('t1', ['mint_submitted'], 'completed', {
      mintedAmount: 99_987_000n,
      error: null,
    })
    expect(issued().params).toEqual([
      'completed',
      '99987000',
      null,
      't1',
      'mint_submitted',
    ])
  })

  it('inserts with a lowercase burn hash and returns the stored row', async () => {
    execute.mockResolvedValue({
      rows: [row({ status: 'burn_confirmed', burn_tx_hash: '0xabcdef' })],
    })
    const t = await insertTransfer({
      network: 'testnet',
      status: 'burn_confirmed',
      stellarAddress: G,
      sourceChainId: 84532,
      sourceDomain: 6,
      amount: 10_000_000n,
      maxFee: 1560n,
      minFinalityThreshold: 1000,
      evmAddress: '0xDEAD',
      burnTxHash: '0xABCDEF',
    })
    const { sql, params } = issued()
    expect(flat(sql)).toMatch(/^INSERT INTO bridge_transfers/)
    expect(params).toContain('0xabcdef')
    expect(params).toContain('0xdead')
    expect(params).toContain('10000000')
    expect(t.status).toBe('burn_confirmed')
  })

  it('lists one address on one network, newest first, 20 by default', async () => {
    await listTransfers(G, 'testnet')
    const { sql, params } = issued()
    expect(flat(sql)).toMatch(
      /WHERE stellar_address = \$1 AND network = \$2 ORDER BY created_at DESC LIMIT \$3$/
    )
    expect(params).toEqual([G, 'testnet', 20])
  })

  it('a failed transfer is resumable only once its burn was confirmed', () => {
    const base = rowToTransfer(row())
    expect(isResumable({ ...base, status: 'burn_submitted' })).toBe(true)
    expect(isResumable({ ...base, status: 'planned' })).toBe(false)
    expect(isResumable({ ...base, status: 'completed' })).toBe(false)
    expect(isResumable({ ...base, status: 'failed', evmAddress: null })).toBe(
      false
    )
    expect(
      isResumable({ ...base, status: 'failed', evmAddress: '0xdead' })
    ).toBe(true)
  })

  it('recognizes a Postgres unique violation, wrapped or not', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
  })
})
