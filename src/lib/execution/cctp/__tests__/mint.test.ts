import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  type Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'

import { cctpConfig } from '../config'
import {
  MINT_INCLUSION_FEE_CAP,
  MINT_INCLUSION_FEE_FLOOR,
  type SorobanRpcLike,
  assertSignedMint,
  getMintStatus,
  isMessageAlreadyReceived,
  latestLedgerSequence,
  mintedAmountFromEvents,
  prepareMintXdr,
  submitMint,
} from '../mint'
import { SignedTxError } from '../signed-tx'
import { buildMessage } from './build-message'

const contracts = cctpConfig('mainnet').stellar
const USDC_SAC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
const kp = Keypair.random()
const RECIPIENT = kp.publicKey()
const MESSAGE = buildMessage()
const ATTESTATION = `0x${'aa'.repeat(65)}` as const
const RPC = { url: 'https://rpc.example', headers: {} }

function bytes(hex: `0x${string}`): Buffer {
  return Buffer.from(hex.slice(2), 'hex')
}

function mintXdr(
  opts: {
    passphrase?: string
    contract?: string
    fn?: string
    message?: `0x${string}`
    ops?: number
    source?: Keypair
  } = {}
): string {
  const source = opts.source ?? kp
  const b = new TransactionBuilder(new Account(source.publicKey(), '7'), {
    fee: BASE_FEE,
    networkPassphrase: opts.passphrase ?? Networks.PUBLIC,
  })
  for (let i = 0; i < (opts.ops ?? 1); i++) {
    b.addOperation(
      new Contract(opts.contract ?? contracts.forwarder).call(
        opts.fn ?? 'mint_and_forward',
        xdr.ScVal.scvBytes(bytes(opts.message ?? MESSAGE)),
        xdr.ScVal.scvBytes(bytes(ATTESTATION))
      )
    )
  }
  const tx = b.setTimeout(300).build()
  tx.sign(source)
  return tx.toXDR()
}

function transferEvent(
  contractId: string,
  to: string,
  amount: bigint | { amount: bigint }
) {
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: StrKey.decodeContract(contractId) as unknown as xdr.Hash,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [
          xdr.ScVal.scvSymbol('transfer'),
          new Address(contracts.forwarder).toScVal(),
          new Address(to).toScVal(),
          xdr.ScVal.scvString(
            'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
          ),
        ],
        data:
          typeof amount === 'bigint'
            ? nativeToScVal(amount, { type: 'i128' })
            : nativeToScVal(
                { amount: amount.amount, to_muxed_id: 1n },
                {
                  type: {
                    amount: ['symbol', 'i128'],
                    to_muxed_id: ['symbol', 'u64'],
                  },
                }
              ),
      })
    ),
  })
}

const expected = {
  passphrase: Networks.PUBLIC,
  forwarder: contracts.forwarder,
  source: RECIPIENT,
  message: MESSAGE,
  attestation: ATTESTATION,
}

function codeOf(x: string, exp = expected): string {
  try {
    assertSignedMint(x, exp)
    return 'ok'
  } catch (e) {
    return e instanceof SignedTxError ? e.code : String(e)
  }
}

describe('prepareMintXdr inclusion fee', () => {
  async function feeWith(getFeeStats: () => Promise<unknown>) {
    const server = {
      getAccount: vi.fn(async () => new Account(RECIPIENT, '7')),
      prepareTransaction: vi.fn(async (tx: Transaction) => tx),
      getFeeStats: vi.fn(getFeeStats),
    } as unknown as SorobanRpcLike
    const out = await prepareMintXdr(
      {
        source: RECIPIENT,
        message: MESSAGE,
        attestation: ATTESTATION,
        contracts,
        rpc: RPC,
        passphrase: Networks.PUBLIC,
      },
      { server }
    )
    return TransactionBuilder.fromXDR(out, Networks.PUBLIC).fee
  }
  const stats = (p90: string) => async () => ({
    sorobanInclusionFee: { p90 },
    inclusionFee: { p90: '1' },
    latestLedger: 1,
  })

  it('pins the floor at 10 000 stroops and the cap at 1 000 000', () => {
    expect(MINT_INCLUSION_FEE_FLOOR).toBe(10_000)
    expect(MINT_INCLUSION_FEE_CAP).toBe(1_000_000)
  })

  it('bids the Soroban inclusion fee p90', async () => {
    expect(await feeWith(stats('54321'))).toBe('54321')
  })

  it('never bids under the floor', async () => {
    expect(await feeWith(stats('100'))).toBe('10000')
  })

  it('never bids over the cap, however hot the surge', async () => {
    expect(await feeWith(stats('25000000'))).toBe('1000000')
  })

  it('falls back to the floor when the fee stats cannot be read', async () => {
    expect(
      await feeWith(async () => {
        throw new Error('getFeeStats 503')
      })
    ).toBe('10000')
    expect(await feeWith(stats('not a number'))).toBe('10000')
  })
})

