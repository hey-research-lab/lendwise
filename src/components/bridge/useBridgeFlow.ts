'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  getAccount,
  readContract,
  sendTransaction,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from '@wagmi/core'
import { erc20Abi, parseUnits } from 'viem'
import { useAccount, useConfig } from 'wagmi'

import {
  buildChangeTrust,
  createBridgeTransfer,
  importBridgeBurn,
  listBridgeTransfers,
  preflightBridge,
  prepareBridgeMint,
  quoteBridge,
  recordApproval,
  recordBurn,
  submitBridgeMint,
  submitChangeTrust,
} from '@/app/actions'
import type { StellarNetworkId } from '@/config/stellar-network'
import { useStellarWallet } from '@/contexts/StellarWalletContext'
import { useBridgeTransfer } from '@/hooks/useBridgeTransfer'
import { cctpConfig, evmTxUrl } from '@/lib/execution/cctp/config'
import type { PreflightResult } from '@/lib/execution/cctp/trustline'
import type { BridgeQuote, BridgeTransferView } from '@/lib/execution/cctp/view'
import { requestPortfolioRefresh } from '@/lib/portfolio/refresh-event'
import { currentStellarSession } from '@/lib/wallet/stellar-wallets'
import { useWalletStore } from '@/stores/walletStore'

import { isUsdcAmount } from './amount-view'
import { type TransferList, transfersOf } from './history'
import {
  BURN_REPLACED_OR_CANCELLED,
  EVM_ACCOUNT_CHANGED,
  burnNotRecordedMessage,
  burnReceiptOutcome,
  canStartNew,
  replacementImportOutcome,
  sameEvmAccount,
} from './steps'

export type Preflight = PreflightResult & { friendbotUrl: string | null }

const QUOTE_DEBOUNCE_MS = 400

/** viem/wagmi errors carry a one-line `shortMessage`; their `message` is a page long. */
function readable(err: unknown): string {
  const short = (err as { shortMessage?: unknown } | null)?.shortMessage
  if (typeof short === 'string') return short
  return err instanceof Error ? err.message : String(err)
}

export interface UseBridgeFlowInput {
  network: StellarNetworkId
  /** `CCTP_BRIDGE_ENABLED`, read on the server: false stops new transfers, never the resume. */
  enabled: boolean
  initialAmount: string | null
  initialSourceChainId: number | null
  /** The link carried an `amount` that could not be read. */
  linkAmountInvalid: boolean
}

/**
 * Everything the bridge widget does, without its markup: inputs, quote and
 * account check, the transfer's actions and their safeguards. The transfer
 * actions were moved unchanged from the former `BridgeFlow` component, except
 * where spec 0007 says otherwise.
 */
