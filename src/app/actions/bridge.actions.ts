'use server'

import { createBridgeService } from '@/lib/execution/cctp/service'
import { bridgeServiceDeps } from '@/lib/execution/cctp/service-deps.server'

// Thin entry points: every rule (session, rate limit, validation, state
// machine) lives in the service, where it is tested. Built per call so the
// env and the RPC credentials are current.
const bridge = () => createBridgeService(bridgeServiceDeps())

type Hex = `0x${string}`

export async function quoteBridge(input: {
  sourceChainId: number
  amount: string
}) {
  return bridge().quoteBridge(input)
}

export async function preflightBridge(input: { amount?: string }) {
  return bridge().preflightBridge(input)
}

export async function buildChangeTrust() {
  return bridge().buildChangeTrust()
}

export async function submitChangeTrust(input: { signedXdr: string }) {
  return bridge().submitChangeTrust(input)
}

export async function createBridgeTransfer(input: {
  sourceChainId: number
  amount: string
  changeTrustTxHash?: string
}) {
  return bridge().createBridgeTransfer(input)
}

export async function recordApproval(input: { id: string; txHash: Hex }) {
  return bridge().recordApproval(input)
}

export async function recordBurn(input: { id: string; txHash: Hex }) {
  return bridge().recordBurn(input)
}

export async function refreshBridgeTransfer(input: { id: string }) {
  return bridge().refreshBridgeTransfer(input)
}

export async function prepareBridgeMint(input: { id: string }) {
  return bridge().prepareBridgeMint(input)
}

export async function submitBridgeMint(input: {
  id: string
  signedXdr: string
}) {
  return bridge().submitBridgeMint(input)
}

export async function listBridgeTransfers() {
  return bridge().listBridgeTransfers()
}

export async function importBridgeBurn(input: {
  sourceChainId: number
  txHash: Hex
}) {
  return bridge().importBridgeBurn(input)
}
