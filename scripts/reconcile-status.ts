/**
 * Print the chain-family section of the latest reconcile report — or of one
 * report by id — from `pipeline_reports`. The monitoring status report of
 * SCF #45 Tranche 3, deliverable 5: every chain family's adapters, the holes
 * found, and how each was repaired (refetch, neighbour, no donor).
 *
 * Usage:
 *   pnpm reconcile:status
 *   pnpm reconcile:status -- --id <reportId>
 *
 * Env: DATABASE_URL (read only).
 */
import { latestReport, reportById } from '@/lib/db/repositories/reports'
import { formatFamilies } from '@/lib/reconcile/families'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const i = args.indexOf('--id')
  const id = i !== -1 ? args[i + 1] : undefined

  const row = id
    ? await reportById(id, 'reconcile')
    : await latestReport('reconcile')
  if (!row) {
    console.error(id ? `No reconcile report ${id}` : 'No reconcile report yet')
    process.exit(1)
  }
  console.log(formatFamilies(row))
}

main().catch((err) => {
  console.error('❌ Reconcile status failed:', err)
  process.exit(1)
})
