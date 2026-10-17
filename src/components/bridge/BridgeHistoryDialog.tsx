'use client'

import { useState } from 'react'

import { ChevronRight, ExternalLink } from 'lucide-react'

import { NetworkIcon } from '@/components/icon/NetworkIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CctpSourceChain } from '@/lib/execution/cctp/config'
import type { BridgeTransferView } from '@/lib/execution/cctp/view'

import {
  HISTORY_LIMIT,
  STATUS_SHORT,
  isHistoryTruncated,
  orderTransfers,
} from './history'

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** The session's transfers: resume one, or find one by its burn hash. */
export function BridgeHistoryDialog({
  open,
  onOpenChange,
  transfers,
  chains,
  currentId,
  busy,
  onResume,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transfers: readonly BridgeTransferView[]
  chains: readonly CctpSourceChain[]
  currentId: string | null
  busy: boolean
  onResume: (t: BridgeTransferView) => void
  onImport: (sourceChainId: number, txHash: `0x${string}`) => void
}) {
  // No preselected chain: importing a burn needs an explicit source.
  const [chainId, setChainId] = useState<number | null>(null)
  const [hash, setHash] = useState('')
  const chainOf = (id: number) => chains.find((c) => c.chainId === id)
  const ordered = orderTransfers(transfers)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your transfers</DialogTitle>
          <DialogDescription>
            Once USDC has left the source chain, a transfer can always be
            finished here.
          </DialogDescription>
        </DialogHeader>
        {ordered.length === 0 ? (
          <p className="text-muted-foreground text-sm">No transfers yet.</p>
        ) : (
          <ul className="-mx-1 max-h-[50vh] divide-y overflow-y-auto px-1">
            {ordered.map((t) => {
              const chain = chainOf(t.sourceChainId)
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span className="flex shrink-0 items-center">
                    <NetworkIcon
                      networkSlug={chain?.slug ?? 'ethereum'}
                      size={22}
                    />
                    <NetworkIcon
                      networkSlug="stellar"
                      size={22}
                      className="ring-background -ml-1.5 rounded-full ring-2"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t.amount} USDC ·{' '}
                      {chain?.name ?? `Chain ${t.sourceChainId}`} → Stellar
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {when(t.createdAt)} · {STATUS_SHORT[t.status]}
                    </p>
                  </div>
                  {t.id === currentId ? (
                    <Badge variant="secondary">On screen</Badge>
                  ) : t.resumable ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onResume(t)}
                    >
                      Resume
                    </Button>
                  ) : t.links.mint ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs underline"
                      href={t.links.mint}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mint <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {isHistoryTruncated(transfers) && (
          <p className="text-muted-foreground text-xs">
            Showing the {HISTORY_LIMIT} most recent transfers.
          </p>
        )}
        <Collapsible className="border-t pt-3">
          <CollapsibleTrigger className="group text-muted-foreground flex items-center gap-1 text-sm">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            Transfer not listed?
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (chainId !== null && TX_HASH.test(hash))
                  onImport(chainId, hash as `0x${string}`)
              }}
            >
              <Select
                value={chainId === null ? '' : String(chainId)}
                onValueChange={(v) => setChainId(Number(v))}
              >
                <SelectTrigger aria-label="Source chain of the burn">
                  <SelectValue placeholder="Choose a source chain" />
                </SelectTrigger>
                <SelectContent>
                  {chains.map((c) => (
                    <SelectItem key={c.chainId} value={String(c.chainId)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Burn transaction hash"
                placeholder="Burn transaction hash (0x…)"
                value={hash}
                onChange={(e) => setHash(e.target.value.trim())}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={busy || chainId === null || !TX_HASH.test(hash)}
              >
                Find transfer
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      </DialogContent>
    </Dialog>
  )
}
