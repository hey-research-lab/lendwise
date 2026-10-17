import { type Hex, decodeFunctionData } from 'viem'

import { tokenMessengerV2Abi } from '@/lib/execution/cctp/abis'
import { decodeForwarderHookData } from '@/lib/execution/cctp/hook'

export const SESSION_CHANGED =
  'Your Stellar session changed. Reload the page and sign in again.'

export const BURN_UNCHECKABLE =
  'LendWise could not check where this burn sends the USDC. Reload the page and try again.'

/** The Stellar account the burn's forwarder hook pays, or null when `data` is not such a burn. */
function hookRecipient(data: Hex): string | null {
  try {
    const call = decodeFunctionData({ abi: tokenMessengerV2Abi, data })
    if (call.functionName !== 'depositForBurnWithHook') return null
    return decodeForwarderHookData(call.args[7]).recipient
  } catch {
    return null
  }
}

/**
 * Last check before the EVM wallet signs the burn the server planned. The
 * server encodes the hook for the account of its session cookie, which is
 * not necessarily the account on screen: a cookie replaced since the page
 * loaded (by another tab, or planted by another site) would send the USDC to
 * someone else. The wallet shows the hook as opaque bytes, so the page
 * decodes it and refuses unless it pays `shownAddress`.
 */
export function checkBurnRecipient(
  data: Hex,
  shownAddress: string
): { ok: true } | { ok: false; error: string } {
  const recipient = hookRecipient(data)
  if (recipient === null) return { ok: false, error: BURN_UNCHECKABLE }
  if (recipient !== shownAddress) return { ok: false, error: SESSION_CHANGED }
  return { ok: true }
}
