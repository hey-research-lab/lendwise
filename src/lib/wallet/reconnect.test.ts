import { beforeEach, describe, expect, it } from 'vitest'

import {
  expectReconnect,
  reconnectHint,
  resetExpectedReconnect,
  takeExpectedReconnect,
} from './reconnect'

const EVM_ROW = '0xb0930000000000000000000000000000000a3f28'
const EVM_OTHER = '0xE6ebFf6b69A58CfBa089DEB1c47a4Dc87C83Fbcc'
const STELLAR_ROW = 'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33'
const STELLAR_OTHER = 'GBGGQPLRYAPGBA7JKNOWSQQVDCV23M6UBUWVULBBOZ6GPR4U5UE2BYL7'

describe('expected reconnect', () => {
  beforeEach(() => resetExpectedReconnect())

  it('hands the row address to the next connection of its family, once', () => {
    expectReconnect(EVM_ROW, 'evm', 1_000)
    expect(takeExpectedReconnect('stellar', 2_000)).toBeNull()
    expect(takeExpectedReconnect('evm', 2_000)).toBe(EVM_ROW)
    expect(takeExpectedReconnect('evm', 3_000)).toBeNull()
  })

  it('forgets a request older than two minutes', () => {
    expectReconnect(STELLAR_ROW, 'stellar', 0)
    expect(takeExpectedReconnect('stellar', 120_001)).toBeNull()
  })
})

describe('reconnectHint', () => {
  it('says nothing when the wallet came back on the row address', () => {
    expect(
      reconnectHint({
        expected: EVM_ROW,
        actual: EVM_ROW.toUpperCase().replace('0X', '0x'),
        family: 'evm',
        walletName: 'MetaMask',
      })
    ).toBeNull()
    expect(
      reconnectHint({
        expected: STELLAR_ROW,
        actual: STELLAR_ROW,
        family: 'stellar',
        walletName: 'Freighter',
      })
    ).toBeNull()
  })

  it('names the address the wallet is on and the one to switch to', () => {
    expect(
      reconnectHint({
        expected: EVM_ROW,
        actual: EVM_OTHER,
        family: 'evm',
        walletName: 'MetaMask',
      })
    ).toBe(
      'MetaMask is on 0xE6eb...Fbcc. Switch it to 0xb093...3f28 to reconnect that address.'
    )
    expect(
      reconnectHint({
        expected: STELLAR_ROW,
        actual: STELLAR_OTHER,
        family: 'stellar',
        walletName: 'Freighter',
      })
    ).toBe(
      'Freighter is on GBGGQP...BYL7. Switch it to GDHYIH...KV33 to reconnect that address.'
    )
  })

  it('says nothing without a row to reconnect', () => {
    expect(
      reconnectHint({
        expected: null,
        actual: EVM_OTHER,
        family: 'evm',
        walletName: 'MetaMask',
      })
    ).toBeNull()
  })
})
