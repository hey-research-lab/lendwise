'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import {
  ArrowDown,
  Check,
  Circle,
  CircleAlert,
  ExternalLink,
  Loader2,
} from 'lucide-react'

import { NetworkIcon } from '@/components/icon/NetworkIcon'
import { Button } from '@/components/ui/button'
import type { CctpSourceChain } from '@/lib/execution/cctp/config'
import type { BridgeTransferView } from '@/lib/execution/cctp/view'
import { formatAddress } from '@/lib/utils'

import { ACTION_BUTTON_CLASS, ActionButton } from './ActionButton'
import { PendingBurnNotice } from './PendingBurnNotice'
import type { Cta, ProgressAction } from './cta'
import {
  type StepState,
  attestationNote,
  bridgeSteps,
  elapsedSince,
  formatElapsed,
} from './steps'

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check className="size-4 text-emerald-600" />
  if (state === 'active') return <Loader2 className="size-4 animate-spin" />
  if (state === 'failed')
    return <CircleAlert className="text-destructive size-4" />
  return <Circle className="text-muted-foreground size-4" />
}

/** Ticks every second on the client clock while the transfer waits on Circle. */
function useElapsed(createdAt: string, waiting: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [waiting])
  return elapsedSince(createdAt, now)
}

function RouteLine({
  slug,
  name,
  address,
}: {
  slug: string
  name: string
  address: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <NetworkIcon networkSlug={slug} size={18} />
      <span className="font-medium">{name}</span>
      <span
        className="text-muted-foreground truncate font-mono text-xs"
        title={address ?? undefined}
      >
        {address ? formatAddress(address) : '—'}
      </span>
    </div>
  )
}

export interface BridgeProgressProps {
  transfer: BridgeTransferView
  chain: CctpSourceChain | null
  /** The connected EVM wallet, shown when the transfer has no burner yet. */
  evmAddress: string | null
  stellarAddress: string
  pendingBurn: { hash: string; url: string | null } | null
  cta: Cta<ProgressAction>
  onCta: () => void
  /** Only when the page came from a `product` link. */
  nextStep: { venue: string; href: string } | null
  canStartNew: boolean
  onNewTransfer: () => void
}

/** The transfer on screen, in place of the form. */
export function BridgeProgress({
  transfer,
  chain,
  evmAddress,
  stellarAddress,
  pendingBurn,
  cta,
  onCta,
  nextStep,
  canStartNew,
  onNewTransfer,
}: BridgeProgressProps) {
  const waiting =
    transfer.status === 'burn_submitted' || transfer.status === 'burn_confirmed'
  const elapsed = useElapsed(transfer.createdAt, waiting)
  const note = attestationNote(transfer)
  const completed = transfer.status === 'completed'
  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      <div className="bg-muted/40 flex flex-col gap-1 rounded-xl p-3 text-sm">
        <RouteLine
          slug={chain?.slug ?? 'ethereum'}
          name={chain?.name ?? `Chain ${transfer.sourceChainId}`}
          address={transfer.evmAddress ?? evmAddress}
        />
        <ArrowDown className="text-muted-foreground ml-0.5 size-4" />
        <RouteLine slug="stellar" name="Stellar" address={stellarAddress} />
      </div>
      <ol className="flex flex-col gap-3">
        {bridgeSteps(transfer).map((s) => (
          <li key={s.key} className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-3">
              <StepIcon state={s.state} />
              <span className="flex-1">{s.label}</span>
              {s.link && (
                <a
                  className="inline-flex items-center gap-1 text-xs underline"
                  href={s.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {s.key === 'attestation' && s.state !== 'todo' && (
              <div className="text-muted-foreground flex flex-col gap-0.5 pl-7 text-xs">
                {waiting && <span>Elapsed: {formatElapsed(elapsed)}</span>}
                {note && <span>{note}</span>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {transfer.mintedAmount && (
        <p className="text-sm">
          Received {transfer.mintedAmount} USDC on Stellar
          {transfer.feeExecuted
            ? ` (Circle fee ${transfer.feeExecuted} USDC)`
            : ''}
          .
        </p>
      )}
      {transfer.error && (
        <p className="text-destructive text-sm">{transfer.error}</p>
      )}
      {pendingBurn && <PendingBurnNotice {...pendingBurn} />}
      {cta.action === 'portfolio' ? (
        <Button asChild size="lg" className={ACTION_BUTTON_CLASS}>
          <Link href="/portfolio">{cta.label}</Link>
        </Button>
      ) : (
        <ActionButton cta={cta} onClick={onCta} />
      )}
      {((completed && nextStep) || canStartNew) && (
        <div className="flex flex-wrap justify-center gap-2">
          {completed && nextStep && (
            <Button variant="outline" asChild>
              {/^https?:\/\//.test(nextStep.href) ? (
                <a href={nextStep.href} target="_blank" rel="noreferrer">
                  Next step: supply on {nextStep.venue}
                </a>
              ) : (
                <Link href={nextStep.href}>
                  Next step: supply on {nextStep.venue}
                </Link>
              )}
            </Button>
          )}
          {canStartNew && (
            <Button variant="ghost" onClick={onNewTransfer}>
              New transfer
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