describe('prepareMintXdr', () => {
  it('builds mint_and_forward on the forwarder from the session account, then simulates it', async () => {
    const prepareTransaction = vi.fn(async (tx: Transaction) => tx)
    const server = {
      getAccount: vi.fn(async () => new Account(RECIPIENT, '7')),
      prepareTransaction,
    } as unknown as SorobanRpcLike
    const out = await prepareMintXdr(
      {
        source: RECIPIENT,
        message: MESSAGE,
        attestation: ATTESTATION,
        contracts,
        rpc: RPC,
        passphrase: Networks.PUBLIC,
      },
      { server }
    )
    expect(prepareTransaction).toHaveBeenCalledTimes(1)
    expect(codeOf(signWith(out))).toBe('ok')
  })
})

function signWith(
  unsigned: string,
  signer = kp,
  passphrase = Networks.PUBLIC
): string {
  const tx = TransactionBuilder.fromXDR(unsigned, passphrase) as Transaction
  tx.sign(signer)
  return tx.toXDR()
}

describe('assertSignedMint', () => {
  it('accepts the forwarder call with the stored message and attestation', () => {
    expect(codeOf(mintXdr())).toBe('ok')
  })

  it('names a mint signed for the other network, both ways', () => {
    expect(codeOf(mintXdr({ passphrase: Networks.TESTNET }))).toBe(
      'wrong-network'
    )
    expect(
      codeOf(mintXdr(), { ...expected, passphrase: Networks.TESTNET })
    ).toBe('wrong-network')
  })

  it('refuses another contract, function, payload, source or operation count', () => {
    expect(codeOf(mintXdr({ contract: contracts.messageTransmitter }))).toBe(
      'contract'
    )
    expect(codeOf(mintXdr({ fn: 'receive_message' }))).toBe('function')
    expect(
      codeOf(mintXdr({ message: buildMessage({ body: { amount: 1n } }) }))
    ).toBe('arguments')
    expect(codeOf(mintXdr({ source: Keypair.random() }))).toBe('source')
    expect(codeOf(mintXdr({ ops: 2 }))).toBe('operations')
  })
})

describe('mintedAmountFromEvents', () => {
  const match = { usdcContractId: USDC_SAC, recipient: RECIPIENT }

  it('reads the USDC transfer to the recipient', () => {
    expect(
      mintedAmountFromEvents(
        [transferEvent(USDC_SAC, RECIPIENT, 249_967_500n)],
        match
      )
    ).toBe(249_967_500n)
  })

  it('reads the muxed form of the transfer data', () => {
    expect(
      mintedAmountFromEvents(
        [transferEvent(USDC_SAC, RECIPIENT, { amount: 5n })],
        match
      )
    ).toBe(5n)
  })

  it('ignores other tokens and other recipients, and says null when nothing matched', () => {
    const other = Keypair.random().publicKey()
    const events = [
      transferEvent(contracts.forwarder, RECIPIENT, 1n),
      transferEvent(USDC_SAC, other, 2n),
    ]
    expect(mintedAmountFromEvents(events, match)).toBeNull()
  })
})

