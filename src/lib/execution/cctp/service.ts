import { z } from 'zod'

import type {
  StellarNetworkConfig,
  StellarNetworkId,
} from '@/config/stellar-network'
import {
  type ActiveStellarSession,
  StellarSessionError,
} from '@/lib/auth/session-guard'
import {
  type BridgeTransfer,
  type BridgeTransferStatus,
  type NewBridgeTransfer,
  type TransferPatch,
  isUniqueViolation,
} from '@/lib/db/repositories/bridge-transfers'
import { redactRpcSecrets } from '@/lib/evm/redact'
import type { LimitResult } from '@/lib/ratelimit'

import {
  BridgeAmountError,
  assertBridgeAmount,
  evmToStellarAtomic,
  formatStellarAmount,
  formatUsdcAmount,
  maxBridgeAmount,
  parseUsdcAmount,
} from './amounts'
import { planBurn } from './burn'
import {
  type CctpNetworkConfig,
  type CctpSourceChain,
  STELLAR_CCTP_DOMAIN,
} from './config'
import {
  BurnReceiptError,
  type BurnReceiptState,
  type VerifiedBurn,
} from './evm-receipt'
import {
  BridgeFeeError,
  DEFAULT_FAST_MAX_FEE_BPS,
  type IrisFeeTier,
  planBridgeFee,
} from './fees'
import { contractIdToBytes32, decodeForwarderHookData } from './hook'
import type { IrisClient } from './iris'
import { BRIDGE_PAUSED_MESSAGE, isBridgeEnabled } from './kill-switch'
import {
  CctpMessageMismatch,
  type ExpectedCctpTransfer,
  type ParsedCctpMessage,
  isMessageExpired,
  parseCctpMessage,
} from './message'
import {
  MINT_TX_TIMEOUT_SECONDS,
  type MintStatus,
  type MintSubmission,
} from './mint'
import { SignedTxError } from './signed-tx'
import {
  type HorizonAccount,
  type PreflightResult,
  type PreflightState,
  preflightFromAccount,
} from './trustline'
import {
  type ActionResult,
  type BridgeQuote,
  type BridgeTransferView,
  type BurnRequest,
  toView,
} from './view'

type Hex = `0x${string}`

/**
 * A mint still unknown to Soroban after this long did not land: resign it.
 * It must outlast the transaction's validity window, or a transaction could
 * land after the transfer was marked as not found.
 */
export const MINT_PENDING_TIMEOUT_MS = (MINT_TX_TIMEOUT_SECONDS + 30) * 1000

/**
 * A recorded burn whose receipt the source chain still does not know after
 * this long was replaced or dropped in the wallet (sped up, cancelled): stop
 * waiting on its hash. A replacement that did burn is imported by its own hash.
 */
export const BURN_NOT_FOUND_TIMEOUT_MS = 30 * 60 * 1000

export interface BridgeRepository {
  insertTransfer(input: NewBridgeTransfer): Promise<BridgeTransfer>
  findTransfer(
    id: string,
    stellarAddress: string
  ): Promise<BridgeTransfer | null>
  findTransferByBurn(
    sourceDomain: number,
    burnTxHash: string,
    stellarAddress: string
  ): Promise<BridgeTransfer | null>
  listTransfers(
    stellarAddress: string,
    network: StellarNetworkId,
    limit?: number
  ): Promise<BridgeTransfer[]>
  advanceTransfer(
    id: string,
    from: BridgeTransferStatus[],
    to: BridgeTransferStatus,
    patch?: TransferPatch
  ): Promise<BridgeTransfer | null>
  patchTransfer(id: string, patch: TransferPatch): Promise<void>
}

