import { describe, expect, it } from 'vitest'

import { QueueFullError, createPacedQueue } from './paced-queue'

/** A clock that only moves when the queue sleeps. */
function fakeClock() {
  let t = 1_000
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
    sleeps,
  }
}

describe('createPacedQueue', () => {
  it('runs the first call at once', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, ...clock })
    expect(await q.run(async () => 'a')).toBe('a')
    expect(clock.sleeps).toEqual([])
  })

  it('spaces call starts by the minimum interval', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, ...clock })
    const starts: number[] = []
    await Promise.all(
      [1, 2, 3].map((i) =>
        q.run(async () => {
          starts.push(clock.now())
          return i
        })
      )
    )
    expect(starts[1] - starts[0]).toBe(250)
    expect(starts[2] - starts[1]).toBe(250)
  })

  it('does not wait when the interval has already passed', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, ...clock })
    await q.run(async () => 1)
    clock.advance(1_000)
    await q.run(async () => 2)
    expect(clock.sleeps).toEqual([])
  })

  it('keeps going after a rejection', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, ...clock })
    const failed = q.run(async () => {
      throw new Error('boom')
    })
    const next = q.run(async () => 'next')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('next')
  })

  it('keeps calls in submission order', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 10, ...clock })
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map((i) => q.run(async () => void order.push(i)))
    )
    expect(order).toEqual([1, 2, 3, 4])
  })
})

describe('createPacedQueue maxPending', () => {
  /** A call that stays pending until `release()`. */
  function held() {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    return { fn: () => gate, release }
  }

  it('refuses a call past the bound at once, without running it', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, maxPending: 2, ...clock })
    const a = held()
    const b = held()
    const first = q.run(a.fn)
    const second = q.run(b.fn)
    let ran = false
    const third = q.run(async () => {
      ran = true
    })
    await expect(third).rejects.toBeInstanceOf(QueueFullError)
    await expect(third).rejects.toMatchObject({
      name: 'QueueFullError',
      maxPending: 2,
    })
    a.release()
    b.release()
    await Promise.all([first, second])
    expect(ran).toBe(false)
  })

  it('takes calls again once pending ones settle', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, maxPending: 1, ...clock })
    const a = held()
    const first = q.run(a.fn)
    await expect(q.run(async () => 'no')).rejects.toBeInstanceOf(QueueFullError)
    a.release()
    await first
    await expect(q.run(async () => 'yes')).resolves.toBe('yes')
  })

  it('frees the slot of a call that rejected', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 250, maxPending: 1, ...clock })
    await expect(
      q.run(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(q.run(async () => 'next')).resolves.toBe('next')
  })

  it('stays unbounded without the option', async () => {
    const clock = fakeClock()
    const q = createPacedQueue({ minIntervalMs: 1, ...clock })
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => q.run(async () => i))
    )
    expect(results).toHaveLength(100)
  })
})
