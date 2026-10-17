import { describe, expect, it, vi } from 'vitest'

import { stellarNetwork } from '@/config/stellar-network'
import type { BridgeTransfer } from '@/lib/db/repositories/bridge-transfers'

import { cctpConfig } from './config'

vi.mock('@/lib/db/postgres', () => ({ db: {} }))

const { toView, transferErrorMessage } = await import('./view')

const network = stellarNetwork({ NEXT_PUBLIC_NETWORK: 'testnet' })
const cctp = cctpConfig('testnet')

const row = (over: Partial<BridgeTransfer> = {}): BridgeTransfer => ({
  id: 't1',
  network: 'testnet',
  status: 'burn_confirmed',
  stellarAddress: 'G',
  evmAddress: null,
  sourceChainId: 84532,
  sourceDomain: 6,
  amount: 10_000_000n,
  maxFee: 1560n,
  feeExecuted: null,
  minFinalityThreshold: 1000,
  finalityThresholdExecuted: null,
  changeTrustTxHash: null,
  approvalTxHash: null,
  burnTxHash: null,
  mintTxHash: null,
  irisEventNonce: null,
  message: null,
  attestation: null,
  mintedAmount: null,
  error: null,
  createdAt: new Date('2026-10-20T10:00:00Z'),
  updatedAt: new Date('2026-10-20T10:00:00Z'),
  ...over,
})

describe('toView tier', () => {
  it('derives the requested tier from minFinalityThreshold', () => {
    expect(
      toView(row({ minFinalityThreshold: 1000 }), cctp, network).tier
    ).toBe('fast')
    expect(toView(row({ minFinalityThreshold: 500 }), cctp, network).tier).toBe(
      'fast'
    )
    expect(
      toView(row({ minFinalityThreshold: 2000 }), cctp, network).tier
    ).toBe('standard')
  })

  it('has no executed tier before the attestation', () => {
    expect(toView(row(), cctp, network).tierExecuted).toBeNull()
  })

  it('derives the executed tier, so the UI can show a Fast to Standard fallback', () => {
    const fell = toView(row({ finalityThresholdExecuted: 2000 }), cctp, network)
    expect(fell).toMatchObject({ tier: 'fast', tierExecuted: 'standard' })
    const fast = toView(row({ finalityThresholdExecuted: 1000 }), cctp, network)
    expect(fast.tierExecuted).toBe('fast')
  })

  it('carries no bigint, so a server action can serialise it', () => {
    expect(() =>
      JSON.stringify(
        toView(row({ mintedAmount: 1n, feeExecuted: 1n }), cctp, network)
      )
    ).not.toThrow()
  })
})

describe('toView evmAddress', () => {
  it('carries the account that burned, and null before the burn is verified', () => {
    const burner = '0xe6ebff6b69a58cfba089deb1c47a4dc87c83fbcc'
    expect(toView(row({ evmAddress: burner }), cctp, network).evmAddress).toBe(
      burner
    )
    expect(toView(row(), cctp, network).evmAddress).toBeNull()
  })
})

describe('transferErrorMessage', () => {
  it('promises nothing nobody does on a minted amount mismatch', () => {
    expect(
      transferErrorMessage('minted-amount-mismatch: expected 99987000, got 1')
    ).toBe(
      'USDC arrived, but not the expected amount. Contact support if this persists.'
    )
  })
})
