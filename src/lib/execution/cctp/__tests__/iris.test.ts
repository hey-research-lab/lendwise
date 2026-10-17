import { describe, expect, it, vi } from 'vitest'

import {
  type PacedQueue,
  QueueFullError,
  createPacedQueue,
} from '@/lib/net/paced-queue'

import { createIrisClient, irisQueue } from '../iris'

const TX = `0x${'ab'.repeat(32)}` as const
const BASE = 'https://iris-api-sandbox.circle.com'

function clientReturning(...responses: Response[]) {
  const fetchFn = vi.fn(
    async (_url: string) =>
      responses.shift() ?? new Response(null, { status: 404 })
  )
  const client = createIrisClient({
    baseUrl: BASE,
    fetchFn: fetchFn as unknown as typeof fetch,
  })
  return { client, fetchFn }
}

describe('createIrisClient.getMessage', () => {
  it('queries the v2 messages endpoint by source domain and transaction hash', async () => {
    const { client, fetchFn } = clientReturning(
      new Response(null, { status: 404 })
    )
    await client.getMessage(6, TX)
    expect(fetchFn.mock.calls[0][0]).toBe(
      `${BASE}/v2/messages/6?transactionHash=${TX}`
    )
  })

  it('reports a burn Iris has not indexed yet as pending', async () => {
    const { client } = clientReturning(new Response(null, { status: 404 }))
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'not-found',
    })
    const empty = clientReturning(Response.json({ messages: [] }))
    expect(await empty.client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'not-found',
    })
  })

  it('reports pending confirmations, including a PENDING attestation on a complete status', async () => {
    const { client } = clientReturning(
      Response.json({
        messages: [
          {
            status: 'pending_confirmations',
            attestation: 'PENDING',
            message: '0x',
          },
        ],
      }),
      Response.json({
        messages: [
          { status: 'complete', attestation: 'PENDING', message: '0x01' },
        ],
      })
    )
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'pending-confirmations',
    })
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'pending-confirmations',
    })
  })

  it('treats 429 as a pending state, not an error', async () => {
    const { client } = clientReturning(new Response(null, { status: 429 }))
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'rate-limited',
    })
  })

  it('throws on any other HTTP error', async () => {
    const { client } = clientReturning(new Response('boom', { status: 500 }))
    await expect(client.getMessage(6, TX)).rejects.toThrow(/Iris 500/)
  })

  it('returns message, attestation and nonce once complete', async () => {
    const { client } = clientReturning(
      Response.json({
        messages: [
          {
            status: 'complete',
            message: '0x0001',
            attestation: '0xbeef',
            eventNonce: '42',
          },
        ],
      })
    )
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'complete',
      message: '0x0001',
      attestation: '0xbeef',
      eventNonce: '42',
    })
  })

  it('returns eventNonce null when a complete response omits it or sends a non-string', async () => {
    const { client } = clientReturning(
      Response.json({
        messages: [
          { status: 'complete', message: '0x0001', attestation: '0xbeef' },
        ],
      }),
      Response.json({
        messages: [
          {
            status: 'complete',
            message: '0x0001',
            attestation: '0xbeef',
            eventNonce: 42,
          },
        ],
      })
    )
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'complete',
      message: '0x0001',
      attestation: '0xbeef',
      eventNonce: null,
    })
    expect(await client.getMessage(6, TX)).toMatchObject({
      status: 'complete',
      eventNonce: null,
    })
  })

  it('refuses a malformed transaction hash without calling Iris', async () => {
    const { client, fetchFn } = clientReturning()
    await expect(
      client.getMessage(6, '0x1234' as `0x${string}`)
    ).rejects.toThrow(/hash/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('spaces concurrent calls through the paced queue', async () => {
    const sleeps: number[] = []
    let t = 10_000
    const queue = createPacedQueue({
      minIntervalMs: 250,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms)
        t += ms
      },
    })
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }))
    const client = createIrisClient({
      baseUrl: BASE,
      fetchFn: fetchFn as unknown as typeof fetch,
      queue,
    })
    await Promise.all([client.getMessage(6, TX), client.getMessage(6, TX)])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([250])
  })
})

describe('a full Iris queue', () => {
  it('reports the poll as rate-limited pending, without calling Iris', async () => {
    const full: PacedQueue = {
      run: () => Promise.reject(new QueueFullError(20)),
    }
    const fetchFn = vi.fn()
    const client = createIrisClient({
      baseUrl: BASE,
      fetchFn: fetchFn as unknown as typeof fetch,
      queue: full,
    })
    expect(await client.getMessage(6, TX)).toEqual({
      status: 'pending',
      reason: 'rate-limited',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('is reached at 20 waiting calls on the shared queue', async () => {
    // Only the pacing sleeps are faked: the queue's clock stays real.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const waiting = Array.from({ length: 20 }, (_, i) =>
        irisQueue.run(async () => i)
      )
      await expect(irisQueue.run(async () => 20)).rejects.toBeInstanceOf(
        QueueFullError
      )
      await vi.runAllTimersAsync()
      await expect(Promise.all(waiting)).resolves.toHaveLength(20)
    } finally {
      vi.useRealTimers()
    }
  })
})
