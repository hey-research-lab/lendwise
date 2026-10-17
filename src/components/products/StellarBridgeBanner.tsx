'use client'

import Link from 'next/link'

import { ArrowLeftRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { bridgeHref } from '@/lib/execution/cctp/deep-link'

/**
 * Shown above a comparison table filtered on Stellar: the way onto any Stellar
 * market below is native USDC, bridged from an EVM wallet over Circle CCTP.
 */
export function StellarBridgeBanner() {
  return (
    <div className="border-border/50 bg-primary/5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-8 py-3">
      <p className="text-sm">
        <span className="text-foreground font-medium">
          Bridge USDC to Stellar
        </span>
        <span className="text-muted-foreground">
          {' '}
          — move native USDC from your EVM wallet to Stellar with Circle CCTP,
          then use it on any Stellar market below.
        </span>
      </p>
      <Button asChild size="sm" className="h-8 text-xs">
        <Link href={bridgeHref({})}>
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Bridge USDC
        </Link>
      </Button>
    </div>
  )
}
