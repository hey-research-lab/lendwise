import { describe, expect, it } from 'vitest'

import type { StellarSession, Wallet } from '@/stores/walletStore'

import {
  currentStellarSession,
  isDisplayableActive,
  restoredStellarWalletUpdate,
  shouldClearStellarSession,
  signedInDuringRestore,
} from './stellar-wallets'

const NOW = 1_000_000
const session = (
  address: string,
  overrides: Partial<StellarSession> = {}
): StellarSession => ({
  address,
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  issuedAt: NOW - 100,
  expiresAt: NOW + 100,
  ...overrides,
})

const wallet = (overrides: Partial<Wallet> = {}): Wallet => ({
  address: 'GAAA',
  name: 'w',
  ens: null,
  walletType: null,
  smartContractWalletType: null,
  isActive: true,
  isConnected: true,
  isCurrentlyConnected: true,
  chainFamily: 'stellar',
  avatarUri: '',
  roles: [],
  isUpdating: false,
  ...overrides,
})

describe('restoredStellarWalletUpdate', () => {
  it('restores a sessionless wallet as inactive and disconnected', () => {
    const s = session('GBBB')
    expect(restoredStellarWalletUpdate(wallet({ address: 'GAAA' }), s)).toEqual(
      {
        isConnected: false,
        isCurrentlyConnected: false,
        isActive: false,
        stellarSession: undefined,
      }
    )
    expect(restoredStellarWalletUpdate(wallet(), null)).toMatchObject({
      isConnected: false,
      isActive: false,
    })
  })

  it('keeps the wallet that owns the session', () => {
    const s = session('GAAA')
    expect(restoredStellarWalletUpdate(wallet({ isActive: true }), s)).toEqual({
      isConnected: true,
      isCurrentlyConnected: true,
      stellarSession: s,
    })
    expect(
      restoredStellarWalletUpdate(wallet({ isActive: false }), s)
    ).toMatchObject({ isCurrentlyConnected: false, isConnected: true })
  })
})

describe('isDisplayableActive', () => {
  it('requires a Stellar wallet to hold its own session', () => {
    expect(
      isDisplayableActive(
        wallet({ isConnected: true, stellarSession: undefined })
      )
    ).toBe(false)
    expect(
      isDisplayableActive(wallet({ stellarSession: session('GBBB') }))
    ).toBe(false)
    expect(
      isDisplayableActive(wallet({ stellarSession: session('GAAA') }), NOW)
    ).toBe(true)
    expect(
      isDisplayableActive(
        wallet({ stellarSession: session('GAAA', { expiresAt: NOW }) }),
        NOW
      )
    ).toBe(false)
  })

  it('keeps EVM wallets', () => {
    expect(
      isDisplayableActive(wallet({ chainFamily: 'evm', isConnected: false }))
    ).toBe(true)
  })
})

describe('shouldClearStellarSession', () => {
  it('fails closed', () => {
    expect(shouldClearStellarSession('GAAA', { ok: false })).toBe(true)
    expect(
      shouldClearStellarSession('GAAA', { ok: true, sessionAddress: null })
    ).toBe(true)
    expect(
      shouldClearStellarSession('GAAA', { ok: true, sessionAddress: 'GAAA' })
    ).toBe(true)
  })

  it('skips only when the session belongs to another address', () => {
    expect(
      shouldClearStellarSession('GAAA', { ok: true, sessionAddress: 'GBBB' })
    ).toBe(false)
  })
})

describe('signedInDuringRestore', () => {
  it('does not skip a persisted stale session (unchanged issuedAt)', () => {
    const w = wallet({ stellarSession: session('GAAA') })
    expect(signedInDuringRestore(w, { ...w })).toBe(false)
    // server answers with another address or none: restore update downgrades
    expect(restoredStellarWalletUpdate(w, session('GBBB'))).toMatchObject({
      isConnected: false,
      stellarSession: undefined,
    })
    expect(restoredStellarWalletUpdate(w, null)).toMatchObject({
      isConnected: false,
    })
  })

  it('skips a session issued during the await', () => {
    const before = wallet({ stellarSession: undefined })
    const after = wallet({ stellarSession: session('GAAA') })
    expect(signedInDuringRestore(before, after)).toBe(true)
    expect(
      signedInDuringRestore(
        wallet({ stellarSession: session('GAAA') }),
        wallet({ stellarSession: session('GAAA', { issuedAt: NOW }) })
      )
    ).toBe(true)
    expect(signedInDuringRestore(before, wallet())).toBe(false)
  })
})

describe('currentStellarSession', () => {
  it('picks the newest unexpired Stellar session, the one the cookie holds', () => {
    const older = session('GAAA', { issuedAt: NOW - 500 })
    const newer = session('GBBB', { issuedAt: NOW - 10 })
    const wallets = [
      wallet({ address: 'GAAA', stellarSession: older }),
      wallet({ address: 'GBBB', stellarSession: newer }),
    ]
    expect(currentStellarSession(wallets, NOW)).toBe(newer)
    expect(currentStellarSession([...wallets].reverse(), NOW)).toBe(newer)
  })

  it('skips expired sessions and non-Stellar wallets', () => {
    const expired = session('GBBB', { issuedAt: NOW - 10, expiresAt: NOW })
    const live = session('GAAA', { issuedAt: NOW - 500 })
    expect(
      currentStellarSession(
        [
          wallet({ address: 'GAAA', stellarSession: live }),
          wallet({ address: 'GBBB', stellarSession: expired }),
          wallet({
            address: '0xabc',
            chainFamily: 'evm',
            stellarSession: session('0xabc', { issuedAt: NOW }),
          }),
        ],
        NOW
      )
    ).toBe(live)
    expect(currentStellarSession([wallet()], NOW)).toBeNull()
    expect(currentStellarSession([], NOW)).toBeNull()
  })
})
