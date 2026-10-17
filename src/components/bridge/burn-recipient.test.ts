import { encodeFunctionData, erc20Abi } from 'viem'
import { describe, expect, it } from 'vitest'

import { tokenMessengerV2Abi } from '@/lib/execution/cctp/abis'
import { planBurn } from '@/lib/execution/cctp/burn'
import { cctpConfig } from '@/lib/execution/cctp/config'
import { planBridgeFee } from '@/lib/execution/cctp/fees'

import {
  BURN_UNCHECKABLE,
  SESSION_CHANGED,
  checkBurnRecipient,
} from './burn-recipient'

const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const OTHER_G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const cctp = cctpConfig('testnet')
const chain = cctp.sourceChains.find((c) => c.slug === 'base')!
const AMOUNT = 10_000_000n
const fee = planBridgeFee(AMOUNT, [{ finalityThreshold: 1000, minimumFee: 1 }])

/** The burn as the server builds it for the session's account. */
const burnTo = (recipient: string) =>
  planBurn({
    sourceChain: chain,
    amount: AMOUNT,
    fee,
    stellarRecipient: recipient,
    contracts: cctp.stellar,
  }).data

describe('checkBurnRecipient', () => {
  it('accepts a burn whose hook pays the account on screen', () => {
    expect(checkBurnRecipient(burnTo(G), G)).toEqual({ ok: true })
  })

  it('refuses a burn whose hook pays another account', () => {
    expect(checkBurnRecipient(burnTo(OTHER_G), G)).toEqual({
      ok: false,
      error: SESSION_CHANGED,
    })
    expect(SESSION_CHANGED).toBe(
      'Your Stellar session changed. Reload the page and sign in again.'
    )
  })

  it('refuses data it cannot decode', () => {
    const notABurn = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [chain.tokenMessengerV2, AMOUNT],
    })
    const noHook = encodeFunctionData({
      abi: tokenMessengerV2Abi,
      functionName: 'depositForBurnWithHook',
      args: [
        AMOUNT,
        27,
        `0x${'00'.repeat(32)}`,
        chain.usdc,
        `0x${'00'.repeat(32)}`,
        0n,
        1000,
        '0x',
      ],
    })
    for (const data of ['0x', '0x1234', notABurn, noHook] as const) {
      expect(checkBurnRecipient(data, G)).toEqual({
        ok: false,
        error: BURN_UNCHECKABLE,
      })
    }
  })
})
