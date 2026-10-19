import {
  type Chain,
  type Hex,
  type TransactionReceipt,
  createPublicClient,
  getAddress,
  http,
  parseEventLogs,
} from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  sepolia,
} from 'viem/chains'

import { serverRpc } from '@/config/rpc.server'
import { testnetTransport } from '@/config/testnet-rpc'

import { tokenMessengerV2Abi } from './abis'
import { type CctpSourceChain, STELLAR_CCTP_DOMAIN, cctpConfig } from './config'

export interface VerifiedBurn {
  from: Hex
  burnToken: Hex
  amount: bigint
  maxFee: bigint
  minFinalityThreshold: number
  destinationDomain: number
  mintRecipient: Hex
  destinationCaller: Hex
  hookData: Hex
  blockNumber: bigint
}

export type BurnReceiptState =
  { status: 'pending' } | { status: 'confirmed'; burn: VerifiedBurn }

export class BurnReceiptError extends Error {
  constructor(
    public code:
      'reverted' | 'wrong-contract' | 'no-event' | 'wrong-destination',
    message: string
  ) {
    super(message)
    this.name = 'BurnReceiptError'
  }
}

/** The one PublicClient method this module needs, so tests pass a stub. */
export interface ReceiptReader {
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase()
}

function isNotFound(e: unknown): boolean {
  return (
    (e as { name?: string } | null)?.name === 'TransactionReceiptNotFoundError'
  )
}

export async function verifyBurnReceipt(input: {
  chain: CctpSourceChain
  txHash: Hex
  client: ReceiptReader
}): Promise<BurnReceiptState> {
  const { chain, txHash, client } = input
  let receipt: TransactionReceipt | null
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash })
  } catch (e) {
    if (isNotFound(e)) return { status: 'pending' }
    throw e
  }
  if (!receipt) return { status: 'pending' }

  if (receipt.status !== 'success') {
    throw new BurnReceiptError(
      'reverted',
      'The burn transaction reverted; nothing was burned'
    )
  }
  // `receipt.to` is deliberately not checked: under ERC-4337 it is the EntryPoint.
  // Trust rests on the emitter of the event, not on who called what.
  const all = parseEventLogs({
    abi: tokenMessengerV2Abi,
    eventName: 'DepositForBurn',
    logs: receipt.logs,
  })
  const events = all.filter((l) =>
    sameAddress(l.address, chain.tokenMessengerV2)
  )
  if (events.length === 0 && all.length > 0) {
    throw new BurnReceiptError(
      'wrong-contract',
      'The burn event was not emitted by Circle’s TokenMessenger'
    )
  }
  if (events.length !== 1) {
    throw new BurnReceiptError(
      'no-event',
      'The transaction emitted no single CCTP burn'
    )
  }
  const a = events[0].args
  if (!sameAddress(a.burnToken, chain.usdc)) {
    throw new BurnReceiptError(
      'wrong-contract',
      'The burned token is not the chain’s USDC'
    )
  }
  if (a.destinationDomain !== STELLAR_CCTP_DOMAIN) {
    throw new BurnReceiptError(
      'wrong-destination',
      'The burn is not addressed to Stellar'
    )
  }
  return {
    status: 'confirmed',
    burn: {
      // The depositor is msg.sender of the burn: the EOA, or the smart account under ERC-4337.
      from: getAddress(a.depositor),
      burnToken: getAddress(a.burnToken),
      amount: a.amount,
      maxFee: a.maxFee,
      minFinalityThreshold: a.minFinalityThreshold,
      destinationDomain: a.destinationDomain,
      mintRecipient: a.mintRecipient,
      destinationCaller: a.destinationCaller,
      hookData: a.hookData,
      blockNumber: receipt.blockNumber,
    },
  }
}

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  11155111: sepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
}

/**
 * Server-side reader for a source chain. Mainnet goes through the server RPC
 * key (`serverRpc`, never the browser key); testnets use the public RPCs
 * of `TESTNET_RPC_URLS`, which the provider keys do not cover.
 */
export function burnReceiptClient(chain: CctpSourceChain): ReceiptReader {
  const viemChain = VIEM_CHAINS[chain.chainId]
  if (!viemChain) throw new Error(`No viem chain for ${chain.chainId}`)
  const isTestnet = cctpConfig('testnet').sourceChains.some(
    (c) => c.chainId === chain.chainId
  )
  const rpc = isTestnet ? null : serverRpc(chain.slug)
  return createPublicClient({
    chain: viemChain,
    transport: rpc
      ? http(rpc.url, { fetchOptions: { headers: rpc.headers } })
      : testnetTransport(chain.chainId),
  })
}
