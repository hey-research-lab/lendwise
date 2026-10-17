import type { HealRow } from '@/lib/db/repositories/gaps'
import type { ChainFamily } from '@/lib/protocols/core/toolkit/chain-slugs'
import type { HistoryTarget, YieldAdapter } from '@/lib/protocols/core/types'

/** A hole to fill: either no row at all, or one built from too few spots. */
export interface GapEntry {
  productId: string
  hour: Date
  kind: 'missing' | 'incomplete'
}

/**
 * Everything `runReconcile` touches, injected.
 *
 * The job's whole point is the ORDER of its steps, and an order is only worth
 * asserting if it can be asserted without a database, a network, or a signed
 * QStash request. Hence dependency injection rather than direct imports.
 */
export interface ReconcileDeps {
  findGaps(start: Date, end: Date): Promise<{ productId: string; hour: Date }[]>
  findIncomplete(
    start: Date,
    end: Date
  ): Promise<{ productId: string; hour: Date; count: number }[]>
  markStale(start: Date, end: Date): Promise<number>
  collectedProductCount(start: Date, end: Date): Promise<number>

  productProviders(productIds: string[]): Promise<Map<string, string>>
  historyTargets(productIds: string[]): Promise<HistoryTarget[]>
  /**
   * Every registered yield adapter id — the inventory the per-family report
   * lists, holes or not, so a family is visibly checked on a quiet night too.
   */
  adapterIds(): readonly string[]
  adapterIdsForProvider(provider: string): readonly string[]
  loadAdapter(adapterId: string): Promise<YieldAdapter>

  fetchDonors(
    productIds: string[],
    start: Date,
    end: Date
  ): Promise<Record<string, unknown>[]>
  writeHealed(rows: HealRow[]): Promise<number>

  aggregateDaily(start: Date, end: Date, computedAt: Date): Promise<number>
  pruneHourly(): Promise<number>
  countOrphans(): Promise<{ hourly: number; daily: number }>
}

export interface ReconcileOpts {
  /** Days of the sliding window to converge. Must cover the repair lookback. */
  days: number
  /** Detect and report, write nothing. */
  dryRun: boolean
  onProgress?: (msg: string) => void
}

/**
 * What one nightly convergence did.
 *
 * `repaired.byNeighbor` and `fetch.failed` are the two series to watch across
 * several nights: ADR 0001 defers the decision on whether nearest-neighbor
 * healing is worth keeping to exactly this measurement.
 */
/**
 * One chain family's share of a night (SCF #45 Tranche 3, deliverable 5): the
 * adapters checked and the OUTCOMES — holes found, how each was repaired, and
 * what the history fetches actually returned. Counted while repairing, never
 * inferred from what an adapter can do.
 */
export interface FamilyReport {
  adapters: { id: string; provider: string; hasHistory: boolean }[]
  gaps: number
  repaired: { byRefetch: number; byNeighbor: number; noDonor: number }
  fetch: { requested: number; returned: number; failed: number }
}

export interface ReconcileReport {
  success: boolean
  window: string
  days: number
  dryRun: boolean
  detected: {
    missing: number
    incomplete: number
    markedStale: number
    collectedProducts: number
  }
  repaired: {
    byRefetch: number
    byNeighbor: number
    noDonor: number
    written: number
    perProvider: Record<
      string,
      { gaps: number; byRefetch: number; byNeighbor: number }
    >
  }
  fetch: {
    requested: number
    returned: number
    failed: number
    failuresSample: { productId: string; reason: string }[]
  }
  aggregated: { perDay: { date: string; rows: number }[] }
  pruned: number
  /**
   * Rows whose product is absent from `products`. A health probe, not a step —
   * reconcile counts and reports, it never deletes. Expected 0·0; anything else
   * means a listing predicate has drifted and wants investigating before
   * `scripts/`-level cleanup. See `countOrphans`.
   */
  orphans: { hourly: number; daily: number }
  /** Per chain family, see FamilyReport. */
  families: Partial<Record<ChainFamily, FamilyReport>>
  durationMs: number
  errors: string[]
}
