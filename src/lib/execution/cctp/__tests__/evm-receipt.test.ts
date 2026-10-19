import {
  type TransactionReceipt,
  encodeAbiParameters,
  encodeEventTopics,
} from 'viem'
import { describe, expect, it } from 'vitest'

import { tokenMessengerV2Abi } from '../abis'
import { cctpConfig, cctpSourceChain } from '../config'
import {
  BurnReceiptError,
  type ReceiptReader,
  verifyBurnReceipt,
} from '../evm-receipt'
import { contractIdToBytes32, encodeForwarderHookData } from '../hook'

const base = cctpSourceChain(8453, 'mainnet')!
const contracts = cctpConfig('mainnet').stellar
const forwarder32 = contractIdToBytes32(contracts.forwarder)
const tmm32 = contractIdToBytes32(contracts.tokenMessengerMinter)
const HOOK = encodeForwarderHookData(
  'GDHYIHAZ5URVB5TUKLREMPFGH4AYMIMON5KHXKKNYLTYGLUECF4OKV33'
)
const TX = `0x${'cd'.repeat(32)}` as const
const PLANNED_FROM = '0x1111111111111111111111111111111111111111'
const OTHER_FROM = '0x2222222222222222222222222222222222222222'
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const BUNDLER = '0x5555555555555555555555555555555555555555'

function depositLog(
  over: {
    burnToken?: `0x${string}`
    domain?: number
    emitter?: `0x${string}`
    depositor?: `0x${string}`
  } = {}
) {
  return {
    address: over.emitter ?? base.tokenMessengerV2,
    topics: encodeEventTopics({
      abi: tokenMessengerV2Abi,
      eventName: 'DepositForBurn',
      args: {
        burnToken: over.burnToken ?? base.usdc,
        depositor: over.depositor ?? PLANNED_FROM,
        minFinalityThreshold: 1000,
      },
    }),
    data: encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes' },
      ],
      [
        25_000_000n,
        forwarder32,
        over.domain ?? 27,
        tmm32,
        forwarder32,
        3_900n,
        HOOK,
      ]
    ),
    blockNumber: 123n,
    logIndex: 0,
    transactionHash: TX,
  }
}

/** Receipts are built loosely (logs carry only what parseEventLogs reads), hence the cast. */
function reader(receipt: Record<string, unknown> | 'not-found'): ReceiptReader {
  return {
    async getTransactionReceipt() {
      if (receipt === 'not-found') {
        throw Object.assign(new Error('not found'), {
          name: 'TransactionReceiptNotFoundError',
        })
      }
      return {
        status: 'success',
        from: PLANNED_FROM,
        to: base.tokenMessengerV2,
        blockNumber: 123n,
        logs: [depositLog()],
        ...receipt,
      } as unknown as TransactionReceipt
    },
  }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'none'
  } catch (e) {
    return e instanceof BurnReceiptError ? e.code : String(e)
  }
}

describe('verifyBurnReceipt', () => {
  it('is pending while the transaction is not mined', async () => {
    expect(
      await verifyBurnReceipt({
        chain: base,
        txHash: TX,
        client: reader('not-found'),
      })
    ).toEqual({
      status: 'pending',
    })
  })

  it('confirms a burn and returns its DepositForBurn fields', async () => {
    const state = await verifyBurnReceipt({
      chain: base,
      txHash: TX,
      client: reader({}),
    })
    expect(state).toEqual({
      status: 'confirmed',
      burn: {
        from: PLANNED_FROM,
        burnToken: base.usdc,
        amount: 25_000_000n,
        maxFee: 3_900n,
        minFinalityThreshold: 1000,
        destinationDomain: 27,
        mintRecipient: forwarder32,
        destinationCaller: forwarder32,
        hookData: HOOK,
        blockNumber: 123n,
      },
    })
  })

  it('reports the event depositor, not the transaction sender', async () => {
    const state = await verifyBurnReceipt({
      chain: base,
      txHash: TX,
      client: reader({
        from: PLANNED_FROM,
        logs: [depositLog({ depositor: OTHER_FROM })],
      }),
    })
    expect(state.status).toBe('confirmed')
    if (state.status === 'confirmed') expect(state.burn.from).toBe(OTHER_FROM)
  })

  it('confirms a smart-account burn relayed through the EntryPoint', async () => {
    const state = await verifyBurnReceipt({
      chain: base,
      txHash: TX,
      client: reader({
        from: BUNDLER,
        to: ENTRY_POINT,
        logs: [depositLog({ depositor: OTHER_FROM })],
      }),
    })
    expect(state.status).toBe('confirmed')
    if (state.status === 'confirmed') expect(state.burn.from).toBe(OTHER_FROM)
  })

  it('refuses a reverted transaction', async () => {
    expect(
      await codeOf(
        verifyBurnReceipt({
          chain: base,
          txHash: TX,
          client: reader({ status: 'reverted' }),
        })
      )
    ).toBe('reverted')
  })

  it('refuses a DepositForBurn emitted by another contract', async () => {
    const logs = [
      depositLog({ emitter: '0x4444444444444444444444444444444444444444' }),
    ]
    expect(
      await codeOf(
        verifyBurnReceipt({ chain: base, txHash: TX, client: reader({ logs }) })
      )
    ).toBe('wrong-contract')
  })

  it('refuses a burn of another token', async () => {
    const logs = [
      depositLog({ burnToken: '0x3333333333333333333333333333333333333333' }),
    ]
    expect(
      await codeOf(
        verifyBurnReceipt({ chain: base, txHash: TX, client: reader({ logs }) })
      )
    ).toBe('wrong-contract')
  })

  it('refuses a receipt without a DepositForBurn from the TokenMessenger', async () => {
    expect(
      await codeOf(
        verifyBurnReceipt({
          chain: base,
          txHash: TX,
          client: reader({ logs: [] }),
        })
      )
    ).toBe('no-event')
    const twice = [depositLog(), depositLog()]
    expect(
      await codeOf(
        verifyBurnReceipt({
          chain: base,
          txHash: TX,
          client: reader({ logs: twice }),
        })
      )
    ).toBe('no-event')
  })

  it('refuses a burn to another CCTP domain', async () => {
    const logs = [depositLog({ domain: 5 })]
    expect(
      await codeOf(
        verifyBurnReceipt({ chain: base, txHash: TX, client: reader({ logs }) })
      )
    ).toBe('wrong-destination')
  })

  it('lets other RPC errors through', async () => {
    const failing: ReceiptReader = {
      async getTransactionReceipt() {
        throw new Error('rpc down')
      },
    }
    await expect(
      verifyBurnReceipt({ chain: base, txHash: TX, client: failing })
    ).rejects.toThrow('rpc down')
  })
})
