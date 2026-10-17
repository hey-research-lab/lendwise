import { humanizeEvents, xdr } from '@stellar/stellar-sdk'
import { type Hex, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { STELLAR_NETWORKS } from '@/config/stellar-network'

import { STELLAR_CCTP_DOMAIN, cctpConfig } from '../config'
import {
  contractIdToBytes32,
  decodeForwarderHookData,
  encodeForwarderHookData,
} from '../hook'
import {
  CctpMessageMismatch,
  assertExpectedMessage,
  isMessageExpired,
  parseCctpMessage,
} from '../message'
import { mintedAmountFromEvents } from '../mint'
import appNewUser from './fixtures/testnet-app-base-sepolia-new-user.json'
import appReturningUser from './fixtures/testnet-app-ethereum-sepolia-returning-user.json'
import fast from './fixtures/testnet-mint-arbitrum-sepolia-fast.json'
import standard from './fixtures/testnet-mint-ethereum-sepolia-standard.json'

/**
 * Real Stellar testnet mints by Circle's CCTP forwarder: two third-party
 * transfers, and the first two LendWise transfers made from
 * testnet.lendwise.fi. In each, the message and attestation are the
 * `mint_and_forward` arguments, `iris` is what Circle's Iris sandbox served for
 * the same transfer, and the events are the mint transaction's. Circle's
 * decoder and the chain are the references; nothing here comes from our own
 * encoder.
 */
type MintFixture = typeof fast

const config = cctpConfig('testnet')
const usdcContractId = STELLAR_NETWORKS.testnet.usdc.contractId
const forwarder32 = contractIdToBytes32(config.stellar.forwarder).toLowerCase()
const tmm32 = contractIdToBytes32(
  config.stellar.tokenMessengerMinter
).toLowerCase()

/** The EVM address in the low 20 bytes of a bytes32, checksummed. */
const evm = (word: string): Hex => getAddress(`0x${word.slice(-40)}`)

function forwardEvent(fixture: MintFixture) {
  const events = humanizeEvents(
    fixture.contractEventsXdr.map((e) => xdr.ContractEvent.fromXDR(e, 'base64'))
  )
  const event = events.find(
    (e) =>
      e.contractId === config.stellar.forwarder &&
      e.topics[0] === 'mint_and_forward'
  )
  if (!event) throw new Error(`${fixture.stellarTxHash}: no forwarder event`)
  return event.data as { amount: bigint; forward_recipient: string }
}

describe.each([
  ['Arbitrum Sepolia, Fast', fast],
  ['Ethereum Sepolia, Standard', standard],
  ['LendWise, Base Sepolia, Fast, new user', appNewUser],
  ['LendWise, Ethereum Sepolia, Fast, returning user', appReturningUser],
] as const)('a real testnet mint (%s)', (_, fixture: MintFixture) => {
  const msg = parseCctpMessage(fixture.message as Hex)
  const circle = fixture.iris.decodedMessage
  const body = circle.decodedMessageBody
  const chain = config.sourceChains.find(
    (c) => c.domain === Number(circle.sourceDomain)
  )!
  const forwarded = forwardEvent(fixture)

  it('reads every field the way Circle’s Iris decodes it', () => {
    expect(msg.header).toMatchObject({
      sourceDomain: Number(circle.sourceDomain),
      destinationDomain: STELLAR_CCTP_DOMAIN,
      nonce: circle.nonce,
      minFinalityThreshold: Number(circle.minFinalityThreshold),
      finalityThresholdExecuted: Number(circle.finalityThresholdExecuted),
    })
    expect(Number(circle.destinationDomain)).toBe(STELLAR_CCTP_DOMAIN)
    expect(evm(msg.header.sender)).toBe(getAddress(circle.sender))
    expect(evm(msg.body.burnToken)).toBe(getAddress(body.burnToken))
    expect(evm(msg.body.messageSender)).toBe(getAddress(body.messageSender))
    expect(msg.body).toMatchObject({
      amount: BigInt(body.amount),
      maxFee: BigInt(body.maxFee),
      feeExecuted: BigInt(body.feeExecuted),
      expirationBlock: BigInt(body.expirationBlock),
      hookData: body.hookData,
    })
  })

  it('comes from the chain’s TokenMessengerV2 and burns its USDC', () => {
    expect(chain).toBeDefined()
    expect(evm(msg.header.sender)).toBe(getAddress(chain.tokenMessengerV2))
    expect(evm(msg.body.burnToken)).toBe(getAddress(chain.usdc))
  })

  it('names the Stellar TokenMessengerMinter as recipient and the forwarder as caller and mint recipient', () => {
    // Iris leaves these three null for Stellar: the bytes are the only source.
    expect(msg.header.recipient.toLowerCase()).toBe(tmm32)
    expect(msg.header.destinationCaller.toLowerCase()).toBe(forwarder32)
    expect(msg.body.mintRecipient.toLowerCase()).toBe(forwarder32)
  })

  it('decodes the hook to the account the forwarder paid', () => {
    expect(decodeForwarderHookData(msg.body.hookData as Hex).recipient).toBe(
      forwarded.forward_recipient
    )
  })

  it('carries the hook our burn would build for that account', () => {
    expect(encodeForwarderHookData(forwarded.forward_recipient)).toBe(
      msg.body.hookData
    )
  })

  it('reads the amount received from the USDC transfer event: (amount − fee) × 10', () => {
    const minted = mintedAmountFromEvents(
      fixture.contractEventsXdr.map((e) =>
        xdr.ContractEvent.fromXDR(e, 'base64')
      ),
      { usdcContractId, recipient: forwarded.forward_recipient }
    )
    expect(minted).toBe((msg.body.amount - msg.body.feeExecuted) * 10n)
    expect(minted).toBe(BigInt(forwarded.amount))
  })

  it('passes the check the bridge runs before every mint', () => {
    expect(() =>
      assertExpectedMessage(msg, {
        sourceDomain: chain.domain,
        burnToken: chain.usdc,
        amount: BigInt(body.amount),
        maxFee: BigInt(body.maxFee),
        messageSender: getAddress(body.messageSender),
        stellarRecipient: forwarded.forward_recipient,
        contracts: config.stellar,
      })
    ).not.toThrow()
  })

  it('is refused once its header recipient is changed', () => {
    // Header recipient = bytes 76..108 = hex characters 152..216 after "0x".
    const hex = fixture.message.slice(2)
    const tampered =
      `0x${hex.slice(0, 152)}${'00'.repeat(32)}${hex.slice(216)}` as Hex
    expect(() =>
      assertExpectedMessage(parseCctpMessage(tampered), {
        sourceDomain: chain.domain,
        burnToken: chain.usdc,
        amount: BigInt(body.amount),
        maxFee: BigInt(body.maxFee),
        messageSender: getAddress(body.messageSender),
        stellarRecipient: forwarded.forward_recipient,
        contracts: config.stellar,
      })
    ).toThrow(CctpMessageMismatch)
  })

  it('was not expired at the ledger that minted it', () => {
    expect(isMessageExpired(msg.body.expirationBlock, fixture.ledger)).toBe(
      false
    )
  })
})

describe('attestation expiry on Stellar testnet', () => {
  it('a Fast message carries an expiration ledger, reached about a day after it was minted', () => {
    const { expirationBlock } = parseCctpMessage(fast.message as Hex).body
    expect(expirationBlock).toBeGreaterThan(BigInt(fast.ledger))
    expect(isMessageExpired(expirationBlock, Number(expirationBlock))).toBe(
      true
    )
  })

  it('a Standard message never expires', () => {
    const { expirationBlock } = parseCctpMessage(standard.message as Hex).body
    expect(expirationBlock).toBe(0n)
    expect(isMessageExpired(expirationBlock, standard.ledger + 1_000_000)).toBe(
      false
    )
  })
})
