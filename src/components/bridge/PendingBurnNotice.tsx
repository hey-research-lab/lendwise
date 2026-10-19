import { Alert, AlertDescription } from '@/components/ui/alert'

/** A burn the wallet sent that the server has not recorded: its hash stays on screen. */
export function PendingBurnNotice({
  hash,
  url,
}: {
  hash: string
  url: string | null
}) {
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-1 text-xs">
        <span>
          A burn was sent from your wallet but is not recorded yet. Record it to
          continue; do not start another transfer.
        </span>
        <code className="break-all">{hash}</code>
        {url && (
          <a className="underline" href={url} target="_blank" rel="noreferrer">
            View on the explorer
          </a>
        )}
      </AlertDescription>
    </Alert>
  )
}
