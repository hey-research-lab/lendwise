import { describe, expect, it } from 'vitest'

import type { BridgeTransferView } from '@/lib/execution/cctp/view'

import {
  HISTORY_LIMIT,
  hasOtherResumable,
  isHistoryTruncated,
  orderTransfers,
  resumeNotice,
  transfersOf,
} from './history'

function view(over: Partial<BridgeTransferView> = {}): BridgeTransferView {
  return {
    id: 'id',
    network: 'testnet',
    status: 'completed',
    tier: 'fast',
    tierExecuted: 'fast',
    sourceChainId: 84532,
    evmAddress: null,
    amount: '2',
    maxFee: '0.000312',
    feeExecuted: '0.00026',
    mintedAmount: '1.99974',
    hashes: { changeTrust: null, approval: null, burn: null, mint: null },
    links: { changeTrust: null, approval: null, burn: null, mint: null },
    error: null,
    resumable: false,
    createdAt: '2026-10-16T18:59:58.075Z',
    ...over,
  }
}

describe('orderTransfers', () => {
  it('puts resumable transfers first, then the others, newest first in each', () => {
    const doneNew = view({ id: 'done-new', createdAt: '2026-10-16T21:21:18Z' })
    const doneOld = view({ id: 'done-old', createdAt: '2026-10-16T18:59:58Z' })
    const openOld = view({
      id: 'open-old',
      status: 'attested',
      resumable: true,
      createdAt: '2026-10-15T09:00:00Z',
    })
    const openNew = view({
      id: 'open-new',
      status: 'burn_confirmed',
      resumable: true,
      createdAt: '2026-10-17T09:00:00Z',
    })
    expect(
      orderTransfers([doneOld, openOld, doneNew, openNew]).map((t) => t.id)
    ).toEqual(['open-new', 'open-old', 'done-new', 'done-old'])
  })

  it('does not reorder the list it was given', () => {
    const list = [view({ id: 'a' }), view({ id: 'b', resumable: true })]
    orderTransfers(list)
    expect(list.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('hasOtherResumable', () => {
  it('lights the dot for a resumable transfer other than the one on screen', () => {
    const open = view({ id: 'open', status: 'attested', resumable: true })
    expect(hasOtherResumable([], null)).toBe(false)
    expect(hasOtherResumable([open], 'open')).toBe(false)
    expect(hasOtherResumable([open], null)).toBe(true)
    expect(hasOtherResumable([open], 'other')).toBe(true)
    expect(hasOtherResumable([view({ id: 'done' })], null)).toBe(false)
  })
})

describe('resumeNotice', () => {
  it('offers the newest resumable transfer and counts the other ones', () => {
    const openOld = view({
      id: 'open-old',
      status: 'attested',
      resumable: true,
      createdAt: '2026-10-15T09:00:00Z',
    })
    const openNew = view({
      id: 'open-new',
      status: 'burn_confirmed',
      resumable: true,
      createdAt: '2026-10-17T09:00:00Z',
    })
    const stopped = view({
      id: 'stopped',
      status: 'failed',
      resumable: true,
      createdAt: '2026-10-16T09:00:00Z',
    })
    const done = view({ id: 'done', createdAt: '2026-10-18T09:00:00Z' })
    const notice = resumeNotice([openOld, openNew, done, stopped])
    expect(notice?.transfer.id).toBe('open-new')
    expect(notice?.others).toBe(2)
    expect(resumeNotice([openOld])).toEqual({ transfer: openOld, others: 0 })
  })

  it('offers nothing without a resumable transfer', () => {
    expect(resumeNotice([])).toBeNull()
    expect(
      resumeNotice([
        view({ id: 'done' }),
        view({ id: 'planned', status: 'planned' }),
      ])
    ).toBeNull()
  })

  it('does not reorder the list it was given', () => {
    const list = [
      view({ id: 'a', resumable: true, createdAt: '2026-10-15T09:00:00Z' }),
      view({ id: 'b', resumable: true, createdAt: '2026-10-17T09:00:00Z' }),
    ]
    resumeNotice(list)
    expect(list.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('transfersOf', () => {
  it('shows a list only to the account it was listed for', () => {
    const list = [view({ id: 'a' })]
    expect(transfersOf({ owner: 'GAAA', list }, 'GAAA')).toBe(list)
    expect(transfersOf({ owner: 'GAAA', list }, 'GBBB')).toEqual([])
    expect(transfersOf({ owner: 'GAAA', list }, null)).toEqual([])
    expect(transfersOf(null, 'GAAA')).toEqual([])
  })
})

describe('isHistoryTruncated', () => {
  it('says so once the server returned its limit', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => view({ id: String(i) }))
    expect(isHistoryTruncated(many(HISTORY_LIMIT - 1))).toBe(false)
    expect(isHistoryTruncated(many(HISTORY_LIMIT))).toBe(true)
  })
})
