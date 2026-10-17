import { decodeFunctionData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stellarNetwork } from '@/config/stellar-network'
import { StellarSessionError } from '@/lib/auth/session-guard'
import type {
  BridgeTransfer,
  BridgeTransferStatus,
  NewBridgeTransfer,
  TransferPatch,
} from '@/lib/db/repositories/bridge-transfers'
import { type PacedQueue, QueueFullError } from '@/lib/net/paced-queue'

import { buildMessage } from './__tests__/build-message'
import { tokenMessengerV2Abi } from './abis'
import { cctpConfig } from './config'
import { BurnReceiptError, type VerifiedBurn } from './evm-receipt'
import { fetchFeeTiers, planBridgeFee } from './fees'
import { contractIdToBytes32, encodeForwarderHookData } from './hook'
import { CctpMessageMismatch, parseCctpMessage } from './message'
import { MINT_TX_TIMEOUT_SECONDS } from './mint'
import { SignedTxError } from './signed-tx'
import type { HorizonAccount } from './trustline'

// The repository module imports the DB client; nothing here touches it.
vi.mock('@/lib/db/postgres', () => ({ db: {} }))

const {
  createBridgeService,
  MINT_PENDING_TIMEOUT_MS,
  BURN_NOT_FOUND_TIMEOUT_MS,
} = await import('./service')
type Deps = Parameters<typeof createBridgeService>[0]

const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const OTHER_G = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const EVM = '0x52908400098527886e0f7030069857d2e4169ee7'
const OTHER_EVM = '0x8ba1f109551bd432803012645ac136ddd64dba72'
const BURN = `0x${'ab'.repeat(32)}` as const
const NOW = Date.parse('2026-10-20T10:00:00Z')
/** The Soroban ledger the stub RPC reports as latest. */
const LEDGER = 60_000_000
/** A stored, attested message: what Iris returned and the service verified. */
const MESSAGE = buildMessage()

const testnet = stellarNetwork({ NEXT_PUBLIC_NETWORK: 'testnet' })
const cctp = cctpConfig('testnet')
const baseSepolia = cctp.sourceChains.find((c) => c.slug === 'base')!
const forwarder32 = contractIdToBytes32(cctp.stellar.forwarder)
const TIERS = [
  { finalityThreshold: 1000, minimumFee: 1.3 },
  { finalityThreshold: 2000, minimumFee: 0 },
]

const readyAccount: HorizonAccount = {
  balances: [
    { asset_type: 'native', balance: '100.0000000' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: testnet.usdc.issuer,
      balance: '0.0000000',
      limit: '922337203685.4775807',
      is_authorized: true,
    },
  ],
  subentry_count: 1,
}
const noTrustline: HorizonAccount = {
  balances: [{ asset_type: 'native', balance: '100.0000000' }],
  subentry_count: 0,
}

function memoryRepo() {
  const rows = new Map<string, BridgeTransfer>()
  let seq = 0
  const duplicate = (
    domain: number,
    hash: string | null | undefined,
    owner: string,
    id?: string
  ) =>
    !!hash &&
    [...rows.values()].some(
      (r) =>
        r.id !== id &&
        r.sourceDomain === domain &&
        r.stellarAddress === owner &&
        r.burnTxHash === hash.toLowerCase()
    )
  const uniqueViolation = () =>
    Object.assign(new Error('duplicate key'), { code: '23505' })
  const repo = {
    insertTransfer: vi.fn(async (input: NewBridgeTransfer) => {
      if (duplicate(input.sourceDomain, input.burnTxHash, input.stellarAddress))
        throw uniqueViolation()
      const t: BridgeTransfer = {
        id: `t${++seq}`,
        evmAddress: input.evmAddress?.toLowerCase() ?? null,
        feeExecuted: null,
        finalityThresholdExecuted: null,
        changeTrustTxHash: input.changeTrustTxHash ?? null,
        approvalTxHash: null,
        burnTxHash: input.burnTxHash?.toLowerCase() ?? null,
        mintTxHash: null,
        irisEventNonce: null,
        message: null,
        attestation: null,
        mintedAmount: null,
        error: null,
        createdAt: new Date(NOW + seq),
        updatedAt: new Date(NOW),
        network: input.network,
        status: input.status,
        stellarAddress: input.stellarAddress,
        sourceChainId: input.sourceChainId,
        sourceDomain: input.sourceDomain,
        amount: input.amount,
        maxFee: input.maxFee,
        minFinalityThreshold: input.minFinalityThreshold,
      }
      rows.set(t.id, t)
      return t
    }),
    findTransfer: vi.fn(async (id: string, address: string) => {
      const t = rows.get(id)
      return t && t.stellarAddress === address ? t : null
    }),
    findTransferByBurn: vi.fn(
      async (domain: number, hash: string, address: string) =>
        [...rows.values()].find(
          (r) =>
            r.sourceDomain === domain &&
            r.burnTxHash === hash.toLowerCase() &&
            r.stellarAddress === address
        ) ?? null
    ),
    listTransfers: vi.fn(async (address: string, network: string) =>
      [...rows.values()]
        .filter((r) => r.stellarAddress === address && r.network === network)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    ),
    advanceTransfer: vi.fn(
      async (
        id: string,
        from: BridgeTransferStatus[],
        to: BridgeTransferStatus,
        patch: TransferPatch = {}
      ) => {
        const t = rows.get(id)
        if (!t || !from.includes(t.status)) return null
        if (duplicate(t.sourceDomain, patch.burnTxHash, t.stellarAddress, id))
          throw uniqueViolation()
        const next = { ...t, ...patch, status: to, updatedAt: new Date(NOW) }
        rows.set(id, next)
        return next
      }
    ),
    patchTransfer: vi.fn(async (id: string, patch: TransferPatch) => {
      const t = rows.get(id)
      if (t) rows.set(id, { ...t, ...patch })
    }),
  }
  /** A row in any state, as a previous request would have left it. */
  const seed = async (
    status: BridgeTransferStatus,
    patch: TransferPatch = {}
  ) => {
    const t = await repo.insertTransfer({
      network: 'testnet',
      status: 'planned',
      stellarAddress: G,
      sourceChainId: baseSepolia.chainId,
      sourceDomain: baseSepolia.domain,
      amount: 10_000_000n,
      maxFee: 1560n,
      minFinalityThreshold: 1000,
    })
    const next = { ...t, ...patch, status }
    rows.set(t.id, next)
    return next
  }
  return { repo, rows, seed }
}

