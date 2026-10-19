'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ArrowLeft, History } from 'lucide-react'
import posthog from 'posthog-js'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  STELLAR_NETWORKS,
  type StellarNetworkId,
} from '@/config/stellar-network'
import { useStellarWallet } from '@/contexts/StellarWalletContext'
import { parseUsdcAmount } from '@/lib/execution/cctp/amounts'

import { BridgeForm } from './BridgeForm'
import { BridgeHistoryDialog } from './BridgeHistoryDialog'
import { BridgeProgress } from './BridgeProgress'
import { ResumeNotice } from './ResumeNotice'
import { stellarUsdcBalance } from './amount-view'
import { formCta, progressCta, visibleMessage } from './cta'
import { hasOtherResumable, resumeNotice } from './history'
import { STATUS_TEXT } from './steps'
import { useBridgeFlow } from './useBridgeFlow'
import { useUsdcBalances } from './useUsdcBalances'

export interface BridgeWidgetProps {
  network: StellarNetworkId
  /** `CCTP_BRIDGE_ENABLED`, read on the server: false stops new transfers, never the resume. */
  enabled: boolean
  /** The per-transfer cap, read on the server; null without one. */
  cap: string | null
  initialAmount: string | null
  /** The link carried an `amount` that could not be read. */
  linkAmountInvalid: boolean
  initialSourceChainId: number | null
  productId: string | null
  /** Resolved on the server from `product`; null when the page had none. */
  nextStep: { venue: string; href: string } | null
}

function HistoryButton({
  signedIn,
  dot,
  onClick,
}: {
  signedIn: boolean
  dot: boolean
  onClick: () => void
}) {
  const button = (
    <Button
      variant="secondary"
      size="icon-sm"
      className="relative rounded-full"
      aria-label="Your transfers"
      disabled={!signedIn}
      onClick={onClick}
    >
      <History className="size-4" />
      {dot && (
        <>
          <span
            className="bg-primary absolute -top-0.5 -right-0.5 size-2.5 rounded-full"
            aria-hidden
          />
          <span className="sr-only">An unfinished transfer</span>
        </>
      )}
    </Button>
  )
  if (signedIn) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        Sign in with Stellar to see your transfers
      </TooltipContent>
    </Tooltip>
  )
}