export interface BridgeServiceDeps {
  session(): Promise<ActiveStellarSession>
  limit(address: string): Promise<LimitResult>
  /** The caller's IP, read from the request headers. */
  ip(): Promise<string>
  /** Per-IP limit: a session costs nothing, so the per-address limit alone multiplies with sessions. */
  limitIp(ip: string): Promise<LimitResult>
  network: StellarNetworkConfig
  cctp: CctpNetworkConfig
  env: Record<string, string | undefined>
  repo: BridgeRepository
  feeTiers(sourceDomain: number): Promise<IrisFeeTier[]>
  iris: IrisClient
  horizonAccount(address: string): Promise<HorizonAccount | null>
  changeTrustXdr(address: string): Promise<string>
  /** Throws SignedTxError unless it is our ChangeTrust, signed by `source` on this network. */
  checkSignedChangeTrust(signedXdr: string, source: string): void
  submitClassic(signedXdr: string): Promise<{ hash: string }>
  /** Horizon: a successful tx from `address` holding only a ChangeTrust on this network's USDC. */
  isChangeTrustBy(hash: string, address: string): Promise<boolean>
  burnReceipt(chain: CctpSourceChain, txHash: Hex): Promise<BurnReceiptState>
  /** parseCctpMessage + assertExpectedMessage. */
  verifyMessage(message: Hex, expected: ExpectedCctpTransfer): ParsedCctpMessage
  mint: {
    prepare(input: {
      source: string
      message: Hex
      attestation: Hex
    }): Promise<string>
    check(
      signedXdr: string,
      expected: { source: string; message: Hex; attestation: Hex }
    ): void
    hashOf(signedXdr: string): string
    /** The full fee of a prepared mint (inclusion + resource), in stroops. */
    feeOf(xdr: string): bigint
    alreadyReceived(message: Hex): Promise<boolean>
    /** Sequence of the latest Stellar ledger: what a message expiry is compared with. */
    latestLedger(): Promise<number>
    submit(signedXdr: string, recipient: string): Promise<MintSubmission>
    status(hash: string, recipient: string): Promise<MintStatus>
  }
  now(): number
  log(event: string, data: Record<string, unknown>): void
}

/** A refusal the user can act on: `code` for the UI, `message` shown as is. */
export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

const PREFLIGHT_MESSAGES: Record<Exclude<PreflightState, 'ready'>, string> = {
  unfunded: 'Your Stellar account does not exist yet. Fund it with XLM first.',
  'missing-trustline': 'Add the USDC trustline to your Stellar account first.',
  'insufficient-xlm':
    'Your Stellar account needs more XLM for the reserve and the fees.',
  'limit-too-low':
    'Your USDC trustline limit is too low for this amount. Raise it first.',
  'not-authorized': 'Your USDC trustline is not authorized by the issuer.',
}

const SESSION_MESSAGES: Record<string, string> = {
  'rate-limited': 'Too many requests. Wait a minute and try again.',
  'address-mismatch': 'This transfer belongs to another Stellar account.',
}

const GENERIC = 'Something went wrong. Please try again.'

const MINT_BUSY =
  'The Stellar network is busy. Resume in a minute to sign the mint again.'

const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const Id = z.string().min(1).max(64)
const Amount = z.string().min(1).max(40)
const ChainId = z.number().int().positive()
const SignedXdr = z.string().min(1).max(20_000)

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) throw new BridgeError('invalid-input', 'Invalid request.')
  return r.data
}

function fastMaxFeeBps(env: Record<string, string | undefined>): number {
  const v = Number(env.CCTP_FAST_MAX_FEE_BPS)
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FAST_MAX_FEE_BPS
}

