import { describe, expect, it } from 'vitest'

import { BRIDGE_PAUSED_MESSAGE } from '@/lib/execution/cctp/kill-switch'
import type { PreflightResult } from '@/lib/execution/cctp/trustline'
import type { BridgeQuote, BridgeTransferView } from '@/lib/execution/cctp/view'

import {
  type FormCtaInput,
  type ProgressCtaInput,
  canMint,
  canRetry,
  formCta,
  progressCta,
  visibleMessage,
} from './cta'

const quote: BridgeQuote = {
  sourceChainId: 84532,
  amount: '2',
  tier: 'fast',
  feeBps: 1.3,
  maxFee: '0.000312',
  minimumReceived: '1.999688',
  cap: null,
}

const ready: PreflightResult = {
  state: 'ready',
  availableXlm: '9999.9',
  requiredXlm: '0.1',
  trustline: { balance: '2.9996400', limit: '922337203685.4775807' },
}

const account = (
  state: PreflightResult['state'],
  over: Partial<PreflightResult> = {}
): PreflightResult => ({ ...ready, state, ...over })

function form(over: Partial<FormCtaInput> = {}): FormCtaInput {
  return {
    busy: null,
    pendingBurn: false,
    enabled: true,
    evmConnected: true,
    signedIn: true,
    chainName: 'Base Sepolia',
    amount: '2',
    balance: 18_000_000n,
    cap: null,
    checking: false,
    checkError: null,
    quote,
    preflight: ready,
    friendbot: true,
    ...over,
  }
}

function view(over: Partial<BridgeTransferView> = {}): BridgeTransferView {
  return {
    id: 'id',
    network: 'testnet',
    status: 'attested',
    tier: 'fast',
    tierExecuted: 'fast',
    sourceChainId: 84532,
    evmAddress: '0xe6ebff6b69a58cfba089deb1c47a4dc87c83fbcc',
    amount: '2',
    maxFee: '0.000312',
    feeExecuted: '0.00026',
    mintedAmount: null,
    hashes: { changeTrust: null, approval: null, burn: '0xb', mint: null },
    links: { changeTrust: null, approval: null, burn: null, mint: null },
    error: null,
    resumable: true,
    createdAt: '2026-10-16T18:59:58.075Z',
    ...over,
  }
}

function progress(over: Partial<ProgressCtaInput> = {}): ProgressCtaInput {
  return {
    transfer: view(),
    busy: null,
    pendingBurn: false,
    preflight: null,
    friendbot: true,
    ...over,
  }
}

describe('formCta, one row at a time', () => {
  it.each([
    ['ready', form(), 'Bridge 2 USDC', 'bridge'],
    [
      'an action runs',
      form({ busy: 'Confirm the burn in your wallet…' }),
      'Confirm the burn in your wallet…',
      null,
    ],
    [
      'a burn is not recorded',
      form({ pendingBurn: true }),
      'Record the burn',
      'record-burn',
    ],
    ['paused', form({ enabled: false }), 'Bridge paused', null],
    [
      'no EVM wallet',
      form({ evmConnected: false }),
      'Connect wallet',
      'connect-evm',
    ],
    [
      'no Stellar session',
      form({ signedIn: false }),
      'Sign in with Stellar',
      'connect-stellar',
    ],
    ['no chain', form({ chainName: null }), 'Choose a chain', null],
    ['no amount', form({ amount: '' }), 'Enter amount', null],
    [
      'an unreadable amount',
      form({ amount: '1,5' }),
      'Enter a valid amount',
      null,
    ],
    ['a zero amount', form({ amount: '0' }), 'Enter a valid amount', null],
    [
      'not enough USDC',
      form({ balance: 1_000_000n }),
      'Not enough USDC on Base Sepolia',
      null,
    ],
    [
      'over the cap',
      form({ cap: 1_000_000n }),
      'Max 1 USDC per transfer',
      null,
    ],
    [
      'a check is on its way',
      form({ checking: true }),
      'Getting a quote…',
      null,
    ],
    ['no quote yet', form({ quote: null }), 'Getting a quote…', null],
    [
      'no account check yet',
      form({ preflight: null }),
      'Getting a quote…',
      null,
    ],
    [
      'a refused check',
      form({ checkError: 'Too many requests.' }),
      'Bridge',
      null,
    ],
    [
      'unfunded, with Friendbot',
      form({ preflight: account('unfunded') }),
      'Fund your Stellar account',
      'fund-stellar',
    ],
    [
      'unfunded, without Friendbot',
      form({
        friendbot: false,
        preflight: account('unfunded', { requiredXlm: '1.6' }),
      }),
      'Fund your Stellar account',
      null,
    ],
    [
      'not enough XLM',
      form({ preflight: account('insufficient-xlm') }),
      'Not enough XLM on Stellar',
      null,
    ],
    [
      'no trustline',
      form({ preflight: account('missing-trustline', { trustline: null }) }),
      'Add USDC to your Stellar wallet',
      'add-trustline',
    ],
    [
      'a trustline limit too low',
      form({ preflight: account('limit-too-low') }),
      'Add USDC to your Stellar wallet',
      'add-trustline',
    ],
    [
      'a trustline not authorized',
      form({ preflight: account('not-authorized') }),
      'Bridge',
      null,
    ],
  ] as const)('%s', (_, input, label, action) => {
    const cta = formCta(input)
    expect(cta.label).toBe(label)
    expect(cta.action).toBe(action)
  })

  it('never blocks on a balance it could not read', () => {
    expect(formCta(form({ balance: null })).action).toBe('bridge')
  })

  it('spins only while something is on its way', () => {
    expect(formCta(form({ busy: 'Waiting for the approval…' })).spinner).toBe(
      true
    )
    expect(formCta(form({ checking: true })).spinner).toBe(true)
    expect(formCta(form()).spinner).toBe(false)
    expect(formCta(form({ chainName: null })).spinner).toBe(false)
  })

  it('explains what a label cannot', () => {
    expect(formCta(form({ enabled: false })).hint).toBe(BRIDGE_PAUSED_MESSAGE)
    expect(formCta(form({ amount: '1.1234567' })).hint).toBe(
      'USDC has at most 6 decimals'
    )
    expect(
      formCta(
        form({
          friendbot: false,
          preflight: account('unfunded', { requiredXlm: '1.6' }),
        })
      ).hint
    ).toBe('Send at least 1.6 XLM to this account first.')
    expect(formCta(form({ preflight: account('not-authorized') })).hint).toBe(
      'The USDC issuer has not authorized your trustline.'
    )
    expect(formCta(form()).hint).toBeNull()
  })
})

