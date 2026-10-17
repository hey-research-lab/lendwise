import { StrKey } from '@stellar/stellar-sdk'
import { type Hex, encodeFunctionData } from 'viem'

import { tokenMessengerV2Abi } from './abis'
import {
  type CctpNetworkConfig,
  type CctpSourceChain,
  STELLAR_CCTP_DOMAIN,
  type StellarCctpContracts,
  cctpConfig,
} from './config'
import type { BridgeFeePlan } from './fees'
import { contractIdToBytes32, encodeForwarderHookData } from './hook'

/** True when the chain and the Stellar contracts are the same network's rows of the config table. */
function sameNetwork(
  sourceChain: CctpSourceChain,
  contracts: StellarCctpContracts
): boolean {
  return (['mainnet', 'testnet'] as const).some((n) => {
    const cfg: CctpNetworkConfig = cctpConfig(n)
    return (
      cfg.sourceChains.some(
        (c) =>
          c.chainId === sourceChain.chainId &&
          c.tokenMessengerV2 === sourceChain.tokenMessengerV2 &&
          c.usdc === sourceChain.usdc
      ) &&
      cfg.stellar.forwarder === contracts.forwarder &&
      cfg.stellar.tokenMessengerMinter === contracts.tokenMessengerMinter &&
      cfg.stellar.messageTransmitter === contracts.messageTransmitter
    )
  })
}

export interface BurnPlan {
  chainId: number
  /** TokenMessengerV2 of the source chain. */
  to: Hex
  data: Hex
  usdc: Hex
  amount: bigint
  maxFee: bigint
  minFinalityThreshold: number
  hookData: Hex
  forwarder32: Hex
}

/**
 * The source-chain burn. Both `mintRecipient` and `destinationCaller` are the
 * CctpForwarder: Circle documents that routing either to the user's own
 * address leaves the USDC permanently unrecoverable. The user is reached only
 * through the hook, which the forwarder reads to forward the mint.
 */
export function planBurn(input: {
  sourceChain: CctpSourceChain
  amount: bigint
  fee: BridgeFeePlan
  stellarRecipient: string
  contracts: StellarCctpContracts
}): BurnPlan {
  const { sourceChain, amount, fee, stellarRecipient, contracts } = input
  if (!sameNetwork(sourceChain, contracts)) {
    throw new Error(
      'The source chain and the Stellar contracts are not from the same network'
    )
  }
  if (!StrKey.isValidEd25519PublicKey(stellarRecipient)) {
    throw new Error('The recipient must be a Stellar account (G…)')
  }
  if (amount <= 0n) throw new Error('The burn amount must be positive')
  if (fee.maxFee < 0n || fee.maxFee >= amount) {
    throw new Error('maxFee must be below the burn amount')
  }
  const forwarder32 = contractIdToBytes32(contracts.forwarder)
  const hookData = encodeForwarderHookData(stellarRecipient)
  const data = encodeFunctionData({
    abi: tokenMessengerV2Abi,
    functionName: 'depositForBurnWithHook',
    args: [
      amount,
      STELLAR_CCTP_DOMAIN,
      forwarder32,
      sourceChain.usdc,
      forwarder32,
      fee.maxFee,
      fee.minFinalityThreshold,
      hookData,
    ],
  })
  return {
    chainId: sourceChain.chainId,
    to: sourceChain.tokenMessengerV2,
    data,
    usdc: sourceChain.usdc,
    amount,
    maxFee: fee.maxFee,
    minFinalityThreshold: fee.minFinalityThreshold,
    hookData,
    forwarder32,
  }
}
