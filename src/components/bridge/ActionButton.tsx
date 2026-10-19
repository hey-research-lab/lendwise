'use client'

import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

import type { Cta } from './cta'

export const ACTION_BUTTON_CLASS = 'h-12 w-full rounded-xl text-base'

/** The widget's single action button, with its spinner and its hint. */
export function ActionButton<A extends string>({
  cta,
  onClick,
}: {
  cta: Cta<A>
  onClick: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className={ACTION_BUTTON_CLASS}
        disabled={cta.action === null}
        onClick={onClick}
      >
        {cta.spinner && <Loader2 className="size-4 animate-spin" />}
        {cta.label}
      </Button>
      {cta.hint && (
        <p className="text-muted-foreground text-center text-xs">{cta.hint}</p>
      )}
    </div>
  )
}