export function createBridgeService(deps: BridgeServiceDeps) {
  const view = (t: BridgeTransfer): BridgeTransferView =>
    toView(t, deps.cctp, deps.network)

  const record = (
    event: string,
    t: BridgeTransfer,
    extra: Record<string, unknown> = {}
  ) =>
    deps.log(event, {
      transferId: t.id,
      network: t.network,
      status: t.status,
      ...extra,
    })

  function failure(err: unknown): { ok: false; error: string; code: string } {
    if (err instanceof BridgeError)
      return { ok: false, error: err.message, code: err.code }
    if (err instanceof StellarSessionError)
      return {
        ok: false,
        code: err.code,
        error:
          SESSION_MESSAGES[err.code] ??
          'Sign in with your Stellar wallet to use the bridge.',
      }
    if (err instanceof BridgeAmountError)
      return { ok: false, code: `amount-${err.code}`, error: err.message }
    if (err instanceof BurnReceiptError)
      return {
        ok: false,
        code: `burn-${err.code}`,
        error: 'This transaction is not a valid CCTP burn.',
      }
    if (err instanceof BridgeFeeError)
      return {
        ok: false,
        code: `fee-${err.code}`,
        error:
          err.code === 'no-tier'
            ? 'Circle has no fee quote for this route right now. Try again later.'
            : 'This amount is too small to cover the transfer fee.',
      }
    if (err instanceof SignedTxError) {
      if (err.code === 'wrong-network') {
        const name = deps.network.id === 'testnet' ? 'Testnet' : 'Mainnet'
        return {
          ok: false,
          code: 'wrong-network',
          error: `Your wallet signed for another Stellar network. Switch it to Stellar ${name} and try again.`,
        }
      }
      return {
        ok: false,
        code: 'invalid-signed-transaction',
        error: 'The signed transaction is not the one LendWise prepared.',
      }
    }
    deps.log('error', {
      message: redactRpcSecrets(err),
    })
    return { ok: false, error: GENERIC, code: 'internal' }
  }

  /**
   * Rate limit on the caller's IP, then session, then rate limit on the
   * session address, then `fn`. Never throws.
   */
  async function authed<T>(
    fn: (session: ActiveStellarSession) => Promise<T>
  ): Promise<ActionResult<T>> {
    try {
      const byIp = await deps.limitIp(await deps.ip())
      if (!byIp.success) throw new StellarSessionError('rate-limited')
      const session = await deps.session()
      const { success } = await deps.limit(session.address)
      if (!success) throw new StellarSessionError('rate-limited')
      return { ok: true, value: await fn(session) }
    } catch (err) {
      return failure(err)
    }
  }

  /** New transfers only: everything that finishes a started one stays open. */
  function assertEnabled() {
    if (!isBridgeEnabled(deps.network.id, deps.env))
      throw new BridgeError('bridge-disabled', BRIDGE_PAUSED_MESSAGE)
  }

  function sourceChain(chainId: number): CctpSourceChain {
    const chain = deps.cctp.sourceChains.find((c) => c.chainId === chainId)
    if (!chain)
      throw new BridgeError(
        'unsupported-chain',
        'This source chain is not supported by the bridge.'
      )
    return chain
  }

  async function load(id: string, address: string): Promise<BridgeTransfer> {
    const t = await deps.repo.findTransfer(id, address)
    if (!t || t.network !== deps.network.id)
      throw new BridgeError('not-found', 'Transfer not found.')
    return t
  }

  /** The row as it is now — after a transition another request won. */
  async function current(t: BridgeTransfer): Promise<BridgeTransfer> {
    return (await deps.repo.findTransfer(t.id, t.stellarAddress)) ?? t
  }

  async function quote(chain: CctpSourceChain, amountInput: string) {
    const amount = parseUsdcAmount(amountInput)
    assertBridgeAmount(amount, deps.network.id, deps.env)
    const tiers = await deps.feeTiers(chain.domain)
    const fee = planBridgeFee(amount, tiers, {
      fastMaxFeeBps: fastMaxFeeBps(deps.env),
    })
    return { amount, fee }
  }

  async function preflight(
    address: string,
    expectedStellarAtomic: bigint
  ): Promise<PreflightResult> {
    const account = await deps.horizonAccount(address)
    return preflightFromAccount(
      account,
      deps.network.usdc,
      expectedStellarAtomic
    )
  }

  function assertReady(result: PreflightResult) {
    if (result.state !== 'ready')
      throw new BridgeError(
        `preflight-${result.state}`,
        PREFLIGHT_MESSAGES[result.state]
      )
  }

  /** Why a confirmed burn is not this bridge's burn to `recipient`, or null. */
  function burnMismatch(
    burn: VerifiedBurn,
    chain: CctpSourceChain,
    recipient: string,
    planned?: { amount: bigint; maxFee: bigint }
  ): string | null {
    const forwarder32 = contractIdToBytes32(deps.cctp.stellar.forwarder)
    if (burn.destinationDomain !== STELLAR_CCTP_DOMAIN)
      return 'destination domain'
    if (burn.burnToken.toLowerCase() !== chain.usdc.toLowerCase())
      return 'burn token'
    if (burn.mintRecipient.toLowerCase() !== forwarder32.toLowerCase())
      return 'mint recipient'
    if (burn.destinationCaller.toLowerCase() !== forwarder32.toLowerCase())
      return 'destination caller'
    if (planned && burn.amount !== planned.amount) return 'amount'
    if (planned && burn.maxFee !== planned.maxFee) return 'max fee'
    try {
      if (decodeForwarderHookData(burn.hookData).recipient !== recipient)
        return 'hook recipient'
    } catch {
      return 'hook data'
    }
    return null
  }

  async function fail(
    t: BridgeTransfer,
    from: BridgeTransferStatus[],
    code: string,
    rawDetail: string,
    patch: TransferPatch = {}
  ): Promise<BridgeTransfer> {
    // viem errors embed the RPC URL, key included: never store or log it.
    const detail = redactRpcSecrets(rawDetail)
    const next = await deps.repo.advanceTransfer(t.id, from, 'failed', {
      ...patch,
      error: `${code}: ${detail}`,
    })
    if (!next) return current(t)
    record('failed', next, { code, detail })
    return next
  }

  async function confirmBurn(
    t: BridgeTransfer,
    session: ActiveStellarSession
  ): Promise<BridgeTransfer> {
    const chain = sourceChain(t.sourceChainId)
    let state: BurnReceiptState
    try {
      state = await deps.burnReceipt(chain, t.burnTxHash as Hex)
    } catch (err) {
      if (err instanceof BurnReceiptError)
        return fail(t, ['burn_submitted'], `burn-${err.code}`, err.message)
      throw err
    }
    if (state.status === 'pending') {
      if (deps.now() - t.updatedAt.getTime() <= BURN_NOT_FOUND_TIMEOUT_MS)
        return t
      // Free the hash, as for a mismatch: the replacement, if it burned, is
      // imported under its own hash. This one stays in the error detail.
      return fail(
        t,
        ['burn_submitted'],
        'burn-not-found',
        `no receipt (burn ${t.burnTxHash})`,
        { burnTxHash: null }
      )
    }
    const mismatch = burnMismatch(state.burn, chain, session.address, t)
    if (mismatch)
      // Free the hash: the unique index would otherwise keep this burn bound
      // to a row that can never use it. The hash stays in the error detail.
      return fail(
        t,
        ['burn_submitted'],
        'burn-mismatch',
        `${mismatch} (burn ${t.burnTxHash})`,
        { burnTxHash: null }
      )
    const next = await deps.repo.advanceTransfer(
      t.id,
      ['burn_submitted'],
      'burn_confirmed',
      { evmAddress: state.burn.from.toLowerCase() }
    )
    if (!next) return current(t)
    record('burn_confirmed', next, {
      burnTxHash: next.burnTxHash,
      evmAddress: next.evmAddress,
    })
    return next
  }

  async function fetchAttestation(t: BridgeTransfer): Promise<BridgeTransfer> {
    const chain = sourceChain(t.sourceChainId)
    const state = await deps.iris.getMessage(chain.domain, t.burnTxHash as Hex)
    if (state.status === 'pending') return t
    let parsed: ParsedCctpMessage
    try {
      parsed = deps.verifyMessage(state.message, {
        sourceDomain: chain.domain,
        burnToken: chain.usdc,
        amount: t.amount,
        maxFee: t.maxFee,
        messageSender: t.evmAddress as Hex,
        stellarRecipient: t.stellarAddress,
        contracts: deps.cctp.stellar,
      })
    } catch (err) {
      if (err instanceof CctpMessageMismatch) {
        deps.log('message_mismatch', {
          transferId: t.id,
          field: err.field,
          detail: err.message,
        })
        return fail(t, [t.status], 'message-mismatch', err.field)
      }
      throw err
    }
    const next = await deps.repo.advanceTransfer(
      t.id,
      ['burn_confirmed', 'failed'],
      'attested',
      {
        message: state.message,
        attestation: state.attestation,
        irisEventNonce: state.eventNonce,
        feeExecuted: parsed.body.feeExecuted,
        finalityThresholdExecuted: parsed.header.finalityThresholdExecuted,
        error: null,
      }
    )
    if (!next) return current(t)
    record('attested', next, {
      irisEventNonce: state.eventNonce,
      finalityThresholdExecuted: parsed.header.finalityThresholdExecuted,
    })
    return next
  }

  async function settleMint(
    t: BridgeTransfer,
    sub: MintStatus
  ): Promise<BridgeTransfer> {
    if (sub.status === 'pending') return t
    if (sub.status === 'failed')
      return fail(t, ['mint_submitted'], 'mint-failed', sub.error)
    const expected = (t.amount - (t.feeExecuted ?? 0n)) * 10n
    const mismatch = sub.mintedAmount !== null && sub.mintedAmount !== expected
    if (mismatch)
      deps.log('minted_amount_mismatch', {
        transferId: t.id,
        expected: expected.toString(),
        minted: String(sub.mintedAmount),
      })
    const next = await deps.repo.advanceTransfer(
      t.id,
      ['mint_submitted'],
      'completed',
      {
        mintedAmount: sub.mintedAmount,
        error: mismatch
          ? `minted-amount-mismatch: expected ${expected}, got ${sub.mintedAmount}`
          : null,
      }
    )
    if (!next) return current(t)
    record('completed', next, {
      mintTxHash: next.mintTxHash,
      mintedAmount: String(next.mintedAmount),
    })
    return next
  }

  async function checkMint(t: BridgeTransfer): Promise<BridgeTransfer> {
    const sub = await deps.mint.status(t.mintTxHash as string, t.stellarAddress)
    if (
      sub.status === 'pending' &&
      deps.now() - t.updatedAt.getTime() > MINT_PENDING_TIMEOUT_MS
    )
      return fail(t, ['mint_submitted'], 'mint-not-found', sub.hash)
    return settleMint(t, sub)
  }

  /** One step forward from the stored state — never more, so each call stays short. */
  async function step(
    t: BridgeTransfer,
    session: ActiveStellarSession
  ): Promise<BridgeTransfer> {
    switch (t.status) {
      case 'burn_submitted':
        return confirmBurn(t, session)
      case 'burn_confirmed':
        return fetchAttestation(t)
      case 'mint_submitted':
        return checkMint(t)
      case 'failed':
        return t.evmAddress && !t.attestation ? fetchAttestation(t) : t
      default:
        return t
    }
  }

  const mintable = (t: BridgeTransfer) =>
    (t.status === 'attested' || t.status === 'failed') &&
    t.message !== null &&
    t.attestation !== null

  return {
    quoteBridge: (input: { sourceChainId: number; amount: string }) =>
      authed<BridgeQuote>(async () => {
        assertEnabled()
        const i = parse(
          z.object({ sourceChainId: ChainId, amount: Amount }),
          input
        )
        const chain = sourceChain(i.sourceChainId)
        const { amount, fee } = await quote(chain, i.amount)
        const cap = maxBridgeAmount(deps.network.id, deps.env)
        return {
          sourceChainId: chain.chainId,
          amount: formatUsdcAmount(amount),
          tier: fee.tier,
          feeBps: fee.feeBps,
          maxFee: formatUsdcAmount(fee.maxFee),
          minimumReceived: formatStellarAmount(fee.minimumReceived),
          cap: cap === null ? null : formatUsdcAmount(cap),
        }
      }),

    preflightBridge: (input: { amount?: string }) =>
      authed(async (session) => {
        const i = parse(z.object({ amount: Amount.optional() }), input)
        // Without an amount: the account alone (exists, XLM, trustline), for
        // the balance on screen. A zero amount never trips the limit check.
        const expected =
          i.amount === undefined
            ? 0n
            : evmToStellarAtomic(parseUsdcAmount(i.amount))
        const result = await preflight(session.address, expected)
        return { ...result, friendbotUrl: deps.network.friendbotUrl }
      }),

    buildChangeTrust: () =>
      authed(async (session) => ({
        xdr: await deps.changeTrustXdr(session.address),
      })),

    submitChangeTrust: (input: { signedXdr: string }) =>
      authed(async (session) => {
        const i = parse(z.object({ signedXdr: SignedXdr }), input)
        deps.checkSignedChangeTrust(i.signedXdr, session.address)
        const { hash } = await deps.submitClassic(i.signedXdr)
        deps.log('change_trust_submitted', {
          stellarAddress: session.address,
          changeTrustTxHash: hash,
        })
        return { hash }
      }),

    createBridgeTransfer: (input: {
      sourceChainId: number
      amount: string
      changeTrustTxHash?: string
    }) =>
      authed<{ transfer: BridgeTransferView; burn: BurnRequest }>(
        async (session) => {
          assertEnabled()
          const i = parse(
            z.object({
              sourceChainId: ChainId,
              amount: Amount,
              changeTrustTxHash: z
                .string()
                .regex(/^[0-9a-f]{64}$/i)
                .optional(),
            }),
            input
          )
          const chain = sourceChain(i.sourceChainId)
          const { amount, fee } = await quote(chain, i.amount)
          assertReady(
            await preflight(session.address, evmToStellarAtomic(amount))
          )
          const plan = planBurn({
            sourceChain: chain,
            amount,
            fee,
            stellarRecipient: session.address,
            contracts: deps.cctp.stellar,
          })
          const changeTrust =
            i.changeTrustTxHash &&
            (await deps.isChangeTrustBy(i.changeTrustTxHash, session.address))
              ? i.changeTrustTxHash.toLowerCase()
              : undefined
          const t = await deps.repo.insertTransfer({
            network: deps.network.id,
            status: 'planned',
            stellarAddress: session.address,
            sourceChainId: chain.chainId,
            sourceDomain: chain.domain,
            amount,
            maxFee: fee.maxFee,
            minFinalityThreshold: fee.minFinalityThreshold,
            changeTrustTxHash: changeTrust,
          })
          record('planned', t, {
            tier: fee.tier,
            maxFee: fee.maxFee.toString(),
            changeTrustTxHash: t.changeTrustTxHash,
          })
          return {
            transfer: view(t),
            burn: {
              chainId: plan.chainId,
              to: plan.to,
              data: plan.data,
              usdc: plan.usdc,
              amount: plan.amount.toString(),
            },
          }
        }
      ),

    recordApproval: (input: { id: string; txHash: Hex }) =>
      authed(async (session) => {
        const i = parse(z.object({ id: Id, txHash: Hash }), input)
        const t = await load(i.id, session.address)
        if (t.status !== 'planned') return view(t)
        await deps.repo.patchTransfer(t.id, {
          approvalTxHash: i.txHash.toLowerCase(),
        })
        const next = await current(t)
        record('approval_submitted', next, {
          approvalTxHash: next.approvalTxHash,
        })
        return view(next)
      }),

    recordBurn: (input: { id: string; txHash: Hex }) =>
      authed(async (session) => {
        const i = parse(z.object({ id: Id, txHash: Hash }), input)
        const hash = i.txHash.toLowerCase()
        const t = await load(i.id, session.address)
        const already = () =>
          new BridgeError(
            'burn-already-recorded',
            'This transfer already has a burn transaction.'
          )
        if (t.burnTxHash) {
          if (t.burnTxHash === hash) return view(t)
          throw already()
        }
        let next: BridgeTransfer | null
        try {
          next = await deps.repo.advanceTransfer(
            t.id,
            ['planned'],
            'burn_submitted',
            {
              burnTxHash: hash,
            }
          )
        } catch (err) {
          if (isUniqueViolation(err)) throw already()
          throw err
        }
        if (!next) {
          const now = await current(t)
          if (now.burnTxHash === hash) return view(now)
          throw already()
        }
        record('burn_submitted', next, { burnTxHash: hash })
        return view(next)
      }),

    refreshBridgeTransfer: (input: { id: string }) =>
      authed(async (session) => {
        const i = parse(z.object({ id: Id }), input)
        const t = await load(i.id, session.address)
        return view(await step(t, session))
      }),

    prepareBridgeMint: (input: { id: string }) =>
      authed<
        | { xdr: string }
        | { alreadyReceived: true; transfer: BridgeTransferView }
      >(async (session) => {
        const i = parse(z.object({ id: Id }), input)
        const t = await load(i.id, session.address)
        if (!mintable(t))
          throw new BridgeError(
            'not-mintable',
            'This transfer is not waiting for a mint.'
          )
        const message = t.message as Hex
        if (await deps.mint.alreadyReceived(message)) {
          const done =
            (await deps.repo.advanceTransfer(
              t.id,
              ['attested', 'failed'],
              'completed',
              {
                error: null,
              }
            )) ?? (await current(t))
          record('already_received', done)
          return { alreadyReceived: true as const, transfer: view(done) }
        }
        // Stopgap: an expired message can no longer be minted. Re-attesting
        // it is a support operation; the transfer keeps its state.
        const { expirationBlock } = parseCctpMessage(message).body
        if (expirationBlock !== 0n) {
          const ledger = await deps.mint.latestLedger()
          if (isMessageExpired(expirationBlock, ledger)) {
            record('message_expired', t, {
              expirationBlock: expirationBlock.toString(),
              ledger,
            })
            throw new BridgeError(
              'message-expired',
              'This attestation has expired. Contact support to finish this transfer.'
            )
          }
        }
        const account = await deps.horizonAccount(session.address)
        const expected = (t.amount - (t.feeExecuted ?? 0n)) * 10n
        const { usdc } = deps.network
        assertReady(preflightFromAccount(account, usdc, expected))
        const xdr = await deps.mint.prepare({
          source: session.address,
          message,
          attestation: t.attestation as Hex,
        })
        // The simulation priced the mint: its full fee must fit the XLM left.
        const funded = preflightFromAccount(
          account,
          usdc,
          expected,
          deps.mint.feeOf(xdr)
        )
        if (funded.state !== 'ready')
          throw new BridgeError(
            `preflight-${funded.state}`,
            `${PREFLIGHT_MESSAGES[funded.state]} The mint needs ${funded.requiredXlm} XLM available; your account has ${funded.availableXlm} XLM.`
          )
        return { xdr }
      }),

    submitBridgeMint: (input: { id: string; signedXdr: string }) =>
      authed(async (session) => {
        const i = parse(z.object({ id: Id, signedXdr: SignedXdr }), input)
        const t = await load(i.id, session.address)
        // Already in flight or done: never submit a second time.
        if (t.status === 'mint_submitted' || t.status === 'completed')
          return view(t)
        if (!mintable(t))
          throw new BridgeError(
            'not-mintable',
            'This transfer is not waiting for a mint.'
          )
        deps.mint.check(i.signedXdr, {
          source: session.address,
          message: t.message as Hex,
          attestation: t.attestation as Hex,
        })
        const hash = deps.mint.hashOf(i.signedXdr)
        // Claim the row first: only the request that wins this transition submits.
        const claimed = await deps.repo.advanceTransfer(
          t.id,
          ['attested', 'failed'],
          'mint_submitted',
          { mintTxHash: hash, error: null }
        )
        if (!claimed) return view(await current(t))
        record('mint_submitted', claimed, { mintTxHash: hash })
        const sub = await deps.mint
          .submit(i.signedXdr, session.address)
          .catch((err: unknown): MintSubmission => {
            deps.log('mint_submit_error', {
              transferId: t.id,
              message: redactRpcSecrets(err),
            })
            return { status: 'pending', hash }
          })
        if (sub.status === 'busy') {
          // Never reached a ledger: free the row for a fresh signature.
          await fail(
            claimed,
            ['mint_submitted'],
            'mint-network-busy',
            sub.error
          )
          throw new BridgeError('mint-network-busy', MINT_BUSY)
        }
        return view(await settleMint(claimed, sub))
      }),

    listBridgeTransfers: () =>
      authed(async (session) =>
        (
          await deps.repo.listTransfers(session.address, deps.network.id, 20)
        ).map(view)
      ),

    importBridgeBurn: (input: { sourceChainId: number; txHash: Hex }) =>
      authed(async (session) => {
        const i = parse(
          z.object({ sourceChainId: ChainId, txHash: Hash }),
          input
        )
        const chain = sourceChain(i.sourceChainId)
        const hash = i.txHash.toLowerCase()
        const existing = await deps.repo.findTransferByBurn(
          chain.domain,
          hash,
          session.address
        )
        if (existing) return view(existing)
        // No amount cap here on purpose: the USDC already burned, so refusing would strand it.
        const state = await deps.burnReceipt(chain, hash as Hex)
        if (state.status === 'pending')
          throw new BridgeError(
            'burn-pending',
            'This burn is not confirmed yet. Try again in a minute.'
          )
        const mismatch = burnMismatch(state.burn, chain, session.address)
        if (mismatch)
          throw new BridgeError(
            'not-a-bridge-burn',
            `This transaction is not a bridge burn to your Stellar address (${mismatch}).`
          )
        try {
          const t = await deps.repo.insertTransfer({
            network: deps.network.id,
            status: 'burn_confirmed',
            stellarAddress: session.address,
            sourceChainId: chain.chainId,
            sourceDomain: chain.domain,
            amount: state.burn.amount,
            maxFee: state.burn.maxFee,
            minFinalityThreshold: state.burn.minFinalityThreshold,
            evmAddress: state.burn.from,
            burnTxHash: hash,
          })
          record('burn_imported', t, {
            burnTxHash: hash,
            evmAddress: t.evmAddress,
          })
          return view(t)
        } catch (err) {
          if (!isUniqueViolation(err)) throw err
          const again = await deps.repo.findTransferByBurn(
            chain.domain,
            hash,
            session.address
          )
          if (again) return view(again)
          throw new BridgeError(
            'burn-already-recorded',
            'This burn belongs to another transfer.'
          )
        }
      }),
  }
}

export type BridgeService = ReturnType<typeof createBridgeService>
