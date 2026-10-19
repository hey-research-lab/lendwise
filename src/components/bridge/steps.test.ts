import { describe, expect, it } from 'vitest'

import type { BridgeTransferView } from '@/lib/execution/cctp/view'

import {
  BURN_REPLACED_OR_CANCELLED,
  EVM_ACCOUNT_CHANGED,
  attestationNote,
  bridgeSteps,
  burnNotRecordedMessage,
  burnReceiptOutcome,
  canStartNew,
  currentStep,
  elapsedSince,
  formatElapsed,
  replacementImportOutcome,
  sameEvmAccount,
} from './steps'

const view = (over: Partial<BridgeTransferView> = {}): BridgeTransferView => ({
  id: 't1',
  network: 'testnet',
  status: 'planned',
  tier: 'fast',
  tierExecuted: null,
  sourceChainId: 84532,
  evmAddress: null,
  amount: '10',
  maxFee: '0.00156',
  feeExecuted: null,
  mintedAmount: null,
  hashes: { changeTrust: null, approval: null, burn: null, mint: null },
  links: { changeTrust: null, approval: null, burn: null, mint: null },
  error: null,
  resumable: false,
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
})

const states = (t: BridgeTransferView) => bridgeSteps(t).map((s) => s.state)

describe('bridgeSteps', () => {
  it('a planned transfer waits on the approval', () => {
    expect(states(view())).toEqual(['done', 'active', 'todo', 'todo', 'todo'])
  })

  it('waits on the attestation once the burn is confirmed', () => {
    expect(states(view({ status: 'burn_confirmed', resumable: true }))).toEqual(
      ['done', 'done', 'done', 'active', 'todo']
    )
  })

  it('marks every step done when completed', () => {
    expect(states(view({ status: 'completed' }))).toEqual(Array(5).fill('done'))
    expect(currentStep(view({ status: 'completed' }))).toBe(5)
  })

  it('places a failure after the attestation on the mint', () => {
    const t = view({ status: 'failed', resumable: true, feeExecuted: '0.0013' })
    expect(states(t)).toEqual(['done', 'done', 'done', 'done', 'failed'])
  })

  it('places a failed attestation check on the attestation step', () => {
    const t = view({ status: 'failed', resumable: true })
    expect(states(t)).toEqual(['done', 'done', 'done', 'failed', 'todo'])
  })

  it('places a reverted burn on the burn step', () => {
    const t = view({
      status: 'failed',
      resumable: false,
      hashes: { changeTrust: null, approval: null, burn: '0xab', mint: null },
    })
    expect(states(t)).toEqual(['done', 'done', 'failed', 'todo', 'todo'])
  })

  it('carries each step its explorer link', () => {
    const links = {
      changeTrust: 'https://stellar.expert/explorer/testnet/tx/ct',
      approval: 'https://sepolia.basescan.org/tx/0xap',
      burn: 'https://sepolia.basescan.org/tx/0xbu',
      mint: 'https://stellar.expert/explorer/testnet/tx/mi',
    }
    expect(
      bridgeSteps(view({ status: 'completed', links })).map((s) => s.link)
    ).toEqual([links.changeTrust, links.approval, links.burn, null, links.mint])
  })
})

describe('attestationNote', () => {
  it('announces the Standard delay when Standard was requested', () => {
    expect(attestationNote(view({ tier: 'standard' }))).toBe(
      'Standard transfer: ~15–20 min'
    )
  })

  it('signals a fallback when Fast was requested but Standard executed', () => {
    expect(
      attestationNote(view({ tier: 'fast', tierExecuted: 'standard' }))
    ).toBe('Circle fell back to a Standard transfer.')
  })

  it('says nothing for a Fast transfer, attested or not', () => {
    expect(
      attestationNote(view({ tier: 'fast', tierExecuted: null }))
    ).toBeNull()
    expect(
      attestationNote(view({ tier: 'fast', tierExecuted: 'fast' }))
    ).toBeNull()
  })

  it('does not call a Standard transfer a fallback', () => {
    expect(
      attestationNote(view({ tier: 'standard', tierExecuted: 'standard' }))
    ).toBe('Standard transfer: ~15–20 min')
  })
})

describe('elapsed time', () => {
  it('measures from createdAt on the given clock', () => {
    const now = Date.parse('2026-10-20T10:02:05.000Z')
    expect(elapsedSince('2026-10-20T10:00:00.000Z', now)).toBe(125_000)
  })

  it('never goes negative when the client clock is behind', () => {
    const now = Date.parse('2026-10-20T09:59:00.000Z')
    expect(elapsedSince('2026-10-20T10:00:00.000Z', now)).toBe(0)
  })

  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0 s')
    expect(formatElapsed(42_000)).toBe('42 s')
    expect(formatElapsed(125_000)).toBe('2 min 05 s')
    expect(formatElapsed(3_725_000)).toBe('1 h 02 min')
  })
})

