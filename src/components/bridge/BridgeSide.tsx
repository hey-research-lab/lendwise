import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/** One side of the widget: Pay or Receive. */
export function BridgeSide({
  label,
  wallet,
  asset,
  value,
  usd,
  balance,
  onMax,
  footnote,
}: {
  label: string
  wallet: ReactNode
  asset: ReactNode
  value: ReactNode
  usd: string
  /** Null hides the balance. */
  balance: string | null
  /** Undefined hides "Max"; null shows it disabled. */
  onMax?: (() => void) | null
  footnote?: string | null
}) {
  return (
    <section className="flex flex-col gap-3 px-5 py-4" aria-label={label}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <span>{label}:</span>
        {wallet}
      </div>
      <div>{asset}</div>
      <div className="min-h-11">{value}</div>
      <div className="text-muted-foreground flex min-h-6 items-center justify-between gap-2 text-xs">
        <span>{usd}</span>
        {balance !== null && (
          <span className="flex items-center gap-2 tabular-nums">
            Balance {balance}
            {onMax !== undefined && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-xs"
                disabled={onMax === null}
                onClick={onMax ?? undefined}
              >
                Max
              </Button>
            )}
          </span>
        )}
      </div>
      {footnote && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{footnote}</p>
      )}
    </section>
  )
}
