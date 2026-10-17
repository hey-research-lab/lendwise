import { bytesToHex, hexToBytes, pad } from 'viem'

import { STELLAR_CCTP_DOMAIN, cctpConfig } from '../config'
import { contractIdToBytes32, encodeForwarderHookData } from '../hook'
import type { BurnMessageBody, CctpMessageHeader } from '../message'

const mainnet = cctpConfig('mainnet')
const base = mainnet.sourceChains.find((c) => c.slug === 'base')!

/** A coherent Base → Stellar mainnet transfer, the default every test overrides. */
export const MESSAGE_FIXTURE = {
  sourceDomain: base.domain,
  burnToken: base.usdc,
  amount: 25_000_000n,
  maxFee: 3_900n,
  feeExecuted: 3_250n,
  messageSender: '0x1111111111111111111111111111111111111111' as const,
  stellarRecipient: 'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33',
  contracts: mainnet.stellar,
  tokenMessengerV2: base.tokenMessengerV2,
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return out
}

function word(value: bigint | `0x${string}`): Uint8Array {
  return typeof value === 'bigint'
    ? hexToBytes(pad(`0x${value.toString(16)}`, { size: 32 }))
    : hexToBytes(pad(value, { size: 32 }))
}

export function buildMessage(
  overrides: {
    header?: Partial<CctpMessageHeader>
    body?: Partial<BurnMessageBody>
  } = {}
): `0x${string}` {
  const f = MESSAGE_FIXTURE
  const forwarder32 = contractIdToBytes32(f.contracts.forwarder)
  const header: CctpMessageHeader = {
    version: 1,
    sourceDomain: f.sourceDomain,
    destinationDomain: STELLAR_CCTP_DOMAIN,
    nonce: pad('0x2a', { size: 32 }),
    sender: pad(f.tokenMessengerV2, { size: 32 }),
    recipient: contractIdToBytes32(f.contracts.tokenMessengerMinter),
    destinationCaller: forwarder32,
    minFinalityThreshold: 1000,
    finalityThresholdExecuted: 1000,
    ...overrides.header,
  }
  const body: BurnMessageBody = {
    version: 1,
    burnToken: pad(f.burnToken, { size: 32 }),
    mintRecipient: forwarder32,
    amount: f.amount,
    messageSender: pad(f.messageSender, { size: 32 }),
    maxFee: f.maxFee,
    feeExecuted: f.feeExecuted,
    expirationBlock: 0n,
    hookData: encodeForwarderHookData(f.stellarRecipient),
    ...overrides.body,
  }
  const parts = [
    u32(header.version),
    u32(header.sourceDomain),
    u32(header.destinationDomain),
    word(header.nonce),
    word(header.sender),
    word(header.recipient),
    word(header.destinationCaller),
    u32(header.minFinalityThreshold),
    u32(header.finalityThresholdExecuted),
    u32(body.version),
    word(body.burnToken),
    word(body.mintRecipient),
    word(body.amount),
    word(body.messageSender),
    word(body.maxFee),
    word(body.feeExecuted),
    word(body.expirationBlock),
    hexToBytes(body.hookData),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return bytesToHex(out)
}