export function useBridgeFlow({
  network,
  enabled,
  initialAmount,
  initialSourceChainId,
  linkAmountInvalid,
}: UseBridgeFlowInput) {
  const config = useConfig()
  const { isConnected: evmConnected, address: evmAddress } = useAccount()
  const { signTransaction } = useStellarWallet()
  const { wallets } = useWalletStore()
  const chains = useMemo(() => cctpConfig(network).sourceChains, [network])

  // The recipient is always the signed-in Stellar account (SEP-10 session):
  // the newest one, which the server cookie holds.
  const session = useMemo(() => currentStellarSession(wallets), [wallets])
  const sessionAddress = session?.address ?? null

  // No silent fallback: without a valid `source` the user must choose.
  const [sourceChainId, setSourceChainIdValue] = useState<number | null>(
    initialSourceChainId
  )
  const [amount, setAmountValue] = useState(initialAmount ?? '')
  // The link's amount could not be read; cleared by the first edit.
  const [amountLinkInvalid, setAmountLinkInvalid] = useState(linkAmountInvalid)
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  // Bumped to run the quote and the account check again.
  const [checkTick, setCheckTick] = useState(0)
  const [changeTrustHash, setChangeTrustHash] = useState<string | null>(null)
  // Tagged with the account it was listed for: after an account switch, the
  // previous account's transfers never show, even when their response lands late.
  const [transferList, setTransferList] = useState<TransferList | null>(null)
  // Only the newest list request may write: responses can land out of order.
  const listRequest = useRef(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  // A burn the wallet sent that the server has not recorded yet. While set, no
  // second burn can start and the hash stays on screen.
  const [pendingBurn, setPendingBurn] = useState<{
    chainId: number
    hash: string
  } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const {
    transfer,
    setTransfer,
    refresh,
    error: refreshError,
  } = useBridgeTransfer()
  const hasTransfer = transfer !== null

  // The transfer on screen belongs to the Stellar account it was loaded under:
  // another account (sign out, sign in) must not inherit it. `pendingBurn`
  // stays, so the form keeps "Record the burn" first.
  const transferOwner = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionAddress) return
    if (transfer && transferOwner.current === null)
      transferOwner.current = sessionAddress
    if (transferOwner.current === null) return
    if (transferOwner.current !== sessionAddress) {
      transferOwner.current = null
      setTransfer(null)
      setPreflight(null)
      setChangeTrustHash(null)
    }
  }, [sessionAddress, transfer, setTransfer])
  const pendingBurnChain = pendingBurn
    ? chains.find((c) => c.chainId === pendingBurn.chainId)
    : undefined
  const pendingBurnUrl =
    pendingBurn && pendingBurnChain
      ? evmTxUrl(pendingBurnChain, pendingBurn.hash)
      : null

  const setSourceChainId = (chainId: number) => {
    setFlowError(null)
    setSourceChainIdValue(chainId)
  }

  const setAmount = (value: string) => {
    setFlowError(null)
    setAmountLinkInvalid(false)
    setAmountValue(value.trim())
  }

  // Quote and account check follow the inputs, debounced, while no transfer
  // runs. The account check needs only the Stellar session: without a valid
  // amount it still gives the Receive balance and the account's state.
  useEffect(() => {
    setQuote(null)
    setPreflight(null)
    setCheckError(null)
    if (!enabled || !sessionAddress || hasTransfer) {
      setChecking(false)
      return
    }
    const validAmount = isUsdcAmount(amount)
    const chainId = sourceChainId
    setChecking(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const [q, p] = await Promise.all([
          validAmount && chainId !== null
            ? quoteBridge({ sourceChainId: chainId, amount })
            : Promise.resolve(null),
          preflightBridge(validAmount ? { amount } : {}),
        ])
        if (cancelled) return
        if (q && !q.ok) return setCheckError(q.error)
        if (!p.ok) return setCheckError(p.error)
        setQuote(q ? q.value : null)
        setPreflight(p.value)
      } catch (err) {
        if (!cancelled) setCheckError(readable(err))
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, QUOTE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, sessionAddress, amount, sourceChainId, hasTransfer, checkTick])

  const reloadTransfers = useCallback(async () => {
    const request = ++listRequest.current
    if (!sessionAddress) return setTransferList(null)
    const r = await listBridgeTransfers()
    if (r.ok && request === listRequest.current)
      setTransferList({ owner: sessionAddress, list: r.value })
  }, [sessionAddress])
  const transfers = transfersOf(transferList, sessionAddress)

  // The session's transfers, reloaded whenever the one on screen changes state.
  useEffect(() => {
    void reloadTransfers()
  }, [reloadTransfers, transfer?.status])

  useEffect(() => {
    if (transfer?.status === 'completed') requestPortfolioRefresh()
  }, [transfer?.status])

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setFlowError(null)
    setWarning(null)
    try {
      await fn()
    } catch (err) {
      setFlowError(readable(err))
    } finally {
      setBusy(null)
    }
  }

  const recheck = useCallback(async (forAmount: string) => {
    const p = await preflightBridge({ amount: forAmount })
    if (p.ok) setPreflight(p.value)
  }, [])

  // Back on the tab (Friendbot, a wallet, an explorer): check the account
  // again. This is the "Check again" the page lacked.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || busy !== null) return
      if (!transfer) return setCheckTick((n) => n + 1)
      if (preflight && preflight.state !== 'ready')
        void recheck(transfer.amount)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [busy, transfer, preflight, recheck])

  const addTrustline = () =>
    run('Sign the USDC trustline in your Stellar wallet…', async () => {
      if (!session) return
      const built = await buildChangeTrust()
      if (!built.ok) throw new Error(built.error)
      const signed = await signTransaction(built.value.xdr, session.address)
      const sent = await submitChangeTrust({ signedXdr: signed })
      if (!sent.ok) throw new Error(sent.error)
      setChangeTrustHash(sent.value.hash)
      await recheck(transfer?.amount ?? amount)
    })

  const start = () =>
    run('Checking your USDC balance…', async () => {
      const chain = chains.find((c) => c.chainId === sourceChainId)
      if (sourceChainId === null) throw new Error('Choose a source chain.')
      if (!chain) throw new Error('Choose a source chain.')
      if (getAccount(config).chainId !== chain.chainId) {
        setBusy(`Switch your wallet to ${chain.name}…`)
        await switchChain(config, { chainId: chain.chainId })
      }
      const owner = getAccount(config).address
      if (!owner) throw new Error('Connect an EVM wallet first.')
      const wanted = parseUnits(amount, 6)
      const balance = await readContract(config, {
        chainId: chain.chainId,
        address: chain.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      })
      if (balance < wanted) throw new Error(`Not enough USDC on ${chain.name}.`)

      const created = await createBridgeTransfer({
        sourceChainId,
        amount,
        changeTrustTxHash: changeTrustHash ?? undefined,
      })
      if (!created.ok) throw new Error(created.error)
      const { transfer: planned, burn } = created.value
      // The server built the hook for the account of its session cookie: the
      // wallet signs nothing unless it pays the account on screen. Loaded on
      // demand, like the Stellar SDK everywhere else on the client.
      const { checkBurnRecipient } = await import('./burn-recipient')
      const recipient = checkBurnRecipient(burn.data, session?.address ?? '')
      if (!recipient.ok) throw new Error(recipient.error)
      setTransfer(planned)

      let burned = false
      try {
        const value = BigInt(burn.amount)
        const allowance = await readContract(config, {
          chainId: burn.chainId,
          address: burn.usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, burn.to],
        })
        if (allowance < value) {
          setBusy('Approve USDC in your wallet…')
          const approval = await writeContract(config, {
            chainId: burn.chainId,
            address: burn.usdc,
            abi: erc20Abi,
            functionName: 'approve',
            args: [burn.to, value],
          })
          const approvalRecorded = await recordApproval({
            id: planned.id,
            txHash: approval,
          })
          if (approvalRecorded.ok) setTransfer(approvalRecorded.value)
          else
            setWarning(
              `The approval was sent but could not be shown here: ${approvalRecorded.error} The burn can proceed.`
            )
          setBusy('Waiting for the approval…')
          const receipt = await waitForTransactionReceipt(config, {
            chainId: burn.chainId,
            hash: approval,
          })
          if (receipt.status !== 'success')
            throw new Error('The USDC approval reverted.')
        }

        // The burn must come from the account checked and approved above: a
        // wallet switched meanwhile would burn from an unchecked account.
        if (!sameEvmAccount(owner, getAccount(config).address))
          throw new Error(EVM_ACCOUNT_CHANGED)
        setBusy('Confirm the burn in your wallet…')
        const hash = await sendTransaction(config, {
          chainId: burn.chainId,
          to: burn.to,
          data: burn.data,
        })
        burned = true
        setPendingBurn({ chainId: burn.chainId, hash })
        const recorded = await recordBurn({ id: planned.id, txHash: hash })
        if (!recorded.ok)
          throw new Error(burnNotRecordedMessage(hash, recorded.error))
        setTransfer(recorded.value)

        setBusy('Waiting for the burn to confirm…')
        const receipt = await waitForTransactionReceipt(config, {
          chainId: burn.chainId,
          hash,
        })
        const outcome = burnReceiptOutcome(hash, receipt)
        if (outcome.kind === 'replaced') {
          // Sped up or replaced in the wallet: the recorded hash will never
          // confirm. Follow the replacement under its own hash.
          setBusy('Your wallet replaced the burn. Looking up the new one…')
          setPendingBurn({ chainId: burn.chainId, hash: outcome.hash })
          const imported = replacementImportOutcome(
            await importBridgeBurn({
              sourceChainId: burn.chainId,
              txHash: outcome.hash,
            })
          )
          if (imported.kind === 'error') throw new Error(imported.message)
          setPendingBurn(null)
          if (imported.kind === 'adopt') return resume(imported.transfer)
        }
        if (outcome.kind !== 'sent') {
          setPendingBurn(null)
          setTransfer(null)
          setFlowError(BURN_REPLACED_OR_CANCELLED)
          return
        }
        if (receipt.status !== 'success')
          setFlowError(
            'The burn reverted on the source chain. No USDC left your wallet.'
          )
        await refresh(planned.id)
      } catch (err) {
        // Nothing left the wallet: drop the planned transfer and let the user retry.
        if (!burned) setTransfer(null)
        throw err
      }
    })

  const mint = (t: BridgeTransferView) =>
    run('Preparing the mint…', async () => {
      if (!session) return
      const prepared = await prepareBridgeMint({ id: t.id })
      if (!prepared.ok) {
        if (prepared.code?.startsWith('preflight-')) await recheck(t.amount)
        throw new Error(prepared.error)
      }
      if ('alreadyReceived' in prepared.value) {
        setTransfer(prepared.value.transfer)
        return
      }
      setBusy('Sign the mint in your Stellar wallet…')
      const signed = await signTransaction(prepared.value.xdr, session.address)
      const sent = await submitBridgeMint({ id: t.id, signedXdr: signed })
      if (!sent.ok) throw new Error(sent.error)
      setTransfer(sent.value)
    })

  const resume = (t: BridgeTransferView) => {
    setFlowError(null)
    setPreflight(null)
    setTransfer(t)
    void refresh(t.id)
  }

  const importBurn = (chainId: number, hash: `0x${string}`) =>
    run('Looking up the burn…', async () => {
      const r = await importBridgeBurn({ sourceChainId: chainId, txHash: hash })
      if (!r.ok) throw new Error(r.error)
      resume(r.value)
    })

  // Never offer a fresh start once USDC may have left the source chain.
  const startNewAllowed = canStartNew(transfer, pendingBurn, busy)

  // The pending burn is settled once a server view carries its hash.
  useEffect(() => {
    if (
      pendingBurn &&
      transfer?.hashes.burn?.toLowerCase() === pendingBurn.hash.toLowerCase()
    )
      setPendingBurn(null)
  }, [pendingBurn, transfer])

  const recordPendingBurn = () =>
    run('Recording the burn…', async () => {
      if (!pendingBurn) return
      const r = await importBridgeBurn({
        sourceChainId: pendingBurn.chainId,
        txHash: pendingBurn.hash as `0x${string}`,
      })
      if (!r.ok) throw new Error(r.error)
      setPendingBurn(null)
      resume(r.value)
    })

  const newTransfer = () => {
    if (!startNewAllowed) return
    setTransfer(null)
    setChangeTrustHash(null)
  }

  return {
    chains,
    session,
    evmConnected,
    evmAddress: evmAddress ?? null,
    sourceChainId,
    setSourceChainId,
    amount,
    setAmount,
    amountLinkInvalid,
    quote,
    preflight,
    checking,
    checkError,
    transfers,
    transfer,
    busy,
    warning,
    flowError: flowError ?? refreshError,
    pendingBurn,
    pendingBurnUrl,
    canStartNew: startNewAllowed,
    actions: {
      addTrustline,
      start,
      mint,
      resume,
      importBurn,
      recordPendingBurn,
      newTransfer,
      reloadTransfers,
    },
  }
}