describe('submitMint and getMintStatus', () => {
  function server(
    responses: Record<string, unknown>[],
    send: Record<string, unknown> = { status: 'PENDING', hash: 'h1' }
  ) {
    return {
      sendTransaction: vi.fn(async () => send),
      getTransaction: vi.fn(
        async () => responses.shift() ?? { status: 'NOT_FOUND' }
      ),
    } as unknown as SorobanRpcLike
  }
  const deps = (s: SorobanRpcLike, waitMs = 10_000) => ({
    rpc: RPC,
    passphrase: Networks.PUBLIC,
    usdcContractId: USDC_SAC,
    recipient: RECIPIENT,
    server: s,
    waitMs,
    pollIntervalMs: 0,
    sleep: async () => {},
  })

  it('polls until success and reads the minted amount', async () => {
    const s = server([
      { status: 'NOT_FOUND' },
      {
        status: 'SUCCESS',
        events: {
          transactionEventsXdr: [],
          contractEventsXdr: [
            [transferEvent(USDC_SAC, RECIPIENT, 250_000_000n)],
          ],
        },
      },
    ])
    expect(await submitMint(mintXdr(), deps(s))).toEqual({
      status: 'success',
      hash: 'h1',
      mintedAmount: 250_000_000n,
    })
  })

  const rejected = (reason: string) => ({
    status: 'ERROR',
    hash: 'h4',
    errorResult: { result: () => ({ switch: () => ({ name: reason }) }) },
  })

  it('reports a rejected submission as failed', async () => {
    expect(
      (
        await submitMint(
          mintXdr(),
          deps(server([], { status: 'ERROR', hash: 'h2' }))
        )
      ).status
    ).toBe('failed')
    expect(
      await submitMint(mintXdr(), deps(server([], rejected('txBadSeq'))))
    ).toMatchObject({ status: 'failed', hash: 'h4' })
  })

  it('reports a busy network apart, so the mint can be signed again', async () => {
    expect(
      await submitMint(
        mintXdr(),
        deps(server([], { status: 'TRY_AGAIN_LATER', hash: 'h3' }))
      )
    ).toMatchObject({ status: 'busy', hash: 'h3' })
    expect(
      await submitMint(
        mintXdr(),
        deps(server([], rejected('txInsufficientFee')))
      )
    ).toMatchObject({ status: 'busy', hash: 'h4' })
  })

  it('reports a transaction that failed on chain', async () => {
    const s = server([{ status: 'FAILED' }])
    expect(await submitMint(mintXdr(), deps(s))).toMatchObject({
      status: 'failed',
      hash: 'h1',
    })
  })

  it('returns pending when the wait runs out, so a later refresh can finish it', async () => {
    const s = server([{ status: 'NOT_FOUND' }])
    expect(await submitMint(mintXdr(), deps(s, 0))).toEqual({
      status: 'pending',
      hash: 'h1',
    })
  })

  it('reads a single status without polling', async () => {
    const s = server([{ status: 'NOT_FOUND' }])
    expect(await getMintStatus('h9', deps(s))).toEqual({
      status: 'pending',
      hash: 'h9',
    })
  })
})

describe('isMessageAlreadyReceived', () => {
  function simulating(retval: xdr.ScVal | null) {
    const simulateTransaction = vi.fn(async (_tx: Transaction) =>
      retval ? { result: { retval, auth: [] } } : { error: 'HostError: boom' }
    )
    return {
      server: { simulateTransaction } as unknown as SorobanRpcLike,
      simulateTransaction,
    }
  }

  it('asks the message transmitter whether the message nonce is used', async () => {
    const { server, simulateTransaction } = simulating(xdr.ScVal.scvBool(true))
    expect(
      await isMessageAlreadyReceived(
        { message: MESSAGE, contracts, rpc: RPC, passphrase: Networks.PUBLIC },
        { server }
      )
    ).toBe(true)
    const tx = simulateTransaction.mock.calls[0][0]
    const op = tx.operations[0]
    if (op.type !== 'invokeHostFunction') throw new Error(op.type)
    const call = op.func.invokeContract()
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(
      contracts.messageTransmitter
    )
    expect(call.functionName().toString()).toBe('is_nonce_used')
    expect(Buffer.from(call.args()[0].bytes()).toString('hex')).toBe(
      MESSAGE.slice(2 + 24, 2 + 88)
    )
  })

  it('says false for an unused nonce', async () => {
    const { server } = simulating(xdr.ScVal.scvBool(false))
    expect(
      await isMessageAlreadyReceived(
        { message: MESSAGE, contracts, rpc: RPC, passphrase: Networks.PUBLIC },
        { server }
      )
    ).toBe(false)
  })

  it('throws when the simulation fails, rather than guessing', async () => {
    const { server } = simulating(null)
    await expect(
      isMessageAlreadyReceived(
        { message: MESSAGE, contracts, rpc: RPC, passphrase: Networks.PUBLIC },
        { server }
      )
    ).rejects.toThrow(/is_nonce_used/)
  })

  it('refuses a message without an attested nonce', async () => {
    const { server, simulateTransaction } = simulating(xdr.ScVal.scvBool(false))
    const unattested = buildMessage({
      header: { nonce: `0x${'00'.repeat(32)}` },
    })
    await expect(
      isMessageAlreadyReceived(
        {
          message: unattested,
          contracts,
          rpc: RPC,
          passphrase: Networks.PUBLIC,
        },
        { server }
      )
    ).rejects.toThrow(/nonce/)
    expect(simulateTransaction).not.toHaveBeenCalled()
  })
})

describe('latestLedgerSequence', () => {
  it('reads the latest ledger sequence from the Soroban RPC', async () => {
    const server = {
      getLatestLedger: vi.fn(async () => ({ sequence: 61_234_567 })),
    } as unknown as SorobanRpcLike
    expect(await latestLedgerSequence(RPC, { server })).toBe(61_234_567)
  })
})
