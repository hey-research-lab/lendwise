import { type Hex, bytesToHex, getAddress, hexToBytes } from 'viem'

import { STELLAR_CCTP_DOMAIN, type StellarCctpContracts } from './config'
import { contractIdToBytes32, decodeForwarderHookData } from './hook'

// CCTP V2 MessageV2 header and BurnMessageV2 body (evm-cctp-contracts, src/messages/v2).
const HEADER_LENGTH = 148
const BODY_FIXED_LENGTH = 228
export const CCTP_MESSAGE_VERSION = 1
export const BURN_MESSAGE_VERSION = 1
const ZERO_32 = `0x${'0'.repeat(64)}`

export interface CctpMessageHeader {
  version: number
  sourceDomain: number
  destinationDomain: number
  nonce: Hex
  sender: Hex
  recipient: Hex
  destinationCaller: Hex
  minFinalityThreshold: number
  finalityThresholdExecuted: number
}

export interface BurnMessageBody {
  version: number
  burnToken: Hex
  mintRecipient: Hex
  amount: bigint
  messageSender: Hex
  maxFee: bigint
  feeExecuted: bigint
  expirationBlock: bigint
  hookData: Hex
}

export interface ParsedCctpMessage {
  header: CctpMessageHeader
  body: BurnMessageBody
}

export interface ExpectedCctpTransfer {
  sourceDomain: number
  burnToken: Hex
  amount: bigint
  maxFee: bigint
  messageSender: Hex
  stellarRecipient: string
  contracts: StellarCctpContracts
}

export class CctpMessageMismatch extends Error {
  constructor(
    public field: string,
    message: string
  ) {
    super(message)
    this.name = 'CctpMessageMismatch'
  }
}

function u32(b: Uint8Array, offset: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(
    offset,
    false
  )
}

function b32(b: Uint8Array, offset: number): Hex {
  return bytesToHex(b.slice(offset, offset + 32))
}

function u256(b: Uint8Array, offset: number): bigint {
  return BigInt(b32(b, offset))
}

/**
 * Parses an attested message as Iris returns it. Iris leaves every address of
 * a Stellar-bound message `null` in `decodedMessage`, so the raw bytes are the
 * only source.
 */
export function parseCctpMessage(message: Hex): ParsedCctpMessage {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(message)) {
    throw new Error('CCTP message must be 0x-prefixed, even-length hex')
  }
  const bytes = hexToBytes(message)
  if (bytes.length < HEADER_LENGTH + BODY_FIXED_LENGTH) {
    throw new Error(
      `CCTP message is ${bytes.length} bytes, shorter than a V2 burn message`
    )
  }
  const body = bytes.slice(HEADER_LENGTH)
  return {
    header: {
      version: u32(bytes, 0),
      sourceDomain: u32(bytes, 4),
      destinationDomain: u32(bytes, 8),
      nonce: b32(bytes, 12),
      sender: b32(bytes, 44),
      recipient: b32(bytes, 76),
      destinationCaller: b32(bytes, 108),
      minFinalityThreshold: u32(bytes, 140),
      finalityThresholdExecuted: u32(bytes, 144),
    },
    body: {
      version: u32(body, 0),
      burnToken: b32(body, 4),
      mintRecipient: b32(body, 36),
      amount: u256(body, 68),
      messageSender: b32(body, 100),
      maxFee: u256(body, 132),
      feeExecuted: u256(body, 164),
      expirationBlock: u256(body, 196),
      hookData: bytesToHex(body.slice(BODY_FIXED_LENGTH)),
    },
  }
}

/**
 * Whether Stellar's TokenMessengerMinter refuses the message as expired at
 * `ledgerSequence`. Same rule as stellar-cctp (token-messenger-minter-v2,
 * receive.rs): `expiration_block != 0 && expiration_block <= e.ledger().sequence()`.
 * On Stellar the "block" is the ledger sequence.
 */
export function isMessageExpired(
  expirationBlock: bigint,
  ledgerSequence: number
): boolean {
  return expirationBlock !== 0n && expirationBlock <= BigInt(ledgerSequence)
}

/** An EVM address stored right-aligned in a bytes32, or null if the high bytes are not zero. */
function evmAddressOf(word: Hex): Hex | null {
  const hex = word.slice(2)
  if (!/^0{24}/.test(hex)) return null
  return getAddress(`0x${hex.slice(24)}`)
}

function sameEvmAddress(word: Hex, address: Hex): boolean {
  return evmAddressOf(word)?.toLowerCase() === address.toLowerCase()
}

/**
 * Every field the mint depends on, checked before anything is signed on Stellar.
 * Not checked on purpose: `finalityThresholdExecuted` — Circle may attest a
 * Fast burn at Standard finality, and that is still a valid transfer.
 */
export function assertExpectedMessage(
  msg: ParsedCctpMessage,
  expected: ExpectedCctpTransfer
): void {
  const fail = (field: string, message: string): never => {
    throw new CctpMessageMismatch(field, message)
  }
  const { header, body } = msg
  const forwarder32 = contractIdToBytes32(
    expected.contracts.forwarder
  ).toLowerCase()
  const tmm32 = contractIdToBytes32(
    expected.contracts.tokenMessengerMinter
  ).toLowerCase()

  if (header.version !== CCTP_MESSAGE_VERSION) {
    fail('header.version', `Unsupported CCTP message version ${header.version}`)
  }
  if (header.sourceDomain !== expected.sourceDomain) {
    fail('header.sourceDomain', 'The message comes from another source chain')
  }
  if (header.destinationDomain !== STELLAR_CCTP_DOMAIN) {
    fail('header.destinationDomain', 'The message is not addressed to Stellar')
  }
  if (header.nonce.toLowerCase() === ZERO_32) {
    fail('header.nonce', 'The message has no attested nonce yet')
  }
  if (header.recipient.toLowerCase() !== tmm32) {
    fail(
      'header.recipient',
      'The message is not for the Stellar TokenMessengerMinter'
    )
  }
  if (header.destinationCaller.toLowerCase() !== forwarder32) {
    fail(
      'header.destinationCaller',
      'Only the CCTP forwarder may receive this message'
    )
  }
  if (body.version !== BURN_MESSAGE_VERSION) {
    fail('body.version', `Unsupported burn message version ${body.version}`)
  }
  if (!sameEvmAddress(body.burnToken, expected.burnToken)) {
    fail('body.burnToken', 'The burned token is not the source chain’s USDC')
  }
  if (body.mintRecipient.toLowerCase() !== forwarder32) {
    fail('body.mintRecipient', 'The mint recipient is not the CCTP forwarder')
  }
  if (body.amount !== expected.amount) {
    fail('body.amount', 'The burned amount differs from the transfer')
  }
  if (!sameEvmAddress(body.messageSender, expected.messageSender)) {
    fail('body.messageSender', 'The burn was sent by another EVM account')
  }
  if (body.maxFee !== expected.maxFee) {
    fail('body.maxFee', 'The burn’s maximum fee differs from the transfer')
  }
  if (body.feeExecuted > body.maxFee) {
    fail('body.feeExecuted', 'The executed fee exceeds the maximum fee')
  }
  let recipient: string | null = null
  try {
    recipient = decodeForwarderHookData(body.hookData).recipient
  } catch (e) {
    fail(
      'body.hookData',
      e instanceof Error ? e.message : 'Unreadable hook data'
    )
  }
  if (recipient !== expected.stellarRecipient) {
    fail(
      'body.hookData',
      'The forwarder would send the USDC to another Stellar account'
    )
  }
}
