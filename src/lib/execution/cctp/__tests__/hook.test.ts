import { StrKey } from '@stellar/stellar-sdk'
import { hexToBytes } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  bytes32ToContractId,
  contractIdToBytes32,
  decodeForwarderHookData,
  encodeForwarderHookData,
} from '../hook'

const G = 'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33'
const FORWARDER = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T'

describe('forwarder hook data', () => {
  it('follows Circle’s layout: 24 zero bytes, version 0, length, ASCII strkey', () => {
    const bytes = hexToBytes(encodeForwarderHookData(G))
    expect(bytes.length).toBe(32 + 56)
    expect([...bytes.slice(0, 24)].every((b) => b === 0)).toBe(true)
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(24, false)).toBe(0)
    expect(view.getUint32(28, false)).toBe(56)
    expect(new TextDecoder().decode(bytes.slice(32))).toBe(G)
  })

  it('round-trips recipient and integrator payload', () => {
    const hook = encodeForwarderHookData(G, new Uint8Array([1, 2, 3]))
    expect(decodeForwarderHookData(hook)).toEqual({
      recipient: G,
      payload: '0x010203',
    })
  })

  it('refuses a recipient that is not a Stellar address', () => {
    expect(() =>
      encodeForwarderHookData('0x1111111111111111111111111111111111111111')
    ).toThrow()
  })

  it('refuses malformed hook data', () => {
    const good = hexToBytes(encodeForwarderHookData(G))
    const nonZero = good.slice()
    nonZero[3] = 1
    const badVersion = good.slice()
    new DataView(badVersion.buffer).setUint32(24, 1, false)
    const tooLong = good.slice()
    new DataView(tooLong.buffer).setUint32(28, 999, false)
    const hex = (b: Uint8Array) =>
      `0x${Buffer.from(b).toString('hex')}` as const
    expect(() => decodeForwarderHookData(hex(nonZero))).toThrow(/reserved/)
    expect(() => decodeForwarderHookData(hex(badVersion))).toThrow(/version/)
    expect(() => decodeForwarderHookData(hex(tooLong))).toThrow(/length/)
    expect(() => decodeForwarderHookData('0x00')).toThrow(/32-byte/)
  })
})

describe('contract ids as bytes32', () => {
  it('round-trips a Stellar contract id', () => {
    const b = contractIdToBytes32(FORWARDER)
    expect(b).toBe(
      `0x${Buffer.from(StrKey.decodeContract(FORWARDER)).toString('hex')}`
    )
    expect(bytes32ToContractId(b)).toBe(FORWARDER)
  })

  it('refuses an account id where a contract id is expected', () => {
    expect(() => contractIdToBytes32(G)).toThrow(/contract/)
  })
})
