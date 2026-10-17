import {
  type PacedQueue,
  QueueFullError,
  createPacedQueue,
} from '@/lib/net/paced-queue'

export type IrisMessageState =
  | {
      status: 'pending'
      reason: 'not-found' | 'pending-confirmations' | 'rate-limited'
    }
  | {
      status: 'complete'
      message: `0x${string}`
      attestation: `0x${string}`
      /** Informational only (Iris event counter, nullable in DB). The mint nonce is `parseCctpMessage(message).header.nonce`. */
      eventNonce: string | null
    }

export interface IrisClient {
  getMessage(
    sourceDomain: number,
    txHash: `0x${string}`
  ): Promise<IrisMessageState>
}

/**
 * One queue per process for every Iris call (messages and fee quotes): Circle
 * blocks the caller for 5 minutes past 35 requests/s, and this process may
 * serve several pollers at once. Same primitive as Blend's `pacedRpc`.
 *
 * At most 20 calls wait or run (5 s of pacing). Past that, a call fails at
 * once: a poll reads as `rate-limited` and a quote as no fee tier, instead of
 * a backlog that outlives the requests waiting on it.
 */
export const irisQueue: PacedQueue = createPacedQueue({
  minIntervalMs: 250,
  maxPending: 20,
})

const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const HEX = /^0x([0-9a-fA-F]{2})+$/

interface IrisApiMessage {
  status?: string
  message?: string
  attestation?: string
  eventNonce?: string
}

export function createIrisClient(deps: {
  baseUrl: string
  fetchFn?: typeof fetch
  queue?: PacedQueue
}): IrisClient {
  const fetchFn = deps.fetchFn ?? fetch
  const queue = deps.queue ?? irisQueue
  return {
    async getMessage(sourceDomain, txHash) {
      if (!TX_HASH.test(txHash))
        throw new Error('Invalid burn transaction hash')
      const url = `${deps.baseUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`
      let res: Response
      try {
        res = await queue.run(() =>
          fetchFn(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          })
        )
      } catch (err) {
        // Not sent: the next poll asks again.
        if (err instanceof QueueFullError)
          return { status: 'pending', reason: 'rate-limited' }
        throw err
      }
      if (res.status === 404) return { status: 'pending', reason: 'not-found' }
      if (res.status === 429)
        return { status: 'pending', reason: 'rate-limited' }
      if (!res.ok) throw new Error(`Iris ${res.status}`)

      const body = (await res.json()) as { messages?: IrisApiMessage[] }
      // A burn transaction carries one message; the plan check (message.ts)
      // rejects anything that is not the transfer we planned.
      const msg = body.messages?.[0]
      if (!msg) return { status: 'pending', reason: 'not-found' }
      if (
        msg.status !== 'complete' ||
        !msg.attestation ||
        !HEX.test(msg.attestation) ||
        !msg.message ||
        !HEX.test(msg.message)
      ) {
        return { status: 'pending', reason: 'pending-confirmations' }
      }
      return {
        status: 'complete',
        message: msg.message as `0x${string}`,
        attestation: msg.attestation as `0x${string}`,
        eventNonce: typeof msg.eventNonce === 'string' ? msg.eventNonce : null,
      }
    },
  }
}
