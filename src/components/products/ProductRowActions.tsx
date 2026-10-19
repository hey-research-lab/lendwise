'use client'

import Link from 'next/link'

import { ArrowLeftRight, ArrowUpRightFromSquare } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { bridgeActionFor } from '@/lib/products/bridge-entry'

/**
 * The actions cell of a Supply or Borrow row: the guided CCTP bridge for a
 * USDC row (same tab), and the protocol's own app (new tab).
 */
export function ProductRowActions({
  product,
}: {
  product: {
    poolChainId: number
    network: string
    assetSymbol: string
    productId?: string
    link?: string
  }
}) {
  const bridge = bridgeActionFor(product)
  if (!bridge && !product.link) return null

  return (
    <div className="flex w-full items-center justify-center gap-3">
      {bridge && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={bridge}
              aria-label="Bridge to Stellar"
              className="text-primary hover:text-primary/80"
            >
              <ArrowLeftRight size={15} />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Bridge to Stellar</TooltipContent>
        </Tooltip>
      )}
      {product.link && (
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={product.link}
          aria-label="Open in the protocol's app"
        >
          <ArrowUpRightFromSquare size={15} />
        </a>
      )}
    </div>
  )
}
