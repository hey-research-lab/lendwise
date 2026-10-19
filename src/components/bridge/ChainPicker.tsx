'use client'

import { Check, ChevronDown } from 'lucide-react'

import { NetworkIcon } from '@/components/icon/NetworkIcon'
import { TokenIcon } from '@/components/icon/TokenIcon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatUsdcAmount } from '@/lib/execution/cctp/amounts'
import type { CctpSourceChain } from '@/lib/execution/cctp/config'

const PILL =
  'bg-secondary text-secondary-foreground inline-flex h-10 items-center gap-2 rounded-full pr-3 pl-1 text-sm font-medium'

/** The chain's logo with USDC's beside it. */
function PairIcons({ slug }: { slug: string }) {
  return (
    <span className="flex items-center">
      <NetworkIcon networkSlug={slug} size={24} />
      <TokenIcon
        symbol="USDC"
        size={24}
        className="ring-secondary -ml-2 rounded-full ring-2"
      />
    </span>
  )
}

/** A fixed asset pill (Receive: USDC on Stellar). */
export function AssetPill({ slug, label }: { slug: string; label: string }) {
  return (
    <span className={PILL}>
      <PairIcons slug={slug} />
      {label}
    </span>
  )
}

/** Pay: the source chain, from a menu that shows the wallet's USDC on each. */
export function ChainPicker({
  chains,
  value,
  onChange,
  balances,
  showBalances,
  onOpen,
  disabled,
}: {
  chains: readonly CctpSourceChain[]
  value: number | null
  onChange: (chainId: number) => void
  balances: ReadonlyMap<number, bigint | null>
  /** False without an EVM wallet: the menu lists the chains alone. */
  showBalances: boolean
  onOpen: () => void
  disabled: boolean
}) {
  const selected = chains.find((c) => c.chainId === value) ?? null
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpen()}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={`${PILL} hover:bg-secondary/80 disabled:opacity-50 ${selected ? '' : 'pl-3'}`}
          aria-label="Source chain"
        >
          {selected && <PairIcons slug={selected.slug} />}
          {selected ? `USDC on ${selected.name}` : 'Choose a chain'}
          <ChevronDown className="size-4 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {chains.map((c) => {
          const balance = balances.get(c.chainId) ?? null
          return (
            <DropdownMenuItem
              key={c.chainId}
              onSelect={() => onChange(c.chainId)}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <NetworkIcon networkSlug={c.slug} size={18} />
                {c.name}
              </span>
              <span className="text-muted-foreground flex items-center gap-2 tabular-nums">
                {showBalances &&
                  (balance === null ? '—' : formatUsdcAmount(balance))}
                {c.chainId === value && (
                  <Check className="text-foreground size-4" />
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