/** The bridge: one card, the form or the transfer on screen, and the transfers window. */
export function BridgeWidget({
  network,
  enabled,
  cap: capText,
  initialAmount,
  linkAmountInvalid,
  initialSourceChainId,
  productId,
  nextStep,
}: BridgeWidgetProps) {
  const flow = useBridgeFlow({
    network,
    enabled,
    initialAmount,
    initialSourceChainId,
    linkAmountInvalid,
  })
  const { connectStellar, disconnectStellar } = useStellarWallet()
  const { openConnectModal } = useConnectModal()
  const [historyOpen, setHistoryOpen] = useState(false)
  const { balances, refetch } = useUsdcBalances(flow.chains, flow.evmAddress)
  const cap = useMemo(
    () => (capText === null ? null : parseUsdcAmount(capText)),
    [capText]
  )
  const { friendbotUrl, explorerUrl } = STELLAR_NETWORKS[network]
  const stellarAddress = flow.session?.address ?? null
  const chain =
    flow.chains.find((c) => c.chainId === flow.sourceChainId) ?? null
  const transfer = stellarAddress ? flow.transfer : null
  const transferChain = transfer
    ? (flow.chains.find((c) => c.chainId === transfer.sourceChainId) ?? null)
    : null
  const pendingBurn = flow.pendingBurn
    ? { hash: flow.pendingBurn.hash, url: flow.pendingBurnUrl }
    : null
  // Above the form only: with a transfer on screen, the dot on 🕘 says the
  // rest; with an unrecorded burn, recording it comes first.
  const notice =
    stellarAddress && !transfer && !flow.pendingBurn
      ? resumeNotice(flow.transfers)
      : null
  const noticeChainName = notice
    ? (flow.chains.find((c) => c.chainId === notice.transfer.sourceChainId)
        ?.name ?? `Chain ${notice.transfer.sourceChainId}`)
    : ''

  // Balances move with each burn: read them again once one confirms, and
  // whenever the form comes back. Never without a wallet: `refetch` ignores
  // the query's `enabled` and would read the zero address.
  const transferStatus = flow.transfer?.status ?? null
  const refreshBalances = useCallback(() => {
    if (flow.evmAddress) void refetch()
  }, [flow.evmAddress, refetch])
  useEffect(() => {
    if (transferStatus === null || transferStatus === 'burn_confirmed')
      refreshBalances()
  }, [transferStatus, refreshBalances])

  const openFriendbot = () => {
    if (friendbotUrl && stellarAddress)
      window.open(
        `${friendbotUrl}?addr=${stellarAddress}`,
        '_blank',
        'noopener,noreferrer'
      )
  }

  const formButton = formCta({
    busy: flow.busy,
    pendingBurn: flow.pendingBurn !== null,
    enabled,
    evmConnected: flow.evmConnected,
    signedIn: stellarAddress !== null,
    chainName: chain?.name ?? null,
    amount: flow.amount,
    balance: chain ? (balances.get(chain.chainId) ?? null) : null,
    cap,
    checking: flow.checking,
    checkError: flow.checkError,
    quote: flow.quote,
    preflight: flow.preflight,
    friendbot: friendbotUrl !== null,
  })
  const onFormButton = () => {
    switch (formButton.action) {
      case 'record-burn':
        return void flow.actions.recordPendingBurn()
      case 'connect-evm':
        return openConnectModal?.()
      case 'connect-stellar':
        return void connectStellar()
      case 'fund-stellar':
        return openFriendbot()
      case 'add-trustline':
        return void flow.actions.addTrustline()
      case 'bridge':
        return void flow.actions.start()
    }
  }

  const progressButton = transfer
    ? progressCta({
        transfer,
        busy: flow.busy,
        pendingBurn: flow.pendingBurn !== null,
        preflight: flow.preflight,
        friendbot: friendbotUrl !== null,
      })
    : null
  const onProgressButton = () => {
    if (!transfer || !progressButton) return
    switch (progressButton.action) {
      case 'record-burn':
        return void flow.actions.recordPendingBurn()
      case 'fund-stellar':
        return openFriendbot()
      case 'add-trustline':
        return void flow.actions.addTrustline()
      case 'mint':
        return void flow.actions.mint(transfer)
      case 'retry':
        return flow.actions.resume(transfer)
    }
  }

  const message = visibleMessage({
    flowError: flow.flowError,
    checkError: flow.checkError,
    warning: flow.warning,
    inTransfer: transfer !== null,
  })

  const openHistory = () => {
    setHistoryOpen(true)
    void flow.actions.reloadTransfers()
  }

  return (
    <>
      <section
        className="bg-card text-card-foreground w-full overflow-hidden rounded-2xl border shadow-sm"
        aria-label="Bridge USDC to Stellar"
      >
        <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
          {transfer ? (
            <div className="flex min-w-0 items-center gap-2">
              {flow.canStartNew && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New transfer"
                  onClick={flow.actions.newTransfer}
                >
                  <ArrowLeft className="size-4" />
                </Button>
              )}
              <div className="min-w-0">
                <h1 className="text-base font-semibold">
                  {transfer.amount} USDC → Stellar
                </h1>
                <p className="text-muted-foreground truncate text-xs">
                  {STATUS_TEXT[transfer.status]}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">
                Bridge USDC to Stellar
              </h1>
              {network === 'testnet' && (
                <Badge
                  variant="secondary"
                  title="Test tokens only, no real funds"
                >
                  Testnet
                </Badge>
              )}
            </div>
          )}
          <HistoryButton
            signedIn={stellarAddress !== null}
            dot={hasOtherResumable(flow.transfers, transfer?.id ?? null)}
            onClick={openHistory}
          />
        </header>

        {notice && (
          <div className="px-5 pb-3">
            <ResumeNotice
              transfer={notice.transfer}
              chainName={noticeChainName}
              others={notice.others}
              busy={flow.busy !== null}
              onResume={() => flow.actions.resume(notice.transfer)}
              onShowAll={openHistory}
            />
          </div>
        )}

        {transfer && stellarAddress && progressButton ? (
          <BridgeProgress
            transfer={transfer}
            chain={transferChain}
            evmAddress={flow.evmAddress}
            stellarAddress={stellarAddress}
            pendingBurn={pendingBurn}
            cta={progressButton}
            onCta={onProgressButton}
            nextStep={productId ? nextStep : null}
            canStartNew={flow.canStartNew}
            onNewTransfer={flow.actions.newTransfer}
          />
        ) : (
          <BridgeForm
            chains={flow.chains}
            sourceChainId={flow.sourceChainId}
            onSourceChainId={flow.setSourceChainId}
            amount={flow.amount}
            onAmount={flow.setAmount}
            amountLinkInvalid={flow.amountLinkInvalid}
            evmConnected={flow.evmConnected}
            balances={balances}
            onChainMenuOpen={refreshBalances}
            cap={cap}
            quote={flow.quote}
            stellarAddress={stellarAddress}
            stellarBalance={stellarUsdcBalance(flow.preflight)}
            explorerUrl={explorerUrl}
            onStellarSignIn={() => void connectStellar()}
            onStellarSignOut={() => {
              if (!stellarAddress) return
              posthog.capture('wallet_disconnected', {
                chain_family: 'stellar',
                source: 'bridge',
              })
              void disconnectStellar(stellarAddress)
            }}
            pendingBurn={pendingBurn}
            cta={formButton}
            onCta={onFormButton}
            disabled={flow.busy !== null}
          />
        )}

        {message && (
          <div className="flex flex-col gap-2 px-5 pb-5">
            {message.kind === 'check' ? (
              <p className="text-destructive text-sm">{message.text}</p>
            ) : (
              <Alert
                variant={message.kind === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </section>

      <BridgeHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        transfers={flow.transfers}
        chains={flow.chains}
        currentId={transfer?.id ?? null}
        busy={flow.busy !== null}
        onResume={(t) => {
          setHistoryOpen(false)
          flow.actions.resume(t)
        }}
        onImport={(chainId, hash) => {
          setHistoryOpen(false)
          void flow.actions.importBurn(chainId, hash)
        }}
      />
    </>
  )
}
