import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  type Transaction,
  TransactionBuilder,
  humanizeEvents,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

import type { StellarCctpContracts } from './config'
import { parseCctpMessage } from './message'
import { SignedTxError, parseSignedTransaction } from './signed-tx'

export interface SorobanRpcConnection {
  url: string
  headers: Record<string, string>
}

/** The rpc.Server methods the mint uses, so tests pass a stub. */
export interface SorobanRpcLike {
  getAccount(address: string): Promise<Account>
  prepareTransaction(tx: Transaction): Promise<Transaction>
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>
  simulateTransaction(
    tx: Transaction
  ): Promise<rpc.Api.SimulateTransactionResponse>
  getLatestLedger(): Promise<Pick<rpc.Api.GetLatestLedgerResponse, 'sequence'>>
  getFeeStats(): Promise<rpc.Api.GetFeeStatsResponse>
}

export function sorobanServer(
  connection: SorobanRpcConnection
): SorobanRpcLike {
  return new rpc.Server(connection.url, {
    headers: connection.headers,
    allowHttp: connection.url.startsWith('http://'),
  }) as unknown as SorobanRpcLike
}

/** The user has 5 minutes to sign; past that the server prepares a fresh one. */
export const MINT_TX_TIMEOUT_SECONDS = 300

/** Inclusion fee bounds of the mint, in stroops: 0.001 XLM to 0.1 XLM. */
export const MINT_INCLUSION_FEE_FLOOR = 10_000
export const MINT_INCLUSION_FEE_CAP = 1_000_000

/**
 * The inclusion fee the mint bids, in stroops: the Soroban inclusion fee p90
 * of the recent ledgers, so it lands under surge pricing, within the floor
 * and the cap. Unreadable stats fall back to the floor.
 */
async function mintInclusionFee(server: SorobanRpcLike): Promise<string> {
  let p90: number
  try {
    p90 = Number((await server.getFeeStats()).sorobanInclusionFee.p90)
  } catch {
    return String(MINT_INCLUSION_FEE_FLOOR)
  }
  if (!Number.isFinite(p90)) return String(MINT_INCLUSION_FEE_FLOOR)
  return String(
    Math.min(
      MINT_INCLUSION_FEE_CAP,
      Math.max(MINT_INCLUSION_FEE_FLOOR, Math.ceil(p90))
    )
  )
}

function hexBytes(hex: `0x${string}`): Buffer {
  return Buffer.from(hex.slice(2), 'hex')
}

function mintOperation(
  forwarder: string,
  message: `0x${string}`,
  attestation: `0x${string}`
) {
  return new Contract(forwarder).call(
    'mint_and_forward',
    xdr.ScVal.scvBytes(hexBytes(message)),
    xdr.ScVal.scvBytes(hexBytes(attestation))
  )
}

/**
 * The unsigned, simulated mint the wallet signs. Its source is the session
 * account, which pays the Soroban fee: no LendWise key ever holds funds.
 */
export async function prepareMintXdr(
  input: {
    source: string
    message: `0x${string}`
    attestation: `0x${string}`
    contracts: StellarCctpContracts
    rpc: SorobanRpcConnection
    passphrase: string
  },
  deps: { server?: SorobanRpcLike } = {}
): Promise<string> {
  const server = deps.server ?? sorobanServer(input.rpc)
  const account = await server.getAccount(input.source)
  // Simulation adds the resource fee on top of this inclusion fee.
  const tx = new TransactionBuilder(account, {
    fee: await mintInclusionFee(server),
    networkPassphrase: input.passphrase,
  })
    .addOperation(
      mintOperation(input.contracts.forwarder, input.message, input.attestation)
    )
    .setTimeout(MINT_TX_TIMEOUT_SECONDS)
    .build()
  const prepared = await server.prepareTransaction(tx)
  return prepared.toXDR()
}

/** The sequence of the latest ledger the Soroban RPC knows. */
export async function latestLedgerSequence(
  connection: SorobanRpcConnection,
  deps: { server?: SorobanRpcLike } = {}
): Promise<number> {
  const server = deps.server ?? sorobanServer(connection)
  return (await server.getLatestLedger()).sequence
}

/** Before relaying: exactly the forwarder's mint_and_forward on the stored message, signed by the session account. */
export function assertSignedMint(
  signedXdr: string,
  expected: {
    passphrase: string
    forwarder: string
    source: string
    message: `0x${string}`
    attestation: `0x${string}`
  }
): void {
  const tx = parseSignedTransaction(
    signedXdr,
    expected.passphrase,
    expected.source
  )
  if (tx.operations.length !== 1) {
    throw new SignedTxError('operations', 'Expected exactly one operation')
  }
  const op = tx.operations[0]
  if (op.type !== 'invokeHostFunction') {
    throw new SignedTxError('operation', 'Expected a Soroban contract call')
  }
  if (op.source && op.source !== expected.source) {
    throw new SignedTxError(
      'source',
      'The operation source is not your account'
    )
  }
  if (op.func.switch().name !== 'hostFunctionTypeInvokeContract') {
    throw new SignedTxError('operation', 'Expected a contract invocation')
  }
  const call = op.func.invokeContract()
  if (
    Address.fromScAddress(call.contractAddress()).toString() !==
    expected.forwarder
  ) {
    throw new SignedTxError(
      'contract',
      'The call does not target the CCTP forwarder'
    )
  }
  if (call.functionName().toString() !== 'mint_and_forward') {
    throw new SignedTxError('function', 'The call is not mint_and_forward')
  }
  const args = call.args()
  const isBytes = (v: xdr.ScVal) => v.switch().name === 'scvBytes'
  if (
    args.length !== 2 ||
    !args.every(isBytes) ||
    !Buffer.from(args[0].bytes()).equals(hexBytes(expected.message)) ||
    !Buffer.from(args[1].bytes()).equals(hexBytes(expected.attestation))
  ) {
    throw new SignedTxError(
      'arguments',
      'The call does not carry the attested message'
    )
  }
}

