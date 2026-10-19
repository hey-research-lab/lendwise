import { describe, expect, it } from 'vitest'

import { checkSameOrigin } from './same-origin'

const HOSTS = new Set(['lendwise.fi', 'localhost'])

const req = (method: string, headers: Record<string, string>) => ({
  method,
  headers: new Headers(headers),
})

describe('checkSameOrigin', () => {
  it('accepts a JSON POST from one of our own origins', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          origin: 'https://lendwise.fi',
          'content-type': 'application/json',
        }),
        HOSTS
      )
    ).toEqual({ ok: true })
  })

  it('accepts the local dev origin, port and charset included', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          origin: 'http://localhost:3000',
          'content-type': 'application/json; charset=utf-8',
        }),
        HOSTS
      )
    ).toEqual({ ok: true })
  })

  it('refuses a cross-site Origin with 403', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        }),
        HOSTS
      )
    ).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses a look-alike host and an opaque origin', () => {
    for (const origin of ['https://lendwise.fi.evil.example', 'null']) {
      expect(
        checkSameOrigin(
          req('POST', { origin, 'content-type': 'application/json' }),
          HOSTS
        )
      ).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('refuses a text/plain POST, which a cross-site form can send', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          origin: 'https://lendwise.fi',
          'content-type': 'text/plain',
        }),
        HOSTS
      )
    ).toMatchObject({ ok: false, status: 415 })
  })

  it('refuses a POST without a content type', () => {
    expect(
      checkSameOrigin(req('POST', { origin: 'https://lendwise.fi' }), HOSTS)
    ).toMatchObject({ ok: false, status: 415 })
  })

  it('refuses no Origin with Sec-Fetch-Site: cross-site', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        }),
        HOSTS
      )
    ).toMatchObject({ ok: false, status: 403 })
  })

  it('accepts no Origin with Sec-Fetch-Site: same-origin', () => {
    expect(
      checkSameOrigin(
        req('POST', {
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        }),
        HOSTS
      )
    ).toEqual({ ok: true })
  })

  it('refuses a request that carries neither header', () => {
    expect(
      checkSameOrigin(
        req('POST', { 'content-type': 'application/json' }),
        HOSTS
      )
    ).toMatchObject({ ok: false, status: 403 })
  })

  it('does not ask a GET or a DELETE for a content type', () => {
    expect(
      checkSameOrigin(req('GET', { 'sec-fetch-site': 'same-origin' }), HOSTS)
    ).toEqual({ ok: true })
    expect(
      checkSameOrigin(req('DELETE', { origin: 'https://lendwise.fi' }), HOSTS)
    ).toEqual({ ok: true })
  })
})
