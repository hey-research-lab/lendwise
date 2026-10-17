import 'server-only'

import { resolveServerRpc } from '@/config/rpc.server'

import { STELLAR_NETWORKS, stellarNetwork } from './stellar-network'

type Env = Record<string, string | undefined>

/** The other network's public Horizon host: never this deployment's Horizon. */
const OTHER_NETWORK_HORIZON_HOST = {
  mainnet: new URL(STELLAR_NETWORKS.testnet.horizonUrl).hostname,
  testnet: new URL(STELLAR_NETWORKS.mainnet.horizonUrl).hostname,
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Overrides already warned about, so a misconfigured deployment logs once. */
const warnedOverrides = new Set<string>()

/**
 * Horizon of the deployment's network. `STELLAR_HORIZON_URL` stays an
 * override (the Tranche 2 degradation demo points it at a dead host), except
 * when it names the other network's public Horizon: a mainnet URL left on the
 * testnet deployment would read balances and accounts of the wrong ledger.
 * That override is ignored, with one warning.
 */
export function stellarHorizonUrl(
  env: Env = process.env,
  log: { warn: (message: string) => void; warned: Set<string> } = {
    warn: console.warn,
    warned: warnedOverrides,
  }
): string {
  const net = stellarNetwork(env)
  const override = env.STELLAR_HORIZON_URL?.trim()
  if (!override) return net.horizonUrl
  const host = hostOf(override)
  if (host !== OTHER_NETWORK_HORIZON_HOST[net.id]) return override
  const key = `${net.id}:${host}`
  if (!log.warned.has(key)) {
    log.warned.add(key)
    log.warn(
      `[stellar] STELLAR_HORIZON_URL (${host}) is the other network's Horizon; ignored on ${net.id}, using ${net.horizonUrl}`
    )
  }
  return net.horizonUrl
}

/**
 * Soroban RPC for transactions users sign (the bridge mint). Mainnet goes
 * through the server RPC and its key; testnet uses the public SDF endpoint —
 * the provider key is never sent to a testnet host.
 */
export function stellarSorobanRpc(env: Env = process.env): {
  url: string
  headers: Record<string, string>
} {
  const net = stellarNetwork(env)
  if (net.id === 'testnet') return { url: net.publicSorobanRpcUrl, headers: {} }
  return (
    resolveServerRpc('stellar', env) ?? {
      url: net.publicSorobanRpcUrl,
      headers: {},
    }
  )
}