/** Where a mint transaction stands on Stellar. */
export type MintStatus =
  | { status: 'pending'; hash: string }
  | { status: 'success'; hash: string; mintedAmount: bigint | null }
  | { status: 'failed'; hash: string; error: string }

/**
 * What relaying a signed mint gave. `busy`: the network did not take it
 * (TRY_AGAIN_LATER, or an inclusion fee below the surge price); it never
 * reached a ledger, so the user signs a fresh one.
 */
export type MintSubmission =
  MintStatus | { status: 'busy'; hash: string; error: string }

interface MintStatusDeps {
  rpc: SorobanRpcConnection
  usdcContractId: string
  recipient: string
  server?: SorobanRpcLike
}

/**
 * What the recipient received, from the USDC contract's `transfer` event
 * (topics: "transfer", from, to, asset; data: i128 amount, or a map with
 * `amount` for a muxed recipient). Null if no such event — never a guess.
 */
export function mintedAmountFromEvents(
  events: unknown[],
  expected: { usdcContractId: string; recipient: string }
): bigint | null {
  let total: bigint | null = null
  for (const e of humanizeEvents(events as xdr.ContractEvent[])) {
    if (e.contractId !== expected.usdcContractId) continue
    if (e.topics[0] !== 'transfer' || e.topics[2] !== expected.recipient)
      continue
    const amount =
      typeof e.data === 'bigint'
        ? e.data
        : typeof e.data?.amount === 'bigint'
          ? (e.data.amount as bigint)
          : null
    if (amount !== null) total = (total ?? 0n) + amount
  }
  return total
}

export async function getMintStatus(
  hash: string,
  deps: MintStatusDeps
): Promise<MintStatus> {
  const server = deps.server ?? sorobanServer(deps.rpc)
  const res = await server.getTransaction(hash)
  if (res.status === 'SUCCESS') {
    const events = res.events?.contractEventsXdr.flat() ?? []
    return {
      status: 'success',
      hash,
      mintedAmount: mintedAmountFromEvents(events, deps),
    }
  }
  if (res.status === 'FAILED') {
    return {
      status: 'failed',
      hash,
      error: 'The mint transaction failed on Stellar',
    }
  }
  return { status: 'pending', hash }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Relays the signed mint and waits up to `waitMs` (default 20 s) for its
 * result. Still pending after that is not an error: the transfer stays
 * `mint_submitted` and the next refresh reads it with `getMintStatus`.
 */
export async function submitMint(
  signedXdr: string,
  deps: MintStatusDeps & {
    passphrase: string
    waitMs?: number
    pollIntervalMs?: number
    sleep?: (ms: number) => Promise<void>
  }
): Promise<MintSubmission> {
  const server = deps.server ?? sorobanServer(deps.rpc)
  const tx = TransactionBuilder.fromXDR(
    signedXdr,
    deps.passphrase
  ) as Transaction
  const sent = await server.sendTransaction(tx)
  if (sent.status === 'ERROR') {
    const reason = sent.errorResult?.result().switch().name ?? 'unknown'
    if (reason === 'txInsufficientFee') {
      return {
        status: 'busy',
        hash: sent.hash,
        error: `The fee is below the surge price (${reason})`,
      }
    }
    return {
      status: 'failed',
      hash: sent.hash,
      error: `Rejected by the network (${reason})`,
    }
  }
  if (sent.status === 'TRY_AGAIN_LATER') {
    return {
      status: 'busy',
      hash: sent.hash,
      error: 'The network is busy (TRY_AGAIN_LATER)',
    }
  }
  const wait = deps.sleep ?? sleep
  const deadline = Date.now() + (deps.waitMs ?? 20_000)
  for (;;) {
    const status = await getMintStatus(sent.hash, { ...deps, server })
    if (status.status !== 'pending' || Date.now() >= deadline) return status
    await wait(deps.pollIntervalMs ?? 1_000)
  }
}

/**
 * Whether the message was already received on Stellar (by us or anyone: the
 * mint is permissionless). Read-only simulation of the message transmitter's
 * `is_nonce_used`; the source account need not exist for a simulation.
 */
export async function isMessageAlreadyReceived(
  input: {
    message: `0x${string}`
    contracts: StellarCctpContracts
    rpc: SorobanRpcConnection
    passphrase: string
  },
  deps: { server?: SorobanRpcLike } = {}
): Promise<boolean> {
  const nonce = parseCctpMessage(input.message).header.nonce
  if (/^0x0{64}$/.test(nonce)) {
    throw new Error('The message has no attested nonce yet')
  }
  const server = deps.server ?? sorobanServer(input.rpc)
  const tx = new TransactionBuilder(
    new Account(Keypair.random().publicKey(), '0'),
    {
      fee: BASE_FEE,
      networkPassphrase: input.passphrase,
    }
  )
    .addOperation(
      new Contract(input.contracts.messageTransmitter).call(
        'is_nonce_used',
        xdr.ScVal.scvBytes(hexBytes(nonce))
      )
    )
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim) || !('result' in sim) || !sim.result) {
    throw new Error('is_nonce_used simulation failed')
  }
  return scValToNative(sim.result.retval) === true
}