describe('formCta priority: the earlier row wins', () => {
  it.each([
    [
      'an action over an unrecorded burn',
      form({ busy: 'Recording the burn…', pendingBurn: true }),
      'Recording the burn…',
    ],
    [
      'an unrecorded burn over the pause',
      form({ pendingBurn: true, enabled: false }),
      'Record the burn',
    ],
    [
      'the pause over the EVM wallet',
      form({ enabled: false, evmConnected: false }),
      'Bridge paused',
    ],
    [
      'the EVM wallet over the Stellar session',
      form({ evmConnected: false, signedIn: false }),
      'Connect wallet',
    ],
    [
      'the Stellar session over the chain',
      form({ signedIn: false, chainName: null }),
      'Sign in with Stellar',
    ],
    [
      'the chain over the amount',
      form({ chainName: null, amount: '' }),
      'Choose a chain',
    ],
    [
      'an empty amount over the balance',
      form({ amount: '', balance: 0n }),
      'Enter amount',
    ],
    [
      'a valid amount over the balance',
      form({ amount: 'x', balance: 0n }),
      'Enter a valid amount',
    ],
    [
      'the balance over the cap',
      form({ balance: 1_000_000n, cap: 1_000_000n }),
      'Not enough USDC on Base Sepolia',
    ],
    [
      'the cap over a check on its way',
      form({ cap: 1_000_000n, checking: true }),
      'Max 1 USDC per transfer',
    ],
    [
      'a check on its way over a refused one',
      form({ checking: true, checkError: 'x' }),
      'Getting a quote…',
    ],
    [
      'a refused check over the account',
      form({ checkError: 'x', preflight: account('unfunded') }),
      'Bridge',
    ],
  ] as const)('%s', (_, input, label) => {
    expect(formCta(input).label).toBe(label)
  })
})

