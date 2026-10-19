/**
 * A promise queue that spaces the START of each call by a minimum interval.
 *
 * Pacing, not retrying, keeps a client under a rate limit: a 429 has already
 * spent the request (see the measurements on `RPC_MIN_INTERVAL_MS` in
 * blend/common/api.ts, where this pattern was first proven on Soroban RPC).
 * One queue per upstream, at module level, so concurrent callers in the same
 * instance share it.
 */
export interface PacedQueue {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** `run()` refused a call because `maxPending` calls are already pending. */
export class QueueFullError extends Error {
  constructor(readonly maxPending: number) {
    super(`Queue full: ${maxPending} calls already pending`)
    this.name = 'QueueFullError'
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * `maxPending` bounds the calls accepted and not yet settled (waiting or
 * running). Past it, `run()` rejects at once with `QueueFullError` and never
 * runs the call, so a flood fails fast instead of growing a backlog that
 * delays every caller. Without it the queue is unbounded.
 */
export function createPacedQueue({
  minIntervalMs,
  maxPending = Number.POSITIVE_INFINITY,
  now = Date.now,
  sleep = defaultSleep,
}: {
  minIntervalMs: number
  maxPending?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): PacedQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStartAt = Number.NEGATIVE_INFINITY
  let pending = 0

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      if (pending >= maxPending)
        return Promise.reject(new QueueFullError(maxPending))
      pending += 1
      const task = async (): Promise<T> => {
        const wait = lastStartAt + minIntervalMs - now()
        if (wait > 0) await sleep(wait)
        lastStartAt = now()
        return fn()
      }
      // Chained on both settle paths so one rejection cannot stall the queue.
      const result = tail.then(task, task)
      const settled = () => {
        pending -= 1
      }
      tail = result.then(settled, settled)
      return result
    },
  }
}
