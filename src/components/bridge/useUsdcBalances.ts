'use client'

import { useMemo } from 'react'

import { erc20Abi } from 'viem'
import { useReadContracts } from 'wagmi'

import type { CctpSourceChain } from '@/lib/execution/cctp/config'

const BALANCE_STALE_MS = 15_000
const NOBODY = '0x0000000000000000000000000000000000000000' as const

/**
 * USDC (6 decimals) of `owner` on every source chain, read in one go through
 * the wallet's transports: the browser key on mainnet, the public RPCs of
 * `TESTNET_RPC_URLS` on testnet. A chain that could not be read maps to null,
 * which never blocks a choice.
 */
export function useUsdcBalances(
  chains: readonly CctpSourceChain[],
  owner: `0x${string}` | null
) {
  const { data, refetch } = useReadContracts({
    allowFailure: true,
    contracts: chains.map((c) => ({
      chainId: c.chainId,
      address: c.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [owner ?? NOBODY] as const,
    })),
    query: { enabled: owner !== null, staleTime: BALANCE_STALE_MS },
  })
  const balances = useMemo(
    () =>
      new Map<number, bigint | null>(
        chains.map((c, i) => {
          const r = data?.[i]
          return [
            c.chainId,
            r?.status === 'success' ? (r.result as bigint) : null,
          ]
        })
      ),
    [chains, data]
  )
  return { balances: balances as ReadonlyMap<number, bigint | null>, refetch }
}
