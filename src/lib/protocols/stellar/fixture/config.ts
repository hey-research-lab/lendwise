/**
 * The staging fixture's address, or null when the fixture is off. Never on in
 * production, whatever the variable says.
 */
export function fixtureAddress(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.VERCEL_ENV === 'production') return null
  return env.STELLAR_RISK_FIXTURE_ADDRESS?.trim() || null
}

/** The Blend v2.1 Fixed pool the fixture's accounts and yield product sit in. */
export const FIXTURE_POOL_ID =
  'CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO'

/** Circle USDC's Stellar asset contract on mainnet — a reserve of that pool. */
export const FIXTURE_USDC_ASSET_ID =
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'

/**
 * Whether the fixture's yield face (rates, catalogue, history) is registered:
 * only with STELLAR_YIELD_FIXTURE=1, and never in production, whatever the
 * variable says. It writes catalogue and hourly rows, so it only ever runs
 * against an isolated database (SCF #45 Tranche 3, deliverables 4 and 5).
 */
export function isStellarYieldFixtureEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.VERCEL_ENV === 'production') return false
  return env.STELLAR_YIELD_FIXTURE?.trim() === '1'
}