const burn = (over: Partial<VerifiedBurn> = {}): VerifiedBurn => ({
  from: EVM as `0x${string}`,
  burnToken: baseSepolia.usdc,
  amount: 10_000_000n,
  maxFee: 1560n,
  minFinalityThreshold: 1000,
  destinationDomain: 27,
  mintRecipient: forwarder32,
  destinationCaller: forwarder32,
  hookData: encodeForwarderHookData(G),
  blockNumber: 1n,
  ...over,
})

/** What `verifyMessage` returns once a real message passed: built, then parsed. */
const parsed = (feeExecuted = 1300n) =>
  parseCctpMessage(buildMessage({ body: { feeExecuted } }))

type Mint = Deps['mint']

// Typed mocks: `mockResolvedValue` then accepts every variant of the real return type.
function makeDeps(over: Partial<Deps> = {}) {
  const store = memoryRepo()
  const deps: Deps = {
    session: vi.fn<Deps['session']>(async () => ({
      address: G,
      sid: 's'.repeat(16),
      expiresAt: NOW / 1000 + 3600,
    })),
    limit: vi.fn<Deps['limit']>(async () => ({ success: true, retryAfter: 0 })),
    ip: vi.fn<Deps['ip']>(async () => '203.0.113.7'),
    limitIp: vi.fn<Deps['limitIp']>(async () => ({
      success: true,
      retryAfter: 0,
    })),
    network: testnet,
    cctp,
    env: {},
    repo: store.repo,
    feeTiers: vi.fn<Deps['feeTiers']>(async () => TIERS),
    iris: {
      getMessage: vi.fn<Deps['iris']['getMessage']>(async () => ({
        status: 'pending',
        reason: 'not-found',
      })),
    },
    horizonAccount: vi.fn<Deps['horizonAccount']>(async () => readyAccount),
    changeTrustXdr: vi.fn<Deps['changeTrustXdr']>(
      async () => 'CHANGE_TRUST_XDR'
    ),
    checkSignedChangeTrust: vi.fn<Deps['checkSignedChangeTrust']>(),
    submitClassic: vi.fn<Deps['submitClassic']>(async () => ({
      hash: 'cd'.repeat(32),
    })),
    isChangeTrustBy: vi.fn<Deps['isChangeTrustBy']>(async () => true),
    burnReceipt: vi.fn<Deps['burnReceipt']>(async () => ({
      status: 'pending',
    })),
    verifyMessage: vi.fn<Deps['verifyMessage']>(() => parsed()),
    mint: {
      prepare: vi.fn<Mint['prepare']>(async () => 'MINT_XDR'),
      check: vi.fn<Mint['check']>(),
      hashOf: vi.fn<Mint['hashOf']>(() => 'ef'.repeat(32)),
      feeOf: vi.fn<Mint['feeOf']>(() => 150_000n),
      alreadyReceived: vi.fn<Mint['alreadyReceived']>(async () => false),
      latestLedger: vi.fn<Mint['latestLedger']>(async () => LEDGER),
      submit: vi.fn<Mint['submit']>(async () => ({
        status: 'success',
        hash: 'ef'.repeat(32),
        mintedAmount: 99_987_000n,
      })),
      status: vi.fn<Mint['status']>(async () => ({
        status: 'pending',
        hash: 'ef'.repeat(32),
      })),
    },
    now: () => NOW,
    log: vi.fn<Deps['log']>(),
    ...over,
  }
  return { deps, service: createBridgeService(deps), ...store }
}

