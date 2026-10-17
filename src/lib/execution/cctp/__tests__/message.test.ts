import { pad } from 'viem'
import { describe, expect, it } from 'vitest'

import { contractIdToBytes32, encodeForwarderHookData } from '../hook'
import {
  CctpMessageMismatch,
  type ExpectedCctpTransfer,
  assertExpectedMessage,
  isMessageExpired,
  parseCctpMessage,
} from '../message'
import { MESSAGE_FIXTURE, buildMessage } from './build-message'

const expected: ExpectedCctpTransfer = {
  sourceDomain: MESSAGE_FIXTURE.sourceDomain,
  burnToken: MESSAGE_FIXTURE.burnToken,
  amount: MESSAGE_FIXTURE.amount,
  maxFee: MESSAGE_FIXTURE.maxFee,
  messageSender: MESSAGE_FIXTURE.messageSender,
  stellarRecipient: MESSAGE_FIXTURE.stellarRecipient,
  contracts: MESSAGE_FIXTURE.contracts,
}

function mismatchField(message: `0x${string}`, exp = expected): string | null {
  try {
    assertExpectedMessage(parseCctpMessage(message), exp)
    return null
  } catch (e) {
    if (e instanceof CctpMessageMismatch) return e.field
    throw e
  }
}

describe('parseCctpMessage', () => {
  it('reads the 148-byte header and the BurnMessageV2 body at Circle’s offsets', () => {
    const m = parseCctpMessage(buildMessage())
    expect(m.header).toMatchObject({
      version: 1,
      sourceDomain: 6,
      destinationDomain: 27,
      minFinalityThreshold: 1000,
      finalityThresholdExecuted: 1000,
      recipient: contractIdToBytes32(
        MESSAGE_FIXTURE.contracts.tokenMessengerMinter
      ),
      destinationCaller: contractIdToBytes32(
        MESSAGE_FIXTURE.contracts.forwarder
      ),
    })
    expect(m.body).toMatchObject({
      version: 1,
      amount: 25_000_000n,
      maxFee: 3_900n,
      feeExecuted: 3_250n,
      mintRecipient: contractIdToBytes32(MESSAGE_FIXTURE.contracts.forwarder),
      hookData: encodeForwarderHookData(MESSAGE_FIXTURE.stellarRecipient),
    })
  })

  it('refuses a message too short to hold a burn body, and non-hex input', () => {
    expect(() => parseCctpMessage(`0x${'00'.repeat(148)}`)).toThrow(/shorter/)
    expect(() => parseCctpMessage('0xzz' as `0x${string}`)).toThrow(/hex/)
  })
})

describe('assertExpectedMessage', () => {
  it('accepts a message that matches the plan', () => {
    expect(mismatchField(buildMessage())).toBeNull()
  })

  it('accepts a Fast burn attested at Standard finality', () => {
    expect(
      mismatchField(
        buildMessage({ header: { finalityThresholdExecuted: 2000 } })
      )
    ).toBeNull()
  })

  it('expects the TokenMessengerMinter, not the forwarder, as header recipient', () => {
    const forwarder32 = contractIdToBytes32(MESSAGE_FIXTURE.contracts.forwarder)
    expect(
      mismatchField(buildMessage({ header: { recipient: forwarder32 } }))
    ).toBe('header.recipient')
  })

  it.each([
    ['header.version', { header: { version: 0 } }],
    ['header.sourceDomain', { header: { sourceDomain: 0 } }],
    ['header.destinationDomain', { header: { destinationDomain: 5 } }],
    ['header.nonce', { header: { nonce: pad('0x0', { size: 32 }) } }],
    [
      'header.destinationCaller',
      { header: { destinationCaller: pad('0x01', { size: 32 }) } },
    ],
    ['body.version', { body: { version: 2 } }],
    [
      'body.burnToken',
      {
        body: {
          burnToken: pad('0x2222222222222222222222222222222222222222', {
            size: 32,
          }),
        },
      },
    ],
    [
      'body.mintRecipient',
      { body: { mintRecipient: pad('0x01', { size: 32 }) } },
    ],
    ['body.amount', { body: { amount: 25_000_001n } }],
    [
      'body.messageSender',
      {
        body: {
          messageSender: pad('0x3333333333333333333333333333333333333333', {
            size: 32,
          }),
        },
      },
    ],
    ['body.maxFee', { body: { maxFee: 4_000n } }],
    ['body.feeExecuted', { body: { feeExecuted: 3_901n } }],
  ] as const)('names %s when it does not match', (field, overrides) => {
    expect(mismatchField(buildMessage(overrides))).toBe(field)
  })

  it('refuses a hook that forwards to another Stellar address', () => {
    const other = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    expect(
      mismatchField(
        buildMessage({ body: { hookData: encodeForwarderHookData(other) } })
      )
    ).toBe('body.hookData')
  })

  it('refuses an unreadable hook', () => {
    expect(mismatchField(buildMessage({ body: { hookData: '0x00' } }))).toBe(
      'body.hookData'
    )
  })

  it('compares EVM addresses case-insensitively', () => {
    expect(
      mismatchField(buildMessage(), {
        ...expected,
        burnToken: expected.burnToken.toLowerCase() as `0x${string}`,
      })
    ).toBeNull()
  })
})

describe('isMessageExpired', () => {
  // stellar-cctp token-messenger-minter-v2 receive.rs:
  // `expiration_block != 0 && expiration_block <= e.ledger().sequence()`
  it('never expires a message with expirationBlock 0', () => {
    expect(isMessageExpired(0n, 1)).toBe(false)
    expect(isMessageExpired(0n, 60_000_000)).toBe(false)
  })

  it('expires once the ledger sequence reaches the expiration block', () => {
    expect(isMessageExpired(100n, 100)).toBe(true)
    expect(isMessageExpired(100n, 101)).toBe(true)
  })

  it('keeps a message valid while the ledger is below the expiration block', () => {
    expect(isMessageExpired(100n, 99)).toBe(false)
  })
})