describe('canStartNew', () => {
  const pending = { chainId: 84532, hash: '0xab' }
  const burned = { changeTrust: null, approval: null, burn: '0xab', mint: null }

  it('is false without a transfer', () => {
    expect(canStartNew(null, null, null)).toBe(false)
  })

  it('is true for a planned transfer with no burn sent', () => {
    expect(canStartNew(view(), null, null)).toBe(true)
  })

  it('is false once a burn was sent but not recorded', () => {
    expect(canStartNew(view(), pending, null)).toBe(false)
  })

  it('is false while an action runs', () => {
    expect(canStartNew(view(), null, 'Waiting…')).toBe(false)
  })

  it('is false after a recorded burn that is still moving or resumable', () => {
    const t = view({
      status: 'burn_confirmed',
      hashes: burned,
      resumable: true,
    })
    expect(canStartNew(t, null, null)).toBe(false)
  })

  it('is true when completed or after a reverted burn', () => {
    expect(
      canStartNew(view({ status: 'completed', hashes: burned }), null, null)
    ).toBe(true)
    expect(
      canStartNew(
        view({ status: 'failed', hashes: burned, resumable: false }),
        null,
        null
      )
    ).toBe(true)
  })

  it('stays false when completed but a pending burn is unrecorded', () => {
    expect(canStartNew(view({ status: 'completed' }), pending, null)).toBe(
      false
    )
  })
})

describe('burnReceiptOutcome', () => {
  const SENT = `0x${'ab'.repeat(32)}` as const
  const OTHER = `0x${'cd'.repeat(32)}` as const

  it('follows the burn that was sent when the receipt is its own, whatever the case', () => {
    expect(
      burnReceiptOutcome(SENT, {
        transactionHash: SENT.toUpperCase().replace(
          '0X',
          '0x'
        ) as `0x${string}`,
        status: 'success',
      })
    ).toEqual({ kind: 'sent' })
  })

  it('imports the replacement when the wallet sped up or replaced the burn and it succeeded', () => {
    expect(
      burnReceiptOutcome(SENT, { transactionHash: OTHER, status: 'success' })
    ).toEqual({ kind: 'replaced', hash: OTHER })
  })

  it('reads a replacement that reverted as a cancel: nothing left the wallet', () => {
    expect(
      burnReceiptOutcome(SENT, { transactionHash: OTHER, status: 'reverted' })
    ).toEqual({ kind: 'cancelled' })
  })
})

describe('replacementImportOutcome', () => {
  it('switches to the transfer the import returns', () => {
    const t = view({ status: 'burn_confirmed', resumable: true })
    expect(replacementImportOutcome({ ok: true, value: t })).toEqual({
      kind: 'adopt',
      transfer: t,
    })
  })

  it.each(['not-a-bridge-burn', 'burn-no-event', 'burn-wrong-contract'])(
    'reads %s as a cancel: the replacement burned nothing for this bridge',
    (code) => {
      expect(
        replacementImportOutcome({ ok: false, code, error: 'server text' })
      ).toEqual({ kind: 'cancelled' })
    }
  )

  it('surfaces any other refusal, so the replacement can be recorded later', () => {
    expect(
      replacementImportOutcome({
        ok: false,
        code: 'burn-pending',
        error: 'This burn is not confirmed yet. Try again in a minute.',
      })
    ).toEqual({
      kind: 'error',
      message: 'This burn is not confirmed yet. Try again in a minute.',
    })
  })

  it('tells the user the burn was replaced or cancelled and no USDC left', () => {
    expect(BURN_REPLACED_OR_CANCELLED).toBe(
      'Your burn was replaced or cancelled in your wallet; no USDC left it.'
    )
  })
})

describe('sameEvmAccount', () => {
  const OWNER = '0x52908400098527886E0F7030069857D2E4169EE7'

  it('is the same account whatever the checksum casing', () => {
    expect(sameEvmAccount(OWNER, OWNER.toLowerCase())).toBe(true)
  })

  it('refuses another account, or none', () => {
    expect(
      sameEvmAccount(OWNER, '0x8ba1f109551bD432803012645Ac136ddd64DBA72')
    ).toBe(false)
    expect(sameEvmAccount(OWNER, undefined)).toBe(false)
    expect(sameEvmAccount(undefined, undefined)).toBe(false)
  })

  it('tells the user to start again from the amount', () => {
    expect(EVM_ACCOUNT_CHANGED).toBe(
      'Your EVM account changed. Start again from the amount.'
    )
  })
})

describe('burnNotRecordedMessage', () => {
  it('points at the "Record the burn" button, shown above the error', () => {
    expect(burnNotRecordedMessage('0xab', 'Too many requests.')).toBe(
      'Burn sent (0xab) but not recorded: Too many requests. Use “Record the burn” above.'
    )
  })
})