const value = <T>(
  r: { ok: true; value: T } | { ok: false; error: string; code?: string }
): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`)
  return r.value
}

describe('createBridgeTransfer', () => {
  it('plans a burn to the TokenMessengerV2 that routes the mint through the forwarder', async () => {
    const { service, rows } = makeDeps()
    const r = value(
      await service.createBridgeTransfer({
        sourceChainId: baseSepolia.chainId,
        amount: '10',
      })
    )

    expect(r.burn.to).toBe(baseSepolia.tokenMessengerV2)
    expect(r.burn.amount).toBe('10000000')
    const { functionName, args } = decodeFunctionData({
      abi: tokenMessengerV2Abi,
      data: r.burn.data,
    })
    expect(functionName).toBe('depositForBurnWithHook')
    expect(args[1]).toBe(27)
    expect(String(args[2]).toLowerCase()).toBe(forwarder32.toLowerCase())
    expect(String(args[4]).toLowerCase()).toBe(forwarder32.toLowerCase())

    const fee = planBridgeFee(10_000_000n, TIERS)
    const stored = rows.get(r.transfer.id)!
    expect(stored.status).toBe('planned')
    expect(stored.maxFee).toBe(fee.maxFee)
    expect(stored.minFinalityThreshold).toBe(fee.minFinalityThreshold)
  })

  it('refuses before any row when the trustline is missing', async () => {
    const { service, repo } = makeDeps({
      horizonAccount: vi.fn(async () => noTrustline),
    })
    const r = await service.createBridgeTransfer({
      sourceChainId: baseSepolia.chainId,
      amount: '10',
    })
    expect(r).toMatchObject({ ok: false, code: 'preflight-missing-trustline' })
    expect(repo.insertTransfer).not.toHaveBeenCalled()
  })

  it('enforces the mainnet cap server-side', async () => {
    const mainnet = cctpConfig('mainnet')
    const base = mainnet.sourceChains.find((c) => c.slug === 'base')!
    const { service } = makeDeps({
      network: stellarNetwork({}),
      cctp: mainnet,
      env: { CCTP_BRIDGE_ENABLED: '1' },
    })
    const r = await service.createBridgeTransfer({
      sourceChainId: base.chainId,
      amount: '1000.01',
    })
    expect(r).toMatchObject({ ok: false, code: 'amount-above-cap' })
  })

  it('refuses a source chain of the other network', async () => {
    const { service } = makeDeps()
    const r = await service.createBridgeTransfer({
      sourceChainId: 8453,
      amount: '10',
    })
    expect(r).toMatchObject({ ok: false, code: 'unsupported-chain' })
  })

  it('stores a ChangeTrust hash only once Horizon confirms it', async () => {
    const isChangeTrustBy = vi.fn(async () => false)
    const { service, rows } = makeDeps({ isChangeTrustBy })
    const r = value(
      await service.createBridgeTransfer({
        sourceChainId: baseSepolia.chainId,
        amount: '10',
        changeTrustTxHash: 'cd'.repeat(32),
      })
    )
    expect(isChangeTrustBy).toHaveBeenCalledWith('cd'.repeat(32), G)
    expect(rows.get(r.transfer.id)!.changeTrustTxHash).toBeNull()
  })
})

describe('kill switch (CCTP_BRIDGE_ENABLED)', () => {
  const PAUSED = {
    ok: false,
    code: 'bridge-disabled',
    error:
      'The bridge is paused. Transfers in progress can still be finished here.',
  }
  const disabled = () => makeDeps({ env: { CCTP_BRIDGE_ENABLED: '0' } })

  it('refuses a quote and a new transfer while paused, before any fee read or row', async () => {
    const { service, deps, repo } = disabled()
    expect(
      await service.quoteBridge({
        sourceChainId: baseSepolia.chainId,
        amount: '10',
      })
    ).toEqual(PAUSED)
    expect(
      await service.createBridgeTransfer({
        sourceChainId: baseSepolia.chainId,
        amount: '10',
      })
    ).toEqual(PAUSED)
    expect(deps.feeTiers).not.toHaveBeenCalled()
    expect(repo.insertTransfer).not.toHaveBeenCalled()
  })

  it('is off on mainnet unless set to 1', async () => {
    const mainnet = cctpConfig('mainnet')
    const base = mainnet.sourceChains.find((c) => c.slug === 'base')!
    const { service } = makeDeps({ network: stellarNetwork({}), cctp: mainnet })
    expect(
      await service.quoteBridge({ sourceChainId: base.chainId, amount: '10' })
    ).toEqual(PAUSED)
  })

  it('still lets a transfer in progress be listed, resumed, imported and minted', async () => {
    const { service, seed, deps } = disabled()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn(),
    })

    expect(value(await service.listBridgeTransfers())).toHaveLength(1)
    expect(
      value(await service.refreshBridgeTransfer({ id: t.id })).status
    ).toBe('burn_confirmed')

    vi.mocked(deps.iris.getMessage).mockResolvedValue({
      status: 'complete',
      message: MESSAGE,
      attestation: '0x02',
      eventNonce: '7',
    })
    expect(
      value(await service.refreshBridgeTransfer({ id: t.id })).status
    ).toBe('attested')
    expect(value(await service.preflightBridge({ amount: '10' })).state).toBe(
      'ready'
    )
    // Without an amount: the account alone, for the balance on screen.
    expect(value(await service.preflightBridge({})).state).toBe('ready')
    expect(value(await service.prepareBridgeMint({ id: t.id }))).toEqual({
      xdr: 'MINT_XDR',
    })
    expect(
      value(await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' }))
        .status
    ).toBe('completed')

    const other = `0x${'cd'.repeat(32)}` as const
    expect(
      value(
        await service.importBridgeBurn({
          sourceChainId: baseSepolia.chainId,
          txHash: other,
        })
      ).status
    ).toBe('burn_confirmed')

    const planned = await seed('planned')
    expect(
      value(await service.recordApproval({ id: planned.id, txHash: BURN }))
        .hashes.approval
    ).toBe(BURN)
    expect(
      value(
        await service.recordBurn({
          id: planned.id,
          txHash: `0x${'ee'.repeat(32)}`,
        })
      ).status
    ).toBe('burn_submitted')
  })
})

describe('session and rate limit', () => {
  it('maps a missing session to a sign-in error', async () => {
    const { service } = makeDeps({
      session: vi.fn<Deps['session']>(async () => {
        throw new StellarSessionError('missing')
      }),
    })
    const r = await service.listBridgeTransfers()
    expect(r).toMatchObject({ ok: false, code: 'missing' })
  })

  it('stops a caller over the limit', async () => {
    const { service, repo } = makeDeps({
      limit: vi.fn(async () => ({ success: false, retryAfter: 30 })),
    })
    const r = await service.listBridgeTransfers()
    expect(r).toMatchObject({ ok: false, code: 'rate-limited' })
    expect(repo.listTransfers).not.toHaveBeenCalled()
  })

  it('stops an IP over its limit even when the address is under its own', async () => {
    const { service, deps, repo } = makeDeps({
      limitIp: vi.fn(async () => ({ success: false, retryAfter: 30 })),
    })
    const r = await service.quoteBridge({
      sourceChainId: baseSepolia.chainId,
      amount: '10',
    })
    expect(r).toEqual({
      ok: false,
      code: 'rate-limited',
      error: 'Too many requests. Wait a minute and try again.',
    })
    expect(deps.limitIp).toHaveBeenCalledWith('203.0.113.7')
    expect(deps.feeTiers).not.toHaveBeenCalled()
    expect(repo.listTransfers).not.toHaveBeenCalled()
  })

  it('checks the IP before reading the session, so sessionless floods count too', async () => {
    const { service, deps } = makeDeps({
      limitIp: vi.fn(async () => ({ success: false, retryAfter: 30 })),
    })
    const r = await service.listBridgeTransfers()
    expect(r).toMatchObject({ ok: false, code: 'rate-limited' })
    expect(deps.session).not.toHaveBeenCalled()
    expect(deps.limit).not.toHaveBeenCalled()
  })
})

describe('quoteBridge', () => {
  it('answers fee-no-tier when the Iris queue is full', async () => {
    const full: PacedQueue = {
      run: () => Promise.reject(new QueueFullError(20)),
    }
    const fetchFn = vi.fn()
    const { service } = makeDeps({
      feeTiers: (domain) =>
        fetchFeeTiers(domain, {
          irisBaseUrl: cctp.irisBaseUrl,
          fetchFn: fetchFn as unknown as typeof fetch,
          queue: full,
          cache: new Map(),
        }),
    })
    const r = await service.quoteBridge({
      sourceChainId: baseSepolia.chainId,
      amount: '10',
    })
    expect(r).toEqual({
      ok: false,
      code: 'fee-no-tier',
      error:
        'Circle has no fee quote for this route right now. Try again later.',
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('recordBurn', () => {
  it('moves planned → burn_submitted and is idempotent for the same hash', async () => {
    const { service, seed, repo } = makeDeps()
    const t = await seed('planned')
    const first = value(
      await service.recordBurn({
        id: t.id,
        txHash: BURN.toUpperCase().replace('0X', '0x') as `0x${string}`,
      })
    )
    const second = value(await service.recordBurn({ id: t.id, txHash: BURN }))
    expect(first.status).toBe('burn_submitted')
    expect(second.hashes.burn).toBe(BURN)
    expect(repo.advanceTransfer).toHaveBeenCalledTimes(1)
  })

  it('refuses a different hash once a burn is recorded', async () => {
    const { service, seed } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    const r = await service.recordBurn({
      id: t.id,
      txHash: `0x${'cd'.repeat(32)}`,
    })
    expect(r).toMatchObject({ ok: false, code: 'burn-already-recorded' })
  })
})

describe('refreshBridgeTransfer — one step per call', () => {
  it('resumes after a reload: the list offers it, a refresh advances it from the stored state', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })

    const list = value(await service.listBridgeTransfers())
    expect(list).toEqual([
      expect.objectContaining({
        id: t.id,
        status: 'burn_submitted',
        resumable: true,
      }),
    ])

    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn(),
    })
    const next = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(next.status).toBe('burn_confirmed')
    expect(deps.iris.getMessage).not.toHaveBeenCalled()
  })

  it('accepts a burn sent from another EVM account and validates the message against it', async () => {
    const { service, seed, deps, rows } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({
        from: OTHER_EVM.toUpperCase().replace('0X', '0x') as `0x${string}`,
      }),
    })
    value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(rows.get(t.id)!.evmAddress).toBe(OTHER_EVM)

    vi.mocked(deps.iris.getMessage).mockResolvedValue({
      status: 'complete',
      message: '0x01',
      attestation: '0x02',
      eventNonce: '7',
    })
    value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(deps.verifyMessage).toHaveBeenCalledWith(
      '0x01',
      expect.objectContaining({
        messageSender: OTHER_EVM,
        stellarRecipient: G,
        amount: 10_000_000n,
        maxFee: 1560n,
      })
    )
    expect(rows.get(t.id)).toMatchObject({
      status: 'attested',
      feeExecuted: 1300n,
      irisEventNonce: '7',
    })
  })

  it('fails a burn whose hook routes to another Stellar address, not resumable', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({ hookData: encodeForwarderHookData(OTHER_G) }),
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({ status: 'failed', resumable: false })
  })

  it('keeps waiting while Iris has no attestation', async () => {
    const { service, seed } = makeDeps()
    const t = await seed('burn_confirmed', {
      burnTxHash: BURN,
      evmAddress: EVM,
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v.status).toBe('burn_confirmed')
  })

  it('fails a mismatching attested message but keeps the transfer resumable', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await seed('burn_confirmed', {
      burnTxHash: BURN,
      evmAddress: EVM,
    })
    vi.mocked(deps.iris.getMessage).mockResolvedValue({
      status: 'complete',
      message: '0x01',
      attestation: '0x02',
      eventNonce: '7',
    })
    vi.mocked(deps.verifyMessage).mockImplementation(() => {
      throw new CctpMessageMismatch('recipient', 'recipient mismatch')
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({ status: 'failed', resumable: true })
    expect(v.error).toMatch(/does not match/)
  })

  it('two concurrent refreshes advance the row once', async () => {
    const { service, seed, deps, repo } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn(),
    })
    const [a, b] = await Promise.all([
      service.refreshBridgeTransfer({ id: t.id }),
      service.refreshBridgeTransfer({ id: t.id }),
    ])
    expect(value(a).status).toBe('burn_confirmed')
    expect(value(b).status).toBe('burn_confirmed')
    const writes = vi
      .mocked(repo.advanceTransfer)
      .mock.results.filter((r) => r.type === 'return')
    expect(
      (await Promise.all(writes.map((w) => w.value))).filter(Boolean)
    ).toHaveLength(1)
  })

  it('keeps waiting for a burn receipt up to 30 minutes after the burn was recorded', async () => {
    const { service, seed, rows } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    rows.set(t.id, {
      ...rows.get(t.id)!,
      updatedAt: new Date(NOW - BURN_NOT_FOUND_TIMEOUT_MS),
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({
      status: 'burn_submitted',
      hashes: { burn: BURN },
    })
  })

  it('fails a burn still not found after 30 minutes, freeing its hash in one guarded write', async () => {
    const { service, seed, rows, repo } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    rows.set(t.id, {
      ...rows.get(t.id)!,
      updatedAt: new Date(NOW - BURN_NOT_FOUND_TIMEOUT_MS - 1),
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({
      status: 'failed',
      resumable: false,
      hashes: { burn: null },
    })
    expect(v.error).toMatch(/Resume from a burn hash/)
    expect(rows.get(t.id)!.burnTxHash).toBeNull()
    expect(rows.get(t.id)!.error).toBe(
      `burn-not-found: no receipt (burn ${BURN})`
    )
    expect(repo.advanceTransfer).toHaveBeenCalledTimes(1)
    expect(repo.advanceTransfer).toHaveBeenCalledWith(
      t.id,
      ['burn_submitted'],
      'failed',
      expect.objectContaining({ burnTxHash: null })
    )
  })

  it('fails a mint that never lands after the timeout, resumable', async () => {
    const { service, seed, rows } = makeDeps()
    const t = await seed('mint_submitted', {
      burnTxHash: BURN,
      evmAddress: EVM,
      mintTxHash: 'ef'.repeat(32),
      message: '0x01',
      attestation: '0x02',
    })
    rows.set(t.id, {
      ...rows.get(t.id)!,
      updatedAt: new Date(NOW - MINT_PENDING_TIMEOUT_MS - 1),
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({ status: 'failed', resumable: true })
  })
})

describe('mint', () => {
  const attested = (
    seed: ReturnType<typeof memoryRepo>['seed'],
    message: string = MESSAGE
  ) =>
    seed('attested', {
      burnTxHash: BURN,
      evmAddress: EVM,
      message,
      attestation: '0x02',
      feeExecuted: 1300n,
    })

  it('refuses to prepare a mint whose attestation expired, without moving the transfer', async () => {
    const { service, seed, deps, repo, rows } = makeDeps()
    const t = await attested(
      seed,
      buildMessage({ body: { expirationBlock: BigInt(LEDGER) } })
    )
    const r = await service.prepareBridgeMint({ id: t.id })
    expect(r).toEqual({
      ok: false,
      code: 'message-expired',
      error:
        'This attestation has expired. Contact support to finish this transfer.',
    })
    expect(deps.horizonAccount).not.toHaveBeenCalled()
    expect(deps.mint.prepare).not.toHaveBeenCalled()
    expect(repo.advanceTransfer).not.toHaveBeenCalled()
    expect(rows.get(t.id)!.status).toBe('attested')
  })

  it('prepares a mint whose expiration ledger is still ahead', async () => {
    const { service, seed } = makeDeps()
    const t = await attested(
      seed,
      buildMessage({ body: { expirationBlock: BigInt(LEDGER + 1) } })
    )
    expect(value(await service.prepareBridgeMint({ id: t.id }))).toEqual({
      xdr: 'MINT_XDR',
    })
  })

  it('never reads the ledger for a message without expiration', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await attested(seed)
    value(await service.prepareBridgeMint({ id: t.id }))
    expect(deps.mint.latestLedger).not.toHaveBeenCalled()
  })

  it('completes a message already received elsewhere instead of minting again', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await attested(seed)
    vi.mocked(deps.mint.alreadyReceived).mockResolvedValue(true)
    const r = value(await service.prepareBridgeMint({ id: t.id }))
    expect(r).toMatchObject({
      alreadyReceived: true,
      transfer: { status: 'completed' },
    })
    expect(deps.mint.prepare).not.toHaveBeenCalled()
  })

  it('asks for the trustline again when it disappeared before the mint', async () => {
    const { service, seed } = makeDeps({
      horizonAccount: vi.fn(async () => noTrustline),
    })
    const t = await attested(seed)
    const r = await service.prepareBridgeMint({ id: t.id })
    expect(r).toMatchObject({ ok: false, code: 'preflight-missing-trustline' })
  })

  it('refuses to hand over a mint whose full fee the account cannot pay', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await attested(seed)
    // readyAccount: 100 XLM, 3 reserves of 0.5 → 98.5 available.
    vi.mocked(deps.mint.feeOf).mockReturnValue(990_000_000n) // 99 XLM
    const r = await service.prepareBridgeMint({ id: t.id })
    expect(r).toMatchObject({ ok: false, code: 'preflight-insufficient-xlm' })
    expect(r.ok ? '' : r.error).toMatch(/99\.1 XLM/)
    expect(deps.mint.feeOf).toHaveBeenCalledWith('MINT_XDR')
    expect(deps.horizonAccount).toHaveBeenCalledTimes(1)
  })

  it('maps a busy network to mint-network-busy and keeps the transfer resumable', async () => {
    const { service, seed, deps, rows } = makeDeps()
    const t = await attested(seed)
    vi.mocked(deps.mint.submit).mockResolvedValueOnce({
      status: 'busy',
      hash: 'ef'.repeat(32),
      error: 'The network is busy (TRY_AGAIN_LATER)',
    })
    const r = await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    expect(r).toEqual({
      ok: false,
      code: 'mint-network-busy',
      error:
        'The Stellar network is busy. Resume in a minute to sign the mint again.',
    })
    expect(rows.get(t.id)!.error).toMatch(/^mint-network-busy: /)
    const [listed] = value(await service.listBridgeTransfers())
    expect(listed).toMatchObject({
      status: 'failed',
      resumable: true,
      error:
        'The Stellar network is busy. Resume in a minute to sign the mint again.',
    })

    expect(value(await service.prepareBridgeMint({ id: t.id }))).toEqual({
      xdr: 'MINT_XDR',
    })
    expect(
      value(await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' }))
        .status
    ).toBe('completed')
  })

  it('submits once, stores hash and minted amount, and a second call never resubmits', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await attested(seed)
    const first = value(
      await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    )
    const second = value(
      await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    )
    expect(first).toMatchObject({
      status: 'completed',
      mintedAmount: '9.9987',
      hashes: { mint: 'ef'.repeat(32) },
    })
    expect(second.status).toBe('completed')
    expect(deps.mint.submit).toHaveBeenCalledTimes(1)
    expect(first.error).toBeNull()
  })

  it('records and logs a minted amount that differs from (amount − feeExecuted) × 10', async () => {
    const { service, seed, deps, rows } = makeDeps()
    const t = await attested(seed)
    vi.mocked(deps.mint.submit).mockResolvedValue({
      status: 'success',
      hash: 'ef'.repeat(32),
      mintedAmount: 1n,
    })
    const v = value(
      await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    )
    expect(v.status).toBe('completed')
    expect(rows.get(t.id)!.error).toMatch(
      /^minted-amount-mismatch: expected 99987000, got 1/
    )
    expect(deps.log).toHaveBeenCalledWith(
      'minted_amount_mismatch',
      expect.objectContaining({ transferId: t.id })
    )
  })

  it('tells the user to switch network when the wallet signed for another one', async () => {
    const check = vi.fn(() => {
      throw new SignedTxError(
        'wrong-network',
        'signature does not verify on this network'
      )
    })
    const { service, seed, deps } = makeDeps()
    deps.mint.check = check
    const t = await attested(seed)
    const r = await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    expect(r).toMatchObject({ ok: false, code: 'wrong-network' })
    expect(r.ok ? '' : r.error).toMatch(/Stellar Testnet/)
    expect(deps.mint.submit).not.toHaveBeenCalled()
  })

  it('lets a resumable failed transfer mint again', async () => {
    const { service, seed } = makeDeps()
    const t = await seed('failed', {
      burnTxHash: BURN,
      evmAddress: EVM,
      message: '0x01',
      attestation: '0x02',
      feeExecuted: 1300n,
      error: 'mint-failed: trap',
    })
    const v = value(
      await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' })
    )
    expect(v.status).toBe('completed')
  })
})

describe('ChangeTrust', () => {
  it('maps a ChangeTrust signed for another network to wrong-network', async () => {
    const { service, deps } = makeDeps({
      checkSignedChangeTrust: vi.fn(() => {
        throw new SignedTxError('wrong-network', 'bad signature')
      }),
    })
    const r = await service.submitChangeTrust({ signedXdr: 'SIGNED' })
    expect(r).toMatchObject({ ok: false, code: 'wrong-network' })
    expect(deps.submitClassic).not.toHaveBeenCalled()
  })
})

describe('importBridgeBurn', () => {
  it('creates a burn_confirmed transfer from a burn to the session address', async () => {
    const { service, deps } = makeDeps()
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn(),
    })
    const v = value(
      await service.importBridgeBurn({
        sourceChainId: baseSepolia.chainId,
        txHash: BURN,
      })
    )
    expect(v).toMatchObject({
      status: 'burn_confirmed',
      amount: '10',
      resumable: true,
    })
  })

  it('returns the existing transfer for a burn already recorded', async () => {
    const { service, seed, repo } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    const v = value(
      await service.importBridgeBurn({
        sourceChainId: baseSepolia.chainId,
        txHash: BURN,
      })
    )
    expect(v.id).toBe(t.id)
    expect(repo.insertTransfer).toHaveBeenCalledTimes(1) // the seed only
  })

  it('refuses a burn whose hook routes to another Stellar address', async () => {
    const { service, deps } = makeDeps()
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({ hookData: encodeForwarderHookData(OTHER_G) }),
    })
    const r = await service.importBridgeBurn({
      sourceChainId: baseSepolia.chainId,
      txHash: BURN,
    })
    expect(r).toMatchObject({ ok: false, code: 'not-a-bridge-burn' })
  })
})

describe('ownership', () => {
  it('refuses a transfer owned by another Stellar address and never writes', async () => {
    const { service, seed, repo, rows } = makeDeps()
    const t = await seed('attested', {
      burnTxHash: BURN,
      evmAddress: EVM,
      message: '0x01',
      attestation: '0x02',
    })
    rows.set(t.id, { ...t, stellarAddress: OTHER_G })
    const results = [
      await service.refreshBridgeTransfer({ id: t.id }),
      await service.prepareBridgeMint({ id: t.id }),
      await service.submitBridgeMint({ id: t.id, signedXdr: 'SIGNED' }),
      await service.recordBurn({ id: t.id, txHash: BURN }),
      await service.recordApproval({ id: t.id, txHash: BURN }),
    ]
    for (const r of results)
      expect(r).toMatchObject({ ok: false, code: 'not-found' })
    expect(repo.findTransfer).toHaveBeenCalledWith(t.id, G)
    expect(repo.advanceTransfer).not.toHaveBeenCalled()
    expect(repo.patchTransfer).not.toHaveBeenCalled()
  })
})

describe('view tiers', () => {
  it('exposes the executed tier once attested, to show a Fast to Standard fallback', async () => {
    const { service, seed, deps } = makeDeps()
    const t = await seed('burn_confirmed', {
      burnTxHash: BURN,
      evmAddress: EVM,
    })
    vi.mocked(deps.iris.getMessage).mockResolvedValue({
      status: 'complete',
      message: '0x01',
      attestation: '0x02',
      eventNonce: null,
    })
    vi.mocked(deps.verifyMessage).mockReturnValue(
      parseCctpMessage(
        buildMessage({
          header: { finalityThresholdExecuted: 2000 },
          body: { feeExecuted: 0n },
        })
      )
    )
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({
      status: 'attested',
      tier: 'fast',
      tierExecuted: 'standard',
    })
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
describe('burn hash ownership', () => {
  it('lets another address import a burn whose hash a stranger already recorded', async () => {
    const { service, deps, seed } = makeDeps()
    const squat = await seed('planned')
    value(await service.recordBurn({ id: squat.id, txHash: BURN }))

    const asB = createBridgeService({
      ...deps,
      session: vi.fn<Deps['session']>(async () => ({
        address: OTHER_G,
        sid: 's'.repeat(16),
        expiresAt: NOW / 1000 + 3600,
      })),
    })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({ hookData: encodeForwarderHookData(OTHER_G) }),
    })
    const v = value(
      await asB.importBridgeBurn({
        sourceChainId: baseSepolia.chainId,
        txHash: BURN,
      })
    )
    expect(v).toMatchObject({
      status: 'burn_confirmed',
      hashes: { burn: BURN },
    })
    expect(v.id).not.toBe(squat.id)
  })

  it('frees the hash of a row that fails on a burn mismatch, keeping it in the error', async () => {
    const { service, seed, deps, rows } = makeDeps()
    const t = await seed('burn_submitted', { burnTxHash: BURN })
    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({ amount: 5_000_000n }),
    })
    const v = value(await service.refreshBridgeTransfer({ id: t.id }))
    expect(v).toMatchObject({ status: 'failed', hashes: { burn: null } })
    expect(rows.get(t.id)!.burnTxHash).toBeNull()
    expect(rows.get(t.id)!.error).toBe(`burn-mismatch: amount (burn ${BURN})`)

    vi.mocked(deps.burnReceipt).mockResolvedValue({
      status: 'confirmed',
      burn: burn({ amount: 5_000_000n }),
    })
    const imported = value(
      await service.importBridgeBurn({
        sourceChainId: baseSepolia.chainId,
        txHash: BURN,
      })
    )
    expect(imported.id).not.toBe(t.id)
    expect(imported.status).toBe('burn_confirmed')
  })
})

describe('secrets', () => {
  it('stores and logs a failure detail without the RPC key', async () => {
    vi.stubEnv('RPC_API_KEY', 'sekret-key-123')
    try {
      const { service, seed, deps, rows } = makeDeps()
      const t = await seed('burn_submitted', { burnTxHash: BURN })
      vi.mocked(deps.burnReceipt).mockRejectedValue(
        new BurnReceiptError(
          'reverted',
          'request to https://rpc.example/v1/sekret-key-123 failed'
        )
      )
      value(await service.refreshBridgeTransfer({ id: t.id }))
      expect(rows.get(t.id)!.error).toContain('burn-reverted')
      expect(rows.get(t.id)!.error).not.toContain('sekret-key-123')
      expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(
        'sekret-key-123'
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps the mint timeout beyond the transaction validity window', () => {
    expect(MINT_PENDING_TIMEOUT_MS).toBe((MINT_TX_TIMEOUT_SECONDS + 30) * 1000)
  })

  it('gives up on a burn receipt after 30 minutes', () => {
    expect(BURN_NOT_FOUND_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
