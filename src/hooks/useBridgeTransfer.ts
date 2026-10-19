'use client'

import { useCallback, useEffect, useState } from 'react'

import { refreshBridgeTransfer } from '@/app/actions'
import type { BridgeTransferStatus } from '@/lib/db/repositories/bridge-transfers'
import type { BridgeTransferView } from '@/lib/execution/cctp/view'

/** Statuses that move without the user: the page polls them. */
const POLLED: BridgeTransferStatus[] = [
  'burn_submitted',
  'burn_confirmed',
  'mint_submitted',
]
const POLL_MS = 5_000

/**
 * The transfer on screen, polled one server step at a time. All state lives on
 * the server: a reload, or another device signed in with the same Stellar
 * account, resumes from `listBridgeTransfers` + `refresh`.
 */
export function useBridgeTransfer() {
  const [transfer, setTransfer] = useState<BridgeTransferView | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on every attempt, so a failed refresh still schedules the next one.
  const [attempt, setAttempt] = useState(0)

  const refresh = useCallback(async (id: string) => {
    try {
      const r = await refreshBridgeTransfer({ id })
      if (r.ok) {
        setTransfer(r.value)
        setError(null)
      } else {
        setError(r.error)
      }
    } catch (err) {
      console.error('[bridge] refresh failed', err)
      setError('Could not reach the server. Retrying.')
    }
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!transfer || !POLLED.includes(transfer.status)) return
    const timer = setTimeout(() => void refresh(transfer.id), POLL_MS)
    return () => clearTimeout(timer)
  }, [transfer, attempt, refresh])

  return { transfer, setTransfer, refresh, error }
}