describe('progressCta', () => {
  it.each([
    [
      'an action runs',
      progress({ busy: 'Sign the mint in your Stellar wallet…' }),
      'Sign the mint in your Stellar wallet…',
      null,
    ],
    [
      'a burn is not recorded',
      progress({
        transfer: view({
          status: 'planned',
          resumable: false,
          hashes: { changeTrust: null, approval: null, burn: null, mint: null },
        }),
        pendingBurn: true,
      }),
      'Record the burn',
      'record-burn',
    ],
    ['attested', progress(), 'Mint USDC on Stellar', 'mint'],
    [
      'a failed mint, resumable',
      progress({ transfer: view({ status: 'failed' }) }),
      'Mint USDC on Stellar',
      'mint',
    ],
    [
      'attested, account ready',
      progress({ preflight: ready }),
      'Mint USDC on Stellar',
      'mint',
    ],
    [
      'attested, trustline lost',
      progress({
        preflight: account('missing-trustline', { trustline: null }),
      }),
      'Add USDC to your Stellar wallet',
      'add-trustline',
    ],
    [
      'a failed attestation, resumable',
      progress({ transfer: view({ status: 'failed', feeExecuted: null }) }),
      'Retry',
      'retry',
    ],
    [
      'completed',
      progress({
        transfer: view({
          status: 'completed',
          resumable: false,
          mintedAmount: '1.99974',
        }),
      }),
      'View in portfolio',
      'portfolio',
    ],
    [
      'waiting for Circle',
      progress({
        transfer: view({ status: 'burn_confirmed', feeExecuted: null }),
      }),
      "Burn confirmed — waiting for Circle's attestation",
      null,
    ],
    [
      'stopped for good',
      progress({
        transfer: view({
          status: 'failed',
          resumable: false,
          feeExecuted: null,
        }),
      }),
      'Stopped',
      null,
    ],
  ] as const)('%s', (_, input, label, action) => {
    const cta = progressCta(input)
    expect(cta.label).toBe(label)
    expect(cta.action).toBe(action)
  })

  it('puts an action, then an unrecorded burn, before everything else', () => {
    expect(
      progressCta(progress({ busy: 'Recording the burn…', pendingBurn: true }))
        .label
    ).toBe('Recording the burn…')
    expect(progressCta(progress({ pendingBurn: true })).label).toBe(
      'Record the burn'
    )
  })

  it('spins while the server moves the transfer, never on a planned or stopped one', () => {
    expect(
      progressCta(
        progress({
          transfer: view({ status: 'burn_submitted', feeExecuted: null }),
        })
      ).spinner
    ).toBe(true)
    expect(
      progressCta(progress({ transfer: view({ status: 'mint_submitted' }) }))
        .spinner
    ).toBe(true)
    expect(
      progressCta(
        progress({
          transfer: view({
            status: 'planned',
            resumable: false,
            feeExecuted: null,
          }),
        })
      ).spinner
    ).toBe(false)
    expect(
      progressCta(
        progress({
          transfer: view({
            status: 'failed',
            resumable: false,
            feeExecuted: null,
          }),
        })
      ).spinner
    ).toBe(false)
  })
})

describe('canMint and canRetry', () => {
  it('mints once attested, or after a failed mint that can be resumed', () => {
    expect(canMint(view())).toBe(true)
    expect(canMint(view({ status: 'failed' }))).toBe(true)
    expect(canMint(view({ status: 'failed', resumable: false }))).toBe(false)
    expect(canMint(view({ status: 'burn_confirmed' }))).toBe(false)
  })

  it('retries a stopped transfer that has no attestation yet', () => {
    expect(canRetry(view({ status: 'failed', feeExecuted: null }))).toBe(true)
    expect(canRetry(view({ status: 'failed' }))).toBe(false)
    expect(
      canRetry(view({ status: 'failed', resumable: false, feeExecuted: null }))
    ).toBe(false)
  })
})

describe('visibleMessage', () => {
  const none = {
    flowError: null,
    checkError: null,
    warning: null,
    inTransfer: false,
  }
  it('returns null when there is nothing to show', () => {
    expect(visibleMessage(none)).toBeNull()
  })
  it('shows each message alone', () => {
    expect(visibleMessage({ ...none, flowError: 'f' })).toEqual({
      kind: 'error',
      text: 'f',
    })
    expect(visibleMessage({ ...none, checkError: 'c' })).toEqual({
      kind: 'check',
      text: 'c',
    })
    expect(visibleMessage({ ...none, warning: 'w' })).toEqual({
      kind: 'warning',
      text: 'w',
    })
  })
  it('puts the flow error before the check error and the warning', () => {
    expect(
      visibleMessage({ ...none, flowError: 'f', checkError: 'c' })
    ).toEqual({ kind: 'error', text: 'f' })
    expect(visibleMessage({ ...none, flowError: 'f', warning: 'w' })).toEqual({
      kind: 'error',
      text: 'f',
    })
  })
  it('puts the check error before the warning', () => {
    expect(visibleMessage({ ...none, checkError: 'c', warning: 'w' })).toEqual({
      kind: 'check',
      text: 'c',
    })
  })
  it('ignores the check error in a transfer', () => {
    expect(
      visibleMessage({ ...none, checkError: 'c', inTransfer: true })
    ).toBeNull()
    expect(
      visibleMessage({
        ...none,
        checkError: 'c',
        warning: 'w',
        inTransfer: true,
      })
    ).toEqual({ kind: 'warning', text: 'w' })
  })
})
