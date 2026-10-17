import { describe, expect, it } from 'vitest'

import {
  POSITION_ONLY_PROTOCOLS_META,
  PROTOCOLS_META,
  adapterIdsForProviderIn,
  yieldProtocolsMeta,
} from '@/config/protocols-meta'
import { YIELD_ADAPTERS, yieldAdapters } from '@/config/protocols-server'

const ON = { VERCEL_ENV: 'preview', STELLAR_YIELD_FIXTURE: '1' }

describe('yieldAdapters', () => {
  it('is the static registry by default', () => {
    expect(Object.keys(yieldAdapters({}))).toEqual(Object.keys(YIELD_ADAPTERS))
  })

  it('adds the fixture on a preview with the flag', () => {
    expect(Object.keys(yieldAdapters(ON))).toEqual([
      ...Object.keys(YIELD_ADAPTERS),
      'stellar_fixture',
    ])
  })

  it('never adds it in production', () => {
    expect(
      Object.keys(yieldAdapters({ ...ON, VERCEL_ENV: 'production' }))
    ).toEqual(Object.keys(YIELD_ADAPTERS))
  })

  it('loads the fixture yield adapter', async () => {
    const adapter = await yieldAdapters(ON).stellar_fixture()
    expect(adapter.id).toBe('stellar_fixture')
    expect(adapter.provider).toBe('stellar')
    expect(adapter.version).toBe('fixture')
  })
})

describe('yieldProtocolsMeta and adapterIdsForProviderIn', () => {
  it('maps the fixture provider only when it is enabled', () => {
    expect(adapterIdsForProviderIn('stellar', {})).toEqual([])
    expect(adapterIdsForProviderIn('stellar', ON)).toEqual(['stellar_fixture'])
    expect(adapterIdsForProviderIn('blend', ON)).toEqual(['blend_v2.1'])
  })

  it('never puts the fixture in PROTOCOLS_META', () => {
    expect(yieldProtocolsMeta(ON).stellar_fixture.provider).toBe('stellar')
    expect('stellar_fixture' in PROTOCOLS_META).toBe(false)
    expect('stellar_fixture' in yieldProtocolsMeta({})).toBe(false)
  })

  it('gives the position face and the yield face one identity', () => {
    expect(POSITION_ONLY_PROTOCOLS_META.stellar_fixture.provider).toBe(
      'stellar'
    )
  })
})
