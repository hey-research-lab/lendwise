import { NextRequest } from 'next/server'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const limiter = vi.hoisted(() => ({
  limit: vi.fn(async () => ({ success: true, retryAfter: 0 })),
}))
vi.mock('@/lib/ratelimit', () => ({
  clientIp: () => '203.0.113.7',
  stellarAuthLimiter: limiter,
}))

const challenge = await import('../challenge/route')
const verify = await import('../verify/route')
const session = await import('../session/route')

const SITE = 'https://lendwise.fi'
const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

function request(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string }
) {
  return new NextRequest(`${SITE}/api/auth/stellar/${path}`, init)
}

beforeEach(() => {
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'lendwise.fi')
  limiter.limit.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('verify route', () => {
  it('refuses the cross-site text/plain form post that plants a session', async () => {
    // What a page on another site auto-submits: the body parses as JSON.
    const res = await verify.POST(
      request('verify', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          'content-type': 'text/plain',
        },
        body: `{"address":"${G}","transactionXdr":"AAAA","x":"="}`,
      })
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('refuses a same-origin post that is not JSON', async () => {
    const res = await verify.POST(
      request('verify', {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'text/plain' },
        body: '{}',
      })
    )
    expect(res.status).toBe(415)
  })

  it('lets a same-origin JSON post through to the verification', async () => {
    const res = await verify.POST(
      request('verify', {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: '{}',
      })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'address is required' })
  })
})

describe('challenge route', () => {
  it('refuses a cross-site POST and GET', async () => {
    const post = await challenge.POST(
      request('challenge', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ address: G }),
      })
    )
    expect(post.status).toBe(403)
    const get = await challenge.GET(
      new NextRequest(`${SITE}/api/auth/stellar/challenge?account=${G}`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      })
    )
    expect(get.status).toBe(403)
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('lets a same-origin JSON post through', async () => {
    const res = await challenge.POST(
      request('challenge', {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: '{}',
      })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'account is required' })
  })
})

describe('session route', () => {
  it('refuses a cross-site sign-out', async () => {
    const res = await session.DELETE(
      request('session', {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      })
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('signs out a same-origin caller', async () => {
    const res = await session.DELETE(
      request('session', { method: 'DELETE', headers: { origin: SITE } })
    )
    expect(res.status).toBe(200)
  })
})
