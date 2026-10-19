'use client'

import { ArrowDown, ChevronRight } from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatUsdcAmount } from '@/lib/execution/cctp/amounts'
import type { CctpSourceChain } from '@/lib/execution/cctp/config'
import type { BridgeQuote } from '@/lib/execution/cctp/view'

import { ActionButton } from './ActionButton'
import { BridgeSide } from './BridgeSide'
import { AssetPill, ChainPicker } from './ChainPicker'
import { PendingBurnNotice } from './PendingBurnNotice'
import { EvmWalletChip, StellarWalletChip } from './WalletChip'
import { detailsSummary, maxAmount, receiveText, usdText } from './amount-view'
import type { Cta, FormAction } from './cta'

function Details({ quote }: { quote: BridgeQuote }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group text-muted-foreground flex w-full items-center gap-1 text-xs">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        {detailsSummary(quote)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
          <dt className="text-muted-foreground">Speed</dt>
          <dd>
            {quote.tier === 'fast'
              ? 'Fast Transfer — about a minute'
              : 'Standard — up to ~20 minutes'}
          </dd>
          <dt className="text-muted-foreground">Max fee</dt>
          <dd>
            {quote.maxFee} USDC ({quote.feeBps} bps)
          </dd>
          <dt className="text-muted-foreground">You receive at least</dt>
          <dd>{quote.minimumReceived} USDC on Stellar</dd>
          {quote.cap && (
            <>
              <dt className="text-muted-foreground">Per-transfer cap</dt>
              <dd>{quote.cap} USDC</dd>
            </>
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

export interface BridgeFormProps {
  chains: readonly CctpSourceChain[]
  sourceChainId: number | null
  onSourceChainId: (chainId: number) => void
  amount: string
  onAmount: (value: string) => void
  amountLinkInvalid: boolean
  evmConnected: boolean
  balances: ReadonlyMap<number, bigint | null>
  onChainMenuOpen: () => void
  /** The per-transfer cap (6 decimals), for "Max". */
  cap: bigint | null
  quote: BridgeQuote | null
  stellarAddress: string | null
  /** The Receive balance (`stellarUsdcBalance`). */
  stellarBalance: string | null
  explorerUrl: string
  onStellarSignIn: () => void
  onStellarSignOut: () => void
  pendingBurn: { hash: string; url: string | null } | null
  cta: Cta<FormAction>
  onCta: () => void
  /** An action runs: the inputs wait. */
  disabled: boolean
}

/** Pay, the arrow, Receive, the details and the button. */
export function BridgeForm(p: BridgeFormProps) {
  const chain = p.chains.find((c) => c.chainId === p.sourceChainId) ?? null
  const balance = chain ? (p.balances.get(chain.chainId) ?? null) : null
  const payBalance =
    p.evmConnected && chain
      ? balance === null
        ? '—'
        : formatUsdcAmount(balance)
      : null
  const max = maxAmount(balance, p.cap)
  return (
    <div className="flex flex-col">
      <BridgeSide
        label="Pay"
        wallet={<EvmWalletChip />}
        asset={
          <ChainPicker
            chains={p.chains}
            value={p.sourceChainId}
            onChange={p.onSourceChainId}
            balances={p.balances}
            showBalances={p.evmConnected}
            onOpen={p.onChainMenuOpen}
            disabled={p.disabled}
          />
        }
        value={
          <input
            aria-label="Amount of USDC to bridge"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={p.amount}
            disabled={p.disabled}
            onChange={(e) => p.onAmount(e.target.value)}
            className="placeholder:text-muted-foreground w-full min-w-0 bg-transparent text-4xl font-medium tabular-nums outline-none disabled:opacity-60"
          />
        }
        usd={usdText(p.amount)}
        balance={payBalance}
        onMax={
          payBalance === null
            ? undefined
            : max === null || p.disabled
              ? null
              : () => p.onAmount(max)
        }
        footnote={
          p.amountLinkInvalid
            ? "The link's amount was not valid. Enter an amount."
            : null
        }
      />
      <div className="relative border-t">
        <span className="bg-card text-muted-foreground absolute left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border">
          <ArrowDown className="size-4" />
        </span>
      </div>
      <BridgeSide
        label="Receive"
        wallet={
          <StellarWalletChip
            address={p.stellarAddress}
            explorerUrl={p.explorerUrl}
            onSignIn={p.onStellarSignIn}
            onSignOut={p.onStellarSignOut}
            signOutDisabled={p.disabled}
          />
        }
        asset={<AssetPill slug="stellar" label="USDC on Stellar" />}
        value={
          <p
            className={`truncate text-4xl font-medium tabular-nums ${p.quote ? '' : 'text-muted-foreground'}`}
          >
            {receiveText(p.quote)}
          </p>
        }
        usd={usdText(p.quote?.minimumReceived ?? null)}
        balance={p.stellarAddress ? (p.stellarBalance ?? '—') : '—'}
      />
      <div className="flex flex-col gap-3 border-t px-5 pt-3 pb-5">
        {p.quote && <Details quote={p.quote} />}
        {p.pendingBurn && <PendingBurnNotice {...p.pendingBurn} />}
        <ActionButton cta={p.cta} onClick={p.onCta} />
      </div>
    </div>
  )
}
