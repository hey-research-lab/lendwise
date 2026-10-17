import { Keypair } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  StellarSessionError,
  assertSessionAddress,
  requireStellarSession,
} from './session-guard'
import { resetLocalSessionStore, revokeStellarSession } from './session-store'
import { signSession } from './stellar-sep10'

const ORIGINAL_ENV = { ...process.env }
const MAINNET = 'Public Global Stellar Network ; September 2015'
const TESTNET = 'Test SDF Network ; September 2015'

let address: string

beforeEach(() => {
  process.env.STELLAR_SEP10_SIGNING_SECRET = Keypair.random().secret()
  process.env.STELLAR_SESSION_SECRET = 'test-session-secret'
  address = Keypair.random().publicKey()
  resetLocalSessionStore()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function token(overrides: { networkPassphrase?: string; sid?: string } = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signSession({
    sid: overrides.sid ?? 'sid-guard-test-000001',
    address,
    networkPassphrase: overrides.networkPassphrase ?? MAINNET,
    issuedAt: now,
    expiresAt: now + 3600,
  })
}

const cookie = (value: string | undefined) => async () => value

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'resolved'
  } catch (e) {
    return e instanceof StellarSessionError ? e.code : 'other'
  }
}

describe('requireStellarSession', () => {
  it('returns the session of a valid cookie', async () => {
    const s = await requireStellarSession({ cookie: cookie(token()) })
    expect(s.address).toBe(address)
    expect(s.sid).toBe('sid-guard-test-000001')
  })

  it('refuses a missing cookie', async () => {
    expect(
      await codeOf(requireStellarSession({ cookie: cookie(undefined) }))
    ).toBe('missing')
  })

  it('refuses a forged cookie', async () => {
    const forged = token().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    expect(
      await codeOf(requireStellarSession({ cookie: cookie(forged) }))
    ).toBe('invalid')
  })

  it("refuses a session of another network than the deployment's", async () => {
    expect(
      await codeOf(
        requireStellarSession({
          cookie: cookie(token({ networkPassphrase: TESTNET })),
        })
      )
    ).toBe('invalid')
  })

  it('refuses a revoked session', async () => {
    const t = token({ sid: 'sid-guard-revoked-0001' })
    await revokeStellarSession(
      'sid-guard-revoked-0001',
      Math.floor(Date.now() / 1000) + 3600
    )
    expect(await codeOf(requireStellarSession({ cookie: cookie(t) }))).toBe(
      'revoked'
    )
  })
})

describe('assertSessionAddress', () => {
  it('refuses another address', () => {
    const s = { address, sid: 'x', expiresAt: 0 }
    expect(() =>
      assertSessionAddress(s, Keypair.random().publicKey())
    ).toThrowError(StellarSessionError)
    expect(() => assertSessionAddress(s, address)).not.toThrow()
  })
})
