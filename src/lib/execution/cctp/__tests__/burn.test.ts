import { decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import { tokenMessengerV2Abi } from '../abis'
import { planBurn } from '../burn'
import { cctpConfig, cctpSourceChain } from '../config'
import { planBridgeFee } from '../fees'
import { contractIdToBytes32, encodeForwarderHookData } from '../hook'

const G = 'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33'
const base = cctpSourceChain(8453, 'mainnet')!
const contracts = cctpConfig('mainnet').stellar
const fee = planBridgeFee(25_000_000n, [
  { finalityThreshold: 1000, minimumFee: 1.3 },
  { finalityThreshold: 2000, minimumFee: 0 },
])

describe('planBurn', () => {
  it('routes mintRecipient and destinationCaller to the forwarder, on domain 27', () => {
    const plan = planBurn({
      sourceChain: base,
      amount: 25_000_000n,
      fee,
      stellarRecipient: G,
      contracts,
    })
    const forwarder32 = contractIdToBytes32(contracts.forwarder)
    const { functionName, args } = decodeFunctionData({
      abi: tokenMessengerV2Abi,
      data: plan.data,
    })
    expect(functionName).toBe('depositForBurnWithHook')
    expect(args).toEqual([
      25_000_000n,
      27,
      forwarder32,
      base.usdc,
      forwarder32,
      fee.maxFee,
      1000,
      encodeForwarderHookData(G),
    ])
    expect(plan).toMatchObject({
      chainId: 8453,
      to: base.tokenMessengerV2,
      usdc: base.usdc,
      amount: 25_000_000n,
      maxFee: fee.maxFee,
      minFinalityThreshold: 1000,
      forwarder32,
    })
  })

  it('refuses a source chain paired with the other network’s contracts', () => {
    const testnetBase = cctpSourceChain(84532, 'testnet')!
    expect(() =>
      planBurn({
        sourceChain: base,
        amount: 25_000_000n,
        fee,
        stellarRecipient: G,
        contracts: cctpConfig('testnet').stellar,
      })
    ).toThrow(/same network/)
    expect(() =>
      planBurn({
        sourceChain: testnetBase,
        amount: 25_000_000n,
        fee,
        stellarRecipient: G,
        contracts,
      })
    ).toThrow(/same network/)
  })

  it('refuses a recipient that is not a Stellar account', () => {
    expect(() =>
      planBurn({
        sourceChain: base,
        amount: 25_000_000n,
        fee,
        stellarRecipient: contracts.forwarder,
        contracts,
      })
    ).toThrow(/Stellar account/)
  })

  it('refuses a maximum fee that is not below the amount', () => {
    expect(() =>
      planBurn({
        sourceChain: base,
        amount: 25_000_000n,
        fee: { ...fee, maxFee: 25_000_000n },
        stellarRecipient: G,
        contracts,
      })
    ).toThrow(/maxFee/)
  })

  it('refuses a non-positive amount', () => {
    expect(() =>
      planBurn({
        sourceChain: base,
        amount: 0n,
        fee: { ...fee, maxFee: 0n },
        stellarRecipient: G,
        contracts,
      })
    ).toThrow(/positive/)
  })
})
