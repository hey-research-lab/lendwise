import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { BridgeTransferView } from '@/lib/execution/cctp/view'

import { STATUS_SHORT } from './history'

/**
 * An unfinished transfer, offered above the form: its USDC left the source
 * chain and has not reached Stellar. The other ones wait in the transfers window.
 */
export function ResumeNotice({
  transfer,
  chainName,
  others,
  busy,
  onResume,
  onShowAll,
}: {
  transfer: BridgeTransferView
  chainName: string
  others: number
  busy: boolean
  onResume: () => void
  onShowAll: () => void
}) {
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-2">
        <span>
          {transfer.amount} USDC from {chainName} has not reached Stellar yet ·{' '}
          {STATUS_SHORT[transfer.status]}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onResume}>
            Resume
          </Button>
          {others > 0 && (
            <Button size="sm" variant="ghost" onClick={onShowAll}>
              {others} more in your transfers
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
